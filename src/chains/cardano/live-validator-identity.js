import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { createHash } from 'node:crypto';
import { hashCardanoEvidence } from './evidence-binding.js';
import {
  CARDANO_PREPROD_NETWORK_ID,
  deriveCardanoEnterpriseScriptAddress
} from './transaction-body.js';

const HEX_28 = /^[0-9a-f]{56}$/i;
const HEX_32 = /^[0-9a-f]{64}$/i;
const HEX = /^[0-9a-f]*$/i;

function normalizeSeedReference(seedReference) {
  const txId = String(seedReference?.transaction?.id ?? '').toLowerCase();
  const index = Number(seedReference?.index);
  if (!HEX_32.test(txId)) throw new TypeError('seedReference.transaction.id must be 32-byte hex.');
  if (!Number.isSafeInteger(index) || index < 0) throw new TypeError('seedReference.index must be a non-negative safe integer.');
  return Object.freeze({ transaction: Object.freeze({ id: txId }), index });
}

function normalizeAssetName(assetNameHex) {
  const value = String(assetNameHex ?? '').toLowerCase();
  if (!HEX.test(value) || value.length % 2 !== 0 || value.length > 64) {
    throw new TypeError('assetNameHex must be 0-32 bytes of base16.');
  }
  return value;
}

function canonicalCborUnsigned(value) {
  const n = BigInt(value);
  if (n < 0n) throw new TypeError('CBOR unsigned integer cannot be negative.');
  if (n < 24n) return n.toString(16).padStart(2, '0');
  if (n <= 0xffn) return `18${n.toString(16).padStart(2, '0')}`;
  if (n <= 0xffffn) return `19${n.toString(16).padStart(4, '0')}`;
  if (n <= 0xffffffffn) return `1a${n.toString(16).padStart(8, '0')}`;
  if (n <= 0xffffffffffffffffn) return `1b${n.toString(16).padStart(16, '0')}`;
  throw new RangeError('CBOR unsigned integer exceeds uint64.');
}

function canonicalCborBytes(hexValue) {
  const bytes = Buffer.from(hexValue, 'hex');
  const length = bytes.length;
  const header = length < 24
    ? (0x40 + length).toString(16).padStart(2, '0')
    : `58${length.toString(16).padStart(2, '0')}`;
  return `${header}${hexValue}`;
}

export function encodeCardanoOutputReferencePlutusData(seedReference) {
  const seed = normalizeSeedReference(seedReference);
  // Aiken blueprint application is byte-sensitive. Use the same definite-list
  // canonical PlutusData encoding produced by the pinned fixture workflow:
  // Constr 0 (tag 121) + definite array[2] + bytes32 tx id + unsigned index.
  return `d87982${canonicalCborBytes(seed.transaction.id)}${canonicalCborUnsigned(seed.index)}`;
}

export function encodeCardanoAssetNamePlutusData(assetNameHex) {
  return canonicalCborBytes(normalizeAssetName(assetNameHex));
}

function compiledScriptIdentity(compiledCode, label) {
  if (typeof compiledCode !== 'string' || !compiledCode || !HEX.test(compiledCode) || compiledCode.length % 2 !== 0) {
    throw new TypeError(`${label} compiledCode must be non-empty base16.`);
  }
  const script = Cardano.PlutusScript.new_v3(Uint8Array.from(Buffer.from(compiledCode, 'hex')));
  return Object.freeze({
    compiledCode,
    compiledCodeSha256: createHash('sha256').update(compiledCode).digest('hex'),
    scriptHash: script.hash().to_hex()
  });
}

export function createCardanoPreprodAppliedValidatorIdentity({
  seedReference,
  assetNameHex,
  sourceBlueprintSha256,
  beaconCompiledCode,
  recoveryCompiledCode,
  aikenPolicyId = null,
  aikenRecoveryHash = null,
  aikenRecoveryAddress = null
}) {
  const seed = normalizeSeedReference(seedReference);
  const asset = normalizeAssetName(assetNameHex);
  if (!HEX_32.test(String(sourceBlueprintSha256 ?? ''))) throw new TypeError('sourceBlueprintSha256 must be SHA-256 hex.');

  const beacon = compiledScriptIdentity(beaconCompiledCode, 'beacon');
  const recovery = compiledScriptIdentity(recoveryCompiledCode, 'recovery');
  const recoveryAddress = deriveCardanoEnterpriseScriptAddress({
    scriptHash: recovery.scriptHash,
    networkId: CARDANO_PREPROD_NETWORK_ID
  });

  if (aikenPolicyId != null && String(aikenPolicyId).toLowerCase() !== beacon.scriptHash) {
    throw new Error('Aiken policy id does not match the independently derived Plutus V3 beacon script hash.');
  }
  if (aikenRecoveryHash != null && String(aikenRecoveryHash).toLowerCase() !== recovery.scriptHash) {
    throw new Error('Aiken recovery hash does not match the independently derived Plutus V3 recovery script hash.');
  }
  if (aikenRecoveryAddress != null && String(aikenRecoveryAddress) !== recoveryAddress) {
    throw new Error('Aiken recovery address does not match the independently derived Preprod script address.');
  }

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-applied-validator-identity.v1',
    network: 'preprod',
    networkId: CARDANO_PREPROD_NETWORK_ID,
    seedReference: seed,
    assetNameHex: asset,
    sourceBlueprintSha256: String(sourceBlueprintSha256).toLowerCase(),
    stateBeacon: Object.freeze({
      policyId: beacon.scriptHash,
      compiledCode: beacon.compiledCode,
      compiledCodeSha256: beacon.compiledCodeSha256
    }),
    recoveryVault: Object.freeze({
      scriptHash: recovery.scriptHash,
      address: recoveryAddress,
      compiledCode: recovery.compiledCode,
      compiledCodeSha256: recovery.compiledCodeSha256
    }),
    deterministicFromSeedAndAssetName: true,
    liveUtxoExistenceValidated: false,
    fullPhaseOneValidated: false,
    walletSigningAuthorized: false,
    transactionSubmissionAuthorized: false,
    liveValueMovementAuthorized: false,
    supportClaimAuthorized: false,
    authorityBoundary: 'This identity only applies the OmegaVault Aiken validators to a chosen Preprod seed reference and asset name. It performs no network query, wallet signing, transaction submission, value movement, finality proof or support promotion.'
  });

  return Object.freeze({ ...core, identitySha256: hashCardanoEvidence(core) });
}
