import test from 'node:test';
import assert from 'node:assert/strict';
import {evmProbePreflight,XDC_AUTHENTICATED_FINALITY_GATE}
 from '../src/chains/evm/compatibility-plan.js';
const checks={ 'rpc-read':true,'wallet-network-switch':true,
 'deployment-receipt':true,'runtime-code-match':true,'policy-config-match':true,
 'native-recovery':true,'erc20-recovery':true,'finality-evidence':true };
test('EVM caller checks cannot replace observed chain identity',()=>{
 const result=evmProbePreflight({networkId:'base:sepolia',
 observedChainIdHex:'0xaa36a7',checks:{...checks,'chain-id-match':true}});
 assert.equal(result.status,'blocked');
 assert.equal(result.checks['chain-id-match'],false);
});
test('EVM network identity does not coerce hex-number masqueraders',()=>{
 for(const observedChainIdHex of [84532,[],{toLowerCase(){return '0x14a34'}},'0x014a34',' 0x14a34 ']){
  const result=evmProbePreflight({networkId:'base:sepolia',observedChainIdHex,
   checks:{...checks,'chain-id-match':true}});
  assert.equal(result.status,'blocked');
  assert.equal(result.checks['chain-id-match'],false);
 }
});
test('EVM preflight refuses control matrix with unknown outcome types',()=>{
 for(const value of ['true',1,null,{},[]])
  assert.throws(()=>evmProbePreflight({networkId:'base:sepolia',observedChainIdHex:'0x14a34',
    checks:{...checks,'rpc-read':value}}),/must be boolean/);
});
test('XDC authenticated finality remains forced false despite caller claims',()=>{
 const result=evmProbePreflight({networkId:'xdc:apothem',observedChainIdHex:'0x33',
   checks:{...checks,[XDC_AUTHENTICATED_FINALITY_GATE]:true}});
 assert.equal(result.checks[XDC_AUTHENTICATED_FINALITY_GATE],false);
 assert.notEqual(result.status,'ready');
});
