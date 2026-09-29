import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';

const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/i;
const INPUT_CHARSET = "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const POLYMOD_GENERATORS = [0xf5dee51989n, 0xa9fdca3312n, 0x1bab10e32dn, 0x3706b1677an, 0x644d626ffdn];

function sha256(value) {
  return createHash('sha256').update(value).digest();
}

function assertCompressedKey(key, label) {
  if (typeof key !== 'string' || !COMPRESSED_KEY.test(key)) throw new TypeError(`${label} must be a compressed secp256k1 public key.`);
  const normalized = key.toLowerCase();
  try { secp256k1.Point.fromBytes(Buffer.from(normalized, 'hex')).assertValidity(); } catch { throw new TypeError(`${label} is not a valid secp256k1 point.`); }
  return normalized;
}

function descriptorPolyMod(checksum, value) {
  const top = checksum >> 35n;
  let next = ((checksum & 0x7ffffffffn) << 5n) ^ BigInt(value);
  for (let i = 0; i < 5; i++) if ((top >> BigInt(i)) & 1n) next ^= POLYMOD_GENERATORS[i];
  return next;
}

export function descriptorChecksum(descriptor) {
  if (typeof descriptor !== 'string' || !descriptor || descriptor.includes('#')) throw new TypeError('Descriptor checksum input must be an unchecked descriptor.');
  let checksum = 1n;
  let group = 0;
  let groupCount = 0;
  for (const char of descriptor) {
    const position = INPUT_CHARSET.indexOf(char);
    if (position === -1) throw new TypeError(`Descriptor contains an unsupported character: ${char}`);
    checksum = descriptorPolyMod(checksum, position & 31);
    group = group * 3 + (position >> 5);
    if (++groupCount === 3) {
      checksum = descriptorPolyMod(checksum, group);
      group = 0;
      groupCount = 0;
    }
  }
  if (groupCount > 0) checksum = descriptorPolyMod(checksum, group);
  for (let i = 0; i < 8; i++) checksum = descriptorPolyMod(checksum, 0);
  checksum ^= 1n;
  let result = '';
  for (let i = 0; i < 8; i++) result += CHECKSUM_CHARSET[Number((checksum >> BigInt(5 * (7 - i))) & 31n)];
  return result;
}

function encodeScriptNumber(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) throw new TypeError('Script number must be a non-negative int32.');
  if (value === 0) return Buffer.alloc(0);
  const bytes = [];
  let remaining = value;
  while (remaining > 0) {
    bytes.push(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  if (bytes[bytes.length - 1] & 0x80) bytes.push(0);
  return Buffer.from(bytes);
}

function pushData(data) {
  if (!Buffer.isBuffer(data)) data = Buffer.from(data);
  if (data.length <= 75) return Buffer.concat([Buffer.from([data.length]), data]);
  if (data.length <= 0xff) return Buffer.concat([Buffer.from([0x4c, data.length]), data]);
  throw new TypeError('OmegaVault descriptor compiler only supports pushes up to 255 bytes.');
}

function pushNumber(value) {
  if (value === 0) return Buffer.from([0x00]);
  if (value >= 1 && value <= 16) return Buffer.from([0x50 + value]);
  return pushData(encodeScriptNumber(value));
}

function bech32Polymod(values) {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) checksum ^= [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3][i];
    checksum >>>= 0;
  }
  return checksum >>> 0;
}

function bech32Expand(hrp) {
  return [...hrp].map(char => char.charCodeAt(0) >> 5).concat([0], [...hrp].map(char => char.charCodeAt(0) & 31));
}

function convertBits(data, fromBits, toBits) {
  let accumulator = 0;
  let bits = 0;
  const result = [];
  const mask = (1 << toBits) - 1;
  for (const value of data) {
    accumulator = (accumulator << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >> bits) & mask);
    }
  }
  if (bits > 0) result.push((accumulator << (toBits - bits)) & mask);
  return result;
}

function encodeSegwitV0Address(program, network) {
  const hrp = network === 'mainnet' ? 'bc' : 'tb';
  const words = [0, ...convertBits(program, 8, 5)];
  const values = [...bech32Expand(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const polymod = bech32Polymod(values) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (polymod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map(value => BECH32_CHARSET[value]).join('')}`;
}

export function createBitcoinRecoveryDescriptor({ ownerKey, contactKeys, threshold, csvBlocks, network = 'signet' }) {
  const owner = assertCompressedKey(ownerKey, 'ownerKey');
  if (!Array.isArray(contactKeys) || contactKeys.length < 1 || contactKeys.length > 15) throw new TypeError('contactKeys must contain 1-15 compressed public keys.');
  const contacts = contactKeys.map((key, index) => assertCompressedKey(key, `contactKeys[${index}]`)).sort();
  if (new Set(contacts).size !== contacts.length) throw new TypeError('contactKeys must be unique.');
  if (contacts.includes(owner)) throw new TypeError('ownerKey cannot also be a recovery contact key.');
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > contacts.length) throw new TypeError('threshold must be reachable.');
  if (!Number.isInteger(csvBlocks) || csvBlocks < 1 || csvBlocks > 0xffff) throw new TypeError('csvBlocks must be 1-65535.');
  if (!['mainnet', 'testnet', 'signet', 'regtest'].includes(network)) throw new TypeError('Unsupported Bitcoin network.');

  const miniscript = `or_d(pk(${owner}),and_v(v:older(${csvBlocks}),multi(${threshold},${contacts.join(',')})))`;
  const descriptor = `wsh(${miniscript})`;
  const checkedDescriptor = `${descriptor}#${descriptorChecksum(descriptor)}`;
  const parts = [
    pushData(Buffer.from(owner, 'hex')), Buffer.from([0xac, 0x73, 0x64]),
    pushNumber(csvBlocks), Buffer.from([0xb2, 0x69]),
    pushNumber(threshold), ...contacts.map(key => pushData(Buffer.from(key, 'hex'))),
    pushNumber(contacts.length), Buffer.from([0xae, 0x68])
  ];
  const witnessScript = Buffer.concat(parts);
  if (witnessScript.length > 3600) throw new Error('Witness script exceeds OmegaVault policy size bound.');
  const scriptHash = sha256(witnessScript);
  const scriptPubKey = Buffer.concat([Buffer.from([0x00, 0x20]), scriptHash]);
  const policyDigest = sha256(Buffer.from(JSON.stringify({ owner, contacts, threshold, csvBlocks }))).toString('hex');
  return Object.freeze({
    network, ownerKey: owner, contactKeys: Object.freeze(contacts), threshold, csvBlocks,
    miniscript, descriptor, checkedDescriptor, checksum: checkedDescriptor.slice(-8),
    witnessScriptHex: witnessScript.toString('hex'), scriptPubKeyHex: scriptPubKey.toString('hex'),
    address: encodeSegwitV0Address(scriptHash, network), policyDigest,
    semantics: Object.freeze({ ownerPath: 'immediate', recoveryPath: `${threshold}-of-${contacts.length} after ${csvBlocks} blocks`, immutableRescueOutput: false })
  });
}
