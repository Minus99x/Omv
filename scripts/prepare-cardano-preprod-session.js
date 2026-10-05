import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';
import { buildCardanoOgmiosEvaluationFixture } from '../src/chains/cardano/witness-set.js';
import { buildCardanoEvaluationAdditionalUtxoSet } from '../src/chains/cardano/transaction-body.js';
import { createCardanoPreprodEvidenceCapturePlan } from '../src/chains/cardano/preprod-evidence-harness.js';
import { createCardanoPreprodCaptureSessionManifest } from '../src/chains/cardano/preprod-capture-session.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const defaultOutput = resolve(dirname(root), 'omegavault-cardano-preprod-session');
const output = resolve(arg('--output', defaultOutput));
try {
  await access(join(output, 'capture-manifest.json'));
  throw new Error('A Cardano Preprod capture session already exists at the output path; choose a new directory rather than overwriting its manifest.');
} catch (error) {
  if (error?.code !== 'ENOENT' && /already exists/.test(error?.message ?? '')) throw error;
  if (error?.code && error.code !== 'ENOENT') throw error;
}
const action = arg('--action', 'execute');
if (!['initialize', 'heartbeat', 'approve', 'execute'].includes(action)) throw new TypeError('--action must be initialize, heartbeat, approve, or execute.');

const protocolEvidence = JSON.parse(await readFile(join(root, 'docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json'), 'utf8'));
const parameters = normalizeCardanoProtocolParameterSnapshot(protocolEvidence);
const beacon = JSON.parse(await readFile(join(root, 'validators/cardano/fixtures/state-beacon.applied.json'), 'utf8'));
const vault = JSON.parse(await readFile(join(root, 'validators/cardano/fixtures/recovery-vault.applied.json'), 'utf8'));
const beaconCode = beacon.validators.find(item => item.title === 'omegavault.state_beacon.mint').compiledCode;
const recoveryCode = vault.validators.find(item => item.title === 'omegavault.recovery_vault.spend').compiledCode;
const candidate = buildCardanoOgmiosEvaluationFixture({ action, parameters, recoveryCompiledCode: recoveryCode, beaconCompiledCode: beaconCode });
const plan = createCardanoPreprodEvidenceCapturePlan({
  action,
  transactionCborHex: candidate.transactionCborHex,
  additionalUtxoSet: buildCardanoEvaluationAdditionalUtxoSet(action),
  requestId: `omegavault-preprod-${action}-evaluate`,
  captureLabel: 'omegavault-cardano-preprod'
});
const manifest = createCardanoPreprodCaptureSessionManifest({
  capturePlan: plan,
  sessionId: `omegavault-cardano-preprod-${action}`
});

await mkdir(join(output, 'captures'), { recursive: true });
await mkdir(join(output, 'templates'), { recursive: true });
await writeFile(join(output, 'capture-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(output, manifest.files.evaluationRequest), `${JSON.stringify(plan.evaluationRequest, null, 2)}\n`);

const templates = {
  'acquired-tip.template.json': {
    hash: '<32-byte-preprod-tip-hash>',
    epoch: '<non-negative-integer>',
    slot: '<optional-integer>',
    blockHeight: '<optional-integer>'
  },
  'utxo-snapshot.template.json': {
    tipHash: '<same-tip-hash>',
    source: '<node/provider>',
    capturedAt: '<ISO-8601>',
    utxos: []
  },
  'protocol-parameters.template.json': {
    note: 'Capture current Preprod protocol parameters bound to the same tip. source.independentSourceCount must be at least 2 and promotion.independentlyConfirmed must be true.'
  },
  'ogmios-evaluation.template.json': {
    tipHash: '<same-tip-hash>',
    response: {
      jsonrpc: '2.0',
      method: 'evaluateTransaction',
      id: plan.evaluationRequest.id,
      result: []
    }
  },
  'phase-one-validation.template.json': {
    tipHash: '<same-tip-hash>',
    transactionBodyHash: plan.transactionBodyHash,
    source: '<independent-ledger-validation-source>',
    independentOfOgmiosEvaluation: true,
    passed: false,
    balanced: false,
    minimumAdaSatisfied: false,
    collateralSatisfied: false,
    witnessesSatisfied: false
  }
};
for (const [name, value] of Object.entries(templates)) {
  await writeFile(join(output, 'templates', name), `${JSON.stringify(value, null, 2)}\n`);
}

const readme = [
  '# OmegaVault Cardano Preprod Capture Session',
  '',
  `Checkpoint: ${manifest.checkpoint.checkpointRef}`,
  `Source commit: ${manifest.checkpoint.sourceCommitSha}`,
  `Manifest SHA-256: ${manifest.manifestSha256}`,
  `Invariant program SHA-256: ${manifest.invariantProgram.programSha256}`,
  `Required lifecycle evidence: ${manifest.invariantProgram.requiredLifecycleActions.join(', ')}`,
  `Action: ${plan.action}`,
  `Transaction body hash: ${plan.transactionBodyHash}`,
  '',
  'Required capture files:',
  ...Object.entries(manifest.files)
    .filter(([key]) => !['evaluationRequest', 'evidence'].includes(key))
    .map(([, path]) => `- ${path}`),
  '',
  'This single synchronized-evaluation session is only one part of the invariant evidence program and cannot establish an OmegaVault support claim.',
  'The prepared evaluation transaction is an evidence candidate only. Do not sign or submit it.',
  'Run npm run cardano:preprod:verify -- --session <directory> after capture files are populated.'
].join('\n');
await writeFile(join(output, 'README.md'), `${readme}\n`);

process.stdout.write(`${JSON.stringify({
  schema: 'omegavault.cardano.preprod-session-preparation-result.v1',
  ok: true,
  output,
  manifestSha256: manifest.manifestSha256,
  invariantProgramSha256: manifest.invariantProgram.programSha256,
  supportClaimAuthorized: false,
  transactionBodyHash: plan.transactionBodyHash,
  requestId: plan.evaluationRequest.id,
  networkRequestsPerformed: false,
  walletSigningAuthorized: false,
  transactionSubmissionAuthorized: false
}, null, 2)}\n`);
