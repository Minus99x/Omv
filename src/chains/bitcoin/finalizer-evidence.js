import { requireCanonicalBitcoinRecoveryDescriptor } from './descriptor.js';
import { createHash } from 'node:crypto';
import { decodePsbtV2, verifyPsbtV2RecoveryThreshold } from './psbt-v2.js';
import { validateBitcoinCsvRecoveryInput } from './recovery-policy.js';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function hex(value, label) {
  if (typeof value !== 'string' || !value || value.length % 2 || !/^[0-9a-f]+$/i.test(value)) {
    throw new TypeError(`${label} must be non-empty even-length hex.`);
  }
  return value.toLowerCase();
}

function validateDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') throw new TypeError('Bitcoin recovery descriptor is required.');
  if (descriptor.network !== 'signet') throw new TypeError('Bitcoin finalizer evidence is currently restricted to Signet.');
  if (!Array.isArray(descriptor.contactKeys) || !descriptor.contactKeys.length) throw new TypeError('Descriptor contact keys are required.');
  if (!Number.isInteger(descriptor.threshold) || descriptor.threshold < 1 || descriptor.threshold > descriptor.contactKeys.length) {
    throw new TypeError('Descriptor threshold must be reachable.');
  }
  if (!Number.isInteger(descriptor.csvBlocks) || descriptor.csvBlocks < 1 || descriptor.csvBlocks > 0xffff) {
    throw new TypeError('Descriptor csvBlocks must be 1-65535.');
  }
  hex(descriptor.witnessScriptHex, 'descriptor.witnessScriptHex');
  hex(descriptor.scriptPubKeyHex, 'descriptor.scriptPubKeyHex');
}

export function createBitcoinFinalizerEvidence({
  psbt,
  descriptor,
  rescueScriptPubKey,
  strictSingleRescueOutput = true
}) {
  validateDescriptor(descriptor);
  descriptor = requireCanonicalBitcoinRecoveryDescriptor(descriptor);
  if (typeof strictSingleRescueOutput !== 'boolean') throw new TypeError('strictSingleRescueOutput must be boolean.');
  const rescue = hex(rescueScriptPubKey, 'rescueScriptPubKey');
  const decoded = decodePsbtV2(psbt);
  if (!decoded.canonicalMaps) throw new Error('Bitcoin finalizer evidence requires canonical PSBT maps.');
  if (decoded.txModifiable !== 0) throw new Error('Bitcoin finalizer evidence requires frozen PSBTv2 inputs and outputs.');

  const inputEvidence = decoded.inputs.map((input, inputIndex) => {
    if (input.witnessScript !== descriptor.witnessScriptHex) {
      throw new Error(`Bitcoin recovery input ${inputIndex} witnessScript does not match the configured descriptor.`);
    }
    if (input.scriptPubKey !== descriptor.scriptPubKeyHex) {
      throw new Error(`Bitcoin recovery input ${inputIndex} scriptPubKey does not match the configured descriptor.`);
    }
    const csv = validateBitcoinCsvRecoveryInput({
      txVersion:decoded.txVersion,
      sequence:input.sequence,
      csvBlocks:descriptor.csvBlocks
    });
    if (!csv.ok) throw new Error(`Bitcoin recovery input ${inputIndex} does not satisfy the configured CSV policy.`);

    const allowed = descriptor.contactKeys.map(key => String(key).toLowerCase());
    const unexpected = input.partialSignatures.filter(signature => !allowed.includes(signature.publicKey));
    if (unexpected.length) throw new Error(`Bitcoin recovery input ${inputIndex} contains an unexpected recovery signer.`);

    const threshold = verifyPsbtV2RecoveryThreshold({
      psbt:decoded,
      inputIndex,
      requiredPublicKeys:allowed,
      threshold:descriptor.threshold
    });
    if (!threshold.thresholdReached) {
      throw new Error(`Bitcoin recovery input ${inputIndex} has ${threshold.validCount} valid signature(s); ${descriptor.threshold} required.`);
    }
    return Object.freeze({
      inputIndex,
      txid:input.txid,
      vout:input.vout,
      amountSats:input.amountSats,
      sequence:input.sequence,
      csvBlocks:descriptor.csvBlocks,
      validSignerCount:threshold.validCount,
      threshold:descriptor.threshold,
      thresholdReached:true,
      validSigners:Object.freeze([...threshold.validSigners])
    });
  });

  const rescueOutputs = decoded.outputs.filter(output => output.scriptPubKey === rescue);
  if (rescueOutputs.length !== 1) throw new Error('Bitcoin finalizer evidence requires exactly one configured rescue output.');
  if (strictSingleRescueOutput && decoded.outputs.length !== 1) {
    throw new Error('Bitcoin finalizer evidence forbids additional outputs in strict rescue mode.');
  }

  const inputTotal = decoded.inputs.reduce((sum, input) => sum + BigInt(input.amountSats), 0n);
  const outputTotal = decoded.outputs.reduce((sum, output) => sum + BigInt(output.amountSats), 0n);
  const maxMoneySats = 21_000_000n * 100_000_000n;
  if (inputTotal > maxMoneySats || outputTotal > maxMoneySats) {
    throw new Error('Bitcoin recovery evidence aggregate value exceeds MAX_MONEY.');
  }
  if (outputTotal >= inputTotal) throw new Error('Bitcoin recovery evidence requires a positive miner fee.');

  const core = Object.freeze({
    schema:'omegavault.bitcoin.finalizer-evidence.v1',
    chainId:'bitcoin',
    networkRef:'bitcoin:signet',
    descriptorPolicyDigest:descriptor.policyDigest,
    psbtSha256:createHash('sha256').update(Buffer.from(decoded.base64, 'base64')).digest('hex'),
    txVersion:decoded.txVersion,
    fallbackLocktime:decoded.fallbackLocktime,
    txModifiable:decoded.txModifiable,
    canonicalMaps:decoded.canonicalMaps,
    inputs:Object.freeze(inputEvidence),
    outputs:Object.freeze(decoded.outputs.map(output => Object.freeze({ ...output }))),
    rescueScriptPubKey:rescue,
    rescueAmountSats:rescueOutputs[0].amountSats,
    inputTotalSats:inputTotal.toString(),
    outputTotalSats:outputTotal.toString(),
    feeSats:(inputTotal - outputTotal).toString(),
    destinationCheckedByFinalizer:true,
    immutableRescueOnChain:false,
    broadcastAuthorized:false,
    signetExecutionProven:false,
    authorityBoundary:'This evidence validates an offline, frozen, threshold-signed Bitcoin Signet recovery PSBT. It does not finalize or broadcast a transaction, create an on-chain rescue covenant, prove Signet inclusion, or grant wallet/deployment/chain-promotion authority.'
  });
  return Object.freeze({ ...core, sha256:digest(core) });
}

export function verifyBitcoinFinalizerEvidence({
  evidence,
  psbt,
  descriptor,
  rescueScriptPubKey,
  strictSingleRescueOutput = true
}) {
  const errors = [];
  let expected;
  try {
    expected = createBitcoinFinalizerEvidence({
      psbt,
      descriptor,
      rescueScriptPubKey,
      strictSingleRescueOutput
    });
  } catch (error) {
    return Object.freeze({ ok:false, errors:Object.freeze([String(error?.message || error)]) });
  }
  if (JSON.stringify(evidence) !== JSON.stringify(expected)) errors.push('Bitcoin finalizer evidence does not match the supplied PSBT and policy.');
  return Object.freeze({ ok:errors.length === 0, errors:Object.freeze(errors) });
}

