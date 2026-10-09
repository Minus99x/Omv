import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createXrplNativeCompositionAssessment,
  assertXrplNativeCompositionCanPromote
} from '../src/chains/xrpl/native-composition.js';
import { CORE_INVARIANT_IDS } from '../src/core/invariants.js';

function currentGapAssessment(){
  return createXrplNativeCompositionAssessment({
    signerListEnabled:true,
    permissionDelegationEnabled:true,
    escrowEnabled:true,
    tokenEscrowEnabled:true,
    ticketsEnabled:true,
    batchEnabled:true,
    resettableInactivityEnforcedOnLedger:false,
    ownerCanResetDeadlineOnLedger:false,
    immutableRescueEnforcedOnLedger:true,
    amountScopeEnforcedOnLedger:true,
    currencyScopeEnforcedOnLedger:true,
    contactRedirectionPreventedOnLedger:false
  });
}

test('XRPL native composition stays reduced-semantics while resettable inactivity or contact non-redirection remain unproven',()=>{
  const assessment=currentGapAssessment();
  assert.equal(assessment.methodology,'invariant-first-chain-native-composition');
  assert.equal(assessment.semantics.thresholdAvailable,true);
  assert.equal(assessment.semantics.exactImmutableRescue,true);
  assert.equal(assessment.semantics.exactResettableInactivity,false);
  assert.equal(assessment.semantics.exactContactNoRedirect,false);
  assert.equal(assessment.exactOmegaVaultEquivalent,false);
  assert.equal(assessment.stageRecommendation,'reduced-semantics');
  assert.ok(assessment.unresolved.some(item=>/resettable inactivity/i.test(item)));
  assert.ok(assessment.unresolved.some(item=>/redirect/i.test(item)));
  assert.throws(()=>assertXrplNativeCompositionCanPromote(assessment),/unresolved invariant gaps/);
});

test('XRPL composition model does not confuse Tickets or Batch with an inactivity clock',()=>{
  const assessment=currentGapAssessment();
  assert.equal(assessment.features.tickets.enabled,true);
  assert.equal(assessment.features.batch.enabled,true);
  assert.equal(assessment.semantics.exactResettableInactivity,false);
});

test('XRPL programmable-family Hooks track remains separate from XRPL mainnet support claims',()=>{
  const assessment=currentGapAssessment();
  assert.equal(assessment.hooksFamilyTrack.xrplMainnetSupportClaimed,false);
  assert.equal(assessment.hooksFamilyTrack.separateProgrammableFamilyProofAllowed,true);
  assert.equal(assessment.hooksFamilyTrack.mustRemainDistinctFromXrplMainnetPromotion,true);
});

test('XRPL exact native equivalence still cannot bypass public-testnet promotion evidence',()=>{
  const assessment=createXrplNativeCompositionAssessment({
    signerListEnabled:true,
    permissionDelegationEnabled:true,
    escrowEnabled:true,
    tokenEscrowEnabled:true,
    ticketsEnabled:true,
    batchEnabled:true,
    resettableInactivityEnforcedOnLedger:true,
    ownerCanResetDeadlineOnLedger:true,
    immutableRescueEnforcedOnLedger:true,
    amountScopeEnforcedOnLedger:true,
    currencyScopeEnforcedOnLedger:true,
    contactRedirectionPreventedOnLedger:true
  });
  assert.equal(assessment.exactOmegaVaultEquivalent,true);
  assert.equal(assessment.stageRecommendation,'implementation-candidate');
  for(const id of CORE_INVARIANT_IDS.filter(id=>id!=='OV-I13')) assert.equal(assessment.invariantCoverage[id],true);
  assert.equal(assessment.invariantCoverage['OV-I13'],false);
  // OV-I13 is the public-testnet proof gate; even a hypothetical native
  // composition that satisfies all other invariants may not bypass it.
  assert.throws(()=>assertXrplNativeCompositionCanPromote(assessment),/missing invariant coverage: OV-I13/);
});
