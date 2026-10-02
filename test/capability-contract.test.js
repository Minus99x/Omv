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
test('Stellar remains explicitly active but dependency-blocked rather than silently omitted', () => {
  const stellar = contract('stellar');
  assert.equal(stellar.chainId, 'stellar');
  assert.equal(stellar.stage, 'scaffold');
  assert.ok(stellar.blockers.some(value => /stellar-sdk/.test(value)));
  assert.ok(stellar.notes.some(value => /remains active/.test(value)));
});
