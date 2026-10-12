import { createHash } from 'node:crypto';

const UINT = /^\d+$/;

function uint(value, label) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer when supplied as a number; use a decimal string for larger values.`);
  }
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new TypeError(`${label} must be an unsigned integer.`);
  }
  if (!UINT.test(String(value))) throw new TypeError(`${label} must be an unsigned integer.`);
  return BigInt(value);
}

function positive(value, label) {
  const result = uint(value, label);
  if (result < 1n) throw new TypeError(`${label} must be positive.`);
  return result;
}

function safePositiveInteger(value, label) {
  const number = positive(value, label);
  if (number > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${label} exceeds the safe integer range.`);
  return Number(number);
}

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

function costModelDigest(model) {
  return createHash('sha256').update(JSON.stringify(model)).digest('hex');
}

export function normalizeCardanoProtocolParameterSnapshot(snapshot) {
  if (!snapshot || snapshot.network !== 'preprod' || snapshot.networkId !== 0) throw new TypeError('A Preprod network-id 0 snapshot is required.');
  if (!snapshot.source || !Number.isSafeInteger(snapshot.source.independentSourceCount) || snapshot.source.independentSourceCount < 1) throw new TypeError('Snapshot provenance is required.');
  const params = snapshot.parameters;
  if (!params || params.era !== 'Conway' || !/^\d+\.\d+$/.test(params.protocolVersion)) throw new TypeError('Conway protocol-version metadata is required.');
  if (!Number.isSafeInteger(params.epoch) || params.epoch < 0 || !snapshot.tip || !Number.isSafeInteger(snapshot.tip.epoch) || params.epoch !== snapshot.tip.epoch) throw new TypeError('Protocol-parameter epoch must match the captured tip epoch.');
  if (!Array.isArray(params.plutusV3CostModel) || params.plutusV3CostModel.length !== 350 || params.plutusV3CostModel.some(value => !Number.isSafeInteger(value))) throw new TypeError('A complete 350-entry Plutus V3 cost model is required.');
  if (costModelDigest(params.plutusV3CostModel) !== params.plutusV3CostModelSha256) throw new Error('Plutus V3 cost-model digest mismatch.');

  const normalized = {
    epoch: params.epoch,
    era: params.era,
    protocolVersion: params.protocolVersion,
    minFeeA: positive(params.minFeeA, 'minFeeA'),
    minFeeB: positive(params.minFeeB, 'minFeeB'),
    maxTxSize: safePositiveInteger(params.maxTxSize, 'maxTxSize'),
    maxValueSize: params.maxValueSize == null ? null : safePositiveInteger(params.maxValueSize, 'maxValueSize'),
    coinsPerUtxoByte: positive(params.coinsPerUtxoByte, 'coinsPerUtxoByte'),
    priceMemory: { numerator: positive(params.priceMemory.numerator, 'priceMemory.numerator'), denominator: positive(params.priceMemory.denominator, 'priceMemory.denominator') },
    priceSteps: { numerator: positive(params.priceSteps.numerator, 'priceSteps.numerator'), denominator: positive(params.priceSteps.denominator, 'priceSteps.denominator') },
    maxTxExUnits: { memory: positive(params.maxTxExUnits.memory, 'maxTxExUnits.memory'), steps: positive(params.maxTxExUnits.steps, 'maxTxExUnits.steps') },
    collateralPercentage: positive(params.collateralPercentage, 'collateralPercentage'),
    maxCollateralInputs: safePositiveInteger(params.maxCollateralInputs, 'maxCollateralInputs'),
    plutusV3CostModel: Object.freeze([...params.plutusV3CostModel]),
    plutusV3CostModelSha256: params.plutusV3CostModelSha256,
    sourceCount: snapshot.source.independentSourceCount,
    independentlyConfirmed: snapshot.promotion?.independentlyConfirmed === true,
    eligibleForLiveTransactionConstruction: snapshot.promotion?.eligibleForLiveTransactionConstruction === true,
    connectorLiveProof: snapshot.promotion?.connectorLiveProof === true
  };
  return Object.freeze(normalized);
}

export function createCardanoProtocolParameterGate(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 1) throw new TypeError('At least one normalized snapshot is required.');
  for (const snapshot of snapshots) {
    if (!snapshot || !Number.isSafeInteger(snapshot.sourceCount) || snapshot.sourceCount < 1) {
      throw new TypeError('Each Cardano protocol snapshot requires a positive independent source count.');
    }
  }
  const first = snapshots[0];
  const fields = ['epoch', 'era', 'protocolVersion', 'minFeeA', 'minFeeB', 'maxTxSize', 'maxValueSize', 'coinsPerUtxoByte', 'collateralPercentage', 'maxCollateralInputs', 'plutusV3CostModelSha256'];
  // A missing field must never match another missing field by string coercion.
  // The gate consumes normalized snapshots, but still rejects malformed callers.
  const complete = snapshots.every(snapshot => snapshot.era === 'Conway' &&
    fields.every(field => snapshot[field] !== undefined && snapshot[field] !== null || field === 'maxValueSize' && snapshot[field] === null) &&
    snapshot.maxTxExUnits?.memory != null && snapshot.maxTxExUnits?.steps != null &&
    snapshot.priceMemory?.numerator != null && snapshot.priceMemory?.denominator != null &&
    snapshot.priceSteps?.numerator != null && snapshot.priceSteps?.denominator != null);
  const matching = complete && snapshots.every(snapshot => fields.every(field => String(snapshot[field]) === String(first[field])) &&
    snapshot.maxTxExUnits?.memory === first.maxTxExUnits?.memory &&
    snapshot.maxTxExUnits?.steps === first.maxTxExUnits?.steps &&
    snapshot.priceMemory?.numerator === first.priceMemory?.numerator &&
    snapshot.priceMemory?.denominator === first.priceMemory?.denominator &&
    snapshot.priceSteps?.numerator === first.priceSteps?.numerator &&
    snapshot.priceSteps?.denominator === first.priceSteps?.denominator);
  // Snapshots do not carry per-provider identities. Summing their counts would
  // allow the same provider evidence to be counted twice by passing duplicates.
  // Use the largest independently attested count, never additive counts.
  const sourceCount = Math.max(...snapshots.map(snapshot => snapshot.sourceCount));
  const confirmed = snapshots.every(snapshot => snapshot.independentlyConfirmed === true);
  const authorized = snapshots.every(snapshot => snapshot.eligibleForLiveTransactionConstruction === true && snapshot.connectorLiveProof === true);
  return Object.freeze({
    matching,
    independentSourceCount: sourceCount,
    liveConstructionReady: matching && sourceCount >= 2 && confirmed && authorized,
    reason: sourceCount < 2 ? 'At least two independent current Preprod sources are required.' :
      !complete ? 'Complete Conway protocol-parameter snapshots are required.' :
      !matching ? 'Protocol-parameter sources disagree.' :
      !confirmed ? 'Independent protocol-parameter confirmation is required.' :
      !authorized ? 'Explicit live construction eligibility and connector proof are required.' : null
  });
}

export function calculateCardanoExecutionFee({ memory, steps, parameters }) {
  const mem = uint(memory, 'memory');
  const cpu = uint(steps, 'steps');
  if (mem > parameters.maxTxExUnits.memory || cpu > parameters.maxTxExUnits.steps) throw new RangeError('Execution units exceed current maxTxExUnits.');
  const left = mem * parameters.priceMemory.numerator * parameters.priceSteps.denominator;
  const right = cpu * parameters.priceSteps.numerator * parameters.priceMemory.denominator;
  const denominator = parameters.priceMemory.denominator * parameters.priceSteps.denominator;
  return ceilDiv(left + right, denominator);
}

export function calculateCardanoMinimumFee({ transactionBytes, memory = 0, steps = 0, parameters }) {
  if (!Number.isSafeInteger(transactionBytes) || transactionBytes < 1) throw new TypeError('transactionBytes must be positive.');
  if (transactionBytes > parameters.maxTxSize) throw new RangeError('Transaction exceeds current maxTxSize.');
  const linearFee = parameters.minFeeA * BigInt(transactionBytes) + parameters.minFeeB;
  const executionFee = calculateCardanoExecutionFee({ memory, steps, parameters });
  return Object.freeze({
    linearFee: linearFee.toString(),
    executionFee: executionFee.toString(),
    minimumFee: (linearFee + executionFee).toString(),
    transactionBytes,
    exactForProvidedSizeAndExUnits: true
  });
}

export function calculateCardanoRequiredCollateral({ feeLovelace, parameters, collateralInputCount = 1, collateralIsAdaOnly = true }) {
  const fee = positive(feeLovelace, 'feeLovelace');
  if (!Number.isSafeInteger(collateralInputCount) || collateralInputCount < 1 || collateralInputCount > parameters.maxCollateralInputs) throw new RangeError('Collateral input count exceeds current protocol limits.');
  if (collateralIsAdaOnly !== true) throw new Error('Collateral inputs must contain ADA only.');
  return Object.freeze({
    requiredCollateral: ceilDiv(fee * parameters.collateralPercentage, 100n).toString(),
    collateralPercentage: parameters.collateralPercentage.toString(),
    collateralInputCount,
    collateralIsAdaOnly: true
  });
}

