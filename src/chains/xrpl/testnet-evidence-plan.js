const PRIMITIVES=Object.freeze({
  signerList:Object.freeze({
    id:'signer-list',
    requiredFeatures:Object.freeze(['MultiSign']),
    publicChecks:Object.freeze([
      'validated SignerListSet transaction inclusion',
      'SignerList ledger object read-back',
      'exact signer accounts/weights/quorum match'
    ]),
    proves:Object.freeze(['weighted-threshold-authorization']),
    doesNotProve:Object.freeze(['owner-resettable-inactivity','immutable-rescue-destination','recovery-amount-scope'])
  }),
  permissionDelegation:Object.freeze({
    id:'permission-delegation',
    requiredFeatures:Object.freeze(['PermissionDelegationV1_1']),
    publicChecks:Object.freeze([
      'validated DelegateSet transaction inclusion',
      'Delegate ledger object read-back',
      'exact owner/delegate and PermissionValue set match',
      'delegated transaction accepted only for granted permission'
    ]),
    proves:Object.freeze(['ledger-recorded-delegated-transaction-type-authority']),
    doesNotProve:Object.freeze(['custom-rescue-destination-restriction','custom-amount-restriction','custom-currency-restriction','owner-resettable-inactivity'])
  }),
  escrow:Object.freeze({
    id:'escrow',
    requiredFeatures:Object.freeze(['Escrow']),
    publicChecks:Object.freeze([
      'validated EscrowCreate inclusion',
      'Escrow ledger object read-back',
      'exact immutable destination/amount/FinishAfter match',
      'validated EscrowFinish after eligibility',
      'escrow object absent after successful finish',
      'destination balance/state change independently observed'
    ]),
    proves:Object.freeze(['fixed-time-not-before','immutable-escrow-destination','fixed-escrow-amount']),
    doesNotProve:Object.freeze(['owner-resettable-inactivity','trusted-contact-threshold'])
  }),
  tokenEscrow:Object.freeze({
    id:'token-escrow',
    requiredFeatures:Object.freeze(['Escrow','TokenEscrow']),
    publicChecks:Object.freeze([
      'TokenEscrow amendment enabled at observed ledger',
      'asset issuer/account prerequisites independently verified',
      'validated token EscrowCreate inclusion',
      'exact token escrow object read-back',
      'validated finish and destination token balance/state change'
    ]),
    proves:Object.freeze(['fixed-time-token-escrow-to-predetermined-destination']),
    doesNotProve:Object.freeze(['owner-resettable-inactivity','trusted-contact-threshold'])
  }),
  ticket:Object.freeze({
    id:'ticket',
    requiredFeatures:Object.freeze(['TicketBatch']),
    publicChecks:Object.freeze([
      'validated TicketCreate inclusion',
      'Ticket ledger object read-back',
      'ticketed transaction uses Sequence=0 and exact TicketSequence',
      'Ticket ledger object consumed after validated use'
    ]),
    proves:Object.freeze(['one-use-sequence-reservation']),
    doesNotProve:Object.freeze(['transaction-intent-binding','immutable-rescue','inactivity'])
  }),
  batch:Object.freeze({
    id:'batch',
    requiredFeatures:Object.freeze(['BatchV1_1']),
    publicChecks:Object.freeze([
      'BatchV1_1 amendment enabled at observed ledger',
      'outer Batch validated',
      'exact RawTransactions set and batch mode observed',
      'inner transaction results match atomicity mode'
    ]),
    proves:Object.freeze(['atomic-or-mode-specific-grouped-transaction-execution']),
    doesNotProve:Object.freeze(['custom-delegation-scope','immutable-rescue','owner-resettable-inactivity']),
    caution:'Batch itself is non-delegable; delegated accounts may only send inner transactions for permissions they actually hold.'
  })
});

function exactText(value,label){
  if(typeof value!=='string' || !value.trim()) throw new TypeError(`${label} is required.`);
  return value.trim();
}

export function createXrplTestnetPrimitiveEvidencePlan({
  primitives=['signerList','permissionDelegation','escrow','ticket','batch'],
  networkRef='xrpl:testnet'
}={}){
  if(networkRef!=='xrpl:testnet') throw new TypeError('Current XRPL primitive evidence plan is scoped to xrpl:testnet.');
  if(!Array.isArray(primitives) || primitives.length<1) throw new TypeError('primitives must be a non-empty array.');
  if(new Set(primitives).size!==primitives.length) throw new TypeError('primitives must be unique.');

  const selected=Object.freeze(primitives.map((name,index)=>{
    const primitive=PRIMITIVES[name];
    if(!primitive) throw new TypeError(`primitives[${index}] is unknown: ${name}`);
    return primitive;
  }));

  const requiredFeatures=Object.freeze([...new Set(selected.flatMap(item=>item.requiredFeatures))].sort());
  return Object.freeze({
    schema:'omegavault.xrpl.testnet-primitive-evidence-plan.v1',
    chainId:'xrpl',
    networkRef,
    evidenceLevel:'public-testnet',
    primitiveEvidence:selected,
    requiredFeatures,
    featurePolicy:Object.freeze({
      queryTargetNetworkAtCaptureTime:true,
      documentationDoesNotEstablishActivation:true,
      unknownOrDisabledFeatureFailsClosed:true
    }),
    claimBoundary:Object.freeze({
      exactOmegaVaultRecoveryProven:false,
      resettableInactivityProven:false,
      immutableRescuePlusThresholdCombinedProven:false,
      publicNetworkRecoveryProven:false,
      supportClaimAuthorized:false
    }),
    evidenceRequirements:Object.freeze([
      exactText('validated ledger index/hash for each observation','ledger evidence'),
      exactText('transaction hash and result for each submitted primitive','transaction evidence'),
      exactText('ledger object read-back after each state-changing primitive','state evidence'),
      exactText('independent feature/amendment state observation','feature evidence')
    ]),
    nextGate:'Use primitive evidence to validate the strongest honest XRPL-native composition; do not infer exact OmegaVault equivalence from individually passing primitives.',
    authorityBoundary:'This plan is intentionally primitive-scoped. It may prove that XRPL features work on Testnet, but it cannot by itself prove the complete OmegaVault recovery invariant set or authorize chain support.'
  });
}

export function getXrplPrimitiveEvidenceSpec(name){
  const primitive=PRIMITIVES[name];
  return primitive ? structuredClone(primitive) : null;
}
