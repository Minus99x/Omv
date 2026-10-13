import test from 'node:test';
import assert from 'node:assert/strict';
import {readContract,compileSource,inspectXdcApothemDeployment} from '../scripts/xdc-apothem-deployment-preflight.js';
import {inspectV051Candidate} from '../scripts/xdc-apothem-v051-deployment-preflight.js';

test('v0.5.1 safety candidate is a different pinned source; historical V0.5 remains the default',()=>{
 const baseline=readContract();
 const corrected=readContract('V051');
 assert.ok(baseline.includes('contract OmegaVaultRecoveryVaultV050'));
 assert.ok(corrected.includes('contract OmegaVaultRecoveryVaultV051'));
 assert.ok(corrected.includes('function recoverLateNative() external'));
 assert.equal(baseline.includes('function recoverLateNative() external'),false);
 assert.notEqual(baseline,corrected);
});
test('arbitrary variant selection fails closed before any remote calls',async()=>{
 for(const variant of ['V052','mainnet','../../.env',null,{},'']){
   assert.throws(()=>readContract(variant),/fixed testnet recovery source variant/);
   assert.throws(()=>compileSource('invalid',variant),/fixed testnet recovery source variant/);
   let calls=0;
   await assert.rejects(inspectXdcApothemDeployment({variant,fetchImpl:async()=>{calls++;throw Error('network contacted');}}),/fixed testnet recovery source variant/);
   assert.equal(calls,0);
 }
});
test('V0.5.1 preflight requires a transport and cannot report a public deployment',async()=>{
 await assert.rejects(inspectV051Candidate({fetchImpl:null}),/fetch required/);
});
