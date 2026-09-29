import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOLANA_TOKEN_PROGRAM_ID, SOLANA_TOKEN_2022_PROGRAM_ID,
  createSolanaVaultState, heartbeatSolanaVault, approveSolanaRecovery, executeSolanaRecovery,
  solanaRecoveryEligible, createSolanaPdaPlan, normalizeSolanaTokenAsset,
  createSolanaTokenRecoveryPreflight, createSolanaToken2022SafetyAssessment,
  createSolanaTokenSafetyAssessmentFromAccountData, parseSolanaToken2022Extensions,
  SOLANA_TOKEN_MINT_BASE_BYTES, SOLANA_TOKEN_ACCOUNT_BASE_BYTES,
  createSolanaTransactionLifetimePlan, createSolanaProgramVerificationPlan
} from '../src/chains/solana/recovery-program.js';

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
  const mintData = token2022Data({ accountKind: 'mint' });
  const canonicalAta = token2022Data({ accountKind: 'account', extensions: [{ type: 7 }] });
  const safe = createSolanaTokenSafetyAssessmentFromAccountData({
    tokenProgramId: SOLANA_TOKEN_2022_PROGRAM_ID,
    mintData,
    sourceAccountData: canonicalAta,
    destinationAccountData: canonicalAta,
    mintDecimals: 6,
    checkedDecimals: 6,
    sourceAmount: 10n,
    transferAmount: 10n,
    destinationIsCanonicalAta: true
  });
  assert.equal(safe.ok, true);

  const unknownMint = token2022Data({ accountKind: 'mint', extensions: [{ type: 65535 }] });
  const blocked = createSolanaTokenSafetyAssessmentFromAccountData({
    tokenProgramId: SOLANA_TOKEN_2022_PROGRAM_ID,
    mintData: unknownMint,
    sourceAccountData: canonicalAta,
    destinationAccountData: canonicalAta,
    mintDecimals: 6,
    checkedDecimals: 6,
    sourceAmount: 10n,
    transferAmount: 10n,
    destinationIsCanonicalAta: true
  });
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.blockedExtensions, ['UnknownExtension(65535)']);
});

test('Solana raw Token-2022 parser rejects malformed TLV and account-kind confusion', () => {
  const account = token2022Data({ accountKind: 'account', extensions: [{ type: 7 }] });
  assert.throws(() => parseSolanaToken2022Extensions({ data: account, accountKind: 'mint' }), /discriminator/);
  assert.throws(() => parseSolanaToken2022Extensions({ data: account.subarray(0, account.length - 1), accountKind: 'account' }), /truncated/);
  const duplicate = token2022Data({ accountKind: 'account', extensions: [{ type: 7 }, { type: 7 }] });
  assert.throws(() => parseSolanaToken2022Extensions({ data: duplicate, accountKind: 'account' }), /duplicate/);
});
