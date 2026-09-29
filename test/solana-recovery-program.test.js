import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {
  SOLANA_TOKEN_PROGRAM_ID, SOLANA_TOKEN_2022_PROGRAM_ID,
  createSolanaVaultState, heartbeatSolanaVault, approveSolanaRecovery, executeSolanaRecovery,
  solanaRecoveryEligible, createSolanaPdaPlan, normalizeSolanaTokenAsset,
  createSolanaTokenRecoveryPreflight, createSolanaToken2022SafetyAssessment,
  createSolanaTokenSafetyAssessmentFromAccountData, parseSolanaToken2022Extensions,
  parseSolanaTokenMintBase, parseSolanaTokenAccountBase,
  createSolanaRescueAtaCreationPlan, createSolanaTransferCheckedInstructionPlan,
  createSolanaTokenRecoveryPhasePlan,
  SOLANA_SYSTEM_PROGRAM_ID,
  SOLANA_TOKEN_MINT_BASE_BYTES, SOLANA_TOKEN_ACCOUNT_BASE_BYTES,
  createSolanaTransactionLifetimePlan, createSolanaProgramVerificationPlan
} from '../src/chains/solana/recovery-program.js';
import { deriveSolanaAssociatedTokenAddress, SOLANA_ASSOCIATED_TOKEN_PROGRAM_ID } from '../src/chains/solana/program-codec.js';

const key = n => `${String(n).repeat(32)}`;
const owner = key(1), rescue = key(2), a = key(3), b = key(4), program = key(5), mint = key(6), sourceAta = key(7), rescueAta = key(8);

test('Solana program model enforces inactivity, trusted contacts, duplicate prevention and threshold', () => {
  let state = createSolanaVaultState({ vaultId: 'v1', owner, rescueDestination: rescue, contacts: [a, b], threshold: 2, inactivitySeconds: 60, createdAtUnix: 1000 });
  assert.equal(solanaRecoveryEligible(state, 1059), false);
  assert.throws(() => approveSolanaRecovery(state, { signer: a, nowUnix: 1059 }), /inactivity/);
  state = approveSolanaRecovery(state, { signer: a, nowUnix: 1060 });
  const duplicate = approveSolanaRecovery(state, { signer: a, nowUnix: 1061 });
  assert.equal(duplicate.approvals.length, 1);
  assert.throws(() => executeSolanaRecovery(state, { nowUnix: 1061 }), /threshold/);
  state = approveSolanaRecovery(state, { signer: b, nowUnix: 1061 });
  state = executeSolanaRecovery(state, { nowUnix: 1062 });
  assert.equal(state.recovered, true);
  assert.throws(() => heartbeatSolanaVault(state, { signer: owner, nowUnix: 1063 }), /Recovered/);
});

test('Solana owner heartbeat resets approvals and liveness without changing rescue destination', () => {
  let state = createSolanaVaultState({ vaultId: 'v1', owner, rescueDestination: rescue, contacts: [a, b], threshold: 2, inactivitySeconds: 60, createdAtUnix: 1000 });
  state = approveSolanaRecovery(state, { signer: a, nowUnix: 1060 });
  state = heartbeatSolanaVault(state, { signer: owner, nowUnix: 1061 });
  assert.deepEqual(state.approvals, []);
  assert.equal(state.lastHeartbeatUnix, 1061);
  assert.equal(state.rescueDestination, rescue);
  assert.equal(solanaRecoveryEligible(state, 1120), false);
});

test('Solana PDA plan separates state from custody and relies on program signing rather than a private key', () => {
  const plan = createSolanaPdaPlan({ programId: program, owner, vaultId: 'abc' });
  assert.match(plan.derivation, /no private keys/);
  assert.notDeepEqual(plan.statePdaSeeds, plan.custodyPdaSeeds);
});

test('Solana token identity binds mint and token program and token preflight rejects cross-program mismatch', () => {
  const asset = normalizeSolanaTokenAsset({ mint, tokenProgramId: SOLANA_TOKEN_2022_PROGRAM_ID });
  assert.match(asset.identity, /TokenzQd/);
  const good = createSolanaTokenRecoveryPreflight({ asset, sourceTokenAccount: sourceAta, rescueTokenAccount: rescueAta, sourceOwner: program, rescueOwner: rescue, sourceMint: mint, destinationMint: mint, sourceProgramId: SOLANA_TOKEN_2022_PROGRAM_ID, destinationProgramId: SOLANA_TOKEN_2022_PROGRAM_ID });
  assert.equal(good.ok, true);
  const bad = createSolanaTokenRecoveryPreflight({ asset, sourceTokenAccount: sourceAta, rescueTokenAccount: rescueAta, sourceOwner: program, rescueOwner: rescue, sourceMint: mint, destinationMint: mint, sourceProgramId: SOLANA_TOKEN_PROGRAM_ID, destinationProgramId: SOLANA_TOKEN_2022_PROGRAM_ID });
  assert.equal(bad.ok, false);
});

test('Solana transaction-lifetime plan freezes fee payer before signatures and models blockhash/nonce invalidation', () => {
  const recent = createSolanaTransactionLifetimePlan({ feePayer: owner, blockhash: 'abc', lastValidBlockHeight: 123 });
  assert.equal(recent.rebuildOnExpiry, true);
  const nonce = createSolanaTransactionLifetimePlan({ mode: 'durable-nonce', feePayer: owner, nonceAccount: a, nonceAuthority: b });
  assert.equal(nonce.signaturesInvalidatedIfNonceAdvances, true);
});

test('Solana deployment verification plan includes upgrade authority and bytecode provenance gates', () => {
  const plan = createSolanaProgramVerificationPlan({ programId: program });
  assert.ok(plan.requiredChecks.some(x => /upgrade authority/i.test(x)));
  assert.ok(plan.requiredChecks.some(x => /bytecode\/build provenance/i.test(x)));
});


test('Solana PDA plan rejects seed components over the protocol 32-byte limit', () => {
  assert.throws(() => createSolanaPdaPlan({ programId: program, owner, vaultId: 'x'.repeat(33) }), /1-32 bytes/);
  assert.throws(() => createSolanaVaultState({ vaultId: 'é'.repeat(17), owner, rescueDestination: rescue, contacts: [a], threshold: 1, inactivitySeconds: 60, createdAtUnix: 1000 }), /1-32 bytes/);
});

test('Solana token preflight rejects mint accounts and mismatched expected authorities', () => {
  const asset = normalizeSolanaTokenAsset({ mint, tokenProgramId: SOLANA_TOKEN_PROGRAM_ID });
  const mintAsDestination = createSolanaTokenRecoveryPreflight({ asset, sourceTokenAccount: sourceAta, rescueTokenAccount: rescueAta, sourceOwner: program, rescueOwner: rescue, sourceMint: mint, destinationMint: mint, sourceProgramId: SOLANA_TOKEN_PROGRAM_ID, destinationProgramId: SOLANA_TOKEN_PROGRAM_ID, destinationAccountKind: 'mint', expectedSourceAuthority: program, expectedRescueAuthority: rescue });
  assert.equal(mintAsDestination.ok, false);
  assert.equal(mintAsDestination.checks.destinationIsTokenAccount, false);
  const wrongRescue = createSolanaTokenRecoveryPreflight({ asset, sourceTokenAccount: sourceAta, rescueTokenAccount: rescueAta, sourceOwner: program, rescueOwner: a, sourceMint: mint, destinationMint: mint, sourceProgramId: SOLANA_TOKEN_PROGRAM_ID, destinationProgramId: SOLANA_TOKEN_PROGRAM_ID, expectedSourceAuthority: program, expectedRescueAuthority: rescue });
  assert.equal(wrongRescue.ok, false);
  assert.equal(wrongRescue.checks.destinationControlledByRescue, false);
});


test('Solana checked-token safety assessment requires exact decimals, balance, thawed accounts and canonical rescue ATA', () => {
  const safe = createSolanaToken2022SafetyAssessment({ tokenProgramId: SOLANA_TOKEN_PROGRAM_ID, mintDecimals: 6, checkedDecimals: 6, sourceAmount: 500n, transferAmount: 500n, destinationIsCanonicalAta: true });
  assert.equal(safe.ok, true);
  assert.equal(safe.transferInstruction, 'TransferChecked');
  assert.equal(createSolanaToken2022SafetyAssessment({ tokenProgramId: SOLANA_TOKEN_PROGRAM_ID, mintDecimals: 6, checkedDecimals: 5, sourceAmount: 500n, transferAmount: 500n, destinationIsCanonicalAta: true }).ok, false);
  assert.equal(createSolanaToken2022SafetyAssessment({ tokenProgramId: SOLANA_TOKEN_PROGRAM_ID, mintDecimals: 6, checkedDecimals: 6, sourceAmount: 499n, transferAmount: 500n, destinationIsCanonicalAta: true }).ok, false);
  assert.equal(createSolanaToken2022SafetyAssessment({ tokenProgramId: SOLANA_TOKEN_PROGRAM_ID, mintDecimals: 6, checkedDecimals: 6, sourceAmount: 500n, transferAmount: 500n, sourceFrozen: true, destinationIsCanonicalAta: true }).ok, false);
  assert.equal(createSolanaToken2022SafetyAssessment({ tokenProgramId: SOLANA_TOKEN_PROGRAM_ID, mintDecimals: 6, checkedDecimals: 6, sourceAmount: 500n, transferAmount: 500n, destinationIsCanonicalAta: false }).ok, false);
});

test('Solana Token-2022 safety assessment fails closed on transfer-changing extensions', () => {
  const blocked = ['TransferFeeConfig', 'DefaultAccountState', 'ConfidentialTransferMint', 'NonTransferable', 'PermanentDelegate', 'TransferHook', 'ConfidentialTransferFeeConfig', 'ConfidentialMintBurn', 'Pausable'];
  for (const extension of blocked) {
    const result = createSolanaToken2022SafetyAssessment({ tokenProgramId: SOLANA_TOKEN_2022_PROGRAM_ID, mintDecimals: 6, checkedDecimals: 6, sourceAmount: 10n, transferAmount: 10n, mintExtensions: [extension], destinationIsCanonicalAta: true });
    assert.equal(result.ok, false, extension);
    assert.deepEqual(result.blockedExtensions, [extension]);
  }
  for (const extension of ['TransferFeeAmount', 'ConfidentialTransferAccount', 'MemoTransfer', 'NonTransferableAccount', 'CpiGuard', 'TransferHookAccount', 'ConfidentialTransferFeeAmount', 'PausableAccount']) {
    assert.equal(createSolanaToken2022SafetyAssessment({ tokenProgramId: SOLANA_TOKEN_2022_PROGRAM_ID, mintDecimals: 6, checkedDecimals: 6, sourceAmount: 10n, transferAmount: 10n, sourceExtensions: [extension], destinationIsCanonicalAta: true }).ok, false, extension);
  }
});


test('Solana Token-2022 extension policy rejects unknown/unreviewed extensions but permits canonical ATA ImmutableOwner', () => {
  const canonicalAtaShape = createSolanaToken2022SafetyAssessment({
    tokenProgramId: SOLANA_TOKEN_2022_PROGRAM_ID,
    mintDecimals: 6,
    checkedDecimals: 6,
    sourceAmount: 10n,
    transferAmount: 10n,
    sourceExtensions: ['ImmutableOwner'],
    destinationExtensions: ['ImmutableOwner'],
    destinationIsCanonicalAta: true
  });
  assert.equal(canonicalAtaShape.ok, true);
  assert.deepEqual(canonicalAtaShape.blockedExtensions, []);
  assert.deepEqual(canonicalAtaShape.allowedExtensions.account, ['ImmutableOwner']);

  for (const extension of ['MintCloseAuthority', 'InterestBearingConfig', 'ScaledUiAmount', 'FutureUnknownExtension']) {
    const result = createSolanaToken2022SafetyAssessment({
      tokenProgramId: SOLANA_TOKEN_2022_PROGRAM_ID,
      mintDecimals: 6,
      checkedDecimals: 6,
      sourceAmount: 10n,
      transferAmount: 10n,
      mintExtensions: [extension],
      sourceExtensions: ['ImmutableOwner'],
      destinationExtensions: ['ImmutableOwner'],
      destinationIsCanonicalAta: true
    });
    assert.equal(result.ok, false, extension);
    assert.deepEqual(result.blockedExtensions, [extension]);
  }

  const unknownAccountExtension = createSolanaToken2022SafetyAssessment({
    tokenProgramId: SOLANA_TOKEN_2022_PROGRAM_ID,
    mintDecimals: 6,
    checkedDecimals: 6,
    sourceAmount: 10n,
    transferAmount: 10n,
    sourceExtensions: ['ImmutableOwner', 'FutureAccountExtension'],
    destinationExtensions: ['ImmutableOwner'],
    destinationIsCanonicalAta: true
  });
  assert.equal(unknownAccountExtension.ok, false);
  assert.deepEqual(unknownAccountExtension.blockedExtensions, ['FutureAccountExtension']);
});

function token2022Data({ accountKind, extensions = [] }) {
  const baseBytes = accountKind === 'mint' ? SOLANA_TOKEN_MINT_BASE_BYTES : SOLANA_TOKEN_ACCOUNT_BASE_BYTES;
  const base = Buffer.alloc(SOLANA_TOKEN_ACCOUNT_BASE_BYTES);
  const accountType = Buffer.from([accountKind === 'mint' ? 1 : 2]);
  const entries = extensions.map(({ type, value = Buffer.alloc(0) }) => {
    const header = Buffer.alloc(4);
    header.writeUInt16LE(type, 0);
    header.writeUInt16LE(value.length, 2);
    return Buffer.concat([header, value]);
  });
  return Buffer.concat([base.subarray(0, Math.max(baseBytes, SOLANA_TOKEN_ACCOUNT_BASE_BYTES)), accountType, ...entries]);
}

const rawKey = byte => bs58.encode(Buffer.alloc(32, byte));

function mintBaseData({ decimals = 6, initialized = true } = {}) {
  const data = Buffer.alloc(SOLANA_TOKEN_MINT_BASE_BYTES);
  data.writeBigUInt64LE(1000n, 36);
  data[44] = decimals;
  data[45] = initialized ? 1 : 0;
  return data;
}

function tokenAccountBaseData({ mintAddress, authority, amount = 10n, state = 1 }) {
  const data = Buffer.alloc(SOLANA_TOKEN_ACCOUNT_BASE_BYTES);
  Buffer.from(bs58.decode(mintAddress)).copy(data, 0);
  Buffer.from(bs58.decode(authority)).copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = state;
  return data;
}

function token2022StateData({ accountKind, baseData, extensions = [] }) {
  const data = token2022Data({ accountKind, extensions });
  baseData.copy(data, 0);
  return data;
}

test('Solana raw Token-2022 parser accepts canonical ImmutableOwner ATAs and rejects unknown types', () => {
  const canonicalAta = token2022Data({ accountKind: 'account', extensions: [{ type: 7 }] });
  const parsed = parseSolanaToken2022Extensions({ data: canonicalAta, accountKind: 'account' });
  assert.deepEqual(parsed.extensionTypes, [7]);
  assert.deepEqual(parsed.extensionNames, ['ImmutableOwner']);
  assert.deepEqual(parsed.unknownExtensionTypes, []);

  const unknown = token2022Data({ accountKind: 'account', extensions: [{ type: 65535 }] });
  const unknownParsed = parseSolanaToken2022Extensions({ data: unknown, accountKind: 'account' });
  assert.deepEqual(unknownParsed.extensionNames, ['UnknownExtension(65535)']);
  assert.deepEqual(unknownParsed.unknownExtensionTypes, [65535]);
});

test('Solana raw Token-2022 safety assessment derives extensions from bytes and fails closed', () => {
  const rawMint = rawKey(11), rawSourceAuthority = rawKey(12), rawDestinationAuthority = rawKey(13);
  const sourceAccountAddress = rawKey(14);
  const destinationAccountAddress = deriveSolanaAssociatedTokenAddress({ owner: rawDestinationAuthority, mint: rawMint, tokenProgramId: SOLANA_TOKEN_2022_PROGRAM_ID }).address;
  const mintData = token2022StateData({ accountKind: 'mint', baseData: mintBaseData() });
  const sourceAta = token2022StateData({ accountKind: 'account', baseData: tokenAccountBaseData({ mintAddress: rawMint, authority: rawSourceAuthority }), extensions: [{ type: 7 }] });
  const destinationAta = token2022StateData({ accountKind: 'account', baseData: tokenAccountBaseData({ mintAddress: rawMint, authority: rawDestinationAuthority }), extensions: [{ type: 7 }] });
  const safe = createSolanaTokenSafetyAssessmentFromAccountData({
    tokenProgramId: SOLANA_TOKEN_2022_PROGRAM_ID,
    mintAddress: rawMint,
    sourceAccountAddress,
    destinationAccountAddress,
    expectedSourceAuthority: rawSourceAuthority,
    expectedDestinationAuthority: rawDestinationAuthority,
    mintData,
    sourceAccountData: sourceAta,
    destinationAccountData: destinationAta,
    checkedDecimals: 6,
    transferAmount: 10n,
    destinationIsCanonicalAta: true
  });
  assert.equal(safe.ok, true);
  assert.equal(safe.decodedAccountData.mint.decimals, 6);
  assert.equal(safe.decodedAccountData.source.amount, 10n);

  const unknownMint = token2022StateData({ accountKind: 'mint', baseData: mintBaseData(), extensions: [{ type: 65535 }] });
  const blocked = createSolanaTokenSafetyAssessmentFromAccountData({
    tokenProgramId: SOLANA_TOKEN_2022_PROGRAM_ID,
    mintAddress: rawMint,
    sourceAccountAddress,
    destinationAccountAddress,
    expectedSourceAuthority: rawSourceAuthority,
    expectedDestinationAuthority: rawDestinationAuthority,
    mintData: unknownMint,
    sourceAccountData: sourceAta,
    destinationAccountData: destinationAta,
    checkedDecimals: 6,
    transferAmount: 10n,
    destinationIsCanonicalAta: true
  });
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.blockedExtensions, ['UnknownExtension(65535)']);
});

test('Solana raw account assessment derives base fields and rejects identity or state drift', () => {
  const rawMint = rawKey(21), otherMint = rawKey(22), sourceAuthority = rawKey(23), destinationAuthority = rawKey(24);
  const sourceAccountAddress = rawKey(25);
  const rawDestinationAta = deriveSolanaAssociatedTokenAddress({ owner: destinationAuthority, mint: rawMint, tokenProgramId: SOLANA_TOKEN_PROGRAM_ID }).address;
  const otherDestinationAta = deriveSolanaAssociatedTokenAddress({ owner: destinationAuthority, mint: otherMint, tokenProgramId: SOLANA_TOKEN_PROGRAM_ID }).address;
  const mintData = mintBaseData({ decimals: 9 });
  const source = tokenAccountBaseData({ mintAddress: rawMint, authority: sourceAuthority, amount: 25n });
  const destination = tokenAccountBaseData({ mintAddress: rawMint, authority: destinationAuthority });
  assert.deepEqual(parseSolanaTokenMintBase({ data: mintData }), { supply: 1000n, decimals: 9, isInitialized: true });
  assert.equal(parseSolanaTokenAccountBase({ data: source }).owner, sourceAuthority);

  const mismatch = createSolanaTokenSafetyAssessmentFromAccountData({
    tokenProgramId: SOLANA_TOKEN_PROGRAM_ID,
    mintAddress: otherMint,
    sourceAccountAddress,
    destinationAccountAddress: otherDestinationAta,
    expectedSourceAuthority: sourceAuthority,
    expectedDestinationAuthority: destinationAuthority,
    mintData,
    sourceAccountData: source,
    destinationAccountData: destination,
    checkedDecimals: 9,
    transferAmount: 25n,
    destinationIsCanonicalAta: true
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.checks.sourceMintMatches, false);
  assert.equal(mismatch.checks.destinationMintMatches, false);

  const spoofedBalance = createSolanaTokenSafetyAssessmentFromAccountData({
    tokenProgramId: SOLANA_TOKEN_PROGRAM_ID,
    mintAddress: rawMint,
    sourceAccountAddress,
    destinationAccountAddress: rawDestinationAta,
    expectedSourceAuthority: sourceAuthority,
    expectedDestinationAuthority: destinationAuthority,
    mintData,
    sourceAccountData: source,
    destinationAccountData: destination,
    checkedDecimals: 9,
    transferAmount: 26n,
    sourceAmount: 999n,
    sourceFrozen: false,
    destinationIsCanonicalAta: true
  });
  assert.equal(spoofedBalance.ok, false);
  assert.equal(spoofedBalance.checks.amountWithinSourceBalance, false);

  const nonCanonicalDestination = createSolanaTokenSafetyAssessmentFromAccountData({
    tokenProgramId: SOLANA_TOKEN_PROGRAM_ID,
    mintAddress: rawMint,
    sourceAccountAddress,
    destinationAccountAddress: rawKey(26),
    expectedSourceAuthority: sourceAuthority,
    expectedDestinationAuthority: destinationAuthority,
    mintData,
    sourceAccountData: source,
    destinationAccountData: destination,
    checkedDecimals: 9,
    transferAmount: 25n
  });
  assert.equal(nonCanonicalDestination.ok, false);
  assert.equal(nonCanonicalDestination.checks.canonicalRescueAta, false);

  const frozen = tokenAccountBaseData({ mintAddress: rawMint, authority: sourceAuthority, state: 2 });
  assert.equal(parseSolanaTokenAccountBase({ data: frozen }).isFrozen, true);
  assert.throws(() => parseSolanaTokenMintBase({ data: mintBaseData({ initialized: false }) }), /not initialized/);
  assert.throws(() => parseSolanaTokenAccountBase({ data: tokenAccountBaseData({ mintAddress: rawMint, authority: sourceAuthority, state: 0 }) }), /not initialized/);
});

test('Solana TransferChecked plan freezes assessed accounts, PDA authority and canonical instruction bytes', () => {
  const rawMint = rawKey(31), sourceAuthority = rawKey(32), destinationAuthority = rawKey(33);
  const sourceTokenAccount = rawKey(34);
  const destinationTokenAccount = deriveSolanaAssociatedTokenAddress({ owner: destinationAuthority, mint: rawMint, tokenProgramId: SOLANA_TOKEN_PROGRAM_ID }).address;
  const assessment = createSolanaTokenSafetyAssessmentFromAccountData({
    tokenProgramId: SOLANA_TOKEN_PROGRAM_ID,
    mintAddress: rawMint,
    sourceAccountAddress: sourceTokenAccount,
    destinationAccountAddress: destinationTokenAccount,
    expectedSourceAuthority: sourceAuthority,
    expectedDestinationAuthority: destinationAuthority,
    mintData: mintBaseData({ decimals: 9 }),
    sourceAccountData: tokenAccountBaseData({ mintAddress: rawMint, authority: sourceAuthority, amount: 25n }),
    destinationAccountData: tokenAccountBaseData({ mintAddress: rawMint, authority: destinationAuthority }),
    checkedDecimals: 9,
    transferAmount: 25n,
    destinationIsCanonicalAta: true
  });
  const plan = createSolanaTransferCheckedInstructionPlan({ assessment, sourceTokenAccount, mintAccount: rawMint, destinationTokenAccount, custodyAuthority: sourceAuthority });
  assert.equal(plan.programId, SOLANA_TOKEN_PROGRAM_ID);
  assert.equal(plan.dataHex, '0c190000000000000009');
  assert.deepEqual(plan.keys, [
    { pubkey: sourceTokenAccount, isSigner: false, isWritable: true },
    { pubkey: rawMint, isSigner: false, isWritable: false },
    { pubkey: destinationTokenAccount, isSigner: false, isWritable: true },
    { pubkey: sourceAuthority, isSigner: true, isWritable: false }
  ]);
  assert.equal(plan.authorityMode, 'pda-invoke-signed');
  assert.match(plan.intentDigest, /^[0-9a-f]{64}$/);
  assert.match(assessment.assessmentDigest, /^[0-9a-f]{64}$/);

  assert.throws(() => createSolanaTransferCheckedInstructionPlan({ assessment: { ...assessment, ok: false }, sourceTokenAccount, mintAccount: rawMint, destinationTokenAccount, custodyAuthority: sourceAuthority }), /passing raw-account/);
  assert.throws(() => createSolanaTransferCheckedInstructionPlan({ assessment, sourceTokenAccount, mintAccount: rawKey(36), destinationTokenAccount, custodyAuthority: sourceAuthority }), /mint does not match/);
  assert.throws(() => createSolanaTransferCheckedInstructionPlan({ assessment: { ...assessment, transferAmount: 1n << 64n }, sourceTokenAccount, mintAccount: rawMint, destinationTokenAccount, custodyAuthority: sourceAuthority }), /integrity digest/);
});

test('Solana rescue ATA plan freezes idempotent creation, funding roles and post-creation verification', () => {
  const payer = rawKey(41), rescueOwner = rawKey(42), rawMint = rawKey(43);
  for (const tokenProgramId of [SOLANA_TOKEN_PROGRAM_ID, SOLANA_TOKEN_2022_PROGRAM_ID]) {
    const destinationTokenAccount = deriveSolanaAssociatedTokenAddress({ owner: rescueOwner, mint: rawMint, tokenProgramId }).address;
    const plan = createSolanaRescueAtaCreationPlan({ payer, rescueOwner, mintAccount: rawMint, tokenProgramId, destinationTokenAccount });
    assert.equal(plan.instruction.programId, SOLANA_ASSOCIATED_TOKEN_PROGRAM_ID);
    assert.equal(plan.instruction.instruction, 'CreateIdempotent');
    assert.equal(plan.instruction.dataHex, '01');
    assert.deepEqual(plan.instruction.keys, [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: destinationTokenAccount, isSigner: false, isWritable: true },
      { pubkey: rescueOwner, isSigner: false, isWritable: false },
      { pubkey: rawMint, isSigner: false, isWritable: false },
      { pubkey: SOLANA_SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false }
    ]);
    assert.equal(plan.funding.rescueOwnerMustSign, false);
    assert.equal(plan.funding.rentLamportsInput, null);
    assert.equal(plan.postCreationGate.transferPlanBlockedUntilVerified, true);
    assert.deepEqual(plan.expectedDestinationExtensions, tokenProgramId === SOLANA_TOKEN_2022_PROGRAM_ID ? ['ImmutableOwner'] : []);
    assert.match(plan.intentDigest, /^[0-9a-f]{64}$/);
  }
});

test('Solana rescue ATA plan rejects redirection and unsupported token programs', () => {
  const payer = rawKey(44), rescueOwner = rawKey(45), rawMint = rawKey(46);
  assert.throws(() => createSolanaRescueAtaCreationPlan({ payer, rescueOwner, mintAccount: rawMint, tokenProgramId: SOLANA_TOKEN_PROGRAM_ID, destinationTokenAccount: rawKey(47) }), /not the canonical/);
  assert.throws(() => createSolanaRescueAtaCreationPlan({ payer, rescueOwner, mintAccount: rawMint, tokenProgramId: rawKey(48), destinationTokenAccount: rawKey(49) }), /Unsupported/);
});

test('Solana token recovery coordinator requires creation verification before transfer', () => {
  const payer = rawKey(51), rescueOwner = rawKey(52), rawMint = rawKey(53), sourceAuthority = rawKey(54), sourceTokenAccount = rawKey(55);
  const destinationTokenAccount = deriveSolanaAssociatedTokenAddress({ owner: rescueOwner, mint: rawMint, tokenProgramId: SOLANA_TOKEN_PROGRAM_ID }).address;
  const ataCreationPlan = createSolanaRescueAtaCreationPlan({ payer, rescueOwner, mintAccount: rawMint, tokenProgramId: SOLANA_TOKEN_PROGRAM_ID, destinationTokenAccount });
  const creationPhase = createSolanaTokenRecoveryPhasePlan({ ataCreationPlan });
  assert.equal(creationPhase.phase, 'create-and-verify-rescue-ata');
  assert.equal(creationPhase.readyForTransfer, false);
  assert.equal(creationPhase.instructions.length, 1);
  assert.deepEqual(creationPhase.confirmationPolicy, { creationCommitment: 'finalized', accountReadCommitment: 'finalized', accountReadMinContextSlot: 'creationFinalizedSlot' });
  assert.deepEqual(creationPhase.requiredNextEvidence, ['finalized creation result', 'refetched destination account bytes', 'passing digest-bound raw safety assessment']);

  const assessment = createSolanaTokenSafetyAssessmentFromAccountData({
    tokenProgramId: SOLANA_TOKEN_PROGRAM_ID,
    mintAddress: rawMint,
    sourceAccountAddress: sourceTokenAccount,
    destinationAccountAddress: destinationTokenAccount,
    expectedSourceAuthority: sourceAuthority,
    expectedDestinationAuthority: rescueOwner,
    mintData: mintBaseData({ decimals: 6 }),
    sourceAccountData: tokenAccountBaseData({ mintAddress: rawMint, authority: sourceAuthority, amount: 50n }),
    destinationAccountData: tokenAccountBaseData({ mintAddress: rawMint, authority: rescueOwner }),
    checkedDecimals: 6,
    transferAmount: 50n
  });
  assert.throws(() => createSolanaTokenRecoveryPhasePlan({ ataCreationPlan, assessment, creationFinalizedSlot: 100, assessmentContextSlot: 99 }), /non-stale finalized/);
  const transferPhase = createSolanaTokenRecoveryPhasePlan({ ataCreationPlan, assessment, creationFinalizedSlot: 100, assessmentContextSlot: 101 });
  assert.equal(transferPhase.phase, 'transfer-verified-token-balance');
  assert.equal(transferPhase.readyForTransfer, true);
  assert.equal(transferPhase.instructions[0].dataHex, '0c320000000000000006');
  assert.equal(transferPhase.creationIntentDigest, ataCreationPlan.intentDigest);
  assert.equal(transferPhase.assessmentDigest, assessment.assessmentDigest);
  assert.equal(transferPhase.creationFinalizedSlot, 100);
  assert.equal(transferPhase.assessmentContextSlot, 101);
  assert.match(transferPhase.intentDigest, /^[0-9a-f]{64}$/);
  assert.throws(() => createSolanaTokenRecoveryPhasePlan({ ataCreationPlan, assessment: { ...assessment, transferAmount: 49n }, creationFinalizedSlot: 100, assessmentContextSlot: 101 }), /integrity digest/);
});

test('Solana token recovery coordinator rejects tampered or cross-intent evidence', () => {
  const payer = rawKey(56), rescueOwner = rawKey(57), rawMint = rawKey(58);
  const destinationTokenAccount = deriveSolanaAssociatedTokenAddress({ owner: rescueOwner, mint: rawMint, tokenProgramId: SOLANA_TOKEN_PROGRAM_ID }).address;
  const ataCreationPlan = createSolanaRescueAtaCreationPlan({ payer, rescueOwner, mintAccount: rawMint, tokenProgramId: SOLANA_TOKEN_PROGRAM_ID, destinationTokenAccount });
  assert.throws(() => createSolanaTokenRecoveryPhasePlan({ ataCreationPlan: { ...ataCreationPlan, associatedTokenAccount: rawKey(59) } }), /integrity digest/);
  assert.throws(() => createSolanaTokenRecoveryPhasePlan({ ataCreationPlan: { ...ataCreationPlan, intentDigest: '0'.repeat(64) } }), /integrity digest/);
});

test('Solana raw Token-2022 parser rejects malformed TLV and account-kind confusion', () => {
  const account = token2022Data({ accountKind: 'account', extensions: [{ type: 7 }] });
  assert.throws(() => parseSolanaToken2022Extensions({ data: account, accountKind: 'mint' }), /discriminator/);
  assert.throws(() => parseSolanaToken2022Extensions({ data: account.subarray(0, account.length - 1), accountKind: 'account' }), /truncated/);
  const duplicate = token2022Data({ accountKind: 'account', extensions: [{ type: 7 }, { type: 7 }] });
  assert.throws(() => parseSolanaToken2022Extensions({ data: duplicate, accountKind: 'account' }), /duplicate/);
});
