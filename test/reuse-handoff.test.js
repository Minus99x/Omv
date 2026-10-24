import test from 'node:test';
import assert from 'node:assert/strict';
import { REUSE_JOB_ORDER, hashReuseArtifact, verifyOfflineReuseChain, appendOfflineReuseHandoff } from '../src/chains/reuse-handoff.js';

const hex = c => c.repeat(64);
const git = c => c.repeat(40);
const objective = 'OVR-002';
const baseSha = git('a');
const patch = hex('b');
const run = (command, c) => ({command,exitCode:0,executed:true,outputSha256:hex(c)});
const artifacts = [
  {component:'src/chains/bitcoin/psbt-v2.js',gapConfirmed:true,missingBehavior:'reject noncanonical BIP370 map order',coverageReference:'test/bitcoin-descriptor-psbt-v2.test.js'},
  {url:'https://github.com/LedgerHQ/ts-libs',revision:git('c'),license:'Apache-2.0',licenseReviewed:true,securityReviewed:true,compatible:true,strategy:'dependency'},
  {patchSha256:patch,changedPaths:['src/chains/bitcoin/psbt-v2.js','test/bitcoin-psbt-singleton-keys.test.js']},
  {run:run('node --test test/bitcoin-psbt-singleton-keys.test.js','d'),positiveCases:2,adversarialCases:3,patchSha256:patch},
  {test:run('npm test','e'),check:run('npm run check','f'),patchSha256:patch},
  null,
  {networkRef:'bitcoin:signet',provenance:'public-network-read-only',publicEvidenceSha256:hex('3'),sources:['core node hash abc'],observedAt:'2026-10-24T08:00:00Z',transactionSubmissionAuthorized:false,supportPromotionAuthorized:false}
];
function validChain(count=7) {
  let chain=[];
  for(let i=0;i<count;i++) {
    const artifact=i===5?{commitSha:git('2'),branch:'dev/0.6.60-reconcile-overnight-bitcoin',patchSha256:patch,verificationReceiptSha256:chain.at(-1).sha256}:artifacts[i];
    chain=appendOfflineReuseHandoff(chain,{job:REUSE_JOB_ORDER[i],objective,baseSha,artifact});
  }
  return chain;
}
function corrupt(chain,index,change){const c=structuredClone(chain);change(c[index]);return c;}

test('seven concrete linked jobs pass and stop before human signing/submission',()=>{
  const chain=validChain();const result=verifyOfflineReuseChain(chain);
  assert.equal(result.valid,true,result.error);
  assert.equal(result.requiresHumanAuthority,true);
  assert.equal(result.nextJob,null);
  assert.match(result.caveat,/not execution authenticity/);
  assert.equal(new Set(chain.map(x=>x.sha256)).size,7);
});
test('every step is deterministic under reordered artifact object keys',()=>{
  const obj={b:2,a:[{z:true,y:'ok'}],nested:{v:1,u:4}};
  assert.equal(hashReuseArtifact(obj),hashReuseArtifact({nested:{u:4,v:1},a:[{y:'ok',z:true}],b:2}));
});
test('missing root, skipped steps, repeats and unknown human-gated J07 all fail',()=>{
  const chain=validChain();
  for(const specimen of [chain.slice(1),[chain[0],chain[2]], [...chain, {...chain.at(-1),job:'J07-sign'}]]) assert.equal(verifyOfflineReuseChain(specimen).valid,false);
  assert.throws(()=>appendOfflineReuseHandoff(validChain(2),{job:REUSE_JOB_ORDER[1],objective,baseSha,artifact:artifacts[1]}),/cannot skip or repeat/i);
});
test('changing old artifact or its self digest fails even if a later receipt is intact',()=>{
  let chain=validChain();
  assert.equal(verifyOfflineReuseChain(corrupt(chain,2,r=>{r.artifact.changedPaths.push('test/extra.js')})).valid,false);
  assert.equal(verifyOfflineReuseChain(corrupt(chain,2,r=>{r.sha256=hex('9')})).valid,false);
});
test('wrong objective, source baseline or predecessor digest fails closed',()=>{
  const chain=validChain();
  for(const key of ['objective','baseSha','previousSha256']) {
    const changed=corrupt(chain,3,r=>{r[key]=key==='objective'?'OVR-003':hex('1')});
    assert.equal(verifyOfflineReuseChain(changed).valid,false,key);
  }
});
test('already covered tasks stop at inventory instead of manufacturing edits',()=>{
  const root=appendOfflineReuseHandoff([],{job:REUSE_JOB_ORDER[0],objective,baseSha,artifact:{...artifacts[0],gapConfirmed:false,missingBehavior:null}});
  assert.equal(verifyOfflineReuseChain(root).valid,true);
  assert.throws(()=>appendOfflineReuseHandoff(root,{job:REUSE_JOB_ORDER[1],objective,baseSha,artifact:artifacts[1]}),/already-covered/i);
});
test('upstream qualification rejects unevaluated licenses or compatibility',()=>{
  const chain=validChain(1);
  for(const field of ['licenseReviewed','securityReviewed','compatible']) {
    assert.throws(()=>appendOfflineReuseHandoff(chain,{job:REUSE_JOB_ORDER[1],objective,baseSha,artifact:{...artifacts[1],[field]:false}}),/review/i);
  }
  assert.throws(()=>appendOfflineReuseHandoff(chain,{job:REUSE_JOB_ORDER[1],objective,baseSha,artifact:{...artifacts[1],revision:'main'}}),/Git SHA/);
});
test('candidate rejects docs, workflow modifications, traversal, and duplicate paths',()=>{
  const chain=validChain(2);
  for(const changedPaths of [['docs/queue.md'],['.github/workflows/main.yml'],['test/../secrets'],['src/chains/x.js','src/chains/x.js']]) {
    assert.throws(()=>appendOfflineReuseHandoff(chain,{job:REUSE_JOB_ORDER[2],objective,baseSha,artifact:{...artifacts[2],changedPaths}}),/permitted source/i);
  }
});
test('focused test must run positive and adversarial cases bound to exact patch',()=>{
  const chain=validChain(3);
  for(const artifact of [{...artifacts[3],patchSha256:hex('1')},{...artifacts[3],positiveCases:0},{...artifacts[3],adversarialCases:0},{...artifacts[3],run:{...artifacts[3].run,executed:false}}]) {
    assert.throws(()=>appendOfflineReuseHandoff(chain,{job:REUSE_JOB_ORDER[3],objective,baseSha,artifact}),/patch|coverage|executed/i);
  }
});
test('full test and check need correct commands and successful execution',()=>{
  const chain=validChain(4);
  for(const artifact of [
    {...artifacts[4],check:{...artifacts[4].check,command:'echo success'}},
    {...artifacts[4],test:{...artifacts[4].test,exitCode:1}},
    {...artifacts[4],check:{...artifacts[4].check,executed:false}},
    {...artifacts[4],patchSha256:hex('1')}
  ]) assert.throws(()=>appendOfflineReuseHandoff(chain,{job:REUSE_JOB_ORDER[4],objective,baseSha,artifact}),/must execute|executed|patch/i);
});
test('integration binds verification receipt, patch SHA and authorized dev branch',()=>{
  const chain=validChain(5), good={commitSha:git('2'),branch:'dev/0.6.60-reconcile-overnight-bitcoin',patchSha256:patch,verificationReceiptSha256:chain.at(-1).sha256};
  for(const artifact of [{...good,branch:'main'},{...good,verificationReceiptSha256:hex('a')},{...good,commitSha:'short'},{...good,patchSha256:hex('b').replace(/^b/,'a')}]) assert.throws(()=>appendOfflineReuseHandoff(chain,{job:REUSE_JOB_ORDER[5],objective,baseSha,artifact}),/branch|verification|Git SHA|patch/i);
});
test('read-only network evidence forbids submission, promotion and mainnet',()=>{
  const chain=validChain(6);
  for(const artifact of [
    {...artifacts[6],transactionSubmissionAuthorized:true},
    {...artifacts[6],supportPromotionAuthorized:true},
    {...artifacts[6],networkRef:'ethereum:mainnet'},
    {...artifacts[6],provenance:'offline-fixture'},
    {...artifacts[6],observedAt:'2026-02-31T08:00:00Z'},
  ]) assert.throws(()=>appendOfflineReuseHandoff(chain,{job:REUSE_JOB_ORDER[6],objective,baseSha,artifact}),/authority|live-value|provenance|timestamp/i);
});
test('unsupported values, cycles, accessors and prototype pollution fail canonical hashing',()=>{
  assert.throws(()=>hashReuseArtifact({x:()=>1}),/unsupported/);
  assert.throws(()=>hashReuseArtifact({value:1.2}),/unsupported/);
  const cycle={};cycle.me=cycle;
  assert.throws(()=>hashReuseArtifact(cycle),/cyclic/i);
  const obj={};Object.defineProperty(obj,'x',{enumerable:true,get(){throw Error('getter executed')}});
  assert.throws(()=>hashReuseArtifact(obj),/accessor/i);
  assert.throws(()=>hashReuseArtifact(JSON.parse('{"__proto__": {"polluted":true}}')),/unsafe/i);
});
test('offline handoff receipt cannot authenticate a forged executed claim by itself',()=>{
  const result=verifyOfflineReuseChain(validChain(5));
  assert.equal(result.valid,true);
  assert.match(result.caveat,/not execution authenticity/);
  assert.equal(result.requiresHumanAuthority,false);
});
test('untrusted chain validation refuses nested accessors and sparse arrays',()=>{
  const chain=structuredClone(validChain());
  Object.defineProperty(chain[2].artifact,'changedPaths',{enumerable:true,get(){throw Error('must not execute getter')}});
  assert.equal(verifyOfflineReuseChain(chain).valid,false);
  const sparse=structuredClone(validChain());
  sparse[2].artifact.changedPaths=new Array(1);
  assert.equal(verifyOfflineReuseChain(sparse).valid,false);
});
