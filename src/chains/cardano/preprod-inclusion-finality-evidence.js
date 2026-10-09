import { hashCardanoEvidence } from './evidence-binding.js';

const HEX_32=/^[0-9a-f]{64}$/i;

function hex32(value,label){
  const normalized=String(value ?? '').toLowerCase();
  if(!HEX_32.test(normalized)) throw new TypeError(`${label} must be 32-byte hex.`);
  return normalized;
}

function observation(value,label){
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new TypeError(`${label} is required.`);
  const tipHash=hex32(value.tipHash,`${label}.tipHash`);
  const tipSlot=Number(value.tipSlot);
  if(!Number.isSafeInteger(tipSlot) || tipSlot<0) throw new TypeError(`${label}.tipSlot must be a non-negative safe integer.`);
  return Object.freeze({
    tipHash,
    tipSlot,
    transactionSeen:value.transactionSeen===true,
    sourceBlockStillCanonical:value.sourceBlockStillCanonical===true,
    tipDescendsFromSourceBlock:value.tipDescendsFromSourceBlock===true
  });
}

export function createCardanoPreprodInclusionFinalityEvidence({
  sourceAction,
  transactionBodyHash,
  sourceArtifactSha256,
  inclusionObservation,
  laterObservation,
  policy
}){
  if(!['initialize','heartbeat','approve','execute'].includes(sourceAction)) throw new TypeError('sourceAction must be initialize, heartbeat, approve, or execute.');
  const txHash=hex32(transactionBodyHash,'transactionBodyHash');
  const artifactSha256=hex32(sourceArtifactSha256,'sourceArtifactSha256');
  const inclusion=observation(inclusionObservation,'inclusionObservation');
  const later=observation(laterObservation,'laterObservation');

  const minimumDepthSlots=Number(policy?.minimumDepthSlots);
  if(!Number.isSafeInteger(minimumDepthSlots) || minimumDepthSlots<1) throw new TypeError('policy.minimumDepthSlots must be a positive safe integer.');
  if(policy?.requireCanonicalAncestry!==true) throw new Error('Cardano finality evidence policy must require canonical ancestry.');
  if(inclusion.transactionSeen!==true) throw new Error('Inclusion observation must see the exact transaction.');
  if(later.transactionSeen!==true) throw new Error('Later observation must still see the exact transaction.');
  if(later.sourceBlockStillCanonical!==true || later.tipDescendsFromSourceBlock!==true) {
    throw new Error('Later observation must confirm the inclusion block remains canonical and ancestral to the later tip.');
  }
  if(later.tipSlot<=inclusion.tipSlot) throw new Error('Later finality observation must be strictly after the inclusion observation.');

  const observedDepthSlots=later.tipSlot-inclusion.tipSlot;
  if(observedDepthSlots<minimumDepthSlots) throw new Error('Observed Cardano settlement depth is below the configured finality policy threshold.');

  const core=Object.freeze({
    schema:'omegavault.cardano.preprod-inclusion-finality-evidence.v1',
    network:'preprod',
    sourceAction,
    transactionBodyHash:txHash,
    sourceArtifactSha256:artifactSha256,
    inclusionObservation:inclusion,
    laterObservation:later,
    finalityPolicy:Object.freeze({
      minimumDepthSlots,
      requireCanonicalAncestry:true,
      policyFinalitySatisfied:true,
      absoluteConsensusFinalityClaimed:false
    }),
    checks:Object.freeze({
      exactTransactionInclusionObserved:true,
      laterTransactionObservationConfirmed:true,
      sourceBlockStillCanonical:true,
      laterTipDescendsFromSourceBlock:true,
      requiredSettlementDepthSatisfied:true,
      inclusionAndFinalitySeparated:true
    }),
    liveActions:Object.freeze({
      transactionSubmissionPerformed:true,
      transactionSubmissionAuthorized:false,
      publicNetworkRecoveryProven:false,
      supportClaimAuthorized:false
    }),
    nextGate:sourceAction==='execute'
      ? 'bind-finalized-execute-to-observed-immutable-rescue-output-and-full-lifecycle-proof'
      : 'bind-finalized-state-transition-to-the-next-exact-lifecycle-predecessor',
    authorityBoundary:'This evidence proves that the exact submitted Cardano Preprod transaction remained on the observed canonical chain for at least the explicitly configured settlement-depth policy. It deliberately distinguishes inclusion from policy-level finality, makes no claim of absolute consensus finality, authorizes no submission and does not by itself prove public-network recovery or connector support.'
  });
  return Object.freeze({ ...core,evidenceSha256:hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodInclusionFinalityEvidence({ evidence,...inputs }){
  if(!evidence || typeof evidence!=='object' || Array.isArray(evidence)) {
    return Object.freeze({ valid:false,errors:Object.freeze(['Cardano Preprod inclusion/finality evidence is required.']),recomputedSha256:null });
  }
  const errors=[];
  let recomputed;
  try { recomputed=createCardanoPreprodInclusionFinalityEvidence(inputs); }
  catch(error){ return Object.freeze({ valid:false,errors:Object.freeze([error.message]),recomputedSha256:null }); }
  const core=Object.fromEntries(Object.entries(evidence).filter(([name])=>name!=='evidenceSha256'));
  if(!HEX_32.test(String(evidence.evidenceSha256 ?? '')) || hashCardanoEvidence(core)!==evidence.evidenceSha256) errors.push('Cardano Preprod inclusion/finality evidence self-digest mismatch.');
  if(evidence.evidenceSha256!==recomputed.evidenceSha256) errors.push('Cardano Preprod inclusion/finality evidence does not reproduce from the exact observations and policy.');
  return Object.freeze({ valid:errors.length===0,errors:Object.freeze(errors),recomputedSha256:recomputed.evidenceSha256 });
}
