import { CORE_INVARIANT_IDS } from '../../core/invariants.js';
import { hashCardanoEvidence } from './evidence-binding.js';

const SHA256 = /^[0-9a-f]{64}$/i;
const GIT_SHA = /^[0-9a-f]{40}$/i;

export const CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS = Object.freeze([
  'initialize',
  'heartbeat',
  'approve',
  'execute'
]);

function exactText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required.`);
  return value.trim();
}

function checkpoint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('checkpoint is required.');
  const checkpointRef = exactText(value.checkpointRef, 'checkpoint.checkpointRef');
  const sourceCommitSha = exactText(value.sourceCommitSha, 'checkpoint.sourceCommitSha').toLowerCase();
  const archiveSha256 = exactText(value.archiveSha256, 'checkpoint.archiveSha256').toLowerCase();
  const sourceTreeSha256 = exactText(value.sourceTreeSha256, 'checkpoint.sourceTreeSha256').toLowerCase();
  if (!GIT_SHA.test(sourceCommitSha)) throw new TypeError('checkpoint.sourceCommitSha must be a Git SHA.');
  if (!SHA256.test(archiveSha256)) throw new TypeError('checkpoint.archiveSha256 must be SHA-256 hex.');
  if (!SHA256.test(sourceTreeSha256)) throw new TypeError('checkpoint.sourceTreeSha256 must be SHA-256 hex.');
  return Object.freeze({ checkpointRef, sourceCommitSha, archiveSha256, sourceTreeSha256 });
}

function sameArray(a, b) {
  return Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]);
}

export function createCardanoPreprodInvariantEvidenceProgram({ checkpoint: checkpointInput }) {
  const boundCheckpoint = checkpoint(checkpointInput);
  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-invariant-evidence-program.v1',
    chainId: 'cardano',
    network: 'preprod',
    checkpoint: boundCheckpoint,
    requiredInvariantIds: Object.freeze([...CORE_INVARIANT_IDS]),
    requiredLifecycleActions: CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS,
    requiredEvidenceLevel: 'public-testnet',
    synchronizedEvaluationIsSufficientForSupport: false,
    supportClaimAuthorized: false,
    publicNetworkRecoveryProven: false,
    purpose: 'Bind Cardano Preprod evidence capture to the canonical OmegaVault invariants without treating evaluation-only evidence as support proof.'
  });
  return Object.freeze({ ...core, programSha256: hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodInvariantEvidenceProgram(program, { expectedCheckpoint = null } = {}) {
  const errors = [];
  try {
    if (!program || typeof program !== 'object' || Array.isArray(program)) throw new TypeError('Cardano Preprod invariant evidence program is required.');
    if (program.schema !== 'omegavault.cardano.preprod-invariant-evidence-program.v1') errors.push('Invariant evidence program schema is not supported.');
    if (program.chainId !== 'cardano' || program.network !== 'preprod') errors.push('Invariant evidence program must target Cardano Preprod.');
    const boundCheckpoint = checkpoint(program.checkpoint);
    if (expectedCheckpoint) {
      const expected = checkpoint(expectedCheckpoint);
      for (const key of Object.keys(expected)) {
        if (boundCheckpoint[key] !== expected[key]) errors.push(`Invariant evidence checkpoint mismatch for ${key}.`);
      }
    }
    if (!sameArray(program.requiredInvariantIds, CORE_INVARIANT_IDS)) errors.push('Invariant evidence program must require the complete canonical invariant set.');
    if (!sameArray(program.requiredLifecycleActions, CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS)) errors.push('Invariant evidence program lifecycle actions were weakened or reordered.');
    if (program.requiredEvidenceLevel !== 'public-testnet') errors.push('Invariant evidence program must require public-testnet evidence.');
    if (program.synchronizedEvaluationIsSufficientForSupport !== false) errors.push('Synchronized evaluation alone must not be sufficient for support.');
    if (program.supportClaimAuthorized !== false) errors.push('Invariant evidence program must not authorize a support claim.');
    if (program.publicNetworkRecoveryProven !== false) errors.push('Invariant evidence program must not claim public-network recovery before evidence exists.');
    if (!SHA256.test(String(program.programSha256 ?? ''))) {
      errors.push('Invariant evidence program digest is invalid.');
    } else {
      const core = Object.fromEntries(Object.entries(program).filter(([key]) => key !== 'programSha256'));
      if (hashCardanoEvidence(core) !== program.programSha256) errors.push('Invariant evidence program self-digest mismatch.');
    }
  } catch (error) {
    errors.push(error.message);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
