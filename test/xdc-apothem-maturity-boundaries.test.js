import test from 'node:test';
import assert from 'node:assert/strict';
import {createApothemReadOnlyDeploymentBudget} from '../src/chains/evm/apothem-deployment-budget.js';
const args={
 compiledCreationBytecode:'6001600055',codeSizeBytes:32,
 compilerVersion:'0.8.24+commit.e11b9ed9.Emscripten.clang',
 providerGasPriceHex:['0x9184e72a00','0x9184e72a00'],estimatedGasHex:'0xf4240'
};

test('offline budget never asserts compilation was verified without compiler execution',()=>{
 const result=createApothemReadOnlyDeploymentBudget(args);
 assert.equal(result.compileVerified,false);
 assert.equal(result.compilerVersionChecked,true);
 assert.equal(result.deploymentEligible,false);
});
test('compiler identity must match exact pinned release commit',()=>{
 for(const compilerVersion of ['0.8.24','0.8.24+spoof','0.8.24+commit.deadbeef',
   '0.8.25+commit.e11b9ed9'])
  assert.throws(()=>createApothemReadOnlyDeploymentBudget({...args,compilerVersion}),/pinned solc/);
});
test('gas observation quantities remain inside EVM uint256',()=>{
 const tooBig='0x1'+'0'.repeat(64);
 assert.throws(()=>createApothemReadOnlyDeploymentBudget({...args,
   providerGasPriceHex:[tooBig,'0x1']}),/uint256/);
 assert.throws(()=>createApothemReadOnlyDeploymentBudget({...args,
   estimatedGasHex:tooBig}),/uint256/);
});
