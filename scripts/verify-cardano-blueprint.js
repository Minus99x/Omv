import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const evidence = JSON.parse(await readFile(new URL('docs/evidence/CARDANO_AIKEN_1_1_24.json', root), 'utf8'));
const source = await readFile(new URL('validators/cardano/validators/omegavault.ak', root));
const blueprintBytes = await readFile(new URL('validators/cardano/plutus.json', root));
const blueprint = JSON.parse(blueprintBytes);
const sha256 = value => createHash('sha256').update(value).digest('hex');

assert.equal(sha256(source), evidence.artifacts.sourceSha256);
assert.equal(sha256(blueprintBytes), evidence.artifacts.blueprintSha256);
assert.equal(blueprint.preamble.compiler.version, 'v1.1.24+bacbeb3');
assert.equal(blueprint.preamble.plutusVersion, 'v3');
assert.equal(blueprint.preamble.version, '0.6.12');

const validators = new Map(blueprint.validators.map(validator => [validator.title, validator]));
const recovery = validators.get('omegavault.recovery_vault.spend');
const beacon = validators.get('omegavault.state_beacon.mint');
assert.ok(recovery, 'recovery spending validator missing from CIP-57 blueprint');
assert.ok(beacon, 'state-beacon minting validator missing from CIP-57 blueprint');
assert.equal(recovery.hash, evidence.artifacts.recoveryVaultBlueprintHash);
assert.equal(beacon.hash, evidence.artifacts.stateBeaconBlueprintHash);
assert.deepEqual(recovery.parameters.map(parameter => parameter.title), ['beacon_policy', 'beacon_name']);
assert.deepEqual(beacon.parameters.map(parameter => parameter.title), ['seed', 'asset_name']);
assert.equal(evidence.promotion.connectorLiveProof, false);

console.log(`Verified Cardano ${evidence.toolchain.compiler} CIP-57 blueprint and source evidence.`);
