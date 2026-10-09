import { createHash } from 'node:crypto';

const SHA256=/^[0-9a-f]{64}$/i;
const GIT_SHA=/^[0-9a-f]{40}$/i;

function stable(value){
  if(Array.isArray(value)) return value.map(stable);
  if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}

function digest(value){
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function textValue(value,label){
  if(typeof value!=='string' || !value.trim()) throw new TypeError(`${label} is required.`);
  return value.trim();
}

function sha256(value,label){
  const normalized=String(value ?? '').toLowerCase();
  if(!SHA256.test(normalized)) throw new TypeError(`${label} must be SHA-256 hex.`);
  return normalized;
}

function gitSha(value,label){
  const normalized=String(value ?? '').toLowerCase();
  if(!GIT_SHA.test(normalized)) throw new TypeError(`${label} must be a 40-character Git SHA.`);
  return normalized;
}

function positiveInteger(value,label){
  const number=Number(value);
  if(!Number.isSafeInteger(number) || number<1) throw new TypeError(`${label} must be a positive safe integer.`);
  return number;
}

function nonNegativeInteger(value,label){
  const number=Number(value);
  if(!Number.isSafeInteger(number) || number<0) throw new TypeError(`${label} must be a non-negative safe integer.`);
  return number;
}

function sourceDigests(value){
  const required=['rustSha256','cargoTomlSha256','cargoLockSha256','clientCodecSha256','programTestSha256'];
  const out={};
  for(const key of required) out[key]=sha256(value?.[key],`sources.${key}`);
  return Object.freeze(out);
}

function toolchain(value){
  const required=['rustc','cargo','agaveCli','cargoBuildSbf','platformTools','solanaProgramCrate','solanaSystemInterfaceCrate','solanaProgramTestCrate'];
  const out={};
  for(const key of required) out[key]=textValue(value?.[key],`toolchain.${key}`);
  return Object.freeze(out);
}

export function createSolanaSbfBuildEvidence({
  sourceCommitSha,
  sources,
  toolchain:toolchainInput,
  artifact,
  programTest,
  programId
}){
  const commit=gitSha(sourceCommitSha,'sourceCommitSha');
  const normalizedSources=sourceDigests(sources);
  const normalizedToolchain=toolchain(toolchainInput);
  const artifactPath=textValue(artifact?.path,'artifact.path');
  const artifactSha256=sha256(artifact?.sha256,'artifact.sha256');
  const artifactBytes=positiveInteger(artifact?.bytes,'artifact.bytes');
  const id=textValue(programId,'programId');

  if(programTest?.loadsCompiledSbf!==true) throw new Error('Solana build evidence requires program-test to load the compiled SBF artifact.');
  const passed=positiveInteger(programTest?.passed,'programTest.passed');
  const failed=nonNegativeInteger(programTest?.failed,'programTest.failed');
  if(failed!==0) throw new Error('Solana build evidence cannot become trusted while SBF program-test failures remain.');
  if(!Array.isArray(programTest?.coveredInstructions) || programTest.coveredInstructions.length===0) {
    throw new TypeError('programTest.coveredInstructions must be a non-empty instruction list.');
  }
  const coveredInstructions=Object.freeze([...new Set(programTest.coveredInstructions.map((value,index)=>textValue(value,`programTest.coveredInstructions[${index}]`)))]);
  for(const required of ['initialize','heartbeat','approve','execute-native']){
    if(!coveredInstructions.includes(required)) throw new Error(`Solana SBF program-test is missing lifecycle instruction coverage: ${required}.`);
  }
  if(!Array.isArray(programTest.adversarialGates) || programTest.adversarialGates.length<1) {
    throw new TypeError('programTest.adversarialGates must be non-empty.');
  }
  const adversarialGates=Object.freeze([...new Set(programTest.adversarialGates.map((value,index)=>textValue(value,`programTest.adversarialGates[${index}]`)))]);

  const core=Object.freeze({
    schema:'omegavault.solana.sbf-build-evidence.v1',
    networkRef:'solana:devnet',
    sourceCommitSha:commit,
    sources:normalizedSources,
    toolchain:normalizedToolchain,
    artifact:Object.freeze({
      path:artifactPath,
      sha256:artifactSha256,
      bytes:artifactBytes
    }),
    programTest:Object.freeze({
      loadsCompiledSbf:true,
      passed,
      failed:0,
      coveredInstructions,
      adversarialGates,
      nativeLamportMovementVerified:programTest.nativeLamportMovementVerified===true
    }),
    programId:id,
    trustState:Object.freeze({
      sourceBound:true,
      toolchainBound:true,
      artifactIdentityBound:true,
      compiledSbfExecuted:true,
      offlineLifecycleVerified:true,
      artifactTrusted:true,
      devnetDeploymentProven:false,
      liveSubmissionReady:false,
      publicNetworkRecoveryProven:false,
      supportClaimAuthorized:false
    }),
    nextGate:'capture-exact-devnet-deployment-and-lifecycle-evidence-using-this-artifact-identity',
    authorityBoundary:'This evidence can restore trust in one exact rebuilt Solana SBF artifact by binding source, pinned toolchain, artifact bytes and compiled-SBF program-test execution. It does not authorize deployment/signing/submission and does not prove Devnet recovery or Solana support.'
  });

  return Object.freeze({ ...core,evidenceSha256:digest(core) });
}

export function verifySolanaSbfBuildEvidence(evidence){
  const errors=[];
  try{
    if(!evidence || typeof evidence!=='object' || Array.isArray(evidence)) throw new TypeError('Solana SBF build evidence is required.');
    const expected=createSolanaSbfBuildEvidence({
      sourceCommitSha:evidence.sourceCommitSha,
      sources:evidence.sources,
      toolchain:evidence.toolchain,
      artifact:evidence.artifact,
      programTest:evidence.programTest,
      programId:evidence.programId
    });
    if(!SHA256.test(String(evidence.evidenceSha256 ?? ''))) errors.push('Solana SBF build evidence digest is invalid.');
    else {
      const core=Object.fromEntries(Object.entries(evidence).filter(([key])=>key!=='evidenceSha256'));
      if(digest(core)!==evidence.evidenceSha256) errors.push('Solana SBF build evidence self-digest mismatch.');
    }
    if(expected.evidenceSha256!==evidence.evidenceSha256) errors.push('Solana SBF build evidence does not reproduce from its bound fields.');
  }catch(error){
    errors.push(error.message);
  }
  return Object.freeze({ valid:errors.length===0,errors:Object.freeze(errors) });
}
