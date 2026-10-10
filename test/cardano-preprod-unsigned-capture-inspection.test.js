import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { inspectCardanoPreprodUnsignedCapture } from '../scripts/inspect-cardano-preprod-unsigned-capture.js';

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
  docs.appliedValidatorIdentity=sealed(docs.appliedValidatorIdentity,'identitySha256');
  docs.utxoBindingEvidence=sealed(docs.utxoBindingEvidence,'evidenceSha256');
  docs.finalUnsignedCandidate=sealed(docs.finalUnsignedCandidate,'candidateSha256');
  docs.unsignedPhaseOnePreflight={
    ...docs.unsignedPhaseOnePreflight,
    candidateSha256:docs.finalUnsignedCandidate.candidateSha256,
    validatorIdentitySha256:docs.appliedValidatorIdentity.identitySha256,
    utxoBindingEvidenceSha256:docs.utxoBindingEvidence.evidenceSha256,
    checks:{walletWitnessesPresent:false,fullPhaseOneValidated:false}
  };
  for (const [name,[digest,key]] of Object.entries(defs)){
    if (!docs[name][digest])docs[name]=sealed(docs[name],digest);
    files[name]=name+'.json';
    identities[key]=docs[name][digest];
    save(join(root,files[name]),docs[name]);
  }
  const snapshot={network:'preprod',source:{independentSourceCount:2},promotion:{independentlyConfirmed:true},tip:{blockHash:tip.hash,slot:tip.slot}};
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
    assert.equal(result.protocolSnapshotWholeDocumentDigestBoundToManifest,false);
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
test('rejects altered protocol tip even though the v1 manifest does not bind its full body',async()=>{
  const {root,files}=fixture();
  try{
    const path=join(root,files.protocolSnapshot);
    const doc=JSON.parse(readFileSync(path,'utf8'));doc.tip.slot++;
    save(path,doc);
    await assert.rejects(()=>inspectCardanoPreprodUnsignedCapture(root),/disagree with the UTxO stable tip/);
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
