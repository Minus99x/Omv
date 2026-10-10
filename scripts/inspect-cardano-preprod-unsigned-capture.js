// Read-only, offline artifact-integrity inspection of a previously captured
// Cardano Preprod initialize. No network access, signing or transaction submit.
import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';

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
    const sha=selfDigest(doc,digestField);
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
  const tip=artifacts.utxoBindingEvidence.stableTip;
  if (!tip || tip.hash!==snapshot.tip?.blockHash || tip.slot!==snapshot.tip?.slot) {
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
    unsignedCandidateSha256:artifacts.finalUnsignedCandidate.candidateSha256,
    unsignedPreflightSha256:preflight.preflightSha256,
    protocolSnapshotTwoSourceClaimPresent:true,
    protocolSnapshotWholeDocumentDigestBoundToManifest:false,
    currentLedgerFreshnessEstablished:false,
    completePhaseOneValidated:false,
    walletSigningPerformed:false,
    walletSigningAuthorized:false,
    transactionSubmissionPerformed:false,
    transactionSubmissionAuthorized:false,
    supportClaimAuthorized:false,
    limitation:'Offline self-digest/integrity verification only. Existing v1 manifest does not bind the WHOLE protocol snapshot bytes; provider truth, transaction freshness and full Conway phase one remain unproven.',
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
