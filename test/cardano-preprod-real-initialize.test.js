import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import {
  CARDANO_PREPROD_NETWORK_ID
} from '../src/chains/cardano/transaction-body.js';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';
import { createCardanoPreprodAppliedValidatorIdentity } from '../src/chains/cardano/live-validator-identity.js';
import {
  createCardanoPreprodRealUtxoBindingEvidence,
  createCardanoPreprodRealUtxoBindingPlan
} from '../src/chains/cardano/preprod-real-utxo-binding.js';
import { buildCardanoPreprodRealInitializeCandidate, verifyCardanoPreprodRealInitializeCandidate } from '../src/chains/cardano/preprod-real-initialize.js';
import { createCardanoPreprodUnsignedInitializePreflight, verifyCardanoPreprodUnsignedInitializePreflight } from '../src/chains/cardano/preprod-unsigned-initialize-preflight.js';

const protocolSnapshot = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', import.meta.url), 'utf8'));
protocolSnapshot.source.independentSourceCount = 2;
protocolSnapshot.promotion.independentlyConfirmed = true;
protocolSnapshot.parameters.maxValueSize = 5000;
const parameters = normalizeCardanoProtocolParameterSnapshot(protocolSnapshot);

const fixtureEvidence = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_APPLIED_FIXTURE_0.6.12.json', import.meta.url), 'utf8'));
const beaconBlueprint = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/state-beacon.applied.json', import.meta.url), 'utf8'));
const vaultBlueprint = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/recovery-vault.applied.json', import.meta.url), 'utf8'));
const beaconCompiledCode = beaconBlueprint.validators.find(item => item.title === 'omegavault.state_beacon.mint').compiledCode;
const recoveryCompiledCode = vaultBlueprint.validators.find(item => item.title === 'omegavault.recovery_vault.spend').compiledCode;

function walletAddress(keyHex) {
  return Cardano.EnterpriseAddress.new(
    CARDANO_PREPROD_NETWORK_ID,
    Cardano.Credential.from_keyhash(Cardano.Ed25519KeyHash.from_hex(keyHex))
  ).to_address().to_bech32();
}

function identity() {
  return createCardanoPreprodAppliedValidatorIdentity({
    seedReference: {
      transaction: { id: fixtureEvidence.parameters.seedTxId },
      index: fixtureEvidence.parameters.seedOutputIndex
    },
    assetNameHex: fixtureEvidence.parameters.assetNameHex,
    sourceBlueprintSha256: createHash('sha256').update(readFileSync(new URL('../validators/cardano/plutus.json', import.meta.url))).digest('hex'),
    beaconCompiledCode,
    recoveryCompiledCode,
    aikenPolicyId: fixtureEvidence.stateBeacon.policyId,
    aikenRecoveryHash: fixtureEvidence.recoveryVault.scriptHash,
    aikenRecoveryAddress: fixtureEvidence.recoveryVault.preprodAddress
  });
}

function binding(appliedIdentity) {
  const ownerAddress = walletAddress('11'.repeat(28));
  const roles = {
    seed: { transaction: { id: fixtureEvidence.parameters.seedTxId }, index: fixtureEvidence.parameters.seedOutputIndex },
    collateral: { transaction: { id: '12'.repeat(32) }, index: 0 }
  };
  const plan = createCardanoPreprodRealUtxoBindingPlan({
    action: 'initialize',
    roles,
    appliedValidatorIdentity: appliedIdentity
  });
  const tip = { hash: 'aa'.repeat(32), slot: 135700000 };
  return createCardanoPreprodRealUtxoBindingEvidence({
    plan,
    tipBefore: tip,
    tipAfter: tip,
    queriedUtxo: [
      { ...roles.seed, address: ownerAddress, value: { ada: { lovelace: '20000000' } } },
      { ...roles.collateral, address: ownerAddress, value: { ada: { lovelace: '5000000' } } }
    ]
  });
}

const recoveryConfig = Object.freeze({
  rescueKeyHash: '66'.repeat(28),
  contactKeyHashes: ['22'.repeat(28), '33'.repeat(28)],
  threshold: 2,
  inactivityMs: 60000,
  stateLovelace: '10000000'
});

test('Cardano real initialize evaluation candidate is balanced, unsigned and ledger-resolvable without supplemental UTxO', () => {
  const appliedIdentity = identity();
  const utxoBindingEvidence = binding(appliedIdentity);
  const candidate = buildCardanoPreprodRealInitializeCandidate({
    appliedValidatorIdentity: appliedIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig,
    evaluationMode: true
  });

  assert.equal(candidate.action, 'initialize');
  assert.equal(candidate.evaluation.mode, 'zero-budget-live-evaluation-candidate');
  assert.equal(candidate.evaluation.mintBudget.memory, '0');
  assert.equal(candidate.evaluation.mintBudget.steps, '0');
  assert.equal(candidate.evaluation.requiresLiveEvaluation, true);
  assert.equal(candidate.evaluation.evaluationSupplementalUtxoRequired, false);
  assert.equal(Object.hasOwn(candidate.evaluation.request.params, 'additionalUtxo'), false);
  assert.equal(candidate.transaction.keyWitnessCount, 0);
  assert.equal(candidate.checks.valueConservationChecked, true);
  assert.equal(candidate.checks.stateMinimumAda.satisfied, true);
  assert.equal(candidate.checks.changeMinimumAda.satisfied, true);
  assert.equal(candidate.checks.collateralReturnMinimumAda.satisfied, true);
  assert.equal(candidate.checks.fullPhaseOneValidated, false);
  assert.equal(candidate.liveActions.walletSigningAuthorized, false);
  assert.equal(candidate.liveActions.transactionSubmissionAuthorized, false);
  assert.match(candidate.candidateSha256, /^[0-9a-f]{64}$/);

  const tx = Cardano.Transaction.from_hex(candidate.transaction.cborHex);
  assert.equal(tx.body().inputs().len(), 1);
  assert.equal(tx.body().collateral().len(), 1);
  assert.equal(tx.body().outputs().len(), 2);
  assert.equal(tx.witness_set().vkeys(), undefined);
  assert.equal(tx.body().required_signers().len(), 1);
});

test('Cardano real initialize rejects a rescue destination that collapses into the owner role', () => {
  const appliedIdentity = identity();
  const utxoBindingEvidence = binding(appliedIdentity);
  assert.throws(
    () => buildCardanoPreprodRealInitializeCandidate({
      appliedValidatorIdentity: appliedIdentity,
      utxoBindingEvidence,
      parameters,
      recoveryConfig: { ...recoveryConfig, rescueKeyHash: '11'.repeat(28) },
      evaluationMode: true
    }),
    /owner cannot also be the rescue destination/
  );
});

test('Cardano real initialize rejects coercive recovery-policy integer inputs', () => {
  const appliedIdentity = identity();
  const utxoBindingEvidence = binding(appliedIdentity);
  for (const invalid of [
    { threshold: true },
    { inactivityMs: true },
    { threshold: '0x2' },
    { inactivityMs: '6e4' }
  ]) {
    assert.throws(
      () => buildCardanoPreprodRealInitializeCandidate({
        appliedValidatorIdentity: appliedIdentity,
        utxoBindingEvidence,
        parameters,
        recoveryConfig: { ...recoveryConfig, ...invalid },
        evaluationMode: true
      }),
      /must be a positive safe integer/
    );
  }
});

test('Cardano real initialize live-budget candidate applies evaluated budget while remaining unsigned and non-submit-authorized', () => {
  const appliedIdentity = identity();
  const utxoBindingEvidence = binding(appliedIdentity);
  const evaluationCandidate = buildCardanoPreprodRealInitializeCandidate({
    appliedValidatorIdentity: appliedIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig,
    evaluationMode: true
  });
  const finalCandidate = buildCardanoPreprodRealInitializeCandidate({
    appliedValidatorIdentity: appliedIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig,
    evaluationMode: false,
    mintBudget: { memory: '101167', steps: '30755345' }
  });

  assert.equal(finalCandidate.evaluation.mode, 'live-budget-applied-unsigned-candidate');
  assert.equal(finalCandidate.evaluation.mintBudget.memory, '101167');
  assert.equal(finalCandidate.evaluation.requiresLiveEvaluation, false);
  assert.equal(finalCandidate.evaluation.request, null);
  assert.deepEqual(finalCandidate.evaluation.expectedValidators, ['mint:0']);
  assert.notEqual(finalCandidate.transaction.bodyHash, evaluationCandidate.transaction.bodyHash);
  assert.ok(BigInt(finalCandidate.transaction.feeLovelace) > BigInt(evaluationCandidate.transaction.feeLovelace));
  assert.equal(finalCandidate.transaction.keyWitnessCount, 0);
  assert.equal(finalCandidate.checks.fullPhaseOneValidated, false);
  assert.equal(finalCandidate.liveActions.walletSigningAuthorized, false);
  assert.equal(finalCandidate.liveActions.transactionSubmissionAuthorized, false);
});

test('Cardano unsigned initialize preflight verifies real-input structure without escalating to full phase-one', () => {
  const appliedIdentity = identity();
  const utxoBindingEvidence = binding(appliedIdentity);
  const mintBudget = { memory: '101167', steps: '30755345' };
  const candidate = buildCardanoPreprodRealInitializeCandidate({
    appliedValidatorIdentity: appliedIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig,
    evaluationMode: false,
    mintBudget
  });
  const preflight = createCardanoPreprodUnsignedInitializePreflight({
    candidate,
    appliedValidatorIdentity: appliedIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig
  });
  assert.equal(preflight.checks.unsignedPhaseOnePreflightComplete, true);
  assert.equal(preflight.checks.walletWitnessesPresent, false);
  assert.equal(preflight.checks.walletWitnessesValidated, false);
  assert.equal(preflight.checks.fullPhaseOneValidated, false);
  assert.equal(preflight.liveActions.walletSigningAuthorized, false);
  assert.equal(preflight.liveActions.transactionSubmissionAuthorized, false);
  assert.match(preflight.preflightSha256, /^[0-9a-f]{64}$/);

  const verified = verifyCardanoPreprodUnsignedInitializePreflight({
    preflight,
    candidate,
    appliedValidatorIdentity: appliedIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig
  });
  assert.equal(verified.valid, true, verified.errors.join('; '));

  const tampered = structuredClone(preflight);
  tampered.checks.fullPhaseOneValidated = true;
  const rejected = verifyCardanoPreprodUnsignedInitializePreflight({
    preflight: tampered,
    candidate,
    appliedValidatorIdentity: appliedIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig
  });
  assert.equal(rejected.valid, false);
});

test('Cardano unsigned initialize preflight rejects missing or insufficient current maxValueSize evidence', () => {
  const appliedIdentity = identity();
  const utxoBindingEvidence = binding(appliedIdentity);
  const mintBudget = { memory: '101167', steps: '30755345' };
  const candidate = buildCardanoPreprodRealInitializeCandidate({
    appliedValidatorIdentity: appliedIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig,
    evaluationMode: false,
    mintBudget
  });

  assert.throws(
    () => createCardanoPreprodUnsignedInitializePreflight({
      candidate,
      appliedValidatorIdentity: appliedIdentity,
      utxoBindingEvidence,
      parameters: Object.freeze({ ...parameters, maxValueSize: null }),
      recoveryConfig
    }),
    /requires the current Cardano maxValueSize/
  );
  assert.throws(
    () => createCardanoPreprodUnsignedInitializePreflight({
      candidate,
      appliedValidatorIdentity: appliedIdentity,
      utxoBindingEvidence,
      parameters: Object.freeze({ ...parameters, maxValueSize: 1 }),
      recoveryConfig
    }),
    /serialized value exceeds current maxValueSize/
  );
});

test('Cardano real initialize candidate verifier reproduces exact evidence and rejects tampering', () => {
  const appliedIdentity = identity();
  const utxoBindingEvidence = binding(appliedIdentity);
  const candidate = buildCardanoPreprodRealInitializeCandidate({
    appliedValidatorIdentity: appliedIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig,
    evaluationMode: true
  });
  const verified = verifyCardanoPreprodRealInitializeCandidate({
    candidate,
    appliedValidatorIdentity: appliedIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig,
    evaluationMode: true
  });
  assert.equal(verified.valid, true, verified.errors.join('; '));

  const tampered = structuredClone(candidate);
  tampered.transaction.feeLovelace = String(BigInt(tampered.transaction.feeLovelace) + 1n);
  const rejected = verifyCardanoPreprodRealInitializeCandidate({
    candidate: tampered,
    appliedValidatorIdentity: appliedIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig,
    evaluationMode: true
  });
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some(error => /digest mismatch|does not reproduce/i.test(error)));
});

test('Cardano real initialize candidate accepts the Aiken provenance wrapper emitted by live derivation', () => {
  const baseIdentity = identity();
  const appliedIdentity = Object.freeze({
    ...baseIdentity,
    provenance: Object.freeze({
      aikenVersion: 'aiken v1.1.24+bacbeb3',
      sourceBlueprint: 'validators/cardano/plutus.json',
      beaconAppliedBlueprintSha256: 'aa'.repeat(32),
      recoveryAppliedBlueprintSha256: 'bb'.repeat(32)
    })
  });
  const utxoBindingEvidence = binding(appliedIdentity);

  const candidate = buildCardanoPreprodRealInitializeCandidate({
    appliedValidatorIdentity: appliedIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig,
    evaluationMode: true
  });

  assert.equal(candidate.validatorIdentitySha256, baseIdentity.identitySha256);
  assert.equal(candidate.liveActions.walletSigningAuthorized, false);
  assert.equal(candidate.liveActions.transactionSubmissionAuthorized, false);
  assert.match(candidate.candidateSha256, /^[0-9a-f]{64}$/);
});

test('Cardano real initialize candidate fails closed on validator/binding identity mismatch', () => {
  const appliedIdentity = identity();
  const utxoBindingEvidence = structuredClone(binding(appliedIdentity));
  utxoBindingEvidence.validatorIdentitySha256 = 'ff'.repeat(32);

  assert.throws(
    () => buildCardanoPreprodRealInitializeCandidate({
      appliedValidatorIdentity: appliedIdentity,
      utxoBindingEvidence,
      parameters,
      recoveryConfig,
      evaluationMode: true
    }),
    /different applied validator identity/
  );
});

test('Cardano real initialize candidate rejects tampered binding evidence and wallet-address substitution', () => {
  const appliedIdentity = identity();
  const originalBinding = binding(appliedIdentity);
  const attackerAddress = walletAddress('22'.repeat(28));
  const candidateOptions = {
    appliedValidatorIdentity: appliedIdentity,
    parameters,
    recoveryConfig,
    evaluationMode: true
  };

  const staleDigest = structuredClone(originalBinding);
  staleDigest.roles.seed.address = attackerAddress;
  assert.throws(
    () => buildCardanoPreprodRealInitializeCandidate({
      ...candidateOptions,
      utxoBindingEvidence: staleDigest
    }),
    /evidence digest/
  );

  for (const role of ['seed', 'collateral']) {
    const substituted = structuredClone(originalBinding);
    substituted.roles[role].address = attackerAddress;
    substituted.evidenceSha256 = hashCardanoEvidence(
      Object.fromEntries(Object.entries(substituted).filter(([key]) => key !== 'evidenceSha256'))
    );
    assert.throws(
      () => buildCardanoPreprodRealInitializeCandidate({
        ...candidateOptions,
        utxoBindingEvidence: substituted
      }),
      new RegExp(`${role} UTxO address does not match the bound wallet payment key`)
    );
  }
});

test('Cardano real initialize rejects recomputed binding evidence that aliases seed and collateral', () => {
  const appliedIdentity = identity();
  const originalBinding = binding(appliedIdentity);
  for (const transactionId of [
    originalBinding.roles.seed.reference.transaction.id,
    originalBinding.roles.seed.reference.transaction.id.toUpperCase()
  ]) {
    const aliasedBinding = structuredClone(originalBinding);
    aliasedBinding.roles.collateral.reference = {
      transaction: { id: transactionId },
      index: aliasedBinding.roles.seed.reference.index
    };
    aliasedBinding.evidenceSha256 = hashCardanoEvidence(
      Object.fromEntries(Object.entries(aliasedBinding).filter(([key]) => key !== 'evidenceSha256'))
    );

    assert.throws(
      () => buildCardanoPreprodRealInitializeCandidate({
        appliedValidatorIdentity: appliedIdentity,
        utxoBindingEvidence: aliasedBinding,
        parameters,
        recoveryConfig,
        evaluationMode: true
      }),
      /seed and collateral must use distinct output references/
    );
  }
});
