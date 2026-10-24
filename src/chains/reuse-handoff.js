import { createHash } from 'node:crypto';

// Integrity-only handoffs. These records do NOT attest that a tool actually ran,
// that a human approved anything, or that a chain transaction was finalized.
export const REUSE_JOB_ORDER = Object.freeze([
  'J00-inventory', 'J01-upstream-review', 'J02-patch',
  'J03-focused-tests', 'J04-full-verification', 'J05-integration',
  'J06-read-only-evidence'
]);

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const OBJECTIVE = /^OVR-00[1-6]$/;
const RELEASE_BRANCH = 'dev/0.6.60-reconcile-overnight-bitcoin';

function fail(message) { throw new TypeError(message); }
function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object.`);
  return value;
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) fail(`${label} requires trimmed nonempty text.`);
  return value;
}
function exactShape(value, keys, label) {
  record(value, label);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(`${label} fields do not match expected schema.`);
}
function sha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(`${label} must be lowercase SHA-256.`);
  return value;
}
function gitSha(value, label) {
  if (typeof value !== 'string' || !GIT_SHA.test(value)) fail(`${label} must be lowercase full Git SHA.`);
  return value;
}
function strictCanonical(value, ancestors = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (Array.isArray(value)) {
    if (ancestors.has(value)) fail('Cyclic evidence is prohibited.');
    ancestors.add(value);
    const result = [];
    for (let i = 0; i < value.length; i++) {
      const item = Object.getOwnPropertyDescriptor(value, String(i));
      if (!item || !Object.hasOwn(item, 'value')) fail('Sparse arrays and evidence accessors are prohibited.');
      result.push(strictCanonical(item.value, ancestors));
    }
    ancestors.delete(value);
    return result;
  }
  if (value && typeof value === 'object') {
    record(value, 'Evidence value');
    if (ancestors.has(value)) fail('Cyclic evidence is prohibited.');
    ancestors.add(value);
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('Unsafe evidence key.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('Accessors are not accepted as evidence.');
      output[key] = strictCanonical(descriptor.value, ancestors);
    }
    ancestors.delete(value);
    return output;
  }
  fail('Evidence contains unsupported types.');
}
export function hashReuseArtifact(value) {
  return createHash('sha256').update(JSON.stringify(strictCanonical(value))).digest('hex');
}
function commandRun(value, label, exactCommand = null) {
  exactShape(value, ['command', 'exitCode', 'executed', 'outputSha256'], label);
  text(value.command, `${label}.command`);
  if (exactCommand && value.command !== exactCommand) fail(`${label} must execute ${exactCommand}.`);
  if (value.executed !== true || value.exitCode !== 0) fail(`${label} did not report a successful executed command.`);
  sha256(value.outputSha256, `${label}.outputSha256`);
}
function verifyArtifact(job, artifact) {
  record(artifact, `${job} artifact`);
  switch (job) {
    case 'J00-inventory':
      exactShape(artifact, ['component', 'gapConfirmed', 'missingBehavior', 'coverageReference'], 'J00 artifact');
      text(artifact.component, 'component');
      text(artifact.coverageReference, 'coverageReference');
      if (typeof artifact.gapConfirmed !== 'boolean') fail('gapConfirmed must be boolean.');
      if (artifact.gapConfirmed) text(artifact.missingBehavior, 'missingBehavior');
      else if (artifact.missingBehavior !== null) fail('Already-covered work must not invent a gap.');
      break;
    case 'J01-upstream-review':
      exactShape(artifact, ['url', 'revision', 'license', 'licenseReviewed', 'securityReviewed', 'compatible', 'strategy'], 'J01 artifact');
      if (typeof artifact.url !== 'string' || !/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(artifact.url)) fail('Upstream must have a GitHub source URL.');
      gitSha(artifact.revision, 'upstream revision');
      text(artifact.license, 'license');
      if (artifact.licenseReviewed !== true || artifact.securityReviewed !== true || artifact.compatible !== true) fail('Upstream license, security and compatibility review are mandatory.');
      if (!['copy', 'adapt', 'dependency'].includes(artifact.strategy)) fail('Unsupported reuse strategy.');
      break;
    case 'J02-patch':
      exactShape(artifact, ['patchSha256', 'changedPaths'], 'J02 artifact');
      sha256(artifact.patchSha256, 'patchSha256');
      if (!Array.isArray(artifact.changedPaths) || artifact.changedPaths.length === 0 ||
          artifact.changedPaths.some(path => typeof path !== 'string' || !/^(src\/chains|test)\/[\w.\-/]+$/.test(path) || path.includes('..')) ||
          new Set(artifact.changedPaths).size !== artifact.changedPaths.length) fail('Patch must change unique permitted source/test paths only.');
      break;
    case 'J03-focused-tests':
      exactShape(artifact, ['run', 'positiveCases', 'adversarialCases', 'patchSha256'], 'J03 artifact');
      commandRun(artifact.run, 'focused test');
      if (!Number.isSafeInteger(artifact.positiveCases) || artifact.positiveCases < 1 ||
          !Number.isSafeInteger(artifact.adversarialCases) || artifact.adversarialCases < 1) fail('Focused tests need positive and adversarial coverage.');
      sha256(artifact.patchSha256, 'J03 patchSha256');
      break;
    case 'J04-full-verification':
      exactShape(artifact, ['test', 'check', 'patchSha256'], 'J04 artifact');
      commandRun(artifact.test, 'full test', 'npm test');
      commandRun(artifact.check, 'full check', 'npm run check');
      sha256(artifact.patchSha256, 'J04 patchSha256');
      break;
    case 'J05-integration':
      exactShape(artifact, ['commitSha', 'branch', 'patchSha256', 'verificationReceiptSha256'], 'J05 artifact');
      gitSha(artifact.commitSha, 'integration commitSha');
      if (artifact.branch !== RELEASE_BRANCH) fail('Only authorized product branch can receive integrated work.');
      sha256(artifact.patchSha256, 'J05 patchSha256');
      sha256(artifact.verificationReceiptSha256, 'verificationReceiptSha256');
      break;
    case 'J06-read-only-evidence':
      exactShape(artifact, ['networkRef', 'provenance', 'publicEvidenceSha256', 'sources', 'observedAt', 'transactionSubmissionAuthorized', 'supportPromotionAuthorized'], 'J06 artifact');
      text(artifact.networkRef, 'networkRef');
      if (/mainnet|production/i.test(artifact.networkRef)) fail('This handoff is not for live-value networks.');
      if (artifact.provenance !== 'public-network-read-only') fail('Public observation must identify read-only provenance.');
      sha256(artifact.publicEvidenceSha256, 'publicEvidenceSha256');
      if (!Array.isArray(artifact.sources) || artifact.sources.length < 1 ||
          artifact.sources.some(x => typeof x !== 'string' || x.trim() !== x || !x)) fail('Public read-only observation source references are required.');
      if (typeof artifact.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(artifact.observedAt) ||
          !Number.isFinite(Date.parse(artifact.observedAt)) || new Date(artifact.observedAt).toISOString().slice(0, 19) !== artifact.observedAt.slice(0, 19)) fail('Observation must have valid UTC timestamp.');
      if (artifact.transactionSubmissionAuthorized !== false || artifact.supportPromotionAuthorized !== false) fail('Read-only evidence grants no transaction or release authority.');
      break;
    default:
      fail('Unsupported job or human-gated stage.');
  }
}
function verifyLink(recordValue, previous) {
  strictCanonical(recordValue);
  exactShape(recordValue, ['schema', 'job', 'objective', 'baseSha', 'previousSha256', 'artifact', 'artifactSha256', 'sha256', 'authority'], 'handoff receipt');
  if (recordValue.schema !== 'omegavault.offline-reuse-handoff.v1') fail('Unexpected handoff receipt schema.');
  if (!REUSE_JOB_ORDER.includes(recordValue.job)) fail('Unknown or operator-gated job.');
  if (!OBJECTIVE.test(recordValue.objective)) fail('Invalid objective identity.');
  gitSha(recordValue.baseSha, 'baseSha');
  if (recordValue.authority !== 'offline-review-only-no-transaction-or-release-authority') fail('Handoff must not grant authorization.');
  if (recordValue.previousSha256 !== (previous?.sha256 ?? null)) fail('Previous handoff digest mismatch.');
  if (previous) {
    if (REUSE_JOB_ORDER.indexOf(recordValue.job) !== REUSE_JOB_ORDER.indexOf(previous.job) + 1) fail('Handoff cannot skip or repeat jobs.');
    if (recordValue.baseSha !== previous.baseSha || recordValue.objective !== previous.objective) fail('Handoff belongs to different source baseline/objective.');
    if (previous.job === 'J00-inventory' && previous.artifact.gapConfirmed === false) fail('Already-covered work must be skipped, not rebuilt.');
    if (recordValue.job === 'J03-focused-tests' && recordValue.artifact.patchSha256 !== previous.artifact.patchSha256) fail('Focused tests do not bind to candidate patch.');
    if (recordValue.job === 'J04-full-verification' && recordValue.artifact.patchSha256 !== previous.artifact.patchSha256) fail('Full verification does not bind to candidate patch.');
    if (recordValue.job === 'J05-integration' && (recordValue.artifact.patchSha256 !== previous.artifact.patchSha256 || recordValue.artifact.verificationReceiptSha256 !== previous.sha256)) fail('Integration commit is not bound to complete verification.');
  } else if (recordValue.job !== 'J00-inventory') fail('Every job chain must start with inventory.');
  verifyArtifact(recordValue.job, recordValue.artifact);
  if (recordValue.artifactSha256 !== hashReuseArtifact(recordValue.artifact)) fail('Artifact digest mismatch.');
  const { sha256: reported, ...unsigned } = recordValue;
  if (reported !== hashReuseArtifact(unsigned)) fail('Receipt digest mismatch.');
}
export function verifyOfflineReuseChain(receipts) {
  try {
    if (!Array.isArray(receipts) || receipts.length < 1 || receipts.length > REUSE_JOB_ORDER.length) fail('Handoff chain length invalid.');
    for (let i = 0; i < receipts.length; i++) verifyLink(receipts[i], receipts[i - 1] ?? null);
    const last = receipts.at(-1);
    return Object.freeze({valid:true,job:last.job,nextJob:REUSE_JOB_ORDER[REUSE_JOB_ORDER.indexOf(last.job) + 1] ?? null,
      requiresHumanAuthority:last.job === 'J06-read-only-evidence',
      caveat:'Self-digests check integrity, not execution authenticity, operator authorization or blockchain finality.'});
  } catch (error) {
    return Object.freeze({valid:false,error:error.message,job:null,nextJob:null,requiresHumanAuthority:false});
  }
}
export function appendOfflineReuseHandoff(chain, inputs) {
  const prior = chain.length ? verifyOfflineReuseChain(chain) : {valid:true};
  if (!prior.valid) fail('Cannot extend invalid handoff chain: '+prior.error);
  const previous = chain.at(-1) ?? null;
  const job = inputs.job;
  const partial = {
    schema:'omegavault.offline-reuse-handoff.v1',job,
    objective:inputs.objective,baseSha:inputs.baseSha,
    previousSha256:previous?.sha256 ?? null,
    artifact:strictCanonical(inputs.artifact), artifactSha256:hashReuseArtifact(inputs.artifact),
    authority:'offline-review-only-no-transaction-or-release-authority'
  };
  const next = Object.freeze({...partial,sha256:hashReuseArtifact(partial)});
  verifyLink(next,previous);
  return Object.freeze([...chain,next]);
}
