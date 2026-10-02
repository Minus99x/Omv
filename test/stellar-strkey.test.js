import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidStellarEd25519PublicKey } from '../src/chains/stellar/strkey.js';

test('dependency-free Stellar StrKey validator accepts a known valid G-address', () => {
  assert.equal(isValidStellarEd25519PublicKey('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'), true);
});

test('dependency-free Stellar StrKey validator rejects checksum, case, alphabet and length mutations', () => {
  const valid = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
  assert.equal(isValidStellarEd25519PublicKey(`${valid.slice(0, -1)}A`), false);
  assert.equal(isValidStellarEd25519PublicKey(valid.toLowerCase()), false);
  assert.equal(isValidStellarEd25519PublicKey(`${valid.slice(0, 5)}0${valid.slice(6)}`), false);
  assert.equal(isValidStellarEd25519PublicKey(valid.slice(0, -1)), false);
});
