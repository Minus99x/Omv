export const ADAPTER_STAGES = Object.freeze(['live-proof', 'scaffold', 'planned']);

export const CAPABILITIES = Object.freeze([
  'account-connect',
  'balance-read',
  'message-sign',
  'recovery-policy-test',
  'mechanism-create',
  'mechanism-verify',
  'heartbeat',
  'recovery-approve',
  'recovery-execute',
  'explorer-link'
]);

const capabilitySet = new Set(CAPABILITIES);

export function defineAdapter(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('Adapter spec is required.');
  const requiredStrings = ['id', 'family', 'name', 'accountModel', 'transactionModel', 'signingModel', 'recoveryMechanism', 'implementationStage'];
  for (const key of requiredStrings) {
    if (!spec[key] || typeof spec[key] !== 'string') throw new TypeError(`Adapter ${key} is required.`);
  }
  if (!ADAPTER_STAGES.includes(spec.implementationStage)) throw new TypeError('Unknown adapter implementation stage.');
  if (typeof spec.validateAccount !== 'function') throw new TypeError('Adapter validateAccount(account) is required.');
  if (!Array.isArray(spec.capabilities)) throw new TypeError('Adapter capabilities must be an array.');
  const duplicates = spec.capabilities.filter((v, i, arr) => arr.indexOf(v) !== i);
  if (duplicates.length) throw new TypeError(`Duplicate adapter capabilities: ${duplicates.join(', ')}`);
  const unknown = spec.capabilities.filter(cap => !capabilitySet.has(cap));
  if (unknown.length) throw new TypeError(`Unknown adapter capabilities: ${unknown.join(', ')}`);

  const frozen = {
    ...spec,
    capabilities: Object.freeze([...spec.capabilities]),
    proofNetworks: Object.freeze([...(spec.proofNetworks ?? [])]),
    securityNotes: Object.freeze([...(spec.securityNotes ?? [])])
  };
  return Object.freeze(frozen);
}

export function publicAdapterInfo(adapter) {
  const { validateAccount, ...publicInfo } = adapter;
  return structuredClone(publicInfo);
}
