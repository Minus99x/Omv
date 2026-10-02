import { createHash } from 'node:crypto';
import { getNetwork } from '../network-registry.js';

const EVM_ADDRESS = /^[0-9a-f]{40}$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function normalizeEvmFamilyAddress(value, label = 'address') {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string.`);
  let body = value.trim().toLowerCase();
  if (body.startsWith('xdc')) body = body.slice(3);
  else if (body.startsWith('0x')) body = body.slice(2);
  if (!EVM_ADDRESS.test(body)) throw new TypeError(`${label} must be a 20-byte EVM-family address.`);
  return `0x${body}`;
}

function normalizeContacts(values = []) {
  if (!Array.isArray(values) || values.length < 1) throw new TypeError('trustedContacts must be a non-empty array.');
  const normalized = values.map((value, index) => normalizeEvmFamilyAddress(value, `trustedContacts[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new Error('trustedContacts must be distinct.');
  return normalized.sort();
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new TypeError(`${label} must be a positive integer.`);
  return number;
}

function commonContext({ network, deploymentVerification, contractAddress }) {
  if (deploymentVerification?.verified !== true) throw new Error('A verified EVM deployment report is required before proof binding.');
  if (deploymentVerification.networkRef !== network.id || deploymentVerification.chainId !== network.chainId) {
    throw new Error('Deployment verification belongs to a different EVM network.');
  }
  if (deploymentVerification.checks?.chainIdMatched !== true) throw new Error('Deployment verification did not prove the expected chain ID.');
  if (typeof deploymentVerification.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(deploymentVerification.sha256)) {
    throw new TypeError('Deployment verification requires a SHA-256 evidence digest.');
  }

  const expected = deploymentVerification.expected ?? {};
  const observedAddress = deploymentVerification.observed?.contractAddress;
  const canonicalContract = normalizeEvmFamilyAddress(contractAddress, 'contractAddress');
  if (observedAddress && normalizeEvmFamilyAddress(observedAddress, 'observed.contractAddress') !== canonicalContract) {
    throw new Error('Proof contract address does not match the verified deployment address.');
  }

  const contacts = normalizeContacts(expected.trustedContacts);
  const threshold = positiveInteger(expected.threshold, 'threshold');
  if (threshold > contacts.length) throw new Error('threshold cannot exceed trustedContacts length.');

  const core = Object.freeze({
    schema: 'omegavault.evm-proof-context.v1',
    chainId: network.chainId,
    networkRef: network.id,
    chainIdHex: String(network.chainIdHex).toLowerCase(),
    deploymentVerificationSha256: deploymentVerification.sha256.toLowerCase(),
    contractAddress: canonicalContract,
    owner: normalizeEvmFamilyAddress(expected.owner, 'expected.owner'),
    rescueDestination: normalizeEvmFamilyAddress(expected.rescueDestination, 'expected.rescueDestination'),
    threshold,
    inactivitySeconds: positiveInteger(expected.inactivitySeconds, 'inactivitySeconds'),
    adapterVersion: positiveInteger(expected.adapterVersion, 'adapterVersion'),
    trustedContacts: Object.freeze(contacts)
  });
  return Object.freeze({ ...core, contextSha256: digest(core) });
}

export function createEvmProofBinding({
  networkId,
  deploymentVerification,
  contractAddress,
  kind,
  tokenAddress = null
}) {
  const network = getNetwork(networkId);
  if (!network || network.rpcProtocol !== 'evm-json-rpc') throw new TypeError('EVM proof binding requires a registered EVM JSON-RPC network.');
  if (!['native-recovery', 'erc20-recovery'].includes(kind)) throw new TypeError('Unsupported EVM proof-binding kind.');

  const context = commonContext({ network, deploymentVerification, contractAddress });
  const specific = {
    schema: 'omegavault.evm-proof-binding.v1',
    kind,
    contextSha256: context.contextSha256,
    networkRef: context.networkRef,
    chainId: context.chainId,
    deploymentVerificationSha256: context.deploymentVerificationSha256,
    contractAddress: context.contractAddress,
    rescueDestination: context.rescueDestination,
    tokenAddress: kind === 'erc20-recovery' ? normalizeEvmFamilyAddress(tokenAddress, 'tokenAddress') : null
  };
  return Object.freeze({ ...specific, sha256: digest(specific), context });
}

export function evmProofMatchesBinding(proof, binding, { networkId, deploymentVerification, kind }) {
  const network = getNetwork(networkId);
  if (!network || !proof || !binding || deploymentVerification?.verified !== true) return false;
  if (binding.kind !== kind || proof.bindingSha256 !== binding.sha256) return false;
  if (binding.networkRef !== network.id || binding.chainId !== network.chainId) return false;
  if (binding.deploymentVerificationSha256 !== deploymentVerification.sha256) return false;
  if (proof.networkRef !== network.id || proof.chainId !== network.chainId) return false;
  return true;
}
