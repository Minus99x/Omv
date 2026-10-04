import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilityCatalogResponse, getChainCapabilityContract, listChainCapabilityContracts } from '../src/chains/capability-catalog.js';

test('capability catalog is dependency-free and contains each supported chain once', () => {
  const contracts = listChainCapabilityContracts();
  const ids = contracts.map(contract => contract.chainId);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of ['ethereum', 'xdc', 'stellar', 'bitcoin', 'solana', 'xrpl', 'tron', 'cardano']) assert.ok(ids.includes(id));
});
test('catalog exposes implementation label separately from evidence-backed promotion state', () => {
  const ethereum = getChainCapabilityContract('ethereum');
  assert.equal(ethereum.adapterImplementationStage, 'live-proof');
  assert.equal(ethereum.stage, 'legacy-live-proof');
  assert.equal(ethereum.promotion.eligible, false);
});
test('Stellar catalog entry is offline-verified without pretending public-testnet proof exists', () => {
  const stellar = getChainCapabilityContract('stellar');
  assert.equal(stellar.name, 'Stellar');
  assert.equal(stellar.networks[0].id, 'stellar:testnet');
  assert.equal(stellar.stage, 'offline-verified');
  assert.equal(stellar.promotion.eligible, false);
  assert.ok(stellar.blockers.some(value => /Stellar Testnet execution/.test(value)));
  assert.equal(stellar.blockers.some(value => value.includes('@stellar/stellar-sdk')), false);
});
test('XDC catalog exposes offline evidence but blocks live promotion', () => {
  const xdc = getChainCapabilityContract('xdc');
  assert.equal(xdc.networks[0].id, 'xdc:apothem');
  assert.equal(xdc.gateEvidence['address-validation'].evidenceSufficient, true);
  assert.equal(xdc.promotion.eligible, false);
});
test('unknown chain lookup fails closed with null', () => {
  assert.equal(getChainCapabilityContract('unknown-chain'), null);
});
test('capability API response builder has a stable explicit schema', () => {
  const response = createCapabilityCatalogResponse();
  assert.equal(response.schema, 'omegavault.chain-capability-catalog.v1');
  assert.ok(Array.isArray(response.contracts));
  assert.ok(response.contracts.every(contract => contract.schema === 'omegavault.chain-capability-contract.v1'));
  assert.equal(Object.isFrozen(response), true);
  assert.equal(Object.isFrozen(response.contracts), true);
});
