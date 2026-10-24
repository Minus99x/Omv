import test from 'node:test';
import assert from 'node:assert/strict';
import {assessXrplRecoverySemantics,XRPL_RECOVERY_MODES}
 from '../src/chains/xrpl/recovery-semantics.js';
const mode=XRPL_RECOVERY_MODES.FIXED_TIME_ESCROW;
test('XRPL TokenEscrow capability requires an explicit primitive boolean',()=>{
 for(const token of ['false','true',1,0,[],{},null,new Boolean(false)])
  assert.throws(()=>assessXrplRecoverySemantics({mode,token}),/primitive boolean/);
 assert.equal(assessXrplRecoverySemantics({mode,token:true}).tokenEscrowCapabilityRequired,true);
 assert.equal(assessXrplRecoverySemantics({mode,token:false}).tokenEscrowCapabilityRequired,false);
});
