import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
import { calculateCardanoMinimumFee, calculateCardanoRequiredCollateral } from './protocol-parameters.js';
import { calculateCardanoMinRequiredLovelace } from './recovery-validator.js';
import { CARDANO_APPLIED_FIXTURE, buildCardanoTransactionBodyFixture } from './transaction-body.js';

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

function positiveBudgetValue(value, label, maximum) {
  const normalized = String(value);
  if (!/^\d+$/.test(normalized)) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  if (normalized.length > 1000) {
    throw new RangeError(`${label} integer precision exceeds the supported limit.`);
  }
  const units = BigInt(normalized);
  if (units < 1n) throw new TypeError(`${label} must be a positive integer.`);
  if (units > maximum) throw new RangeError(`${label} exceeds current maxTxExUnits.`);
  return units.toString();
}

function resolvedBudget(budgetOverrides, pointer, fallbackMemory, fallbackSteps, maxTxExUnits) {
  if (budgetOverrides == null) {
    return Object.freeze({ memory: String(fallbackMemory), steps: String(fallbackSteps) });
  }
  if (!budgetOverrides || typeof budgetOverrides !== 'object' || Array.isArray(budgetOverrides)) {
    throw new TypeError('budgetOverrides must be an action-pointer keyed object.');
  }
  const entry = budgetOverrides[pointer];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`Missing live evaluation budget for ${pointer}.`);
  }
  return Object.freeze({
    memory: positiveBudgetValue(entry.memory, `${pointer}.memory`, maxTxExUnits.memory),
    steps: positiveBudgetValue(entry.steps, `${pointer}.steps`, maxTxExUnits.steps)
  });
}

function addExecutionBudget(currentMemory, currentSteps, budget, maxTxExUnits) {
  const memory = currentMemory + BigInt(budget.memory);
  const steps = currentSteps + BigInt(budget.steps);
  if (memory > maxTxExUnits.memory || steps > maxTxExUnits.steps) {
    throw new RangeError('Execution units exceed current maxTxExUnits.');
  }
  return Object.freeze({ memory, steps });
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
  for (let index = 0; index < costModelValues.length; index += 1) {
    if (!Object.hasOwn(costModelValues, index)) {
      throw new TypeError('A complete 350-entry Plutus V3 cost model is required.');
    }
    const value = costModelValues[index];
    if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'bigint') {
      throw new TypeError(`Plutus V3 cost model entry ${index} must be an integer.`);
    }
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new TypeError(`Plutus V3 cost model entry ${index} must be a safe integer.`);
    }
    const decimal = String(value);
    if (decimal.length > 1000) {
      throw new RangeError(`Plutus V3 cost model entry ${index} exceeds the supported precision.`);
    }
    if (!/^-?\d+$/.test(decimal)) {
      throw new TypeError(`Plutus V3 cost model entry ${index} must be an integer.`);
    }
    model.set(index, Cardano.Int.from_str(decimal));
  }
  const models = Cardano.Costmdls.new();
  models.insert(Cardano.Language.new_plutus_v3(), model);
  return models;
}

export function buildCardanoWitnessSetFixture({
  action,
  parameters,
  recoveryCompiledCode,
  beaconCompiledCode,
  evaluationMode = false,
  publicPreprodEvaluation = false,
  evaluationSlot = null,
  budgetOverrides = null,
  omitKeyWitnessesAfterSizing = false
}) {
  if (!['initialize', 'heartbeat', 'approve', 'execute'].includes(action)) throw new TypeError('Unknown Cardano fixture action.');
  if (evaluationMode && budgetOverrides != null) throw new Error('Evaluation candidates must keep zero budgets; live budget overrides belong only to post-evaluation construction.');
  if (evaluationMode && omitKeyWitnessesAfterSizing) throw new Error('Evaluation candidates already omit key witnesses and do not use signed-size fee construction.');
  const redeemers = Cardano.Redeemers.new();
  const scripts = Cardano.PlutusScripts.new();
  let memory = 0n;
  let steps = 0n;

  if (action === 'initialize' || action === 'execute') {
    const mintBudget = evaluationMode
      ? Object.freeze({ memory: '0', steps: '0' })
      : resolvedBudget(budgetOverrides, 'mint:0', 91970, 27959404, parameters.maxTxExUnits);
    if (!evaluationMode) {
      const total = addExecutionBudget(memory, steps, mintBudget, parameters.maxTxExUnits);
      memory = total.memory;
      steps = total.steps;
    }
    redeemers.add(redeemer(Cardano.RedeemerTag.new_mint(), plutusConstr(0), mintBudget.memory, mintBudget.steps));
    const beaconScript = Cardano.PlutusScript.new_v3(Uint8Array.from(Buffer.from(beaconCompiledCode, 'hex')));
    if (beaconScript.hash().to_hex() !== CARDANO_APPLIED_FIXTURE.beaconPolicyId) {
      throw new Error(`Cardano beacon witness script hash mismatch: witness=${beaconScript.hash().to_hex()} expected=${CARDANO_APPLIED_FIXTURE.beaconPolicyId}.`);
    }
    scripts.add(beaconScript);
  }
  if (action !== 'initialize') {
    const fallback = action === 'heartbeat' ? [494618, 158755371] : action === 'approve' ? [566905, 179701350] : [423054, 133367503];
    const spendBudget = evaluationMode
      ? Object.freeze({ memory: '0', steps: '0' })
      : resolvedBudget(budgetOverrides, 'spend:0', fallback[0], fallback[1], parameters.maxTxExUnits);
    if (!evaluationMode) {
      const total = addExecutionBudget(memory, steps, spendBudget, parameters.maxTxExUnits);
      memory = total.memory;
      steps = total.steps;
    }
    redeemers.add(redeemer(Cardano.RedeemerTag.new_spend(), actionData(action), spendBudget.memory, spendBudget.steps));
    const recoveryScript = Cardano.PlutusScript.new_v3(Uint8Array.from(Buffer.from(recoveryCompiledCode, 'hex')));
    if (recoveryScript.hash().to_hex() !== CARDANO_APPLIED_FIXTURE.recoveryValidatorHash) {
      throw new Error(`Cardano recovery witness script hash mismatch: witness=${recoveryScript.hash().to_hex()} expected=${CARDANO_APPLIED_FIXTURE.recoveryValidatorHash}.`);
    }
    scripts.add(recoveryScript);
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
  let feeSizingKeyWitnessCount = 0;
  let feeSizingTransactionBytes = 0;
  let iterations = 0;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    iterations = iteration + 1;
    const bodyFixture = buildCardanoTransactionBodyFixture(action, {
      feeLovelace: fee,
      scriptDataHashHex: scriptDataHash,
      evaluationContext: publicPreprodEvaluation,
      evaluationSlot
    });
    const body = Cardano.TransactionBody.from_hex(bodyFixture.cborHex);
    let sizingWitnessSet = witnessSet;
    if (!evaluationMode) {
      sizingWitnessSet = Cardano.TransactionWitnessSet.from_bytes(witnessSet.to_bytes());
      feeSizingKeyWitnessCount = attachKeyWitnesses(sizingWitnessSet, body, action);
    } else {
      feeSizingKeyWitnessCount = 0;
    }
    const sizingTransaction = Cardano.Transaction.new(body, sizingWitnessSet);
    feeSizingTransactionBytes = sizingTransaction.to_bytes().length;
    feeResult = calculateCardanoMinimumFee({ transactionBytes: feeSizingTransactionBytes, memory, steps, parameters });
    transaction = (!evaluationMode && omitKeyWitnessesAfterSizing)
      ? Cardano.Transaction.new(body, witnessSet)
      : sizingTransaction;
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
    executionUnitsAreAikenFixtureMeasurements: !evaluationMode && budgetOverrides == null,
    executionUnitsFromLiveEvaluation: !evaluationMode && budgetOverrides != null,
    evaluationCandidate: evaluationMode,
    requiresIndependentLiveEvaluation: budgetOverrides == null,
    keyWitnessCount: (!evaluationMode && omitKeyWitnessesAfterSizing) ? 0 : feeSizingKeyWitnessCount,
    feeSizingKeyWitnessCount,
    feeSizingTransactionBytes,
    keyWitnessSizingComplete: !evaluationMode,
    feeConvergenceIterations: iterations,
    feeIncludesKeyWitnesses: !evaluationMode,
    syntheticSizingWitnessesExcludedFromCandidate: !evaluationMode && omitKeyWitnessesAfterSizing,
    minimumAda: Object.freeze(minimumAda),
    collateral: Object.freeze({ declaredCollateral, requiredCollateral: collateral.requiredCollateral, satisfied: true })
  });
}

export function buildCardanoOgmiosEvaluationFixture(options) {
  return buildCardanoWitnessSetFixture({ ...options, evaluationMode: true, publicPreprodEvaluation: false });
}

export function buildCardanoPublicPreprodOgmiosEvaluationFixture(options) {
  return buildCardanoWitnessSetFixture({ ...options, evaluationMode: true, publicPreprodEvaluation: true });
}

export function buildCardanoPreprodEvaluatedUnsignedFixture(options) {
  return buildCardanoWitnessSetFixture({
    ...options,
    evaluationMode: false,
    publicPreprodEvaluation: true,
    omitKeyWitnessesAfterSizing: true
  });
}
