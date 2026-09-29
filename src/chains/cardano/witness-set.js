import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
import { calculateCardanoMinimumFee, calculateCardanoRequiredCollateral } from './protocol-parameters.js';
import { calculateCardanoMinRequiredLovelace } from './recovery-validator.js';
import { buildCardanoTransactionBodyFixture } from './transaction-body.js';

function hex(value) {
  return Buffer.from(value).toString('hex');
}

function plutusConstr(alternative, fields = []) {
  const list = Cardano.PlutusList.new();
  for (const field of fields) list.add(field);
  return Cardano.PlutusData.new_constr_plutus_data(Cardano.ConstrPlutusData.new(Cardano.BigNum.from_str(String(alternative)), list));
}

function actionData(action) {
  if (action === 'heartbeat') return plutusConstr(0);
  if (action === 'approve') return plutusConstr(1, [Cardano.PlutusData.new_bytes(Uint8Array.from(Buffer.from('22'.repeat(28), 'hex')))]);
  if (action === 'execute') return plutusConstr(2);
  return plutusConstr(0);
}

function exUnits(memory, steps) {
  return Cardano.ExUnits.new(Cardano.BigNum.from_str(String(memory)), Cardano.BigNum.from_str(String(steps)));
}

function redeemer(tag, data, memory, steps) {
  return Cardano.Redeemer.new(tag, Cardano.BigNum.zero(), data, exUnits(memory, steps));
}

function deterministicSigningKeys(action) {
  const keyBytes = action === 'approve' ? [1, 2] : [1];
  return keyBytes.map(value => Cardano.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => value)));
}

function attachKeyWitnesses(witnessSet, body, action) {
  const bodyHash = Cardano.TransactionHash.from_bytes(blake2b(body.to_bytes(), { dkLen: 32 }));
  const witnesses = Cardano.Vkeywitnesses.new();
  for (const key of deterministicSigningKeys(action)) witnesses.add(Cardano.make_vkey_witness(bodyHash, key));
  witnessSet.set_vkeys(witnesses);
  return witnesses.len();
}

export function createCardanoPlutusV3CostModels(costModelValues) {
  if (!Array.isArray(costModelValues) || costModelValues.length !== 350) throw new TypeError('A complete 350-entry Plutus V3 cost model is required.');
  const model = Cardano.CostModel.new();
  costModelValues.forEach((value, index) => model.set(index, Cardano.Int.from_str(String(value))));
  const models = Cardano.Costmdls.new();
  models.insert(Cardano.Language.new_plutus_v3(), model);
  return models;
}

export function buildCardanoWitnessSetFixture({ action, parameters, recoveryCompiledCode, beaconCompiledCode, evaluationMode = false }) {
  if (!['initialize', 'heartbeat', 'approve', 'execute'].includes(action)) throw new TypeError('Unknown Cardano fixture action.');
  const redeemers = Cardano.Redeemers.new();
  const scripts = Cardano.PlutusScripts.new();
  let memory = 0n;
  let steps = 0n;

  if (action === 'initialize' || action === 'execute') {
    redeemers.add(redeemer(Cardano.RedeemerTag.new_mint(), plutusConstr(0), evaluationMode ? 0 : 91970, evaluationMode ? 0 : 27959404));
    scripts.add(Cardano.PlutusScript.from_hex_with_version(beaconCompiledCode, Cardano.Language.new_plutus_v3()));
    if (!evaluationMode) {
      memory += 91970n;
      steps += 27959404n;
    }
  }
  if (action !== 'initialize') {
    const budget = action === 'heartbeat' ? [494618, 158755371] : action === 'approve' ? [566905, 179701350] : [423054, 133367503];
    redeemers.add(redeemer(Cardano.RedeemerTag.new_spend(), actionData(action), evaluationMode ? 0 : budget[0], evaluationMode ? 0 : budget[1]));
    scripts.add(Cardano.PlutusScript.from_hex_with_version(recoveryCompiledCode, Cardano.Language.new_plutus_v3()));
    if (!evaluationMode) {
      memory += BigInt(budget[0]);
      steps += BigInt(budget[1]);
    }
  }

  const models = createCardanoPlutusV3CostModels(parameters.plutusV3CostModel);
  const scriptDataHash = Cardano.hash_script_data(redeemers, models).to_hex();
  const witnessSet = Cardano.TransactionWitnessSet.new();
  witnessSet.set_redeemers(redeemers);
  witnessSet.set_plutus_scripts(scripts);
  const witnessBytes = witnessSet.to_bytes();
  const witnessRoundTrip = Cardano.TransactionWitnessSet.from_bytes(witnessBytes).to_bytes();
  if (hex(witnessBytes) !== hex(witnessRoundTrip)) throw new Error('Cardano witness-set CBOR did not round-trip exactly.');

  let fee = '200000';
  let transaction;
  let feeResult;
  let keyWitnessCount = 0;
  let iterations = 0;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    iterations = iteration + 1;
    const bodyFixture = buildCardanoTransactionBodyFixture(action, { feeLovelace: fee, scriptDataHashHex: scriptDataHash });
    const body = Cardano.TransactionBody.from_hex(bodyFixture.cborHex);
    keyWitnessCount = evaluationMode ? 0 : attachKeyWitnesses(witnessSet, body, action);
    transaction = Cardano.Transaction.new(body, witnessSet);
    const transactionBytes = transaction.to_bytes().length;
    feeResult = calculateCardanoMinimumFee({ transactionBytes, memory, steps, parameters });
    if (feeResult.minimumFee === fee) break;
    fee = feeResult.minimumFee;
  }

  const txBytes = transaction.to_bytes();
  if (transaction.body().fee().to_str() !== feeResult.minimumFee) throw new Error('Cardano fee iteration did not converge.');
  const txRoundTrip = Cardano.Transaction.from_bytes(txBytes).to_bytes();
  if (hex(txBytes) !== hex(txRoundTrip)) throw new Error('Cardano unsigned transaction CBOR did not round-trip exactly.');
  const outputs = transaction.body().outputs();
  const minimumAda = [];
  for (let index = 0; index < outputs.len(); index += 1) {
    const output = outputs.get(index);
    const requirement = calculateCardanoMinRequiredLovelace({ serializedOutputBytes: output.to_bytes().length, coinsPerUtxoByte: parameters.coinsPerUtxoByte });
    const actualLovelace = output.amount().coin().to_str();
    if (BigInt(actualLovelace) < BigInt(requirement.minimumLovelace)) throw new Error(`Cardano output ${index} is below minimum ADA.`);
    minimumAda.push(Object.freeze({ index, outputBytes: output.to_bytes().length, actualLovelace, minimumLovelace: requirement.minimumLovelace, satisfied: true }));
  }
  const collateral = calculateCardanoRequiredCollateral({ feeLovelace: feeResult.minimumFee, parameters });
  const declaredCollateral = transaction.body().total_collateral().to_str();
  if (BigInt(declaredCollateral) < BigInt(collateral.requiredCollateral)) throw new Error('Declared Cardano collateral is below the current requirement.');

  return Object.freeze({
    action,
    scriptDataHash,
    witnessSetCborHex: hex(witnessBytes),
    witnessSetBytes: witnessBytes.length,
    transactionCborHex: hex(txBytes),
    transactionBytes: txBytes.length,
    memory: memory.toString(),
    steps: steps.toString(),
    minimumFee: feeResult.minimumFee,
    roundTripExact: true,
    executionUnitsAreAikenFixtureMeasurements: !evaluationMode,
    evaluationCandidate: evaluationMode,
    requiresIndependentLiveEvaluation: true,
    keyWitnessCount,
    keyWitnessSizingComplete: !evaluationMode,
    feeConvergenceIterations: iterations,
    feeIncludesKeyWitnesses: !evaluationMode,
    minimumAda: Object.freeze(minimumAda),
    collateral: Object.freeze({ declaredCollateral, requiredCollateral: collateral.requiredCollateral, satisfied: true })
  });
}

export function buildCardanoOgmiosEvaluationFixture(options) {
  return buildCardanoWitnessSetFixture({ ...options, evaluationMode: true });
}
