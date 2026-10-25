import { hashCardanoEvidence } from './evidence-binding.js';
import { createCardanoVaultDatumData } from './transaction-body.js';
import { cardanoPositiveSafeInteger } from './policy-integer.js';

const HEX_28=/^[0-9a-f]{56}$/i;
const HEX_32=/^[0-9a-f]{64}$/i;

function keyHash(value,label){
  if(typeof value!=='string' || !HEX_28.test(value)) throw new TypeError(`${label} must be 28-byte hex.`);
  return value.toLowerCase();
}

function sha(value,label){
  if(typeof value!=='string' || !HEX_32.test(value)) throw new TypeError(`${label} must be SHA-256/32-byte hex.`);
  return value.toLowerCase();
}

// Ogmios may provide canonical decimal strings, but an observation must
// never accept implicit Number()/valueOf()/toString() identity coercion.
function safeIndex(value,label){
  const number=typeof value==='number' && Number.isSafeInteger(value) ? value
    : typeof value==='string' && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value)
    : NaN;
  if(!Number.isSafeInteger(number) || number<0) throw new TypeError(`${label} must be a non-negative safe integer.`);
  return number;
}

function tip(value){
  const hash=sha(value?.hash,'observedTip.hash');
  const slot=safeIndex(value?.slot,'observedTip.slot');
  return Object.freeze({ hash,slot });
}

function stateReference(value){
  const id=sha(value?.transaction?.id,'observedStateUtxo.transaction.id');
  const index=safeIndex(value?.index,'observedStateUtxo.index');
  return Object.freeze({ transaction:Object.freeze({ id }),index });
}

function exactStateValue(value,{ lovelace,policyId,assetNameHex }){
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new TypeError('observedStateUtxo.value is required.');
  const topKeys=Object.keys(value).sort();
  const expectedTop=['ada',policyId].sort();
  if(topKeys.length!==2 || topKeys.some((entry,index)=>entry!==expectedTop[index])) {
    throw new Error('Observed active state must contain exactly ADA plus the one bound state-beacon policy.');
  }
  if(String(value.ada?.lovelace ?? '')!==String(lovelace)) throw new Error('Observed active state lovelace does not match the protected amount.');
  const policy=value[policyId];
  if(!policy || typeof policy!=='object' || Array.isArray(policy)) throw new Error('Observed active state beacon policy value is missing.');
  const assets=Object.keys(policy);
  if(assets.length!==1 || assets[0]!==assetNameHex || String(policy[assetNameHex])!=='1') {
    throw new Error('Observed active state must carry exactly one configured state beacon and no sibling assets.');
  }
}

export function createCardanoPreprodActiveStateEvidence({
  sourceAction,
  sourceArtifactSha256,
  transactionBodyHash,
  validatorIdentitySha256,
  observedTip,
  observedStateUtxo,
  recoveryAddress,
  beaconPolicyId,
  beaconAssetNameHex,
  ownerPaymentKeyHash,
  rescueKeyHash,
  contactKeyHashes,
  threshold,
  inactivityMs,
  stateLovelace,
  lastHeartbeatMs,
  approvalKeyHashes
}){
  if(!['heartbeat','approve'].includes(sourceAction)) throw new TypeError('sourceAction must be heartbeat or approve.');
  const sourceDigest=sha(sourceArtifactSha256,'sourceArtifactSha256');
  const bodyHash=sha(transactionBodyHash,'transactionBodyHash');
  const identityDigest=sha(validatorIdentitySha256,'validatorIdentitySha256');
  const observed=tip(observedTip);
  const reference=stateReference(observedStateUtxo);

  if(reference.transaction.id!==bodyHash) throw new Error('Observed active-state reference is not the exact source transaction body hash.');
  if(reference.index!==0) throw new Error('Current real lifecycle builders require the continuing active state at output index 0.');
  if(typeof observedStateUtxo.address!=='string' || typeof recoveryAddress!=='string' ||
      !recoveryAddress || observedStateUtxo.address!==recoveryAddress) {
    throw new Error('Observed active state is not at the bound recovery validator address.');
  }
  if(observedStateUtxo.script!=null) throw new Error('Observed active state must not carry a reference script.');

  const owner=keyHash(ownerPaymentKeyHash,'ownerPaymentKeyHash');
  const rescue=keyHash(rescueKeyHash,'rescueKeyHash');
  if(!Array.isArray(contactKeyHashes) || contactKeyHashes.length<1) throw new TypeError('contactKeyHashes must be non-empty.');
  const contacts=contactKeyHashes.map((entry,index)=>keyHash(entry,`contactKeyHashes[${index}]`));
  if(new Set(contacts).size!==contacts.length) throw new Error('Configured contacts must be unique.');
  const approvals=(approvalKeyHashes ?? []).map((entry,index)=>keyHash(entry,`approvalKeyHashes[${index}]`));
  if(new Set(approvals).size!==approvals.length || approvals.some(entry=>!contacts.includes(entry))) throw new Error('Observed approval set is invalid.');
  if(sourceAction==='heartbeat' && approvals.length!==0) throw new Error('Observed heartbeat state must clear all approvals.');
  if(sourceAction==='approve' && approvals.length<1) throw new Error('Observed approval state must contain at least one configured approval.');

  const normalizedThreshold=cardanoPositiveSafeInteger(threshold,'threshold');
  if(normalizedThreshold>contacts.length) throw new Error('threshold must be reachable.');
  const normalizedInactivity=cardanoPositiveSafeInteger(inactivityMs,'inactivityMs');
  const heartbeat=Number(lastHeartbeatMs);
  if(!Number.isSafeInteger(heartbeat) || heartbeat<0) throw new Error('lastHeartbeatMs must be a non-negative safe integer.');
  const lovelace=String(stateLovelace);
  if(!/^\d+$/.test(lovelace) || BigInt(lovelace)<1n) throw new TypeError('stateLovelace must be a positive integer.');
  const policyId=keyHash(beaconPolicyId,'beaconPolicyId');
  const assetNameHex=String(beaconAssetNameHex ?? '').toLowerCase();
  if(assetNameHex.length>64 || assetNameHex.length%2!==0 || !/^[0-9a-f]*$/.test(assetNameHex)) throw new TypeError('beaconAssetNameHex must be 0-32 bytes of hex.');

  exactStateValue(observedStateUtxo.value,{ lovelace,policyId,assetNameHex });

  const expectedDatum=createCardanoVaultDatumData({
    ownerKeyHash:owner,
    rescueKeyHash:rescue,
    contactKeyHashes:contacts,
    threshold:normalizedThreshold,
    inactivityMs:normalizedInactivity,
    lastHeartbeatMs:heartbeat,
    approvalKeyHashes:approvals
  });
  const expectedDatumHex=Buffer.from(expectedDatum.to_bytes()).toString('hex');
  const observedDatum=typeof observedStateUtxo.datum==='string'
    ? observedStateUtxo.datum.toLowerCase() : null;
  if(observedDatum!==expectedDatumHex) throw new Error('Observed active-state inline datum does not exactly reproduce the expected lifecycle state.');

  const core=Object.freeze({
    schema:'omegavault.cardano.preprod-active-state-evidence.v1',
    network:'preprod',
    sourceAction,
    transactionBodyHash:bodyHash,
    sourceArtifactSha256:sourceDigest,
    validatorIdentitySha256:identityDigest,
    observedTip:observed,
    stateReference:reference,
    state:Object.freeze({
      address:String(recoveryAddress),
      lovelace,
      beaconPolicyId:policyId,
      beaconAssetNameHex:assetNameHex,
      beaconQuantity:'1',
      inlineDatumCborHex:expectedDatumHex,
      ownerPaymentKeyHash:owner,
      rescueKeyHash:rescue,
      contactKeyHashes:Object.freeze(contacts),
      threshold:normalizedThreshold,
      inactivityMs:normalizedInactivity,
      lastHeartbeatMs:heartbeat,
      approvalKeyHashes:Object.freeze(approvals)
    }),
    checks:Object.freeze({
      sourceArtifactDigestBound:true,
      exactTransactionBodyHashBound:true,
      exactActiveStateObserved:true,
      exactRecoveryValidatorAddressObserved:true,
      exactProtectedLovelaceObserved:true,
      exactSingleBeaconObserved:true,
      exactConfiguredInlineDatumObserved:true,
      stateUtxoUnspentAtObservedTip:true,
      inclusionObserved:true,
      finalityProven:false
    }),
    liveActions:Object.freeze({
      walletSigningPerformed:true,
      transactionSubmissionPerformed:true,
      transactionSubmissionAuthorized:false,
      liveValueMovementAuthorized:false,
      publicNetworkRecoveryProven:false,
      supportClaimAuthorized:false
    }),
    nextGate:sourceAction==='heartbeat'
      ? 'build-one-independent-trusted-contact-approval-from-this-exact-state'
      : 'build-next-approval-or-threshold-execute-from-this-exact-state',
    authorityBoundary:'This evidence records observation of one already-submitted continuing Cardano Preprod active state. It does not authorize signing or submission, does not prove finality, does not prove complete recovery and does not authorize support promotion.'
  });
  return Object.freeze({ ...core,stateEvidenceSha256:hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodActiveStateEvidence({ evidence,...inputs }){
  if(!evidence || typeof evidence!=='object' || Array.isArray(evidence)) {
    return Object.freeze({ valid:false,errors:Object.freeze(['Cardano Preprod active-state evidence is required.']),recomputedSha256:null });
  }
  const errors=[];
  let recomputed;
  try { recomputed=createCardanoPreprodActiveStateEvidence(inputs); }
  catch(error){ return Object.freeze({ valid:false,errors:Object.freeze([error.message]),recomputedSha256:null }); }
  const core=Object.fromEntries(Object.entries(evidence).filter(([name])=>name!=='stateEvidenceSha256'));
  if(!HEX_32.test(String(evidence.stateEvidenceSha256 ?? '')) || hashCardanoEvidence(core)!==evidence.stateEvidenceSha256) errors.push('Cardano Preprod active-state evidence self-digest mismatch.');
  if(evidence.stateEvidenceSha256!==recomputed.stateEvidenceSha256) errors.push('Cardano Preprod active-state evidence does not reproduce from its exact observed state.');
  return Object.freeze({ valid:errors.length===0,errors:Object.freeze(errors),recomputedSha256:recomputed.stateEvidenceSha256 });
}
