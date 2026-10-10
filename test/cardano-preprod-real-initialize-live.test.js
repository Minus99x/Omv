import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createCardanoPreprodAppliedValidatorIdentity } from '../src/chains/cardano/live-validator-identity.js';
import { captureCardanoPreprodRealInitializeEvaluation } from '../src/chains/cardano/preprod-real-initialize-live.js';
import { CARDANO_PREPROD_NETWORK_ID } from '../src/chains/cardano/transaction-body.js';

const protocolFixture = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', import.meta.url), 'utf8'));
const fixtureEvidence = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_APPLIED_FIXTURE_0.6.12.json', import.meta.url), 'utf8'));
const beaconBlueprint = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/state-beacon.applied.json', import.meta.url), 'utf8'));
const vaultBlueprint = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/recovery-vault.applied.json', import.meta.url), 'utf8'));
const beaconCompiledCode = beaconBlueprint.validators.find(item => item.title === 'omegavault.state_beacon.mint').compiledCode;
const recoveryCompiledCode = vaultBlueprint.validators.find(item => item.title === 'omegavault.recovery_vault.spend').compiledCode;
const sourceBlueprintSha256 = createHash('sha256')
  .update(readFileSync(new URL('../validators/cardano/plutus.json', import.meta.url)))
  .digest('hex');

function walletAddress(keyHex = '11'.repeat(28)) {
  return Cardano.EnterpriseAddress.new(
    CARDANO_PREPROD_NETWORK_ID,
    Cardano.Credential.from_keyhash(Cardano.Ed25519KeyHash.from_hex(keyHex))
  ).to_address().to_bech32();
}

function rawOgmiosParameters() {
  const p = protocolFixture.parameters;
  return {
    version: { major: 11, minor: 0 },
    minFeeCoefficient: Number(p.minFeeA),
    minFeeConstant: { ada: { lovelace: Number(p.minFeeB) } },
    maxTransactionSize: { bytes: p.maxTxSize },
    maxValueSize: { bytes: 5000 },
    minUtxoDepositCoefficient: Number(p.coinsPerUtxoByte),
    scriptExecutionPrices: {
      memory: `${p.priceMemory.numerator}/${p.priceMemory.denominator}`,
      cpu: `${p.priceSteps.numerator}/${p.priceSteps.denominator}`
    },
    maxExecutionUnitsPerTransaction: {
      memory: Number(p.maxTxExUnits.memory),
      cpu: Number(p.maxTxExUnits.steps)
    },
    collateralPercentage: Number(p.collateralPercentage),
    maxCollateralInputs: p.maxCollateralInputs,
    plutusCostModels: { 'plutus:v3': p.plutusV3CostModel }
  };
}

function rawBlockfrostParameters() {
  const p = protocolFixture.parameters;
  return {
    epoch: protocolFixture.tip.epoch,
    protocol_major_ver: 11,
    protocol_minor_ver: 0,
    min_fee_a: p.minFeeA,
    min_fee_b: p.minFeeB,
    max_tx_size: p.maxTxSize,
    max_val_size: '5000',
    coins_per_utxo_size: p.coinsPerUtxoByte,
    price_mem: `${p.priceMemory.numerator}/${p.priceMemory.denominator}`,
    price_step: `${p.priceSteps.numerator}/${p.priceSteps.denominator}`,
    max_tx_ex_mem: p.maxTxExUnits.memory,
    max_tx_ex_steps: p.maxTxExUnits.steps,
    collateral_percent: p.collateralPercentage,
    max_collateral_inputs: p.maxCollateralInputs,
    cost_models_raw: { PlutusV3: p.plutusV3CostModel }
  };
}

test('Cardano real initialize live orchestrator binds actual UTxOs, evaluates, and returns an unsigned budget-applied candidate', async () => {
  const address = walletAddress();
  const tip = { hash: 'aa'.repeat(32), slot: 135700000 };
  const seed = {
    tx_hash: fixtureEvidence.parameters.seedTxId,
    output_index: fixtureEvidence.parameters.seedOutputIndex,
    amount: [{ unit: 'lovelace', quantity: '20000000' }],
    data_hash: null,
    inline_datum: null,
    reference_script_hash: null
  };
  const collateral = {
    tx_hash: '12'.repeat(32),
    output_index: 0,
    amount: [{ unit: 'lovelace', quantity: '5000000' }],
    data_hash: null,
    inline_datum: null,
    reference_script_hash: null
  };

  const fetchImpl = async url => {
    if (url.includes('/addresses/')) return { ok: true, status: 200, json: async () => [seed, collateral] };
    if (url.endsWith('/epochs/latest/parameters')) return { ok: true, status: 200, json: async () => rawBlockfrostParameters() };
    throw new Error(`Unexpected fake URL: ${url}`);
  };

  const calls = [];
  const client = {
    async rpc(method, params, requestId) {
      calls.push({ method, params, requestId });
      if (method === 'queryNetwork/tip') return { jsonrpc: '2.0', result: { id: tip.hash, slot: tip.slot } };
      if (method === 'queryLedgerState/utxo') {
        return {
          jsonrpc: '2.0',
          result: [
            {
              transaction: { id: fixtureEvidence.parameters.seedTxId },
              index: fixtureEvidence.parameters.seedOutputIndex,
              address,
              value: { ada: { lovelace: 20000000 } }
            },
            {
              transaction: { id: '12'.repeat(32) },
              index: 0,
              address,
              value: { ada: { lovelace: 5000000 } }
            }
          ]
        };
      }
      if (method === 'queryLedgerState/epoch') return { jsonrpc: '2.0', result: protocolFixture.tip.epoch };
      if (method === 'queryNetwork/blockHeight') return { jsonrpc: '2.0', result: protocolFixture.tip.blockHeight };
      if (method === 'queryLedgerState/protocolParameters') return { jsonrpc: '2.0', result: rawOgmiosParameters() };
      if (method === 'evaluateTransaction') {
        return {
          jsonrpc: '2.0',
          method,
          id: requestId,
          result: [{ validator: { purpose: 'mint', index: 0 }, budget: { memory: 91970, cpu: 27959404 } }]
        };
      }
      throw new Error(`Unexpected fake method: ${method}`);
    }
  };

  const deriveAppliedValidatorIdentity = async ({ seedReference, assetNameHex }) => createCardanoPreprodAppliedValidatorIdentity({
    seedReference,
    assetNameHex,
    sourceBlueprintSha256,
    beaconCompiledCode,
    recoveryCompiledCode,
    aikenPolicyId: fixtureEvidence.stateBeacon.policyId,
    aikenRecoveryHash: fixtureEvidence.recoveryVault.scriptHash,
    aikenRecoveryAddress: fixtureEvidence.recoveryVault.preprodAddress
  });

  const result = await captureCardanoPreprodRealInitializeEvaluation({
    walletAddress: address,
    blockfrostProjectId: 'preprod_test',
    client,
    fetchImpl,
    deriveAppliedValidatorIdentity,
    recoveryConfig: {
      rescueKeyHash: '66'.repeat(28),
      contactKeyHashes: ['22'.repeat(28), '33'.repeat(28)],
      threshold: 2,
      inactivityMs: 60000,
      stateLovelace: '10000000'
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempt, 1);
  assert.equal(result.selected.seed.transaction.id, fixtureEvidence.parameters.seedTxId);
  assert.equal(result.utxoBindingEvidence.realUtxoReferencesExist, true);
  assert.equal(result.protocolSnapshot.promotion.independentlyConfirmed, true);
  assert.equal(result.conwayParameterReadiness.completeConwayParametersEstablished, false);
  assert.equal(result.conwayParameterReadiness.completePhaseOneValidated, false);
  assert.equal(result.conwayParameterReadiness.transactionSubmissionAuthorized, false);
  assert.equal(result.conwayParameterReadiness.tip.hash, tip.hash);
  assert.match(result.conwayParameterReadiness.unresolved.systemStart, /genesis/);
  assert.equal(result.evaluationEvidence.conwayParameterReadiness.reportSha256,
    result.conwayParameterReadiness.reportSha256);
  assert.equal(result.evaluationCandidate.evaluation.evaluationSupplementalUtxoRequired, false);
  assert.equal(Object.hasOwn(result.evaluationCandidate.evaluation.request.params, 'additionalUtxo'), false);
  assert.equal(result.evaluationEvidence.normalizedEvaluation.budgets[0].validator, 'mint:0');
  assert.equal(result.evaluationEvidence.normalizedEvaluation.budgets[0].budget.memory, '101167');
  assert.equal(result.finalUnsignedCandidate.evaluation.mode, 'live-budget-applied-unsigned-candidate');
  assert.equal(result.finalUnsignedCandidate.evaluation.request, null);
  assert.equal(result.finalUnsignedCandidate.transaction.keyWitnessCount, 0);
  assert.equal(result.fullPhaseOneValidated, false);
  assert.equal(result.walletSigningAuthorized, false);
  assert.equal(result.transactionSubmissionAuthorized, false);
  assert.ok(calls.some(call => call.method === 'evaluateTransaction'));
});
