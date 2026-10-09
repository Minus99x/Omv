import { CORE_INVARIANT_IDS } from '../../core/invariants.js';

function freezeList(values){ return Object.freeze([...values]); }

export const XRPL_NATIVE_RECOVERY_CANDIDATES=Object.freeze({
  FIXED_ESCROW:Object.freeze({
    id:'fixed-escrow',
    stages:freezeList(['owner-create-escrow','wait-until-finish-after','any-account-finish']),
    ledgerEnforcement:Object.freeze({
      immutableRescueDestination:true,
      fixedAmount:true,
      fixedAssetScope:true,
      thresholdContacts:false,
      resettableOwnerInactivity:false,
      oneUseExecution:true
    }),
    authority:Object.freeze({
      ownerChoosesPlanAtCreation:true,
      contactsRequiredToExecute:false,
      arbitrarySubmitterCanFinishEligibleEscrow:true,
      protectedFundsLockedBeforeRecovery:true
    })
  }),
  DELEGATED_THRESHOLD_PAYMENT:Object.freeze({
    id:'delegated-threshold-payment',
    stages:freezeList(['owner-delegate-payment','contacts-control-delegate-signer-quorum','delegate-submit-payment']),
    ledgerEnforcement:Object.freeze({
      immutableRescueDestination:false,
      fixedAmount:false,
      fixedAssetScope:false,
      thresholdContacts:true,
      resettableOwnerInactivity:false,
      oneUseExecution:false
    }),
    authority:Object.freeze({
      ownerChoosesDelegatePermissions:true,
      contactsRequiredThroughDelegateSignerList:true,
      contactQuorumCanAuthorizeAlternatePaymentFields:true,
      delegatePaysTransactionFee:true
    })
  }),
  OWNER_SIGNERLIST_TICKET:Object.freeze({
    id:'owner-signerlist-ticket',
    stages:freezeList(['owner-install-signer-list','owner-create-ticket','contacts-multisign-ticketed-payment']),
    ledgerEnforcement:Object.freeze({
      immutableRescueDestination:false,
      fixedAmount:false,
      fixedAssetScope:false,
      thresholdContacts:true,
      resettableOwnerInactivity:false,
      oneUseExecution:true
    }),
    authority:Object.freeze({
      signerQuorumIsAccountWideAuthorization:true,
      ticketIsOneUseSequenceReservation:true,
      ticketDoesNotBindTransactionIntent:true,
      contactQuorumCanAuthorizeAlternateTransactionFields:true
    })
  }),
  FIXED_ESCROW_WITH_CONTACT_COORDINATION:Object.freeze({
    id:'fixed-escrow-with-contact-coordination',
    stages:freezeList(['owner-create-conditional-or-timed-escrow','contacts-coordinate-off-ledger','submit-escrow-finish']),
    ledgerEnforcement:Object.freeze({
      immutableRescueDestination:true,
      fixedAmount:true,
      fixedAssetScope:true,
      thresholdContacts:false,
      resettableOwnerInactivity:false,
      oneUseExecution:true
    }),
    authority:Object.freeze({
      ledgerConditionCanGateFulfillment:true,
      ledgerDoesNotNativelyCountOmegaVaultContactApprovals:true,
      offLedgerThresholdCoordinationIsNotChainNativeQuorum:true
    })
  })
});

function gapList(candidate){
  const e=candidate.ledgerEnforcement;
  const gaps=[];
  if(!e.resettableOwnerInactivity) gaps.push('resettable-owner-inactivity');
  if(!e.thresholdContacts) gaps.push('chain-native-contact-threshold');
  if(!e.immutableRescueDestination) gaps.push('immutable-rescue-destination');
  if(!e.fixedAmount) gaps.push('immutable-recovery-amount');
  if(!e.fixedAssetScope) gaps.push('immutable-asset-scope');
  return Object.freeze(gaps);
}

function adversarialFindings(candidate){
  const findings=[];
  const id=candidate.id;
  if(id==='fixed-escrow'){
    findings.push(
      'Owner liveness cannot move FinishAfter on an existing escrow.',
      'Trusted-contact threshold is absent because any account may submit an eligible EscrowFinish.',
      'Protected funds are committed to escrow before recovery eligibility.'
    );
  } else if(id==='delegated-threshold-payment'){
    findings.push(
      'A valid delegate signer quorum can authorize a Payment with a different destination.',
      'Permission Delegation does not custom-bind Payment amount or currency to the predetermined Plan B.',
      'Delegated transaction authority has no owner-resettable inactivity clock.'
    );
  } else if(id==='owner-signerlist-ticket'){
    findings.push(
      'A Ticket prevents replay of that sequence reservation but does not bind the transaction body.',
      'A valid owner SignerList quorum can authorize a different transaction than the preconstructed rescue Payment.',
      'SignerList plus Ticket does not create an owner-resettable inactivity clock.'
    );
  } else {
    findings.push(
      'Escrow can bind destination and scope, but XRPL does not natively count OmegaVault contact approvals for EscrowFinish.',
      'Off-ledger secret/fulfillment coordination cannot be promoted as chain-native threshold enforcement.',
      'Existing escrow maturity remains absolute rather than owner-resettable.'
    );
  }
  return Object.freeze(findings);
}

export function createXrplNativeRecoverySequenceAssessment(){
  const candidates=Object.freeze(
    Object.fromEntries(
      Object.entries(XRPL_NATIVE_RECOVERY_CANDIDATES).map(([key,candidate])=>[
        key,
        Object.freeze({
          ...candidate,
          invariantGaps:gapList(candidate),
          adversarialFindings:adversarialFindings(candidate),
          exactOmegaVaultEquivalent:false
        })
      ])
    )
  );

  return Object.freeze({
    chainId:'xrpl',
    methodology:'enumerate-native-authority-sequences-and-attack-field-level-control',
    requiredInvariantIds:CORE_INVARIANT_IDS,
    candidates,
    strongestNativeProperties:Object.freeze({
      immutableDestinationAndFixedScope:'fixed-escrow',
      contactThreshold:'delegated-threshold-payment-or-owner-signerlist',
      oneUseSequence:'ticket',
      atomicGrouping:'batch',
      exactCombinedRecovery:null
    }),
    exactOmegaVaultEquivalent:false,
    stageRecommendation:'reduced-semantics',
    decisiveBlockers:Object.freeze([
      'No verified candidate combines owner-resettable inactivity with chain-native trusted-contact threshold and immutable rescue scope.',
      'Threshold-capable signer/delegate paths leave alternate transaction fields authorizable by the valid quorum.',
      'Escrow fixes destination/amount/time but uses absolute maturity and does not require the OmegaVault trusted-contact quorum.',
      'Tickets constrain sequence reuse, not transaction intent; Batch constrains atomicity, not the missing recovery authorization semantics.'
    ]),
    nextResearchGate:'Only reconsider exact equivalence if a verified XRPL amendment or composition independently binds resettable liveness and the complete predetermined recovery intent at ledger level.',
    authorityBoundary:'This is a fail-closed architecture assessment. It does not sign or submit transactions and does not claim XRPL support.'
  });
}

export function assertXrplCandidateResistsAdversary(candidateId){
  const assessment=createXrplNativeRecoverySequenceAssessment();
  const candidate=Object.values(assessment.candidates).find(value=>value.id===candidateId);
  if(!candidate) throw new TypeError('Unknown XRPL native recovery candidate.');
  if(candidate.exactOmegaVaultEquivalent!==true || candidate.invariantGaps.length>0 || candidate.adversarialFindings.length>0) {
    throw new Error(`XRPL candidate ${candidateId} has unresolved ledger-level recovery authority gaps.`);
  }
  return true;
}
