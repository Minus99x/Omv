import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCardanoPreprodAppliedValidatorIdentity,
  encodeCardanoAssetNamePlutusData,
  encodeCardanoOutputReferencePlutusData,
  verifyCardanoPreprodAppliedValidatorIdentity
} from '../src/chains/cardano/live-validator-identity.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const beacon = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/state-beacon.applied.json', import.meta.url), 'utf8'));
const vault = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/recovery-vault.applied.json', import.meta.url), 'utf8'));
const evidence = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_APPLIED_FIXTURE_0.6.12.json', import.meta.url), 'utf8'));
const beaconCode = beacon.validators.find(item => item.title === 'omegavault.state_beacon.mint').compiledCode;
const recoveryCode = vault.validators.find(item => item.title === 'omegavault.recovery_vault.spend').compiledCode;

test('Cardano live validator parameter encoders reproduce canonical synthetic fixture data', () => {
  const seed = {
    transaction: { id: evidence.parameters.seedTxId },
    index: evidence.parameters.seedOutputIndex
  };
  assert.equal(
    encodeCardanoOutputReferencePlutusData(seed),
    `d879825820${evidence.parameters.seedTxId}00`
  );
  assert.equal(
    encodeCardanoAssetNamePlutusData(evidence.parameters.assetNameHex),
    `42${evidence.parameters.assetNameHex}`
  );
});

test('Cardano live validator parameter encoders use canonical CBOR beyond the tiny fixture case', () => {
  const txId = 'cd'.repeat(32);
  assert.equal(
    encodeCardanoOutputReferencePlutusData({ transaction: { id: txId }, index: 24 }),
    `d879825820${txId}1818`
  );
  const asset = 'ab'.repeat(24);
  assert.equal(encodeCardanoAssetNamePlutusData(asset), `5818${asset}`);
});

test('Cardano applied identity independently matches packaged synthetic validator identities', () => {
  const result = createCardanoPreprodAppliedValidatorIdentity({
    seedReference: {
      transaction: { id: evidence.parameters.seedTxId },
      index: evidence.parameters.seedOutputIndex
    },
    assetNameHex: evidence.parameters.assetNameHex,
    sourceBlueprintSha256: 'aa'.repeat(32),
    beaconCompiledCode: beaconCode,
    recoveryCompiledCode: recoveryCode,
    aikenPolicyId: evidence.stateBeacon.policyId,
    aikenRecoveryHash: evidence.recoveryVault.scriptHash,
    aikenRecoveryAddress: evidence.recoveryVault.preprodAddress
  });
  assert.equal(result.stateBeacon.policyId, evidence.stateBeacon.policyId);
  assert.equal(result.recoveryVault.scriptHash, evidence.recoveryVault.scriptHash);
  assert.equal(result.recoveryVault.address, evidence.recoveryVault.preprodAddress);
  assert.equal(result.network, 'preprod');
  assert.equal(result.liveUtxoExistenceValidated, false);
  assert.equal(result.fullPhaseOneValidated, false);
  assert.equal(result.walletSigningAuthorized, false);
  assert.equal(result.transactionSubmissionAuthorized, false);
  assert.match(result.identitySha256, /^[0-9a-f]{64}$/);
});

test('Cardano applied identity verifier accepts provenance wrapper but rejects identity tampering', () => {
  const identity = createCardanoPreprodAppliedValidatorIdentity({
    seedReference: {
      transaction: { id: evidence.parameters.seedTxId },
      index: evidence.parameters.seedOutputIndex
    },
    assetNameHex: evidence.parameters.assetNameHex,
    sourceBlueprintSha256: 'aa'.repeat(32),
    beaconCompiledCode: beaconCode,
    recoveryCompiledCode: recoveryCode,
    aikenPolicyId: evidence.stateBeacon.policyId,
    aikenRecoveryHash: evidence.recoveryVault.scriptHash,
    aikenRecoveryAddress: evidence.recoveryVault.preprodAddress
  });
  assert.equal(verifyCardanoPreprodAppliedValidatorIdentity(identity).valid, true);
  assert.equal(verifyCardanoPreprodAppliedValidatorIdentity({
    ...identity,
    provenance: { aikenVersion: 'fixture' }
  }).valid, true);

  const tampered = structuredClone(identity);
  tampered.stateBeacon.policyId = 'ff'.repeat(28);
  assert.equal(verifyCardanoPreprodAppliedValidatorIdentity(tampered).valid, false);

  assert.equal(verifyCardanoPreprodAppliedValidatorIdentity({
    ...identity,
    unexpected: true
  }).valid, false);
});

test('Cardano live validator derivation CLI reproduces synthetic Aiken policy/hash/address', () => {
  const stdout = execFileSync(process.execPath, [
    'scripts/derive-cardano-preprod-live-validators.js',
    '--seed-tx-id', evidence.parameters.seedTxId,
    '--seed-index', String(evidence.parameters.seedOutputIndex),
    '--asset-name-hex', evidence.parameters.assetNameHex
  ], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const result = JSON.parse(stdout);
  assert.equal(result.stateBeacon.policyId, evidence.stateBeacon.policyId);
  assert.equal(result.recoveryVault.scriptHash, evidence.recoveryVault.scriptHash);
  assert.equal(result.recoveryVault.address, evidence.recoveryVault.preprodAddress);
  assert.equal(result.networkRequestsPerformed, false);
  assert.equal(result.walletSigningPerformed, false);
  assert.equal(result.transactionSubmissionPerformed, false);
  assert.equal(result.output, null);
});
