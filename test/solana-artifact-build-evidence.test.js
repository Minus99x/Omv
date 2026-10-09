import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSolanaSbfBuildEvidence,
  verifySolanaSbfBuildEvidence
} from '../src/chains/solana/artifact-build-evidence.js';

function validInput(){
  return {
    sourceCommitSha:'ab'.repeat(20),
    sources:{
      rustSha256:'11'.repeat(32),
      cargoTomlSha256:'22'.repeat(32),
      cargoLockSha256:'33'.repeat(32),
      clientCodecSha256:'44'.repeat(32),
      programTestSha256:'55'.repeat(32)
    },
    toolchain:{
      rustc:'1.98.1',
      cargo:'1.98.1',
      agaveCli:'4.3.0',
      cargoBuildSbf:'4.3.0',
      platformTools:'1.57',
      solanaProgramCrate:'5.1.0',
      solanaSystemInterfaceCrate:'3.3.0',
      solanaProgramTestCrate:'4.3.0'
    },
    artifact:{
      path:'artifacts/solana/omegavault_solana_recovery.so',
      sha256:'66'.repeat(32),
      bytes:92120
    },
    programTest:{
      loadsCompiledSbf:true,
      passed:8,
      failed:0,
      coveredInstructions:['initialize','heartbeat','approve','execute-native'],
      adversarialGates:[
        'inactivity-pending',
        'unknown-contact',
        'threshold-pending',
        'wrong-rescue',
        'heartbeat-approval-reset',
        'post-recovery-lockout'
      ],
      nativeLamportMovementVerified:true
    },
    programId:'AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9'
  };
}

test('Solana rebuilt artifact evidence binds exact source, toolchain, SBF artifact and compiled program-test',()=>{
  const evidence=createSolanaSbfBuildEvidence(validInput());
  assert.equal(evidence.trustState.sourceBound,true);
  assert.equal(evidence.trustState.toolchainBound,true);
  assert.equal(evidence.trustState.artifactIdentityBound,true);
  assert.equal(evidence.trustState.compiledSbfExecuted,true);
  assert.equal(evidence.trustState.artifactTrusted,true);
  assert.equal(evidence.trustState.devnetDeploymentProven,false);
  assert.equal(evidence.trustState.liveSubmissionReady,false);
  assert.equal(evidence.trustState.supportClaimAuthorized,false);
  assert.match(evidence.evidenceSha256,/^[0-9a-f]{64}$/);

  const verified=verifySolanaSbfBuildEvidence(evidence);
  assert.equal(verified.valid,true,verified.errors.join('; '));
});

test('Solana SBF evidence rejects host-only tests that did not load the compiled artifact',()=>{
  const input=validInput();
  input.programTest={ ...input.programTest,loadsCompiledSbf:false };
  assert.throws(
    ()=>createSolanaSbfBuildEvidence(input),
    /requires program-test to load the compiled SBF artifact/
  );
});

test('Solana SBF evidence rejects any program-test failure',()=>{
  const input=validInput();
  input.programTest={ ...input.programTest,failed:1 };
  assert.throws(
    ()=>createSolanaSbfBuildEvidence(input),
    /cannot become trusted while SBF program-test failures remain/
  );
});

test('Solana SBF evidence requires complete lifecycle instruction coverage',()=>{
  const input=validInput();
  input.programTest={
    ...input.programTest,
    coveredInstructions:['initialize','heartbeat','approve']
  };
  assert.throws(
    ()=>createSolanaSbfBuildEvidence(input),
    /missing lifecycle instruction coverage: execute-native/
  );
});

test('Solana SBF evidence digest fails closed on artifact identity mutation',()=>{
  const evidence=createSolanaSbfBuildEvidence(validInput());
  const tampered={
    ...evidence,
    artifact:{ ...evidence.artifact,bytes:evidence.artifact.bytes+1 }
  };
  const verified=verifySolanaSbfBuildEvidence(tampered);
  assert.equal(verified.valid,false);
  assert.ok(verified.errors.some(item=>/self-digest mismatch|does not reproduce/i.test(item)));
});
