import { createHash } from 'node:crypto';

const UINT = /^\d+$/;

function uint(value, label) {
  if (!UINT.test(String(value))) throw new TypeError(`${label} must be an unsigned integer.`);
  return BigInt(value);
}

function positive(value, label) {
  const result = uint(value, label);
  if (result < 1n) throw new TypeError(`${label} must be positive.`);
  return result;
}

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

function costModelDigest(model) {
  return createHash('sha256').update(JSON.stringify(model)).digest('hex');
}

export function normalizeCardanoProtocolParameterSnapshot(snapshot) {
  if (!snapshot || snapshot.network !== 'preprod' || snapshot.networkId !== 0) throw new TypeError('A Preprod network-id 0 snapshot is required.');
  if (!snapshot.source || !Number.isInteger(snapshot.source.independentSourceCount) || snapshot.source.independentSourceCount < 1) throw new TypeError('Snapshot provenance is required.');
  const params = snapshot.parameters;
  if (!params || params.era !== 'Conway' || !/^\d+\.\d+$/.test(params.protocolVersion)) throw new TypeError('Conway protocol-version metadata is required.');
  if (!Number.isInteger(params.epoch) || params.epoch < 0 || params.epoch !== snapshot.tip.epoch) throw new TypeError('Protocol-parameter epoch must match the captured tip epoch.');
  if (!Array.isArray(params.plutusV3CostModel) || params.plutusV3CostModel.length !== 350 || params.plutusV3CostModel.some(value => !Number.isSafeInteger(value))) throw new TypeError('A complete 350-entry Plutus V3 cost model is required.');
  if (costModelDigest(params.plutusV3CostModel) !== params.plutusV3CostModelSha256) throw new Error('Plutus V3 cost-model digest mismatch.');

  const normalized = {
    epoch: params.epoch,
    era: params.era,
    protocolVersion: params.protocolVersion,
    minFeeA: positive(params.minFeeA, 'minFeeA'),
    minFeeB: positive(params.minFeeB, 'minFeeB'),
    maxTxSize: Number(positive(params.maxTxSize, 'maxTxSize')),
    maxValueSize: params.maxValueSize == null ? null : Number(positive(params.maxValueSize, 'maxValueSize')),
    coinsPerUtxoByte: positive(params.coinsPerUtxoByte, 'coinsPerUtxoByte'),
    priceMemory: { numerator: positive(params.priceMemory.numerator, 'priceMemory.numerator'), denominator: positive(params.priceMemory.denominator, 'priceMemory.denominator') },
    priceSteps: { numerator: positive(params.priceSteps.numerator, 'priceSteps.numerator'), denominator: positive(params.priceSteps.denominator, 'priceSteps.denominator') },
    maxTxExUnits: { memory: positive(params.maxTxExUnits.memory, 'maxTxExUnits.memory'), steps: positive(params.maxTxExUnits.steps, 'maxTxExUnits.steps') },
    collateralPercentage: positive(params.collateralPercentage, 'collateralPercentage'),
    maxCollateralInputs: Number(positive(params.maxCollateralInputs, 'maxCollateralInputs')),
    plutusV3CostModel: Object.freeze([...params.plutusV3CostModel]),
    plutusV3CostModelSha256: params.plutusV3CostModelSha256,
    sourceCount: snapshot.source.independentSourceCount,
    independentlyConfirmed: snapshot.promotion?.independentlyConfirmed === true
  };
  return Object.freeze(normalized);
}

export function createCardanoProtocolParameterGate(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 1) throw new TypeError('At least one normalized snapshot is required.');
  const first = snapshots[0];
  const fields = ['epoch', 'protocolVersion', 'minFeeA', 'minFeeB', 'maxTxSize', 'maxValueSize', 'coinsPerUtxoByte', 'collateralPercentage', 'maxCollateralInputs', 'plutusV3CostModelSha256'];
  const matching = snapshots.every(snapshot => fields.every(field => String(snapshot[field]) === String(first[field])));
  const sourceCount = snapshots.reduce((total, snapshot) => total + snapshot.sourceCount, 0);
  return Object.freeze({
    matching,
    independentSourceCount: sourceCount,
    liveConstructionReady: matching && sourceCount >= 2 && snapshots.every(snapshot => snapshot.independentlyConfirmed),
    reason: sourceCount < 2 ? 'At least two independent current Preprod sources are required.' : matching ? null : 'Protocol-parameter sources disagree.'
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
  if (!Number.isInteger(collateralInputCount) || collateralInputCount < 1 || collateralInputCount > parameters.maxCollateralInputs) throw new RangeError('Collateral input count exceeds current protocol limits.');
  if (!collateralIsAdaOnly) throw new Error('Collateral inputs must contain ADA only.');
  return Object.freeze({
    requiredCollateral: ceilDiv(fee * parameters.collateralPercentage, 100n).toString(),
    collateralPercentage: parameters.collateralPercentage.toString(),
    collateralInputCount,
    collateralIsAdaOnly: true
  });
}

