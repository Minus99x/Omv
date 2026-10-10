import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { createCardanoPreprodAppliedValidatorIdentity } from '../src/chains/cardano/live-validator-identity.js';
import { createCardanoPreprodLiveProtocolSnapshot } from '../src/chains/cardano/live-protocol-parameters.js';
import { recheckCardanoPreprodCapturedLedger } from '../scripts/recheck-cardano-preprod-unsigned-ledger.js';

const tip={hash:'ab'.repeat(32),slot:135973880};
const newTip={hash:'cd'.repeat(32),slot:135973980};
const costModel=Array.from({length:350},(_,i)=>i-10);
const seed={transaction:{id:'11'.repeat(32)},index:0};
const collateral={transaction:{id:'22'.repeat(32)},index:1};
const roles={
  seed:{reference:seed,address:'addr_test1_seed_fixture',lovelace:'20000000'},
  collateral:{reference:collateral,address:'addr_test1_collateral_fixture',lovelace:'5000000'}
};
const digests={
  appliedValidatorIdentity:['identitySha256','validatorIdentitySha256'],
  utxoBindingPlan:['planSha256','utxoBindingPlanSha256'],
  utxoBindingEvidence:['evidenceSha256','utxoBindingEvidenceSha256'],
  evaluationCandidate:['candidateSha256','evaluationCandidateSha256'],
  evaluationEvidence:['evidenceSha256','evaluationEvidenceSha256'],
  finalUnsignedCandidate:['candidateSha256','finalUnsignedCandidateSha256'],
  unsignedPhaseOnePreflight:['preflightSha256','unsignedPhaseOnePreflightSha256']
};
const seal=(doc,key)=>({...doc,[key]:hashCardanoEvidence(doc)});
const save=(path,doc)=>writeFileSync(path,JSON.stringify(doc,null,2));

function providers(){
  const ogmios={
    version:{major:11,minor:0},
    minFeeCoefficient:44,
    minFeeConstant:{ada:{lovelace:155381}},
    maxTransactionSize:{bytes:16384},
    maxValueSize:{bytes:5000},
    minUtxoDepositCoefficient:4310,
    scriptExecutionPrices:{memory:'577/10000',cpu:'721/10000000'},
    maxExecutionUnitsPerTransaction:{memory:17500000,cpu:10000000000},
    collateralPercentage:150,maxCollateralInputs:3,
    plutusCostModels:{'plutus:v3':costModel}
  };
  const blockfrost={
    epoch:400,protocol_major_ver:11,protocol_minor_ver:0,
    min_fee_a:44,min_fee_b:155381,max_tx_size:16384,max_val_size:'5000',
    coins_per_utxo_size:'4310',price_mem:0.0577,price_step:0.0000721,
    max_tx_ex_mem:'17500000',max_tx_ex_steps:'10000000000',
    collateral_percent:150,max_collateral_inputs:3,
    cost_models_raw:{PlutusV3:costModel}
  };
  return {ogmios,blockfrost};
}
function snapshot(at,raw){
  return createCardanoPreprodLiveProtocolSnapshot({
    ogmiosParameters:raw.ogmios,blockfrostParameters:raw.blockfrost,
    epoch:400,tip:at,blockHeight:6000000,capturedAt:'2026-10-10T00:00:00.000Z'
  });
}
function savedCapture(raw){
  const root=mkdtempSync(join(tmpdir(),'ov-preprod-ledger-e2e-'));
  const files={},identities={};
  const docs={
    appliedValidatorIdentity:{
      ...createCardanoPreprodAppliedValidatorIdentity({
        seedReference:{transaction:{id:'cd'.repeat(32)},index:0},
        assetNameHex:'4f56',sourceBlueprintSha256:'ab'.repeat(32),
        beaconCompiledCode:'4e4d01000033222220051200120011',
        recoveryCompiledCode:'4e4d01000033222220051200120022'
      }),
      provenance:{aikenVersion:'test-fixture-only'}
    },
    utxoBindingPlan:{schema:'fixture.utxoPlan'},
    utxoBindingEvidence:{schema:'fixture.utxoBinding',stableTip:tip,roles},
    evaluationCandidate:{schema:'fixture.evaluationCandidate'},
    finalUnsignedCandidate:{
      schema:'fixture.finalUnsignedCandidate',
      transaction:{keyWitnessCount:0},
      validity:{lowerSlot:tip.slot-10,upperSlot:tip.slot+1500}
    }
  };
  for(const [name,key] of [
    ['utxoBindingPlan','planSha256'],
    ['utxoBindingEvidence','evidenceSha256'],
    ['evaluationCandidate','candidateSha256'],
    ['finalUnsignedCandidate','candidateSha256']
  ])docs[name]=seal(docs[name],key);
  docs.unsignedPhaseOnePreflight=seal({
    schema:'fixture.unsignedPreflight',
    candidateSha256:docs.finalUnsignedCandidate.candidateSha256,
    validatorIdentitySha256:docs.appliedValidatorIdentity.identitySha256,
    utxoBindingEvidenceSha256:docs.utxoBindingEvidence.evidenceSha256,
    checks:{walletWitnessesPresent:false,fullPhaseOneValidated:false}
  },'preflightSha256');
  const capturedSnapshot=snapshot(tip,raw);
  docs.evaluationEvidence=seal({
    schema:'fixture.evaluationEvidence',stableTip:tip,
    validatorIdentitySha256:docs.appliedValidatorIdentity.identitySha256,
    utxoBindingPlanSha256:docs.utxoBindingPlan.planSha256,
    utxoBindingEvidenceSha256:docs.utxoBindingEvidence.evidenceSha256,
    evaluationCandidateSha256:docs.evaluationCandidate.candidateSha256,
    finalUnsignedCandidateSha256:docs.finalUnsignedCandidate.candidateSha256,
    unsignedPhaseOnePreflightSha256:docs.unsignedPhaseOnePreflight.preflightSha256,
    protocolSnapshot:capturedSnapshot
  },'evidenceSha256');
  for(const [name,[digest,manifestKey]] of Object.entries(digests)){
    if(!docs[name][digest])docs[name]=seal(docs[name],digest);
    files[name]=name+'.json';
    identities[manifestKey]=docs[name][digest];
    save(join(root,files[name]),docs[name]);
  }
  files.protocolSnapshot='protocol.json';
  save(join(root,files.protocolSnapshot),capturedSnapshot);
  save(join(root,'capture-manifest.json'),seal({
    schema:'omegavault.cardano.preprod-real-initialize-capture-manifest.v1',
    network:'preprod',files,identities,
    synchronizedRealInitializeEvaluationComplete:true,
    fullPhaseOneValidated:false,walletSigningAuthorized:false,
    walletSigningPerformed:false,transactionSubmissionAuthorized:false,
    transactionSubmissionPerformed:false,supportClaimAuthorized:false
  },'manifestSha256'));
  return {root,files};
}
function mockedReads(raw, tips=[newTip,newTip]){
  const calls=[];
  let tipIndex=0;
  const client={
    async rpc(method,params){
      calls.push(method);
      if(method==='queryNetwork/tip')return {result:{tip:tips[tipIndex++] ?? tips.at(-1)}};
      if(method==='queryLedgerState/utxo'){
        assert.deepEqual(params.outputReferences,[seed,collateral]);
        return {result:[
          {...seed,address:roles.seed.address,value:{ada:{lovelace:20000000}}},
          {...collateral,address:roles.collateral.address,value:{ada:{lovelace:5000000}}}
        ]};
      }
      if(method==='queryLedgerState/epoch')return {result:{epoch:400}};
      if(method==='queryNetwork/blockHeight')return {result:{height:6000000}};
      if(method==='queryLedgerState/protocolParameters')return {result:raw.ogmios};
      throw new Error('Unexpected read-only method: '+method);
    }
  };
  const fetchImpl=async(url,options)=>{
    calls.push('blockfrost');
    assert.match(url,/cardano-preprod\.blockfrost\.io\/api\/v0\/epochs\/latest\/parameters/);
    assert.equal(options.headers.project_id,'fixture-provider-id');
    return {ok:true,json:async()=>raw.blockfrost};
  };
  return {client,fetchImpl,calls};
}
async function withinCapture(callback){
  const raw=providers(),{root,files}=savedCapture(raw);
  try{return await callback({raw,root,files});}
  finally{rmSync(root,{recursive:true,force:true});}
}
test('full offline-to-provider recheck verifies saved artifacts before read-only queries',async()=>{
  await withinCapture(async({raw,root})=>{
    const reads=mockedReads(raw);
    const report=await recheckCardanoPreprodCapturedLedger({
      capture:root,client:reads.client,fetchImpl:reads.fetchImpl,
      blockfrostProjectId:'fixture-provider-id'
    });
    assert.equal(report.ok,true);
    assert.equal(report.stableTipAttempt,1);
    assert.equal(report.originalUTxOsUnspentAndUnchanged,true);
    assert.equal(report.independentlyCorroboratedProtocolValuesUnchanged,true);
    assert.equal(report.candidateStillWithinValidity,true);
    assert.equal(report.liveOgmiosAndBlockfrostReadsPerformed,true);
    assert.equal(report.currentTwoSourceProtocolAgreement,true);
    assert.equal(report.currentStableTipAndUTxOStateChecked,true);
    assert.equal(report.walletSigningAuthorized,false);
    assert.equal(report.transactionSubmissionAuthorized,false);
    assert.deepEqual(reads.calls,[
      'queryNetwork/tip','queryLedgerState/utxo','queryLedgerState/epoch',
      'queryNetwork/blockHeight','queryLedgerState/protocolParameters',
      'blockfrost','queryNetwork/tip'
    ]);
  });
});
test('tampered saved protocol evidence blocks before any provider call',async()=>{
  await withinCapture(async({raw,root,files})=>{
    const p=join(root,files.protocolSnapshot);
    const changed=JSON.parse(readFileSync(p,'utf8'));
    changed.tip.slot++;
    save(p,changed);
    const reads=mockedReads(raw);
    await assert.rejects(()=>recheckCardanoPreprodCapturedLedger({
      capture:root,client:reads.client,fetchImpl:reads.fetchImpl,
      blockfrostProjectId:'fixture-provider-id'
    }),/Standalone protocol snapshot differs/);
    assert.deepEqual(reads.calls,[]);
  });
});
test('unstable first tip retries and only attests after stable bracket',async()=>{
  await withinCapture(async({raw,root})=>{
    const drift={hash:'ef'.repeat(32),slot:newTip.slot+1};
    const settled={hash:'ee'.repeat(32),slot:newTip.slot+2};
    const reads=mockedReads(raw,[newTip,drift,settled,settled]);
    const report=await recheckCardanoPreprodCapturedLedger({
      capture:root,client:reads.client,fetchImpl:reads.fetchImpl,
      blockfrostProjectId:'fixture-provider-id'
    });
    assert.equal(report.stableTipAttempt,2);
    assert.equal(report.checkedTip.hash,settled.hash);
    assert.equal(reads.calls.filter(c=>c==='queryLedgerState/utxo').length,2);
  });
});
test('provider protocol-parameter disagreement blocks live recheck',async()=>{
  await withinCapture(async({raw,root})=>{
    const reads=mockedReads({...raw,blockfrost:{...raw.blockfrost,min_fee_a:45}});
    await assert.rejects(()=>recheckCardanoPreprodCapturedLedger({
      capture:root,client:reads.client,fetchImpl:reads.fetchImpl,
      blockfrostProjectId:'fixture-provider-id'
    }),/disagreement: minFeeA/);
    assert.equal(reads.calls.includes('blockfrost'),true);
  });
});
