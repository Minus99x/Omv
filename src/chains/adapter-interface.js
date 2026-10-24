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
    if (typeof spec[key] !== 'string' || !spec[key].trim()) throw new TypeError(`Adapter ${key} is required.`);
  }
  if (!ADAPTER_STAGES.includes(spec.implementationStage)) throw new TypeError('Unknown adapter implementation stage.');
  if (typeof spec.validateAccount !== 'function') throw new TypeError('Adapter validateAccount(account) is required.');
  if (!Array.isArray(spec.capabilities)) throw new TypeError('Adapter capabilities must be an array.');
  const duplicates = spec.capabilities.filter((v, i, arr) => arr.indexOf(v) !== i);
  if (duplicates.length) throw new TypeError(`Duplicate adapter capabilities: ${duplicates.join(', ')}`);
  const unknown = spec.capabilities.filter(cap => !capabilitySet.has(cap));
  if (unknown.length) throw new TypeError(`Unknown adapter capabilities: ${unknown.join(', ')}`);

  if (spec.proofNetworks != null && !Array.isArray(spec.proofNetworks))
    throw new TypeError('Adapter proofNetworks must be an array.');
  if (spec.securityNotes != null && !Array.isArray(spec.securityNotes))
    throw new TypeError('Adapter securityNotes must be an array.');
  if (spec.securityNotes?.some(note => typeof note !== 'string' || !note.trim()))
    throw new TypeError('Adapter securityNotes entries must be non-empty strings.');

  // Existing adapters declare structured test-network descriptors. Preserve
  // those descriptors and validate their identity; never coerce them to text.
  const proofNetworks = (spec.proofNetworks ?? []).map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(entry)))
      throw new TypeError(`Adapter proofNetworks[${index}] must be a plain network descriptor.`);
    if (typeof entry.id !== 'string' || !entry.id.trim())
      throw new TypeError(`Adapter proofNetworks[${index}].id must be non-empty text.`);
    if (entry.name !== undefined && (typeof entry.name !== 'string' || !entry.name.trim()))
      throw new TypeError(`Adapter proofNetworks[${index}].name must be non-empty text.`);
    if (entry.testOnly !== undefined && typeof entry.testOnly !== 'boolean')
      throw new TypeError(`Adapter proofNetworks[${index}].testOnly must be boolean.`);
    if (Object.keys(entry).some(key => !['id', 'name', 'testOnly'].includes(key)))
      throw new TypeError(`Adapter proofNetworks[${index}] has an unknown field.`);
    return Object.freeze({ ...entry });
  });
  if (new Set(proofNetworks.map(entry => entry.id)).size !== proofNetworks.length)
    throw new TypeError('Adapter proofNetworks cannot contain duplicate network ids.');
  const frozen = {
    ...spec,
    capabilities: Object.freeze([...spec.capabilities]),
    proofNetworks: Object.freeze(proofNetworks),
    securityNotes: Object.freeze([...(spec.securityNotes ?? [])])
  };
  return Object.freeze(frozen);
}

export function publicAdapterInfo(adapter) {
  const { validateAccount, ...publicInfo } = adapter;
  return structuredClone(publicInfo);
}
