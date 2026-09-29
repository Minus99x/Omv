import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CARDANO_APPLIED_FIXTURE,
  buildCardanoTransactionBodyFixture,
  deriveCardanoEnterpriseScriptAddress
} from '../src/chains/cardano/transaction-body.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cardanoDir = join(root, 'validators', 'cardano');
const aiken = join(root, 'node_modules', '.bin', 'aiken');
const evidence = JSON.parse(readFileSync(join(root, 'docs', 'evidence', 'CARDANO_APPLIED_FIXTURE_0.6.12.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'omegavault-cardano-applied-'));

const sha256File = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const sha256Text = value => createHash('sha256').update(value).digest('hex');
const run = args => execFileSync(aiken, args, { cwd: cardanoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const blueprintValidator = (path, title) => JSON.parse(readFileSync(path, 'utf8')).validators.find(item => item.title === title);

try {
  if (evidence.deployable !== false || evidence.purpose !== 'offline-reproducibility-only') throw new Error('Fixture evidence must remain explicitly non-deployable.');
  const beaconStep = join(work, 'beacon-step.json');
  const beaconApplied = join(work, 'beacon-applied.json');
  const vaultStep = join(work, 'vault-step.json');
  const vaultApplied = join(work, 'vault-applied.json');
  const seedData = `d879825820${evidence.parameters.seedTxId}00`;
  const assetData = `${(evidence.parameters.assetNameHex.length / 2 + 64).toString(16)}${evidence.parameters.assetNameHex}`;

  run(['blueprint', 'apply', '-m', 'omegavault', '-v', 'state_beacon', seedData, '-i', 'plutus.json', '-o', beaconStep]);
  run(['blueprint', 'apply', '-m', 'omegavault', '-v', 'state_beacon', assetData, '-i', beaconStep, '-o', beaconApplied]);
  const policyId = run(['blueprint', 'policy', '-m', 'omegavault', '-v', 'state_beacon', '-i', beaconApplied]);
  if (policyId !== evidence.stateBeacon.policyId || policyId !== CARDANO_APPLIED_FIXTURE.beaconPolicyId) throw new Error('Applied state-beacon policy id mismatch.');

  run(['blueprint', 'apply', '-m', 'omegavault', '-v', 'recovery_vault', `581c${policyId}`, '-i', 'plutus.json', '-o', vaultStep]);
  run(['blueprint', 'apply', '-m', 'omegavault', '-v', 'recovery_vault', assetData, '-i', vaultStep, '-o', vaultApplied]);
  const vaultHash = run(['blueprint', 'hash', '-m', 'omegavault', '-v', 'recovery_vault', '-i', vaultApplied]);
  const vaultAddress = run(['blueprint', 'address', '-m', 'omegavault', '-v', 'recovery_vault', '-i', vaultApplied]);
  if (vaultHash !== evidence.recoveryVault.scriptHash || vaultAddress !== evidence.recoveryVault.preprodAddress) throw new Error('Applied recovery-vault identity mismatch.');
  if (deriveCardanoEnterpriseScriptAddress({ scriptHash: vaultHash }) !== vaultAddress) throw new Error('Independent CSL address derivation mismatch.');

  const packagedBeacon = join(cardanoDir, 'fixtures', 'state-beacon.applied.json');
  const packagedVault = join(cardanoDir, 'fixtures', 'recovery-vault.applied.json');
  if (sha256File(packagedBeacon) !== evidence.stateBeacon.appliedBlueprintSha256 || sha256File(beaconApplied) !== evidence.stateBeacon.appliedBlueprintSha256) throw new Error('State-beacon applied blueprint hash mismatch.');
  if (sha256File(packagedVault) !== evidence.recoveryVault.appliedBlueprintSha256 || sha256File(vaultApplied) !== evidence.recoveryVault.appliedBlueprintSha256) throw new Error('Recovery-vault applied blueprint hash mismatch.');
  if (sha256Text(blueprintValidator(packagedBeacon, 'omegavault.state_beacon.mint').compiledCode) !== evidence.stateBeacon.compiledCodeSha256) throw new Error('Applied state-beacon compiled-code hash mismatch.');
  if (sha256Text(blueprintValidator(packagedVault, 'omegavault.recovery_vault.spend').compiledCode) !== evidence.recoveryVault.compiledCodeSha256) throw new Error('Applied recovery-vault compiled-code hash mismatch.');

  for (const action of ['initialize', 'heartbeat', 'approve', 'execute']) {
    const body = buildCardanoTransactionBodyFixture(action);
    if (body.bodyHashHex !== evidence.transactionBodies[action].blake2b256 || body.bytes !== evidence.transactionBodies[action].bytes) throw new Error(`${action} transaction-body fixture mismatch.`);
  }
  console.log(`Verified Cardano applied policy/address and four canonical transaction-body fixtures with Aiken ${evidence.toolchain.aiken} and CSL ${evidence.toolchain.cardanoSerializationLib}.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
