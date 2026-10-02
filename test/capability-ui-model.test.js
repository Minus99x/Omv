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

test('UI model keeps dependency-blocked Stellar visible', () => {
  const result = createCapabilityUiModel(envelope());
  const stellar = result.contracts.find(contract => contract.chainId === 'stellar');
  assert.ok(stellar);
  assert.equal(stellar.promotionEligible, false);
  assert.ok(stellar.blockers.some(value => value.includes('@stellar/stellar-sdk')));
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
