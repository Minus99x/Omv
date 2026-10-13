import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRecoveryVaultConstructor,createApothemReadOnlyDeploymentBudget,
 XDC_APOTHEM_DISPOSABLE_MAX_FEE_WEI } from '../src/chains/evm/apothem-deployment-budget.js';
const owner='0x'+'11'.repeat(20),contacts=['0x'+'22'.repeat(20),'0x'+'33'.repeat(20)],rescue='0x'+'44'.repeat(20);
const constructor={owner,contacts,rescue,threshold:2,inactivitySeconds:45};
const dummy={compiledCreationBytecode:'6001600055',codeSizeBytes:32,compilerVersion:'0.8.24+commit.e11b9ed9.Emscripten.clang',providerGasPriceHex:['0x9184e72a000','0x9184e72a000']};
test('constructor encoding binds two unique guardians, policy, and immutable rescue using canonical ABI words',()=>{
 const data=encodeRecoveryVaultConstructor(constructor);
 assert.equal(data.length,2+32*2*(5+contacts.length));
 const words=data.slice(2).match(/.{64}/g);
 assert.equal(words[0],128n.toString(16).padStart(64,'0'));
 assert.equal(words[1],2n.toString(16).padStart(64,'0'));
 assert.equal(words[2],45n.toString(16).padStart(64,'0'));
 assert.equal(words[3].slice(-40),rescue.slice(2));
 assert.equal(words[4],2n.toString(16).padStart(64,'0'));
 assert.equal(words[5].slice(-40),contacts[0].slice(2));
 assert.equal(words[6].slice(-40),contacts[1].slice(2));
});
test('owner, guardian, rescue collision or malformed threshold fail closed',()=>{
 for(const override of [{contacts:[owner]},{contacts:[rescue]},{contacts:[contacts[0],contacts[0]]},{threshold:3},{threshold:0},{inactivitySeconds:0},{owner:'xdc'+'11'.repeat(20)}]){
  assert.throws(()=>encodeRecoveryVaultConstructor({...constructor,...override}));
 }
});
test('5-fake-TXDC budget only reports fee-cap feasibility, not deployment authorization',()=>{
 const report=createApothemReadOnlyDeploymentBudget({...dummy,estimatedGasHex:'0xf4240'});
 assert.equal(report.gasEstimate,'1000000');
 assert.equal(report.bufferedGasLimit,'1250000');
 assert.equal(report.maxAllowedFakeTxdcWei,XDC_APOTHEM_DISPOSABLE_MAX_FEE_WEI.toString());
 assert.equal(report.withinFeeCap,true);
 assert.equal(report.deploymentEligible,false);
 assert.equal(report.transactionSigned,false);
 assert.equal(report.transactionBroadcast,false);
});
test('deployment preflight does not authorize deployment when estimate unavailable or gas exceeds cap',()=>{
 const missing=createApothemReadOnlyDeploymentBudget({...dummy});
 assert.equal(missing.withinFeeCap,false);
 assert.equal(missing.gasEstimate,null);
 const excessive=createApothemReadOnlyDeploymentBudget({...dummy,estimatedGasHex:'0x989680'});
 assert.equal(excessive.withinFeeCap,false);
 assert.equal(excessive.deploymentEligible,false);
});
test('malformed quotes, wrong compiler, bytecode, runtime size, or raised budget cap are rejected',()=>{
 const invalid=[
  {...dummy,compilerVersion:'0.8.25+commit.any'},
  {...dummy,compiledCreationBytecode:'0x6000'},
  {...dummy,codeSizeBytes:24577},
  {...dummy,providerGasPriceHex:['0x3b9aca00']},
  {...dummy,providerGasPriceHex:['0x0','0x0']},
  {...dummy,maxBudgetWei:6n*10n**18n}
 ];
 for(const params of invalid) assert.throws(()=>createApothemReadOnlyDeploymentBudget(params));
});
