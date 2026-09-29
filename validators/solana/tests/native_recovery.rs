use {
    solana_clock::Clock,
    solana_instruction::{error::InstructionError, AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_program_test::{ProgramTest, ProgramTestContext},
    solana_pubkey::Pubkey,
    solana_signer::Signer,
    solana_system_interface::{instruction as system_instruction, program as system_program},
    solana_transaction::Transaction,
    solana_transaction_error::TransactionError,
};

const ERR_RECOVERED: u32 = 4;
const ERR_INACTIVITY_PENDING: u32 = 6;
const ERR_UNKNOWN_CONTACT: u32 = 7;
const ERR_THRESHOLD_PENDING: u32 = 8;
const ERR_WRONG_RESCUE: u32 = 9;
const STATE_SEED: &[u8] = b"omegavault-state";
const CUSTODY_SEED: &[u8] = b"omegavault-custody";
const STATE_LEN: usize = 642;

struct Fixture {
    context: ProgramTestContext,
    program_id: Pubkey,
    owner: Keypair,
    contact_a: Keypair,
    contact_b: Keypair,
    outsider: Keypair,
    rescue: Pubkey,
    state: Pubkey,
    custody: Pubkey,
}

fn initialize_data(
    vault_id: &[u8],
    threshold: u8,
    inactivity_seconds: u64,
    rescue: &Pubkey,
    contacts: &[Pubkey],
) -> Vec<u8> {
    let mut data = Vec::with_capacity(44 + vault_id.len() + contacts.len() * 32);
    data.push(0);
    data.push(vault_id.len() as u8);
    data.extend_from_slice(vault_id);
    data.push(threshold);
    data.push(contacts.len() as u8);
    data.extend_from_slice(&inactivity_seconds.to_le_bytes());
    data.extend_from_slice(rescue.as_ref());
    for contact in contacts {
        data.extend_from_slice(contact.as_ref());
    }
    data
}

fn instruction(program_id: Pubkey, tag: u8, accounts: Vec<AccountMeta>) -> Instruction {
    Instruction {
        program_id,
        accounts,
        data: vec![tag],
    }
}

async fn submit(
    context: &mut ProgramTestContext,
    instructions: &[Instruction],
    signers: &[&Keypair],
) -> Result<(), TransactionError> {
    let recent_blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let mut all_signers = vec![&context.payer];
    all_signers.extend_from_slice(signers);
    let transaction = Transaction::new_signed_with_payer(
        instructions,
        Some(&context.payer.pubkey()),
        &all_signers,
        recent_blockhash,
    );
    context
        .banks_client
        .process_transaction(transaction)
        .await
        .map_err(|error| error.unwrap())
}

fn assert_custom_error(result: Result<(), TransactionError>, expected: u32) {
    assert_eq!(
        result.unwrap_err(),
        TransactionError::InstructionError(0, InstructionError::Custom(expected))
    );
}

async fn setup() -> Fixture {
    let program_id = Pubkey::new_unique();
    let owner = Keypair::new();
    let contact_a = Keypair::new();
    let contact_b = Keypair::new();
    let outsider = Keypair::new();
    let rescue = Pubkey::new_unique();
    let vault_id = b"native-e2e";
    let (state, _) = Pubkey::find_program_address(
        &[STATE_SEED, owner.pubkey().as_ref(), vault_id],
        &program_id,
    );
    let (custody, _) = Pubkey::find_program_address(
        &[CUSTODY_SEED, owner.pubkey().as_ref(), vault_id],
        &program_id,
    );
    let program_test = ProgramTest::new("omegavault_solana_recovery", program_id, None);
    let mut context = program_test.start_with_context().await;
    let initialize = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(context.payer.pubkey(), true),
            AccountMeta::new_readonly(owner.pubkey(), true),
            AccountMeta::new(state, false),
            AccountMeta::new(custody, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: initialize_data(
            vault_id,
            2,
            10,
            &rescue,
            &[contact_a.pubkey(), contact_b.pubkey()],
        ),
    };
    submit(&mut context, &[initialize], &[&owner])
        .await
        .unwrap();

    Fixture {
        context,
        program_id,
        owner,
        contact_a,
        contact_b,
        outsider,
        rescue,
        state,
        custody,
    }
}

#[tokio::test]
async fn native_recovery_enforces_time_contacts_threshold_and_replay_protection() {
    let mut fixture = setup().await;
    let state_account = fixture
        .context
        .banks_client
        .get_account(fixture.state)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(state_account.owner, fixture.program_id);
    assert_eq!(state_account.data.len(), STATE_LEN);
    assert_eq!(&state_account.data[0..8], b"OMGVSOL1");
    assert_eq!(state_account.data[11], 0);

    let approve_a = instruction(
        fixture.program_id,
        2,
        vec![
            AccountMeta::new_readonly(fixture.contact_a.pubkey(), true),
            AccountMeta::new(fixture.state, false),
        ],
    );
    assert_custom_error(
        submit(
            &mut fixture.context,
            &[approve_a.clone()],
            &[&fixture.contact_a],
        )
        .await,
        ERR_INACTIVITY_PENDING,
    );

    let mut clock = fixture
        .context
        .banks_client
        .get_sysvar::<Clock>()
        .await
        .unwrap();
    clock.unix_timestamp += 11;
    fixture.context.set_sysvar(&clock);

    let outsider_approval = instruction(
        fixture.program_id,
        2,
        vec![
            AccountMeta::new_readonly(fixture.outsider.pubkey(), true),
            AccountMeta::new(fixture.state, false),
        ],
    );
    assert_custom_error(
        submit(
            &mut fixture.context,
            &[outsider_approval],
            &[&fixture.outsider],
        )
        .await,
        ERR_UNKNOWN_CONTACT,
    );

    submit(&mut fixture.context, &[approve_a], &[&fixture.contact_a])
        .await
        .unwrap();
    let execute = instruction(
        fixture.program_id,
        3,
        vec![
            AccountMeta::new_readonly(fixture.outsider.pubkey(), true),
            AccountMeta::new(fixture.state, false),
            AccountMeta::new(fixture.custody, false),
            AccountMeta::new(fixture.rescue, false),
        ],
    );
    assert_custom_error(
        submit(
            &mut fixture.context,
            &[execute.clone()],
            &[&fixture.outsider],
        )
        .await,
        ERR_THRESHOLD_PENDING,
    );

    let approve_b = instruction(
        fixture.program_id,
        2,
        vec![
            AccountMeta::new_readonly(fixture.contact_b.pubkey(), true),
            AccountMeta::new(fixture.state, false),
        ],
    );
    submit(&mut fixture.context, &[approve_b], &[&fixture.contact_b])
        .await
        .unwrap();

    let wrong_rescue = Pubkey::new_unique();
    let wrong_execute = instruction(
        fixture.program_id,
        3,
        vec![
            AccountMeta::new_readonly(fixture.outsider.pubkey(), true),
            AccountMeta::new(fixture.state, false),
            AccountMeta::new(fixture.custody, false),
            AccountMeta::new(wrong_rescue, false),
        ],
    );
    assert_custom_error(
        submit(&mut fixture.context, &[wrong_execute], &[&fixture.outsider]).await,
        ERR_WRONG_RESCUE,
    );

    let deposit = 50_000_000;
    let fund =
        system_instruction::transfer(&fixture.context.payer.pubkey(), &fixture.custody, deposit);
    submit(&mut fixture.context, &[fund], &[]).await.unwrap();
    let custody_before = fixture
        .context
        .banks_client
        .get_balance(fixture.custody)
        .await
        .unwrap();
    let rescue_before = fixture
        .context
        .banks_client
        .get_balance(fixture.rescue)
        .await
        .unwrap();

    submit(&mut fixture.context, &[execute], &[&fixture.outsider])
        .await
        .unwrap();
    assert_eq!(
        fixture
            .context
            .banks_client
            .get_balance(fixture.rescue)
            .await
            .unwrap(),
        rescue_before + custody_before
    );
    assert_eq!(
        fixture
            .context
            .banks_client
            .get_balance(fixture.custody)
            .await
            .unwrap(),
        0
    );
    let recovered = fixture
        .context
        .banks_client
        .get_account(fixture.state)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(recovered.data[11], 1);

    let heartbeat = instruction(
        fixture.program_id,
        1,
        vec![
            AccountMeta::new_readonly(fixture.owner.pubkey(), true),
            AccountMeta::new(fixture.state, false),
        ],
    );
    assert_custom_error(
        submit(&mut fixture.context, &[heartbeat], &[&fixture.owner]).await,
        ERR_RECOVERED,
    );
}

#[tokio::test]
async fn heartbeat_clears_approvals_and_restarts_inactivity() {
    let mut fixture = setup().await;
    let mut clock = fixture
        .context
        .banks_client
        .get_sysvar::<Clock>()
        .await
        .unwrap();
    clock.unix_timestamp += 11;
    fixture.context.set_sysvar(&clock);

    let approve_a = instruction(
        fixture.program_id,
        2,
        vec![
            AccountMeta::new_readonly(fixture.contact_a.pubkey(), true),
            AccountMeta::new(fixture.state, false),
        ],
    );
    submit(&mut fixture.context, &[approve_a], &[&fixture.contact_a])
        .await
        .unwrap();

    let heartbeat = instruction(
        fixture.program_id,
        1,
        vec![
            AccountMeta::new_readonly(fixture.owner.pubkey(), true),
            AccountMeta::new(fixture.state, false),
        ],
    );
    submit(&mut fixture.context, &[heartbeat], &[&fixture.owner])
        .await
        .unwrap();
    let state = fixture
        .context
        .banks_client
        .get_account(fixture.state)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        u16::from_le_bytes(state.data[96..98].try_into().unwrap()),
        0
    );

    let approve_again = instruction(
        fixture.program_id,
        2,
        vec![
            AccountMeta::new_readonly(fixture.contact_a.pubkey(), true),
            AccountMeta::new(fixture.state, false),
        ],
    );
    assert_custom_error(
        submit(
            &mut fixture.context,
            &[approve_again],
            &[&fixture.contact_a],
        )
        .await,
        ERR_INACTIVITY_PENDING,
    );
}
