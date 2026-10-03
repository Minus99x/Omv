import {
  validateRecoveryAccountSnapshot,
  verifySignedFeeBumpEnvelopeArtifact,
  verifySignedHeartbeatEnvelopeArtifact,
  verifySignedRecoveryEnvelopeArtifact
} from './native-recovery.js';
import {
  createStellarTestnetRecoveryEvidenceBundle,
  verifyStellarTestnetRecoveryEvidenceBundle
} from './evidence-binding.js';

function requireMethod(driver, name) {
  if (typeof driver?.[name] !== 'function') throw new TypeError(`Stellar Testnet recovery proof driver requires ${name}().`);
}

async function action(actions, operation, fn) {
  try {
    const result = await fn();
    actions.push(Object.freeze({ operation, ok: true, result: structuredClone(result ?? null) }));
    return result;
  } catch (error) {
    actions.push(Object.freeze({ operation, ok: false, error: String(error?.message || error) }));
    throw error;
  }
}

function integerString(value, label, { positive = false } = {}) {
  const text = typeof value === 'bigint' ? value.toString() : String(value ?? '');
  if (!/^\d+$/.test(text)) throw new TypeError(`${label} must be a non-negative integer string.`);
  if (positive && BigInt(text) === 0n) throw new TypeError(`${label} must be greater than zero.`);
  return text;
}

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function assetKey(asset) {
  return asset?.type === 'native' ? 'native' : `${asset?.code}:${asset?.issuer}`;
}

function amountUnits(amount, label) {
  const match = /^(0|[1-9]\d*)\.(\d{7})$/.exec(String(amount ?? ''));
  if (!match) throw new TypeError(`${label} must be a canonical Stellar amount with seven fractional digits.`);
  return (BigInt(match[1]) * 10000000n + BigInt(match[2])).toString();
}

function normalizeAccountSnapshot(snapshot, label) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError(`${label} is required.`);
  const sequence = integerString(snapshot.sequence, `${label}.sequence`);
  return Object.freeze({ ...structuredClone(snapshot), sequence });
}

function hasPreAuthSigner(snapshot, preAuthTxSigner) {
  return Array.isArray(snapshot?.signers) && snapshot.signers.some(
    signer => signer?.type === 'preAuthTx' && signer?.key === preAuthTxSigner && Number(signer?.weight) > 0
  );
}

function requireTooEarly(result, expectedHash, label) {
  if (!result || typeof result !== 'object') throw new Error(`${label} did not return a submission result.`);
  if (result.transactionHashHex !== expectedHash) throw new Error(`${label} returned a different transaction hash.`);
  if (result.includedInLedger !== false || result.successful !== false || result.resultCode !== 'txTOO_EARLY') {
    throw new Error(`${label} must prove txTOO_EARLY without ledger inclusion.`);
  }
  return Object.freeze({
    transactionHashHex: expectedHash,
    observedAt: requiredText(result.observedAt, `${label}.observedAt`),
    includedInLedger: false,
    successful: false,
    resultCode: 'txTOO_EARLY'
  });
}

function requireSuccess(result, expectedHash, label) {
  if (!result || typeof result !== 'object') throw new Error(`${label} did not return a submission result.`);
  if (result.transactionHashHex !== expectedHash) throw new Error(`${label} returned a different transaction hash.`);
  if (result.includedInLedger !== true || result.successful !== true || result.resultCode !== 'txSUCCESS') {
    throw new Error(`${label} must prove txSUCCESS with ledger inclusion.`);
  }
  return Object.freeze({
    transactionHashHex: expectedHash,
    observedAt: requiredText(result.observedAt, `${label}.observedAt`),
    includedInLedger: true,
    successful: true,
    resultCode: 'txSUCCESS',
    ledger: integerString(result.ledger, `${label}.ledger`, { positive: true })
  });
}

function requireFinality(result, expectedHash, expectedLedger) {
  if (!result || typeof result !== 'object') throw new Error('Finality observation is required.');
  if (result.status !== 'finalized') throw new Error('Stellar proof requires a finalized ledger observation.');
  if (result.transactionHashHex !== expectedHash) throw new Error('Finality observation is bound to another transaction.');
  const ledger = integerString(result.ledger, 'finality.ledger', { positive: true });
  if (ledger !== expectedLedger) throw new Error('Finality observation ledger does not match recovery inclusion ledger.');
  return Object.freeze({
    status: 'finalized',
    transactionHashHex: expectedHash,
    ledger,
    ledgerHash: requiredText(result.ledgerHash, 'finality.ledgerHash'),
    observedAt: requiredText(result.observedAt, 'finality.observedAt')
  });
}

function requireOfflineArtifacts(input) {
  const recovery = verifySignedRecoveryEnvelopeArtifact({
    plan: input.recoveryPlan,
    artifact: input.recoveryArtifact,
    signedTransactionXdr: input.signedRecoveryTransactionXdr
  });
  if (!recovery.valid) throw new Error(`Signed recovery artifact failed offline verification: ${recovery.errors.join('; ')}`);

  const heartbeat = verifySignedHeartbeatEnvelopeArtifact({
    plan: input.heartbeatPlan,
    artifact: input.heartbeatArtifact,
    signedTransactionXdr: input.signedHeartbeatTransactionXdr
  });
  if (!heartbeat.valid) throw new Error(`Signed heartbeat artifact failed offline verification: ${heartbeat.errors.join('; ')}`);

  const feeBump = verifySignedFeeBumpEnvelopeArtifact({
    recoveryPlan: input.recoveryPlan,
    recoveryArtifact: input.recoveryArtifact,
    feeBumpPlan: input.feeBumpPlan,
    artifact: input.feeBumpArtifact,
    signedFeeBumpTransactionXdr: input.signedFeeBumpTransactionXdr
  });
  if (!feeBump.valid) throw new Error(`Signed fee-bump artifact failed offline verification: ${feeBump.errors.join('; ')}`);
}

function assertHeartbeatMatchesSnapshot(heartbeatPlan, snapshot) {
  if (heartbeatPlan.sourceAccount == null) throw new TypeError('heartbeatPlan.sourceAccount is required.');
  if (BigInt(heartbeatPlan.transactionSequence) !== BigInt(snapshot.sequence) + 1n) {
    throw new Error('Heartbeat transaction sequence is not the immediate successor of the observed account sequence.');
  }
  if (BigInt(heartbeatPlan.operations?.[0]?.bumpTo ?? -1) !== BigInt(snapshot.sequence) + 2n) {
    throw new Error('Heartbeat bump target is not the expected two-step sequence advance.');
  }
}

function assertReadyAccount({ recoveryPlan, recoveryArtifact, snapshot, label }) {
  const result = validateRecoveryAccountSnapshot({
    plan: recoveryPlan,
    artifact: recoveryArtifact,
    snapshot
  });
  if (!result.ready) throw new Error(`${label} failed recovery account preflight: ${result.errors.join('; ')}`);
}

async function readBalances(actions, driver, account, operations, phase) {
  const out = new Map();
  for (const operation of operations) {
    const key = assetKey(operation.asset);
    const value = await action(actions, `balance.${phase}.${account === operation.destination ? 'rescue' : 'vault'}.${key}`, () =>
      driver.readBalanceUnits({ account, asset: structuredClone(operation.asset), assetKey: key })
    );
    out.set(key, integerString(value, `${phase} balance for ${key}`));
  }
  return out;
}

export async function runStellarTestnetRecoveryProof(input) {
  const {
    driver,
    recoveryPlan,
    recoveryArtifact,
    signedRecoveryTransactionXdr,
    heartbeatPlan,
    heartbeatArtifact,
    signedHeartbeatTransactionXdr,
    feeBumpPlan,
    feeBumpArtifact,
    signedFeeBumpTransactionXdr
  } = input ?? {};

  for (const method of ['readAccountSnapshot', 'readBalanceUnits', 'submitEnvelope', 'waitUntilEligible', 'observeFinality']) {
    requireMethod(driver, method);
  }
  if (recoveryPlan?.networkRef !== 'stellar:testnet' || recoveryArtifact?.networkPassphrase !== recoveryPlan?.networkPassphrase) {
    throw new TypeError('Stellar Testnet proof runner requires a network-bound recovery plan and artifact.');
  }
  if (heartbeatPlan?.networkRef !== 'stellar:testnet' || heartbeatArtifact?.networkPassphrase !== recoveryPlan.networkPassphrase) {
    throw new TypeError('Stellar Testnet proof runner requires a network-bound heartbeat plan and artifact.');
  }
  if (!Array.isArray(recoveryPlan.operations) || recoveryPlan.operations.length < 1) {
    throw new TypeError('Stellar Testnet proof runner requires at least one fixed recovery payment operation.');
  }

  requireOfflineArtifacts({
    recoveryPlan,
    recoveryArtifact,
    signedRecoveryTransactionXdr,
    heartbeatPlan,
    heartbeatArtifact,
    signedHeartbeatTransactionXdr,
    feeBumpPlan,
    feeBumpArtifact,
    signedFeeBumpTransactionXdr
  });

  const actions = [];
  const initialAccount = normalizeAccountSnapshot(
    await action(actions, 'account.initial', () => driver.readAccountSnapshot(recoveryPlan.sourceAccount)),
    'initialAccount'
  );
  assertReadyAccount({ recoveryPlan, recoveryArtifact, snapshot: initialAccount, label: 'Initial account snapshot' });
  assertHeartbeatMatchesSnapshot(heartbeatPlan, initialAccount);

  const initialTooEarly = requireTooEarly(
    await action(actions, 'recovery.too-early.initial', () => driver.submitEnvelope({
      purpose: 'recovery-too-early-initial',
      transactionXdr: signedRecoveryTransactionXdr,
      expectedTransactionHashHex: recoveryArtifact.transactionHashHex
    })),
    recoveryArtifact.transactionHashHex,
    'Initial recovery submission'
  );

  const heartbeatSubmission = requireSuccess(
    await action(actions, 'heartbeat.submit', () => driver.submitEnvelope({
      purpose: 'heartbeat',
      transactionXdr: signedHeartbeatTransactionXdr,
      expectedTransactionHashHex: heartbeatArtifact.transactionHashHex
    })),
    heartbeatArtifact.transactionHashHex,
    'Heartbeat submission'
  );

  const afterHeartbeat = normalizeAccountSnapshot(
    await action(actions, 'account.after-heartbeat', () => driver.readAccountSnapshot(recoveryPlan.sourceAccount)),
    'afterHeartbeat'
  );
  if (afterHeartbeat.sequence !== heartbeatPlan.operations[0].bumpTo) {
    throw new Error('Observed account sequence does not match the applied heartbeat bump target.');
  }
  assertReadyAccount({ recoveryPlan, recoveryArtifact, snapshot: afterHeartbeat, label: 'Post-heartbeat account snapshot' });

  const postHeartbeatTooEarly = requireTooEarly(
    await action(actions, 'recovery.too-early.after-heartbeat', () => driver.submitEnvelope({
      purpose: 'recovery-too-early-after-heartbeat',
      transactionXdr: signedRecoveryTransactionXdr,
      expectedTransactionHashHex: recoveryArtifact.transactionHashHex
    })),
    recoveryArtifact.transactionHashHex,
    'Post-heartbeat recovery submission'
  );

  const eligibility = await action(actions, 'recovery.wait-until-eligible', () => driver.waitUntilEligible({
    sourceAccount: recoveryPlan.sourceAccount,
    minAccountSequenceAge: recoveryPlan.preconditions.minAccountSequenceAge,
    currentSequence: afterHeartbeat.sequence,
    recoverySequence: recoveryPlan.sequence.recoverySequence
  }));
  if (eligibility?.eligible !== true) throw new Error('Driver did not prove that the recovery preconditions became eligible.');

  const beforeRecovery = normalizeAccountSnapshot(
    await action(actions, 'account.before-recovery', () => driver.readAccountSnapshot(recoveryPlan.sourceAccount)),
    'beforeRecovery'
  );
  assertReadyAccount({ recoveryPlan, recoveryArtifact, snapshot: beforeRecovery, label: 'Pre-recovery account snapshot' });

  const vaultBefore = await readBalances(actions, driver, recoveryPlan.sourceAccount, recoveryPlan.operations, 'before');
  const rescueBefore = await readBalances(actions, driver, recoveryPlan.rescueDestination, recoveryPlan.operations, 'before');

  const recoverySubmission = requireSuccess(
    await action(actions, 'recovery.submit-fee-bump', () => driver.submitEnvelope({
      purpose: 'eligible-recovery-fee-bump',
      transactionXdr: signedFeeBumpTransactionXdr,
      expectedTransactionHashHex: feeBumpArtifact.feeBumpTransactionHashHex
    })),
    feeBumpArtifact.feeBumpTransactionHashHex,
    'Eligible recovery submission'
  );

  const finality = requireFinality(
    await action(actions, 'recovery.observe-finality', () => driver.observeFinality({
      transactionHashHex: feeBumpArtifact.feeBumpTransactionHashHex,
      ledger: recoverySubmission.ledger
    })),
    feeBumpArtifact.feeBumpTransactionHashHex,
    recoverySubmission.ledger
  );

  const afterRecovery = normalizeAccountSnapshot(
    await action(actions, 'account.after-recovery', () => driver.readAccountSnapshot(recoveryPlan.sourceAccount)),
    'afterRecovery'
  );
  if (afterRecovery.sequence !== recoveryPlan.sequence.recoverySequence) {
    throw new Error('Post-recovery account sequence does not equal the fixed recovery transaction sequence.');
  }
  if (hasPreAuthSigner(afterRecovery, recoveryArtifact.preAuthTxSigner)) {
    throw new Error('Pre-authorized recovery signer is still present after the applied recovery.');
  }

  const vaultAfter = await readBalances(actions, driver, recoveryPlan.sourceAccount, recoveryPlan.operations, 'after');
  const rescueAfter = await readBalances(actions, driver, recoveryPlan.rescueDestination, recoveryPlan.operations, 'after');

  const balanceMovements = recoveryPlan.operations.map(operation => {
    const key = assetKey(operation.asset);
    return Object.freeze({
      assetKey: key,
      expectedTransferUnits: amountUnits(operation.amount, `recovery amount for ${key}`),
      vaultBeforeUnits: vaultBefore.get(key),
      vaultAfterUnits: vaultAfter.get(key),
      rescueBeforeUnits: rescueBefore.get(key),
      rescueAfterUnits: rescueAfter.get(key)
    });
  });

  const evidenceBundle = createStellarTestnetRecoveryEvidenceBundle({
    networkRef: 'stellar:testnet',
    recoveryTransactionHashHex: recoveryArtifact.transactionHashHex,
    preAuthTxSigner: recoveryArtifact.preAuthTxSigner,
    recoverySequence: recoveryPlan.sequence.recoverySequence,
    initialTooEarly,
    heartbeat: {
      transactionHashHex: heartbeatArtifact.transactionHashHex,
      observedAt: heartbeatSubmission.observedAt,
      includedInLedger: true,
      successful: true,
      sequenceBefore: initialAccount.sequence,
      sequenceAfter: afterHeartbeat.sequence,
      ledger: heartbeatSubmission.ledger
    },
    postHeartbeatTooEarly,
    eligibleSubmission: {
      innerTransactionHashHex: recoveryArtifact.transactionHashHex,
      outerTransactionHashHex: feeBumpArtifact.feeBumpTransactionHashHex,
      observedAt: recoverySubmission.observedAt,
      includedInLedger: true,
      successful: true,
      resultCode: 'txSUCCESS',
      ledger: recoverySubmission.ledger
    },
    feeBump: {
      innerTransactionHashHex: recoveryArtifact.transactionHashHex,
      outerTransactionHashHex: feeBumpArtifact.feeBumpTransactionHashHex,
      feeAccount: feeBumpPlan.feeAccount,
      feeStroops: feeBumpArtifact.totalFeeStroops
    },
    accountState: {
      before: {
        sequence: beforeRecovery.sequence,
        preAuthTxSignerPresent: hasPreAuthSigner(beforeRecovery, recoveryArtifact.preAuthTxSigner)
      },
      after: {
        sequence: afterRecovery.sequence,
        preAuthTxSignerPresent: hasPreAuthSigner(afterRecovery, recoveryArtifact.preAuthTxSigner)
      }
    },
    balanceMovements,
    finality
  });

  const verification = verifyStellarTestnetRecoveryEvidenceBundle(evidenceBundle);
  if (!verification.ok) throw new Error(`Constructed Stellar Testnet evidence failed self-verification: ${verification.errors.join('; ')}`);

  return Object.freeze({
    kind: 'stellar-testnet-recovery-proof',
    success: true,
    networkRef: 'stellar:testnet',
    recoveryTransactionHashHex: recoveryArtifact.transactionHashHex,
    feeBumpTransactionHashHex: feeBumpArtifact.feeBumpTransactionHashHex,
    evidenceBundle,
    actions: Object.freeze(actions),
    authorityBoundary: 'This runner orchestrates an explicitly supplied Stellar Testnet driver and pre-signed envelopes. It holds no signing keys and grants no mainnet, deployment, wallet or chain-promotion authority.'
  });
}
