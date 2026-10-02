import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilityCatalogResponse, getChainCapabilityContract } from '../src/chains/capability-catalog.js';
import { createEvidenceRecord } from '../src/core/evidence.js';
import {
  createValidatedCapabilityCatalogResponse,
  createValidatedEvidenceApiResponse,
  validateCapabilityCatalogResponse,
  validateCapabilityContractResponse,
  validateEvidenceApiPayload
} from '../src/api/response-contracts.js';

const clone = value => structuredClone(value);

test('capability API validator accepts generated catalog and wraps it in a versioned API schema', () => {
  const catalog = createCapabilityCatalogResponse();
  const validation = validateCapabilityCatalogResponse(catalog);
  assert.equal(validation.ok, true);
  assert.ok(validation.chainCount >= 8);
  const response = createValidatedCapabilityCatalogResponse(catalog);
  assert.equal(response.schema, 'omegavault.api.chain-capabilities.v1');
  assert.equal(response.validation.ok, true);
});

test('capability validator rejects a network cross-wired to the wrong chain', () => {
  const stellar = clone(getChainCapabilityContract('stellar'));
  stellar.networks[0].chainId = 'bitcoin';
  assert.throws(() => validateCapabilityContractResponse(stellar), /cross-wired/);
});

test('capability validator recomputes promotion eligibility', () => {
  const xdc = clone(getChainCapabilityContract('xdc'));
  xdc.promotion.eligible = true;
  assert.throws(() => validateCapabilityContractResponse(xdc), /eligibility/);
});

test('capability validator rejects forged evidence sufficiency', () => {
  const xdc = clone(getChainCapabilityContract('xdc'));
  xdc.gateEvidence['native-asset-recovery'].evidenceSufficient = true;
  assert.throws(() => validateCapabilityContractResponse(xdc), /sufficiency/);
});

test('capability catalog rejects duplicate chain contracts', () => {
  const catalog = clone(createCapabilityCatalogResponse());
  catalog.contracts.push(clone(catalog.contracts[0]));
  assert.throws(() => validateCapabilityCatalogResponse(catalog), /duplicate chain IDs/);
});

test('evidence API accepts a digest-valid record bound to its registered network', () => {
  const evidence = createEvidenceRecord({
    vaultId: 'vault-1', chainId: 'stellar', networkRef: 'stellar:testnet',
    actions: [{ type: 'fixture' }], finalState: { ok: true }
  }, new Date('2026-10-02T12:00:00Z'));
  assert.equal(createValidatedEvidenceApiResponse(evidence).validation.ok, true);
});

test('evidence API rejects digest-valid chain/network cross-wiring', () => {
  const evidence = createEvidenceRecord({
    vaultId: 'vault-2', chainId: 'bitcoin', networkRef: 'stellar:testnet',
    actions: [{ type: 'fixture' }], finalState: { ok: true }
  }, new Date('2026-10-02T12:00:00Z'));
  assert.throws(() => validateEvidenceApiPayload(evidence), /belongs to stellar, not bitcoin/);
});

test('evidence API rejects tampered evidence', () => {
  const evidence = clone(createEvidenceRecord({
    vaultId: 'vault-3', chainId: 'xdc', networkRef: 'xdc:apothem',
    actions: [{ type: 'fixture' }], finalState: { ok: true }
  }, new Date('2026-10-02T12:00:00Z')));
  evidence.finalState.ok = false;
  assert.throws(() => validateEvidenceApiPayload(evidence), /digest mismatch/i);
});
