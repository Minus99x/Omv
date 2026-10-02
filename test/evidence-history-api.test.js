import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceHistoryCatalog } from '../src/chains/evidence-history.js';
import { createValidatedEvidenceHistoryCatalogResponse, validateEvidenceHistoryCatalogResponse } from '../src/api/response-contracts.js';
test('validated history API accepts backend-generated history', () => { const response=createValidatedEvidenceHistoryCatalogResponse(createEvidenceHistoryCatalog()); assert.equal(response.schema,'omegavault.api.evidence-history.v1'); assert.equal(response.validation.ok,true); });
test('history API rejects a forged predecessor relationship', () => { const h=structuredClone(createEvidenceHistoryCatalog()); if(h.checkpoints.length>1) h.checkpoints[1].previousEvidenceCheckpointRef=null; assert.throws(()=>validateEvidenceHistoryCatalogResponse(h),/Previous evidence checkpoint mismatch/); });
test('history API rejects provenance/archive drift', () => { const h=structuredClone(createEvidenceHistoryCatalog()); h.checkpoints[0].archiveSha256='12'.repeat(32); assert.throws(()=>validateEvidenceHistoryCatalogResponse(h),/provenance drift/); });
test('history API rejects unsafe artifact paths', () => { const h=structuredClone(createEvidenceHistoryCatalog()); h.checkpoints[0].artifactPaths[0]='../secret'; assert.throws(()=>validateEvidenceHistoryCatalogResponse(h),/Unsafe artifact path/); });
