// Read-only, offline artifact-integrity inspection of a previously captured
// Cardano Preprod initialize. No network access, signing or transaction submit.
import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { verifyCardanoPreprodAppliedValidatorIdentity } from '../src/chains/cardano/live-validator-identity.js';

const DIGESTS = Object.freeze({
  appliedValidatorIdentity: ['identitySha256','validatorIdentitySha256'],
  utxoBindingPlan: ['planSha256','utxoBindingPlanSha256'],
  utxoBindingEvidence: ['evidenceSha256','utxoBindingEvidenceSha256'],
  evaluationCandidate: ['candidateSha256','evaluationCandidateSha256'],
  evaluationEvidence: ['evidenceSha256','evaluationEvidenceSha256'],
  finalUnsignedCandidate: ['candidateSha256','finalUnsignedCandidateSha256'],
  unsignedPhaseOnePreflight: ['preflightSha256','unsignedPhaseOnePreflightSha256']
});
const HEX64 = /^[0-9a-f]{64}$/i;
function safeJoin(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\0')) {
    throw new Error('Capture manifest has an invalid artifact path.');
  }
  const file = resolve(root,name);
  const rel = relative(root,file);
  if (!rel || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) {
    throw new Error('Capture manifest artifact path escapes the capture directory.');
  }
  return file;
}
async function readJson(file) {
  return JSON.parse(await readFile(file,'utf8'));
}
function selfDigest(document, digestField) {
  const actual=document?.[digestField];
  if (typeof actual !== 'string' || !HEX64.test(actual)) {
    throw new Error('Invalid '+digestField+' in artifact.');
  }
  const core=Object.fromEntries(Object.entries(document).filter(([k])=>k!==digestField));
  if (hashCardanoEvidence(core) !== actual.toLowerCase()) {
    throw new Error('Artifact '+digestField+' does not reproduce.');
  }
  return actual.toLowerCase();
}
function locked(manifest, artifacts) {
  for (const [name,document] of [['manifest',manifest],...Object.entries(artifacts)]) {
    for (const key of ['transactionSubmissionPerformed','transactionSubmissionAuthorized','supportClaimAuthorized',
      'walletSigningPerformed','walletSigningAuthorized','fullPhaseOneValidated','completePhaseOneValidated']) {
      if (document?.[key] === true || document?.liveActions?.[key] === true) {
        throw new Error(name+' claims prohibited '+key+'.');
      }
    }
  }
  if (manifest.synchronizedRealInitializeEvaluationComplete !== true || manifest.network !== 'preprod') {
    throw new Error('Not a completed unsigned Cardano Preprod initialize capture.');
  }
  if (artifacts.finalUnsignedCandidate?.transaction?.keyWitnessCount !== 0) {
    throw new Error('Capture candidate does not expressly have zero wallet key witnesses.');
  }
  if (artifacts.unsignedPhaseOnePreflight?.checks?.walletWitnessesPresent !== false ||
      artifacts.unsignedPhaseOnePreflight?.checks?.fullPhaseOneValidated !== false) {
    throw new Error('Unsigned preflight crossed its witness or phase-one boundary.');
  }
}
export async function inspectCardanoPreprodUnsignedCapture(captureRoot) {
  const root=resolve(captureRoot);
  const manifest=await readJson(join(root,'capture-manifest.json'));
  if (manifest.schema!=='omegavault.cardano.preprod-real-initialize-capture-manifest.v1') {
    throw new Error('Unexpected capture manifest schema.');
  }
  const manifestSha256=selfDigest(manifest,'manifestSha256');
  const artifacts={};
  for (const [key,[digestField,manifestKey]] of Object.entries(DIGESTS)) {
    const path=safeJoin(root,manifest.files?.[key]);
    const doc=await readJson(path);
    // The original Aiken generator appends a provenance object AFTER
    // createCardanoPreprodAppliedValidatorIdentity hashes its signed core.
    // Verify identity with the first-party cryptographic verifier rather than
    // hashing provenance as though it were part of that committed core.
    if (key === 'appliedValidatorIdentity') {
      const verified=verifyCardanoPreprodAppliedValidatorIdentity(doc);
      if (!verified.valid) throw new Error(
        'Applied validator identity verification failed: '+verified.errors.join('; ')
      );
    }
    const sha=key === 'appliedValidatorIdentity'
      ? selfDigest(Object.fromEntries(Object.entries(doc).filter(([k])=>k!=='provenance')),digestField)
      : selfDigest(doc,digestField);
    const bound=manifest.identities?.[manifestKey];
    if (typeof bound !== 'string' || sha!==bound.toLowerCase()) {
      throw new Error(key+' digest is not bound to the captured manifest identity.');
    }
    artifacts[key]=doc;
  }
  const snapshot=await readJson(safeJoin(root,manifest.files?.protocolSnapshot));
  if (snapshot.network!=='preprod' ||
      snapshot.source?.independentSourceCount < 2 ||
      snapshot.promotion?.independentlyConfirmed !== true) {
    throw new Error('Captured protocol parameters do not contain independent Preprod confirmation.');
  }
  // V1 manifests don't name a protocol-snapshot digest directly, but DO
  // commit to evaluationEvidence.evidenceSha256. That sealed evidence embeds
  // protocolSnapshot in its hashed core. Compare the entire documents before
  // asserting that the snapshot is transitively bound to the manifest.
  const evaluation=artifacts.evaluationEvidence;
  if (!evaluation.protocolSnapshot ||
      hashCardanoEvidence(evaluation.protocolSnapshot) !== hashCardanoEvidence(snapshot)) {
    throw new Error('Standalone protocol snapshot differs from manifest-bound evaluation evidence.');
  }
  if (evaluation.validatorIdentitySha256 !== artifacts.appliedValidatorIdentity.identitySha256 ||
      evaluation.utxoBindingPlanSha256 !== artifacts.utxoBindingPlan.planSha256 ||
      evaluation.utxoBindingEvidenceSha256 !== artifacts.utxoBindingEvidence.evidenceSha256 ||
      evaluation.evaluationCandidateSha256 !== artifacts.evaluationCandidate.candidateSha256 ||
      evaluation.finalUnsignedCandidateSha256 !== artifacts.finalUnsignedCandidate.candidateSha256 ||
      evaluation.unsignedPhaseOnePreflightSha256 !== artifacts.unsignedPhaseOnePreflight.preflightSha256) {
    throw new Error('Manifest-bound evaluation evidence has a broken validator, UTxO, candidate or preflight reference.');
  }
  const tip=artifacts.utxoBindingEvidence.stableTip;
  if (!tip || tip.hash!==snapshot.tip?.blockHash || tip.slot!==snapshot.tip?.slot ||
      evaluation.stableTip?.hash !== tip.hash || evaluation.stableTip?.slot !== tip.slot) {
    throw new Error('Captured protocol parameters disagree with the UTxO stable tip.');
  }
  const preflight=artifacts.unsignedPhaseOnePreflight;
  if (preflight.candidateSha256!==artifacts.finalUnsignedCandidate.candidateSha256 ||
      preflight.validatorIdentitySha256!==artifacts.appliedValidatorIdentity.identitySha256 ||
      preflight.utxoBindingEvidenceSha256!==artifacts.utxoBindingEvidence.evidenceSha256) {
    throw new Error('Unsigned preflight no longer binds the saved candidate, validator and UTxOs.');
  }
  locked(manifest,artifacts);
  return Object.freeze({
    schema:'omegavault.cardano.preprod-unsigned-capture-inspection.v1',
    ok:true,
    capturedTip:{hash:tip.hash,slot:tip.slot},
    manifestSha256,
    checkedBoundArtifactCount:Object.keys(DIGESTS).length,
    boundArtifactDigestsValid:true,
    validatorIdentityAppliedCodeAndAddressVerified:true,
    validatorIdentitySupplementalAikenProvenanceBoundByIdentitySha256:false,
    unsignedCandidateSha256:artifacts.finalUnsignedCandidate.candidateSha256,
    unsignedPreflightSha256:preflight.preflightSha256,
    protocolSnapshotTwoSourceClaimPresent:true,
    protocolSnapshotWholeDocumentDigestBoundToManifest:true,
    protocolSnapshotBindingPath:'manifestSha256 -> evaluationEvidenceSha256 -> embedded protocolSnapshot (canonical SHA-256 equality)',
    currentLedgerFreshnessEstablished:false,
    completePhaseOneValidated:false,
    walletSigningPerformed:false,
    walletSigningAuthorized:false,
    transactionSubmissionPerformed:false,
    transactionSubmissionAuthorized:false,
    supportClaimAuthorized:false,
    limitation:'Offline historical artifact-integrity verification only. The whole protocol snapshot is transitively bound to the V1 manifest via sealed evaluation evidence, but offline hashes alone do not prove that provider responses were authentic or current. Supplemental Aiken provenance remains outside the validator identity digest; current UTxO freshness and full Conway phase one are not proven.',
    nextGate:'Independently reverify the fresh protocol/UTxO environment. No signing or submission.'
  });
}
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write('Usage: node scripts/inspect-cardano-preprod-unsigned-capture.js --capture <capture-directory>\nRead-only, offline; no wallet or network operation.\n');
} else if (process.argv[1]?.endsWith('inspect-cardano-preprod-unsigned-capture.js')) {
  const i=process.argv.indexOf('--capture');
  if (i<0 || !process.argv[i+1] || process.argv[i+1].startsWith('--')) {
    process.stderr.write('Capture inspection requires --capture <existing-folder>.\n');
    process.exitCode=2;
  } else {
    try {
      const result=await inspectCardanoPreprodUnsignedCapture(process.argv[i+1]);
      process.stdout.write(JSON.stringify(result,null,2)+'\n');
    } catch(err) {
      process.stderr.write('Unsigned capture inspection blocked: '+err.message+'\n');
      process.exitCode=2;
    }
  }
}
