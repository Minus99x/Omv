import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeRecoveryVaultConstructor,createApothemReadOnlyDeploymentBudget}
 from '../src/chains/evm/apothem-deployment-budget.js';
const owner='0x'+'11'.repeat(20),rescue='0x'+'44'.repeat(20);
const contacts=['0x'+'22'.repeat(20),'0x'+'33'.repeat(20)];
const base={owner,contacts,rescue,threshold:2,inactivitySeconds:45};
const quote={compiledCreationBytecode:'6001600055',codeSizeBytes:32,
 compilerVersion:'0.8.24+commit.e11b9ed9.Emscripten.clang',
 providerGasPriceHex:['0x9184e72a00','0x9184e72a00'],estimatedGasHex:'0xf4240'};

test('owner and rescue can never be the same immutable recovery identity',()=>{
 assert.throws(()=>encodeRecoveryVaultConstructor({...base,rescue:owner}),/Owner and rescue must be distinct/);
 assert.throws(()=>encodeRecoveryVaultConstructor({...base,owner:rescue}),/Owner and rescue must be distinct/);
 assert.ok(encodeRecoveryVaultConstructor(base).startsWith('0x'));
});
test('compiler provenance is a primitive, never a coerced object',()=>{
 for(const compilerVersion of [{toString(){return quote.compilerVersion}},[quote.compilerVersion],null])
  assert.throws(()=>createApothemReadOnlyDeploymentBudget({...quote,compilerVersion}),/pinned solc/);
});
test('fake-TXDC budget cap rejects coerced, unsafe, and noncanonical amounts',()=>{
 for(const cap of [true,{valueOf(){return 5n*10n**18n}},[5000000000000000000n],5e18,'05',null])
  assert.throws(()=>createApothemReadOnlyDeploymentBudget({...quote,maxBudgetWei:cap}),/exact primitive integer/);
 assert.equal(createApothemReadOnlyDeploymentBudget({...quote,maxBudgetWei:'5000000000000000000'}).withinFeeCap,true);
});
test('observed base fee above independent gas quotes cannot qualify as within cap',()=>{
 assert.equal(createApothemReadOnlyDeploymentBudget({...quote,baseFeePerGasHex:'0x9184e72a01'}).withinFeeCap,false);
 assert.equal(createApothemReadOnlyDeploymentBudget({...quote,baseFeePerGasHex:'0x9184e72a00'}).withinFeeCap,true);
});
