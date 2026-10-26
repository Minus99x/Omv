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
    rawTransactionHex:transaction.rawHex,
    strippedTransactionHex:transaction.strippedHex,
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

function readCompactSize(buffer, offset) {
  if (offset >= buffer.length) throw new Error('Final transaction contains a truncated CompactSize value.');
  const prefix = buffer[offset];
  if (prefix < 0xfd) return { value:prefix, offset:offset + 1 };
  if (prefix === 0xfd) {
    if (offset + 3 > buffer.length) throw new Error('Final transaction contains a truncated CompactSize value.');
    const value = buffer.readUInt16LE(offset + 1);
    if (value < 0xfd) throw new Error('Final transaction contains a non-canonical CompactSize value.');
    return { value, offset:offset + 3 };
  }
  if (prefix === 0xfe) {
    if (offset + 5 > buffer.length) throw new Error('Final transaction contains a truncated CompactSize value.');
    const value = buffer.readUInt32LE(offset + 1);
    if (value <= 0xffff) throw new Error('Final transaction contains a non-canonical CompactSize value.');
    return { value, offset:offset + 5 };
  }
  if (offset + 9 > buffer.length) throw new Error('Final transaction contains a truncated CompactSize value.');
  const value = buffer.readBigUInt64LE(offset + 1);
  if (value <= 0xffffffffn || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Final transaction contains an invalid CompactSize value.');
  }
  return { value:Number(value), offset:offset + 9 };
}

function readWitnessStack(raw, offset) {
  const count = readCompactSize(raw, offset);
  offset = count.offset;
  const items = [];
  for (let index = 0; index < count.value; index += 1) {
    const length = readCompactSize(raw, offset);
    offset = length.offset;
    if (offset + length.value > raw.length) throw new Error('Final transaction contains a truncated witness item.');
    items.push(raw.subarray(offset, offset + length.value));
    offset += length.value;
  }
  return { items, offset };
}

function expectedStrippedTransaction(finalizerEvidence) {
  const inputs = finalizerEvidence.inputs;
  const outputs = finalizerEvidence.outputs;
  if (!Array.isArray(inputs) || !inputs.length || !Array.isArray(outputs) || !outputs.length ||
      !Number.isInteger(finalizerEvidence.txVersion) || !Number.isInteger(finalizerEvidence.fallbackLocktime)) {
    throw new Error('Finalizer evidence is missing the transaction body fields.');
  }
  const version = Buffer.alloc(4);
  version.writeInt32LE(finalizerEvidence.txVersion);
  const locktime = Buffer.alloc(4);
  locktime.writeUInt32LE(finalizerEvidence.fallbackLocktime);
  return Buffer.concat([
    version,
    encodeCompactSize(inputs.length),
    ...inputs.map(serializeInput),
    encodeCompactSize(outputs.length),
    ...outputs.map(serializeOutput),
    locktime
  ]);
}

/**
 * Verify that a final-transaction receipt's identifiers and witness bytes
 * reproduce from its serialized transaction and verified PSBT finalizer.
 */
export function assertBitcoinFinalTransactionEvidenceBinding({ evidence, finalizerEvidence }) {
  const rawHex = evidence?.rawTransactionHex;
  const strippedHex = evidence?.strippedTransactionHex;
  if (typeof rawHex !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(rawHex) ||
      typeof strippedHex !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(strippedHex)) {
    throw new TypeError('Final transaction evidence must preserve canonical raw and stripped transaction bytes.');
  }
  const raw = Buffer.from(rawHex, 'hex');
  const stripped = Buffer.from(strippedHex, 'hex');
  const expectedStripped = expectedStrippedTransaction(finalizerEvidence);
  if (!stripped.equals(expectedStripped) || transactionId(stripped) !== evidence.txid) {
    throw new Error('Final transaction id does not match the finalized PSBT body.');
  }
  if (raw.length < 10 || raw[4] !== 0 || raw[5] !== 1) {
    throw new Error('Final transaction raw bytes are not the expected SegWit transaction.');
  }
  if (createHash('sha256').update(raw).digest('hex') !== evidence.rawTransactionSha256 ||
      transactionId(raw) !== evidence.wtxid ||
      raw.length !== evidence.bytes || stripped.length !== evidence.strippedBytes) {
    throw new Error('Final transaction identifiers or sizes do not match the preserved transaction bytes.');
  }

  let offset = 6;
  const inputCount = readCompactSize(raw, offset);
  offset = inputCount.offset;
  if (inputCount.value !== finalizerEvidence.inputs.length) {
    throw new Error('Final transaction input count differs from the approved PSBT.');
  }
  for (let index = 0; index < inputCount.value; index += 1) {
    if (offset + 36 > raw.length) throw new Error('Final transaction contains a truncated input.');
    offset += 36;
    const scriptLength = readCompactSize(raw, offset);
    offset = scriptLength.offset;
    if (scriptLength.value !== 0 || offset + 4 > raw.length) {
      throw new Error('Final transaction input scriptSig is unsupported or truncated.');
    }
    offset += 4;
  }
  const outputCount = readCompactSize(raw, offset);
  offset = outputCount.offset;
  if (outputCount.value !== finalizerEvidence.outputs.length) {
    throw new Error('Final transaction output count differs from the approved PSBT.');
  }
  for (let index = 0; index < outputCount.value; index += 1) {
    if (offset + 8 > raw.length) throw new Error('Final transaction contains a truncated output.');
    offset += 8;
    const scriptLength = readCompactSize(raw, offset);
    offset = scriptLength.offset;
    if (offset + scriptLength.value > raw.length) throw new Error('Final transaction contains a truncated output script.');
    offset += scriptLength.value;
  }
  const witnessOffset = offset;
  const witnesses = [];
  for (let index = 0; index < inputCount.value; index += 1) {
    const witness = readWitnessStack(raw, offset);
    witnesses.push(witness.items);
    offset = witness.offset;
  }
  if (offset + 4 !== raw.length) throw new Error('Final transaction contains trailing or missing bytes.');
  const rawStripped = Buffer.concat([raw.subarray(0, 4), raw.subarray(6, witnessOffset), raw.subarray(offset)]);
  if (!rawStripped.equals(stripped)) {
    throw new Error('Final transaction raw bytes do not contain the approved PSBT body.');
  }
  if (!Array.isArray(evidence.inputWitnesses) ||
      evidence.inputWitnesses.length !== finalizerEvidence.inputs.length) {
    throw new Error('Final transaction witness evidence does not match the approved PSBT inputs.');
  }
  for (let index = 0; index < witnesses.length; index += 1) {
    const approved = finalizerEvidence.inputs[index];
    const witnessEvidence = evidence.inputWitnesses[index];
    const selected = approved.validSignatures?.slice(0, approved.threshold) ?? [];
    const items = witnesses[index];
    if (items.length !== selected.length + 3 || items[0].length !== 0 ||
        items[selected.length + 1].length !== 0 ||
        createHash('sha256').update(items.at(-1)).digest('hex') !== approved.witnessScriptSha256 ||
        !isDeepStrictEqual(witnessEvidence.selectedSigners, selected.map(signature => signature.publicKey)) ||
        !isDeepStrictEqual(
          witnessEvidence.stackItemSha256,
          items.map(item => createHash('sha256').update(item).digest('hex'))
        )) {
      throw new Error(`Final transaction input ${index} witness does not match the approved PSBT signer evidence.`);
    }
    for (let signatureIndex = 0; signatureIndex < selected.length; signatureIndex += 1) {
      if (createHash('sha256').update(items[signatureIndex + 1]).digest('hex') !== selected[signatureIndex].sha256) {
        throw new Error(`Final transaction input ${index} signature does not match the approved PSBT signer evidence.`);
      }
    }
  }
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
