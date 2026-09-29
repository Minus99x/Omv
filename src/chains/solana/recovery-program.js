import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { deriveSolanaAssociatedTokenAddress, SOLANA_ASSOCIATED_TOKEN_PROGRAM_ID } from './program-codec.js';

export const SOLANA_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const SOLANA_TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const SOLANA_SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const SOLANA_TOKEN_MINT_BASE_BYTES = 82;
export const SOLANA_TOKEN_ACCOUNT_BASE_BYTES = 165;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_TOKEN_2022_ACCOUNT_TYPE_OFFSET = SOLANA_TOKEN_ACCOUNT_BASE_BYTES;
const SOLANA_TOKEN_2022_TLV_OFFSET = SOLANA_TOKEN_2022_ACCOUNT_TYPE_OFFSET + 1;
const SOLANA_TOKEN_2022_ACCOUNT_TYPE = Object.freeze({ mint: 1, account: 2 });
const SOLANA_TOKEN_2022_EXTENSION_NAMES = Object.freeze(new Map([
  [1, 'TransferFeeConfig'], [2, 'TransferFeeAmount'], [3, 'MintCloseAuthority'],
  [4, 'ConfidentialTransferMint'], [5, 'ConfidentialTransferAccount'], [6, 'DefaultAccountState'],
  [7, 'ImmutableOwner'], [8, 'MemoTransfer'], [9, 'NonTransferable'],
  [10, 'InterestBearingConfig'], [11, 'CpiGuard'], [12, 'PermanentDelegate'],
  [13, 'NonTransferableAccount'], [14, 'TransferHook'], [15, 'TransferHookAccount'],
  [16, 'ConfidentialTransferFeeConfig'], [17, 'ConfidentialTransferFeeAmount'],
  [18, 'MetadataPointer'], [19, 'TokenMetadata'], [20, 'GroupPointer'],
  [21, 'TokenGroup'], [22, 'GroupMemberPointer'], [23, 'TokenGroupMember'],
  [24, 'ConfidentialMintBurn'], [25, 'ScaledUiAmount'], [26, 'Pausable'],
  [27, 'PausableAccount'], [28, 'PermissionedBurn']
]));

const SOLANA_TOKEN_2022_BLOCKED_MINT_EXTENSIONS = Object.freeze(new Set([
  'TransferFeeConfig', 'DefaultAccountState', 'ConfidentialTransferMint', 'NonTransferable',
  'PermanentDelegate', 'TransferHook', 'ConfidentialTransferFeeConfig', 'ConfidentialMintBurn', 'Pausable'
]));
const SOLANA_TOKEN_2022_BLOCKED_ACCOUNT_EXTENSIONS = Object.freeze(new Set([
  'TransferFeeAmount', 'ConfidentialTransferAccount', 'MemoTransfer', 'NonTransferableAccount',
  'CpiGuard', 'TransferHookAccount', 'ConfidentialTransferFeeAmount', 'PausableAccount'
]));

// Token-2022 is intentionally fail-closed. New or merely non-blocklisted extensions must not
// silently become recovery-compatible. At this stage, no mint extension has an execution proof.
// ImmutableOwner is the sole account-extension exception because canonical Token-2022 ATAs
// initialize it automatically and it only prevents AccountOwner authority changes.
const SOLANA_TOKEN_2022_ALLOWED_MINT_EXTENSIONS = Object.freeze(new Set());
const SOLANA_TOKEN_2022_ALLOWED_ACCOUNT_EXTENSIONS = Object.freeze(new Set(['ImmutableOwner']));

function normalizeExtensionNames(value, label) {
  if (!Array.isArray(value) || value.some(x => typeof x !== 'string' || x.length === 0)) throw new TypeError(`${label} must be an array of extension names.`);
  return Object.freeze([...new Set(value)]);
}

function accountBytes(value, label) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError(`${label} must be a Buffer or Uint8Array.`);
  }
  return Buffer.from(value);
}

function canonicalPubkey(value, label) {
  try {
    const bytes = Buffer.from(bs58.decode(value));
    if (bytes.length !== 32 || bs58.encode(bytes) !== value) throw new Error('non-canonical');
    return value;
  } catch {
    throw new TypeError(`${label} must be a canonical 32-byte Solana public key.`);
  }
}

function digestRecord(record) {
  return createHash('sha256').update(JSON.stringify(record, (_key, value) => typeof value === 'bigint' ? { $bigint: value.toString() } : value)).digest('hex');
}

function assertRecordDigest(record, digestField, label) {
  if (record == null || typeof record !== 'object' || !/^[0-9a-f]{64}$/.test(record[digestField] ?? '')) {
    throw new Error(`${label} is missing its integrity digest.`);
  }
  const payload = Object.fromEntries(Object.entries(record).filter(([key]) => key !== digestField));
  if (digestRecord(payload) !== record[digestField]) throw new Error(`${label} integrity digest does not match its contents.`);
}

function unpackCOptionTag(bytes, offset, label) {
  const tag = bytes.readUInt32LE(offset);
  if (tag !== 0 && tag !== 1) throw new Error(`${label} has an invalid COption tag.`);
  return tag === 1;
}

export function parseSolanaTokenMintBase({ data }) {
  const bytes = accountBytes(data, 'data');
  if (bytes.length < SOLANA_TOKEN_MINT_BASE_BYTES) throw new Error('Solana token mint data is truncated.');
  unpackCOptionTag(bytes, 0, 'mintAuthority');
  unpackCOptionTag(bytes, 46, 'freezeAuthority');
  if (bytes[45] !== 1) throw new Error('Solana token mint is not initialized.');
  return Object.freeze({
    supply: bytes.readBigUInt64LE(36),
    decimals: bytes[44],
    isInitialized: true
  });
}

export function parseSolanaTokenAccountBase({ data }) {
  const bytes = accountBytes(data, 'data');
  if (bytes.length < SOLANA_TOKEN_ACCOUNT_BASE_BYTES) throw new Error('Solana token account data is truncated.');
  unpackCOptionTag(bytes, 72, 'delegate');
  unpackCOptionTag(bytes, 109, 'isNative');
  unpackCOptionTag(bytes, 129, 'closeAuthority');
  const state = bytes[108];
  if (state !== 1 && state !== 2) throw new Error('Solana token account is not initialized or has an invalid state.');
  return Object.freeze({
    mint: bs58.encode(bytes.subarray(0, 32)),
    owner: bs58.encode(bytes.subarray(32, 64)),
    amount: bytes.readBigUInt64LE(64),
    state: state === 2 ? 'frozen' : 'initialized',
    isFrozen: state === 2
  });
}

export function parseSolanaToken2022Extensions({ data, accountKind }) {
  if (!Object.hasOwn(SOLANA_TOKEN_2022_ACCOUNT_TYPE, accountKind)) {
    throw new TypeError('accountKind must be mint or account.');
  }
  const bytes = accountBytes(data, 'data');
  const baseBytes = accountKind === 'mint' ? SOLANA_TOKEN_MINT_BASE_BYTES : SOLANA_TOKEN_ACCOUNT_BASE_BYTES;
  if (bytes.length === baseBytes) {
    return Object.freeze({ accountKind, extensionTypes: Object.freeze([]), extensionNames: Object.freeze([]), unknownExtensionTypes: Object.freeze([]) });
  }
  if (bytes.length < SOLANA_TOKEN_2022_TLV_OFFSET) {
    throw new Error('Extended Token-2022 account data is truncated before its account-type/TLV region.');
  }
  if (accountKind === 'mint' && bytes.subarray(SOLANA_TOKEN_MINT_BASE_BYTES, SOLANA_TOKEN_ACCOUNT_BASE_BYTES).some(byte => byte !== 0)) {
    throw new Error('Token-2022 mint padding is non-zero.');
  }
  if (bytes[SOLANA_TOKEN_2022_ACCOUNT_TYPE_OFFSET] !== SOLANA_TOKEN_2022_ACCOUNT_TYPE[accountKind]) {
    throw new Error('Token-2022 account-type discriminator does not match the expected account kind.');
  }

  const extensionTypes = [];
  const extensionNames = [];
  const unknownExtensionTypes = [];
  const seen = new Set();
  let offset = SOLANA_TOKEN_2022_TLV_OFFSET;
  while (offset < bytes.length) {
    if (bytes.length - offset < 4) throw new Error('Token-2022 TLV header is truncated.');
    const extensionType = bytes.readUInt16LE(offset);
    const extensionLength = bytes.readUInt16LE(offset + 2);
    offset += 4;
    if (extensionType === 0) {
      if (extensionLength !== 0 || bytes.subarray(offset).some(byte => byte !== 0)) {
        throw new Error('Token-2022 TLV padding is malformed.');
      }
      offset = bytes.length;
      break;
    }
    if (seen.has(extensionType)) throw new Error('Token-2022 account contains a duplicate extension type.');
    seen.add(extensionType);
    const end = offset + extensionLength;
    if (!Number.isSafeInteger(end) || end > bytes.length) throw new Error('Token-2022 TLV value is truncated.');
    const name = SOLANA_TOKEN_2022_EXTENSION_NAMES.get(extensionType);
    extensionTypes.push(extensionType);
    extensionNames.push(name ?? `UnknownExtension(${extensionType})`);
    if (name == null) unknownExtensionTypes.push(extensionType);
    offset = end;
  }
  return Object.freeze({
    accountKind,
    extensionTypes: Object.freeze(extensionTypes),
    extensionNames: Object.freeze(extensionNames),
    unknownExtensionTypes: Object.freeze(unknownExtensionTypes)
  });
}

export function createSolanaToken2022SafetyAssessment({ tokenProgramId, mintDecimals, checkedDecimals, sourceAmount, transferAmount, mintExtensions = [], sourceExtensions = [], destinationExtensions = [], sourceFrozen = false, destinationFrozen = false, destinationIsCanonicalAta = false, destinationAddressPolicy = 'associated-token-account' }) {
  assertPubkey(tokenProgramId, 'tokenProgramId');
  if (![SOLANA_TOKEN_PROGRAM_ID, SOLANA_TOKEN_2022_PROGRAM_ID].includes(tokenProgramId)) throw new TypeError('Unsupported Solana token program.');
  if (!Number.isInteger(mintDecimals) || mintDecimals < 0 || mintDecimals > 255 || !Number.isInteger(checkedDecimals) || checkedDecimals < 0 || checkedDecimals > 255) throw new TypeError('mintDecimals and checkedDecimals must be byte integers.');
  if (typeof sourceAmount !== 'bigint' || sourceAmount < 0n || typeof transferAmount !== 'bigint' || transferAmount <= 0n) throw new TypeError('sourceAmount/transferAmount must be bigint base-unit amounts.');
  const mintExt = normalizeExtensionNames(mintExtensions, 'mintExtensions');
  const sourceExt = normalizeExtensionNames(sourceExtensions, 'sourceExtensions');
  const destinationExt = normalizeExtensionNames(destinationExtensions, 'destinationExtensions');
  const unsupportedExtensions = tokenProgramId === SOLANA_TOKEN_2022_PROGRAM_ID
    ? [
        ...mintExt.filter(x => !SOLANA_TOKEN_2022_ALLOWED_MINT_EXTENSIONS.has(x)),
        ...sourceExt.filter(x => !SOLANA_TOKEN_2022_ALLOWED_ACCOUNT_EXTENSIONS.has(x)),
        ...destinationExt.filter(x => !SOLANA_TOKEN_2022_ALLOWED_ACCOUNT_EXTENSIONS.has(x))
      ]
    : [...mintExt, ...sourceExt, ...destinationExt];
  const knownBlockedExtensions = tokenProgramId === SOLANA_TOKEN_2022_PROGRAM_ID
    ? [
        ...mintExt.filter(x => SOLANA_TOKEN_2022_BLOCKED_MINT_EXTENSIONS.has(x)),
        ...sourceExt.filter(x => SOLANA_TOKEN_2022_BLOCKED_ACCOUNT_EXTENSIONS.has(x)),
        ...destinationExt.filter(x => SOLANA_TOKEN_2022_BLOCKED_ACCOUNT_EXTENSIONS.has(x))
      ]
    : unsupportedExtensions;
  const checks = Object.freeze({
    checkedDecimalsMatchMint: checkedDecimals === mintDecimals,
    amountWithinSourceBalance: transferAmount <= sourceAmount,
    sourceNotFrozen: sourceFrozen === false,
    destinationNotFrozen: destinationFrozen === false,
    canonicalRescueAta: destinationAddressPolicy === 'associated-token-account' && destinationIsCanonicalAta === true,
    noUnsupportedExtensions: unsupportedExtensions.length === 0
  });
  return Object.freeze({
    ok: Object.values(checks).every(Boolean), checks, tokenProgramId, mintDecimals, transferAmount,
    blockedExtensions: Object.freeze(unsupportedExtensions),
    knownBlockedExtensions: Object.freeze(knownBlockedExtensions),
    allowedExtensions: Object.freeze(tokenProgramId === SOLANA_TOKEN_2022_PROGRAM_ID ? Object.freeze({ mint: Object.freeze([...SOLANA_TOKEN_2022_ALLOWED_MINT_EXTENSIONS]), account: Object.freeze([...SOLANA_TOKEN_2022_ALLOWED_ACCOUNT_EXTENSIONS]) }) : Object.freeze({ mint: Object.freeze([]), account: Object.freeze([]) })),
    transferInstruction: 'TransferChecked',
    policy: 'fail-closed: only independently reviewed Token-2022 extension combinations are allowed; all unknown or unreviewed extensions are rejected before execution'
  });
}

export function createSolanaTokenSafetyAssessmentFromAccountData({ tokenProgramId, mintAddress, sourceAccountAddress, destinationAccountAddress, expectedSourceAuthority, expectedDestinationAuthority, mintData, sourceAccountData, destinationAccountData, ...assessment }) {
  assertPubkey(tokenProgramId, 'tokenProgramId');
  canonicalPubkey(mintAddress, 'mintAddress');
  canonicalPubkey(sourceAccountAddress, 'sourceAccountAddress');
  canonicalPubkey(destinationAccountAddress, 'destinationAccountAddress');
  canonicalPubkey(expectedSourceAuthority, 'expectedSourceAuthority');
  canonicalPubkey(expectedDestinationAuthority, 'expectedDestinationAuthority');
  const mintBytes = accountBytes(mintData, 'mintData');
  const sourceBytes = accountBytes(sourceAccountData, 'sourceAccountData');
  const destinationBytes = accountBytes(destinationAccountData, 'destinationAccountData');
  const mintBase = parseSolanaTokenMintBase({ data: mintBytes });
  const sourceBase = parseSolanaTokenAccountBase({ data: sourceBytes });
  const destinationBase = parseSolanaTokenAccountBase({ data: destinationBytes });
  const canonicalDestination = deriveSolanaAssociatedTokenAddress({ owner: expectedDestinationAuthority, mint: mintAddress, tokenProgramId });
  const identityChecks = Object.freeze({
    sourceMintMatches: sourceBase.mint === mintAddress,
    destinationMintMatches: destinationBase.mint === mintAddress,
    sourceAuthorityMatches: sourceBase.owner === expectedSourceAuthority,
    destinationAuthorityMatches: destinationBase.owner === expectedDestinationAuthority,
    canonicalRescueAta: destinationAccountAddress === canonicalDestination.address
  });
  if (tokenProgramId === SOLANA_TOKEN_PROGRAM_ID) {
    if (mintBytes.length !== SOLANA_TOKEN_MINT_BASE_BYTES || sourceBytes.length !== SOLANA_TOKEN_ACCOUNT_BASE_BYTES || destinationBytes.length !== SOLANA_TOKEN_ACCOUNT_BASE_BYTES) {
      throw new Error('Legacy SPL Token accounts must use the exact base mint/account layouts.');
    }
  } else if (tokenProgramId !== SOLANA_TOKEN_2022_PROGRAM_ID) {
    throw new TypeError('Unsupported Solana token program.');
  }
  const mint = tokenProgramId === SOLANA_TOKEN_2022_PROGRAM_ID ? parseSolanaToken2022Extensions({ data: mintBytes, accountKind: 'mint' }) : { extensionNames: [] };
  const source = tokenProgramId === SOLANA_TOKEN_2022_PROGRAM_ID ? parseSolanaToken2022Extensions({ data: sourceBytes, accountKind: 'account' }) : { extensionNames: [] };
  const destination = tokenProgramId === SOLANA_TOKEN_2022_PROGRAM_ID ? parseSolanaToken2022Extensions({ data: destinationBytes, accountKind: 'account' }) : { extensionNames: [] };
  const baseAssessment = createSolanaToken2022SafetyAssessment({
    tokenProgramId,
    ...assessment,
    mintDecimals: mintBase.decimals,
    sourceAmount: sourceBase.amount,
    sourceFrozen: sourceBase.isFrozen,
    destinationFrozen: destinationBase.isFrozen,
    destinationAddressPolicy: 'associated-token-account',
    destinationIsCanonicalAta: identityChecks.canonicalRescueAta,
    mintExtensions: mint.extensionNames,
    sourceExtensions: source.extensionNames,
    destinationExtensions: destination.extensionNames
  });
  const checks = Object.freeze({ ...baseAssessment.checks, ...identityChecks });
  const result = Object.freeze({
    ...baseAssessment,
    ok: Object.values(checks).every(Boolean),
    checks,
    decodedAccountData: Object.freeze({
      mint: mintBase,
      source: Object.freeze({ ...sourceBase, address: sourceAccountAddress }),
      destination: Object.freeze({ ...destinationBase, address: destinationAccountAddress, canonicalBump: canonicalDestination.bump })
    })
  });
  return Object.freeze({ ...result, assessmentDigest: digestRecord(result) });
}

export function createSolanaRescueAtaCreationPlan({ payer, rescueOwner, mintAccount, tokenProgramId, destinationTokenAccount }) {
  const payerKey = canonicalPubkey(payer, 'payer');
  const owner = canonicalPubkey(rescueOwner, 'rescueOwner');
  const mint = canonicalPubkey(mintAccount, 'mintAccount');
  const programId = canonicalPubkey(tokenProgramId, 'tokenProgramId');
  const destination = canonicalPubkey(destinationTokenAccount, 'destinationTokenAccount');
  if (![SOLANA_TOKEN_PROGRAM_ID, SOLANA_TOKEN_2022_PROGRAM_ID].includes(programId)) {
    throw new TypeError('Unsupported Solana token program.');
  }
  const derived = deriveSolanaAssociatedTokenAddress({ owner, mint, tokenProgramId: programId });
  if (destination !== derived.address) {
    throw new Error('Destination token account is not the canonical associated token account for the rescue owner, mint, and token program.');
  }
  const instruction = Object.freeze({
    programId: SOLANA_ASSOCIATED_TOKEN_PROGRAM_ID,
    dataHex: '01',
    instruction: 'CreateIdempotent',
    keys: Object.freeze([
      Object.freeze({ pubkey: payerKey, isSigner: true, isWritable: true }),
      Object.freeze({ pubkey: destination, isSigner: false, isWritable: true }),
      Object.freeze({ pubkey: owner, isSigner: false, isWritable: false }),
      Object.freeze({ pubkey: mint, isSigner: false, isWritable: false }),
      Object.freeze({ pubkey: SOLANA_SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }),
      Object.freeze({ pubkey: programId, isSigner: false, isWritable: false })
    ])
  });
  const intent = Object.freeze({
    instruction,
    associatedTokenAccount: destination,
    associatedTokenAccountBump: derived.bump,
    tokenProgramId: programId,
    funding: Object.freeze({
      payer: payerKey,
      payerMustSign: true,
      rescueOwnerMustSign: false,
      rentLamportsInput: null,
      policy: 'Associated Token Program computes rent exemption at execution; preflight payer balance from current cluster state.'
    }),
    expectedDestinationExtensions: Object.freeze(programId === SOLANA_TOKEN_2022_PROGRAM_ID ? ['ImmutableOwner'] : []),
    postCreationGate: Object.freeze({
      mustRefetchAccountData: true,
      mustPassRawSafetyAssessment: true,
      transferPlanBlockedUntilVerified: true
    })
  });
  return Object.freeze({
    ...intent,
    intentDigest: digestRecord(intent)
  });
}

export function createSolanaTransferCheckedInstructionPlan({ assessment, sourceTokenAccount, mintAccount, destinationTokenAccount, custodyAuthority }) {
  if (assessment == null || typeof assessment !== 'object' || assessment.ok !== true || assessment.decodedAccountData == null) {
    throw new Error('A passing raw-account Solana token safety assessment is required.');
  }
  assertRecordDigest(assessment, 'assessmentDigest', 'Solana token safety assessment');
  const programId = canonicalPubkey(assessment.tokenProgramId, 'assessment.tokenProgramId');
  if (![SOLANA_TOKEN_PROGRAM_ID, SOLANA_TOKEN_2022_PROGRAM_ID].includes(programId)) throw new TypeError('Unsupported Solana token program.');
  const source = canonicalPubkey(sourceTokenAccount, 'sourceTokenAccount');
  const mint = canonicalPubkey(mintAccount, 'mintAccount');
  const destination = canonicalPubkey(destinationTokenAccount, 'destinationTokenAccount');
  const authority = canonicalPubkey(custodyAuthority, 'custodyAuthority');
  const decoded = assessment.decodedAccountData;
  if (decoded.source.address !== source || decoded.destination.address !== destination) throw new Error('Instruction token-account addresses do not match the assessed accounts.');
  if (decoded.source.mint !== mint || decoded.destination.mint !== mint) throw new Error('Instruction mint does not match the assessed token accounts.');
  if (decoded.source.owner !== authority) throw new Error('Custody authority does not match the assessed source owner.');
  if (typeof assessment.transferAmount !== 'bigint' || assessment.transferAmount <= 0n || assessment.transferAmount > 0xffffffffffffffffn) {
    throw new TypeError('TransferChecked amount must fit an unsigned 64-bit integer.');
  }
  if (!Number.isInteger(assessment.mintDecimals) || assessment.mintDecimals < 0 || assessment.mintDecimals > 255) {
    throw new TypeError('TransferChecked decimals must fit an unsigned byte.');
  }
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(assessment.transferAmount, 1);
  data[9] = assessment.mintDecimals;
  const intent = Object.freeze({
    programId,
    dataHex: data.toString('hex'),
    keys: Object.freeze([
      Object.freeze({ pubkey: source, isSigner: false, isWritable: true }),
      Object.freeze({ pubkey: mint, isSigner: false, isWritable: false }),
      Object.freeze({ pubkey: destination, isSigner: false, isWritable: true }),
      Object.freeze({ pubkey: authority, isSigner: true, isWritable: false })
    ]),
    authorityMode: 'pda-invoke-signed',
    amount: assessment.transferAmount.toString(),
    decimals: assessment.mintDecimals
  });
  return Object.freeze({
    ...intent,
    intentDigest: digestRecord(intent)
  });
}

export function createSolanaTokenRecoveryPhasePlan({ ataCreationPlan, assessment = null, creationFinalizedSlot = null, assessmentContextSlot = null }) {
  assertRecordDigest(ataCreationPlan, 'intentDigest', 'Solana rescue ATA creation plan');
  const instruction = ataCreationPlan.instruction;
  if (instruction?.programId !== SOLANA_ASSOCIATED_TOKEN_PROGRAM_ID || instruction?.instruction !== 'CreateIdempotent' || instruction?.dataHex !== '01' || instruction?.keys?.length !== 6) {
    throw new Error('Solana rescue ATA creation plan does not contain the canonical CreateIdempotent instruction shape.');
  }
  const [payer, destination, rescueOwner, mint, systemProgram, tokenProgram] = instruction.keys;
  if (payer.isSigner !== true || payer.isWritable !== true || destination.pubkey !== ataCreationPlan.associatedTokenAccount || destination.isWritable !== true || rescueOwner.isSigner !== false || mint.isSigner !== false || systemProgram.pubkey !== SOLANA_SYSTEM_PROGRAM_ID || tokenProgram.pubkey !== ataCreationPlan.tokenProgramId) {
    throw new Error('Solana rescue ATA creation plan account roles do not match the frozen intent.');
  }
  if (assessment == null) {
    const intent = Object.freeze({
      phase: 'create-and-verify-rescue-ata',
      readyForTransfer: false,
      creationIntentDigest: ataCreationPlan.intentDigest,
      instructions: Object.freeze([instruction]),
      confirmationPolicy: Object.freeze({ creationCommitment: 'finalized', accountReadCommitment: 'finalized', accountReadMinContextSlot: 'creationFinalizedSlot' }),
      requiredNextEvidence: Object.freeze(['finalized creation result', 'refetched destination account bytes', 'passing digest-bound raw safety assessment'])
    });
    return Object.freeze({ ...intent, intentDigest: digestRecord(intent) });
  }
  if (assessment.ok !== true || assessment.decodedAccountData == null) throw new Error('A passing raw-account Solana token safety assessment is required for the transfer phase.');
  if (!Number.isSafeInteger(creationFinalizedSlot) || creationFinalizedSlot < 0 || !Number.isSafeInteger(assessmentContextSlot) || assessmentContextSlot < creationFinalizedSlot) {
    throw new Error('Transfer phase requires a finalized creation slot and a non-stale finalized account-read context slot.');
  }
  const decoded = assessment.decodedAccountData;
  if (assessment.tokenProgramId !== tokenProgram.pubkey || decoded.destination.address !== destination.pubkey || decoded.destination.owner !== rescueOwner.pubkey || decoded.destination.mint !== mint.pubkey || decoded.source.mint !== mint.pubkey || assessment.checks?.canonicalRescueAta !== true) {
    throw new Error('Post-creation assessment does not match the frozen ATA creation intent.');
  }
  const transfer = createSolanaTransferCheckedInstructionPlan({
    assessment,
    sourceTokenAccount: decoded.source.address,
    mintAccount: mint.pubkey,
    destinationTokenAccount: destination.pubkey,
    custodyAuthority: decoded.source.owner
  });
  const intent = Object.freeze({
    phase: 'transfer-verified-token-balance',
    readyForTransfer: true,
    creationIntentDigest: ataCreationPlan.intentDigest,
    assessmentDigest: assessment.assessmentDigest,
    transferIntentDigest: transfer.intentDigest,
    creationFinalizedSlot,
    assessmentContextSlot,
    instructions: Object.freeze([transfer])
  });
  return Object.freeze({ ...intent, intentDigest: digestRecord(intent) });
}

function assertPubkey(value, label) {
  if (typeof value !== 'string' || !BASE58.test(value)) throw new TypeError(`${label} must be a Solana base58 public key.`);
  return value;
}

function assertUnix(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe-integer unix timestamp.`);
  return value;
}

export function createSolanaVaultState({ version = 1, vaultId, owner, rescueDestination, contacts, threshold, inactivitySeconds, createdAtUnix }) {
  if (!Number.isInteger(version) || version < 1 || version > 255) throw new TypeError('version must be 1-255.');
  if (typeof vaultId !== 'string' || vaultId.length < 1 || Buffer.byteLength(vaultId, 'utf8') > 32) throw new TypeError('vaultId must encode to 1-32 bytes so it is valid as a PDA seed.');
  assertPubkey(owner, 'owner'); assertPubkey(rescueDestination, 'rescueDestination');
  if (owner === rescueDestination) throw new TypeError('owner and rescueDestination must differ.');
  if (!Array.isArray(contacts) || contacts.length < 1 || contacts.length > 16) throw new TypeError('contacts must contain 1-16 public keys.');
  const normalized = contacts.map((key, i) => assertPubkey(key, `contacts[${i}]`));
  if (new Set(normalized).size !== normalized.length) throw new TypeError('contacts must be unique.');
  if (normalized.includes(owner)) throw new TypeError('owner cannot also be a trusted contact.');
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > normalized.length) throw new TypeError('threshold must be reachable.');
  if (!Number.isInteger(inactivitySeconds) || inactivitySeconds < 1) throw new TypeError('inactivitySeconds must be positive.');
  assertUnix(createdAtUnix, 'createdAtUnix');
  return Object.freeze({
    version, vaultId, owner, rescueDestination, contacts: Object.freeze(normalized), threshold, inactivitySeconds,
    lastHeartbeatUnix: createdAtUnix, approvals: Object.freeze([]), recovered: false, recoveryExecutedAtUnix: null
  });
}

export function solanaRecoveryEligible(state, nowUnix) {
  assertUnix(nowUnix, 'nowUnix');
  return !state.recovered && nowUnix >= state.lastHeartbeatUnix + state.inactivitySeconds;
}

export function heartbeatSolanaVault(state, { signer, nowUnix }) {
  assertPubkey(signer, 'signer'); assertUnix(nowUnix, 'nowUnix');
  if (state.recovered) throw new Error('Recovered vault cannot heartbeat.');
  if (signer !== state.owner) throw new Error('Only the configured owner may heartbeat.');
  if (nowUnix < state.lastHeartbeatUnix) throw new Error('Heartbeat time cannot move backwards.');
  return Object.freeze({ ...state, lastHeartbeatUnix: nowUnix, approvals: Object.freeze([]) });
}

export function approveSolanaRecovery(state, { signer, nowUnix }) {
  assertPubkey(signer, 'signer'); assertUnix(nowUnix, 'nowUnix');
  if (state.recovered) throw new Error('Vault is already recovered.');
  if (!solanaRecoveryEligible(state, nowUnix)) throw new Error('Recovery inactivity period has not elapsed.');
  if (!state.contacts.includes(signer)) throw new Error('Signer is not a configured trusted contact.');
  if (state.approvals.includes(signer)) return state;
  return Object.freeze({ ...state, approvals: Object.freeze([...state.approvals, signer]) });
}

export function executeSolanaRecovery(state, { nowUnix }) {
  assertUnix(nowUnix, 'nowUnix');
  if (state.recovered) throw new Error('Vault is already recovered.');
  if (!solanaRecoveryEligible(state, nowUnix)) throw new Error('Recovery inactivity period has not elapsed.');
  if (state.approvals.length < state.threshold) throw new Error('Recovery threshold has not been reached.');
  return Object.freeze({ ...state, recovered: true, recoveryExecutedAtUnix: nowUnix });
}

export function createSolanaPdaPlan({ programId, owner, vaultId }) {
  assertPubkey(programId, 'programId'); assertPubkey(owner, 'owner');
  if (typeof vaultId !== 'string' || vaultId.length < 1 || Buffer.byteLength(vaultId, 'utf8') > 32) throw new TypeError('vaultId must encode to 1-32 bytes so it is valid as a PDA seed.');
  return Object.freeze({
    programId,
    statePdaSeeds: Object.freeze(['omegavault-state', owner, vaultId]),
    custodyPdaSeeds: Object.freeze(['omegavault-custody', owner, vaultId]),
    derivation: 'findProgramAddress/canonical bump; resulting PDAs have no private keys',
    custody: Object.freeze({
      nativeSol: 'program-controlled custody PDA lamports',
      spl: 'token accounts whose authority is the custody PDA'
    })
  });
}

export function normalizeSolanaTokenAsset({ mint, tokenProgramId }) {
  assertPubkey(mint, 'mint'); assertPubkey(tokenProgramId, 'tokenProgramId');
  if (![SOLANA_TOKEN_PROGRAM_ID, SOLANA_TOKEN_2022_PROGRAM_ID].includes(tokenProgramId)) {
    throw new TypeError('Unsupported Solana token program; Token Program or Token-2022 must be explicit.');
  }
  return Object.freeze({
    chainId: 'solana', networkRef: 'solana:devnet', kind: tokenProgramId === SOLANA_TOKEN_2022_PROGRAM_ID ? 'token-2022' : 'spl-token', mint, tokenProgramId,
    identity: `solana:devnet:${tokenProgramId}:${mint}`
  });
}

export function createSolanaTokenRecoveryPreflight({ asset, sourceTokenAccount, rescueTokenAccount, sourceOwner, rescueOwner, sourceMint, destinationMint, sourceProgramId, destinationProgramId, sourceAccountKind = 'token-account', destinationAccountKind = 'token-account', expectedSourceAuthority = null, expectedRescueAuthority = null }) {
  assertPubkey(sourceTokenAccount, 'sourceTokenAccount'); assertPubkey(rescueTokenAccount, 'rescueTokenAccount');
  assertPubkey(sourceOwner, 'sourceOwner'); assertPubkey(rescueOwner, 'rescueOwner');
  assertPubkey(sourceMint, 'sourceMint'); assertPubkey(destinationMint, 'destinationMint');
  assertPubkey(sourceProgramId, 'sourceProgramId'); assertPubkey(destinationProgramId, 'destinationProgramId');
  const normalized = normalizeSolanaTokenAsset(asset);
  if (expectedSourceAuthority != null) assertPubkey(expectedSourceAuthority, 'expectedSourceAuthority');
  if (expectedRescueAuthority != null) assertPubkey(expectedRescueAuthority, 'expectedRescueAuthority');
  const checks = Object.freeze({
    sourceIsTokenAccount: sourceAccountKind === 'token-account',
    destinationIsTokenAccount: destinationAccountKind === 'token-account',
    sourceMintMatches: sourceMint === normalized.mint,
    destinationMintMatches: destinationMint === normalized.mint,
    sourceProgramMatches: sourceProgramId === normalized.tokenProgramId,
    destinationProgramMatches: destinationProgramId === normalized.tokenProgramId,
    sourceControlledByExpectedAuthority: expectedSourceAuthority == null ? sourceOwner.length > 0 : sourceOwner === expectedSourceAuthority,
    destinationControlledByRescue: expectedRescueAuthority == null ? rescueOwner.length > 0 : rescueOwner === expectedRescueAuthority
  });
  return Object.freeze({ ok: Object.values(checks).every(Boolean), checks, asset: normalized, sourceTokenAccount, rescueTokenAccount });
}

export function createSolanaTransactionLifetimePlan({ mode = 'recent-blockhash', feePayer, blockhash = null, lastValidBlockHeight = null, nonceAccount = null, nonceAuthority = null }) {
  assertPubkey(feePayer, 'feePayer');
  if (mode === 'recent-blockhash') {
    if (typeof blockhash !== 'string' || blockhash.length === 0) throw new TypeError('recent-blockhash mode requires blockhash.');
    if (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight < 1) throw new TypeError('recent-blockhash mode requires lastValidBlockHeight.');
    return Object.freeze({ mode, feePayer, blockhash, lastValidBlockHeight, rebuildOnExpiry: true, signaturesInvalidatedByMessageChange: true });
  }
  if (mode === 'durable-nonce') {
    assertPubkey(nonceAccount, 'nonceAccount'); assertPubkey(nonceAuthority, 'nonceAuthority');
    return Object.freeze({ mode, feePayer, nonceAccount, nonceAuthority, nonceMustRemainUnconsumed: true, signaturesInvalidatedIfNonceAdvances: true });
  }
  throw new TypeError('mode must be recent-blockhash or durable-nonce.');
}

export function createSolanaProgramVerificationPlan({ programId }) {
  assertPubkey(programId, 'programId');
  return Object.freeze({
    programId,
    requiredChecks: Object.freeze([
      'program account executable',
      'program-data account relationship verified when upgradeable loader is used',
      'deployed program bytecode/build provenance matches the released artifact',
      'upgrade authority matches declared policy',
      'production target has upgrade authority revoked or governed by an explicitly audited upgrade policy',
      'vault state PDA owner equals the verified OmegaVault program id'
    ]),
    productionPreference: 'immutable program after audit unless a separately reviewed governance policy explicitly requires upgrades'
  });
}
