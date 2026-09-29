export const SOLANA_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const SOLANA_TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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
