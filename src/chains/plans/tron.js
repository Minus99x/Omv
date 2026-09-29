function assertAddress(address, label) {
  if (typeof address !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw new TypeError(`${label} is not a valid TRON base58 address.`);
}

export function createTronPermissionPlan({ owner, contacts, threshold, permissionName = 'OmegaVault Recovery' }) {
  assertAddress(owner, 'owner');
  if (!Array.isArray(contacts) || contacts.length < 1 || contacts.length > 5) throw new TypeError('TRON permission keys must contain 1-5 contacts.');
  contacts.forEach(contact => assertAddress(contact, 'contact'));
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > contacts.length) throw new TypeError('TRON threshold must be reachable.');
  return Object.freeze({
    chainId: 'tron', networkRef: 'tron:shasta', operation: 'AccountPermissionUpdateContract', owner,
    ownerPermission: Object.freeze({ permissionName, threshold, keys: Object.freeze(contacts.map(address => Object.freeze({ address, weight: 1 }))) }),
    securitySemantics: Object.freeze({ thresholdOnChain: true, inactivityOnChain: false, immutableRescueOnChain: false }),
    blockers: Object.freeze(['Native permission multisig does not enforce inactivity.', 'Permission update must preserve a recoverable configuration; misconfiguration can lock the account.']),
    alternativeExactSemantics: 'TVM OmegaVault vault contract with threshold + inactivity + immutable rescue, tested independently for TRX/TRC-20 and Energy/Bandwidth.'
  });
}
