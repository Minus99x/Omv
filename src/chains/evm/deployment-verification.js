import { createHash } from 'node:crypto';

function strip0x(value) {
  return String(value ?? '').replace(/^0x/i, '').toLowerCase();
}

function assertHex(value, label) {
  const body = strip0x(value);
  if (!body || body.length % 2 || !/^[a-f0-9]+$/.test(body)) throw new TypeError(`${label} must be even-length hex.`);
  return body;
}

export function maskImmutableReferences(bytecode, immutableReferences = {}) {
  const chars = [...assertHex(bytecode, 'runtime bytecode')];
  for (const refs of Object.values(immutableReferences ?? {})) {
    for (const ref of refs ?? []) {
      const start = Number(ref.start) * 2;
      const length = Number(ref.length) * 2;
      if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0 || start + length > chars.length) {
        throw new TypeError('Immutable reference is outside runtime bytecode bounds.');
      }
      for (let i = start; i < start + length; i++) chars[i] = '0';
    }
  }
  return chars.join('');
}

export function runtimeCodeMatches(compiled, live, immutableReferences = {}) {
  return maskImmutableReferences(compiled, immutableReferences) === maskImmutableReferences(live, immutableReferences);
}

// Reject absent, malformed, and zero-address role evidence instead of
// treating two missing/malformed values as a successful configuration match.
function normalizeAddress(value) {
  if (typeof value !== 'string' || !/^(?:0x|xdc)[0-9a-f]{40}$/i.test(value)) return null;
  const address = `0x${value.replace(/^(?:0x|xdc)/i, '').toLowerCase()}`;
  return address === '0x' + '0'.repeat(40) ? null : address;
}

function validPositiveInteger(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0;
  return typeof value === 'string' && /^[1-9][0-9]*$/.test(value) &&
    Number.isSafeInteger(Number(value));
}

function normalizeContactSet(contacts) {
  if (!Array.isArray(contacts) || contacts.length === 0) return null;
  const addresses = contacts.map(normalizeAddress);
  if (addresses.some(address => address === null) || new Set(addresses).size !== addresses.length) return null;
  return new Set(addresses);
}

function addressesMatch(expected, observed) {
  const address = normalizeAddress(expected);
  return address !== null && address === normalizeAddress(observed);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

export function createDeploymentVerificationReport({
  network,
  compiledRuntimeBytecode,
  liveRuntimeBytecode,
  immutableReferences = {},
  expected,
  observed,
  sourceSha256,
  observedAt
}) {
  if (!network?.id || !network?.chainIdHex) throw new TypeError('Deployment verification requires an EVM network profile.');
  if (!expected || !observed || !observedAt) throw new TypeError('Deployment verification requires expected/observed configuration and observedAt.');
  const expectedContacts = normalizeContactSet(expected.trustedContacts);
  const observedContacts = normalizeContactSet(observed.trustedContacts);
  const checks = Object.freeze({
    chainIdMatched: String(observed.chainIdHex ?? '').toLowerCase() === String(network.chainIdHex).toLowerCase(),
    runtimeCodeMatched: runtimeCodeMatches(compiledRuntimeBytecode, liveRuntimeBytecode, immutableReferences),
    ownerMatched: addressesMatch(expected.owner, observed.owner),
    destinationMatched: addressesMatch(expected.rescueDestination, observed.rescueDestination),
    thresholdMatched: validPositiveInteger(expected.threshold) && validPositiveInteger(observed.threshold) &&
      Number(observed.threshold) === Number(expected.threshold) &&
      expectedContacts !== null && Number(expected.threshold) <= expectedContacts.size,
    inactivityMatched: validPositiveInteger(expected.inactivitySeconds) && validPositiveInteger(observed.inactivitySeconds) &&
      Number(observed.inactivitySeconds) === Number(expected.inactivitySeconds),
    adapterVersionMatched: validPositiveInteger(expected.adapterVersion) && validPositiveInteger(observed.adapterVersion) &&
      Number(observed.adapterVersion) === Number(expected.adapterVersion),
    trustedContactsMatched: expectedContacts !== null && observedContacts !== null &&
      expectedContacts.size === observedContacts.size &&
      [...expectedContacts].every(contact => observedContacts.has(contact))
  });
  const body = {
    version: 1,
    chainId: network.chainId,
    networkRef: network.id,
    observedAt,
    sourceSha256: sourceSha256 ?? null,
    checks,
    expected: structuredClone(expected),
    observed: structuredClone(observed)
  };
  const sha256 = createHash('sha256').update(JSON.stringify(stable(body))).digest('hex');
  return Object.freeze({ ...body, verified: Object.values(checks).every(Boolean), sha256 });
}
