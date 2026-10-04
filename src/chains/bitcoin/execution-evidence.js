import { createHash } from 'node:crypto';
import { decodePsbtV2, finalizePsbtV2RecoveryTransaction } from './psbt-v2.js';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function digestBytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function descriptorBinding(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') throw new TypeError('Bitcoin recovery descriptor is required.');
  if (descriptor.network !== 'signet') throw new TypeError('Bitcoin finalizer execution evidence is currently scoped to Signet.');
  if (!/^[0-9a-f]{64}$/i.test(descriptor.policyDigest ?? '')) throw new TypeError('Descriptor policyDigest is required.');
  return Object.freeze({
    network: descriptor.network,
    ownerKey: descriptor.ownerKey,
    contactKeys: Object.freeze([...(descriptor.contactKeys ?? [])]),
    threshold: descriptor.threshold,
    csvBlocks: descriptor.csvBlocks,
    checkedDescriptor: descriptor.checkedDescriptor,
    address: descriptor.address,
    witnessScriptHex: descriptor.witnessScriptHex,
    scriptPubKeyHex: descriptor.scriptPubKeyHex,
    policyDigest: descriptor.policyDigest.toLowerCase()
  });
}

export function createBitcoinRecoveryFinalizerEvidence({
  psbt,
  descriptor,
  rescueScriptPubKey,
  expectedFeeSats
}) {
  const boundDescriptor = descriptorBinding(descriptor);
  const decoded = typeof psbt?.psbtVersion === 'number' ? psbt : decodePsbtV2(psbt);
  const finalized = finalizePsbtV2RecoveryTransaction({
    psbt: decoded,
    descriptor,
    rescueScriptPubKey,
    expectedFeeSats
  });

  const psbtBytes = Buffer.from(decoded.base64, 'base64');
  const rawBytes = Buffer.from(finalized.rawTransactionHex, 'hex');
  const selectedInputs = Object.freeze(finalized.inputs.map(input => Object.freeze({
    inputIndex: input.inputIndex,
    relativeValue: input.relativeValue,
    selectedSigners: Object.freeze([...input.selectedSigners]),
    finalScriptWitnessHex: input.finalScriptWitnessHex
  })));

  const checks = Object.freeze({
    canonicalPsbtMaps: decoded.canonicalMaps === true,
    frozenPsbtInputsAndOutputs: decoded.txModifiable === 0,
    exactRescueOutputBound: finalized.semantics.omegaVaultOutputBound === true,
    exactFeeBound: finalized.feeSats === String(expectedFeeSats),
    csvDelaySatisfied: selectedInputs.every(input => input.relativeValue >= boundDescriptor.csvBlocks),
    thresholdSignersBound: selectedInputs.every(input =>
      input.selectedSigners.length === boundDescriptor.threshold &&
      input.selectedSigners.every(key => boundDescriptor.contactKeys.includes(key))
    ),
    reducedSemanticsPreserved: finalized.semantics.immutableRescueOnChain === false
  });
  const ok = Object.values(checks).every(Boolean);

  const core = Object.freeze({
    schema: 'omegavault.bitcoin-finalizer-execution-evidence.v1',
    chainId: 'bitcoin',
    networkRef: 'bitcoin:signet',
    evidenceLevel: 'offline-finalizer-execution',
    descriptor: boundDescriptor,
    psbtSha256: digestBytes(psbtBytes),
    execution: Object.freeze({
      txid: finalized.txid,
      wtxid: finalized.wtxid,
      rawTransactionHex: finalized.rawTransactionHex,
      rawTransactionSha256: digestBytes(rawBytes),
      strippedSize: finalized.strippedSize,
      totalSize: finalized.totalSize,
      weight: finalized.weight,
      vsize: finalized.vsize,
      feeSats: finalized.feeSats,
      feeRateSatVb: finalized.feeRateSatVb,
      rescueScriptPubKey: finalized.rescueScriptPubKey,
      inputs: selectedInputs
    }),
    checks,
    status: ok ? 'verified-offline' : 'rejected',
    semantics: Object.freeze({
      omegaVaultOutputBound: finalized.semantics.omegaVaultOutputBound,
      immutableRescueOnChain: finalized.semantics.immutableRescueOnChain,
      publicNetworkProof: false,
      broadcastObserved: false,
      note: finalized.semantics.note
    }),
    authorityBoundary: 'This record proves deterministic offline finalizer execution against the supplied signed PSBT. It does not prove Signet broadcast, confirmations, live funds recovery, covenant enforcement, connector promotion, wallet authority or deployment authority.'
  });

  return Object.freeze({
    ok,
    checks,
    evidence: Object.freeze({ ...core, sha256: digest(core) })
  });
}

export function verifyBitcoinRecoveryFinalizerEvidence({
  evidence,
  psbt,
  descriptor,
  rescueScriptPubKey,
  expectedFeeSats
}) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['Bitcoin finalizer evidence is required.']), recomputedSha256: null });
  }
  const { sha256, ...unsigned } = evidence;
  if (!/^[0-9a-f]{64}$/i.test(sha256 ?? '') || digest(unsigned) !== String(sha256).toLowerCase()) {
    errors.push('Bitcoin finalizer evidence self-digest mismatch.');
  }

  let recomputed;
  try {
    recomputed = createBitcoinRecoveryFinalizerEvidence({ psbt, descriptor, rescueScriptPubKey, expectedFeeSats });
  } catch (error) {
    errors.push(`Bitcoin finalizer execution could not be reproduced: ${error.message}`);
    return Object.freeze({ valid: false, errors: Object.freeze(errors), recomputedSha256: null });
  }

  if (recomputed.evidence.sha256 !== sha256) {
    errors.push('Bitcoin finalizer evidence does not match reproduced execution.');
  }
  return Object.freeze({
    valid: errors.length === 0 && recomputed.ok,
    errors: Object.freeze(errors),
    recomputedSha256: recomputed.evidence.sha256
  });
}
