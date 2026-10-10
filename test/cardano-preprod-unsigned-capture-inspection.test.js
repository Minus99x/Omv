import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { createCardanoPreprodAppliedValidatorIdentity } from '../src/chains/cardano/live-validator-identity.js';
import { inspectCardanoPreprodUnsignedCapture, loadVerifiedCardanoPreprodUnsignedCapture } from '../scripts/inspect-cardano-preprod-unsigned-capture.js';

const defs={
  appliedValidatorIdentity:['identitySha256','validatorIdentitySha256'],
  utxoBindingPlan:['planSha256','utxoBindingPlanSha256'],
  utxoBindingEvidence:['evidenceSha256','utxoBindingEvidenceSha256'],
  evaluationCandidate:['candidateSha256','evaluationCandidateSha256'],
  evaluationEvidence:['evidenceSha256','evaluationEvidenceSha256'],
  finalUnsignedCandidate:['candidateSha256','finalUnsignedCandidateSha256'],
  unsignedPhaseOnePreflight:['preflightSha256','unsignedPhaseOnePreflightSha256']
};
function sealed(doc,key){
  return {...doc,[key]:hashCardanoEvidence(doc)};
}
function save(path,json){
  writeFileSync(path,JSON.stringify(json,null,2));
}
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'ov-unsigned-cardano-'));
  const tip={hash:'ab'.repeat(32),slot:135973880};
  const files={};
  const identities={};
  const docs={};
  for (const [name,[digest,key]] of Object.entries(defs)){
    let body={schema:'fixture.'+name,network:'preprod',transactionSubmissionAuthorized:false};
    if(name==='utxoBindingEvidence')body.stableTip=tip;
    if(name==='finalUnsignedCandidate')body.transaction={keyWitnessCount:0};
    docs[name]=body;
  }
  // Produce exact cross-references before sealing the rest.
  // Reproduce the ACTUAL Aiken generator contract: derive deterministic
  // Plutus script hashes, seal that core, then append unsealed provenance.
  docs.appliedValidatorIdentity={
    ...createCardanoPreprodAppliedValidatorIdentity({
      seedReference:{transaction:{id:'cd'.repeat(32)},index:0},
      assetNameHex:'4f56',
      sourceBlueprintSha256:'ab'.repeat(32),
      beaconCompiledCode:'4e4d01000033222220051200120011',
      recoveryCompiledCode:'4e4d01000033222220051200120022'
    }),
    provenance:{
      aikenVersion:'fixture-test-only',
      sourceBlueprint:'validators/cardano/plutus.json',
      beaconAppliedBlueprintSha256:'ef'.repeat(32),
      recoveryAppliedBlueprintSha256:'fe'.repeat(32)
    }
  };
  docs.utxoBindingPlan=sealed(docs.utxoBindingPlan,'planSha256');
  docs.utxoBindingEvidence=sealed(docs.utxoBindingEvidence,'evidenceSha256');
  docs.evaluationCandidate=sealed(docs.evaluationCandidate,'candidateSha256');
  docs.finalUnsignedCandidate=sealed(docs.finalUnsignedCandidate,'candidateSha256');
  docs.unsignedPhaseOnePreflight={
    ...docs.unsignedPhaseOnePreflight,
    candidateSha256:docs.finalUnsignedCandidate.candidateSha256,
    validatorIdentitySha256:docs.appliedValidatorIdentity.identitySha256,
    utxoBindingEvidenceSha256:docs.utxoBindingEvidence.evidenceSha256,
    checks:{walletWitnessesPresent:false,fullPhaseOneValidated:false}
  };
  docs.unsignedPhaseOnePreflight=sealed(docs.unsignedPhaseOnePreflight,'preflightSha256');
  const snapshot={network:'preprod',source:{independentSourceCount:2},promotion:{independentlyConfirmed:true},tip:{blockHash:tip.hash,slot:tip.slot}};
  docs.evaluationEvidence=sealed({
    ...docs.evaluationEvidence,
    stableTip:tip,
    validatorIdentitySha256:docs.appliedValidatorIdentity.identitySha256,
    utxoBindingPlanSha256:docs.utxoBindingPlan.planSha256,
    utxoBindingEvidenceSha256:docs.utxoBindingEvidence.evidenceSha256,
    evaluationCandidateSha256:docs.evaluationCandidate.candidateSha256,
    finalUnsignedCandidateSha256:docs.finalUnsignedCandidate.candidateSha256,
    unsignedPhaseOnePreflightSha256:docs.unsignedPhaseOnePreflight.preflightSha256,
    protocolSnapshot:snapshot
  },'evidenceSha256');
  for (const [name,[digest,key]] of Object.entries(defs)){
    if (!docs[name][digest])docs[name]=sealed(docs[name],digest);
    files[name]=name+'.json';
    identities[key]=docs[name][digest];
    save(join(root,files[name]),docs[name]);
  }
  files.protocolSnapshot='protocol.json';save(join(root,files.protocolSnapshot),snapshot);
  const manifest=sealed({
    schema:'omegavault.cardano.preprod-real-initialize-capture-manifest.v1',network:'preprod',
    files,identities,
    synchronizedRealInitializeEvaluationComplete:true,
    fullPhaseOneValidated:false,walletSigningPerformed:false,walletSigningAuthorized:false,
    transactionSubmissionPerformed:false,transactionSubmissionAuthorized:false,supportClaimAuthorized:false
  },'manifestSha256');
  save(join(root,'capture-manifest.json'),manifest);
  return {root,files,manifest};
}
test('checks seven bound artifacts and expressly does not claim current ledger freshness',async()=>{
  const {root}=fixture();
  try {
    const result=await inspectCardanoPreprodUnsignedCapture(root);
    assert.equal(result.ok,true);
    assert.equal(result.checkedBoundArtifactCount,7);
    assert.equal(result.protocolSnapshotWholeDocumentDigestBoundToManifest,true);
    assert.match(result.protocolSnapshotBindingPath,/evaluationEvidenceSha256/);
    assert.equal(result.validatorIdentityAppliedCodeAndAddressVerified,true);
    assert.equal(result.validatorIdentitySupplementalAikenProvenanceBoundByIdentitySha256,false);
    assert.equal(result.completePhaseOneValidated,false);
    assert.equal(result.walletSigningAuthorized,false);
    assert.equal(result.transactionSubmissionAuthorized,false);
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('rejects tampering of candidate bytes even if attacker recomputes its own digest',async()=>{
  const {root,files}=fixture();
  try{
    const path=join(root,files.finalUnsignedCandidate);
    const current=JSON.parse(readFileSync(path,'utf8'));
    const broken={...current,transaction:{...current.transaction,keyWitnessCount:1}};
    delete broken.candidateSha256;
    save(path,sealed(broken,'candidateSha256'));
    await assert.rejects(()=>inspectCardanoPreprodUnsignedCapture(root),/not bound to the captured manifest/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('rejects altered protocol tip through whole-snapshot digest binding',async()=>{
  const {root,files}=fixture();
  try{
    const path=join(root,files.protocolSnapshot);
    const doc=JSON.parse(readFileSync(path,'utf8'));doc.tip.slot++;
    save(path,doc);
    await assert.rejects(()=>inspectCardanoPreprodUnsignedCapture(root),/Standalone protocol snapshot differs from manifest-bound evaluation evidence/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('blocks path traversal in capture file map',async()=>{
  const {root}=fixture();
  try{
    const p=join(root,'capture-manifest.json');
    const m=JSON.parse(readFileSync(p,'utf8'));
    m.files.finalUnsignedCandidate='../escape.json';
    delete m.manifestSha256;
    save(p,sealed(m,'manifestSha256'));
    await assert.rejects(()=>inspectCardanoPreprodUnsignedCapture(root),/escapes the capture directory/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('rejects changed on-chain identity policy while preserving the pre-provenance digest',async()=>{
  const {root,files}=fixture();
  try{
    const path=join(root,files.appliedValidatorIdentity);
    const doc=JSON.parse(readFileSync(path,'utf8'));
    doc.stateBeacon.policyId='aa'.repeat(28);
    save(path,doc);
    await assert.rejects(()=>inspectCardanoPreprodUnsignedCapture(root),/Applied validator identity verification failed/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('Aiken provenance is supplemental and not falsely treated as digest-sealed',async()=>{
  const {root,files}=fixture();
  try{
    const path=join(root,files.appliedValidatorIdentity);
    const doc=JSON.parse(readFileSync(path,'utf8'));
    doc.provenance.aikenVersion='unbound-provenance-edited';
    save(path,doc);
    const result=await inspectCardanoPreprodUnsignedCapture(root);
    assert.equal(result.ok,true);
    assert.equal(result.validatorIdentitySupplementalAikenProvenanceBoundByIdentitySha256,false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('V1 snapshot is cryptographically sealed indirectly by evaluation-evidence hash',async()=>{
  const {root,files}=fixture();
  try{
    const path=join(root,files.protocolSnapshot);
    const snapshot=JSON.parse(readFileSync(path,'utf8'));
    snapshot.captureExtra={unverified:'mutated while preserving same tip'};
    save(path,snapshot);
    await assert.rejects(()=>inspectCardanoPreprodUnsignedCapture(root),/Standalone protocol snapshot differs from manifest-bound evaluation evidence/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('rejects forged cross-artifact pointer even when evaluation evidence digest is recomputed',async()=>{
  const {root,files}=fixture();
  try{
    const path=join(root,files.evaluationEvidence);
    const evidence=JSON.parse(readFileSync(path,'utf8'));
    evidence.finalUnsignedCandidateSha256='ee'.repeat(32);
    delete evidence.evidenceSha256;
    save(path,sealed(evidence,'evidenceSha256'));
    await assert.rejects(()=>inspectCardanoPreprodUnsignedCapture(root),/not bound to the captured manifest/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('loads immutable verified documents and never exposes modified disk evidence',async()=>{
  const {root,files}=fixture();
  try {
    const verified=await loadVerifiedCardanoPreprodUnsignedCapture(root);
    assert.equal(verified.report.ok,true);
    assert.equal(verified.report.checkedBoundArtifactCount,7);
    assert.equal(verified.documents.protocolSnapshot.tip.slot,135973880);
    assert.equal(verified.documents.finalUnsignedCandidate.transaction.keyWitnessCount,0);
    assert.equal(Object.isFrozen(verified),true);
    assert.equal(Object.isFrozen(verified.documents),true);
    assert.equal(Object.isFrozen(verified.documents.protocolSnapshot.tip),true);
    assert.equal(Object.isFrozen(verified.documents.finalUnsignedCandidate.transaction),true);
    assert.throws(()=>{
      verified.documents.finalUnsignedCandidate.transaction.keyWitnessCount=1;
    },TypeError);
    assert.throws(()=>{
      verified.documents.protocolSnapshot.tip.slot=1;
    },TypeError);

    // Simulate modification after inspection: existing trusted objects must
    // retain their verified bytes, while any fresh inspection fails closed.
    const p=join(root,files.finalUnsignedCandidate);
    const changed=JSON.parse(readFileSync(p,'utf8'));
    changed.transaction.keyWitnessCount=1;
    save(p,changed);
    assert.equal(verified.documents.finalUnsignedCandidate.transaction.keyWitnessCount,0);
    await assert.rejects(
      ()=>loadVerifiedCardanoPreprodUnsignedCapture(root),
      /candidateSha256 does not reproduce/
    );
  } finally { rmSync(root,{recursive:true,force:true}); }
});
