import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { hashCardanoEvidence } from './evidence-binding.js';
import {
  CARDANO_APPLIED_FIXTURE,
  CARDANO_PREPROD_NETWORK_ID
} from './transaction-body.js';
import { createCardanoOgmiosUtxoByOutputReferencesParams } from './preprod-live-capture.js';

const ACTIONS = Object.freeze(['initialize', 'heartbeat', 'approve', 'execute']);
const REQUIRED_ROLES = Object.freeze({
  initialize: Object.freeze(['seed', 'fee', 'collateral']),
  heartbeat: Object.freeze(['state', 'fee', 'collateral']),
  approve: Object.freeze(['state', 'fee', 'collateral']),
  execute: Object.freeze(['state', 'fee', 'collateral'])
});
const HEX_32 = /^[0-9a-f]{64}$/i;

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}

function normalizeReference(value, label) {
  const reference = plainObject(value, label);
  const txId = String(reference?.transaction?.id ?? '').toLowerCase();
  const index = Number(reference?.index);
  if (!HEX_32.test(txId)) throw new TypeError(`${label}.transaction.id must be 32-byte hex.`);
  if (!Number.isSafeInteger(index) || index < 0) throw new TypeError(`${label}.index must be a non-negative safe integer.`);
  return Object.freeze({ transaction: Object.freeze({ id: txId }), index });
}

function refKey(reference) {
  return `${reference.transaction.id}#${reference.index}`;
}

function assertPreprodAddress(address, label) {
  if (typeof address !== 'string' || !address) throw new TypeError(`${label} is required.`);
  let decoded;
  try {
    decoded = Cardano.Address.from_bech32(address);
  } catch {
    throw new Error(`${label} is not a valid Cardano bech32 address.`);
  }
  if (decoded.network_id() !== CARDANO_PREPROD_NETWORK_ID) {
    throw new Error(`${label} is not Cardano Preprod/testnet network id ${CARDANO_PREPROD_NETWORK_ID}.`);
  }
  return address;
}

function adaLovelace(utxo, label) {
  const raw = String(utxo?.value?.ada?.lovelace ?? '');
  if (!/^\d+$/.test(raw) || BigInt(raw) < 1n) throw new Error(`${label} must contain positive lovelace.`);
  return raw;
}

function nonAdaPolicies(utxo) {
  return Object.keys(utxo.value ?? {}).filter(key => key !== 'ada');
}

function assertAdaOnly(utxo, label) {
  if (nonAdaPolicies(utxo).length !== 0) throw new Error(`${label} must be ADA-only.`);
}

function assertStateUtxo(utxo) {
  if (utxo.address !== CARDANO_APPLIED_FIXTURE.recoveryValidatorAddress) {
    throw new Error('state UTxO is not locked at the applied OmegaVault recovery validator address.');
  }
  const beacon = utxo.value?.[CARDANO_APPLIED_FIXTURE.beaconPolicyId]?.[CARDANO_APPLIED_FIXTURE.assetNameHex];
  if (String(beacon) !== '1') throw new Error('state UTxO must contain exactly one OmegaVault state beacon.');
  if (utxo.datum == null) throw new Error('state UTxO must carry an inline datum.');
}

function withoutDigest(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

export function createCardanoPreprodRealUtxoBindingPlan({ action, roles }) {
  if (!ACTIONS.includes(action)) throw new TypeError('action must be initialize, heartbeat, approve, or execute.');
  const source = plainObject(roles, 'roles');
  const expectedRoles = REQUIRED_ROLES[action];
  const actualRoles = Object.keys(source).sort();
  if (actualRoles.length !== expectedRoles.length || !expectedRoles.every(role => actualRoles.includes(role))) {
    throw new Error(`${action} real UTxO binding requires exactly these roles: ${expectedRoles.join(', ')}.`);
  }

  const normalizedRoles = {};
  const seen = new Set();
  for (const role of expectedRoles) {
    const reference = normalizeReference(source[role], `roles.${role}`);
    const key = refKey(reference);
    if (seen.has(key)) throw new Error(`Real UTxO roles must use distinct output references; duplicate ${key}.`);
    seen.add(key);
    normalizedRoles[role] = reference;
  }

  const query = Object.freeze({
    jsonrpc: '2.0',
    method: 'queryLedgerState/utxo',
    params: createCardanoOgmiosUtxoByOutputReferencesParams(expectedRoles.map(role => normalizedRoles[role]))
  });

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-real-utxo-binding-plan.v1',
    network: 'preprod',
    networkId: CARDANO_PREPROD_NETWORK_ID,
    action,
    roles: Object.freeze(normalizedRoles),
    query,
    requiredStableTipBracket: true,
    fullPhaseOneValidationPerformed: false,
    walletSigningAuthorized: false,
    transactionSubmissionAuthorized: false,
    liveValueMovementAuthorized: false,
    purpose: 'Bind explicitly selected real Cardano Preprod UTxOs to one lifecycle action without authorizing signing or submission.'
  });
  return Object.freeze({ ...core, planSha256: hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodRealUtxoBindingPlan(plan) {
  const errors = [];
  try {
    const value = plainObject(plan, 'plan');
    if (value.schema !== 'omegavault.cardano.preprod-real-utxo-binding-plan.v1') errors.push('Real UTxO binding plan schema is not supported.');
    if (value.network !== 'preprod' || value.networkId !== CARDANO_PREPROD_NETWORK_ID) errors.push('Real UTxO binding plan must target Cardano Preprod.');
    if (!ACTIONS.includes(value.action)) errors.push('Real UTxO binding plan action is invalid.');
    const expectedRoles = REQUIRED_ROLES[value.action] ?? [];
    const actualRoles = value.roles && typeof value.roles === 'object' && !Array.isArray(value.roles) ? Object.keys(value.roles) : [];
    if (actualRoles.length !== expectedRoles.length || !expectedRoles.every(role => actualRoles.includes(role))) {
      errors.push('Real UTxO binding plan role set is invalid.');
    } else {
      const refs = [];
      for (const role of expectedRoles) refs.push(refKey(normalizeReference(value.roles[role], `roles.${role}`)));
      if (new Set(refs).size !== refs.length) errors.push('Real UTxO binding plan contains duplicate role references.');
    }
    if (value.query?.method !== 'queryLedgerState/utxo') errors.push('Real UTxO binding plan must use queryLedgerState/utxo.');
    const expectedParams = expectedRoles.length === 0 ? null : createCardanoOgmiosUtxoByOutputReferencesParams(expectedRoles.map(role => value.roles[role]));
    if (expectedParams && hashCardanoEvidence(value.query?.params) !== hashCardanoEvidence(expectedParams)) {
      errors.push('Real UTxO binding plan query does not match its role references.');
    }
    if (value.requiredStableTipBracket !== true ||
        value.fullPhaseOneValidationPerformed !== false ||
        value.walletSigningAuthorized !== false ||
        value.transactionSubmissionAuthorized !== false ||
        value.liveValueMovementAuthorized !== false) {
      errors.push('Real UTxO binding plan authority boundary was weakened.');
    }
    if (!/^[0-9a-f]{64}$/i.test(String(value.planSha256 ?? ''))) errors.push('Real UTxO binding plan digest is invalid.');
    else if (hashCardanoEvidence(withoutDigest(value, 'planSha256')) !== value.planSha256) errors.push('Real UTxO binding plan self-digest mismatch.');
  } catch (error) {
    errors.push(error.message);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function createCardanoPreprodRealUtxoBindingEvidence({
  plan,
  tipBefore,
  tipAfter,
  queriedUtxo
}) {
  const value = plainObject(plan, 'plan');
  if (value.schema !== 'omegavault.cardano.preprod-real-utxo-binding-plan.v1' ||
      value.network !== 'preprod' ||
      value.networkId !== CARDANO_PREPROD_NETWORK_ID) {
    throw new Error('A Cardano Preprod real UTxO binding plan is required.');
  }
  const planDigest = hashCardanoEvidence(withoutDigest(value, 'planSha256'));
  if (planDigest !== value.planSha256) throw new Error('Real UTxO binding plan self-digest mismatch.');

  const beforeHash = String(tipBefore?.hash ?? '').toLowerCase();
  const afterHash = String(tipAfter?.hash ?? '').toLowerCase();
  const beforeSlot = Number(tipBefore?.slot);
  const afterSlot = Number(tipAfter?.slot);
  if (!HEX_32.test(beforeHash) || !HEX_32.test(afterHash) ||
      !Number.isSafeInteger(beforeSlot) || !Number.isSafeInteger(afterSlot) ||
      beforeHash !== afterHash || beforeSlot !== afterSlot) {
    throw new Error('Real UTxO query must be bracketed by one stable Cardano Preprod tip.');
  }

  if (!Array.isArray(queriedUtxo)) throw new TypeError('queriedUtxo must be the normalized Ogmios UTxO array.');
  const byRef = new Map();
  for (const [index, utxo] of queriedUtxo.entries()) {
    const reference = normalizeReference(utxo, `queriedUtxo[${index}]`);
    const key = refKey(reference);
    if (byRef.has(key)) throw new Error(`Duplicate queried UTxO: ${key}.`);
    assertPreprodAddress(utxo.address, `queriedUtxo[${index}].address`);
    adaLovelace(utxo, `queriedUtxo[${index}]`);
    byRef.set(key, utxo);
  }

  const roleEvidence = {};
  for (const role of REQUIRED_ROLES[value.action]) {
    const reference = value.roles[role];
    const key = refKey(reference);
    const utxo = byRef.get(key);
    if (!utxo) throw new Error(`Required real Preprod UTxO was not found for role ${role}: ${key}.`);
    if (role === 'seed' || role === 'fee' || role === 'collateral') {
      assertAdaOnly(utxo, `${role} UTxO`);
      if (utxo.datum != null || utxo.datumHash != null || utxo.script != null) {
        throw new Error(`${role} UTxO must be a plain wallet output without datum/reference script.`);
      }
    }
    if (role === 'state') assertStateUtxo(utxo);
    roleEvidence[role] = Object.freeze({
      reference,
      address: utxo.address,
      lovelace: adaLovelace(utxo, `${role} UTxO`),
      valueSha256: hashCardanoEvidence(utxo.value),
      datumPresent: utxo.datum != null,
      referenceScriptPresent: utxo.script != null
    });
  }

  if (byRef.size !== REQUIRED_ROLES[value.action].length) {
    throw new Error('Real UTxO query returned unexpected extra outputs; exact role/reference binding is required.');
  }

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-real-utxo-binding-evidence.v1',
    network: 'preprod',
    action: value.action,
    planSha256: value.planSha256,
    stableTip: Object.freeze({ hash: beforeHash, slot: beforeSlot }),
    roles: Object.freeze(roleEvidence),
    realUtxoReferencesExist: true,
    exactRoleReferenceBinding: true,
    phaseOneState: Object.freeze({
      realUtxoBindingComplete: true,
      transactionReconstructionAgainstRealUtxosComplete: false,
      balanceValidated: false,
      minimumAdaValidated: false,
      collateralValidated: false,
      witnessesValidated: false,
      fullPhaseOneValidated: false
    }),
    liveActions: Object.freeze({
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false,
      publicNetworkRecoveryProven: false,
      supportClaimAuthorized: false
    }),
    nextGate: 'reconstruct-exact-unsigned-candidate-against-these-real-utxos-and-run-complete-phase-one-validation',
    authorityBoundary: 'This evidence proves only that the explicitly selected role UTxOs existed at one stable Cardano Preprod tip and met OmegaVault role-shape constraints. It does not validate a transaction, authorize signing/submission, prove finality/recovery, or promote Cardano support.'
  });

  return Object.freeze({ ...core, evidenceSha256: hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodRealUtxoBindingEvidence({ evidence, ...inputs }) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['Cardano real UTxO binding evidence is required.']), recomputedSha256: null });
  }
  const errors = [];
  let recomputed;
  try {
    recomputed = createCardanoPreprodRealUtxoBindingEvidence(inputs);
  } catch (error) {
    return Object.freeze({ valid: false, errors: Object.freeze([error.message]), recomputedSha256: null });
  }
  if (evidence.evidenceSha256 !== recomputed.evidenceSha256) errors.push('Cardano real UTxO binding evidence digest mismatch.');
  if (hashCardanoEvidence(withoutDigest(evidence, 'evidenceSha256')) !== evidence.evidenceSha256) {
    errors.push('Cardano real UTxO binding evidence self-digest mismatch.');
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), recomputedSha256: recomputed.evidenceSha256 });
}
