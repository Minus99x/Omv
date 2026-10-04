import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';

const MAGIC = Buffer.from('70736274ff', 'hex');
const TXID = /^[0-9a-f]{64}$/i;
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/i;
const MAX_MONEY = 21_000_000n * 100_000_000n;

function sha256(value) { return createHash('sha256').update(value).digest(); }
function hash256(value) { return sha256(sha256(value)); }

function assertHex(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value) || value.length % 2 || !/^[0-9a-f]*$/i.test(value)) throw new TypeError(`${label} must be even-length hex.`);
  return value.toLowerCase();
}

function assertMoney(value, label) {
  if (!/^\d+$/.test(String(value))) throw new TypeError(`${label} must be a non-negative integer.`);
  const amount = BigInt(value);
  if (amount > MAX_MONEY) throw new TypeError(`${label} exceeds Bitcoin MAX_MONEY.`);
  return amount;
}

function u32le(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new TypeError('Expected uint32.');
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value >>> 0);
  return result;
}

function i32le(value) {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new TypeError('Expected int32.');
  const result = Buffer.alloc(4);
  result.writeInt32LE(value);
  return result;
}

function u64le(value) {
  const amount = BigInt(value);
  if (amount < 0n || amount > 0xffffffffffffffffn) throw new TypeError('Expected uint64.');
  const result = Buffer.alloc(8);
  result.writeBigUInt64LE(amount);
  return result;
}

export function encodeCompactSize(value) {
  const number = BigInt(value);
  if (number < 0n || number > 0xffffffffffffffffn) throw new TypeError('CompactSize value is outside uint64.');
  if (number < 0xfdn) return Buffer.from([Number(number)]);
  if (number <= 0xffffn) { const result = Buffer.alloc(3); result[0] = 0xfd; result.writeUInt16LE(Number(number), 1); return result; }
  if (number <= 0xffffffffn) { const result = Buffer.alloc(5); result[0] = 0xfe; result.writeUInt32LE(Number(number), 1); return result; }
  return Buffer.concat([Buffer.from([0xff]), u64le(number)]);
}

function readCompactSize(buffer, offset) {
  if (offset >= buffer.length) throw new Error('Unexpected end of CompactSize.');
  const prefix = buffer[offset];
  if (prefix < 0xfd) return { value: BigInt(prefix), offset: offset + 1 };
  if (prefix === 0xfd) {
    if (offset + 3 > buffer.length) throw new Error('Truncated CompactSize uint16.');
    const value = BigInt(buffer.readUInt16LE(offset + 1));
    if (value < 0xfdn) throw new Error('Non-minimal CompactSize uint16.');
    return { value, offset: offset + 3 };
  }
  if (prefix === 0xfe) {
    if (offset + 5 > buffer.length) throw new Error('Truncated CompactSize uint32.');
    const value = BigInt(buffer.readUInt32LE(offset + 1));
    if (value <= 0xffffn) throw new Error('Non-minimal CompactSize uint32.');
    return { value, offset: offset + 5 };
  }
  if (offset + 9 > buffer.length) throw new Error('Truncated CompactSize uint64.');
  const value = buffer.readBigUInt64LE(offset + 1);
  if (value <= 0xffffffffn) throw new Error('Non-minimal CompactSize uint64.');
  return { value, offset: offset + 9 };
}

function serializeMap(entries) {
  const sorted = entries.map(entry => ({ key: Buffer.from(entry.key), value: Buffer.from(entry.value) })).sort((a, b) => Buffer.compare(a.key, b.key));
  const seen = new Set();
  const pieces = [];
  for (const entry of sorted) {
    if (!entry.key.length) throw new Error('PSBT key cannot be empty.');
    const keyHex = entry.key.toString('hex');
    if (seen.has(keyHex)) throw new Error(`Duplicate PSBT key: ${keyHex}`);
    seen.add(keyHex);
    pieces.push(encodeCompactSize(entry.key.length), entry.key, encodeCompactSize(entry.value.length), entry.value);
  }
  pieces.push(Buffer.from([0x00]));
  return Buffer.concat(pieces);
}

function readMap(buffer, start) {
  let offset = start;
  const entries = [];
  const seen = new Set();
  let canonicalOrder = true;
  let previous = null;
  while (true) {
    const keyLength = readCompactSize(buffer, offset);
    offset = keyLength.offset;
    if (keyLength.value === 0n) break;
    if (keyLength.value > BigInt(buffer.length - offset)) throw new Error('Truncated PSBT key.');
    const key = buffer.subarray(offset, offset + Number(keyLength.value));
    offset += Number(keyLength.value);
    const valueLength = readCompactSize(buffer, offset);
    offset = valueLength.offset;
    if (valueLength.value > BigInt(buffer.length - offset)) throw new Error('Truncated PSBT value.');
    const value = buffer.subarray(offset, offset + Number(valueLength.value));
    offset += Number(valueLength.value);
    const keyHex = key.toString('hex');
    if (seen.has(keyHex)) throw new Error(`Duplicate PSBT key: ${keyHex}`);
    seen.add(keyHex);
    if (previous && Buffer.compare(previous, key) >= 0) canonicalOrder = false;
    previous = key;
    entries.push({ key: Buffer.from(key), value: Buffer.from(value) });
  }
  return { entries, offset, canonicalOrder };
}

function single(entries, type, { required = false } = {}) {
  const found = entries.filter(entry => entry.key.length === 1 && entry.key[0] === type);
  if (found.length > 1) throw new Error(`Duplicate PSBT field type 0x${type.toString(16)}.`);
  if (required && found.length !== 1) throw new Error(`Missing PSBT field type 0x${type.toString(16)}.`);
  return found[0]?.value ?? null;
}

function countFromValue(value, label) {
  const parsed = readCompactSize(value, 0);
  if (parsed.offset !== value.length || parsed.value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} is invalid.`);
  return Number(parsed.value);
}

function parseWitnessUtxo(value) {
  if (!value || value.length < 9) throw new Error('PSBT witness UTXO is missing or malformed.');
  const amountSats = value.readBigUInt64LE(0);
  const length = readCompactSize(value, 8);
  if (length.value > BigInt(value.length - length.offset) || length.offset + Number(length.value) !== value.length) throw new Error('PSBT witness UTXO script is malformed.');
  return { amountSats, scriptPubKey: value.subarray(length.offset) };
}

function normalizeInput(input, index) {
  if (!TXID.test(input?.txid) || !Number.isInteger(input?.vout) || input.vout < 0 || input.vout > 0xffffffff) throw new TypeError(`inputs[${index}] requires txid and uint32 vout.`);
  const sequence = input.sequence ?? 0xffffffff;
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff) throw new TypeError(`inputs[${index}].sequence must be uint32.`);
  const amountSats = assertMoney(input.amountSats, `inputs[${index}].amountSats`);
  const scriptPubKey = Buffer.from(assertHex(input.scriptPubKey, `inputs[${index}].scriptPubKey`), 'hex');
  const witnessScript = Buffer.from(assertHex(input.witnessScript, `inputs[${index}].witnessScript`), 'hex');
  const expectedP2wsh = Buffer.concat([Buffer.from([0x00, 0x20]), sha256(witnessScript)]);
  if (!scriptPubKey.equals(expectedP2wsh)) throw new Error(`inputs[${index}] witnessScript does not match its P2WSH scriptPubKey.`);
  const partialSignatures = (input.partialSignatures ?? []).map((partial, signatureIndex) => {
    if (!COMPRESSED_KEY.test(partial?.publicKey ?? '')) throw new TypeError(`inputs[${index}].partialSignatures[${signatureIndex}] has an invalid public key.`);
    try { secp256k1.Point.fromBytes(Buffer.from(partial.publicKey, 'hex')).assertValidity(); } catch { throw new TypeError(`inputs[${index}].partialSignatures[${signatureIndex}] has an invalid secp256k1 point.`); }
    const signature = Buffer.from(assertHex(partial.signature, `inputs[${index}].partialSignatures[${signatureIndex}].signature`), 'hex');
    if (signature.length < 9 || signature.at(-1) !== 0x01) throw new Error('OmegaVault accepts only DER SIGHASH_ALL partial signatures.');
    return { publicKey: partial.publicKey.toLowerCase(), signature };
  });
  return { txid: input.txid.toLowerCase(), vout: input.vout, sequence, amountSats, scriptPubKey, witnessScript, partialSignatures };
}

function normalizeOutput(output, index) {
  return { amountSats: assertMoney(output?.amountSats, `outputs[${index}].amountSats`), scriptPubKey: Buffer.from(assertHex(output?.scriptPubKey, `outputs[${index}].scriptPubKey`), 'hex') };
}

export function encodePsbtV2({ txVersion = 2, fallbackLocktime = 0, txModifiable = 0, inputs, outputs }) {
  if (!Number.isInteger(txVersion) || txVersion < 2 || txVersion > 0x7fffffff) throw new TypeError('PSBTv2 recovery transaction version must be at least 2.');
  if (!Number.isInteger(fallbackLocktime) || fallbackLocktime < 0 || fallbackLocktime > 0xffffffff) throw new TypeError('fallbackLocktime must be uint32.');
  if (!Number.isInteger(txModifiable) || txModifiable < 0 || txModifiable > 7) throw new TypeError('txModifiable must be a three-bit field.');
  if ((txModifiable & 0x03) !== 0) throw new Error('OmegaVault freezes PSBTv2 inputs and outputs before signature collection.');
  if (!Array.isArray(inputs) || !inputs.length || !Array.isArray(outputs) || !outputs.length) throw new TypeError('PSBTv2 requires at least one input and output.');
  const normalizedInputs = inputs.map(normalizeInput);
  const normalizedOutputs = outputs.map(normalizeOutput);
  const inputTotal = normalizedInputs.reduce((sum, input) => sum + input.amountSats, 0n);
  const outputTotal = normalizedOutputs.reduce((sum, output) => sum + output.amountSats, 0n);
  if (outputTotal > inputTotal) throw new Error('PSBTv2 outputs exceed input value.');

  const globalMap = serializeMap([
    { key: Buffer.from([0x02]), value: i32le(txVersion) },
    { key: Buffer.from([0x03]), value: u32le(fallbackLocktime) },
    { key: Buffer.from([0x04]), value: encodeCompactSize(normalizedInputs.length) },
    { key: Buffer.from([0x05]), value: encodeCompactSize(normalizedOutputs.length) },
    { key: Buffer.from([0x06]), value: Buffer.from([txModifiable]) },
    { key: Buffer.from([0xfb]), value: u32le(2) }
  ]);
  const inputMaps = normalizedInputs.map(input => serializeMap([
    { key: Buffer.from([0x01]), value: Buffer.concat([u64le(input.amountSats), encodeCompactSize(input.scriptPubKey.length), input.scriptPubKey]) },
    ...input.partialSignatures.map(partial => ({ key: Buffer.concat([Buffer.from([0x02]), Buffer.from(partial.publicKey, 'hex')]), value: partial.signature })),
    { key: Buffer.from([0x03]), value: u32le(1) },
    { key: Buffer.from([0x05]), value: input.witnessScript },
    { key: Buffer.from([0x0e]), value: Buffer.from(input.txid, 'hex').reverse() },
    { key: Buffer.from([0x0f]), value: u32le(input.vout) },
    { key: Buffer.from([0x10]), value: u32le(input.sequence) }
  ]));
  const outputMaps = normalizedOutputs.map(output => serializeMap([
    { key: Buffer.from([0x03]), value: u64le(output.amountSats) },
    { key: Buffer.from([0x04]), value: output.scriptPubKey }
  ]));
  return Buffer.concat([MAGIC, globalMap, ...inputMaps, ...outputMaps]);
}

function toBuffer(encoded) {
  if (Buffer.isBuffer(encoded) || encoded instanceof Uint8Array) return Buffer.from(encoded);
  if (typeof encoded !== 'string' || !encoded) throw new TypeError('PSBT must be bytes or base64.');
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new TypeError('PSBT string must be canonical base64.');
  return buffer;
}

export function decodePsbtV2(encoded) {
  const buffer = toBuffer(encoded);
  if (buffer.length < MAGIC.length || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Invalid PSBT magic bytes.');
  let offset = MAGIC.length;
  const global = readMap(buffer, offset);
  offset = global.offset;
  if (global.entries.some(entry => entry.key[0] === 0x00)) throw new Error('PSBTv2 must exclude PSBT_GLOBAL_UNSIGNED_TX.');
  const psbtVersionValue = single(global.entries, 0xfb, { required: true });
  if (psbtVersionValue.length !== 4 || psbtVersionValue.readUInt32LE(0) !== 2) throw new Error('PSBT_GLOBAL_VERSION must equal 2.');
  const txVersionValue = single(global.entries, 0x02, { required: true });
  if (txVersionValue.length !== 4 || txVersionValue.readInt32LE(0) < 2) throw new Error('Recovery transaction version must be at least 2.');
  const inputCount = countFromValue(single(global.entries, 0x04, { required: true }), 'PSBT input count');
  const outputCount = countFromValue(single(global.entries, 0x05, { required: true }), 'PSBT output count');
  const modifiable = single(global.entries, 0x06);
  if (modifiable && (modifiable.length !== 1 || (modifiable[0] & ~0x07) !== 0)) throw new Error('PSBT_GLOBAL_TX_MODIFIABLE must be a three-bit field.');
  if (modifiable && (modifiable[0] & 0x03) !== 0) throw new Error('PSBTv2 inputs and outputs must be frozen.');
  const fallback = single(global.entries, 0x03);
  if (fallback && fallback.length !== 4) throw new Error('Invalid PSBT fallback locktime.');

  const inputs = [];
  let canonicalMaps = global.canonicalOrder;
  for (let i = 0; i < inputCount; i++) {
    const parsed = readMap(buffer, offset);
    offset = parsed.offset;
    canonicalMaps &&= parsed.canonicalOrder;
    const txidBytes = single(parsed.entries, 0x0e, { required: true });
    const vout = single(parsed.entries, 0x0f, { required: true });
    if (txidBytes.length !== 32 || vout.length !== 4) throw new Error(`PSBT input ${i} has malformed outpoint fields.`);
    const sequence = single(parsed.entries, 0x10);
    const sighashType = single(parsed.entries, 0x03);
    if (sequence && sequence.length !== 4) throw new Error(`PSBT input ${i} has malformed sequence.`);
    if (sighashType && (sighashType.length !== 4 || sighashType.readUInt32LE(0) !== 1)) throw new Error(`PSBT input ${i} must use SIGHASH_ALL.`);
    const witnessUtxo = parseWitnessUtxo(single(parsed.entries, 0x01, { required: true }));
    const witnessScript = single(parsed.entries, 0x05, { required: true });
    const expectedScript = Buffer.concat([Buffer.from([0x00, 0x20]), sha256(witnessScript)]);
    if (!witnessUtxo.scriptPubKey.equals(expectedScript)) throw new Error(`PSBT input ${i} witness script does not match the witness UTXO.`);
    const partialSignatures = parsed.entries.filter(entry => entry.key[0] === 0x02).map(entry => {
      if (entry.key.length !== 34 || !COMPRESSED_KEY.test(entry.key.subarray(1).toString('hex'))) throw new Error(`PSBT input ${i} has malformed partial-signature key data.`);
      if (entry.value.length < 9 || entry.value.at(-1) !== 0x01) throw new Error(`PSBT input ${i} partial signature must use SIGHASH_ALL.`);
      return Object.freeze({ publicKey: entry.key.subarray(1).toString('hex'), signature: entry.value.toString('hex') });
    });
    inputs.push(Object.freeze({
      txid: Buffer.from(txidBytes).reverse().toString('hex'), vout: vout.readUInt32LE(0),
      sequence: sequence ? sequence.readUInt32LE(0) : 0xffffffff,
      amountSats: witnessUtxo.amountSats.toString(), scriptPubKey: witnessUtxo.scriptPubKey.toString('hex'),
      witnessScript: witnessScript.toString('hex'), partialSignatures: Object.freeze(partialSignatures)
    }));
  }
  const outputs = [];
  for (let i = 0; i < outputCount; i++) {
    const parsed = readMap(buffer, offset);
    offset = parsed.offset;
    canonicalMaps &&= parsed.canonicalOrder;
    const amount = single(parsed.entries, 0x03, { required: true });
    const script = single(parsed.entries, 0x04, { required: true });
    if (amount.length !== 8 || amount.readBigUInt64LE(0) > MAX_MONEY) throw new Error(`PSBT output ${i} has invalid amount.`);
    outputs.push(Object.freeze({ amountSats: amount.readBigUInt64LE(0).toString(), scriptPubKey: script.toString('hex') }));
  }
  if (offset !== buffer.length) throw new Error('PSBT contains trailing bytes.');
  return Object.freeze({
    psbtVersion: 2, txVersion: txVersionValue.readInt32LE(0), fallbackLocktime: fallback?.readUInt32LE(0) ?? 0,
    txModifiable: modifiable?.[0] ?? 0, canonicalMaps,
    inputs: Object.freeze(inputs), outputs: Object.freeze(outputs), base64: buffer.toString('base64'), hex: buffer.toString('hex')
  });
}

function serializeOutpoint(input) {
  return Buffer.concat([Buffer.from(input.txid, 'hex').reverse(), u32le(input.vout)]);
}

function serializeOutput(output) {
  const script = Buffer.from(output.scriptPubKey, 'hex');
  return Buffer.concat([u64le(output.amountSats), encodeCompactSize(script.length), script]);
}

export function createBitcoinWitnessV0Sighash({ psbt, inputIndex }) {
  const decoded = typeof psbt?.psbtVersion === 'number' ? psbt : decodePsbtV2(psbt);
  if (!Number.isInteger(inputIndex) || inputIndex < 0 || inputIndex >= decoded.inputs.length) throw new TypeError('inputIndex is outside the PSBT input set.');
  const input = decoded.inputs[inputIndex];
  const hashPrevouts = hash256(Buffer.concat(decoded.inputs.map(serializeOutpoint)));
  const hashSequence = hash256(Buffer.concat(decoded.inputs.map(item => u32le(item.sequence))));
  const hashOutputs = hash256(Buffer.concat(decoded.outputs.map(serializeOutput)));
  const witnessScript = Buffer.from(input.witnessScript, 'hex');
  const preimage = Buffer.concat([
    i32le(decoded.txVersion), hashPrevouts, hashSequence, serializeOutpoint(input),
    encodeCompactSize(witnessScript.length), witnessScript, u64le(input.amountSats), u32le(input.sequence),
    hashOutputs, u32le(decoded.fallbackLocktime), u32le(1)
  ]);
  return Object.freeze({ sighashType: 1, digest: hash256(preimage), preimage });
}

export function verifyPsbtV2RecoverySignature({ psbt, inputIndex, publicKey, allowedPublicKeys = null }) {
  const decoded = typeof psbt?.psbtVersion === 'number' ? psbt : decodePsbtV2(psbt);
  const normalizedKey = assertHex(publicKey, 'publicKey');
  if (!COMPRESSED_KEY.test(normalizedKey)) throw new TypeError('publicKey must be compressed secp256k1.');
  if (Array.isArray(allowedPublicKeys) && !allowedPublicKeys.map(key => String(key).toLowerCase()).includes(normalizedKey)) throw new Error('Partial signature key is not an allowed recovery contact.');
  const partial = decoded.inputs[inputIndex]?.partialSignatures.find(item => item.publicKey === normalizedKey);
  if (!partial) throw new Error('PSBT does not contain a partial signature for this key.');
  const signature = Buffer.from(partial.signature, 'hex');
  const der = signature.subarray(0, -1);
  const sighash = createBitcoinWitnessV0Sighash({ psbt: decoded, inputIndex });
  let valid = false;
  try { valid = secp256k1.verify(der, sighash.digest, Buffer.from(normalizedKey, 'hex'), { prehash: false, lowS: true, format: 'der' }); } catch { valid = false; }
  return Object.freeze({ valid, publicKey: normalizedKey, inputIndex, sighashType: 1, digest: sighash.digest.toString('hex'), canonicalMaps: decoded.canonicalMaps });
}

export function verifyPsbtV2RecoveryThreshold({ psbt, inputIndex, requiredPublicKeys, threshold }) {
  const decoded = typeof psbt?.psbtVersion === 'number' ? psbt : decodePsbtV2(psbt);
  if (!Array.isArray(requiredPublicKeys) || !requiredPublicKeys.length) throw new TypeError('requiredPublicKeys must be a non-empty array.');
  const allowed = requiredPublicKeys.map((key, index) => {
    const normalized = assertHex(key, `requiredPublicKeys[${index}]`);
    if (!COMPRESSED_KEY.test(normalized)) throw new TypeError(`requiredPublicKeys[${index}] must be compressed secp256k1.`);
    try { secp256k1.Point.fromBytes(Buffer.from(normalized, 'hex')).assertValidity(); } catch { throw new TypeError(`requiredPublicKeys[${index}] is not a valid secp256k1 point.`); }
    return normalized;
  });
  if (new Set(allowed).size !== allowed.length) throw new TypeError('requiredPublicKeys must be unique.');
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > allowed.length) throw new TypeError('threshold must be reachable.');
  if (!Number.isInteger(inputIndex) || inputIndex < 0 || inputIndex >= decoded.inputs.length) throw new TypeError('inputIndex is outside the PSBT input set.');

  const present = new Map(decoded.inputs[inputIndex].partialSignatures.map(partial => [partial.publicKey, partial]));
  const signatures = allowed.filter(publicKey => present.has(publicKey)).map(publicKey =>
    verifyPsbtV2RecoverySignature({ psbt: decoded, inputIndex, publicKey, allowedPublicKeys: allowed })
  );
  const validSigners = signatures.filter(signature => signature.valid).map(signature => signature.publicKey);
  return Object.freeze({
    inputIndex, threshold, validCount: validSigners.length, thresholdReached: validSigners.length >= threshold,
    validSigners: Object.freeze(validSigners), signatures: Object.freeze(signatures), canonicalMaps: decoded.canonicalMaps
  });
}

function serializeTransactionInput(input) {
  return Buffer.concat([
    Buffer.from(input.txid, 'hex').reverse(),
    u32le(input.vout),
    Buffer.from([0x00]),
    u32le(input.sequence)
  ]);
}

function serializeWitnessStack(items) {
  return Buffer.concat([
    encodeCompactSize(items.length),
    ...items.flatMap(item => {
      const bytes = Buffer.from(item);
      return [encodeCompactSize(bytes.length), bytes];
    })
  ]);
}

function displayHash(bytes) {
  return Buffer.from(hash256(bytes)).reverse().toString('hex');
}

function validateRecoverySequence({ txVersion, sequence, csvBlocks, inputIndex }) {
  if (txVersion < 2) throw new Error(`Bitcoin recovery input ${inputIndex} requires transaction version >= 2.`);
  if ((sequence & 0x80000000) !== 0) throw new Error(`Bitcoin recovery input ${inputIndex} disables relative locktime.`);
  if ((sequence & 0x00400000) !== 0) throw new Error(`Bitcoin recovery input ${inputIndex} uses time-based sequence; OmegaVault requires block-based CSV.`);
  const relativeValue = sequence & 0x0000ffff;
  if (relativeValue < csvBlocks) throw new Error(`Bitcoin recovery input ${inputIndex} has not encoded the required CSV delay.`);
  return relativeValue;
}

/**
 * Finalize a reduced-semantics OmegaVault Bitcoin recovery transaction.
 *
 * This is intentionally stricter than generic PSBT finalization:
 * - every input must spend the exact expected P2WSH recovery descriptor;
 * - only configured recovery-contact partial signatures may be present;
 * - the configured CSV delay must be encoded on every input;
 * - inputs/outputs must already be frozen;
 * - exactly one output is allowed and it must be the caller-confirmed rescue output;
 * - the exact fee must match the caller-confirmed fee.
 *
 * These checks protect OmegaVault's signing/finalization workflow. They do not
 * turn ordinary Bitcoin Script into a covenant: threshold key holders can still
 * construct a different valid spend outside OmegaVault after the CSV delay.
 */
export function finalizePsbtV2RecoveryTransaction({ psbt, descriptor, rescueScriptPubKey, expectedFeeSats }) {
  const decoded = typeof psbt?.psbtVersion === 'number' ? psbt : decodePsbtV2(psbt);
  if (!descriptor || typeof descriptor !== 'object') throw new TypeError('Bitcoin recovery descriptor is required.');
  if (!Array.isArray(descriptor.contactKeys) || !descriptor.contactKeys.length) throw new TypeError('Descriptor contactKeys are required.');
  if (!Number.isInteger(descriptor.threshold) || descriptor.threshold < 1 || descriptor.threshold > descriptor.contactKeys.length) throw new TypeError('Descriptor threshold is invalid.');
  if (!Number.isInteger(descriptor.csvBlocks) || descriptor.csvBlocks < 1 || descriptor.csvBlocks > 0xffff) throw new TypeError('Descriptor csvBlocks are invalid.');
  const expectedWitnessScript = assertHex(descriptor.witnessScriptHex, 'descriptor.witnessScriptHex');
  const expectedScriptPubKey = assertHex(descriptor.scriptPubKeyHex, 'descriptor.scriptPubKeyHex');
  const rescueScript = assertHex(rescueScriptPubKey, 'rescueScriptPubKey');
  const expectedFee = assertMoney(expectedFeeSats, 'expectedFeeSats');
  const contacts = descriptor.contactKeys.map((key, index) => {
    const normalized = assertHex(key, `descriptor.contactKeys[${index}]`);
    if (!COMPRESSED_KEY.test(normalized)) throw new TypeError(`descriptor.contactKeys[${index}] must be compressed secp256k1.`);
    return normalized;
  });
  if (new Set(contacts).size !== contacts.length) throw new TypeError('Descriptor contactKeys must be unique.');
  if (!decoded.canonicalMaps) throw new Error('OmegaVault finalization requires canonically ordered PSBT maps.');
  if (decoded.txModifiable !== 0) throw new Error('OmegaVault finalization requires frozen PSBTv2 inputs and outputs.');
  if (decoded.outputs.length !== 1 || decoded.outputs[0].scriptPubKey !== rescueScript) throw new Error('OmegaVault recovery finalization requires exactly one caller-confirmed rescue output.');

  const inputTotal = decoded.inputs.reduce((sum, input) => sum + BigInt(input.amountSats), 0n);
  const outputTotal = decoded.outputs.reduce((sum, output) => sum + BigInt(output.amountSats), 0n);
  const feeSats = inputTotal - outputTotal;
  if (feeSats < 0n) throw new Error('Bitcoin recovery outputs exceed inputs.');
  if (feeSats !== expectedFee) throw new Error(`Bitcoin recovery fee mismatch: expected ${expectedFee} sats, got ${feeSats} sats.`);

  const allowed = new Set(contacts);
  const finalizedInputs = decoded.inputs.map((input, inputIndex) => {
    if (input.witnessScript !== expectedWitnessScript) throw new Error(`Bitcoin recovery input ${inputIndex} witness script does not match the configured descriptor.`);
    if (input.scriptPubKey !== expectedScriptPubKey) throw new Error(`Bitcoin recovery input ${inputIndex} scriptPubKey does not match the configured descriptor.`);
    const relativeValue = validateRecoverySequence({ txVersion: decoded.txVersion, sequence: input.sequence, csvBlocks: descriptor.csvBlocks, inputIndex });
    for (const partial of input.partialSignatures) {
      if (!allowed.has(partial.publicKey)) throw new Error(`Bitcoin recovery input ${inputIndex} contains an unauthorized partial signer.`);
    }
    const threshold = verifyPsbtV2RecoveryThreshold({ psbt: decoded, inputIndex, requiredPublicKeys: contacts, threshold: descriptor.threshold });
    if (!threshold.thresholdReached) throw new Error(`Bitcoin recovery input ${inputIndex} does not meet the configured signature threshold.`);
    const validSet = new Set(threshold.validSigners);
    const selectedSigners = contacts.filter(key => validSet.has(key)).slice(0, descriptor.threshold);
    const partialByKey = new Map(input.partialSignatures.map(partial => [partial.publicKey, partial]));
    const selectedSignatures = selectedSigners.map(key => Buffer.from(partialByKey.get(key).signature, 'hex'));
    const witnessItems = [
      Buffer.alloc(0),
      ...selectedSignatures,
      Buffer.alloc(0),
      Buffer.from(expectedWitnessScript, 'hex')
    ];
    return Object.freeze({
      inputIndex,
      relativeValue,
      selectedSigners: Object.freeze(selectedSigners),
      witnessItems: Object.freeze(witnessItems.map(item => item.toString('hex'))),
      serializedWitness: serializeWitnessStack(witnessItems)
    });
  });

  const inputBytes = Buffer.concat(decoded.inputs.map(serializeTransactionInput));
  const outputBytes = Buffer.concat(decoded.outputs.map(serializeOutput));
  const version = i32le(decoded.txVersion);
  const locktime = u32le(decoded.fallbackLocktime);
  const stripped = Buffer.concat([
    version,
    encodeCompactSize(decoded.inputs.length), inputBytes,
    encodeCompactSize(decoded.outputs.length), outputBytes,
    locktime
  ]);
  const witness = Buffer.concat(finalizedInputs.map(input => input.serializedWitness));
  const raw = Buffer.concat([
    version, Buffer.from([0x00, 0x01]),
    encodeCompactSize(decoded.inputs.length), inputBytes,
    encodeCompactSize(decoded.outputs.length), outputBytes,
    witness, locktime
  ]);
  const strippedSize = stripped.length;
  const totalSize = raw.length;
  const weight = strippedSize * 4 + (totalSize - strippedSize);
  const vsize = Math.ceil(weight / 4);
  return Object.freeze({
    rawTransactionHex: raw.toString('hex'),
    txid: displayHash(stripped),
    wtxid: displayHash(raw),
    strippedSize,
    totalSize,
    weight,
    vsize,
    feeSats: feeSats.toString(),
    feeRateSatVb: Number(feeSats) / vsize,
    rescueScriptPubKey: rescueScript,
    inputs: Object.freeze(finalizedInputs.map(input => Object.freeze({
      inputIndex: input.inputIndex,
      relativeValue: input.relativeValue,
      selectedSigners: input.selectedSigners,
      witnessItems: input.witnessItems,
      finalScriptWitnessHex: input.serializedWitness.toString('hex')
    }))),
    semantics: Object.freeze({
      omegaVaultOutputBound: true,
      immutableRescueOnChain: false,
      note: 'This finalizer binds the transaction OmegaVault produces to the confirmed rescue output, but the underlying threshold script does not prevent signers from constructing another valid spend outside OmegaVault.'
    })
  });
}
