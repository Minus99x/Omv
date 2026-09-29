import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildSolanaInitializeInstruction } from '../src/chains/solana/program-codec.js';

const root = new URL('../', import.meta.url);
const [evidence, rustSource, cargoToml, cargoLock, clientSource, programTest, sbfArtifact] = await Promise.all([
  readFile(new URL('docs/evidence/SOLANA_PROGRAM_BUILD_0.6.17.json', root), 'utf8').then(JSON.parse),
  readFile(new URL('validators/solana/src/lib.rs', root)),
  readFile(new URL('validators/solana/Cargo.toml', root)),
  readFile(new URL('validators/solana/Cargo.lock', root)),
  readFile(new URL('src/chains/solana/program-codec.js', root)),
  readFile(new URL('validators/solana/tests/native_recovery.rs', root)),
  readFile(new URL('artifacts/solana/omegavault_solana_recovery.so', root))
]);
const sha256 = value => createHash('sha256').update(value).digest('hex');

assert.equal(evidence.fixture, 'synthetic-non-deployable');
assert.equal(evidence.toolchain.compilationVerified, true);
assert.equal(evidence.toolchain.sbfProgramTestVerified, true);
assert.deepEqual({
  rustSha256: sha256(rustSource),
  cargoTomlSha256: sha256(cargoToml),
  cargoLockSha256: sha256(cargoLock),
  clientCodecSha256: sha256(clientSource),
  programTestSha256: sha256(programTest)
}, evidence.sources);
assert.equal(sha256(sbfArtifact), evidence.artifact.sha256);
assert.equal(sbfArtifact.length, evidence.artifact.bytes);
assert.match(cargoToml.toString(), /solana-program = "=5\.1\.0"/);
assert.match(cargoToml.toString(), /solana-system-interface = \{ version = "=3\.3\.0", features = \["bincode"\] \}/);
assert.match(cargoToml.toString(), /solana-program-test = \{ version = "=4\.3\.0", features = \["agave-unstable-api"\] \}/);

const instruction = buildSolanaInitializeInstruction({
  programId: evidence.programId, payer: evidence.payer, owner: evidence.owner,
  rescueDestination: evidence.rescueDestination, contacts: evidence.contacts,
  threshold: evidence.threshold, inactivitySeconds: evidence.inactivitySeconds, vaultId: evidence.vaultId
});
assert.equal(instruction.statePda, evidence.statePda);
assert.equal(instruction.stateBump, evidence.stateBump);
assert.equal(instruction.custodyPda, evidence.custodyPda);
assert.equal(instruction.custodyBump, evidence.custodyBump);
assert.equal(instruction.stateBytes, evidence.stateBytes);
assert.equal(instruction.dataHex, evidence.initializeDataHex);
assert.equal(sha256(Buffer.from(instruction.dataHex, 'hex')), evidence.initializeDataSha256);
assert.deepEqual(instruction.keys, evidence.accountRoles);
assert.equal(evidence.liveSubmissionReady, false);
assert.equal(evidence.offlineTests.passed, 2);
assert.deepEqual(evidence.offlineTests.coveredInstructions, ["initialize", "heartbeat", "approve", "execute-native"]);

const rust = rustSource.toString();
for (const required of [
  'Pubkey::find_program_address', 'invoke_signed', 'Clock::get()', 'owner.is_signer',
  'signer.is_signer', 'state.approvals = 0', 'state.approvals.count_ones()',
  'state.rescue != *rescue.key', 'custody.owner != program_id', 'create_or_claim_pda',
  'pda.lamports() < required_lamports', 'allocate(pda.key', 'assign(pda.key'
]) assert.ok(rust.includes(required), `missing Rust gate: ${required}`);

console.log(`Solana SBF build/source/codec evidence verified: ${evidence.artifact.sha256}`);
