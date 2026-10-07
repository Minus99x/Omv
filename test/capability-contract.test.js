import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilityMaturityContract } from '../src/chains/capability-contract.js';
import { getMaturityProfile } from '../src/chains/maturity-profiles.js';

function adapter(id, implementationStage = 'scaffold') {
  return { id, name: id.toUpperCase(), implementationStage, capabilities: [] };
}
function network(chainId, id = `${chainId}:testnet`, implementationStage = 'scaffold') {
  return { id, chainId, name: `${chainId} testnet`, environment: 'testnet', implementationStage };
}
function contract(chainId, implementationStage = 'scaffold', networkStage = 'scaffold') {
  return createCapabilityMaturityContract({
    adapter: adapter(chainId, implementationStage),
    networks: [network(chainId, `${chainId}:testnet`, networkStage)],
    ...getMaturityProfile(chainId)
  });
}

test('legacy adapter labels cannot bypass evidence-backed promotion gates', () => {
  const ethereum = contract('ethereum', 'live-proof', 'live-proof');
  assert.equal(ethereum.adapterImplementationStage, 'live-proof');
  assert.equal(ethereum.stage, 'legacy-live-proof');
  assert.equal(ethereum.promotion.eligible, false);
  assert.ok(ethereum.promotion.missingGates.length > 0);
});
test('XDC contract preserves compatibility-ready label but requires fresh public-testnet evidence', () => {
  const xdc = contract('xdc', 'scaffold', 'compatibility-ready');
  assert.equal(xdc.stage, 'compatibility-ready');
  assert.equal(xdc.promotion.eligible, false);
  assert.equal(xdc.gateEvidence['address-validation'].evidenceSufficient, true);
  assert.equal(xdc.gateEvidence['native-asset-recovery'].passed, false);
  assert.ok(xdc.blockers.some(value => /Apothem/.test(value)));
});
test('a passed gate fails promotion sufficiency if evidence level is below the gate minimum', () => {
  const record = createCapabilityMaturityContract({
    adapter: adapter('example'),
    stage: 'source-verified',
    gateEvidence: { 'wallet-signing': { passed: true, level: 'offline-test', refs: ['fixture'] } }
  });
  assert.equal(record.gateEvidence['wallet-signing'].passed, true);
  assert.equal(record.gateEvidence['wallet-signing'].evidenceSufficient, false);
  assert.ok(record.promotion.insufficientEvidenceGates.includes('wallet-signing'));
});
test('passed gates require explicit evidence references', () => {
  assert.throws(() => createCapabilityMaturityContract({
    adapter: adapter('example'),
    gateEvidence: { 'network-profile': { passed: true, level: 'source', refs: [] } }
  }), /at least one evidence reference/);
});
test('network metadata cannot be cross-wired to the wrong adapter', () => {
  assert.throws(() => createCapabilityMaturityContract({
    adapter: adapter('stellar'),
    networks: [network('bitcoin', 'bitcoin:signet')]
  }), /does not belong/);
});
test('Stellar remains explicitly active with offline evidence while public-testnet promotion stays blocked', () => {
  const stellar = contract('stellar');
  assert.equal(stellar.chainId, 'stellar');
  assert.equal(stellar.stage, 'offline-verified');
  assert.equal(stellar.gateEvidence['address-validation'].evidenceSufficient, true);
  assert.equal(stellar.gateEvidence['transaction-preflight'].evidenceSufficient, true);
  assert.equal(stellar.gateEvidence['evidence-export'].evidenceSufficient, true);
  assert.equal(stellar.blockers.some(value => /stellar-sdk/.test(value)), false);
  assert.ok(stellar.blockers.some(value => /Stellar Testnet/.test(value)));
  assert.equal(stellar.promotion.eligible, false);
});

test('Bitcoin remains reduced-semantics after finalizer/Core evidence hardening', () => {
  const bitcoin = contract('bitcoin');
  assert.equal(bitcoin.chainId, 'bitcoin');
  assert.equal(bitcoin.stage, 'reduced-semantics');
  assert.equal(bitcoin.promotion.eligible, false);
  assert.ok(bitcoin.blockers.some(value => /Bitcoin Core|Signet/i.test(value)));
  assert.ok(bitcoin.blockers.some(value => /immutable rescue/i.test(value)));
  assert.equal(bitcoin.blockers.some(value => /Pinned Noble dependencies/i.test(value)), false);
  assert.equal(bitcoin.gateEvidence['native-asset-recovery'].evidenceSufficient, false);
  assert.equal(bitcoin.gateEvidence['immutable-rescue-semantics'].evidenceSufficient, false);
});
