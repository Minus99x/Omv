const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ACCOUNT_ID_VERSION = 6 << 3;
const ACCOUNT_ID_BYTES = 32;
const ACCOUNT_STRKEY_BYTES = 1 + ACCOUNT_ID_BYTES + 2;
const ACCOUNT_STRKEY_LENGTH = 56;

function base32DecodeNoPadding(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('=')) return null;
  let buffer = 0;
  let bits = 0;
  const output = [];
  for (const char of value) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) return null;
    buffer = (buffer << 5) | index;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && buffer !== 0) return null;
  return Uint8Array.from(output);
}

function base32EncodeNoPadding(bytes) {
  let buffer = 0;
  let bits = 0;
  let output = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(buffer >> bits) & 31];
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

function crc16Xmodem(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc;
}

export function isValidStellarEd25519PublicKey(value) {
  if (typeof value !== 'string' || value.length !== ACCOUNT_STRKEY_LENGTH || value[0] !== 'G') return false;
  if (value !== value.toUpperCase()) return false;
  const decoded = base32DecodeNoPadding(value);
  if (!decoded || decoded.length !== ACCOUNT_STRKEY_BYTES) return false;
  if (decoded[0] !== ACCOUNT_ID_VERSION) return false;
  const payload = decoded.slice(0, 1 + ACCOUNT_ID_BYTES);
  const expected = crc16Xmodem(payload);
  const observed = decoded[decoded.length - 2] | (decoded[decoded.length - 1] << 8);
  if (observed !== expected) return false;
  return base32EncodeNoPadding(decoded) === value;
}
