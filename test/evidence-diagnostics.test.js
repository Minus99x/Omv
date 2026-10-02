import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceDiagnosticsCatalog } from '../src/chains/evidence-diagnostics.js';
test('diagnostics cover every catalogued chain exactly once',()=>{const c=createEvidenceDiagnosticsCatalog();assert.equal(c.schema,'omegavault.evidence-diagnostics-catalog.v1');assert.equal(c.summary.chainCount,c.diagnostics.length);assert.equal(new Set(c.diagnostics.map(i=>i.chainId)).size,c.diagnostics.length);});
test('diagnostics copy backend promotion state and expose evidence gaps',()=>{const x=createEvidenceDiagnosticsCatalog().diagnostics.find(i=>i.chainId==='xdc');assert.ok(x);assert.equal(x.promotionEligible,false);assert.equal(x.severity,'gaps-present');assert.ok(x.missingGates.length>0);});
test('provenance health is separate from promotion eligibility',()=>{const x=createEvidenceDiagnosticsCatalog().diagnostics.find(i=>i.chainId==='xdc');assert.equal(x.provenanceHealthy,true);assert.equal(x.promotionEligible,false);});
test('explicit lineage does not infer ancestry from version order',()=>{for(const i of createEvidenceDiagnosticsCatalog().diagnostics){assert.equal(i.explicitLineage.semantics,'cryptographic-parent-bindings-only');if(i.explicitLineage.status==='not-recorded')assert.equal(i.explicitLineage.recordedRefCount,0);}});
