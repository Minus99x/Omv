import { createHash, timingSafeEqual } from 'node:crypto';
import { runtimeCodeMatches } from '../evm/deployment-verification.js';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map([...BASE58].map((value, index) => [value, index]));
const REQUIRED_ABI = Object.freeze([
  'ADAPTER_VERSION', 'owner', 'rescueDestination', 'inactivityPeriod', 'threshold',
  'lastHeartbeat', 'recoveryEpoch', 'approvalCount', 'recovered', 'getTrustedContacts',
  'heartbeat', 'ownerWithdraw', 'approveRecovery', 'executeRecovery', 'recoverTRC20'
]);

function sha256(value) {
  return createHash('sha256').update(value).digest();
}

function strip0x(value) {
  return String(value ?? '').replace(/^0x/i, '');
}

function assertHex(value, label, { allowEmpty = false } = {}) {
  const body = strip0x(value).toLowerCase();
  if ((!allowEmpty && !body) || body.length % 2 || !/^[a-f0-9]*$/.test(body)) throw new TypeError(`${label} must be even-length hex.`);
  return body;
}

function decodeBase58(value) {
  if (typeof value !== 'string' || !value.length) throw new TypeError('TRON address must be base58check text.');
  let number = 0n;
  for (const char of value) {
    const digit = BASE58_INDEX.get(char);
    if (digit == null) throw new TypeError('TRON address contains a non-base58 character.');
    number = number * 58n + BigInt(digit);
  }
  let body = number === 0n ? Buffer.alloc(0) : Buffer.from(number.toString(16).padStart(Math.ceil(number.toString(16).length / 2) * 2, '0'), 'hex');
  const leadingZeroes = value.match(/^1*/)[0].length;
  if (leadingZeroes) body = Buffer.concat([Buffer.alloc(leadingZeroes), body]);
  return body;
}

export function decodeTronAddress(address) {
  if (typeof address === 'string' && /^(?:0x)?41[a-f0-9]{40}$/i.test(address)) return Buffer.from(strip0x(address), 'hex');
  const decoded = decodeBase58(address);
  if (decoded.length !== 25) throw new TypeError('TRON base58check address must decode to 25 bytes.');
  const payload = decoded.subarray(0, 21);
  const checksum = decoded.subarray(21);
  const expected = sha256(sha256(payload)).subarray(0, 4);
  if (!timingSafeEqual(checksum, expected)) throw new TypeError('TRON address checksum is invalid.');
  if (payload[0] !== 0x41) throw new TypeError('TRON address must use the current 0x41 network prefix.');
  return payload;
}

export function normalizeTronAddress(address) {
  return decodeTronAddress(address).toString('hex');
}

function assertBase58Address(address, label) {
  if (typeof address !== 'string' || !address.startsWith('T')) throw new TypeError(`${label} must be a base58check TRON address.`);
  decodeTronAddress(address);
}

function assertFeeLimit(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('feeLimitSun must be a positive safe integer obtained from current Energy estimation.');
}

export function createTvmDeploymentPlan({ ownerAddress, contractName, abi, bytecode, constructorParameterHex = '', feeLimitSun, consumeUserResourcePercent = 100, originEnergyLimit }) {
  assertBase58Address(ownerAddress, 'ownerAddress');
  if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(contractName ?? '')) throw new TypeError('contractName is invalid.');
  if (!Array.isArray(abi) || !abi.length) throw new TypeError('abi must be a non-empty array.');
  assertFeeLimit(feeLimitSun);
  if (!Number.isInteger(consumeUserResourcePercent) || consumeUserResourcePercent < 0 || consumeUserResourcePercent > 100) throw new TypeError('consumeUserResourcePercent must be 0-100.');
  if (!Number.isSafeInteger(originEnergyLimit) || originEnergyLimit <= 0) throw new TypeError('originEnergyLimit must be a positive safe integer.');
  return Object.freeze({
    networkRef: 'tron:shasta',
    endpoint: 'wallet/deploycontract',
    body: Object.freeze({
      visible: true,
      owner_address: ownerAddress,
      name: contractName,
      abi: structuredClone(abi),
      bytecode: assertHex(bytecode, 'bytecode'),
      parameter: assertHex(constructorParameterHex, 'constructorParameterHex', { allowEmpty: true }),
      fee_limit: feeLimitSun,
      consume_user_resource_percent: consumeUserResourcePercent,
      origin_energy_limit: originEnergyLimit,
      call_value: 0
    }),
    prerequisites: Object.freeze(['estimate deployment Energy from current node state', 'query current chain parameters', 'derive fee_limit with a documented bounded margin', 'sign outside OmegaVault']),
    signingRequired: true
  });
}

export function createTvmCallPlan({ ownerAddress, contractAddress, functionSelector, parameterHex = '', feeLimitSun, callValueSun = 0 }) {
  assertBase58Address(ownerAddress, 'ownerAddress');
  assertBase58Address(contractAddress, 'contractAddress');
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*\([^)]*\)$/.test(functionSelector ?? '')) throw new TypeError('functionSelector must be a canonical ABI signature.');
  assertFeeLimit(feeLimitSun);
  if (!Number.isSafeInteger(callValueSun) || callValueSun < 0) throw new TypeError('callValueSun must be a non-negative safe integer.');
  return Object.freeze({
    networkRef: 'tron:shasta', endpoint: 'wallet/triggersmartcontract',
    body: Object.freeze({ visible: true, owner_address: ownerAddress, contract_address: contractAddress, function_selector: functionSelector, parameter: assertHex(parameterHex, 'parameterHex', { allowEmpty: true }), fee_limit: feeLimitSun, call_value: callValueSun }),
    preflightEndpoint: 'wallet/triggerconstantcontract',
    signingRequired: true
  });
}

function normalizedSet(addresses) {
  return new Set((addresses ?? []).map(normalizeTronAddress));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

export function createTvmDeploymentVerificationReport({
  compiledRuntimeBytecode, liveRuntimeBytecode, immutableReferences = {}, compilerArtifact,
  expected, observed, sourceSha256, observedAt
}) {
  if (!expected || !observed || !observedAt) throw new TypeError('TRON deployment verification requires expected/observed configuration and observedAt.');
  const expectedContacts = normalizedSet(expected.trustedContacts);
  const observedContacts = normalizedSet(observed.trustedContacts);
  const abiFunctions = new Set(observed.abiFunctions ?? []);
  const compiledHex = assertHex(compiledRuntimeBytecode, 'compiledRuntimeBytecode');
  const liveHex = assertHex(liveRuntimeBytecode, 'liveRuntimeBytecode');
  const checks = Object.freeze({
    networkMatched: observed.networkRef === 'tron:shasta',
    contractAddressValid: (() => { try { normalizeTronAddress(observed.contractAddress); return true; } catch { return false; } })(),
    runtimeCodeMatched: runtimeCodeMatches(compiledHex, liveHex, immutableReferences),
    compilerPinned: compilerArtifact?.distribution === 'tronprotocol/solidity' && compilerArtifact?.version === '0.8.31' && compilerArtifact?.optimizer?.enabled === true && compilerArtifact?.optimizer?.runs === 200,
    ownerMatched: normalizeTronAddress(observed.owner) === normalizeTronAddress(expected.owner),
    destinationMatched: normalizeTronAddress(observed.rescueDestination) === normalizeTronAddress(expected.rescueDestination),
    thresholdMatched: Number(observed.threshold) === Number(expected.threshold),
    inactivityMatched: Number(observed.inactivitySeconds) === Number(expected.inactivitySeconds),
    adapterVersionMatched: Number(observed.adapterVersion) === 603,
    trustedContactsMatched: expectedContacts.size === observedContacts.size && [...expectedContacts].every(contact => observedContacts.has(contact)),
    requiredAbiPresent: REQUIRED_ABI.every(name => abiFunctions.has(name))
  });
  const body = {
    version: 1, chainId: 'tron', networkRef: 'tron:shasta', observedAt,
    sourceSha256: sourceSha256 ?? null,
    runtimeSha256: createHash('sha256').update(Buffer.from(liveHex, 'hex')).digest('hex'),
    compilerArtifact: structuredClone(compilerArtifact ?? null), checks,
    expected: structuredClone(expected), observed: structuredClone(observed)
  };
  const sha256 = createHash('sha256').update(JSON.stringify(stable(body))).digest('hex');
  return Object.freeze({ ...body, verified: Object.values(checks).every(Boolean), sha256 });
}

export const TRON_TVM_REQUIRED_ABI = REQUIRED_ABI;
