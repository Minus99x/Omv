import { StrKey } from '@stellar/stellar-sdk';
import { evidenceDigest } from '../../core/evidence.js';

const SHA256 = /^[0-9a-f]{64}$/i;

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TypeError(`${label} contains missing or unexpected fields.`);
}

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function hashHex(value, label) {
  const text = requiredText(value, label).toLowerCase();
  if (!SHA256.test(text)) throw new TypeError(`${label} must be a 32-byte hexadecimal hash.`);
  return text;
}

function isoTime(value, label) {
  const text = requiredText(value, label);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be an ISO-compatible timestamp.`);
  return Object.freeze({ text, time });
}

function integerString(value, label, { positive = false } = {}) {
  const text = typeof value === 'bigint' ? value.toString() : String(value ?? '');
  if (!/^\d+$/.test(text)) throw new TypeError(`${label} must be a non-negative integer string.`);
  if (positive && BigInt(text) === 0n) throw new TypeError(`${label} must be greater than zero.`);
  return text;
}

function stellarAccount(value, label) {
  const account = requiredText(value, label);
  if (!StrKey.isValidEd25519PublicKey(account)) throw new TypeError(`${label} must be a valid Stellar G-address.`);
  return account;
}

function preAuthSigner(value, label) {
  const signer = requiredText(value, label);
  try {
    const decoded = StrKey.decodePreAuthTx(signer);
    if (StrKey.encodePreAuthTx(decoded) !== signer) throw new Error('non-canonical preAuthTx encoding');
  } catch {
    throw new TypeError(`${label} must be a canonical Stellar preAuthTx signer.`);
  }
  return signer;
}

function rejectionAttempt(input, label, recoveryHash) {
  exactKeys(input, ['transactionHashHex', 'observedAt', 'includedInLedger', 'successful', 'resultCode'], label);
  const observed = isoTime(input.observedAt, `${label}.observedAt`);
  const transactionHashHex = hashHex(input.transactionHashHex, `${label}.transactionHashHex`);
  if (transactionHashHex !== recoveryHash) throw new Error(`${label} is not bound to the recovery transaction hash.`);
  if (input.includedInLedger !== false || input.successful !== false) throw new Error(`${label} must prove rejection before ledger inclusion.`);
  const resultCode = requiredText(input.resultCode, `${label}.resultCode`);
  if (resultCode !== 'txTOO_EARLY') throw new Error(`${label} must prove Stellar txTOO_EARLY semantics.`);
  return Object.freeze({
    transactionHashHex,
    observedAt: observed.text,
    includedInLedger: false,
    successful: false,
    resultCode
  });
}

function successAttempt(input, recoveryHash) {
  const label = 'eligibleSubmission';
  exactKeys(input, ['innerTransactionHashHex', 'outerTransactionHashHex', 'observedAt', 'includedInLedger', 'successful', 'resultCode', 'ledger'], label);
  const innerTransactionHashHex = hashHex(input.innerTransactionHashHex, `${label}.innerTransactionHashHex`);
  if (innerTransactionHashHex !== recoveryHash) throw new Error('Eligible submission is not bound to the recovery transaction hash.');
  if (input.includedInLedger !== true || input.successful !== true) throw new Error('Eligible recovery submission must be successfully included in a ledger.');
  const resultCode = requiredText(input.resultCode, `${label}.resultCode`);
  if (resultCode !== 'txSUCCESS') throw new Error('Eligible recovery submission must prove Stellar txSUCCESS semantics.');
  return Object.freeze({
    innerTransactionHashHex,
    outerTransactionHashHex: hashHex(input.outerTransactionHashHex, `${label}.outerTransactionHashHex`),
    observedAt: isoTime(input.observedAt, `${label}.observedAt`).text,
    includedInLedger: true,
    successful: true,
    resultCode,
    ledger: integerString(input.ledger, `${label}.ledger`, { positive: true })
  });
}

function heartbeatEvidence(input) {
  const label = 'heartbeat';
  exactKeys(input, ['transactionHashHex', 'observedAt', 'includedInLedger', 'successful', 'sequenceBefore', 'sequenceAfter', 'ledger'], label);
  if (input.includedInLedger !== true || input.successful !== true) throw new Error('Heartbeat must be successfully included in a ledger.');
  const sequenceBefore = integerString(input.sequenceBefore, `${label}.sequenceBefore`);
  const sequenceAfter = integerString(input.sequenceAfter, `${label}.sequenceAfter`);
  if (BigInt(sequenceAfter) <= BigInt(sequenceBefore)) throw new Error('Heartbeat must advance the vault sequence.');
  return Object.freeze({
    transactionHashHex: hashHex(input.transactionHashHex, `${label}.transactionHashHex`),
    observedAt: isoTime(input.observedAt, `${label}.observedAt`).text,
    includedInLedger: true,
    successful: true,
    sequenceBefore,
    sequenceAfter,
    ledger: integerString(input.ledger, `${label}.ledger`, { positive: true })
  });
}

function feeBumpEvidence(input, recoveryHash, eligibleOuterHash) {
  const label = 'feeBump';
  exactKeys(input, ['innerTransactionHashHex', 'outerTransactionHashHex', 'feeAccount', 'feeStroops'], label);
  const innerTransactionHashHex = hashHex(input.innerTransactionHashHex, `${label}.innerTransactionHashHex`);
  const outerTransactionHashHex = hashHex(input.outerTransactionHashHex, `${label}.outerTransactionHashHex`);
  if (innerTransactionHashHex !== recoveryHash) throw new Error('Fee-bump evidence is bound to a different inner recovery transaction.');
  if (outerTransactionHashHex !== eligibleOuterHash) throw new Error('Fee-bump outer hash does not match the successfully included submission.');
  return Object.freeze({
    innerTransactionHashHex,
    outerTransactionHashHex,
    feeAccount: stellarAccount(input.feeAccount, `${label}.feeAccount`),
    feeStroops: integerString(input.feeStroops, `${label}.feeStroops`, { positive: true })
  });
}

function accountStateEvidence(input, recoverySequence) {
  exactKeys(input, ['before', 'after'], 'accountState');
  for (const [name, snapshot] of Object.entries(input)) {
    exactKeys(snapshot, ['sequence', 'preAuthTxSignerPresent'], `accountState.${name}`);
    if (typeof snapshot.preAuthTxSignerPresent !== 'boolean') throw new TypeError(`accountState.${name}.preAuthTxSignerPresent must be boolean.`);
  }
  const beforeSequence = integerString(input.before.sequence, 'accountState.before.sequence');
  const afterSequence = integerString(input.after.sequence, 'accountState.after.sequence');
  if (input.before.preAuthTxSignerPresent !== true) throw new Error('Pre-authorized recovery signer must be present before eligible submission.');
  if (input.after.preAuthTxSignerPresent !== false) throw new Error('Pre-authorized recovery signer must be absent after applied recovery.');
  if (BigInt(afterSequence) !== BigInt(recoverySequence)) throw new Error('Post-recovery account sequence must equal the fixed recovery transaction sequence.');
  return Object.freeze({
    before: Object.freeze({ sequence: beforeSequence, preAuthTxSignerPresent: true }),
    after: Object.freeze({ sequence: afterSequence, preAuthTxSignerPresent: false })
  });
}

function balanceMovement(input, index) {
  const label = `balanceMovements[${index}]`;
  exactKeys(input, ['assetKey', 'expectedTransferUnits', 'vaultBeforeUnits', 'vaultAfterUnits', 'rescueBeforeUnits', 'rescueAfterUnits'], label);
  const expectedTransferUnits = integerString(input.expectedTransferUnits, `${label}.expectedTransferUnits`, { positive: true });
  const vaultBeforeUnits = integerString(input.vaultBeforeUnits, `${label}.vaultBeforeUnits`);
  const vaultAfterUnits = integerString(input.vaultAfterUnits, `${label}.vaultAfterUnits`);
  const rescueBeforeUnits = integerString(input.rescueBeforeUnits, `${label}.rescueBeforeUnits`);
  const rescueAfterUnits = integerString(input.rescueAfterUnits, `${label}.rescueAfterUnits`);
  const expected = BigInt(expectedTransferUnits);
  if (BigInt(vaultBeforeUnits) - BigInt(vaultAfterUnits) !== expected) throw new Error(`${label} vault delta does not equal the declared recovery amount.`);
  if (BigInt(rescueAfterUnits) - BigInt(rescueBeforeUnits) !== expected) throw new Error(`${label} rescue delta does not equal the declared recovery amount.`);
  return Object.freeze({
    assetKey: requiredText(input.assetKey, `${label}.assetKey`),
    expectedTransferUnits,
    vaultBeforeUnits,
    vaultAfterUnits,
    rescueBeforeUnits,
    rescueAfterUnits
  });
}

function finalityEvidence(input, eligible) {
  const label = 'finality';
  exactKeys(input, ['status', 'transactionHashHex', 'ledger', 'ledgerHash', 'observedAt'], label);
  if (input.status !== 'finalized') throw new Error('Stellar recovery evidence requires finalized ledger status.');
  const transactionHashHex = hashHex(input.transactionHashHex, `${label}.transactionHashHex`);
  if (transactionHashHex !== eligible.outerTransactionHashHex) throw new Error('Finality evidence is bound to a different submitted transaction.');
  const ledger = integerString(input.ledger, `${label}.ledger`, { positive: true });
  if (ledger !== eligible.ledger) throw new Error('Finality ledger does not match the successful recovery submission ledger.');
  return Object.freeze({
    status: 'finalized',
    transactionHashHex,
    ledger,
    ledgerHash: hashHex(input.ledgerHash, `${label}.ledgerHash`),
    observedAt: isoTime(input.observedAt, `${label}.observedAt`).text
  });
}

function normalize(input) {
  exactKeys(input, [
    'networkRef', 'recoveryTransactionHashHex', 'preAuthTxSigner', 'recoverySequence',
    'initialTooEarly', 'heartbeat', 'postHeartbeatTooEarly', 'eligibleSubmission',
    'feeBump', 'accountState', 'balanceMovements', 'finality'
  ], 'Stellar recovery evidence input');
  if (input.networkRef !== 'stellar:testnet') throw new TypeError('Stellar recovery evidence must target stellar:testnet.');
  const recoveryTransactionHashHex = hashHex(input.recoveryTransactionHashHex, 'recoveryTransactionHashHex');
  const preAuthTxSigner = preAuthSigner(input.preAuthTxSigner, 'preAuthTxSigner');
  const recoverySequence = integerString(input.recoverySequence, 'recoverySequence', { positive: true });
  const initialTooEarly = rejectionAttempt(input.initialTooEarly, 'initialTooEarly', recoveryTransactionHashHex);
  const heartbeat = heartbeatEvidence(input.heartbeat);
  const postHeartbeatTooEarly = rejectionAttempt(input.postHeartbeatTooEarly, 'postHeartbeatTooEarly', recoveryTransactionHashHex);
  const eligibleSubmission = successAttempt(input.eligibleSubmission, recoveryTransactionHashHex);
  const feeBump = feeBumpEvidence(input.feeBump, recoveryTransactionHashHex, eligibleSubmission.outerTransactionHashHex);
  const accountState = accountStateEvidence(input.accountState, recoverySequence);
  if (!Array.isArray(input.balanceMovements) || input.balanceMovements.length < 1) throw new TypeError('At least one rescue balance movement is required.');
  const balanceMovements = Object.freeze(input.balanceMovements.map(balanceMovement));
  if (new Set(balanceMovements.map(item => item.assetKey)).size !== balanceMovements.length) throw new TypeError('balanceMovements must not contain duplicate assets.');
  const finality = finalityEvidence(input.finality, eligibleSubmission);

  const initialTime = Date.parse(initialTooEarly.observedAt);
  const heartbeatTime = Date.parse(heartbeat.observedAt);
  const resetTime = Date.parse(postHeartbeatTooEarly.observedAt);
  const eligibleTime = Date.parse(eligibleSubmission.observedAt);
  const finalityTime = Date.parse(finality.observedAt);
  if (!(initialTime <= heartbeatTime && heartbeatTime <= resetTime && resetTime < eligibleTime && eligibleTime <= finalityTime)) {
    throw new Error('Stellar recovery evidence timeline is not monotonic.');
  }
  if (BigInt(accountState.before.sequence) < BigInt(heartbeat.sequenceAfter)) {
    throw new Error('Pre-recovery account snapshot cannot precede the applied heartbeat sequence.');
  }
  if (BigInt(accountState.before.sequence) >= BigInt(recoverySequence)) {
    throw new Error('Pre-recovery account sequence must remain below the fixed recovery transaction sequence.');
  }

  return Object.freeze({
    schema: 'omegavault.stellar.testnet-recovery-evidence.v1',
    chainId: 'stellar',
    networkRef: 'stellar:testnet',
    recoveryTransactionHashHex,
    preAuthTxSigner,
    recoverySequence,
    initialTooEarly,
    heartbeat,
    postHeartbeatTooEarly,
    eligibleSubmission,
    feeBump,
    accountState,
    balanceMovements,
    finality,
    publicTestnetEvidenceReady: true,
    promotionAuthority: false,
    authorityBoundary: 'This bundle validates one Stellar Testnet recovery proof only. It does not by itself promote the connector, authorize deployment, authorize wallets, or grant production authority.'
  });
}

export function createStellarTestnetRecoveryEvidenceBundle(input) {
  const core = normalize(input);
  return Object.freeze({ ...core, sha256: evidenceDigest(core) });
}

export function verifyStellarTestnetRecoveryEvidenceBundle(bundle) {
  const errors = [];
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return Object.freeze({ ok: false, errors: Object.freeze(['Stellar evidence bundle is required.']) });
  const { sha256, schema, chainId, publicTestnetEvidenceReady, promotionAuthority, authorityBoundary, ...input } = bundle;
  if (schema !== 'omegavault.stellar.testnet-recovery-evidence.v1') errors.push('Unexpected Stellar evidence schema.');
  if (chainId !== 'stellar') errors.push('Unexpected Stellar evidence chain.');
  if (publicTestnetEvidenceReady !== true) errors.push('Stellar evidence readiness flag is invalid.');
  if (promotionAuthority !== false) errors.push('Stellar evidence bundle must not grant promotion authority.');
  if (typeof authorityBoundary !== 'string' || !authorityBoundary) errors.push('Stellar evidence authority boundary is missing.');
  let expected;
  try {
    expected = createStellarTestnetRecoveryEvidenceBundle(input);
  } catch (error) {
    errors.push(String(error?.message || error));
    return Object.freeze({ ok: false, errors: Object.freeze(errors) });
  }
  if (sha256 !== expected.sha256) errors.push('Stellar evidence bundle digest mismatch.');
  if (authorityBoundary !== expected.authorityBoundary) errors.push('Stellar evidence authority boundary mismatch.');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
