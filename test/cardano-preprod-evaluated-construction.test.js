import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { buildCardanoEvaluationAdditionalUtxoSet } from '../src/chains/cardano/transaction-body.js';
import { buildCardanoPublicPreprodOgmiosEvaluationFixture } from '../src/chains/cardano/witness-set.js';
import {
  createCardanoPreprodEvidenceCapturePlan,
  createCardanoPreprodSynchronizedEvaluationEvidence
} from '../src/chains/cardano/preprod-evidence-harness.js';
import {
  createCardanoPreprodEvaluatedUnsignedConstruction,
  verifyCardanoPreprodEvaluatedUnsignedConstruction
} from '../src/chains/cardano/preprod-evaluated-construction.js';

const protocolSnapshot = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', import.meta.url), 'utf8'));
protocolSnapshot.source.independentSourceCount = 2;
protocolSnapshot.promotion.independentlyConfirmed = true;
const parameters = normalizeCardanoProtocolParameterSnapshot(protocolSnapshot);
const beacon = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/state-beacon.applied.json', import.meta.url), 'utf8'));
const vault = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/recovery-vault.applied.json', import.meta.url), 'utf8'));
const beaconCompiledCode = beacon.validators.find(item => item.title === 'omegavault.state_beacon.mint').compiledCode;
const recoveryCompiledCode = vault.validators.find(item => item.title === 'omegavault.recovery_vault.spend').compiledCode;

function fixture() {
  const action = 'execute';
  const evaluationSlot = 135634379;
  const evaluationCandidate = buildCardanoPublicPreprodOgmiosEvaluationFixture({
    action,
    parameters,
    recoveryCompiledCode,
    beaconCompiledCode,
    evaluationSlot
  });
  const capturePlan = createCardanoPreprodEvidenceCapturePlan({
    action,
    transactionCborHex: evaluationCandidate.transactionCborHex,
    additionalUtxoSet: buildCardanoEvaluationAdditionalUtxoSet(action, { evaluationSlot }),
    requestId: 'omegavault-live-execute'
  });
  const tipHash = protocolSnapshot.tip.blockHash;
  const acquiredTip = { hash: tipHash, epoch: protocolSnapshot.tip.epoch, slot: evaluationSlot, blockHeight: protocolSnapshot.tip.blockHeight };
  const ogmiosEvaluation = {
    tipBeforeHash: tipHash,
    tipAfterHash: tipHash,
    syntheticSupplementalUtxoContext: true,
    walletSigningPerformed: false,
    transactionSubmissionPerformed: false,
    response: {
      jsonrpc: '2.0',
      method: 'evaluateTransaction',
      id: capturePlan.evaluationRequest.id,
      result: [
        { validator: { purpose: 'mint', index: 0 }, budget: { memory: 91970, cpu: 27959404 } },
        { validator: { purpose: 'spend', index: 0 }, budget: { memory: 423054, cpu: 133367503 } }
      ]
    }
  };
  const evaluationEvidence = createCardanoPreprodSynchronizedEvaluationEvidence({
    plan: capturePlan,
    acquiredTip,
    protocolParameterSnapshot: protocolSnapshot,
    ogmiosEvaluation
  });
  return { capturePlan, evaluationEvidence };
}

function create(input = fixture()) {
  return createCardanoPreprodEvaluatedUnsignedConstruction({
    ...input,
    parameters,
    recoveryCompiledCode,
    beaconCompiledCode
  });
}

test('Cardano post-evaluation construction binds live budgets and excludes synthetic key witnesses', () => {
  const input = fixture();
  const result = create(input);
  assert.equal(result.schema, 'omegavault.cardano.preprod-evaluated-unsigned-construction.v1');
  assert.equal(result.action, 'execute');
  assert.equal(result.evaluatedBudgets['mint:0'].memory, '101167');
  assert.equal(result.evaluatedBudgets['spend:0'].memory, '465360');
  assert.equal(result.candidate.candidateKeyWitnessCount, 0);
  assert.equal(result.candidate.feeSizingKeyWitnessCount, 1);
  assert.equal(result.candidate.syntheticSizingWitnessesExcludedFromCandidate, true);
  assert.ok(result.candidate.feeSizingTransactionBytes > result.candidate.transactionBytes);
  assert.notEqual(result.candidate.transactionBodyHash, input.capturePlan.transactionBodyHash);
  assert.equal(result.phaseOneBoundary.evaluatedUnsignedConstructionComplete, true);
  assert.equal(result.phaseOneBoundary.ledgerUtxoExistenceValidated, false);
  assert.equal(result.phaseOneBoundary.fullPhaseOneValidated, false);
  assert.equal(result.liveActions.walletSigningAuthorized, false);
  assert.equal(result.liveActions.transactionSubmissionAuthorized, false);
  assert.match(result.constructionSha256, /^[0-9a-f]{64}$/);
});

test('Cardano post-evaluation construction is reproducible and tamper-detectable', () => {
  const input = fixture();
  const construction = create(input);
  const verified = verifyCardanoPreprodEvaluatedUnsignedConstruction({
    construction,
    ...input,
    parameters,
    recoveryCompiledCode,
    beaconCompiledCode
  });
  assert.equal(verified.valid, true, verified.errors.join('; '));

  const tampered = structuredClone(construction);
  tampered.candidate.minimumFee = String(BigInt(tampered.candidate.minimumFee) + 1n);
  const rejected = verifyCardanoPreprodEvaluatedUnsignedConstruction({
    construction: tampered,
    ...input,
    parameters,
    recoveryCompiledCode,
    beaconCompiledCode
  });
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some(error => /digest mismatch/i.test(error)));
});

test('Cardano post-evaluation construction fails closed on cross-wired action evidence', () => {
  const input = fixture();
  const crossWired = structuredClone(input.evaluationEvidence);
  crossWired.action = 'approve';
  assert.throws(
    () => create({
      ...input,
      evaluationEvidence: crossWired
    }),
    /cross-wired/
  );
});

test('Cardano post-evaluation construction rejects altered budgets even when the outer evidence digest is recomputed', () => {
  const input = fixture();
  const tampered = structuredClone(input.evaluationEvidence);
  tampered.evaluation.budgets[0].budget.memory = String(BigInt(tampered.evaluation.budgets[0].budget.memory) + 1n);

  assert.throws(
    () => create({
      ...input,
      evaluationEvidence: tampered
    }),
    /evidence self-digest mismatch/
  );

  const { evidenceSha256, ...core } = tampered;
  tampered.evidenceSha256 = hashCardanoEvidence(core);
  assert.throws(
    () => create({
      ...input,
      evaluationEvidence: tampered
    }),
    /bundle does not bind the supplied evaluation budgets/
  );
});

test('Cardano post-evaluation construction fails closed when a required evaluated budget is missing', () => {
  const input = fixture();
  const incomplete = structuredClone(input.evaluationEvidence);
  incomplete.evaluation.budgets = incomplete.evaluation.budgets.filter(item => item.validator !== 'mint:0');
  assert.throws(
    () => create({
      ...input,
      evaluationEvidence: incomplete
    }),
    /Missing evaluated validator budgets/
  );
});

test('Cardano post-evaluation construction bounds hostile budget precision before parsing', () => {
  const input = fixture();
  const hostile = structuredClone(input.evaluationEvidence);
  hostile.evaluation.budgets[0].budget.memory = '9'.repeat(1001);
  assert.throws(
    () => create({ ...input, evaluationEvidence: hostile }),
    /integer precision exceeds the supported limit/
  );
});
