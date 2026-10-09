import { CORE_INVARIANT_IDS } from '../../core/invariants.js';

const KNOWN_PRIMITIVES=Object.freeze([
  'signer-list',
  'permission-delegation',
  'escrow',
  'tickets',
  'batch'
]);

function bool(value,label){
  if(typeof value!=='boolean') throw new TypeError(`${label} must be boolean.`);
  return value;
}

function feature(name,value){
  return Object.freeze({ name,enabled:bool(value,`${name}.enabled`) });
}

export function createXrplNativeCompositionAssessment({
  signerListEnabled,
  permissionDelegationEnabled,
  escrowEnabled,
  tokenEscrowEnabled=false,
  ticketsEnabled,
  batchEnabled,
  resettableInactivityEnforcedOnLedger=false,
  immutableRescueEnforcedOnLedger,
  amountScopeEnforcedOnLedger,
  currencyScopeEnforcedOnLedger,
  contactRedirectionPreventedOnLedger,
  ownerCanResetDeadlineOnLedger=false
}){
  const features=Object.freeze({
    signerList:feature('signer-list',signerListEnabled),
    permissionDelegation:feature('permission-delegation',permissionDelegationEnabled),
    escrow:feature('escrow',escrowEnabled),
    tokenEscrow:feature('token-escrow',tokenEscrowEnabled),
    tickets:feature('tickets',ticketsEnabled),
    batch:feature('batch',batchEnabled)
  });

  const exactResettableInactivity=
    bool(resettableInactivityEnforcedOnLedger,'resettableInactivityEnforcedOnLedger') &&
    bool(ownerCanResetDeadlineOnLedger,'ownerCanResetDeadlineOnLedger');

  const exactImmutableRescue=bool(immutableRescueEnforcedOnLedger,'immutableRescueEnforcedOnLedger');
  const exactAmountScope=bool(amountScopeEnforcedOnLedger,'amountScopeEnforcedOnLedger');
  const exactCurrencyScope=bool(currencyScopeEnforcedOnLedger,'currencyScopeEnforcedOnLedger');
  const exactContactNoRedirect=bool(contactRedirectionPreventedOnLedger,'contactRedirectionPreventedOnLedger');

  const thresholdAvailable=features.signerList.enabled;
  const delegationAvailable=features.permissionDelegation.enabled;
  const escrowAvailable=features.escrow.enabled;

  const invariantCoverage=Object.freeze({
    'OV-I01':true,
    'OV-I02':true,
    'OV-I03':thresholdAvailable || delegationAvailable || escrowAvailable,
    'OV-I04':exactImmutableRescue && exactContactNoRedirect,
    'OV-I05':exactContactNoRedirect,
    'OV-I06':thresholdAvailable && exactImmutableRescue,
    'OV-I07':thresholdAvailable,
    'OV-I08':true,
    'OV-I09':true,
    'OV-I10':thresholdAvailable || escrowAvailable,
    'OV-I11':false,
    'OV-I12':false,
    'OV-I13':false
  });

  const unresolved=Object.freeze([
    ...(!exactResettableInactivity ? ['owner-resettable inactivity is not independently enforced by the verified composition'] : []),
    ...(!exactImmutableRescue ? ['immutable rescue destination is not independently enforced by the verified composition'] : []),
    ...(!exactAmountScope ? ['recovery amount scope is not independently enforced by the verified composition'] : []),
    ...(!exactCurrencyScope ? ['recovery currency scope is not independently enforced by the verified composition'] : []),
    ...(!exactContactNoRedirect ? ['trusted contacts are not yet proven unable to redirect unrelated value'] : [])
  ]);

  const exactOmegaVaultEquivalent=
    exactResettableInactivity &&
    exactImmutableRescue &&
    exactAmountScope &&
    exactCurrencyScope &&
    exactContactNoRedirect &&
    thresholdAvailable;

  const fullCoverage=Object.freeze({
    ...invariantCoverage,
    'OV-I11':exactOmegaVaultEquivalent,
    'OV-I12':exactOmegaVaultEquivalent,
    'OV-I13':false
  });

  return Object.freeze({
    chainId:'xrpl',
    methodology:'invariant-first-chain-native-composition',
    primitiveOrder:KNOWN_PRIMITIVES,
    features,
    semantics:Object.freeze({
      thresholdAvailable,
      delegationAvailable,
      escrowAvailable,
      exactResettableInactivity,
      exactImmutableRescue,
      exactAmountScope,
      exactCurrencyScope,
      exactContactNoRedirect
    }),
    invariantCoverage:fullCoverage,
    requiredInvariantIds:CORE_INVARIANT_IDS,
    exactOmegaVaultEquivalent,
    stageRecommendation:exactOmegaVaultEquivalent ? 'implementation-candidate' : 'reduced-semantics',
    unresolved,
    hooksFamilyTrack:Object.freeze({
      xrplMainnetSupportClaimed:false,
      separateProgrammableFamilyProofAllowed:true,
      mustRemainDistinctFromXrplMainnetPromotion:true
    }),
    authorityBoundary:'This assessment compares XRPL-native primitive composition against OmegaVault invariants. It does not authorize signing/submission, does not claim XRPL mainnet support, and cannot promote XRPL unless every required invariant has independent public-network evidence.'
  });
}

export function assertXrplNativeCompositionCanPromote(assessment){
  if(!assessment || assessment.chainId!=='xrpl') throw new TypeError('XRPL native-composition assessment is required.');
  if(assessment.exactOmegaVaultEquivalent!==true) throw new Error('XRPL native composition has unresolved invariant gaps and cannot be promoted as exact OmegaVault support.');
  const missing=CORE_INVARIANT_IDS.filter(id=>assessment.invariantCoverage?.[id]!==true);
  if(missing.length) throw new Error(`XRPL native composition is missing invariant coverage: ${missing.join(', ')}.`);
  throw new Error('Invariant equivalence alone is insufficient: public-testnet evidence and support-promotion gates remain required.');
}
