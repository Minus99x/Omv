import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';

const HEX = /^(?:[0-9a-f]{2})+$/i;
const TAGS = Object.freeze(['spend', 'mint', 'certificate', 'withdrawal']);

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer.`);
  return value;
}

function redeemerPointers(transaction) {
  const redeemers = transaction.witness_set().redeemers();
  if (!redeemers || redeemers.len() < 1) throw new Error('Evaluation transaction must contain redeemers.');
  const pointers = [];
  for (let index = 0; index < redeemers.len(); index += 1) {
    const item = redeemers.get(index);
    if (item.ex_units().mem().to_str() !== '0' || item.ex_units().steps().to_str() !== '0') {
      throw new Error('Ogmios evaluation candidates must set every redeemer budget to zero.');
    }
    const tag = TAGS[item.tag().kind()];
    if (!tag) throw new Error('Unsupported Cardano redeemer tag.');
    pointers.push(`${tag}:${item.index().to_str()}`);
  }
  if (new Set(pointers).size !== pointers.length) throw new Error('Evaluation transaction contains duplicate redeemer pointers.');
  return Object.freeze(pointers.sort());
}

export function createCardanoOgmiosEvaluationRequest({ transactionCborHex, additionalUtxoSet, id = 'omegavault-cardano-evaluate' }) {
  if (typeof transactionCborHex !== 'string' || !HEX.test(transactionCborHex)) throw new TypeError('transactionCborHex must be non-empty base16 CBOR.');
  if (typeof id !== 'string' || id.length < 1) throw new TypeError('A JSON-RPC request id is required.');
  const transaction = Cardano.Transaction.from_hex(transactionCborHex);
  const expectedValidators = redeemerPointers(transaction);
  const params = { transaction: { cbor: transactionCborHex.toLowerCase() } };
  if (additionalUtxoSet !== undefined) {
    if (!Array.isArray(additionalUtxoSet)) throw new TypeError('additionalUtxoSet must be an array.');
    // Ogmios v7 names the wire-level parameter "additionalUtxo".
    // Keep the internal argument name for compatibility with OmegaVault's existing capture-plan API.
    params.additionalUtxo = additionalUtxoSet;
  }
  return Object.freeze({
    request: Object.freeze({ jsonrpc: '2.0', method: 'evaluateTransaction', params, id }),
    expectedValidators,
    transactionBodyHash: Buffer.from(blake2b(transaction.body().to_bytes(), { dkLen: 32 })).toString('hex'),
    requiresSeparatePhaseOneValidation: true
  });
}

function normalizeValidatorPointer(value, index) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const purpose = typeof value.purpose === 'string' ? value.purpose : null;
    const pointerIndex = Number.isInteger(value.index) ? value.index : Number(value.index);
    if (purpose && Number.isInteger(pointerIndex) && pointerIndex >= 0) return `${purpose}:${pointerIndex}`;
  }
  throw new Error(`Unexpected Ogmios validator pointer at result ${index}.`);
}

export function normalizeCardanoOgmiosEvaluation({ response, requestId, expectedValidators, parameters, safetyMarginPercent = 10 }) {
  if (!response || response.jsonrpc !== '2.0' || response.method !== 'evaluateTransaction' || response.id !== requestId) throw new Error('Ogmios evaluation response does not match the request.');
  if (response.error) throw new Error(`Ogmios evaluation failed: ${response.error.message || response.error.code || 'unknown error'}`);
  if (!Array.isArray(response.result)) throw new TypeError('Ogmios evaluation result must be an array.');
  if (!Array.isArray(expectedValidators) || expectedValidators.length < 1) throw new TypeError('Expected redeemer pointers are required.');
  if (!Number.isInteger(safetyMarginPercent) || safetyMarginPercent < 0 || safetyMarginPercent > 100) throw new RangeError('safetyMarginPercent must be 0-100.');

  const seen = new Set();
  const budgets = response.result.map((item, index) => {
    const validator = normalizeValidatorPointer(item?.validator, index);
    if (!expectedValidators.includes(validator)) throw new Error(`Unexpected Ogmios validator pointer at result ${index}.`);
    if (seen.has(validator)) throw new Error(`Duplicate Ogmios validator pointer: ${validator}.`);
    seen.add(validator);
    const memory = positiveInteger(item.budget?.memory, `${validator}.memory`);
    const steps = positiveInteger(item.budget?.cpu, `${validator}.cpu`);
    const margin = BigInt(100 + safetyMarginPercent);
    return Object.freeze({
      validator,
      evaluated: Object.freeze({ memory: String(memory), steps: String(steps) }),
      budget: Object.freeze({
        memory: ((BigInt(memory) * margin + 99n) / 100n).toString(),
        steps: ((BigInt(steps) * margin + 99n) / 100n).toString()
      })
    });
  }).sort((left, right) => left.validator.localeCompare(right.validator));

  if (seen.size !== expectedValidators.length || expectedValidators.some(pointer => !seen.has(pointer))) throw new Error('Ogmios evaluation omitted an expected redeemer pointer.');
  const memory = budgets.reduce((sum, item) => sum + BigInt(item.budget.memory), 0n);
  const steps = budgets.reduce((sum, item) => sum + BigInt(item.budget.steps), 0n);
  if (memory > parameters.maxTxExUnits.memory || steps > parameters.maxTxExUnits.steps) throw new RangeError('Margin-adjusted Ogmios budgets exceed current maxTxExUnits.');
  return Object.freeze({ budgets: Object.freeze(budgets), totalMemory: memory.toString(), totalSteps: steps.toString(), safetyMarginPercent, phaseOneValidated: false });
}

export function createCardanoLedgerEvaluationGate({ evaluation, synchronizedState, phaseOneValidation }) {
  const sameTip = Boolean(synchronizedState?.acquiredTipHash) && synchronizedState.acquiredTipHash === synchronizedState.protocolParametersTipHash && synchronizedState.acquiredTipHash === synchronizedState.evaluationTipHash;
  const phaseOnePassed = phaseOneValidation?.passed === true && phaseOneValidation?.balanced === true && phaseOneValidation?.minimumAdaSatisfied === true && phaseOneValidation?.collateralSatisfied === true && phaseOneValidation?.witnessesSatisfied === true;
  const ready = Boolean(evaluation) && sameTip && phaseOnePassed;
  return Object.freeze({
    ready,
    sameTip,
    phaseOnePassed,
    reason: ready ? null : !sameTip ? 'Protocol parameters, UTxOs and evaluation must be acquired at the same node tip.' : 'Ogmios execution-unit evaluation does not replace complete phase-1 ledger validation.'
  });
}
