import crypto from 'node:crypto';
import { getChain } from '../chains/registry.js';

export const VaultStatus = Object.freeze({
  ACTIVE: 'active',
  RECOVERY_PENDING: 'recovery_pending',
  RECOVERY_READY: 'recovery_ready',
  RECOVERED: 'recovered'
});

const CHAIN_OPS = new Set(['deployment', 'deposit', 'test.contact.funded', 'heartbeat', 'recovery.approved', 'recovery.executed', 'state.refresh']);
const SEPOLIA_CHAIN_REF = '0xaa36a7';

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function canonicalAccount(chainId, account) {
  const value = clean(account);
  return chainId === 'ethereum' && typeof value === 'string' ? value.toLowerCase() : value;
}

function ethereumTxRef(value) {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function sha256Ref(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function validatePolicy(input) {
  const errors = [];
  const chain = getChain(input?.chainId);
  if (!chain) errors.push('Unsupported chainId.');

  const owner = canonicalAccount(input?.chainId, input?.owner);
  const rescueDestination = canonicalAccount(input?.chainId, input?.rescueDestination);
  const contacts = Array.isArray(input?.trustedContacts)
    ? [...new Set(input.trustedContacts.map(v => canonicalAccount(input?.chainId, v)).filter(Boolean))]
    : [];

  if (chain && !chain.validateAccount(owner)) errors.push('Owner account is invalid for the selected chain.');
  if (chain && !chain.validateAccount(rescueDestination)) errors.push('Rescue destination is invalid for the selected chain.');
  if (!contacts.length) errors.push('At least one trusted contact is required.');
  if (contacts.length > 255) errors.push('OmegaVault Core currently supports at most 255 trusted contacts per policy.');
  if (chain && contacts.some(account => !chain.validateAccount(account))) errors.push('One or more trusted contacts are invalid for the selected chain.');
  if (contacts.includes(owner)) errors.push('Owner cannot also be a trusted contact.');
  if (contacts.includes(rescueDestination)) errors.push('Rescue destination cannot also be a trusted contact.');
  if (owner && owner === rescueDestination) errors.push('Owner and rescue destination must be different accounts.');

  const threshold = Number(input?.threshold);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > contacts.length) {
    errors.push('Threshold must be an integer between 1 and the number of trusted contacts.');
  }

  const inactivityDays = Number(input?.inactivityDays);
  if (!Number.isInteger(inactivityDays) || inactivityDays < 1 || inactivityDays > 3650) {
    errors.push('Inactivity period must be between 1 and 3650 days.');
  }

  return {
    ok: errors.length === 0,
    errors,
    value: errors.length ? null : {
      chainId: input.chainId,
      owner,
      rescueDestination,
      trustedContacts: contacts,
      threshold,
      inactivityDays
    }
  };
}

export function createVault(input, now = new Date()) {
  const result = validatePolicy(input);
  if (!result.ok) {
    const error = new Error(result.errors.join(' '));
    error.code = 'INVALID_POLICY';
    error.details = result.errors;
    throw error;
  }

  const createdAt = now.toISOString();
  return {
    id: crypto.randomUUID(),
    version: 3,
    ...result.value,
    status: VaultStatus.ACTIVE,
    createdAt,
    lastHeartbeatAt: createdAt,
    recovery: null,
    chainBindings: {},
    chainActivity: [],
    audit: [{ at: createdAt, event: 'vault.created' }]
  };
}

export function inactivityEligible(vault, now = new Date()) {
  const last = new Date(vault.lastHeartbeatAt).getTime();
  const elapsed = now.getTime() - last;
  return elapsed >= vault.inactivityDays * 86_400_000;
}

export function policyState(vault, now = new Date()) {
  const lastMs = new Date(vault.lastHeartbeatAt).getTime();
  const eligibleMs = lastMs + vault.inactivityDays * 86_400_000;
  const remainingMs = Math.max(0, eligibleMs - now.getTime());
  const approvals = vault.recovery?.approvals?.length ?? 0;
  let stage = 'protected';
  if (vault.status === VaultStatus.RECOVERED) stage = 'recovered';
  else if (vault.status === VaultStatus.RECOVERY_READY) stage = 'recovery_ready';
  else if (vault.status === VaultStatus.RECOVERY_PENDING) stage = 'awaiting_approvals';
  else if (remainingMs === 0) stage = 'inactive_eligible';

  return {
    stage,
    eligible: remainingMs === 0,
    eligibleAt: new Date(eligibleMs).toISOString(),
    remainingMs,
    approvals,
    threshold: vault.threshold
  };
}

export function heartbeat(vault, owner, now = new Date()) {
  const normalized = canonicalAccount(vault.chainId, owner);
  if (normalized !== vault.owner) throw new Error('Only the owner can send a heartbeat.');
  if (vault.status === VaultStatus.RECOVERED) throw new Error('Recovered vault cannot be heartbeated.');

  const at = now.toISOString();
  const cancelledApprovals = vault.recovery?.approvals?.length ?? 0;
  vault.lastHeartbeatAt = at;
  vault.status = VaultStatus.ACTIVE;
  vault.recovery = null;
  vault.audit.push({ at, event: 'vault.heartbeat', actor: normalized, cancelledApprovals });
  return vault;
}

export function requestRecovery(vault, requester, destination, now = new Date(), options = {}) {
  const normalizedRequester = canonicalAccount(vault.chainId, requester);
  const normalizedDestination = canonicalAccount(vault.chainId, destination);
  if (!vault.trustedContacts.includes(normalizedRequester)) throw new Error('Requester is not a trusted contact.');
  if (normalizedDestination !== vault.rescueDestination) throw new Error('Recovery destination does not match the configured rescue destination.');
  if (!options.bypassInactivityForTest && !inactivityEligible(vault, now)) {
    throw new Error('Inactivity period has not elapsed.');
  }
  if (vault.status === VaultStatus.RECOVERED) throw new Error('Vault is already recovered.');

  const at = now.toISOString();
  if (!vault.recovery || vault.status === VaultStatus.ACTIVE) {
    vault.recovery = {
      requestedAt: at,
      requestedBy: normalizedRequester,
      destination: normalizedDestination,
      approvals: []
    };
    vault.audit.push({ at, event: 'recovery.requested', actor: normalizedRequester });
  }
  vault.status = VaultStatus.RECOVERY_PENDING;
  return approveRecovery(vault, normalizedRequester, now);
}

export function approveRecovery(vault, contact, now = new Date()) {
  const normalized = canonicalAccount(vault.chainId, contact);
  if (!vault.recovery) throw new Error('No recovery is pending.');
  if (!vault.trustedContacts.includes(normalized)) throw new Error('Approver is not a trusted contact.');
  if (vault.status === VaultStatus.RECOVERED) throw new Error('Vault is already recovered.');

  const at = now.toISOString();
  if (vault.recovery.approvals.includes(normalized)) {
    vault.audit.push({ at, event: 'recovery.approval.duplicate_ignored', actor: normalized });
    return vault;
  }
  vault.recovery.approvals.push(normalized);
  vault.audit.push({ at, event: 'recovery.approved', actor: normalized });
  if (vault.recovery.approvals.length >= vault.threshold) vault.status = VaultStatus.RECOVERY_READY;
  return vault;
}

export function markRecovered(vault, executor, txRef, now = new Date()) {
  if (vault.status !== VaultStatus.RECOVERY_READY) throw new Error('Recovery threshold has not been met.');
  if (!txRef || typeof txRef !== 'string') throw new Error('A chain transaction reference is required.');
  const at = now.toISOString();
  vault.status = VaultStatus.RECOVERED;
  vault.recovery.executedAt = at;
  vault.recovery.executedBy = clean(executor) || 'chain-adapter';
  vault.recovery.txRef = clean(txRef);
  vault.audit.push({ at, event: 'recovery.executed', actor: vault.recovery.executedBy, txRef: vault.recovery.txRef });
  return vault;
}

export function bindChainDeployment(vault, input, now = new Date()) {
  const chainId = clean(input?.chainId);
  if (chainId !== vault.chainId) throw new Error('Chain binding must match the vault chainId.');
  const chain = getChain(chainId);
  if (!chain) throw new Error('Unsupported chain binding.');

  const contractRef = canonicalAccount(chainId, input?.contractRef);
  const networkRef = clean(input?.networkRef);
  const deploymentTxRef = clean(input?.deploymentTxRef);
  if (!chain.validateAccount(contractRef)) throw new Error('Deployed contract reference is invalid for this chain.');
  if (!networkRef || typeof networkRef !== 'string') throw new Error('A network reference is required.');
  if (chainId === 'ethereum' && !ethereumTxRef(deploymentTxRef)) throw new Error('Ethereum deployment transaction hash is invalid.');

  if (chainId === 'ethereum') {
    if (networkRef !== SEPOLIA_CHAIN_REF) throw new Error('The Ethereum proof adapter may only bind Sepolia deployments.');
    if (input?.testOnly !== true) throw new Error('The Ethereum proof adapter binding must be marked test-only.');
    if (input?.deploymentVerified !== true) throw new Error('The Ethereum proof deployment must pass runtime/config verification before binding.');
    if (!clean(input?.contractVersion)) throw new Error('A contract version is required for the Ethereum proof binding.');
    if (!clean(input?.adapterVersion)) throw new Error('An adapter version is required for the Ethereum proof binding.');
    if (!sha256Ref(input?.sourceSha256)) throw new Error('A valid contract source SHA-256 is required for the Ethereum proof binding.');
  }

  const testInactivitySeconds = input?.testInactivitySeconds == null ? null : Number(input.testInactivitySeconds);
  if (testInactivitySeconds != null && (!Number.isInteger(testInactivitySeconds) || testInactivitySeconds < 15 || testInactivitySeconds > 86_400)) {
    throw new Error('Test inactivity override must be between 15 and 86400 seconds.');
  }

  const existing = vault.chainBindings?.[chainId];
  if (existing) {
    const same = existing.contractRef === contractRef && existing.networkRef === networkRef && existing.deploymentTxRef === deploymentTxRef;
    if (same) return vault;
    throw new Error('This vault is already bound to a different deployment on this chain.');
  }

  const at = now.toISOString();
  vault.chainBindings ??= {};
  vault.chainActivity ??= [];
  vault.chainBindings[chainId] = {
    chainId,
    family: chain.family,
    networkRef,
    contractRef,
    deploymentTxRef,
    boundAt: at,
    testOnly: input?.testOnly === true,
    testInactivitySeconds,
    adapterVersion: clean(input?.adapterVersion) || null,
    contractVersion: clean(input?.contractVersion) || null,
    sourceSha256: clean(input?.sourceSha256) || null,
    deploymentVerified: input?.deploymentVerified === true,
    verification: input?.verification && typeof input.verification === 'object' ? structuredClone(input.verification) : null
  };
  vault.chainActivity.push({ at, chainId, networkRef, operation: 'deployment', actor: vault.owner, txRef: deploymentTxRef });
  vault.audit.push({ at, event: 'chain.deployment.bound', chainId, txRef: deploymentTxRef, verified: input?.deploymentVerified === true });
  return vault;
}

export function recordChainActivity(vault, input, now = new Date()) {
  const chainId = clean(input?.chainId);
  if (chainId !== vault.chainId) throw new Error('Chain activity must match the vault chainId.');
  const chain = getChain(chainId);
  const binding = vault.chainBindings?.[chainId];
  if (!binding) throw new Error('No deployed chain binding exists for this vault.');

  const operation = clean(input?.operation);
  if (!CHAIN_OPS.has(operation) || operation === 'deployment') throw new Error('Unsupported chain operation.');
  const txRef = clean(input?.txRef);
  if (chainId === 'ethereum' && operation !== 'state.refresh' && !ethereumTxRef(txRef)) throw new Error('Ethereum transaction hash is invalid.');

  const rawActor = canonicalAccount(chainId, input?.actor);
  const actor = rawActor || 'chain-adapter';
  if (rawActor && chain && !chain.validateAccount(rawActor)) throw new Error('Chain activity actor is not a valid account for this chain.');
  if (operation === 'heartbeat' && actor !== vault.owner) throw new Error('Only the configured owner may be recorded as an on-chain heartbeat actor.');
  if (operation === 'test.contact.funded' && actor !== vault.owner) throw new Error('Only the configured owner may be recorded as funding a test contact.');
  if (operation === 'recovery.approved' && !vault.trustedContacts.includes(actor)) throw new Error('Only a configured trusted contact may be recorded as a recovery approver.');

  vault.chainActivity ??= [];
  if (txRef && vault.chainActivity.some(item => item.operation === operation && item.txRef === txRef)) return vault;

  const at = now.toISOString();
  const item = {
    at,
    chainId,
    networkRef: binding.networkRef,
    operation,
    actor,
    txRef: txRef || null,
    proof: input?.proof && typeof input.proof === 'object' ? structuredClone(input.proof) : undefined
  };
  vault.chainActivity.push(item);
  vault.audit.push({ at, event: `chain.${operation}`, actor, txRef: txRef || undefined });
  return vault;
}

export function publicVault(vault, now = new Date()) {
  const copy = structuredClone(vault);
  copy.chainBindings ??= {};
  copy.chainActivity ??= [];
  copy.policyState = policyState(vault, now);
  copy.inactivityEligible = copy.policyState.eligible;
  return copy;
}
