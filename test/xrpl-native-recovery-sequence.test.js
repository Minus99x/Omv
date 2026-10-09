import test from 'node:test';
import assert from 'node:assert/strict';
import {
  XRPL_NATIVE_RECOVERY_CANDIDATES,
  createXrplNativeRecoverySequenceAssessment,
  assertXrplCandidateResistsAdversary
} from '../src/chains/xrpl/native-recovery-sequence.js';

test('XRPL fixed escrow preserves destination/scope but fails threshold and resettable inactivity',()=>{
  const assessment=createXrplNativeRecoverySequenceAssessment();
  const candidate=assessment.candidates.FIXED_ESCROW;
  assert.equal(candidate.ledgerEnforcement.immutableRescueDestination,true);
  assert.equal(candidate.ledgerEnforcement.fixedAmount,true);
  assert.equal(candidate.ledgerEnforcement.thresholdContacts,false);
  assert.equal(candidate.ledgerEnforcement.resettableOwnerInactivity,false);
  assert.ok(candidate.invariantGaps.includes('chain-native-contact-threshold'));
  assert.ok(candidate.invariantGaps.includes('resettable-owner-inactivity'));
});

test('XRPL delegated threshold payment can satisfy quorum while still permitting destination substitution',()=>{
  const assessment=createXrplNativeRecoverySequenceAssessment();
  const candidate=assessment.candidates.DELEGATED_THRESHOLD_PAYMENT;
  assert.equal(candidate.ledgerEnforcement.thresholdContacts,true);
  assert.equal(candidate.ledgerEnforcement.immutableRescueDestination,false);
  assert.ok(candidate.adversarialFindings.some(item=>/different destination/i.test(item)));
  assert.throws(
    ()=>assertXrplCandidateResistsAdversary(candidate.id),
    /unresolved ledger-level recovery authority gaps/
  );
});

test('XRPL Ticket is one-use sequencing rather than transaction-intent binding',()=>{
  const assessment=createXrplNativeRecoverySequenceAssessment();
  const candidate=assessment.candidates.OWNER_SIGNERLIST_TICKET;
  assert.equal(candidate.ledgerEnforcement.oneUseExecution,true);
  assert.equal(candidate.authority.ticketDoesNotBindTransactionIntent,true);
  assert.ok(candidate.adversarialFindings.some(item=>/does not bind the transaction body/i.test(item)));
});

test('XRPL conditional escrow plus off-ledger contact coordination is not mislabeled chain-native threshold',()=>{
  const assessment=createXrplNativeRecoverySequenceAssessment();
  const candidate=assessment.candidates.FIXED_ESCROW_WITH_CONTACT_COORDINATION;
  assert.equal(candidate.ledgerEnforcement.thresholdContacts,false);
  assert.equal(candidate.authority.offLedgerThresholdCoordinationIsNotChainNativeQuorum,true);
});

test('XRPL native recovery sequence assessment stays reduced until one candidate closes all gaps',()=>{
  const assessment=createXrplNativeRecoverySequenceAssessment();
  assert.equal(assessment.exactOmegaVaultEquivalent,false);
  assert.equal(assessment.stageRecommendation,'reduced-semantics');
  assert.equal(assessment.strongestNativeProperties.exactCombinedRecovery,null);
  assert.equal(Object.keys(assessment.candidates).length,Object.keys(XRPL_NATIVE_RECOVERY_CANDIDATES).length);
  assert.ok(assessment.decisiveBlockers.some(item=>/resettable inactivity/i.test(item)));
});
