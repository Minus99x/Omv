import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { createHash } from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2.js';
import { hashCardanoEvidence } from './evidence-binding.js';
import { cardanoPreprodSlotToUnixTimeMs, createCardanoVaultDatumData } from './transaction-body.js';
import { verifyCardanoPreprodAppliedValidatorIdentity } from './live-validator-identity.js';

const HEX_32 = /^[0-9a-f]{64}$/i;
const UINT = /^\d+$/;

function withoutDigest(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function canonicalHex(value, label) {
  const normalized = String(value ?? '').toLowerCase();
  if (!/^(?:[0-9a-f]{2})+$/i.test(normalized)) throw new TypeError(`${label} must be non-empty even-length base16.`);
  return normalized;
}

function stableTip(value) {
  const hash = String(value?.hash ?? '').toLowerCase();
  const slot = Number(value?.slot);
  if (!HEX_32.test(hash) || !Number.isSafeInteger(slot) || slot < 0) {
    throw new TypeError('observedTip must contain a 32-byte block hash and non-negative safe slot.');
  }
  return Object.freeze({ hash, slot });
}

function expectedStateValue({ lovelace, policyId, assetNameHex }) {
  return Object.freeze({
    ada: Object.freeze({ lovelace:String(lovelace) }),
    [policyId]: Object.freeze({ [assetNameHex]:'1' })
  });
}

function validateObservedStateValue(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Observed state UTxO value is required.');
  const topKeys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (topKeys.length !== expectedKeys.length || !topKeys.every((key, index) => key === expectedKeys[index])) {
    throw new Error('Observed state UTxO contains unexpected or missing asset policies.');
  }
  if (String(value?.ada?.lovelace ?? '') !== expected.ada.lovelace) {
    throw new Error('Observed state UTxO lovelace differs from the frozen initialize state output.');
  }
  const policyId = expectedKeys.find(key => key !== 'ada');
  const observedAssets = value?.[policyId];
  const expectedAssets = expected[policyId];
  const observedAssetNames = observedAssets && typeof observedAssets === 'object' ? Object.keys(observedAssets).sort() : [];
  const expectedAssetNames = Object.keys(expectedAssets).sort();
  if (observedAssetNames.length !== expectedAssetNames.length ||
      !observedAssetNames.every((name, index) => name === expectedAssetNames[index])) {
    throw new Error('Observed state UTxO beacon asset set differs from the frozen initialize state output.');
  }
  for (const name of expectedAssetNames) {
    if (String(observedAssets[name]) !== expectedAssets[name]) {
      throw new Error('Observed state UTxO beacon quantity differs from the frozen initialize state output.');
    }
  }
}

function verifyWitnessEvidenceEnvelope(evidence, signedTransactionCborHex) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new TypeError('Verified initialize wallet-witness evidence is required.');
  }
  if (evidence.schema !== 'omegavault.cardano.preprod-initialize-wallet-witness-evidence.v1' ||
      evidence.network !== 'preprod' ||
      evidence.action !== 'initialize' ||
      evidence.checks?.walletWitnessesValidated !== true ||
      evidence.checks?.completePhaseOneValidated !== false ||
      evidence.liveActions?.walletSigningPerformed !== true ||
      evidence.liveActions?.transactionSubmissionPerformed !== false ||
      evidence.liveActions?.transactionSubmissionAuthorized !== false ||
      evidence.liveActions?.supportClaimAuthorized !== false) {
    throw new Error('Wallet-witness evidence is not at the expected verified/no-submission authority boundary.');
  }
  if (!HEX_32.test(String(evidence.witnessEvidenceSha256 ?? '')) ||
      hashCardanoEvidence(withoutDigest(evidence, 'witnessEvidenceSha256')) !== evidence.witnessEvidenceSha256) {
    throw new Error('Wallet-witness evidence self-digest mismatch.');
  }
  const normalizedSigned = canonicalHex(signedTransactionCborHex, 'signedTransactionCborHex');
  if (normalizedSigned !== String(evidence.signedTransactionCborHex ?? '').toLowerCase()) {
    throw new Error('Signed transaction bytes differ from the wallet-witness evidence.');
  }
  const signedSha256 = createHash('sha256').update(Buffer.from(normalizedSigned, 'hex')).digest('hex');
  if (signedSha256 !== evidence.signedTransactionSha256) {
    throw new Error('Signed transaction digest differs from the wallet-witness evidence.');
  }
}

export function createCardanoPreprodInitializeStateObservationEvidence({
  signedTransactionCborHex,
  walletWitnessEvidence,
  appliedValidatorIdentity,
  recoveryConfig,
  observedTip,
  observedUtxo
}) {
  verifyWitnessEvidenceEnvelope(walletWitnessEvidence, signedTransactionCborHex);

  const identityCheck = verifyCardanoPreprodAppliedValidatorIdentity(appliedValidatorIdentity);
  if (!identityCheck.valid) {
    throw new Error(`Applied validator identity is invalid: ${identityCheck.errors.join('; ')}`);
  }

  const config = recoveryConfig;
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('recoveryConfig is required.');
  if (!UINT.test(String(config.stateLovelace ?? '')) || BigInt(config.stateLovelace) < 1n) {
    throw new TypeError('recoveryConfig.stateLovelace must be a positive integer.');
  }

  const signedHex = canonicalHex(signedTransactionCborHex, 'signedTransactionCborHex');
  const signedTx = Cardano.Transaction.from_hex(signedHex);
  if (signedTx.is_valid() !== true) throw new Error('Observed initialize transaction must carry a true transaction validity flag.');

  const body = signedTx.body();
  const bodyHash = Buffer.from(blake2b(body.to_bytes(), { dkLen:32 })).toString('hex');
  if (bodyHash !== walletWitnessEvidence.transactionBodyHash) {
    throw new Error('Observed initialize transaction body hash differs from wallet-witness evidence.');
  }
  if (body.outputs().len() !== 2) throw new Error('Initialize transaction must contain exactly state + wallet change outputs.');

  const stateOutput = body.outputs().get(0);
  if (stateOutput.address().to_bech32() !== appliedValidatorIdentity.recoveryVault.address) {
    throw new Error('Frozen initialize state output is not at the applied recovery validator.');
  }
  if (stateOutput.amount().coin().to_str() !== String(config.stateLovelace)) {
    throw new Error('Frozen initialize state output lovelace differs from the recovery configuration.');
  }

  const policyId = String(appliedValidatorIdentity.stateBeacon.policyId).toLowerCase();
  const assetNameHex = String(appliedValidatorIdentity.assetNameHex).toLowerCase();
  const multiasset = stateOutput.amount().multiasset();
  if (!multiasset || multiasset.keys().len() !== 1) throw new Error('Frozen initialize state output must contain exactly one native-asset policy.');
  const policy = Cardano.ScriptHash.from_hex(policyId);
  const assets = multiasset.get(policy);
  if (!assets || assets.keys().len() !== 1) throw new Error('Frozen initialize state output must contain exactly one beacon asset.');
  const assetName = Cardano.AssetName.new(Uint8Array.from(Buffer.from(assetNameHex, 'hex')));
  const beaconQuantity = assets.get(assetName);
  if (!beaconQuantity || beaconQuantity.to_str() !== '1') throw new Error('Frozen initialize state output must contain exactly one state beacon.');

  const lowerSlot = Number(body.validity_start_interval_bignum()?.to_str());
  if (!Number.isSafeInteger(lowerSlot) || lowerSlot < 0) throw new Error('Initialize transaction is missing a valid lower validity slot.');
  const expectedDatum = createCardanoVaultDatumData({
    ownerKeyHash:walletWitnessEvidence.ownerPaymentKeyHash,
    rescueKeyHash:config.rescueKeyHash,
    contactKeyHashes:config.contactKeyHashes,
    threshold:config.threshold,
    inactivityMs:config.inactivityMs,
    lastHeartbeatMs:cardanoPreprodSlotToUnixTimeMs(lowerSlot),
    approvalKeyHashes:[]
  });
  const expectedDatumHex = Buffer.from(expectedDatum.to_bytes()).toString('hex');
  const actualDatum = stateOutput.plutus_data();
  if (!actualDatum) throw new Error('Frozen initialize state output is missing its inline datum.');
  if (Buffer.from(actualDatum.to_bytes()).toString('hex') !== expectedDatumHex) {
    throw new Error('Frozen initialize state datum does not reproduce from the recovery configuration.');
  }

  const tip = stableTip(observedTip);
  if (!observedUtxo || typeof observedUtxo !== 'object' || Array.isArray(observedUtxo)) {
    throw new TypeError('observedUtxo is required.');
  }
  const observedTxId = String(observedUtxo?.transaction?.id ?? '').toLowerCase();
  const observedIndex = Number(observedUtxo?.index);
  if (observedTxId !== bodyHash || observedIndex !== 0) {
    throw new Error('Observed state UTxO reference does not match initialize transaction output 0.');
  }
  if (observedUtxo.address !== appliedValidatorIdentity.recoveryVault.address) {
    throw new Error('Observed state UTxO address differs from the applied recovery validator.');
  }

  const expectedValue = expectedStateValue({
    lovelace:config.stateLovelace,
    policyId,
    assetNameHex
  });
  validateObservedStateValue(observedUtxo.value, expectedValue);

  if (String(observedUtxo.datum ?? '').toLowerCase() !== expectedDatumHex) {
    throw new Error('Observed state UTxO inline datum differs from the frozen initialize state datum.');
  }
  if (observedUtxo.script != null) {
    throw new Error('Observed initialize state UTxO unexpectedly contains a reference script.');
  }

  const observedValueSha256 = hashCardanoEvidence(observedUtxo.value);
  const core = Object.freeze({
    schema:'omegavault.cardano.preprod-initialize-state-observation-evidence.v1',
    network:'preprod',
    action:'initialize',
    transactionBodyHash:bodyHash,
    signedTransactionSha256:walletWitnessEvidence.signedTransactionSha256,
    witnessEvidenceSha256:walletWitnessEvidence.witnessEvidenceSha256,
    validatorIdentitySha256:appliedValidatorIdentity.identitySha256,
    observedTip:tip,
    stateReference:Object.freeze({ transaction:Object.freeze({ id:bodyHash }), index:0 }),
    stateObservation:Object.freeze({
      address:observedUtxo.address,
      valueSha256:observedValueSha256,
      lovelace:String(config.stateLovelace),
      beaconPolicyId:policyId,
      beaconAssetNameHex:assetNameHex,
      beaconQuantity:'1',
      inlineDatumCborHex:expectedDatumHex,
      referenceScriptPresent:false
    }),
    checks:Object.freeze({
      exactSignedTransactionBound:true,
      exactTransactionBodyHashBound:true,
      exactStateOutputReferenceObserved:true,
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
    nextGate:'separate-cardano-inclusion-finality-evidence-before-lifecycle-promotion',
    authorityBoundary:'This evidence binds an already-submitted, already-wallet-verified initialize transaction to the exact expected active recovery state UTxO observed on Cardano Preprod at one tip. It proves state-output inclusion/availability only. It does not itself prove finality, authorize any submission, prove recovery, or authorize support promotion.'
  });
  return Object.freeze({ ...core, observationSha256:hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodInitializeStateObservationEvidence({
  evidence,
  ...inputs
}) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return Object.freeze({ valid:false, errors:Object.freeze(['Initialize state-observation evidence is required.']), recomputedSha256:null });
  }
  const errors=[];
  let recomputed;
  try {
    recomputed=createCardanoPreprodInitializeStateObservationEvidence(inputs);
  } catch (error) {
    return Object.freeze({ valid:false, errors:Object.freeze([error.message]), recomputedSha256:null });
  }
  if (!HEX_32.test(String(evidence.observationSha256 ?? '')) ||
      hashCardanoEvidence(withoutDigest(evidence, 'observationSha256')) !== evidence.observationSha256) {
    errors.push('Initialize state-observation evidence self-digest mismatch.');
  }
  if (evidence.observationSha256 !== recomputed.observationSha256) {
    errors.push('Initialize state-observation evidence does not reproduce from the signed transaction and observed UTxO.');
  }
  return Object.freeze({ valid:errors.length===0, errors:Object.freeze(errors), recomputedSha256:recomputed.observationSha256 });
}
