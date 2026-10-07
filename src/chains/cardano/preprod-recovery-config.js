import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { hashCardanoEvidence } from './evidence-binding.js';
import { CARDANO_PREPROD_NETWORK_ID } from './transaction-body.js';

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}

function safePositiveInteger(value, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new TypeError(`${label} must be a positive safe integer.`);
  return n;
}

function positiveIntegerString(value, label) {
  const normalized = String(value);
  if (!/^\d+$/.test(normalized) || BigInt(normalized) < 1n) throw new TypeError(`${label} must be a positive integer.`);
  return normalized;
}

export function cardanoPreprodPaymentKeyHashFromAddress(address, label = 'address') {
  if (typeof address !== 'string' || !address) throw new TypeError(`${label} is required.`);
  let decoded;
  try {
    decoded = Cardano.Address.from_bech32(address);
  } catch {
    throw new Error(`${label} is not a valid Cardano bech32 address.`);
  }
  if (decoded.network_id() !== CARDANO_PREPROD_NETWORK_ID) {
    throw new Error(`${label} must use Cardano Preprod/testnet network id ${CARDANO_PREPROD_NETWORK_ID}.`);
  }

  const candidate =
    Cardano.BaseAddress.from_address(decoded) ??
    Cardano.EnterpriseAddress.from_address(decoded) ??
    Cardano.PointerAddress.from_address(decoded);
  if (!candidate) throw new Error(`${label} must be a Shelley-style spendable address.`);
  const keyHash = candidate.payment_cred().to_keyhash();
  if (!keyHash) throw new Error(`${label} must use a payment verification key, not a script credential.`);
  return keyHash.to_hex();
}

function withoutDigest(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'configurationSha256'));
}

export function createCardanoPreprodRecoveryConfiguration({
  rescueAddress,
  contactAddresses,
  threshold,
  inactivityMs,
  stateLovelace = '10000000'
}) {
  const rescueKeyHash = cardanoPreprodPaymentKeyHashFromAddress(rescueAddress, 'rescueAddress');
  if (!Array.isArray(contactAddresses) || contactAddresses.length < 1) {
    throw new TypeError('contactAddresses must contain at least one trusted-contact address.');
  }
  const normalizedContactAddresses = contactAddresses.map((address, index) => {
    if (typeof address !== 'string' || !address) throw new TypeError(`contactAddresses[${index}] is required.`);
    return address;
  });
  const contactKeyHashes = normalizedContactAddresses.map((address, index) =>
    cardanoPreprodPaymentKeyHashFromAddress(address, `contactAddresses[${index}]`)
  );

  if (new Set(contactKeyHashes).size !== contactKeyHashes.length) {
    throw new Error('Trusted-contact payment keys must be unique.');
  }
  if (contactKeyHashes.includes(rescueKeyHash)) {
    throw new Error('The rescue destination cannot also be a trusted-contact approval key.');
  }

  const requiredThreshold = safePositiveInteger(threshold, 'threshold');
  if (requiredThreshold > contactKeyHashes.length) throw new Error('Recovery threshold must be reachable by the configured trusted contacts.');
  const inactivity = safePositiveInteger(inactivityMs, 'inactivityMs');
  const protectedLovelace = positiveIntegerString(stateLovelace, 'stateLovelace');

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-recovery-configuration.v1',
    network: 'preprod',
    networkId: CARDANO_PREPROD_NETWORK_ID,
    rescueAddress,
    rescueKeyHash,
    contactAddresses: Object.freeze([...normalizedContactAddresses]),
    contactKeyHashes: Object.freeze([...contactKeyHashes]),
    threshold: requiredThreshold,
    inactivityMs: inactivity,
    stateLovelace: protectedLovelace,
    contactsAreApproversOnly: true,
    contactsCannotRedirectDestination: true,
    destinationSeparatedFromApprovers: true,
    walletSigningAuthorized: false,
    transactionSubmissionAuthorized: false,
    liveValueMovementAuthorized: false,
    supportClaimAuthorized: false,
    authorityBoundary: 'This configuration fixes the Cardano Preprod rescue destination and trusted-contact approval keys. It creates no transaction, signature, submission or support claim.'
  });
  return Object.freeze({ ...core, configurationSha256: hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodRecoveryConfiguration(configuration) {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['Cardano Preprod recovery configuration is required.']), recomputedSha256: null });
  }
  const errors = [];
  let recomputed;
  try {
    const value = plainObject(configuration, 'configuration');
    recomputed = createCardanoPreprodRecoveryConfiguration({
      rescueAddress: value.rescueAddress,
      contactAddresses: value.contactAddresses,
      threshold: value.threshold,
      inactivityMs: value.inactivityMs,
      stateLovelace: value.stateLovelace
    });
  } catch (error) {
    return Object.freeze({ valid: false, errors: Object.freeze([error.message]), recomputedSha256: null });
  }

  if (configuration.schema !== recomputed.schema ||
      configuration.network !== recomputed.network ||
      configuration.networkId !== recomputed.networkId ||
      configuration.rescueKeyHash !== recomputed.rescueKeyHash ||
      JSON.stringify(configuration.contactKeyHashes) !== JSON.stringify(recomputed.contactKeyHashes) ||
      configuration.contactsAreApproversOnly !== true ||
      configuration.contactsCannotRedirectDestination !== true ||
      configuration.destinationSeparatedFromApprovers !== true ||
      configuration.walletSigningAuthorized !== false ||
      configuration.transactionSubmissionAuthorized !== false ||
      configuration.liveValueMovementAuthorized !== false ||
      configuration.supportClaimAuthorized !== false) {
    errors.push('Cardano Preprod recovery configuration content or authority boundary does not match its deterministic address-derived form.');
  }
  if (hashCardanoEvidence(withoutDigest(configuration)) !== configuration.configurationSha256) {
    errors.push('Cardano Preprod recovery configuration self-digest mismatch.');
  }
  if (configuration.configurationSha256 !== recomputed.configurationSha256) {
    errors.push('Cardano Preprod recovery configuration does not reproduce from its addresses and policy values.');
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    recomputedSha256: recomputed.configurationSha256
  });
}
