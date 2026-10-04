import test from 'node:test';
import assert from 'node:assert/strict';
import { getChainCapabilityContract } from '../src/chains/capability-catalog.js';
import { resolveEvidenceProvenance, validateMaturityEvidenceProvenanceCoverage } from '../src/chains/evidence-provenance.js';

test('Cardano registers the sealed 0.6.51 toolchain proof with the exact archive identity', () => {
  const provenance = resolveEvidenceProvenance('0.6.51:CARDANO_TOOLCHAIN_EXECUTION');
  assert.ok(provenance);
  assert.equal(provenance.checkpointRef, '0.6.51-dev');
  assert.equal(provenance.archiveSha256, 'a4314cca883ba1caa82cd2c30973baa90d370a13265d1f45299c4253b1c3e501');
  assert.deepEqual(provenance.chainIds, ['cardano']);
  assert.ok(provenance.artifactPaths.includes('validators/cardano/plutus.json'));
});

test('Cardano removes only the obsolete toolchain-restoration blocker', () => {
  const cardano = getChainCapabilityContract('cardano');
  assert.equal(cardano.stage, 'offline-verified');
  assert.equal(cardano.blockers.some(value => /toolchain/i.test(value)), false);
  assert.equal(cardano.blockers.some(value => /Aiken/i.test(value)), false);
  assert.ok(cardano.blockers.some(value => /Preprod Ogmios evaluation/i.test(value)));
  assert.ok(cardano.blockers.some(value => /submission\/finality/i.test(value)));
});

test('Cardano offline evidence is sufficient where proven but live promotion remains closed', () => {
  const cardano = getChainCapabilityContract('cardano');
  assert.equal(cardano.gateEvidence['address-validation'].evidenceSufficient, true);
  assert.equal(cardano.gateEvidence['transaction-preflight'].evidenceSufficient, true);
  assert.equal(cardano.gateEvidence['adversarial-tests'].evidenceSufficient, true);
  assert.equal(cardano.gateEvidence['evidence-export'].evidenceSufficient, true);
  assert.equal(cardano.promotion.eligible, false);
  assert.ok(cardano.promotion.missingGates.includes('public-testnet-execution'));
  assert.ok(cardano.promotion.missingGates.includes('wallet-signing'));
  assert.ok(cardano.promotion.missingGates.includes('finality-proof'));
});

test('Cardano 0.6.51 provenance is healthy and chain-scoped', () => {
  assert.deepEqual(validateMaturityEvidenceProvenanceCoverage(), { ok: true, errors: [] });
});
