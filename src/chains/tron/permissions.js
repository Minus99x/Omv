const MAX_KEYS = 5;
const MAX_ACTIVE_PERMISSIONS = 8;
const OPERATIONS_BYTES = 32;

function assertAddress(address, label) {
  if (typeof address !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw new TypeError(`${label} is not a valid TRON base58 address.`);
}

export function encodeOperationsBitmap(operationIds) {
  if (!Array.isArray(operationIds) || !operationIds.length) throw new TypeError('operationIds must be a non-empty array.');
  const bytes = new Uint8Array(OPERATIONS_BYTES);
  for (const id of operationIds) {
    if (!Number.isInteger(id) || id < 0 || id >= OPERATIONS_BYTES * 8) throw new TypeError(`Invalid TRON contract type id: ${id}`);
    bytes[Math.floor(id / 8)] |= 1 << (id % 8);
  }
  return Buffer.from(bytes).toString('hex');
}

export function decodeOperationsBitmap(hex) {
  if (typeof hex !== 'string' || !/^[a-f0-9]{64}$/i.test(hex)) throw new TypeError('TRON operations bitmap must be 32 bytes hex.');
  const bytes = Buffer.from(hex, 'hex');
  const ids = [];
  for (let id = 0; id < bytes.length * 8; id++) if (bytes[Math.floor(id / 8)] & (1 << (id % 8))) ids.push(id);
  return Object.freeze(ids);
}

export function validatePermission(permission, { owner = false } = {}) {
  const errors = [];
  if (!permission || typeof permission !== 'object') return Object.freeze({ ok: false, errors: Object.freeze(['Permission object is required.']) });
  const keys = Array.isArray(permission.keys) ? permission.keys : [];
  if (!keys.length || keys.length > MAX_KEYS) errors.push(`Permission must contain 1-${MAX_KEYS} keys.`);
  if (!Number.isInteger(permission.threshold) || permission.threshold <= 0) errors.push('Permission threshold must be a positive integer.');
  const seen = new Set();
  let totalWeight = 0;
  for (const key of keys) {
    try { assertAddress(key.address, 'permission key'); } catch (error) { errors.push(error.message); }
    if (!Number.isInteger(key.weight) || key.weight <= 0) errors.push('Permission key weight must be a positive integer.');
    totalWeight += Number.isInteger(key.weight) ? key.weight : 0;
    if (seen.has(key.address)) errors.push(`Duplicate permission key: ${key.address}`);
    seen.add(key.address);
  }
  if (Number.isInteger(permission.threshold) && totalWeight < permission.threshold) errors.push('Permission threshold is unreachable by configured key weights.');
  if (!owner) {
    if (typeof permission.operations !== 'string' || !/^[a-f0-9]{64}$/i.test(permission.operations)) errors.push('Active permission requires a 32-byte operations bitmap.');
    if (permission.parent_id != null && permission.parent_id !== 0) errors.push('Active permission parent_id must be 0.');
  }
  return Object.freeze({ ok: errors.length === 0, totalWeight, errors: Object.freeze(errors) });
}

export function validatePermissionConfiguration({ ownerPermission, activePermissions, requirePermissionUpdateEscapeHatch = true }) {
  const errors = [];
  const owner = validatePermission(ownerPermission, { owner: true });
  if (!owner.ok) errors.push(...owner.errors.map(x => `owner: ${x}`));
  if (!Array.isArray(activePermissions) || activePermissions.length < 1 || activePermissions.length > MAX_ACTIVE_PERMISSIONS) {
    errors.push(`TRON requires 1-${MAX_ACTIVE_PERMISSIONS} active permissions.`);
  }
  const activeResults = (activePermissions ?? []).map((permission, index) => {
    const result = validatePermission(permission, { owner: false });
    if (!result.ok) errors.push(...result.errors.map(x => `active[${index}]: ${x}`));
    return result;
  });
  if (requirePermissionUpdateEscapeHatch) {
    const ownerReachable = owner.ok;
    const activeCanUpdate = (activePermissions ?? []).some((permission, index) => {
      if (!activeResults[index]?.ok) return false;
      try { return decodeOperationsBitmap(permission.operations).includes(46); } catch { return false; }
    });
    if (!ownerReachable && !activeCanUpdate) errors.push('No reachable permission can authorize AccountPermissionUpdateContract (ID 46); configuration could become unrecoverable.');
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), ownerWeight: owner.totalWeight ?? 0 });
}

export function createThresholdPermission({ permissionName, contacts, threshold, allowedOperationIds }) {
  if (!Array.isArray(contacts) || contacts.length < 1 || contacts.length > MAX_KEYS) throw new TypeError(`TRON permission contacts must contain 1-${MAX_KEYS} addresses.`);
  contacts.forEach(address => assertAddress(address, 'contact'));
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > contacts.length) throw new TypeError('TRON threshold must be reachable.');
  const operations = encodeOperationsBitmap(allowedOperationIds);
  return Object.freeze({
    type: 2,
    permission_name: String(permissionName ?? 'OmegaVault Recovery').slice(0, 32),
    threshold,
    parent_id: 0,
    operations,
    keys: Object.freeze(contacts.map(address => Object.freeze({ address, weight: 1 })))
  });
}

export function createMultisignCoordinator({ permission, transactionId, existingSigners = [] }) {
  const validation = validatePermission(permission, { owner: permission?.type === 0 });
  if (!validation.ok) throw new TypeError(`Invalid permission: ${validation.errors.join(' ')}`);
  if (!transactionId) throw new TypeError('transactionId is required.');
  const keys = new Map(permission.keys.map(key => [key.address, key.weight]));
  const signatures = new Set();
  let weight = 0;
  for (const signer of existingSigners) {
    if (!keys.has(signer)) throw new Error(`Unknown signer ${signer} would invalidate the TRON multisign transaction.`);
    if (signatures.has(signer)) throw new Error(`Duplicate signer ${signer} would invalidate the TRON multisign transaction.`);
    signatures.add(signer);
    weight += keys.get(signer);
  }
  return Object.freeze({
    transactionId,
    threshold: permission.threshold,
    currentWeight: weight,
    ready: weight >= permission.threshold,
    signers: Object.freeze([...signatures]),
    remainingWeight: Math.max(0, permission.threshold - weight),
    rule: 'Only configured permission keys may sign, and duplicate/unknown signatures must be rejected before broadcast.'
  });
}

export function createDynamicFeeQueryPlan() {
  return Object.freeze({
    chainParametersEndpoint: 'wallet/getchainparameters',
    requiredKeys: Object.freeze(['getUpdateAccountPermissionFee', 'getMultiSignFee', 'getEnergyFee']),
    energyEstimation: Object.freeze(['wallet/triggerconstantcontract or estimateenergy before contract call', 'apply dynamic-energy factor when relevant', 'set fee_limit from current estimate plus bounded safety margin']),
    hardcodeFees: false
  });
}
