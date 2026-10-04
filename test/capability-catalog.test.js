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
test('Stellar catalog reflects dependency-backed offline execution without implying public-testnet proof', () => {
  const stellar = getChainCapabilityContract('stellar');
  assert.equal(stellar.name, 'Stellar');
  assert.equal(stellar.networks[0].id, 'stellar:testnet');
  assert.equal(stellar.stage, 'offline-verified');
  assert.equal(stellar.gateEvidence['address-validation'].evidenceSufficient, true);
  assert.equal(stellar.gateEvidence['transaction-preflight'].evidenceSufficient, true);
  assert.equal(stellar.gateEvidence['evidence-export'].evidenceSufficient, true);
  assert.ok(stellar.blockers.some(value => value.includes('Public Stellar Testnet')));
  assert.equal(stellar.blockers.some(value => value.includes('@stellar/stellar-sdk')), false);
  assert.equal(stellar.promotion.eligible, false);
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


test('Bitcoin catalog removes the resolved Noble blocker but preserves reduced-semantics and live-proof gaps', () => {
  const bitcoin = getChainCapabilityContract('bitcoin');
  assert.equal(bitcoin.stage, 'reduced-semantics');
  assert.equal(bitcoin.gateEvidence['address-validation'].evidenceSufficient, true);
  assert.equal(bitcoin.gateEvidence['transaction-preflight'].evidenceSufficient, true);
  assert.equal(bitcoin.gateEvidence['evidence-export'].evidenceSufficient, true);
  assert.equal(bitcoin.blockers.some(value => value.includes('Noble')), false);
  assert.ok(bitcoin.blockers.some(value => value.includes('Signet')));
  assert.ok(bitcoin.blockers.some(value => value.includes('immutable rescue')));
  assert.equal(bitcoin.promotion.eligible, false);
});
