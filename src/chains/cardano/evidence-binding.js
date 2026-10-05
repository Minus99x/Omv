import { createHash } from 'node:crypto';

const HEX_32 = /^[0-9a-f]{64}$/i;
const HEX = /^(?:[0-9a-f]{2})+$/i;

function assertHex32(value, label) {
  if (typeof value !== 'string' || !HEX_32.test(value)) throw new TypeError(`${label} must be 32-byte hex.`);
  return value.toLowerCase();
}

function assertText(value, label) {
  if (typeof value !== 'string' || value.length < 1) throw new TypeError(`${label} is required.`);
  return value;
}

function canonicalize(value, path = '$') {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must contain plain evidence objects only.`);
    const result = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') throw new TypeError(`${path}.${key} contains unsupported evidence data.`);
      result[key] = canonicalize(item, `${path}.${key}`);
    }
    return result;
  }
  throw new TypeError(`${path} contains unsupported evidence data.`);
}

export function canonicalCardanoEvidenceJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function hashCardanoEvidence(value) {
  return createHash('sha256').update(canonicalCardanoEvidenceJson(value)).digest('hex');
}

function phaseOnePassed(validation) {
  return validation?.passed === true &&
    validation?.balanced === true &&
    validation?.minimumAdaSatisfied === true &&
    validation?.collateralSatisfied === true &&
    validation?.witnessesSatisfied === true;
}

export function createCardanoEvaluationEvidenceBundle({
  network = 'preprod',
  transactionBodyHash,
  transactionCborHex,
  synchronizedState,
  utxoSnapshot,
  protocolParameters,
  evaluation,
  phaseOneValidation
}) {
  if (network !== 'preprod') throw new Error('Only Cardano Preprod evidence may be promoted by this gate.');
  const bodyHash = assertHex32(transactionBodyHash, 'transactionBodyHash');
  if (typeof transactionCborHex !== 'string' || !HEX.test(transactionCborHex)) throw new TypeError('transactionCborHex must be non-empty base16 CBOR.');
  if (!utxoSnapshot || !protocolParameters || !evaluation || !phaseOneValidation) throw new TypeError('UTxO, protocol-parameter, evaluation and phase-1 evidence are all required.');
  if (!phaseOnePassed(phaseOneValidation)) throw new Error('Complete phase-1 validation must pass before Cardano evaluation evidence can be bound.');

  const tipFields = [
    'acquiredTipHash',
    'protocolParametersTipHash',
    'utxoSnapshotTipHash',
    'evaluationTipHash',
    'phaseOneTipHash'
  ];
  const tips = tipFields.map(field => assertText(synchronizedState?.[field], `synchronizedState.${field}`));
  if (new Set(tips).size !== 1) throw new Error('Cardano evidence components are not bound to one acquired node tip.');
  const tipHash = tips[0];

  const transactionHashes = [
    ['synchronizedState.transactionBodyHash', synchronizedState?.transactionBodyHash],
    ['synchronizedState.evaluationTransactionBodyHash', synchronizedState?.evaluationTransactionBodyHash],
    ['synchronizedState.phaseOneTransactionBodyHash', synchronizedState?.phaseOneTransactionBodyHash],
    ['phaseOneValidation.transactionBodyHash', phaseOneValidation?.transactionBodyHash],
    ['evaluation.transactionBodyHash', evaluation?.transactionBodyHash]
  ].map(([label, value]) => assertHex32(value, label));
  if (transactionHashes.some(value => value !== bodyHash)) throw new Error('Cardano evaluation or phase-1 evidence is bound to a different transaction body.');

  const componentDigests = Object.freeze({
    utxoSnapshotSha256: hashCardanoEvidence(utxoSnapshot),
    protocolParametersSha256: hashCardanoEvidence(protocolParameters),
    evaluationSha256: hashCardanoEvidence(evaluation),
    phaseOneValidationSha256: hashCardanoEvidence(phaseOneValidation)
  });

  const core = Object.freeze({
    schema: 'omegavault.cardano.evaluation-evidence.v1',
    network,
    tipHash,
    transaction: Object.freeze({
      bodyHash,
      cborSha256: createHash('sha256').update(Buffer.from(transactionCborHex, 'hex')).digest('hex')
    }),
    components: componentDigests
  });

  return Object.freeze({
    ...core,
    bundleSha256: hashCardanoEvidence(core),
    phaseOneValidated: true,
    synchronized: true,
    promotionReadyEvidenceBinding: true
  });
}


export function createCardanoSynchronizedEvaluationBundle({
  network = 'preprod',
  transactionBodyHash,
  transactionCborHex,
  synchronizedState,
  protocolParameters,
  evaluation,
  evaluationRequest
}) {
  if (network !== 'preprod') throw new Error('Only Cardano Preprod evidence may be accepted by this gate.');
  const bodyHash = assertHex32(transactionBodyHash, 'transactionBodyHash');
  if (typeof transactionCborHex !== 'string' || !HEX.test(transactionCborHex)) throw new TypeError('transactionCborHex must be non-empty base16 CBOR.');
  if (!protocolParameters || !evaluation || !evaluationRequest) throw new TypeError('Protocol-parameter, evaluation-request and evaluation-response evidence are required.');

  const tipFields = [
    'acquiredTipHash',
    'protocolParametersTipHash',
    'evaluationTipBeforeHash',
    'evaluationTipAfterHash'
  ];
  const tips = tipFields.map(field => assertText(synchronizedState?.[field], `synchronizedState.${field}`));
  if (new Set(tips).size !== 1) throw new Error('Cardano evaluation evidence is not bracketed by one stable acquired node tip.');
  const tipHash = tips[0];

  const transactionHashes = [
    ['synchronizedState.transactionBodyHash', synchronizedState?.transactionBodyHash],
    ['synchronizedState.evaluationTransactionBodyHash', synchronizedState?.evaluationTransactionBodyHash],
    ['evaluation.transactionBodyHash', evaluation?.transactionBodyHash]
  ].map(([label, value]) => assertHex32(value, label));
  if (transactionHashes.some(value => value !== bodyHash)) throw new Error('Cardano evaluation evidence is bound to a different transaction body.');

  if (evaluationRequest?.method !== 'evaluateTransaction') throw new Error('Cardano evaluation request must use evaluateTransaction.');
  if (evaluationRequest?.params?.transaction?.cbor?.toLowerCase() !== transactionCborHex.toLowerCase()) {
    throw new Error('Cardano evaluation request CBOR does not match the bound candidate.');
  }
  if (!Array.isArray(evaluationRequest?.params?.additionalUtxoSet) || evaluationRequest.params.additionalUtxoSet.length < 1) {
    throw new Error('Cardano evaluation request must carry an explicit supplemental UTxO context for the offline fixture inputs.');
  }

  const componentDigests = Object.freeze({
    protocolParametersSha256: hashCardanoEvidence(protocolParameters),
    evaluationRequestSha256: hashCardanoEvidence(evaluationRequest),
    supplementalUtxoSha256: hashCardanoEvidence(evaluationRequest.params.additionalUtxoSet),
    evaluationSha256: hashCardanoEvidence(evaluation)
  });

  const core = Object.freeze({
    schema: 'omegavault.cardano.synchronized-evaluation-evidence.v2',
    network,
    tipHash,
    transaction: Object.freeze({
      bodyHash,
      cborSha256: createHash('sha256').update(Buffer.from(transactionCborHex, 'hex')).digest('hex')
    }),
    components: componentDigests,
    evidenceBoundary: Object.freeze({
      unsignedEvaluationOnly: true,
      syntheticSupplementalUtxoContext: true,
      fullPhaseOneValidated: false,
      walletWitnessesValidated: false,
      submissionValidated: false
    })
  });

  return Object.freeze({
    ...core,
    bundleSha256: hashCardanoEvidence(core),
    synchronized: true,
    promotionReadyEvidenceBinding: false
  });
}
