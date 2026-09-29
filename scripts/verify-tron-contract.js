import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'contracts/manifest-tron-0.6.3-dev.json'), 'utf8'));

function bytes(path) {
  return readFileSync(resolve(root, path));
}

function json(path) {
  return JSON.parse(bytes(path).toString('utf8'));
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const [field, path] of [
  ['sourceSha256', manifest.source], ['artifactSha256', manifest.artifact],
  ['buildInputSha256', manifest.buildInput], ['buildOutputSha256', manifest.buildOutput]
]) {
  assert(hash(bytes(path)) === manifest.hashes[field], `${field} mismatch.`);
}

const source = bytes(manifest.source).toString('utf8');
const artifact = json(manifest.artifact);
const input = json(manifest.buildInput);
const output = json(manifest.buildOutput);
const contract = output.contracts?.['OmegaVaultRecoveryVaultTRONV063.sol']?.[manifest.contractName];

assert(input.sources?.['OmegaVaultRecoveryVaultTRONV063.sol']?.content === source, 'Build input source does not match checked source.');
assert(input.settings?.optimizer?.enabled === true && input.settings?.optimizer?.runs === 200, 'Pinned optimizer settings do not match.');
assert(artifact.contractName === manifest.contractName, 'Artifact contract name mismatch.');
assert(artifact.compiler?.version === manifest.compiler.version, 'TRON compiler version mismatch.');
assert(contract?.evm?.bytecode?.object && contract?.evm?.deployedBytecode?.object, 'Build output is missing bytecode.');
assert((artifact.bytecode ?? '').replace(/^0x/, '') === contract.evm.bytecode.object, 'Artifact creation bytecode differs from build output.');
assert((artifact.deployedBytecode ?? '').replace(/^0x/, '') === contract.evm.deployedBytecode.object, 'Artifact runtime bytecode differs from build output.');
assert(hash(Buffer.from(contract.evm.bytecode.object, 'hex')) === manifest.hashes.creationBytecodeSha256, 'Creation bytecode hash mismatch.');
assert(hash(Buffer.from(contract.evm.deployedBytecode.object, 'hex')) === manifest.hashes.runtimeBytecodeSha256, 'Runtime bytecode hash mismatch.');
assert(!(output.errors ?? []).some(error => error.severity === 'error'), 'Compiler output contains an error.');
assert(Object.keys(contract.evm.deployedBytecode.immutableReferences ?? {}).length === 4, 'Expected four immutable constructor fields.');

console.log(JSON.stringify({
  ok: true,
  contractName: manifest.contractName,
  compiler: manifest.compiler.version,
  sourceSha256: manifest.hashes.sourceSha256,
  creationBytes: contract.evm.bytecode.object.length / 2,
  runtimeBytes: contract.evm.deployedBytecode.object.length / 2,
  immutableFields: Object.keys(contract.evm.deployedBytecode.immutableReferences).length
}));
