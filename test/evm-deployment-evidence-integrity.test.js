import test from 'node:test';
import assert from 'node:assert/strict';
import { getNetwork } from '../src/chains/network-registry.js';
import { createDeploymentVerificationReport, maskImmutableReferences, runtimeCodeMatches } from '../src/chains/evm/deployment-verification.js';

const network = getNetwork('xdc:apothem');
const A = n => '0x' + n.toString(16).padStart(40, '0');
const valid = Object.freeze({
  owner: A(1),
  rescueDestination: A(2),
  threshold: 2,
  inactivitySeconds: 60,
  adapterVersion: 501,
  trustedContacts: [A(3), A(4)]
});
function verify(expected = valid, observed = { ...expected, chainIdHex: network.chainIdHex }) {
  return createDeploymentVerificationReport({
    network, compiledRuntimeBytecode: '0x6000',
    liveRuntimeBytecode: '0x6000', expected, observed,
    observedAt: '2026-10-14T00:00:00Z'
  });
}

test('XDC deployment role proof still accepts complete, equivalent 0x and xdc-form policies', () => {
  const reported = verify(valid, {
    ...valid, chainIdHex: network.chainIdHex,
    owner: 'xdc' + valid.owner.slice(2).toUpperCase(),
    trustedContacts: ['xdc' + valid.trustedContacts[1].slice(2), valid.trustedContacts[0]]
  });
  assert.equal(reported.verified, true);
  assert.equal(reported.checks.trustedContactsMatched, true);
  assert.match(reported.sha256, /^[0-9a-f]{64}$/);
});

test('deployment role proof cannot verify matching missing owner or rescue destinations', () => {
  for (const key of ['owner', 'rescueDestination']) {
    const expected = { ...valid };
    delete expected[key];
    const reported = verify(expected);
    assert.equal(reported.verified, false, key);
    assert.equal(reported.checks[key === 'owner' ? 'ownerMatched' : 'destinationMatched'], false);
  }
});

test('deployment role proof rejects identical malformed and zero-valued role addresses', () => {
  for (const address of ['', 'not-an-address', null, '0x' + '0'.repeat(40), '0x1']) {
    for (const key of ['owner', 'rescueDestination']) {
      const expected = { ...valid, [key]: address };
      const reported = verify(expected);
      assert.equal(reported.verified, false, key + ':' + String(address));
    }
  }
});

test('guardian evidence requires non-empty, unique, valid matching contact sets', () => {
  for (const contacts of [[], null, [A(3), A(3)], [A(3), 'bad'], ['0x' + '0'.repeat(40), A(4)]]) {
    const expected = { ...valid, trustedContacts: contacts };
    const reported = verify(expected);
    assert.equal(reported.verified, false, String(contacts));
    assert.equal(reported.checks.trustedContactsMatched, false);
  }
  const omitted = { ...valid };
  delete omitted.trustedContacts;
  assert.equal(verify(omitted).verified, false);
  assert.equal(verify(valid, { ...valid, chainIdHex: network.chainIdHex, trustedContacts: [A(3), A(3)] }).verified, false);
});

test('threshold and timing metadata reject zero, fractional, unsafe and coerced values', () => {
  const invalid = [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, null, '1e0', '1.0'];
  for (const field of ['threshold', 'inactivitySeconds', 'adapterVersion']) {
    for (const value of invalid) {
      const expected = { ...valid, [field]: value };
      const reported = verify(expected);
      assert.equal(reported.verified, false, field + ':' + String(value));
      const check = field === 'threshold' ? 'thresholdMatched'
        : field === 'inactivitySeconds' ? 'inactivityMatched' : 'adapterVersionMatched';
      assert.equal(reported.checks[check], false);
    }
  }
  const unreachable = { ...valid, threshold: 3 };
  assert.equal(verify(unreachable).checks.thresholdMatched, false);
});

test('evidence does not promote a mismatched chain or destination', () => {
  assert.equal(verify(valid, { ...valid, chainIdHex: '0x32' }).verified, false);
  assert.equal(verify(valid, { ...valid, chainIdHex: network.chainIdHex, rescueDestination: A(9) }).verified, false);
});

test('immutable reference offsets must be whole bytes, bounded and nonempty', () => {
  // Fractional offsets used to mask a single mismatching nibble.
  assert.equal(runtimeCodeMatches('0x6000', '0x6f00'), false);
  assert.throws(() => runtimeCodeMatches('0x6000', '0x6f00', {
    slot: [{ start: 0.5, length: 0.5 }]
  }), TypeError);
  for (const slot of [
    { start: 0, length: 0 },
    { start: 0, length: 0.5 },
    { start: 0.5, length: 1 },
    { start: '1', length: 1 },
    { start: 1, length: '1' },
    { start: 2, length: 1 },
    { start: -1, length: 1 },
    { start: 0, length: Number.MAX_SAFE_INTEGER + 1 },
    null
  ]) {
    assert.throws(() => maskImmutableReferences('0x6000', { slot: [slot] }), TypeError);
  }
  assert.equal(runtimeCodeMatches('0x6000', '0x60ff', {
    slot: [{ start: 1, length: 1 }]
  }), true);
  assert.equal(runtimeCodeMatches('0x6000', '0x60ff', {
    slot: [{ start: 0, length: 1 }]
  }), false);
});
