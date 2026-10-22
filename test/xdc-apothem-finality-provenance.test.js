import test from 'node:test';
import assert from 'node:assert/strict';
import { APOTHEM_ENDPOINTS } from '../scripts/xdc-apothem-independent-rpc-check.js';
import { observeApothemFinalityProvenance, observeAndBindApothemFinality } from '../scripts/xdc-apothem-finality-provenance.js';
import { xdcProvenancePackageMatchesProof } from '../src/chains/evm/xdc-finality-provenance-binding.js';
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
    assert.equal(request.redirect, 'error');
    assert.equal(request.credentials, 'omit');
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
          timestamp: idx===1 ? (options.inclusionTimestampSecond ?? TIME) : (options.inclusionTimestampFirst ?? TIME) };
        if (blockCounts.get(k) === 2 && idx===0 && options.inclusionReorg) result.hash=OTHER;
      } else if (tag === 'finalized') {
        result = { number: idx===1 ? (options.finalHeightSecond ?? '0x2b') : (options.finalHeightFirst ?? '0x2b'),
          hash: idx===1 ? (options.finalHashSecond ?? FINAL_BLOCK) : (options.finalHashFirst ?? FINAL_BLOCK),
          timestamp: idx===1 ? (options.finalTimestampSecond ?? TIME) : (options.finalTimestampFirst ?? TIME) };
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
  assert.equal(mock.calls.length,18);
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

test('rejects stale, future-dated, and nonmonotonic receipt block timestamps',async()=>{
  await rejects({inclusionTimestampFirst:'0x1',inclusionTimestampSecond:'0x1'},/receipt inclusion block older than 15 minutes/);
  await rejects({inclusionTimestampFirst:'0x6553f200',inclusionTimestampSecond:'0x6553f200'},/receipt inclusion block more than 2 minutes in the future/);
  await rejects({inclusionTimestampFirst:'0x6553f101',inclusionTimestampSecond:'0x6553f101'},/receipt block timestamp follows finalized block/);
});

test('rejects inclusion reorg and finalized fixed-height substitution mid-audit',async()=>{
  await rejects({inclusionReorg:true},/receipt block changed/);
  await rejects({finalReorg:true},/finalized block changed/);
});

test('read-only dual-RPC probe constructs a digest-bound XDC finality package end-to-end',async()=>{
  const driver=provider();
  const binding={kind:'native-recovery',sha256:'a'.repeat(64),contextSha256:'b'.repeat(64),
    deploymentVerificationSha256:'c'.repeat(64)};
  const proof={success:true,networkRef:'xdc:apothem',chainId:'xdc',
    transactionRef:TX,bindingSha256:binding.sha256,binding};
  const {observation,evidencePackage}=await observeAndBindApothemFinality({
    transactionHash:TX,proof,kind:'native-recovery',
    fetchImpl:driver.fetchImpl,nowSeconds:NOW
  });
  assert.equal(observation.observationSha256,evidencePackage.observationSha256);
  assert.equal(evidencePackage.finalityEvidence.transactionRef,TX);
  assert.equal(evidencePackage.rpcAuthenticated,false);
  assert.equal(evidencePackage.recoveryProven,false);
  assert.equal(evidencePackage.readyForLiveProofPromotion,false);
  assert.equal(xdcProvenancePackageMatchesProof(
    evidencePackage,observation,proof,'native-recovery'),true);
  assert.equal(driver.calls.length,18);
  assert.ok(driver.calls.every(call=>[
    'eth_chainId','eth_blockNumber','eth_getTransactionReceipt','eth_getBlockByNumber'
  ].includes(call.input.method)));
});

test('XDC end-to-end read-only binding rejects wrong recovery intent before contacting RPC',async()=>{
  const driver=provider();
  const binding={kind:'native-recovery',sha256:'a'.repeat(64),contextSha256:'b'.repeat(64),
    deploymentVerificationSha256:'c'.repeat(64)};
  const proof={success:true,networkRef:'xdc:apothem',chainId:'xdc',
    transactionRef:TX,bindingSha256:binding.sha256,binding};
  await assert.rejects(observeAndBindApothemFinality({
    transactionHash:OTHER,proof,kind:'native-recovery',fetchImpl:driver.fetchImpl,nowSeconds:NOW
  }),/transaction\/kind must match/);
  await assert.rejects(observeAndBindApothemFinality({
    transactionHash:TX,proof,kind:'erc20-recovery',fetchImpl:driver.fetchImpl,nowSeconds:NOW
  }),/transaction\/kind must match/);
  assert.equal(driver.calls.length,0);
});

test('Apothem finality observation rejects redirected response identity without trusting JSON',async()=>{
  const driver=provider();
  const redirecting=async(url,request)=>({
    ...(await driver.fetchImpl(url,request)),
    url:'https://unapproved.example/jsonrpc'
  });
  await assert.rejects(observeApothemFinalityProvenance({
    transactionHash:TX,fetchImpl:redirecting,nowSeconds:NOW
  }),/redirected outside pinned endpoint/);
});


test('read-only XDC RPC probe rejects all-zero transaction and block hashes before reporting evidence',async()=>{
  const zero='0x'+'00'.repeat(32);
  const driver=provider();
  await assert.rejects(observeApothemFinalityProvenance({
    transactionHash:zero,fetchImpl:driver.fetchImpl,nowSeconds:NOW
  }),/all-zero hash/);
  assert.equal(driver.calls.length,0);
  await rejects({receiptHashSecond:zero},/all-zero hash/);
  await rejects({inclusionHashSecond:zero},/all-zero hash/);
  await rejects({finalHashSecond:zero},/all-zero hash/);
});


test('XDC read-only observer rejects finalized block hash reuse across different heights before emitting evidence',async()=>{
  await rejects({finalHashFirst:RECEIPT_BLOCK,finalHashSecond:RECEIPT_BLOCK},/reuses receipt block hash at a different height/);
});

test('XDC read-only observer enforces same-height finalized block identity and timestamp',async()=>{
  const sameHeight={finalHeightFirst:'0x2a',finalHeightSecond:'0x2a',
    finalHashFirst:RECEIPT_BLOCK,finalHashSecond:RECEIPT_BLOCK};
  await rejects({...sameHeight,finalTimestampFirst:'0x6553f101',finalTimestampSecond:'0x6553f101'},/same-height finalized and inclusion block timestamps disagree/);
  await rejects({finalHeightFirst:'0x2a',finalHeightSecond:'0x2a'},/finalized head contradicts receipt block/);
  const {report}=await observe(sameHeight);
  assert.equal(report.finalizedBlock.number,report.receiptBlock.number);
  assert.equal(report.finalizedBlock.hash,report.receiptBlock.hash);
  assert.equal(report.finalizedBlock.timestamp,report.receiptBlock.timestamp);
  assert.equal(report.rpcAuthenticated,undefined);
  assert.equal(report.readyForLiveProofPromotion,false);
});

function timeoutBindingProof() {
  const binding = {kind:'native-recovery',sha256:'a'.repeat(64),contextSha256:'b'.repeat(64),
    deploymentVerificationSha256:'c'.repeat(64)};
  return {success:true,networkRef:'xdc:apothem',chainId:'xdc',transactionRef:TX,
    bindingSha256:binding.sha256,binding};
}

test('XDC finality entry points validate deadlines before contacting providers',async()=>{
  for (const entry of [observeApothemFinalityProvenance, observeAndBindApothemFinality]) {
    for (const requestTimeoutMs of [null,0,-1,1.5,NaN,Infinity,true,'10',[],2147483648]) {
      const mock = provider();
      await assert.rejects(entry({
        transactionHash:TX,proof:timeoutBindingProof(),kind:'native-recovery',
        fetchImpl:mock.fetchImpl,nowSeconds:NOW,requestTimeoutMs
      }),/requestTimeoutMs/);
      assert.equal(mock.calls.length,0);
    }
  }
});

for (const phase of ['fetch','body']) {
  test(`XDC finality bounds stalled receipt ${phase} without cooperative abort`,{timeout:2000},async()=>{
    const mock = provider();
    let signal;
    await assert.rejects(observeApothemFinalityProvenance({
      transactionHash:TX,nowSeconds:NOW,requestTimeoutMs:10,
      fetchImpl:async(url,options)=>{
        const result = await mock.fetchImpl(url,options);
        if (url===APOTHEM_ENDPOINTS[1] && JSON.parse(options.body).method==='eth_getTransactionReceipt') {
          signal = options.signal;
          if (phase==='fetch') return new Promise(()=>{});
          return {ok:true,json:()=>new Promise(()=>{})};
        }
        return result;
      }
    }),{code:'APOTHEM_RPC_TIMEOUT'});
    assert.equal(signal.aborted,true);
    assert.equal(mock.calls.length,6);
    assert.ok(mock.calls.every(call=>call.input.method!=='eth_getBlockByNumber'));
  });
}

test('XDC finality refuses evidence when final identity response body stalls',{timeout:2000},async()=>{
  const mock = provider();
  let identityReads = 0;
  let signal;
  await assert.rejects(observeApothemFinalityProvenance({
    transactionHash:TX,nowSeconds:NOW,requestTimeoutMs:10,
    fetchImpl:async(url,options)=>{
      const result = await mock.fetchImpl(url,options);
      if (url===APOTHEM_ENDPOINTS[1] && JSON.parse(options.body).method==='eth_chainId' && ++identityReads===2) {
        signal = options.signal;
        return {ok:true,json:()=>new Promise(()=>{})};
      }
      return result;
    }
  }),{code:'APOTHEM_RPC_TIMEOUT'});
  assert.equal(signal.aborted,true);
  assert.equal(mock.calls.length,18);
});

test('XDC finality binding forwards deadline and never packages a timed-out observation',{timeout:2000},async()=>{
  const mock = provider();
  let signal;
  await assert.rejects(observeAndBindApothemFinality({
    transactionHash:TX,proof:timeoutBindingProof(),kind:'native-recovery',
    nowSeconds:NOW,requestTimeoutMs:10,
    fetchImpl:async(url,options)=>{
      const result = await mock.fetchImpl(url,options);
      if (url===APOTHEM_ENDPOINTS[0]) {
        signal = options.signal;
        return {ok:true,json:()=>new Promise(()=>{})};
      }
      return result;
    }
  }),{code:'APOTHEM_RPC_TIMEOUT'});
  assert.equal(signal.aborted,true);
  assert.equal(mock.calls.length,2);
});

for (const fails of [false,true]) {
  test(`XDC finality clears default deadlines after ${fails?'failure':'successful binding'}`,async t=>{
    t.mock.timers.enable({apis:['setTimeout']});
    const mock = provider();
    const signals = [];
    const result = observeAndBindApothemFinality({
      transactionHash:TX,proof:timeoutBindingProof(),kind:'native-recovery',nowSeconds:NOW,
      fetchImpl:async(url,options)=>{
        signals.push(options.signal);
        if (fails) return {ok:true,json:async()=>{throw Error('Malformed JSON fixture');}};
        return mock.fetchImpl(url,options);
      }
    });
    if (fails) await assert.rejects(result,/invalid JSON/);
    else {
      const {observation,evidencePackage} = await result;
      assert.equal(observation.chainIdRechecked,true);
      assert.equal(evidencePackage.readyForLiveProofPromotion,false);
    }
    t.mock.timers.tick(15001);
    assert.equal(signals.length,fails?2:18);
    assert.ok(signals.every(signal=>!signal.aborted));
  });
}

const FINALITY_QUANTITY_STAGES = [
  ['initial chain ID',1,null], ['latest head',2,null], ['receipt height',3,'blockNumber'],
  ['inclusion height',4,'number'], ['inclusion timestamp',4,'timestamp'],
  ['finalized height',5,'number'], ['finalized timestamp',5,'timestamp'],
  ['inclusion recheck height',6,'number'], ['inclusion recheck timestamp',6,'timestamp'],
  ['finalized recheck height',7,'number'], ['finalized recheck timestamp',7,'timestamp'],
  ['receipt recheck height',8,'blockNumber'], ['final chain ID',9,null]
];

for (const [label, ordinal, field] of FINALITY_QUANTITY_STAGES) {
  for (const endpoint of APOTHEM_ENDPOINTS) {
    test(`XDC observer rejects uint256 overflow in ${label} from ${endpoint}`,async()=>{
      for (const overflow of ['0x1'+'0'.repeat(64), '0x'+'f'.repeat(4096)]) {
        const mock = provider();
        let reads = 0;
        await assert.rejects(observeApothemFinalityProvenance({
          transactionHash:TX,nowSeconds:NOW,
          fetchImpl:async(url,options)=>{
            const response = await mock.fetchImpl(url,options);
            if (url!==endpoint || ++reads!==ordinal) return response;
            const body = await response.json();
            if (field===null) body.result=overflow;
            else body.result[field]=overflow;
            return {ok:true,json:async()=>body};
          }
        }),/exceeds uint256/);
        assert.equal(reads,ordinal, 'must reject at the malformed observation');
        assert.equal(mock.calls.length,ordinal*2, 'must not request later evidence');
      }
    });
  }
}

test('XDC observer and binding preserve maximum uint256 provider heads exactly',async()=>{
  const maximum='0x'+'f'.repeat(64);
  const mock=provider({headFirst:maximum,headSecond:maximum});
  const proof=timeoutBindingProof();
  const {observation,evidencePackage}=await observeAndBindApothemFinality({
    transactionHash:TX,proof,kind:'native-recovery',fetchImpl:mock.fetchImpl,nowSeconds:NOW
  });
  assert.deepEqual(observation.latestHeadHeights,[
    ((1n<<256n)-1n).toString(), ((1n<<256n)-1n).toString()
  ]);
  assert.equal(xdcProvenancePackageMatchesProof(evidencePackage,observation,proof,'native-recovery'),true);
  assert.equal(evidencePackage.readyForLiveProofPromotion,false);
});

test('XDC finality rejects unrepresentable observation clocks before any provider calls',async()=>{
  for (const entry of [observeApothemFinalityProvenance,observeAndBindApothemFinality]) {
    for (const nowSeconds of [8640000000001,Number.MAX_SAFE_INTEGER]) {
      const mock=provider();
      await assert.rejects(entry({
        transactionHash:TX,proof:timeoutBindingProof(),kind:'native-recovery',
        fetchImpl:mock.fetchImpl,nowSeconds
      }),/nowSeconds.*representable/);
      assert.equal(mock.calls.length,0);
    }
  }
});

test('XDC finality accepts exact supported observation-clock boundaries through binding',async()=>{
  for (const nowSeconds of [1,8640000000000]) {
    const timestamp='0x'+BigInt(nowSeconds).toString(16);
    const mock=provider();
    const proof=timeoutBindingProof();
    const {observation,evidencePackage}=await observeAndBindApothemFinality({
      transactionHash:TX,proof,kind:'native-recovery',nowSeconds,
      fetchImpl:async(url,options)=>{
        const response=await mock.fetchImpl(url,options);
        const body=await response.json();
        if (JSON.parse(options.body).method==='eth_getBlockByNumber') body.result.timestamp=timestamp;
        return {ok:true,json:async()=>body};
      }
    });
    assert.equal(observation.observedAt,new Date(nowSeconds*1000).toISOString());
    assert.equal(xdcProvenancePackageMatchesProof(evidencePackage,observation,proof,'native-recovery'),true);
  }
});

for (const endpoint of APOTHEM_ENDPOINTS) {
  for (const entry of [observeApothemFinalityProvenance,observeAndBindApothemFinality]) {
    test(`XDC ${entry.name} rejects redirect flags from ${endpoint} before body parsing`,async()=>{
      for (const ordinal of [1,9]) {
        for (const responseUrl of [undefined,endpoint]) {
          const mock=provider();
          let reads=0;
          let redirectedBodyReads=0;
          await assert.rejects(entry({
            transactionHash:TX,proof:timeoutBindingProof(),kind:'native-recovery',nowSeconds:NOW,
            fetchImpl:async(url,options)=>{
              const response=await mock.fetchImpl(url,options);
              if (url!==endpoint || ++reads!==ordinal) return response;
              return {ok:true,redirected:true,...(responseUrl===undefined?{}:{url:responseUrl}),
                json:async()=>{redirectedBodyReads++;return response.json();}};
            }
          }),/redirected outside pinned endpoint/);
          assert.equal(redirectedBodyReads,0);
          assert.equal(mock.calls.length,ordinal*2);
        }
      }
    });
  }
}

const RECEIPT_DRIFT_CASES = [
  ['disappeared',()=>null,/32-byte hex hash/],
  ['failed',r=>({...r,status:'0x0'}),/successful inclusion/],
  ['different transaction',r=>({...r,transactionHash:OTHER}),/successful inclusion/],
  ['moved height',r=>({...r,blockNumber:'0x2b'}),/receipt changed during observation/],
  ['changed block hash',r=>({...r,blockHash:OTHER}),/receipt changed during observation/],
  ['zero block hash',r=>({...r,blockHash:'0x'+'00'.repeat(32)}),/all-zero hash/]
];
for (const endpoint of APOTHEM_ENDPOINTS) {
  for (const [label,mutate,expected] of RECEIPT_DRIFT_CASES) {
    test(`XDC receipt recheck rejects ${label} from ${endpoint}`,async()=>{
      for (const entry of [observeApothemFinalityProvenance,observeAndBindApothemFinality]) {
        const mock=provider();
        let receiptReads=0;
        await assert.rejects(entry({
          transactionHash:TX,proof:timeoutBindingProof(),kind:'native-recovery',nowSeconds:NOW,
          fetchImpl:async(url,options)=>{
            const response=await mock.fetchImpl(url,options);
            if (url!==endpoint || JSON.parse(options.body).method!=='eth_getTransactionReceipt' ||
                ++receiptReads!==2) return response;
            const body=await response.json();
            body.result=mutate(body.result);
            return {ok:true,json:async()=>body};
          }
        }),expected);
        assert.equal(receiptReads,2);
        assert.equal(mock.calls.length,16);
        assert.equal(mock.calls.filter(c=>c.input.method==='eth_chainId').length,2);
      }
    });
  }

  test(`XDC receipt recheck rejects unavailable or malformed responses from ${endpoint}`,async()=>{
    for (const fault of ['transport','http','json','identity','redirect']) {
      const mock=provider();
      let receiptReads=0;
      await assert.rejects(observeAndBindApothemFinality({
        transactionHash:TX,proof:timeoutBindingProof(),kind:'native-recovery',nowSeconds:NOW,
        fetchImpl:async(url,options)=>{
          const response=await mock.fetchImpl(url,options);
          if (url!==endpoint || JSON.parse(options.body).method!=='eth_getTransactionReceipt' ||
              ++receiptReads!==2) return response;
          if (fault==='transport') throw Error('receipt recheck unavailable');
          if (fault==='http') return {ok:false,status:503};
          if (fault==='json') return {ok:true,json:async()=>{throw Error('bad JSON');}};
          if (fault==='redirect') return {...response,redirected:true};
          const body=await response.json();
          body.id++;
          return {ok:true,json:async()=>body};
        }
      }),/transport unavailable|HTTP failure|invalid JSON|response identity|redirected/);
      assert.equal(receiptReads,2);
      assert.equal(mock.calls.length,16);
    }
  });

  test(`XDC receipt recheck deadline prevents evidence packaging for ${endpoint}`,{timeout:2000},async()=>{
    const mock=provider();
    let receiptReads=0;
    let signal;
    await assert.rejects(observeAndBindApothemFinality({
      transactionHash:TX,proof:timeoutBindingProof(),kind:'native-recovery',nowSeconds:NOW,
      requestTimeoutMs:10,
      fetchImpl:async(url,options)=>{
        const response=await mock.fetchImpl(url,options);
        if (url!==endpoint || JSON.parse(options.body).method!=='eth_getTransactionReceipt' ||
            ++receiptReads!==2) return response;
        signal=options.signal;
        return {ok:true,json:()=>new Promise(()=>{})};
      }
    }),{code:'APOTHEM_RPC_TIMEOUT'});
    assert.equal(signal.aborted,true);
    assert.equal(mock.calls.length,16);
  });
}

test('XDC receipt rechecks follow fixed-height checks and precede final identity checks',async()=>{
  const mock=provider();
  const proof=timeoutBindingProof();
  const {observation,evidencePackage}=await observeAndBindApothemFinality({
    transactionHash:TX,proof,kind:'native-recovery',nowSeconds:NOW,
    fetchImpl:mock.fetchImpl
  });
  for (const idx of [0,1]) {
    const calls=mock.calls.filter(c=>c.idx===idx);
    assert.deepEqual(calls.map(c=>c.input.method),[
      'eth_chainId','eth_blockNumber','eth_getTransactionReceipt',
      'eth_getBlockByNumber','eth_getBlockByNumber','eth_getBlockByNumber',
      'eth_getBlockByNumber','eth_getTransactionReceipt','eth_chainId'
    ]);
    assert.deepEqual(calls[7].input.params,[TX]);
    assert.deepEqual(calls[6].input.params,['0x2b',false]);
  }
  assert.equal(xdcProvenancePackageMatchesProof(evidencePackage,observation,proof,'native-recovery'),true);
  assert.equal(evidencePackage.readyForLiveProofPromotion,false);
});
