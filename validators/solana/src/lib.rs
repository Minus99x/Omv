use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};
use solana_system_interface::{
    instruction::{allocate, assign, create_account, transfer},
    program as system_program,
};

entrypoint!(process_instruction);

const MAGIC: &[u8; 8] = b"OMGVSOL1";
const VERSION: u8 = 1;
const MAX_CONTACTS: usize = 16;
const MAX_SEED_BYTES: usize = 32;
const STATE_LEN: usize = 642;
const STATE_SEED: &[u8] = b"omegavault-state";
const CUSTODY_SEED: &[u8] = b"omegavault-custody";

const ERR_ALREADY_INITIALIZED: u32 = 1;
const ERR_INVALID_POLICY: u32 = 2;
const ERR_WRONG_PDA: u32 = 3;
const ERR_RECOVERED: u32 = 4;
const ERR_TIME_REGRESSION: u32 = 5;
const ERR_INACTIVITY_PENDING: u32 = 6;
const ERR_UNKNOWN_CONTACT: u32 = 7;
const ERR_THRESHOLD_PENDING: u32 = 8;
const ERR_WRONG_RESCUE: u32 = 9;
const ERR_ARITHMETIC: u32 = 10;

#[derive(Clone)]
struct VaultState {
    state_bump: u8,
    custody_bump: u8,
    recovered: bool,
    threshold: u8,
    contact_count: u8,
    vault_len: u8,
    owner: Pubkey,
    rescue: Pubkey,
    last_heartbeat: i64,
    inactivity_seconds: u64,
    approvals: u16,
    vault_id: [u8; MAX_SEED_BYTES],
    contacts: [Pubkey; MAX_CONTACTS],
}

impl VaultState {
    fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() != STATE_LEN
            || &data[0..8] != MAGIC
            || data[8] != VERSION
            || data[14] == 0
            || data[14] as usize > MAX_CONTACTS
            || data[15] == 0
            || data[15] as usize > MAX_SEED_BYTES
        {
            return Err(ProgramError::InvalidAccountData);
        }
        let threshold = data[13];
        let contact_count = data[14];
        if threshold == 0 || threshold > contact_count || data[11] > 1 {
            return Err(ProgramError::InvalidAccountData);
        }
        let mut vault_id = [0u8; MAX_SEED_BYTES];
        vault_id.copy_from_slice(&data[98..130]);
        let mut contacts = [Pubkey::default(); MAX_CONTACTS];
        for (index, contact) in contacts.iter_mut().enumerate() {
            let start = 130 + index * 32;
            *contact = Pubkey::new_from_array(
                data[start..start + 32]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?,
            );
        }
        Ok(Self {
            state_bump: data[9],
            custody_bump: data[10],
            recovered: data[11] == 1,
            threshold,
            contact_count,
            vault_len: data[15],
            owner: Pubkey::new_from_array(
                data[16..48]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?,
            ),
            rescue: Pubkey::new_from_array(
                data[48..80]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?,
            ),
            last_heartbeat: i64::from_le_bytes(
                data[80..88]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?,
            ),
            inactivity_seconds: u64::from_le_bytes(
                data[88..96]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?,
            ),
            approvals: u16::from_le_bytes(
                data[96..98]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?,
            ),
            vault_id,
            contacts,
        })
    }

    fn pack(&self, data: &mut [u8]) -> ProgramResult {
        if data.len() != STATE_LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        data.fill(0);
        data[0..8].copy_from_slice(MAGIC);
        data[8] = VERSION;
        data[9] = self.state_bump;
        data[10] = self.custody_bump;
        data[11] = u8::from(self.recovered);
        data[13] = self.threshold;
        data[14] = self.contact_count;
        data[15] = self.vault_len;
        data[16..48].copy_from_slice(self.owner.as_ref());
        data[48..80].copy_from_slice(self.rescue.as_ref());
        data[80..88].copy_from_slice(&self.last_heartbeat.to_le_bytes());
        data[88..96].copy_from_slice(&self.inactivity_seconds.to_le_bytes());
        data[96..98].copy_from_slice(&self.approvals.to_le_bytes());
        data[98..130].copy_from_slice(&self.vault_id);
        for index in 0..MAX_CONTACTS {
            let start = 130 + index * 32;
            data[start..start + 32].copy_from_slice(self.contacts[index].as_ref());
        }
        Ok(())
    }

    fn validate_state_account(&self, program_id: &Pubkey, account: &AccountInfo) -> ProgramResult {
        if account.owner != program_id || !account.is_writable {
            return Err(ProgramError::IncorrectProgramId);
        }
        let (expected, bump) = Pubkey::find_program_address(
            &[
                STATE_SEED,
                self.owner.as_ref(),
                &self.vault_id[..self.vault_len as usize],
            ],
            program_id,
        );
        if expected != *account.key || bump != self.state_bump {
            return Err(ProgramError::Custom(ERR_WRONG_PDA));
        }
        Ok(())
    }

    fn contact_index(&self, key: &Pubkey) -> Option<usize> {
        (0..self.contact_count as usize).find(|index| self.contacts[*index] == *key)
    }

    fn eligible(&self, now: i64) -> Result<bool, ProgramError> {
        let inactivity = i64::try_from(self.inactivity_seconds)
            .map_err(|_| ProgramError::Custom(ERR_ARITHMETIC))?;
        let boundary = self
            .last_heartbeat
            .checked_add(inactivity)
            .ok_or(ProgramError::Custom(ERR_ARITHMETIC))?;
        Ok(now >= boundary)
    }
}

struct Cursor<'a> {
    data: &'a [u8],
    offset: usize,
}

impl<'a> Cursor<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, offset: 0 }
    }
    fn bytes(&mut self, length: usize) -> Result<&'a [u8], ProgramError> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or(ProgramError::InvalidInstructionData)?;
        if end > self.data.len() {
            return Err(ProgramError::InvalidInstructionData);
        }
        let result = &self.data[self.offset..end];
        self.offset = end;
        Ok(result)
    }
    fn u8(&mut self) -> Result<u8, ProgramError> {
        Ok(self.bytes(1)?[0])
    }
    fn u64(&mut self) -> Result<u64, ProgramError> {
        Ok(u64::from_le_bytes(
            self.bytes(8)?
                .try_into()
                .map_err(|_| ProgramError::InvalidInstructionData)?,
        ))
    }
    fn pubkey(&mut self) -> Result<Pubkey, ProgramError> {
        Ok(Pubkey::new_from_array(
            self.bytes(32)?
                .try_into()
                .map_err(|_| ProgramError::InvalidInstructionData)?,
        ))
    }
    fn finish(&self) -> ProgramResult {
        if self.offset == self.data.len() {
            Ok(())
        } else {
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

fn create_or_claim_pda<'a>(
    payer: &AccountInfo<'a>,
    pda: &AccountInfo<'a>,
    program_id: &Pubkey,
    signer_seeds: &[&[u8]],
    space: usize,
    rent: &Rent,
) -> ProgramResult {
    if pda.owner != &system_program::ID || !pda.data_is_empty() || !pda.is_writable {
        return Err(ProgramError::Custom(ERR_ALREADY_INITIALIZED));
    }
    let required_lamports = rent.minimum_balance(space).max(1);
    if pda.lamports() == 0 {
        return invoke_signed(
            &create_account(
                payer.key,
                pda.key,
                required_lamports,
                space as u64,
                program_id,
            ),
            &[payer.clone(), pda.clone()],
            &[signer_seeds],
        );
    }
    if pda.lamports() < required_lamports {
        invoke(
            &transfer(payer.key, pda.key, required_lamports - pda.lamports()),
            &[payer.clone(), pda.clone()],
        )?;
    }
    if space > 0 {
        invoke_signed(
            &allocate(pda.key, space as u64),
            &[pda.clone()],
            &[signer_seeds],
        )?;
    }
    invoke_signed(
        &assign(pda.key, program_id),
        &[pda.clone()],
        &[signer_seeds],
    )
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (&tag, rest) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    match tag {
        0 => initialize(program_id, accounts, rest),
        1 => heartbeat(program_id, accounts, rest),
        2 => approve(program_id, accounts, rest),
        3 => execute_native(program_id, accounts, rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn initialize(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let mut cursor = Cursor::new(data);
    let vault_len = cursor.u8()? as usize;
    if vault_len == 0 || vault_len > MAX_SEED_BYTES {
        return Err(ProgramError::Custom(ERR_INVALID_POLICY));
    }
    let vault_bytes = cursor.bytes(vault_len)?;
    let threshold = cursor.u8()?;
    let contact_count = cursor.u8()?;
    let inactivity_seconds = cursor.u64()?;
    let rescue = cursor.pubkey()?;
    if contact_count == 0
        || contact_count as usize > MAX_CONTACTS
        || threshold == 0
        || threshold > contact_count
        || inactivity_seconds == 0
        || inactivity_seconds > i64::MAX as u64
    {
        return Err(ProgramError::Custom(ERR_INVALID_POLICY));
    }
    let mut contacts = [Pubkey::default(); MAX_CONTACTS];
    for index in 0..contact_count as usize {
        contacts[index] = cursor.pubkey()?;
    }
    cursor.finish()?;

    let account_iter = &mut accounts.iter();
    let payer = next_account_info(account_iter)?;
    let owner = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;
    let custody_account = next_account_info(account_iter)?;
    let system = next_account_info(account_iter)?;
    if account_iter.next().is_some()
        || !payer.is_signer
        || !payer.is_writable
        || !owner.is_signer
        || !system_program::check_id(system.key)
    {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if rescue == *owner.key
        || contacts[..contact_count as usize]
            .iter()
            .any(|contact| *contact == *owner.key)
    {
        return Err(ProgramError::Custom(ERR_INVALID_POLICY));
    }
    for i in 0..contact_count as usize {
        if contacts[i..contact_count as usize]
            .iter()
            .skip(1)
            .any(|candidate| *candidate == contacts[i])
        {
            return Err(ProgramError::Custom(ERR_INVALID_POLICY));
        }
    }
    if state_account.owner == program_id || custody_account.owner == program_id {
        return Err(ProgramError::Custom(ERR_ALREADY_INITIALIZED));
    }

    let (expected_state, state_bump) =
        Pubkey::find_program_address(&[STATE_SEED, owner.key.as_ref(), vault_bytes], program_id);
    let (expected_custody, custody_bump) =
        Pubkey::find_program_address(&[CUSTODY_SEED, owner.key.as_ref(), vault_bytes], program_id);
    if expected_state != *state_account.key || expected_custody != *custody_account.key {
        return Err(ProgramError::Custom(ERR_WRONG_PDA));
    }

    let rent = Rent::get()?;
    create_or_claim_pda(
        payer,
        state_account,
        program_id,
        &[STATE_SEED, owner.key.as_ref(), vault_bytes, &[state_bump]],
        STATE_LEN,
        &rent,
    )?;
    create_or_claim_pda(
        payer,
        custody_account,
        program_id,
        &[
            CUSTODY_SEED,
            owner.key.as_ref(),
            vault_bytes,
            &[custody_bump],
        ],
        0,
        &rent,
    )?;

    let mut vault_id = [0u8; MAX_SEED_BYTES];
    vault_id[..vault_len].copy_from_slice(vault_bytes);
    let state = VaultState {
        state_bump,
        custody_bump,
        recovered: false,
        threshold,
        contact_count,
        vault_len: vault_len as u8,
        owner: *owner.key,
        rescue,
        last_heartbeat: Clock::get()?.unix_timestamp,
        inactivity_seconds,
        approvals: 0,
        vault_id,
        contacts,
    };
    state.pack(&mut state_account.try_borrow_mut_data()?)
}

fn heartbeat(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if !data.is_empty() || accounts.len() != 2 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let owner = &accounts[0];
    let state_account = &accounts[1];
    if !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut state = VaultState::unpack(&state_account.try_borrow_data()?)?;
    state.validate_state_account(program_id, state_account)?;
    if state.owner != *owner.key {
        return Err(ProgramError::IllegalOwner);
    }
    if state.recovered {
        return Err(ProgramError::Custom(ERR_RECOVERED));
    }
    let now = Clock::get()?.unix_timestamp;
    if now < state.last_heartbeat {
        return Err(ProgramError::Custom(ERR_TIME_REGRESSION));
    }
    state.last_heartbeat = now;
    state.approvals = 0;
    state.pack(&mut state_account.try_borrow_mut_data()?)
}

fn approve(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if !data.is_empty() || accounts.len() != 2 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let signer = &accounts[0];
    let state_account = &accounts[1];
    if !signer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut state = VaultState::unpack(&state_account.try_borrow_data()?)?;
    state.validate_state_account(program_id, state_account)?;
    if state.recovered {
        return Err(ProgramError::Custom(ERR_RECOVERED));
    }
    if !state.eligible(Clock::get()?.unix_timestamp)? {
        return Err(ProgramError::Custom(ERR_INACTIVITY_PENDING));
    }
    let index = state
        .contact_index(signer.key)
        .ok_or(ProgramError::Custom(ERR_UNKNOWN_CONTACT))?;
    state.approvals |= 1u16
        .checked_shl(index as u32)
        .ok_or(ProgramError::Custom(ERR_ARITHMETIC))?;
    state.pack(&mut state_account.try_borrow_mut_data()?)
}

fn execute_native(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if !data.is_empty() || accounts.len() != 4 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let executor = &accounts[0];
    let state_account = &accounts[1];
    let custody = &accounts[2];
    let rescue = &accounts[3];
    if !executor.is_signer
        || !state_account.is_writable
        || !custody.is_writable
        || !rescue.is_writable
    {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut state = VaultState::unpack(&state_account.try_borrow_data()?)?;
    state.validate_state_account(program_id, state_account)?;
    if state.recovered {
        return Err(ProgramError::Custom(ERR_RECOVERED));
    }
    if !state.eligible(Clock::get()?.unix_timestamp)? {
        return Err(ProgramError::Custom(ERR_INACTIVITY_PENDING));
    }
    if state.approvals.count_ones() < state.threshold as u32 {
        return Err(ProgramError::Custom(ERR_THRESHOLD_PENDING));
    }
    if state.rescue != *rescue.key {
        return Err(ProgramError::Custom(ERR_WRONG_RESCUE));
    }
    let (expected_custody, bump) = Pubkey::find_program_address(
        &[
            CUSTODY_SEED,
            state.owner.as_ref(),
            &state.vault_id[..state.vault_len as usize],
        ],
        program_id,
    );
    if expected_custody != *custody.key || bump != state.custody_bump || custody.owner != program_id
    {
        return Err(ProgramError::Custom(ERR_WRONG_PDA));
    }

    state.recovered = true;
    state.pack(&mut state_account.try_borrow_mut_data()?)?;
    let amount = custody.lamports();
    let destination_balance = rescue
        .lamports()
        .checked_add(amount)
        .ok_or(ProgramError::Custom(ERR_ARITHMETIC))?;
    **custody.try_borrow_mut_lamports()? = 0;
    **rescue.try_borrow_mut_lamports()? = destination_balance;
    Ok(())
}
