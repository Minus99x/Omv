import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  validateXdcFinalityRpcObservation,
  createXdcProvenanceBoundFinality,
  xdcProvenancePackageMatchesProof
} from '../src/chains/evm/xdc-finality-provenance-binding.js';

const TX = '0x'+'11'.repeat(32);
const DIFFERENT_TX = '0x'+'44'.repeat(32);
const INCLUDED = '0x'+'22'.repeat(32);
const FINALIZED = '0x'+'33'.repeat(32);
const STAMP = '0x6553f100';
const NOW = 1700000100;
const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function proof(kind='native-recovery',tx=TX) {
  const binding = {kind,sha256:'a'.repeat(64),contextSha256:'b'.repeat(64),
    deploymentVerificationSha256:'c'.repeat(64)};
  return {success:true,networkRef:'xdc:apothem',chainId:'xdc',transactionRef:tx,
    bindingSha256:binding.sha256,binding};
}
function observation(tx=TX) {
  const core = {
    schema:'omegavault.xdc.apothem-finality-rpc-observation.v1',
    networkRef:'xdc:apothem',chainIdDecimal:51,
    observedChainIdHex:'0x33',
    transactionHash:tx,
    endpoints:['https://rpc.apothem.network','https://erpc.apothem.network'],
    latestHeadHeights:['44','43'],
    receipt:{transactionHash:tx,status:'0x1',blockNumber:'0x2a',blockHash:INCLUDED},
    receiptBlock:{number:'0x2a',hash:INCLUDED,timestamp:STAMP},
    finalizedBlock:{number:'0x2b',hash:FINALIZED,timestamp:STAMP},
    receiptInclusionCrossChecked:true,finalizedTagCrossChecked:true,
    fixedHeightRecheckVerified:true,chainIdRechecked:true,
    observedAt:new Date(NOW*1000).toISOString(),
    readOnly:true,transactionSigned:false,transactionSubmitted:false,
    authenticatedConsensusCertificate:false,providerInfrastructureIndependenceProven:false,
    recoveryProven:false,readyForLiveProofPromotion:false
  };
  return {...core,observationSha256:sha256(core)};
}
function rehash(o, changes={}) {
  const updated={...o,...changes};
  const {observationSha256:_old,...core}=updated;
  return {...core,observationSha256:sha256(core)};
}

test('XDC read-only RPC observation is checksum-valid and remains unauthenticated',()=>{
  const o=observation();
  const checked=validateXdcFinalityRpcObservation(o);
  assert.equal(checked.claimsConsistent,true);
  assert.equal(checked.rpcAuthenticated,false);
  assert.equal(checked.receiptHeight,'42');
  assert.equal(checked.finalizedHeight,'43');
  assert.equal(checked.observationSha256,o.observationSha256);
});

test('XDC package binds observation digest, recovery proof and EVM finality with no promotion',()=>{
  const o=observation(),p=proof();
  const bundle=createXdcProvenanceBoundFinality({observation:o,proof:p,kind:'native-recovery'});
  assert.equal(bundle.schema,'omegavault.xdc.provenance-bound-finality.v1');
  assert.equal(bundle.observationSha256,o.observationSha256);
  assert.equal(bundle.finalityEvidence.proofBindingSha256,p.bindingSha256);
  assert.equal(bundle.finalityEvidence.receipt.canonicalBlockHash,INCLUDED);
  assert.equal(bundle.finalityEvidence.finality.finalizedBlockNumber,'43');
  assert.equal(bundle.rpcAuthenticated,false);
  assert.equal(bundle.readyForLiveProofPromotion,false);
  assert.equal(bundle.recoveryProven,false);
  assert.match(bundle.packageSha256,/^[a-f0-9]{64}$/);
  assert.equal(xdcProvenancePackageMatchesProof(bundle,o,p,'native-recovery'),true);
});

test('independent ERC-20 recovery is supported but never confused with native recovery',()=>{
  const o=observation(),p=proof('erc20-recovery');
  const bundle=createXdcProvenanceBoundFinality({observation:o,proof:p,kind:'erc20-recovery'});
  assert.equal(bundle.kind,'erc20-recovery');
  assert.equal(xdcProvenancePackageMatchesProof(bundle,o,p,'erc20-recovery'),true);
  assert.equal(xdcProvenancePackageMatchesProof(bundle,o,p,'native-recovery'),false);
});

test('a substituted source checksum or altered observation is rejected',()=>{
  const o=observation();
  assert.throws(()=>validateXdcFinalityRpcObservation({...o,observationSha256:'0'.repeat(64)}),/checksum mismatch/);
  assert.throws(()=>validateXdcFinalityRpcObservation({...o,observedChainIdHex:'0x32'}),/network identity/);
  assert.throws(()=>validateXdcFinalityRpcObservation({...o,extra:'trust-me'}),/unexpected fields/);
  assert.throws(()=>validateXdcFinalityRpcObservation({...o,receipt:{...o.receipt,extra:1}}),/unexpected fields/);
});

test('rehashing mutated source cannot conceal wrong receipt hash, heights, or provider skew',()=>{
  const o=observation();
  for(const changed of [
    {receiptBlock:{...o.receiptBlock,hash:DIFFERENT_TX}},
    {receiptBlock:{...o.receiptBlock,number:'0x29'}},
    {finalizedBlock:{...o.finalizedBlock,number:'0x29'}},
    {finalizedBlock:{...o.finalizedBlock,number:'0x2a',hash:DIFFERENT_TX}},
    {latestHeadHeights:['60','43']},
    {latestHeadHeights:['43','41']},
    {receipt:{...o.receipt,transactionHash:DIFFERENT_TX}},
    {receipt:{...o.receipt,status:'0x0'}}
  ]) {
    assert.throws(()=>validateXdcFinalityRpcObservation(rehash(o,changed)));
  }
});

test('XDC cannot relabel a single provider or a non-independent provider as verified',()=>{
  const o=observation();
  for(const changed of [
    {endpoints:[o.endpoints[0]]},
    {endpoints:[o.endpoints[0],o.endpoints[0]]},
    {endpoints:[o.endpoints[1],o.endpoints[0]]},
    {chainIdRechecked:false},
    {fixedHeightRecheckVerified:false},
    {finalizedTagCrossChecked:false},
    {providerInfrastructureIndependenceProven:true},
    {authenticatedConsensusCertificate:true},
    {transactionSigned:true},
    {transactionSubmitted:true},
    {readyForLiveProofPromotion:true},
    {recoveryProven:true}
  ]) {
    assert.throws(()=>validateXdcFinalityRpcObservation(rehash(o,changed)));
  }
});

test('replayed and future-dated block observations fail their recorded freshness gate',()=>{
  const o=observation();
  for(const changed of [
    {observedAt:new Date((NOW+901)*1000).toISOString()},
    {observedAt:new Date((NOW-221)*1000).toISOString()},
    {receiptBlock:{...o.receiptBlock,timestamp:'0x1'}},
    {finalizedBlock:{...o.finalizedBlock,timestamp:'0x1'}},
    {observedAt:'2023-11-14T22:15:00Z'}
  ]) {
    assert.throws(()=>validateXdcFinalityRpcObservation(rehash(o,changed)));
  }
});

test('XDC observer cannot rehash a nonmonotonic receipt-to-finalized block chronology into valid evidence',()=>{
  const o=observation();
  const forged=rehash(o,{
    receiptBlock:{...o.receiptBlock,timestamp:'0x6553f101'}
  });
  assert.throws(()=>validateXdcFinalityRpcObservation(forged),/cannot follow finalized block timestamp/);
  assert.throws(()=>createXdcProvenanceBoundFinality({observation:forged,proof:proof(),kind:'native-recovery'}),/cannot follow finalized block timestamp/);
});

test('XDC package refuses wrong transaction, wrong chain, wrong kind or failed proof',()=>{
  const o=observation(),p=proof();
  for (const changed of [
    {...p,transactionRef:DIFFERENT_TX},
    {...p,networkRef:'ethereum:sepolia'},
    {...p,success:false},
    {...p,binding:{...p.binding,sha256:'d'.repeat(64)}}
  ]) {
    assert.throws(()=>createXdcProvenanceBoundFinality({observation:o,proof:changed,kind:'native-recovery'}));
  }
  assert.throws(()=>createXdcProvenanceBoundFinality({observation:o,proof:p,kind:'erc20-recovery'}),/kind/);
  assert.throws(()=>createXdcProvenanceBoundFinality({observation:o,proof:p,kind:'bogus'}),/kind/);
});

test('tampered package cannot match even if it uses a valid unchanged observation',()=>{
  const o=observation(),p=proof();
  const bundle=createXdcProvenanceBoundFinality({observation:o,proof:p,kind:'native-recovery'});
  for(const changed of [
    {...bundle,transactionHash:DIFFERENT_TX},
    {...bundle,readyForLiveProofPromotion:true},
    {...bundle,packageSha256:'0'.repeat(64)},
    {...bundle,finalityEvidence:{...bundle.finalityEvidence,receipt:{...bundle.finalityEvidence.receipt,blockHash:DIFFERENT_TX}}},
    {...bundle,unsupportedClaim:'yes'}
  ]) {
    assert.equal(xdcProvenancePackageMatchesProof(changed,o,p,'native-recovery'),false);
  }
});

test('a rewritten observation and checksum never authenticate that a provider really served it',()=>{
  const o=observation();
  const rewritten=rehash(o,{
    receipt:{...o.receipt,blockHash:DIFFERENT_TX},
    receiptBlock:{...o.receiptBlock,hash:DIFFERENT_TX}
  });
  const p=proof();
  const bundle=createXdcProvenanceBoundFinality({observation:rewritten,proof:p,kind:'native-recovery'});
  assert.equal(bundle.rpcAuthenticated,false);
  assert.equal(bundle.authenticatedConsensusCertificate,false);
  assert.equal(bundle.readyForLiveProofPromotion,false);
});


test('XDC rejects all-zero transaction and block hashes even with a rewritten observation checksum',()=>{
  const o=observation();
  const zero='0x'+'00'.repeat(32);
  for(const changed of [
    {transactionHash:zero},
    {receipt:{...o.receipt,transactionHash:zero}},
    {receipt:{...o.receipt,blockHash:zero}},
    {receiptBlock:{...o.receiptBlock,hash:zero}},
    {finalizedBlock:{...o.finalizedBlock,hash:zero}}
  ]) {
    const forged=rehash(o,changed);
    assert.throws(()=>validateXdcFinalityRpcObservation(forged),/all-zero hash/);
    assert.throws(()=>createXdcProvenanceBoundFinality({observation:forged,proof:proof(),kind:'native-recovery'}),/all-zero hash/);
  }
});
