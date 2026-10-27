import { normalizeCardanoProtocolParameterSnapshot } from './protocol-parameters.js';
import { hashCardanoEvidence } from './evidence-binding.js';

function safeNumber(value, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${label} exceeds the Scalus exact integer interface.`);
  return n;
}

function price(ratio) {
  const value = Number(ratio.numerator) / Number(ratio.denominator);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value));
  const decimals = match?.[2] ?? '';
  if (!match || BigInt(match[1] + decimals) * ratio.denominator !== ratio.numerator * 10n ** BigInt(decimals.length)) {
    throw new RangeError('Execution price cannot round-trip exactly through the Scalus decimal interface.');
  }
  return value;
}

export function createScalusCapturedProtocolContext(snapshot, api) {
  const p = normalizeCardanoProtocolParameterSnapshot(snapshot);
  if (p.maxValueSize == null) throw new Error('Captured maxValueSize is required for Scalus replay.');
  const base = api.CardanoInfo.preprod();
  if (typeof base.withProtocolParams !== 'function' || typeof base.protocolParams?.toBlockfrostJson !== 'function' ||
      typeof api.ProtocolParams?.fromBlockfrostJson !== 'function') throw new Error('Scalus captured protocol parameter API is unavailable.');
  const document = JSON.parse(base.protocolParams.toBlockfrostJson());
  const [major, minor] = p.protocolVersion.split('.').map(v => safeNumber(v, 'protocol version'));
  const overrides = {
    min_fee_a: safeNumber(p.minFeeA, 'minFeeA'), min_fee_b: safeNumber(p.minFeeB, 'minFeeB'),
    max_tx_size: p.maxTxSize, max_val_size: p.maxValueSize,
    coins_per_utxo_size: p.coinsPerUtxoByte.toString(),
    price_mem: price(p.priceMemory), price_step: price(p.priceSteps),
    max_tx_ex_mem: p.maxTxExUnits.memory.toString(), max_tx_ex_steps: p.maxTxExUnits.steps.toString(),
    collateral_percent: safeNumber(p.collateralPercentage, 'collateralPercentage'),
    max_collateral_inputs: p.maxCollateralInputs,
    protocol_major_ver: major, protocol_minor_ver: minor
  };
  Object.assign(document, overrides);
  document.cost_models_raw = {...document.cost_models_raw, PlutusV3: [...p.plutusV3CostModel]};
  const params = api.ProtocolParams.fromBlockfrostJson(JSON.stringify(document));
  const context = Object.freeze({
    mode: 'captured-initialize-parameters-with-bundled-remainder',
    snapshotSha256: hashCardanoEvidence(snapshot),
    appliedParameterDocumentSha256: hashCardanoEvidence(document),
    capturedFields: Object.freeze([...Object.keys(overrides), 'cost_models_raw.PlutusV3']),
    bundledFields: Object.freeze([...Object.keys(document).filter(key => !(key in overrides) && key !== 'cost_models_raw'),
      ...Object.keys(document.cost_models_raw).filter(key => key !== 'PlutusV3').map(key => `cost_models_raw.${key}`)]),
    completeCurrentProtocolContext: false
  });
  return { cardanoInfo: base.withProtocolParams(params), context };
}
