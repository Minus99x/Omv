import crypto from 'node:crypto';

const XONLY = /^[0-9a-fA-F]{64}$/;
const COMPRESSED = /^(?:02|03)[0-9a-fA-F]{64}$/;
const TXID = /^[0-9a-fA-F]{64}$/;
const MAX_MONEY_SATS = 21_000_000n * 100_000_000n;

function satoshis(value,label) {
  if (!['string', 'number', 'bigint'].includes(typeof value)) {
    throw new TypeError(`${label} must be a primitive non-negative integer.`);
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer when supplied as a number.`);
  if (!/^\d+$/.test(String(value))) throw new TypeError(`${label} must be a non-negative integer.`);
  return BigInt(value);
}

function boundedSatoshis(value, label) {
  const amount = satoshis(value, label);
  if (amount > MAX_MONEY_SATS) throw new RangeError(`${label} exceeds Bitcoin MAX_MONEY.`);
  return amount;
}

function assertKey(key, label) {
  if (typeof key !== 'string' || (!XONLY.test(key) && !COMPRESSED.test(key))) throw new TypeError(`${label} must be a 32-byte x-only or 33-byte compressed Bitcoin public key.`);
  return key.toLowerCase();
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

export function createBitcoinRecoveryPolicy({ ownerKey, contactKeys, threshold, csvBlocks }) {
  const owner = assertKey(ownerKey, 'ownerKey');
  if (!Array.isArray(contactKeys) || contactKeys.length < 1 || contactKeys.length > 20) throw new TypeError('contactKeys must contain 1-20 keys for the scaffold.');
  const contacts = contactKeys.map((key, i) => assertKey(key, `contactKeys[${i}]`));
  if (new Set(contacts).size !== contacts.length) throw new TypeError('contactKeys must be unique.');
  if (contacts.includes(owner)) throw new TypeError('ownerKey cannot also be a recovery contact key.');
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > contacts.length) throw new TypeError('threshold must be reachable.');
  if (!Number.isInteger(csvBlocks) || csvBlocks < 1 || csvBlocks > 0xffff) throw new TypeError('csvBlocks must be 1-65535 in this initial height-based policy scaffold.');
  const policy = Object.freeze({
    ownerPath: Object.freeze({ type: 'key', key: owner, availability: 'immediate' }),
    recoveryPath: Object.freeze({ type: 'and', timelock: Object.freeze({ type: 'older', unit: 'blocks', value: csvBlocks }), threshold: Object.freeze({ type: 'threshold', required: threshold, keys: Object.freeze(contacts) }) })
  });
  return Object.freeze({
    chainId: 'bitcoin', networkRef: 'bitcoin:signet', strategy: 'descriptor-miniscript-csv', policy,
    policyDigest: digest(policy),
    semantics: Object.freeze({ thresholdOnChain: true, relativeDelayOnChain: true, ownerHeartbeatAsAccountAction: false, immutableRescueOnChain: false }),
    heartbeatModel: 'Owner spends the protected UTXO into a fresh vault output; confirmation of the rollover starts a new CSV age.',
    rescueLimitation: 'Standard Bitcoin signature/timelock script paths authorize a spend but do not constrain the recovery transaction output to one immutable rescue destination.'
  });
}

export function createBitcoinRolloverHeartbeatPlan({ currentTxid, currentVout, currentPolicyDigest, nextPolicyDigest, minimumConfirmations = 1 }) {
  if (!TXID.test(currentTxid)) throw new TypeError('currentTxid must be a 32-byte hex txid.');
  if (!Number.isInteger(currentVout) || currentVout < 0 || currentVout > 0xffffffff) throw new TypeError('currentVout must be a uint32 Bitcoin output index.');
  if (!/^[0-9a-f]{64}$/i.test(currentPolicyDigest) || !/^[0-9a-f]{64}$/i.test(nextPolicyDigest)) throw new TypeError('policy digests must be SHA-256 hex strings.');
  if (!Number.isInteger(minimumConfirmations) || minimumConfirmations < 1 || minimumConfirmations > 0xffffffff) throw new TypeError('minimumConfirmations must be a positive uint32.');
  return Object.freeze({
    operation: 'owner-rollover-heartbeat',
    spends: Object.freeze({ txid: currentTxid.toLowerCase(), vout: currentVout, policyDigest: currentPolicyDigest.toLowerCase() }),
    creates: Object.freeze({ policyDigest: nextPolicyDigest.toLowerCase() }),
    effect: 'Once the rollover confirms, the new UTXO has a fresh relative timelock age. Any recovery attempt against the spent old outpoint is invalid.',
    evidence: Object.freeze(['old outpoint spent by owner path', 'new vault output script/policy matches expected digest', `new outpoint observed with at least ${minimumConfirmations} confirmation(s)`])
  });
}

export function createBitcoinPsbtV2RecoveryPlan({ inputs, outputs, requiredContactKeys, threshold, feeSats, rescueScriptPubKey = null }) {
  if (!Array.isArray(inputs) || inputs.length < 1) throw new TypeError('inputs are required.');
  if (!Array.isArray(outputs) || outputs.length < 1) throw new TypeError('outputs are required.');
  if (!Array.isArray(requiredContactKeys) || requiredContactKeys.length < 1) throw new TypeError('requiredContactKeys must be a nonempty array.');
  const keys = requiredContactKeys.map((key, i) => assertKey(key, `requiredContactKeys[${i}]`));
  if (new Set(keys).size !== keys.length) throw new TypeError('requiredContactKeys must be unique.');
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > keys.length) throw new TypeError('threshold must be reachable.');
  const fee = boundedSatoshis(feeSats, 'feeSats');
  const normalizedInputs = inputs.map((input, i) => {
    if (!TXID.test(input.txid) || !Number.isInteger(input.vout) || input.vout < 0 || input.vout > 0xffffffff) throw new TypeError(`inputs[${i}] must contain txid/vout within uint32.`);
    if (input.sequence != null && (!Number.isInteger(input.sequence) || input.sequence < 0 || input.sequence > 0xffffffff)) throw new TypeError(`inputs[${i}].sequence must be uint32.`);
    const amount = input.amountSats == null ? null : boundedSatoshis(input.amountSats, `inputs[${i}].amountSats`).toString();
    return Object.freeze({ txid: input.txid.toLowerCase(), vout: input.vout, sequence: input.sequence ?? null, amountSats: amount });
  });
  const refs = normalizedInputs.map(input => `${input.txid}:${input.vout}`);
  if (new Set(refs).size !== refs.length) throw new TypeError('Duplicate Bitcoin recovery input outpoint.');
  const normalizedOutputs = outputs.map((output, i) => {
    const amount = boundedSatoshis(output.amountSats, `outputs[${i}].amountSats`);
    if (typeof output.scriptPubKey !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(output.scriptPubKey)) throw new TypeError(`outputs[${i}].scriptPubKey must be nonempty even-length hex.`);
    return Object.freeze({ amountSats: amount.toString(), scriptPubKey: output.scriptPubKey.toLowerCase() });
  });
  const totalOut = normalizedOutputs.reduce((sum, output) => sum + BigInt(output.amountSats), 0n);
  if (totalOut > MAX_MONEY_SATS) throw new RangeError('Bitcoin recovery aggregate output value exceeds MAX_MONEY.');
  const feeBalanceVerified = normalizedInputs.every(input => input.amountSats !== null);
  if (feeBalanceVerified) {
    const totalIn = normalizedInputs.reduce((sum, input) => sum + BigInt(input.amountSats), 0n);
    if (totalIn > MAX_MONEY_SATS) throw new RangeError('Bitcoin recovery aggregate input value exceeds MAX_MONEY.');
    if (totalIn - totalOut !== fee) throw new Error('Bitcoin recovery PSBT intent inputs, outputs and miner fee do not balance.');
  }
  if (rescueScriptPubKey != null && (typeof rescueScriptPubKey !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(rescueScriptPubKey))) {
    throw new TypeError('rescueScriptPubKey must be nonempty even-length hex.');
  }
  const unsignedIntent = Object.freeze({ version: 2, inputs: Object.freeze(normalizedInputs), outputs: Object.freeze(normalizedOutputs), feeSats: fee.toString(), sighashPolicy: 'SIGHASH_ALL', inputsModifiable: false, outputsModifiable: false });
  const rescueOutputPresent = rescueScriptPubKey == null ? null : normalizedOutputs.some(o => o.scriptPubKey === rescueScriptPubKey.toLowerCase());
  if (rescueOutputPresent && normalizedOutputs.some(o => o.scriptPubKey === rescueScriptPubKey.toLowerCase() && BigInt(o.amountSats) === 0n)) {
    throw new Error('Bitcoin recovery cannot designate a zero-value rescue output.');
  }
  return Object.freeze({
    format: 'PSBTv2', unsignedIntent, intentDigest: digest(unsignedIntent), requiredContactKeys: Object.freeze(keys), threshold,
    signerChecks: Object.freeze(['prevout matches expected UTXO', 'witness/redeem/miniscript matches policy', 'sighash policy accepted', 'all output amounts and scripts displayed/verified', 'fee and feerate policy accepted']),
    rescueOutputPresent,
    rescueScriptPubKey: rescueScriptPubKey == null ? null : rescueScriptPubKey.toLowerCase(),
    feeBalanceVerified,
    warning: 'PSBT output verification protects a signer from signing the wrong destination, but the underlying delayed multisig script does not cryptographically force contacts to use this rescue output in every alternative spend.'
  });
}

function assertOwnDataRecord(value, fields, label) {
  if(!value || typeof value!=='object' || Array.isArray(value) ||
     ![Object.prototype,null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be an exact own-data record.`);
  }
  const keys=Reflect.ownKeys(value);
  if(keys.length!==fields.length || keys.some(k=>typeof k!=='string' || !fields.includes(k))) {
    throw new TypeError(`${label} must have exactly the canonical own-data fields.`);
  }
  for(const name of fields) {
    const descriptor=Object.getOwnPropertyDescriptor(value,name);
    if(!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor,'value')){
      throw new TypeError(`${label} must have canonical enumerable data fields; accessors are forbidden.`);
    }
  }
}

function assertDenseDataArray(value, recordFields, label){
  if(!Array.isArray(value) || Object.getPrototypeOf(value)!==Array.prototype || value.length<1) {
    throw new TypeError(`${label} must be a nonempty standard array.`);
  }
  const allowed=new Set(['length']);
  for(let i=0;i<value.length;i++){
    const name=String(i);
    const descriptor=Object.getOwnPropertyDescriptor(value,name);
    if(!descriptor || !Object.hasOwn(descriptor,'value')){
      throw new TypeError(`${label} must contain dense own-data entries without getters.`);
    }
    allowed.add(name);
    assertOwnDataRecord(descriptor.value,recordFields,`${label}[${i}]`);
  }
  if(Reflect.ownKeys(value).some(k=>typeof k!=='string' || !allowed.has(k))) {
    throw new TypeError(`${label} contains unexpected own metadata.`);
  }
}

function assertCanonicalRecoveryIntentShape(intent){
  assertOwnDataRecord(intent,
    ['version','inputs','outputs','feeSats','sighashPolicy','inputsModifiable','outputsModifiable'],
    'Bitcoin PSBT unsigned intent');
  assertDenseDataArray(intent.inputs,['txid','vout','sequence','amountSats'],'Bitcoin PSBT inputs');
  assertDenseDataArray(intent.outputs,['amountSats','scriptPubKey'],'Bitcoin PSBT outputs');
}

export function coordinateBitcoinRecoverySignatures({ plan, signatures }) {
  if (!plan || plan.format !== 'PSBTv2') throw new TypeError('PSBTv2 recovery plan is required.');
  if (!plan.unsignedIntent) throw new TypeError('Bitcoin recovery plan unsigned intent or digest is invalid or was modified.');
  // An attacker can recompute a matching digest over impossible PSBT fields.
  // Validate data descriptors before digesting, so getters cannot alter the
  // transaction between validation and signing-intent accounting.
  assertCanonicalRecoveryIntentShape(plan.unsignedIntent);
  if (plan.intentDigest !== digest(plan.unsignedIntent) ||
      plan.unsignedIntent.version !== 2 ||
      plan.unsignedIntent.inputsModifiable !== false ||
      plan.unsignedIntent.outputsModifiable !== false ||
      plan.unsignedIntent.sighashPolicy !== 'SIGHASH_ALL') {
    throw new TypeError('Bitcoin recovery plan unsigned intent or digest is invalid or was modified.');
  }
  if (!Array.isArray(plan.requiredContactKeys) || plan.requiredContactKeys.length < 1 ||
      !Number.isInteger(plan.threshold) || plan.threshold < 1 ||
      plan.threshold > plan.requiredContactKeys.length) {
    throw new TypeError('Bitcoin recovery signer threshold is invalid or unreachable.');
  }
  const expectedKeys = plan.requiredContactKeys.map((key, index) => assertKey(key, `plan.requiredContactKeys[${index}]`));
  if (new Set(expectedKeys).size !== expectedKeys.length ||
      expectedKeys.some((key, index) => key !== plan.requiredContactKeys[index])) {
    throw new TypeError('Bitcoin recovery signer set must contain distinct canonical contact keys.');
  }
  // Verify the entire frozen recovery intent independently, not just its hash.
  // Reusing the builder enforces outpoint uniqueness, canonical scripts,
  // uint32 sequence bounds, MAX_MONEY and exact fee/value conservation.
  const rebuilt=createBitcoinPsbtV2RecoveryPlan({
    inputs:plan.unsignedIntent.inputs,
    outputs:plan.unsignedIntent.outputs,
    feeSats:plan.unsignedIntent.feeSats,
    requiredContactKeys:expectedKeys,
    threshold:plan.threshold,
    rescueScriptPubKey:plan.rescueScriptPubKey ?? null
  });
  if(rebuilt.intentDigest!==plan.intentDigest ||
     rebuilt.feeBalanceVerified!==plan.feeBalanceVerified ||
     rebuilt.rescueOutputPresent!==plan.rescueOutputPresent) {
    throw new TypeError('Bitcoin recovery intent was rehashed with noncanonical fields, invalid fee evidence or mismatched rescue output.');
  }
  if(plan.rescueScriptPubKey!=null && rebuilt.rescueOutputPresent!==true) {
    throw new Error('Bitcoin recovery signature collection requires the caller-confirmed rescue output.');
  }
  // Merely including one rescue output is not sufficient: the remaining
  // outputs could drain funds to an attacker. Match the finalizer's
  // single-destination recovery policy before even counting partial bytes.
  if(plan.rescueScriptPubKey!=null && rebuilt.unsignedIntent.outputs.length!==1){
    throw new Error('Bitcoin recovery signature collection requires exactly one rescue output; split destinations are forbidden.');
  }
  if (!Array.isArray(signatures) || Object.getPrototypeOf(signatures)!==Array.prototype) {
    throw new TypeError('signatures must be an array with standard prototype.');
  }
  // Partial bytes are unverified authorization claims; reject sparse, inherited
  // and accessor-backed evidence before reading any signer identity.
  const allowedIndexes=new Set(['length']);
  for(let index=0;index<signatures.length;index++){
    const name=String(index);
    const slot=Object.getOwnPropertyDescriptor(signatures,name);
    if(!slot || !Object.hasOwn(slot,'value')) {
      throw new TypeError('Bitcoin signature claims require dense own-data entries.');
    }
    allowedIndexes.add(name);
    assertOwnDataRecord(slot.value,['publicKey','signature','intentDigest'],
      `Bitcoin signature claim ${index}`);
  }
  if(Reflect.ownKeys(signatures).some(key=>typeof key!=='string'||!allowedIndexes.has(key))){
    throw new TypeError('Bitcoin signature claims contain unexpected array metadata.');
  }
  const allowed = new Set(expectedKeys);
  const seen = new Set();
  for (const [index, signature] of signatures.entries()) {
    const key = assertKey(signature?.publicKey, `signatures[${index}].publicKey`);
    if (!allowed.has(key)) throw new TypeError(`Unexpected Bitcoin recovery signer: ${key}`);
    if (seen.has(key)) throw new TypeError(`Duplicate Bitcoin recovery signer: ${key}`);
    if (typeof signature.signature !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(signature.signature)) throw new TypeError('signature bytes must be non-empty even-length hexadecimal.');
    if (signature.intentDigest !== plan.intentDigest) throw new TypeError('Signature was produced for a different recovery transaction intent.');
    seen.add(key);
  }
  return Object.freeze({
    signatureCount:seen.size, threshold:plan.threshold,
    thresholdReached:seen.size>=plan.threshold,
    intentDigest:plan.intentDigest,
    feeBalanceVerified:rebuilt.feeBalanceVerified,
    rescueOutputPresent:rebuilt.rescueOutputPresent,
    cryptographicSignaturesVerified:false,
    safeToBroadcast:false
  });
}

export function assessBitcoinImmutableRescue({ covenantActive = false, recoveryPathUsesContactKeys = true } = {}) {
  if (typeof covenantActive !== 'boolean' || typeof recoveryPathUsesContactKeys !== 'boolean') {
    throw new TypeError('Bitcoin covenant capability and recovery-path flags must be explicit booleans.');
  }
  if (covenantActive) return Object.freeze({ enforceable: true, mechanism: 'covenant-capable script path', status: 'requires separate consensus/network capability verification and dedicated security design' });
  return Object.freeze({
    enforceable: false,
    mechanism: null,
    status: recoveryPathUsesContactKeys ? 'blocked under current standard key+timelock script design' : 'unproven',
    reason: 'CHECKSIG/CHECKSIGADD and CSV can constrain authorization and time, but do not by themselves commit every valid future recovery spend to one output destination. A PSBT can bind each collected signature to outputs, but threshold key holders can construct a different valid spend after the delay.'
  });
}

export function validateBitcoinCsvRecoveryInput({ txVersion = 2, sequence, csvBlocks }) {
  if (!Number.isInteger(txVersion) || txVersion < 0 || txVersion > 0x7fffffff) throw new TypeError('txVersion must be a non-negative signed int32 Bitcoin version.');
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff) throw new TypeError('sequence must be a uint32.');
  if (!Number.isInteger(csvBlocks) || csvBlocks < 1 || csvBlocks > 0xffff) throw new TypeError('csvBlocks must be 1-65535.');
  const disableFlag = (sequence & 0x80000000) !== 0;
  const timeBased = (sequence & 0x00400000) !== 0;
  const relativeValue = sequence & 0x0000ffff;
  const checks = Object.freeze({
    transactionVersionAtLeast2: txVersion >= 2,
    relativeLocktimeEnabled: !disableFlag,
    heightBasedSequence: !timeBased,
    sequenceMeetsPolicy: relativeValue >= csvBlocks
  });
  return Object.freeze({ ok: Object.values(checks).every(Boolean), checks, txVersion, sequence: sequence >>> 0, relativeValue, csvBlocks });
}

export function createBitcoinPsbtV2LockPlan({ inputsModifiable = false, outputsModifiable = false, hasSighashSingle = false } = {}) {
  if (typeof inputsModifiable !== 'boolean' || typeof outputsModifiable !== 'boolean' || typeof hasSighashSingle !== 'boolean') throw new TypeError('PSBTv2 modifiable flags must be booleans.');
  const modifiableFlags = (inputsModifiable ? 1 : 0) | (outputsModifiable ? 2 : 0) | (hasSighashSingle ? 4 : 0);
  return Object.freeze({
    psbtVersion: 2,
    globalVersionRequired: true,
    unsignedTxFieldExcluded: true,
    inputsModifiable,
    outputsModifiable,
    hasSighashSingle,
    modifiableFlags,
    safeForOmegaVaultSignatureCollection: !inputsModifiable && !outputsModifiable && !hasSighashSingle,
    rule: 'OmegaVault freezes PSBTv2 inputs and outputs before recovery signatures are collected.'
  });
}

export function createBitcoinFeeBumpPlan({ rbfEnabled = true, cpfpAnchorAvailable = false, signaturesAlreadyCollected = false }) {
  if ([rbfEnabled, cpfpAnchorAvailable, signaturesAlreadyCollected].some(value => typeof value !== 'boolean')) {
    throw new TypeError('Bitcoin fee-bump policy flags must be explicit booleans.');
  }
  return Object.freeze({
    rbfEnabled, cpfpAnchorAvailable, signaturesAlreadyCollected,
    rules: Object.freeze([
      signaturesAlreadyCollected ? 'Changing fee-affecting transaction fields may invalidate existing signatures; rebuild and recollect as required by the sighash.' : 'Choose fee and RBF policy before collecting signatures.',
      rbfEnabled ? 'Keep input sequence compatible with both CSV policy and intended replaceability.' : 'No RBF path selected.',
      cpfpAnchorAvailable ? 'A controlled child output may be used for CPFP if the parent recovery transaction needs fee acceleration.' : 'No CPFP anchor is assumed.'
    ])
  });
}
