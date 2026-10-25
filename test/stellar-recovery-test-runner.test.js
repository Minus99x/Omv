import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  buildFeeBumpEnvelopeArtifact,
  buildHeartbeatEnvelopeArtifact,
  buildRecoveryEnvelopeArtifact,
  createFeeBumpSponsorPlan,
  createHeartbeatPlan,
  createRecoveryEnvelopePlan
} from '../src/chains/stellar/native-recovery.js';
import { verifyStellarTestnetRecoveryEvidenceBundle } from '../src/chains/stellar/evidence-binding.js';
import { createStellarTestnetExecutionInputManifest } from '../src/chains/stellar/execution-input-manifest.js';
import { runStellarFailedAppliedRecoveryProof, runStellarTestnetRecoveryProof } from '../src/chains/stellar/recovery-test-runner.js';

const KP = n => Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(n));
const G = n => KP(n).publicKey();

function proofInputs() {
  const recoveryPlan = createRecoveryEnvelopePlan({
    vaultAccount:G(1),
    rescueDestination:G(2),
    currentSequence:'1000',
    inactivitySeconds:2,
    contacts:[G(3), G(4)],
    threshold:2,
    assets:['native', { code:'USDC', issuer:G(6) }],
    amounts:{ native:'10', [`USDC:${G(6)}`]:'20.5' }
  });
  const recoveryArtifact = buildRecoveryEnvelopeArtifact(recoveryPlan);
  const signedRecovery = TransactionBuilder.fromXdr(recoveryArtifact.transactionXdr, recoveryPlan.networkPassphrase);
  signedRecovery.sign(KP(3), KP(4));
  const signedRecoveryTransactionXdr = signedRecovery.toXdr();

  const heartbeatPlan = createHeartbeatPlan({ vaultAccount:G(1), currentSequence:'1001' });
  const heartbeatArtifact = buildHeartbeatEnvelopeArtifact({ vaultAccount:G(1), currentSequence:'1001' });
  const signedHeartbeat = TransactionBuilder.fromXdr(heartbeatArtifact.transactionXdr, heartbeatArtifact.networkPassphrase);
  signedHeartbeat.sign(KP(1));
  const signedHeartbeatTransactionXdr = signedHeartbeat.toXdr();

  const feeBumpPlan = createFeeBumpSponsorPlan({
    feeAccount:G(7),
    innerEnvelopeHash:recoveryArtifact.transactionHashHex,
    maxFeeStroops:'1000'
  });
  const feeBumpArtifact = buildFeeBumpEnvelopeArtifact({
    recoveryPlan,
    recoveryArtifact,
    signedRecoveryTransactionXdr,
    feeBumpPlan,
    baseFeeStroops:'200'
  });
  const signedFeeBump = TransactionBuilder.fromXdr(feeBumpArtifact.feeBumpTransactionXdr, feeBumpArtifact.networkPassphrase);
  signedFeeBump.sign(KP(7));

  const result = {
    recoveryPlan,
    recoveryArtifact,
    signedRecoveryTransactionXdr,
    heartbeatPlan,
    heartbeatArtifact,
    signedHeartbeatTransactionXdr,
    feeBumpPlan,
    feeBumpArtifact,
    signedFeeBumpTransactionXdr:signedFeeBump.toXdr()
  };
  return { ...result, executionManifest:createStellarTestnetExecutionInputManifest(result) };
}

function readySnapshot(inputs, sequence) {
  return {
    sequence:String(sequence),
    masterWeight:1,
    thresholds:{ low:1, medium:1, high:1 },
    signers:[{ type:'preAuthTx', key:inputs.recoveryArtifact.preAuthTxSigner, weight:1 }]
  };
}

function fakeDriver(inputs, overrides = {}) {
  const calls = [];
  let accountRead = 0;
  const balanceReads = new Map();

  const driver = {
    async readAccountSnapshot(account) {
      calls.push(['readAccountSnapshot', account]);
      accountRead += 1;
      if (typeof overrides.readAccountSnapshot === 'function') {
        return overrides.readAccountSnapshot({ account, accountRead, calls });
      }
      if (accountRead === 1) return readySnapshot(inputs, '1001');
      if (accountRead === 2) return readySnapshot(inputs, '1003');
      if (accountRead === 3) return readySnapshot(inputs, '1003');
      return {
        sequence:inputs.recoveryPlan.sequence.recoverySequence,
        masterWeight:1,
        thresholds:{ low:1, medium:1, high:1 },
        signers:[]
      };
    },

    async readBalanceUnits({ account, assetKey }) {
      calls.push(['readBalanceUnits', account, assetKey]);
      const key = `${account}|${assetKey}`;
      const count = (balanceReads.get(key) ?? 0) + 1;
      balanceReads.set(key, count);
      if (typeof overrides.readBalanceUnits === 'function') {
        const value = overrides.readBalanceUnits({ account, assetKey, count, calls });
        if (value != null) return value;
      }
      const vault = account === inputs.recoveryPlan.sourceAccount;
      if (assetKey === 'native') {
        if (vault) return count === 1 ? '1000000000' : '900000000';
        return count === 1 ? '50000000' : '150000000';
      }
      if (vault) return count === 1 ? '500000000' : '295000000';
      return count === 1 ? '10000000' : '215000000';
    },

    async submitEnvelope({ purpose, expectedTransactionHashHex }) {
      calls.push(['submitEnvelope', purpose]);
      if (typeof overrides.submitEnvelope === 'function') {
        const value = overrides.submitEnvelope({ purpose, expectedTransactionHashHex, calls });
        if (value != null) return value;
      }
      if (purpose === 'recovery-too-early-initial') {
        return {
          transactionHashHex:inputs.recoveryArtifact.transactionHashHex,
          observedAt:'2026-10-03T00:00:00Z',
          includedInLedger:false,
          successful:false,
          resultCode:'tx_bad_minseq_age_or_gap'
        };
      }
      if (purpose === 'heartbeat') {
        return {
          transactionHashHex:inputs.heartbeatArtifact.transactionHashHex,
          observedAt:'2026-10-03T00:01:00Z',
          includedInLedger:true,
          successful:true,
          resultCode:'txSUCCESS',
          ledger:'500'
        };
      }
      if (purpose === 'recovery-too-early-after-heartbeat') {
        return {
          transactionHashHex:inputs.recoveryArtifact.transactionHashHex,
          observedAt:'2026-10-03T00:02:00Z',
          includedInLedger:false,
          successful:false,
          resultCode:'tx_bad_minseq_age_or_gap'
        };
      }
      if (purpose === 'eligible-recovery-fee-bump') {
        return {
          transactionHashHex:inputs.feeBumpArtifact.feeBumpTransactionHashHex,
          observedAt:'2026-10-03T00:04:00Z',
          includedInLedger:true,
          successful:true,
          resultCode:'txSUCCESS',
          ledger:'501'
        };
      }
      throw new Error(`Unexpected purpose ${purpose}`);
    },

    async waitUntilEligible(request) {
      calls.push(['waitUntilEligible', request.currentSequence]);
      if (typeof overrides.waitUntilEligible === 'function') return overrides.waitUntilEligible({ request, calls });
      return { eligible:true, observedAt:'2026-10-03T00:03:00Z' };
    },

    async observeFinality({ transactionHashHex, ledger }) {
      calls.push(['observeFinality', transactionHashHex, ledger]);
      if (typeof overrides.observeFinality === 'function') return overrides.observeFinality({ transactionHashHex, ledger, calls });
      return {
        status:'finalized',
        transactionHashHex:inputs.feeBumpArtifact.feeBumpTransactionHashHex,
        ledger:'501',
        ledgerHash:'dd'.repeat(32),
        observedAt:'2026-10-03T00:05:00Z'
      };
    }
  };

  return { driver, calls };
}

test('Stellar Testnet proof runner orchestrates too-early, heartbeat reset, eligible fee-bump recovery and finality', async () => {
  const inputs = proofInputs();
  const fake = fakeDriver(inputs);
  const result = await runStellarTestnetRecoveryProof({ ...inputs, driver:fake.driver });
  assert.equal(result.success, true);
  assert.equal(result.kind, 'stellar-testnet-recovery-proof');
  assert.equal(result.networkRef, 'stellar:testnet');
  assert.equal(result.evidenceBundle.initialTooEarly.resultCode, 'tx_bad_minseq_age_or_gap');
  assert.equal(result.evidenceBundle.postHeartbeatTooEarly.resultCode, 'tx_bad_minseq_age_or_gap');
  assert.equal(result.evidenceBundle.eligibleSubmission.resultCode, 'txSUCCESS');
  assert.equal(result.evidenceBundle.accountState.after.preAuthTxSignerPresent, false);
  assert.equal(result.evidenceBundle.finality.status, 'finalized');
  assert.equal(result.evidenceBundle.observationSource, 'injected-driver');
  assert.equal(result.evidenceBundle.publicTestnetEvidenceReady, false);
  assert.deepEqual(verifyStellarTestnetRecoveryEvidenceBundle(result.evidenceBundle), { ok:true, errors:[] });
  assert.ok(fake.calls.some(call => call[0] === 'waitUntilEligible'));
  assert.ok(fake.calls.some(call => call[0] === 'observeFinality'));
});

test('Stellar Testnet proof runner refuses bad signed recovery before calling the driver', async () => {
  const inputs = proofInputs();
  const bad = TransactionBuilder.fromXdr(inputs.recoveryArtifact.transactionXdr, inputs.recoveryPlan.networkPassphrase);
  bad.sign(KP(3));
  inputs.signedRecoveryTransactionXdr = bad.toXdr();
  const fake = fakeDriver(inputs);
  await assert.rejects(
    () => runStellarTestnetRecoveryProof({ ...inputs, driver:fake.driver }),
    /Signed recovery artifact failed execution-manifest preflight/
  );
  assert.equal(fake.calls.length, 0);
});

test('Stellar Testnet proof runner requires the exact current execution manifest before calling the driver', async () => {
  const inputs = proofInputs();
  const fake = fakeDriver(inputs);
  const { executionManifest, ...withoutManifest } = inputs;
  await assert.rejects(
    () => runStellarTestnetRecoveryProof({ ...withoutManifest, driver:fake.driver }),
    /execution manifest failed preflight/
  );
  assert.equal(fake.calls.length, 0);

  const stale = { ...inputs, executionManifest:{ ...executionManifest, expectedInitialSequence:'1000' } };
  await assert.rejects(
    () => runStellarTestnetRecoveryProof({ ...stale, driver:fake.driver }),
    /execution manifest failed preflight/
  );
  assert.equal(fake.calls.length, 0);
});

test('Stellar Testnet proof runner requires initial tx_bad_minseq_age_or_gap before heartbeat', async () => {
  const inputs = proofInputs();
  const fake = fakeDriver(inputs, {
    submitEnvelope({ purpose, expectedTransactionHashHex }) {
      if (purpose === 'recovery-too-early-initial') {
        return {
          transactionHashHex:expectedTransactionHashHex,
          observedAt:'2026-10-03T00:00:00Z',
          includedInLedger:false,
          successful:false,
          resultCode:'txFAILED'
        };
      }
      return null;
    }
  });
  await assert.rejects(
    () => runStellarTestnetRecoveryProof({ ...inputs, driver:fake.driver }),
    /tx_bad_minseq_age_or_gap/
  );
  assert.equal(fake.calls.some(call => call[0] === 'submitEnvelope' && call[1] === 'heartbeat'), false);
});

test('Stellar Testnet proof runner rejects heartbeat sequence drift', async () => {
  const inputs = proofInputs();
  const fake = fakeDriver(inputs, {
    readAccountSnapshot({ accountRead }) {
      if (accountRead === 1) return readySnapshot(inputs, '1001');
      if (accountRead === 2) return readySnapshot(inputs, '1004');
      return null;
    }
  });
  await assert.rejects(
    () => runStellarTestnetRecoveryProof({ ...inputs, driver:fake.driver }),
    /does not match the applied heartbeat bump target/
  );
});

test('Stellar Testnet proof runner rejects rescue balance delta drift', async () => {
  const inputs = proofInputs();
  const fake = fakeDriver(inputs, {
    readBalanceUnits({ account, assetKey, count }) {
      if (account === inputs.recoveryPlan.rescueDestination && assetKey === 'native' && count === 2) return '149999999';
      return null;
    }
  });
  await assert.rejects(
    () => runStellarTestnetRecoveryProof({ ...inputs, driver:fake.driver }),
    /rescue delta/
  );
});

test('Stellar Testnet proof runner rejects finality cross-wired to another transaction', async () => {
  const inputs = proofInputs();
  const fake = fakeDriver(inputs, {
    observeFinality() {
      return {
        status:'finalized',
        transactionHashHex:'ee'.repeat(32),
        ledger:'501',
        ledgerHash:'dd'.repeat(32),
        observedAt:'2026-10-03T00:05:00Z'
      };
    }
  });
  await assert.rejects(
    () => runStellarTestnetRecoveryProof({ ...inputs, driver:fake.driver }),
    /bound to another transaction/
  );
});

test('Stellar Testnet proof runner fails closed when a required driver capability is absent', async () => {
  const inputs = proofInputs();
  const fake = fakeDriver(inputs);
  delete fake.driver.observeFinality;
  await assert.rejects(
    () => runStellarTestnetRecoveryProof({ ...inputs, driver:fake.driver }),
    /requires observeFinality/
  );
});


test('Stellar failed-applied proof runner records consumed preAuth signer and forbids same-envelope retry', async () => {
  const inputs = proofInputs();
  let reads = 0;
  const calls = [];
  const driver = {
    async readAccountSnapshot(account) {
      calls.push(['readAccountSnapshot', account]);
      reads += 1;
      if (reads === 1) return readySnapshot(inputs, '1003');
      return {
        sequence:inputs.recoveryPlan.sequence.recoverySequence,
        masterWeight:1,
        thresholds:{ low:1, medium:1, high:1 },
        signers:[]
      };
    },
    async submitEnvelope({ purpose, expectedTransactionHashHex }) {
      calls.push(['submitEnvelope', purpose, expectedTransactionHashHex]);
      return {
        transactionHashHex:inputs.feeBumpArtifact.feeBumpTransactionHashHex,
        observedAt:'2026-10-03T00:04:00Z',
        includedInLedger:true,
        successful:false,
        resultCode:'txFAILED',
        ledger:'501'
      };
    }
  };
  const result = await runStellarFailedAppliedRecoveryProof({ ...inputs, driver });
  assert.equal(result.success, true);
  assert.equal(result.kind, 'stellar-testnet-failed-applied-recovery-proof');
  assert.equal(result.evidenceBundle.preAuthSignerConsumed, true);
  assert.equal(result.evidenceBundle.retrySameEnvelope, false);
  assert.equal(result.evidenceBundle.observationSource, 'injected-driver');
  assert.equal(result.evidenceBundle.submission.innerTransactionHashHex, inputs.recoveryArtifact.transactionHashHex);
  assert.equal(result.evidenceBundle.submission.outerTransactionHashHex, inputs.feeBumpArtifact.feeBumpTransactionHashHex);
  assert.match(result.evidenceBundle.requiredAction, /rebuild/i);
  assert.equal(calls.filter(call => call[0] === 'submitEnvelope').length, 1);
});

test('Stellar failed-applied proof runner rejects outer-hash substitution', async () => {
  const inputs = proofInputs();
  let reads = 0;
  const driver = {
    async readAccountSnapshot() {
      reads += 1;
      if (reads === 1) return readySnapshot(inputs, '1003');
      return {
        sequence:inputs.recoveryPlan.sequence.recoverySequence,
        masterWeight:1,
        thresholds:{ low:1, medium:1, high:1 },
        signers:[]
      };
    },
    async submitEnvelope() {
      return {
        transactionHashHex:'ee'.repeat(32),
        observedAt:'2026-10-03T00:04:00Z',
        includedInLedger:true,
        successful:false,
        resultCode:'txFAILED',
        ledger:'501'
      };
    }
  };
  await assert.rejects(
    () => runStellarFailedAppliedRecoveryProof({ ...inputs, driver }),
    /different transaction hash/i
  );
});

test('Stellar failed-applied proof runner rejects signer-survival after applied failure', async () => {
  const inputs = proofInputs();
  let reads = 0;
  const driver = {
    async readAccountSnapshot() {
      reads += 1;
      if (reads === 1) return readySnapshot(inputs, '1003');
      return {
        ...readySnapshot(inputs, inputs.recoveryPlan.sequence.recoverySequence),
        sequence:inputs.recoveryPlan.sequence.recoverySequence
      };
    },
    async submitEnvelope() {
      return {
        transactionHashHex:inputs.feeBumpArtifact.feeBumpTransactionHashHex,
        observedAt:'2026-10-03T00:04:00Z',
        includedInLedger:true,
        successful:false,
        resultCode:'txFAILED',
        ledger:'501'
      };
    }
  };
  await assert.rejects(
    () => runStellarFailedAppliedRecoveryProof({ ...inputs, driver }),
    /did not consume the matching preAuthTx signer/i
  );
});


test('Stellar proof runner rejects unsafe/coercible account sequence before any envelope submission', async () => {
  const inputs = proofInputs();
  for (const sequence of [Number.MAX_SAFE_INTEGER + 1, true, {}, ['1001'], '01001', '1e3', 1.5]) {
    const fake = fakeDriver(inputs, {
      readAccountSnapshot({ accountRead }) {
        return { ...readySnapshot(inputs, accountRead === 1 ? '1001' : '1003'), sequence };
      }
    });
    await assert.rejects(
      () => runStellarTestnetRecoveryProof({ ...inputs, driver:fake.driver }),
      /initialAccount\.sequence must (use an exact integer string|be a canonical non-negative integer)/
    );
    assert.equal(fake.calls.some(call => call[0] === 'submitEnvelope'), false);
  }
});

test('Stellar proof runner rejects unsafe/coercible balance evidence before eligible recovery submission', async () => {
  const inputs = proofInputs();
  for (const value of [Number.MAX_SAFE_INTEGER + 1, true, {}, ['1000000000'], '01000000000', 1.5]) {
    const fake = fakeDriver(inputs, {
      readBalanceUnits({ account, assetKey, count }) {
        if (account === inputs.recoveryPlan.sourceAccount && assetKey === 'native' && count === 1) return value;
        return null;
      }
    });
    await assert.rejects(
      () => runStellarTestnetRecoveryProof({ ...inputs, driver:fake.driver }),
      /before balance for native must (use an exact integer string|be a canonical non-negative integer)/
    );
    assert.equal(fake.calls.some(call => call[0] === 'submitEnvelope' && call[1] === 'eligible-recovery-fee-bump'), false);
  }
});


test('Stellar proof runner bounds account sequence to signed XDR int64 before any submission', async () => {
  const inputs = proofInputs();
  for (const sequence of ['9223372036854775808', 9223372036854775808n]) {
    const fake = fakeDriver(inputs, {
      readAccountSnapshot() { return { ...readySnapshot(inputs, '1001'), sequence }; }
    });
    await assert.rejects(
      () => runStellarTestnetRecoveryProof({ ...inputs, driver:fake.driver }),
      /initialAccount\.sequence exceeds the Stellar on-chain integer range/
    );
    assert.equal(fake.calls.some(call => call[0] === 'submitEnvelope'), false);
  }
});

test('Stellar proof runner refuses out-of-range balances and ledgers rather than promoting impossible proof', async () => {
  const inputs = proofInputs();
  const overflowBalance = fakeDriver(inputs, {
    readBalanceUnits({ account, assetKey, count }) {
      if (account === inputs.recoveryPlan.sourceAccount && assetKey === 'native' && count === 1) {
        return '9223372036854775808';
      }
      return null;
    }
  });
  await assert.rejects(
    () => runStellarTestnetRecoveryProof({ ...inputs, driver:overflowBalance.driver }),
    /before balance for native exceeds the Stellar on-chain integer range/
  );
  assert.equal(overflowBalance.calls.some(call => call[0] === 'submitEnvelope' && call[1] === 'eligible-recovery-fee-bump'), false);

  const overflowLedger = fakeDriver(inputs, {
    submitEnvelope({ purpose }) {
      if (purpose !== 'heartbeat') return null;
      return {
        transactionHashHex:inputs.heartbeatArtifact.transactionHashHex,
        observedAt:'2026-10-03T00:01:00Z',
        includedInLedger:true, successful:true, resultCode:'txSUCCESS',
        ledger:'4294967296'
      };
    }
  });
  await assert.rejects(
    () => runStellarTestnetRecoveryProof({ ...inputs, driver:overflowLedger.driver }),
    /Heartbeat submission\.ledger exceeds the Stellar on-chain integer range/
  );
  assert.equal(overflowLedger.calls.some(call => call[0] === 'submitEnvelope' && call[1] === 'eligible-recovery-fee-bump'), false);
});
