import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilityUiModel } from '../public/capability-ui.js';
import { createCapabilityCatalogResponse } from '../src/chains/capability-catalog.js';
import { createValidatedCapabilityCatalogResponse } from '../src/api/response-contracts.js';

function envelope() {
  return createValidatedCapabilityCatalogResponse(createCapabilityCatalogResponse());
}

test('UI model consumes backend-validated eligibility without recalculating promotion', () => {
  const result = createCapabilityUiModel(envelope());
  assert.equal(result.available, true);
  const xdc = result.contracts.find(contract => contract.chainId === 'xdc');
  assert.ok(xdc);
  assert.equal(xdc.promotionEligible, false);
  assert.equal(xdc.promotionLabel, 'Not promotion eligible');
  assert.ok(xdc.blockers.some(value => /Apothem/.test(value)));
  assert.ok(xdc.missingGates.length > 0);
});

test('UI model exposes evidence levels directly from contract gate evidence', () => {
  const result = createCapabilityUiModel(envelope());
  const xdc = result.contracts.find(contract => contract.chainId === 'xdc');
  assert.ok(xdc.evidenceCounts['offline-test'] >= 1);
  const address = xdc.gateEvidence.find(gate => gate.gate === 'address-validation');
  assert.equal(address.level, 'offline-test');
  assert.equal(address.evidenceSufficient, true);
});

test('UI model keeps offline-verified Stellar visible while public-testnet promotion remains blocked', () => {
  const result = createCapabilityUiModel(envelope());
  const stellar = result.contracts.find(contract => contract.chainId === 'stellar');
  assert.ok(stellar);
  assert.equal(stellar.promotionEligible, false);
  assert.equal(stellar.stage, 'offline-verified');
  assert.ok(stellar.evidenceCounts['offline-test'] >= 1);
  assert.ok(stellar.blockers.some(value => value.includes('Public Stellar Testnet')));
  assert.equal(stellar.blockers.some(value => value.includes('@stellar/stellar-sdk')), false);
});

test('UI fails closed if backend validation is absent', () => {
  const raw = { schema: 'omegavault.api.chain-capabilities.v1', data: createCapabilityCatalogResponse() };
  const result = createCapabilityUiModel(raw);
  assert.equal(result.available, false);
  assert.equal(result.headline, 'Status unavailable');
  assert.deepEqual(result.contracts, []);
});

test('UI fails closed on malformed contract instead of inferring readiness', () => {
  const raw = structuredClone(envelope());
  raw.data.contracts[0].promotion.eligible = 'yes';
  const result = createCapabilityUiModel(raw);
  assert.equal(result.available, false);
  assert.match(result.reason, /malformed/);
});

test('UI fails closed on duplicate chain entries', () => {
  const raw = structuredClone(envelope());
  raw.data.contracts.push(structuredClone(raw.data.contracts[0]));
  const result = createCapabilityUiModel(raw);
  assert.equal(result.available, false);
  assert.match(result.reason, /duplicate/);
});


import { selectCapabilityContracts } from '../public/capability-ui.js';

test('UI filter uses backend eligibility flags without deriving promotion', () => {
  const model = createCapabilityUiModel(envelope());
  const blocked = selectCapabilityContracts(model, { filter: 'blocked' });
  const eligible = selectCapabilityContracts(model, { filter: 'eligible' });
  assert.ok(blocked.every(contract => contract.promotionEligible === false));
  assert.ok(eligible.every(contract => contract.promotionEligible === true));
  assert.equal(blocked.length + eligible.length, model.contracts.length);
});

test('UI stage sorting changes display order only', () => {
  const model = createCapabilityUiModel(envelope());
  const sorted = selectCapabilityContracts(model, { sort: 'stage' });
  assert.equal(sorted.length, model.contracts.length);
  assert.deepEqual(new Set(sorted.map(contract => contract.chainId)), new Set(model.contracts.map(contract => contract.chainId)));
});

test('UI filter fails closed on unknown filter/sort values', () => {
  const model = createCapabilityUiModel(envelope());
  assert.throws(() => selectCapabilityContracts(model, { filter: 'maybe' }), /Unknown capability filter/);
  assert.throws(() => selectCapabilityContracts(model, { sort: 'rank' }), /Unknown capability sort/);
});
