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

function normalizeAddress(value) {
  return typeof value === 'string' ? value.toLowerCase() : value;
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
  const contactSet = new Set((observed.trustedContacts ?? []).map(normalizeAddress));
  const checks = Object.freeze({
    chainIdMatched: String(observed.chainIdHex ?? '').toLowerCase() === String(network.chainIdHex).toLowerCase(),
    runtimeCodeMatched: runtimeCodeMatches(compiledRuntimeBytecode, liveRuntimeBytecode, immutableReferences),
    ownerMatched: normalizeAddress(observed.owner) === normalizeAddress(expected.owner),
    destinationMatched: normalizeAddress(observed.rescueDestination) === normalizeAddress(expected.rescueDestination),
    thresholdMatched: Number(observed.threshold) === Number(expected.threshold),
    inactivityMatched: Number(observed.inactivitySeconds) === Number(expected.inactivitySeconds),
    adapterVersionMatched: Number(observed.adapterVersion) === Number(expected.adapterVersion),
    trustedContactsMatched: (expected.trustedContacts ?? []).every(contact => contactSet.has(normalizeAddress(contact))) && contactSet.size === (expected.trustedContacts ?? []).length
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
