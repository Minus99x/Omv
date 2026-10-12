import { createHash } from 'node:crypto';

function integer(value, label) {
  if (!['string', 'number', 'bigint'].includes(typeof value) ||
      (typeof value === 'number' && !Number.isSafeInteger(value)) ||
      !/^\d+$/.test(String(value))) {
    throw new TypeError(`${label} must be a precise non-negative integer.`);
  }
  return BigInt(value).toString();
}

function safeInteger(value, label) {
  const normalized = integer(value, label);
  const n = BigInt(normalized);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError(`${label} must be a non-negative safe integer.`);
  return Number(n);
}

function adaLovelace(value, label) {
  const candidate = value?.ada?.lovelace ?? value?.lovelace ?? value;
  return integer(candidate, label);
}

function bytesSize(value, label) {
  return safeInteger(value?.bytes ?? value, label);
}

function gcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x || 1n;
}

function rational(value, label) {
  if (typeof value === 'string' && /^\d+\/\d+$/.test(value)) {
    const [n, d] = value.split('/').map(BigInt);
    if (d < 1n) throw new TypeError(`${label} denominator must be positive.`);
    const g = gcd(n, d);
    return Object.freeze({ numerator: (n / g).toString(), denominator: (d / g).toString() });
  }

  let text = String(value).trim().toLowerCase();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/.test(text)) throw new TypeError(`${label} must be a decimal or rational.`);
  const [mantissa, exponentText = '0'] = text.split('e');
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent)) throw new TypeError(`${label} exponent is invalid.`);
  const [whole = '0', fraction = ''] = mantissa.split('.');
  let numerator = BigInt((whole || '0') + fraction);
  let denominator = 10n ** BigInt(fraction.length);
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
  else denominator *= 10n ** BigInt(-exponent);
  const g = gcd(numerator, denominator);
  return Object.freeze({ numerator: (numerator / g).toString(), denominator: (denominator / g).toString() });
}

function protocolVersionOgmios(value) {
  const major = safeInteger(value?.major ?? value?.[0], 'Ogmios protocol major');
  const minor = safeInteger(value?.minor ?? value?.[1], 'Ogmios protocol minor');
  return `${major}.${minor}`;
}

function plutusV3Ogmios(value) {
  const model = value?.['plutus:v3'] ?? value?.PlutusV3 ?? value?.plutusV3;
  if (!Array.isArray(model) || model.length !== 350 || model.some(v => !(typeof v === 'number' && Number.isSafeInteger(v) || typeof v === 'string' && /^-?\d+$/.test(v) && BigInt(v) >= BigInt(Number.MIN_SAFE_INTEGER) && BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER)))) {
    throw new TypeError('Ogmios must provide a complete 350-entry Plutus V3 cost model.');
  }
  return model.map(Number);
}

function plutusV3Blockfrost(value) {
  const raw = value?.cost_models_raw ?? value?.costModelsRaw;
  const model = raw?.PlutusV3 ?? raw?.['plutus:v3'] ?? raw?.plutusV3;
  if (!Array.isArray(model) || model.length !== 350 || model.some(v => !(typeof v === 'number' && Number.isSafeInteger(v) || typeof v === 'string' && /^-?\d+$/.test(v) && BigInt(v) >= BigInt(Number.MIN_SAFE_INTEGER) && BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER)))) {
    throw new TypeError('Blockfrost must provide cost_models_raw with a complete 350-entry Plutus V3 cost model.');
  }
  return model.map(Number);
}

function normalizedOgmios(parameters) {
  const p = parameters?.protocolParameters ?? parameters;
  if (!p || typeof p !== 'object') throw new TypeError('Ogmios protocol parameters are required.');
  const memoryPrice = rational(p.scriptExecutionPrices?.memory, 'Ogmios memory price');
  const cpuPrice = rational(p.scriptExecutionPrices?.cpu, 'Ogmios CPU price');
  return Object.freeze({
    protocolVersion: protocolVersionOgmios(p.version),
    minFeeA: integer(p.minFeeCoefficient, 'Ogmios minFeeCoefficient'),
    minFeeB: adaLovelace(p.minFeeConstant, 'Ogmios minFeeConstant'),
    maxTxSize: bytesSize(p.maxTransactionSize, 'Ogmios maxTransactionSize'),
    maxValueSize: bytesSize(p.maxValueSize, 'Ogmios maxValueSize'),
    coinsPerUtxoByte: integer(p.minUtxoDepositCoefficient, 'Ogmios minUtxoDepositCoefficient'),
    priceMemory: memoryPrice,
    priceSteps: cpuPrice,
    maxTxExUnits: Object.freeze({
      memory: integer(p.maxExecutionUnitsPerTransaction?.memory, 'Ogmios max tx memory'),
      steps: integer(p.maxExecutionUnitsPerTransaction?.cpu, 'Ogmios max tx CPU')
    }),
    collateralPercentage: integer(p.collateralPercentage, 'Ogmios collateralPercentage'),
    maxCollateralInputs: safeInteger(p.maxCollateralInputs, 'Ogmios maxCollateralInputs'),
    plutusV3CostModel: Object.freeze(plutusV3Ogmios(p.plutusCostModels))
  });
}

function normalizedBlockfrost(parameters) {
  const p = parameters;
  if (!p || typeof p !== 'object') throw new TypeError('Blockfrost protocol parameters are required.');
  return Object.freeze({
    epoch: safeInteger(p.epoch, 'Blockfrost epoch'),
    protocolVersion: `${safeInteger(p.protocol_major_ver, 'Blockfrost protocol major')}.${safeInteger(p.protocol_minor_ver, 'Blockfrost protocol minor')}`,
    minFeeA: integer(p.min_fee_a, 'Blockfrost min_fee_a'),
    minFeeB: integer(p.min_fee_b, 'Blockfrost min_fee_b'),
    maxTxSize: safeInteger(p.max_tx_size, 'Blockfrost max_tx_size'),
    maxValueSize: safeInteger(p.max_val_size, 'Blockfrost max_val_size'),
    coinsPerUtxoByte: integer(p.coins_per_utxo_size, 'Blockfrost coins_per_utxo_size'),
    priceMemory: rational(p.price_mem, 'Blockfrost price_mem'),
    priceSteps: rational(p.price_step, 'Blockfrost price_step'),
    maxTxExUnits: Object.freeze({
      memory: integer(p.max_tx_ex_mem, 'Blockfrost max_tx_ex_mem'),
      steps: integer(p.max_tx_ex_steps, 'Blockfrost max_tx_ex_steps')
    }),
    collateralPercentage: integer(p.collateral_percent, 'Blockfrost collateral_percent'),
    maxCollateralInputs: safeInteger(p.max_collateral_inputs, 'Blockfrost max_collateral_inputs'),
    plutusV3CostModel: Object.freeze(plutusV3Blockfrost(p))
  });
}

function equalRational(a, b) {
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

function assertAgreement(ogmios, blockfrost) {
  const scalar = ['protocolVersion', 'minFeeA', 'minFeeB', 'maxTxSize', 'maxValueSize', 'coinsPerUtxoByte', 'collateralPercentage', 'maxCollateralInputs'];
  for (const field of scalar) {
    if (String(ogmios[field]) !== String(blockfrost[field])) throw new Error(`Ogmios/Blockfrost protocol-parameter disagreement: ${field}.`);
  }
  if (!equalRational(ogmios.priceMemory, blockfrost.priceMemory)) throw new Error('Ogmios/Blockfrost protocol-parameter disagreement: priceMemory.');
  if (!equalRational(ogmios.priceSteps, blockfrost.priceSteps)) throw new Error('Ogmios/Blockfrost protocol-parameter disagreement: priceSteps.');
  if (ogmios.maxTxExUnits.memory !== blockfrost.maxTxExUnits.memory || ogmios.maxTxExUnits.steps !== blockfrost.maxTxExUnits.steps) {
    throw new Error('Ogmios/Blockfrost protocol-parameter disagreement: maxTxExUnits.');
  }
  if (ogmios.plutusV3CostModel.length !== blockfrost.plutusV3CostModel.length ||
      ogmios.plutusV3CostModel.some((value, index) => value !== blockfrost.plutusV3CostModel[index])) {
    throw new Error('Ogmios/Blockfrost protocol-parameter disagreement: Plutus V3 cost model.');
  }
}

function digestCostModel(model) {
  return createHash('sha256').update(JSON.stringify(model)).digest('hex');
}

export function createCardanoPreprodLiveProtocolSnapshot({
  ogmiosParameters,
  blockfrostParameters,
  epoch,
  tip,
  blockHeight = null,
  capturedAt = new Date().toISOString()
}) {
  const currentEpoch = safeInteger(epoch?.epoch ?? epoch, 'Ogmios epoch');
  const hash = String(tip?.hash ?? tip?.id ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new TypeError('Ogmios stable tip hash must be 32-byte hex.');
  const slot = safeInteger(tip?.slot, 'Ogmios tip slot');

  const ogmios = normalizedOgmios(ogmiosParameters);
  const blockfrost = normalizedBlockfrost(blockfrostParameters);
  if (blockfrost.epoch !== currentEpoch) throw new Error('Ogmios and Blockfrost do not agree on the current Preprod epoch.');
  assertAgreement(ogmios, blockfrost);

  return Object.freeze({
    schemaVersion: 2,
    network: 'preprod',
    networkId: 0,
    capturedAt,
    source: Object.freeze({
      provider: 'Ogmios + Blockfrost',
      independentSourceCount: 2,
      ogmios: 'queryLedgerState/protocolParameters',
      blockfrost: 'GET /epochs/latest/parameters'
    }),
    tip: Object.freeze({
      epoch: currentEpoch,
      blockHeight: blockHeight == null ? null : safeInteger(blockHeight?.height ?? blockHeight, 'Ogmios block height'),
      blockHash: hash,
      slot
    }),
    parameters: Object.freeze({
      epoch: currentEpoch,
      era: 'Conway',
      protocolVersion: ogmios.protocolVersion,
      sourceBlockHash: hash,
      minFeeA: ogmios.minFeeA,
      minFeeB: ogmios.minFeeB,
      maxTxSize: ogmios.maxTxSize,
      maxValueSize: ogmios.maxValueSize,
      coinsPerUtxoByte: ogmios.coinsPerUtxoByte,
      priceMemory: ogmios.priceMemory,
      priceSteps: ogmios.priceSteps,
      maxTxExUnits: ogmios.maxTxExUnits,
      collateralPercentage: ogmios.collateralPercentage,
      maxCollateralInputs: ogmios.maxCollateralInputs,
      plutusV3CostModelSha256: digestCostModel(ogmios.plutusV3CostModel),
      plutusV3CostModel: ogmios.plutusV3CostModel
    }),
    promotion: Object.freeze({
      currentAtCapture: true,
      independentlyConfirmed: true,
      eligibleForLiveTransactionConstruction: false,
      connectorLiveProof: false
    })
  });
}
