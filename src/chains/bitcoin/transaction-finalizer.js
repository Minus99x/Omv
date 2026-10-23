import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { requireCanonicalBitcoinRecoveryDescriptor } from './descriptor.js';
import { createBitcoinFinalizerEvidence } from './finalizer-evidence.js';
import { decodePsbtV2, encodeCompactSize, verifyPsbtV2RecoveryThreshold } from './psbt-v2.js';

function sha256(value) { return createHash('sha256').update(value).digest(); }
function hash256(value) { return sha256(sha256(value)); }

function u32le(value) {
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value >>> 0);
  return result;
}

function i32le(value) {
  const result = Buffer.alloc(4);
  result.writeInt32LE(value);
  return result;
}

function u64le(value) {
  const result = Buffer.alloc(8);
  result.writeBigUInt64LE(BigInt(value));
  return result;
}

function serializeOutpoint(input) {
  return Buffer.concat([Buffer.from(input.txid, 'hex').reverse(), u32le(input.vout)]);
}

function serializeInput(input) {
  return Buffer.concat([serializeOutpoint(input), Buffer.from([0x00]), u32le(input.sequence)]);
}

function serializeOutput(output) {
  const script = Buffer.from(output.scriptPubKey, 'hex');
  return Buffer.concat([u64le(output.amountSats), encodeCompactSize(script.length), script]);
}

function serializeWitness(items) {
  return Buffer.concat([
    encodeCompactSize(items.length),
    ...items.flatMap(item => [encodeCompactSize(item.length), item])
  ]);
}

function transactionId(bytes) {
  return Buffer.from(hash256(bytes)).reverse().toString('hex');
}

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


export function extractBitcoinRecoveryTransaction({
  psbt,
  descriptor,
  rescueScriptPubKey,
  strictSingleRescueOutput = true
}) {
  if (descriptor?.network !== 'signet') throw new TypeError('Bitcoin transaction extraction is Signet-only.');
  const canonicalDescriptor = requireCanonicalBitcoinRecoveryDescriptor(descriptor);
  const finalizerEvidence = createBitcoinFinalizerEvidence({
    psbt,
    descriptor:canonicalDescriptor,
    rescueScriptPubKey,
    strictSingleRescueOutput
  });
  const decoded = decodePsbtV2(psbt);
  const witnesses = decoded.inputs.map((input, inputIndex) => {
    const threshold = verifyPsbtV2RecoveryThreshold({
      psbt:decoded,
      inputIndex,
      requiredPublicKeys:canonicalDescriptor.contactKeys,
      threshold:canonicalDescriptor.threshold
    });
    if (!threshold.thresholdReached) throw new Error(`Bitcoin input ${inputIndex} has not reached the recovery threshold.`);
    const selectedSigners = threshold.validSigners.slice(0, canonicalDescriptor.threshold);
    const signatures = selectedSigners.map(publicKey => {
      const partial = input.partialSignatures.find(signature => signature.publicKey === publicKey);
      if (!partial) throw new Error(`Bitcoin input ${inputIndex} is missing the selected recovery signature.`);
      return Buffer.from(partial.signature, 'hex');
    });
    const items = [
      Buffer.alloc(0),
      ...signatures,
      Buffer.alloc(0),
      Buffer.from(input.witnessScript, 'hex')
    ];
    return Object.freeze({
      inputIndex,
      selectedSigners:Object.freeze([...selectedSigners]),
      stackItems:Object.freeze(items.map(item => item.toString('hex'))),
      serialized:serializeWitness(items)
    });
  });

  const version = i32le(decoded.txVersion);
  const inputs = Buffer.concat(decoded.inputs.map(serializeInput));
  const outputs = Buffer.concat(decoded.outputs.map(serializeOutput));
  const locktime = u32le(decoded.fallbackLocktime);
  const common = [
    encodeCompactSize(decoded.inputs.length), inputs,
    encodeCompactSize(decoded.outputs.length), outputs
  ];
  const stripped = Buffer.concat([version, ...common, locktime]);
  const raw = Buffer.concat([
    version, Buffer.from([0x00, 0x01]), ...common,
    ...witnesses.map(witness => witness.serialized), locktime
  ]);
  const weight = stripped.length * 3 + raw.length;

  return Object.freeze({
    kind:'bitcoin-signet-final-transaction',
    networkRef:'bitcoin:signet',
    rawHex:raw.toString('hex'),
    strippedHex:stripped.toString('hex'),
    txid:transactionId(stripped),
    wtxid:transactionId(raw),
    bytes:raw.length,
    strippedBytes:stripped.length,
    weight,
    virtualBytes:Math.ceil(weight / 4),
    locktime:decoded.fallbackLocktime,
    witnesses:Object.freeze(witnesses.map(witness => Object.freeze({
      inputIndex:witness.inputIndex,
      selectedSigners:witness.selectedSigners,
      stackItems:witness.stackItems
    }))),
    finalizerEvidence,
    broadcastAuthorized:false,
    signetExecutionProven:false,
    bitcoinCoreCrossCheckProven:false,
    authorityBoundary:'This artifact deterministically extracts a fully witnessed Signet recovery transaction from a frozen PSBTv2. It does not broadcast, handle private keys, prove Bitcoin Core acceptance, prove Signet inclusion, or authorize promotion.'
  });
}

export function createBitcoinFinalTransactionEvidence(options) {
  const transaction = extractBitcoinRecoveryTransaction(options);
  const core = Object.freeze({
    schema:'omegavault.bitcoin.final-transaction-evidence.v1',
    chainId:'bitcoin',
    networkRef:'bitcoin:signet',
    finalizerEvidenceSha256:transaction.finalizerEvidence.sha256,
    psbtSha256:transaction.finalizerEvidence.psbtSha256,
    descriptorPolicyDigest:transaction.finalizerEvidence.descriptorPolicyDigest,
    rawTransactionSha256:createHash('sha256').update(Buffer.from(transaction.rawHex, 'hex')).digest('hex'),
    txid:transaction.txid,
    wtxid:transaction.wtxid,
    bytes:transaction.bytes,
    strippedBytes:transaction.strippedBytes,
    weight:transaction.weight,
    virtualBytes:transaction.virtualBytes,
    inputWitnesses:Object.freeze(transaction.witnesses.map(witness => Object.freeze({
      inputIndex:witness.inputIndex,
      selectedSigners:witness.selectedSigners,
      stackItemSha256:Object.freeze(witness.stackItems.map(item => createHash('sha256').update(Buffer.from(item, 'hex')).digest('hex')))
    }))),
    rescueScriptPubKey:transaction.finalizerEvidence.rescueScriptPubKey,
    rescueAmountSats:transaction.finalizerEvidence.rescueAmountSats,
    feeSats:transaction.finalizerEvidence.feeSats,
    destinationCheckedByFinalizer:true,
    immutableRescueOnChain:false,
    broadcastAuthorized:false,
    signetExecutionProven:false,
    bitcoinCoreCrossCheckProven:false,
    authorityBoundary:'This evidence binds deterministic PSBTv2 extraction to exact witness, txid, wtxid, fee, and rescue output identities. Bitcoin Core and public Signet acceptance remain separate unsatisfied gates.'
  });
  return Object.freeze({ ...core, sha256:digest(core) });
}

export function verifyBitcoinFinalTransactionEvidence({ evidence, ...options }) {
  try {
    const expected = createBitcoinFinalTransactionEvidence(options);
    const ok = isDeepStrictEqual(evidence, expected);
    return Object.freeze({ ok, errors:Object.freeze(ok ? [] : ['Bitcoin final-transaction evidence does not match the supplied PSBT and descriptor.']) });
  } catch (error) {
    return Object.freeze({ ok:false, errors:Object.freeze([String(error?.message || error)]) });
  }
}

