import { compareCardanoConwayProtocolParameters } from './conway-provider-readiness.js';
import { verifyCapturedBlockfrostAgreement, verifyExtendedProtocolAgreement } from './live-protocol-parameters.js';
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
  const bundled = JSON.parse(base.protocolParams.toBlockfrostJson());
  if (snapshot.capturedBlockfrostParameters != null) {
    const document = structuredClone(snapshot.capturedBlockfrostParameters);
    verifyCapturedBlockfrostAgreement(snapshot, document);
    // Require every field emitted by the installed engine. Never fill a
    // partial provider document with bundled values and label it captured.
    for (const key of Object.keys(bundled)) {
      if (key === 'pvtpp_security_group') continue; // upstream alias of pvt_p_p_security_group
      if (!Object.hasOwn(document, key) || document[key] == null) throw new Error(`Captured Blockfrost parameters missing ${key}.`);
    }
    for (const language of Object.keys(bundled.cost_models_raw)) {
      const model = document.cost_models_raw?.[language];
      if (!Array.isArray(model) || model.length !== bundled.cost_models_raw[language].length ||
          !Array.from({length:model.length},(_,i)=>Object.hasOwn(model,i) && Number.isSafeInteger(model[i])).every(Boolean)) {
        throw new Error(`Captured Blockfrost cost model incomplete: ${language}.`);
      }
    }
    const confirmedAdditionalFields = snapshot.capturedOgmiosParameters == null ? Object.freeze([]) :
      verifyExtendedProtocolAgreement(snapshot.capturedOgmiosParameters, document);
    const confirmedFields = new Set(snapshot.capturedOgmiosParameters == null ? [] : [
      'min_fee_a', 'min_fee_b', 'max_tx_size', 'max_val_size', 'coins_per_utxo_size',
      'price_mem', 'price_step', 'max_tx_ex_mem', 'max_tx_ex_steps', 'collateral_percent',
      'max_collateral_inputs', 'protocol_major_ver', 'protocol_minor_ver',
      'cost_models_raw.PlutusV3', ...confirmedAdditionalFields
    ]);
    const unconfirmedFields = Object.freeze(Object.keys(bundled)
      .filter(key => key !== 'pvtpp_security_group')
      .flatMap(key => key === 'cost_models_raw'
        ? Object.keys(bundled.cost_models_raw).map(language => `cost_models_raw.${language}`) : [key])
      .filter(key => !confirmedFields.has(key)));
    // The pinned Scalus importer consumes this fee as an integer. Reject
    // fractional/unsafe JSON numbers before its Long conversion can truncate.
    if (Object.hasOwn(document, 'min_fee_ref_script_cost_per_byte') &&
        (!Number.isSafeInteger(document.min_fee_ref_script_cost_per_byte) || document.min_fee_ref_script_cost_per_byte < 0)) {
      throw new Error('Captured reference-script base price exceeds the Scalus exact integer interface.');
    }
    const referenceScriptFeeSchedule = snapshot.capturedOgmiosParameters == null ? null :
      compareCardanoConwayProtocolParameters(snapshot.capturedOgmiosParameters, document).referenceScriptFeeSchedule;
    const params = api.ProtocolParams.fromBlockfrostJson(JSON.stringify(document));
    return {cardanoInfo:base.withProtocolParams(params),context:Object.freeze({
      mode:'captured-blockfrost-document',
      snapshotSha256:hashCardanoEvidence(snapshot),
      appliedParameterDocumentSha256:hashCardanoEvidence(document),
      capturedFields:Object.freeze(Object.keys(document)),bundledFields:Object.freeze([]),
      confirmedAdditionalFields, unconfirmedFields, referenceScriptFeeSchedule,
      // Additional provider fields are retained, but only the existing subset
      // has been independently compared with Ogmios.
      completeCurrentProtocolContext:false,
      additionalFieldsIndependentlyConfirmed:unconfirmedFields.length === 0
    })};
  }
  const document = bundled;
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
