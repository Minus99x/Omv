const KEY_HASH = /^[0-9a-fA-F]{56}$/;
const ASSET_ID = /^(lovelace|[0-9a-fA-F]{56}\.[0-9a-fA-F]{0,64})$/;

function assertKeyHash(value, label) {
  if (typeof value !== 'string' || !KEY_HASH.test(value)) throw new TypeError(`${label} must be a 28-byte Cardano verification-key hash.`);
  return value.toLowerCase();
}

function normalizeValue(value, label = 'value') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an asset-id to integer-quantity object.`);
  const entries = Object.entries(value);
  if (!entries.length) throw new TypeError(`${label} cannot be empty.`);
  const out = {};
  for (const [asset, quantity] of entries) {
    if (!ASSET_ID.test(asset)) throw new TypeError(`Invalid Cardano asset id: ${asset}`);
    if (!/^-?\d+$/.test(String(quantity))) throw new TypeError(`${label}.${asset} must be an integer quantity.`);
    out[asset.toLowerCase()] = String(quantity);
  }
  return Object.freeze(out);
}

function valuesEqual(left, right) {
  const assets = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...assets].every(asset => BigInt(left[asset] ?? '0') === BigInt(right[asset] ?? '0'));
}

function assertTime(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative POSIX millisecond timestamp.`);
}

export function selectCardanoRecoveryMechanism() {
  return Object.freeze({
    nativeScriptSuitableForExactOmegaVault: false,
    exactMechanism: 'Plutus/Aiken spending validator with a state UTXO',
    reason: 'Native scripts can express signer/timelock authorization but cannot inspect transaction outputs or carry/update recovery state. A Plutus-family validator can inspect inputs, outputs, signatories and validity range, enabling immutable rescue-output and heartbeat-state checks.'
  });
}

export function createCardanoRecoveryDatum({ version = 1, ownerKeyHash, rescueAddress, contactKeyHashes, threshold, inactivityMs, lastHeartbeatMs, approvals = [], stateBeaconAsset }) {
  if (!Number.isInteger(version) || version < 1 || version > 255) throw new TypeError('version must be 1-255.');
  const owner = assertKeyHash(ownerKeyHash, 'ownerKeyHash');
  if (typeof rescueAddress !== 'string' || rescueAddress.length < 10) throw new TypeError('rescueAddress is required.');
  if (!Array.isArray(contactKeyHashes) || contactKeyHashes.length < 1 || contactKeyHashes.length > 16) throw new TypeError('contactKeyHashes must contain 1-16 keys.');
  const contacts = contactKeyHashes.map((key, i) => assertKeyHash(key, `contactKeyHashes[${i}]`));
  if (new Set(contacts).size !== contacts.length) throw new TypeError('contactKeyHashes must be unique.');
  if (contacts.includes(owner)) throw new TypeError('owner cannot also be a trusted contact.');
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > contacts.length) throw new TypeError('threshold must be reachable.');
  if (!Number.isSafeInteger(inactivityMs) || inactivityMs < 1) throw new TypeError('inactivityMs must be positive.');
  assertTime(lastHeartbeatMs, 'lastHeartbeatMs');
  if (typeof stateBeaconAsset !== 'string' || !/^[0-9a-fA-F]{56}\.[0-9a-fA-F]{0,64}$/.test(stateBeaconAsset)) throw new TypeError('stateBeaconAsset must be a native asset id.');
  const normalizedApprovals = approvals.map((key, i) => assertKeyHash(key, `approvals[${i}]`));
  if (new Set(normalizedApprovals).size !== normalizedApprovals.length) throw new TypeError('approvals must be unique.');
  if (normalizedApprovals.some(key => !contacts.includes(key))) throw new TypeError('approval is not from a configured contact.');
  return Object.freeze({ version, ownerKeyHash: owner, rescueAddress, contactKeyHashes: Object.freeze(contacts), threshold, inactivityMs, lastHeartbeatMs, approvals: Object.freeze(normalizedApprovals), stateBeaconAsset: stateBeaconAsset.toLowerCase(), recovered: false });
}

export function cardanoRecoveryEligible(datum, validityLowerBoundMs) {
  assertTime(validityLowerBoundMs, 'validityLowerBoundMs');
  // Avoid floating-point overflow near Number.MAX_SAFE_INTEGER.
  return BigInt(validityLowerBoundMs) >= BigInt(datum.lastHeartbeatMs) + BigInt(datum.inactivityMs);
}

function assertImmutablePolicy(datum, nextDatum) {
  if (nextDatum.version !== datum.version ||
      nextDatum.ownerKeyHash !== datum.ownerKeyHash ||
      nextDatum.rescueAddress !== datum.rescueAddress ||
      nextDatum.stateBeaconAsset !== datum.stateBeaconAsset ||
      nextDatum.threshold !== datum.threshold ||
      nextDatum.inactivityMs !== datum.inactivityMs ||
      !Array.isArray(nextDatum.contactKeyHashes) ||
      nextDatum.contactKeyHashes.length !== datum.contactKeyHashes.length ||
      nextDatum.contactKeyHashes.some((key, index) => key !== datum.contactKeyHashes[index])) {
    throw new Error('Policy-critical fields are immutable across Cardano state transitions.');
  }
}

function assertStateOutput({ datum, inputValue, continuingOutputs }) {
  if (BigInt(inputValue[datum.stateBeaconAsset] ?? '0') !== 1n) {
    throw new Error('Protected state input must contain exactly one state beacon token.');
  }
  if (!Array.isArray(continuingOutputs) || continuingOutputs.length !== 1) throw new Error('Exactly one continuing state output is required.');
  const output = continuingOutputs[0];
  const value = normalizeValue(output.value, 'continuingOutput.value');
  if (BigInt(value[datum.stateBeaconAsset] ?? '0') !== 1n) throw new Error('Continuing state output must carry exactly one state beacon token.');
  if (!valuesEqual(value, inputValue)) throw new Error('Continuing state output must preserve the exact protected vault value.');
  return output;
}

export function validateCardanoHeartbeatTransition({ datum, signerKeyHashes, validityLowerBoundMs, inputValue, continuingOutputs, nextDatum }) {
  const signers = new Set((signerKeyHashes ?? []).map((key, i) => assertKeyHash(key, `signerKeyHashes[${i}]`)));
  if (!signers.has(datum.ownerKeyHash)) throw new Error('Heartbeat requires owner signature.');
  assertTime(validityLowerBoundMs, 'validityLowerBoundMs');
  const normalizedInput = normalizeValue(inputValue, 'inputValue');
  assertStateOutput({ datum, inputValue: normalizedInput, continuingOutputs });
  assertImmutablePolicy(datum, nextDatum);
  if (nextDatum.lastHeartbeatMs !== validityLowerBoundMs) throw new Error('Heartbeat must set lastHeartbeatMs to the transaction validity lower bound.');
  if (nextDatum.approvals.length !== 0) throw new Error('Heartbeat must clear approvals.');
  return Object.freeze({ ok: true, transition: 'heartbeat' });
}

export function validateCardanoApprovalTransition({ datum, signerKeyHashes, approvedContactKeyHash = null, validityLowerBoundMs, inputValue, continuingOutputs, nextDatum }) {
  if (!cardanoRecoveryEligible(datum, validityLowerBoundMs)) throw new Error('Recovery inactivity period has not elapsed.');
  const signers = new Set((signerKeyHashes ?? []).map((key, i) => assertKeyHash(key, `signerKeyHashes[${i}]`)));
  const newlySigned = datum.contactKeyHashes.filter(key => signers.has(key) && !datum.approvals.includes(key));
  // Aiken Approve(contact) adds only its redeemer-selected contact, even if
  // several distinct contacts also sign the transaction. Do not silently
  // credit every new signature as a separate state transition.
  if (newlySigned.length < 1) throw new Error('Approval transition requires at least one new trusted-contact signature.');
  if (approvedContactKeyHash == null && newlySigned.length !== 1) {
    throw new Error('Multiple new contact signers require an explicit redeemer-selected approvedContactKeyHash.');
  }
  const selectedContact = approvedContactKeyHash == null
    ? newlySigned[0] : assertKeyHash(approvedContactKeyHash, 'approvedContactKeyHash');
  if (!newlySigned.includes(selectedContact)) {
    throw new Error('Approved contact must be a configured, not-yet-approved trusted contact who signed the transaction.');
  }
  const normalizedInput = normalizeValue(inputValue, 'inputValue');
  assertStateOutput({ datum, inputValue: normalizedInput, continuingOutputs });
  assertImmutablePolicy(datum, nextDatum);
  if (nextDatum.lastHeartbeatMs !== datum.lastHeartbeatMs) throw new Error('Approval cannot mutate heartbeat time.');
  const expected = new Set([...datum.approvals, selectedContact]);
  if (nextDatum.approvals.length !== expected.size || nextDatum.approvals.some(key => !expected.has(key))) throw new Error('nextDatum approvals do not exactly match prior approvals plus new trusted signatures.');
  return Object.freeze({ ok: true, transition: 'approve', approvals: expected.size });
}

export function validateCardanoExecuteTransition({ datum, validityLowerBoundMs, inputValue, outputsToRescue, continuingOutputs = [], mintedValue }) {
  if (!cardanoRecoveryEligible(datum, validityLowerBoundMs)) throw new Error('Recovery inactivity period has not elapsed.');
  if (datum.approvals.length < datum.threshold) throw new Error('Recovery threshold has not been reached.');
  if (continuingOutputs.length !== 0) throw new Error('Execute recovery must not recreate the active vault-state UTXO.');
  const protectedValue = normalizeValue(inputValue, 'inputValue');
  if (BigInt(protectedValue[datum.stateBeaconAsset] ?? '0') !== 1n) {
    throw new Error('Execute requires exactly one state beacon token in the protected input.');
  }
  if (!Array.isArray(outputsToRescue) || outputsToRescue.length < 1) throw new Error('Recovery must create output value for the immutable rescue address.');
  const aggregate = {};
  for (const [index, output] of outputsToRescue.entries()) {
    if (output.address !== datum.rescueAddress) throw new Error(`outputsToRescue[${index}] is not the immutable rescue address.`);
    const value = normalizeValue(output.value, `outputsToRescue[${index}].value`);
    for (const [asset, qty] of Object.entries(value)) aggregate[asset] = String(BigInt(aggregate[asset] ?? '0') + BigInt(qty));
  }
  const normalizedMint = normalizeValue(mintedValue, 'mintedValue');
  const expectedMint = Object.freeze({ [datum.stateBeaconAsset]: '-1' });
  if (!valuesEqual(normalizedMint, expectedMint)) throw new Error('Execute recovery must burn exactly one state beacon and mint no other assets.');
  const rescueValue = { ...protectedValue };
  delete rescueValue[datum.stateBeaconAsset];
  if (!valuesEqual(aggregate, rescueValue)) throw new Error('Rescue outputs must receive the exact protected vault value except for the burned state beacon. Fees must use external inputs.');
  return Object.freeze({ ok: true, transition: 'execute', rescueAddress: datum.rescueAddress, protectedValue: Object.freeze(rescueValue), stateBeaconBurned: true });
}

export function createCardanoStateBeaconPlan({ seedTxId, seedOutputIndex, assetNameHex = '4f56' }) {
  if (typeof seedTxId !== 'string' || !/^[0-9a-fA-F]{64}$/.test(seedTxId)) throw new TypeError('seedTxId must be a 32-byte transaction id.');
  if (!Number.isInteger(seedOutputIndex) || seedOutputIndex < 0 || seedOutputIndex > 0xffff) throw new TypeError('seedOutputIndex must be uint16.');
  if (typeof assetNameHex !== 'string' || assetNameHex.length > 64 || assetNameHex.length % 2 || !/^[0-9a-fA-F]*$/.test(assetNameHex)) throw new TypeError('assetNameHex must be 0-32 bytes of hex.');
  return Object.freeze({
    mechanism: 'one-shot Plutus V3 minting policy',
    seed: Object.freeze({ txId: seedTxId.toLowerCase(), outputIndex: seedOutputIndex }),
    assetNameHex: assetNameHex.toLowerCase(),
    initialization: Object.freeze({ seedMustBeSpent: true, exactQuantity: 1, otherMintingDisallowed: true }),
    recovery: Object.freeze({ exactQuantity: -1, otherMintingDisallowed: true, recreateBeaconOutput: false })
  });
}

export function calculateCardanoMinRequiredLovelace({ serializedOutputBytes, coinsPerUtxoByte, constantOverheadBytes = 160 }) {
  if (!Number.isSafeInteger(serializedOutputBytes) || serializedOutputBytes < 1) throw new TypeError('serializedOutputBytes must be a positive safe integer.');
  if (!/^\d+$/.test(String(coinsPerUtxoByte)) || BigInt(coinsPerUtxoByte) < 1n) throw new TypeError('coinsPerUtxoByte must be a positive integer from current protocol parameters.');
  if (!Number.isSafeInteger(constantOverheadBytes) || constantOverheadBytes < 0) throw new TypeError('constantOverheadBytes must be a non-negative safe integer.');
  return Object.freeze({
    serializedOutputBytes,
    constantOverheadBytes,
    coinsPerUtxoByte: String(coinsPerUtxoByte),
    minimumLovelace: ((BigInt(constantOverheadBytes) + BigInt(serializedOutputBytes)) * BigInt(coinsPerUtxoByte)).toString(),
    formula: '(constantOverheadBytes + serializedOutputBytes) * coinsPerUtxoByte',
    requiresCurrentProtocolParameters: true
  });
}

export function createCardanoTransactionPreflightPlan({ network = 'preprod', feePayerUsesExternalInputs = true, usesPlutus = true }) {
  return Object.freeze({
    network,
    feePayerUsesExternalInputs,
    usesPlutus,
    requiredChecks: Object.freeze([
      'all script inputs and datum/redeemer versions match released validator schema',
      'validity lower bound establishes the time used by heartbeat/eligibility checks',
      'exactly one state-beacon UTXO identifies the active vault before recovery',
      'protected value is preserved across heartbeat/approval transitions',
      'execute sends protected value to immutable rescue address',
      'minimum-ADA requirement satisfied for every output',
      'coinsPerUTxOByte loaded from current network protocol parameters; no hardcoded Preprod value',
      'fee, execution units and script-data hash recomputed after any transaction-body change',
      usesPlutus ? 'valid collateral inputs selected; collateral is ADA-only and not a protected vault input' : 'no Plutus collateral required'
    ])
  });
}
