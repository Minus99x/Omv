import test from 'node:test';
import assert from 'node:assert/strict';
import { APOTHEM_ENDPOINTS } from '../scripts/xdc-apothem-independent-rpc-check.js';
import { observeApothemFinalityProvenance } from '../scripts/xdc-apothem-finality-provenance.js';
import { createEvmBlockFinalityEvidence } from '../src/chains/evm/finality-evidence.js';

const TX = '0x' + '11'.repeat(32);
const RECEIPT_BLOCK = '0x' + '22'.repeat(32);
const FINAL_BLOCK = '0x' + '33'.repeat(32);
const OTHER = '0x' + '44'.repeat(32);
const NOW = 1700000100;
const TIME = '0x6553f100';

function provider(options = {}) {
  const calls = [];
  const blockCounts = new Map();
  const chainCounts = new Map();
  const response = async (url, request) => {
    assert.ok(APOTHEM_ENDPOINTS.includes(url), 'no request outside fixed Apothem endpoints');
    assert.equal(request.method, 'POST');
    assert.ok(request.signal, 'RPC timeout required');
    const input = JSON.parse(request.body);
    assert.equal(input.jsonrpc,'2.0');
    assert.ok(['eth_chainId','eth_blockNumber','eth_getTransactionReceipt','eth_getBlockByNumber']
      .includes(input.method), 'read-only methods only');
    const idx = APOTHEM_ENDPOINTS.indexOf(url);
    calls.push({ idx, input });
    const k = idx + ':' + input.params?.[0];
    if (input.method === 'eth_getBlockByNumber') blockCounts.set(k,(blockCounts.get(k) ?? 0)+1);
    if (input.method === 'eth_chainId') chainCounts.set(idx,(chainCounts.get(idx) ?? 0)+1);
    let result;
    if (input.method === 'eth_chainId') {
      result = idx === 1 && (chainCounts.get(idx) === 2 ? options.chainLate : options.chainSecond)
        ? (chainCounts.get(idx) === 2 ? options.chainLate : options.chainSecond) : '0x33';
    }
    if (input.method === 'eth_blockNumber') {
      result = idx === 1 ? (options.headSecond ?? '0x2b') : (options.headFirst ?? '0x2c');
    }
    if (input.method === 'eth_getTransactionReceipt') {
      assert.deepEqual(input.params,[TX]);
      result = { transactionHash: TX,
        status: idx===1 ? (options.statusSecond ?? '0x1') : (options.statusFirst ?? '0x1'),
        blockNumber: idx===1 ? (options.receiptHeightSecond ?? '0x2a') : '0x2a',
        blockHash: idx===1 ? (options.receiptHashSecond ?? RECEIPT_BLOCK) : RECEIPT_BLOCK
      };
      if (idx===1 && options.wrongReceiptTx) result.transactionHash=OTHER;
      if (idx===1 && options.nullReceipt) result=null;
    }
    if (input.method === 'eth_getBlockByNumber') {
      const [tag,withTx] = input.params;
      assert.equal(withTx,false);
      if (tag === '0x2a') {
        result = { number: idx===1 ? (options.inclusionHeightSecond ?? '0x2a') : '0x2a',
          hash: idx===1 ? (options.inclusionHashSecond ?? RECEIPT_BLOCK) : RECEIPT_BLOCK,
          timestamp: idx===1 ? (options.inclusionTimestampSecond ?? TIME) : TIME };
        if (blockCounts.get(k) === 2 && idx===0 && options.inclusionReorg) result.hash=OTHER;
      } else if (tag === 'finalized') {
        result = { number: idx===1 ? (options.finalHeightSecond ?? '0x2b') : (options.finalHeightFirst ?? '0x2b'),
          hash: idx===1 ? (options.finalHashSecond ?? FINAL_BLOCK) : FINAL_BLOCK,
          timestamp: idx===1 ? (options.finalTimestampSecond ?? TIME) : TIME };
      } else if (tag === '0x2b') {
        result = { number:'0x2b',hash:idx===0 && options.finalReorg ? OTHER : FINAL_BLOCK,
          timestamp:TIME };
      } else {
        throw new Error('Unexpected block tag '+tag);
      }
    }
    if (idx===1 && options.httpFailure && input.method==='eth_getTransactionReceipt')
      return {ok:false,status:503};
    if (idx===1 && options.transportFailure && input.method==='eth_getTransactionReceipt')
      throw new Error('transport unavailable');
    if (idx===1 && options.invalidJson && input.method==='eth_getTransactionReceipt')
      return {ok:true,async json(){throw new Error('bad JSON')}};
    return {ok:true,async json(){
      return {jsonrpc:'2.0',id:idx===1 && options.wrongRpcId ? input.id+1 : input.id,
        ...(idx===1 && options.rpcError && input.method==='eth_getTransactionReceipt'
          ? {error:{code:-32000,message:'blocked'}} : {result})};
    }};
  };
  return { fetchImpl:response, calls };
}
async function observe(opts={}) {
  const mock = provider(opts);
  return {mock, report:await observeApothemFinalityProvenance({
    transactionHash:TX,fetchImpl:mock.fetchImpl,nowSeconds:NOW
  })};
}
async function rejects(opts,pattern) {
  const mock=provider(opts);
  await assert.rejects(observeApothemFinalityProvenance({
    transactionHash:TX,fetchImpl:mock.fetchImpl,nowSeconds:NOW
  }),pattern);
  return mock;
}

test('read-only Apothem proof compares both fixed providers and rechecks both canonical heights',async()=>{
  const {mock,report}=await observe();
  assert.equal(report.transactionHash,TX);
  assert.equal(report.receiptBlock.hash,RECEIPT_BLOCK);
  assert.equal(report.finalizedBlock.hash,FINAL_BLOCK);
  assert.equal(report.receiptInclusionCrossChecked,true);
  assert.equal(report.finalizedTagCrossChecked,true);
  assert.equal(report.fixedHeightRecheckVerified,true);
  assert.equal(report.chainIdRechecked,true);
  assert.equal(report.observedChainIdHex,'0x33');
  assert.equal(report.endpoints.length,2);
  assert.equal(mock.calls.length,16);
  assert.equal(mock.calls.filter(x=>x.input.method==='eth_chainId').length,4);
  assert.equal(report.readOnly,true);
  assert.equal(report.transactionSubmitted,false);
  assert.equal(report.transactionSigned,false);
  assert.equal(report.recoveryProven,false);
  assert.equal(report.readyForLiveProofPromotion,false);
  assert.equal(report.authenticatedConsensusCertificate,false);
  assert.equal(report.providerInfrastructureIndependenceProven,false);
  assert.match(report.observationSha256,/^[a-f0-9]{64}$/);
});

test('dual-RPC output can supply matching inputs to offline XDC finality evidence builder',async()=>{
  const {report}=await observe();
  const binding={sha256:'a'.repeat(64),contextSha256:'b'.repeat(64),
    deploymentVerificationSha256:'c'.repeat(64)};
  const proof={success:true,networkRef:'xdc:apothem',chainId:'xdc',transactionRef:TX,
    bindingSha256:binding.sha256,binding};
  const evidence=createEvmBlockFinalityEvidence({
    networkId:'xdc:apothem',proof,observedChainIdHex:report.observedChainIdHex,
    receipt:report.receipt,receiptBlock:report.receiptBlock,
    finalizedBlock:report.finalizedBlock,observedAt:report.observedAt
  });
  assert.equal(evidence.method,'finalized-tag');
  assert.equal(evidence.receipt.canonicalBlockHash,RECEIPT_BLOCK);
  assert.equal(report.readyForLiveProofPromotion,false);
});

test('rejects invalid hash and missing transport before any RPC',async()=>{
  const mock=provider();
  for(const tx of ['0x1234',null,'0x'+'zz'.repeat(32)])
    await assert.rejects(observeApothemFinalityProvenance({
      transactionHash:tx,fetchImpl:mock.fetchImpl,nowSeconds:NOW}),/32-byte hex hash/);
  await assert.rejects(observeApothemFinalityProvenance({
    transactionHash:TX,fetchImpl:null,nowSeconds:NOW}),/fetch transport/);
  await assert.rejects(observeApothemFinalityProvenance({
    transactionHash:TX,fetchImpl:mock.fetchImpl,nowSeconds:NaN}),/nowSeconds/);
  assert.equal(mock.calls.length,0);
});

test('fails closed if either RPC provides a different chain ID, including late switch',async()=>{
  await rejects({chainSecond:'0x32'},/chain mismatch/);
  await rejects({chainLate:'0x32'},/chain mismatch/);
});

test('fails closed on overly divergent or noncanonical latest provider heights',async()=>{
  await rejects({headSecond:'0x1'},/head divergence|latest-head divergence/);
  await rejects({headFirst:'0x00'},/canonical hex quantity/);
});

test('fails closed on missing, failed, wrong-hash or differently included receipt',async()=>{
  await rejects({nullReceipt:true},/32-byte hex hash/);
  await rejects({statusSecond:'0x0'},/successful inclusion/);
  await rejects({wrongReceiptTx:true},/successful inclusion/);
  await rejects({receiptHashSecond:OTHER},/receipt inclusion mismatch/);
  await rejects({receiptHeightSecond:'0x2b'},/receipt inclusion mismatch/);
});

test('rejects RPC transport, HTTP, JSON, ID and error-envelope failures',async()=>{
  await rejects({transportFailure:true},/transport unavailable/);
  await rejects({httpFailure:true},/HTTP failure/);
  await rejects({invalidJson:true},/invalid JSON/);
  await rejects({wrongRpcId:true},/response identity/);
  await rejects({rpcError:true},/response identity/);
});

test('rejects mismatched canonical inclusion height, hash or timestamp',async()=>{
  await rejects({inclusionHashSecond:OTHER},/not on common canonical block/);
  await rejects({inclusionHeightSecond:'0x2b'},/not on common canonical block/);
  await rejects({inclusionTimestampSecond:'0x6553f101'},/timestamps disagree/);
});

test('rejects disagreement on finalized tag height, hash and timestamp',async()=>{
  await rejects({finalHeightSecond:'0x2a'},/finalized-head disagreement/);
  await rejects({finalHashSecond:OTHER},/finalized-head disagreement/);
  await rejects({finalTimestampSecond:'0x6553f101'},/finalized-head disagreement/);
});

test('rejects finalized tag below receipt or ahead of provider latest',async()=>{
  await rejects({finalHeightFirst:'0x29',finalHeightSecond:'0x29'},/newer than finalized head/);
  await rejects({headSecond:'0x2a'},/latest head is older than finalized head/);
});

test('rejects finalized block timestamp too old or in the future',async()=>{
  await assert.rejects(observeApothemFinalityProvenance({
    transactionHash:TX,fetchImpl:provider().fetchImpl,nowSeconds:NOW+901
  }),/older than 15 minutes/);
  await assert.rejects(observeApothemFinalityProvenance({
    transactionHash:TX,fetchImpl:provider().fetchImpl,nowSeconds:NOW-221
  }),/future/);
});

test('rejects inclusion reorg and finalized fixed-height substitution mid-audit',async()=>{
  await rejects({inclusionReorg:true},/receipt block changed/);
  await rejects({finalReorg:true},/finalized block changed/);
});
