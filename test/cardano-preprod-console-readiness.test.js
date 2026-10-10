import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';

const cli=resolve('scripts/cardano-preprod-console-readiness.js');
const fakeName='omegavault-cardano-preprod-real-initialize-fixture';
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'omegavault-cardano-console-'));
  const capture=join(root,fakeName);
  mkdirSync(capture,{recursive:true});
  mkdirSync(join(capture,'wallet-signing'));
  const candidate={schema:'fixture-unsigned-candidate',validity:{lowerSlot:86400,upperSlot:87000}};
  writeFileSync(join(capture,'unsigned.json'),JSON.stringify(candidate));
  const manifest={
    schema:'omegavault.cardano.preprod-real-initialize-capture-manifest.v1',
    network:'preprod',
    files:{finalUnsignedCandidate:'unsigned.json'},
    fullPhaseOneValidated:false,
    transactionSubmissionAuthorized:false
  };
  manifest.manifestSha256=hashCardanoEvidence(manifest);
  writeFileSync(join(capture,'capture-manifest.json'),JSON.stringify(manifest));
  const witness={
    schema:'omegavault.cardano.preprod-initialize-wallet-witness-evidence.v1',
    signedTransactionCborHex:'deadbeef',
    checks:{ownerSignatureCryptographicallyValid:true,walletWitnessesValidated:true},
    completePhaseOneValidated:false,
    transactionSubmissionAuthorized:false
  };
  witness.witnessEvidenceSha256=hashCardanoEvidence(witness);
  writeFileSync(join(capture,'wallet-signing','wallet-witness-evidence.json'),JSON.stringify(witness));
  return {root,capture};
}
function command(args, env={}) {
  return spawnSync(process.execPath,[cli,...args],{
    cwd:resolve('.'),encoding:'utf8',timeout:10000,
    env:{...process.env,OMEGAVAULT_OGMIOS_URL:'wss://sensitive-test-host.invalid',
      OMEGAVAULT_OGMIOS_API_KEY:'private-test-key-should-not-appear',
      BLOCKFROST_PROJECT_ID:'private-blockfrost-test-id',...env}
  });
}
test('one-command read-only console report finds prior witness, expired evidence and never prints provider secrets',()=>{
  const {root,capture}=fixture();
  try {
    const result=command(['--evidence-root',root]);
    assert.ok([0,2].includes(result.status),result.stderr);
    const report=JSON.parse(result.stdout);
    assert.equal(report.captureCount,1);
    assert.equal(report.captures[0].directory,capture);
    assert.equal(report.captures[0].captureManifestDigestValid,true);
    assert.equal(report.captures[0].ownerWitnessPresent,true);
    assert.equal(report.captures[0].ownerWitnessDigestValid,true);
    assert.equal(report.captures[0].signedTransactionExists,true);
    assert.equal(report.captures[0].estimatedValidityExpired,true);
    assert.equal(report.providerEnvironment.ogmiosUrlConfigured,true);
    assert.equal(report.providerEnvironment.ogmiosApiKeyConfigured,true);
    assert.equal(report.providerEnvironment.blockfrostProjectIdConfigured,true);
    assert.equal(report.providerEnvironment.valuesAndSecretsPrinted,false);
    assert.equal(report.transactionSubmissionAuthorized,false);
    assert.equal(report.completeSignedCurrentLedgerPhaseOneValidated,false);
    for (const secret of ['sensitive-test-host','private-test-key','private-blockfrost-test-id']) {
      assert.equal(result.stdout.includes(secret),false);
      assert.equal(result.stderr.includes(secret),false);
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('fails closed on tampered manifest rather than reporting a verified capture',()=>{
  const {root,capture}=fixture();
  try {
    const manifestPath=join(capture,'capture-manifest.json');
    const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
    manifest.network='mainnet';
    writeFileSync(manifestPath,JSON.stringify(manifest));
    const result=command(['--capture',capture]);
    assert.ok([0,2].includes(result.status),result.stderr);
    const report=JSON.parse(result.stdout);
    assert.equal(report.captures[0].captureManifestDigestValid,false);
    assert.match(report.captures[0].issues.join(' '),/untrusted/);
    assert.equal(report.transactionSubmissionAuthorized,false);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('blocks manifest path traversal even when attacker recomputes the self-digest',()=>{
  const {root,capture}=fixture();
  try {
    const path=join(capture,'capture-manifest.json');
    const manifest=JSON.parse(readFileSync(path,'utf8'));
    manifest.files.finalUnsignedCandidate='../../some-other-file.json';
    delete manifest.manifestSha256;
    manifest.manifestSha256=hashCardanoEvidence(manifest);
    writeFileSync(path,JSON.stringify(manifest));
    const result=command(['--capture',capture]);
    assert.ok([0,2].includes(result.status),result.stderr);
    const report=JSON.parse(result.stdout);
    assert.equal(report.captures[0].captureManifestDigestValid,true);
    assert.match(report.captures[0].issues.join(' '),/path escapes the capture directory/);
    assert.equal(report.transactionSubmissionAuthorized,false);
  } finally {rmSync(root,{recursive:true,force:true});}
});
