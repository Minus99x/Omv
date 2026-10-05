import { hashCardanoEvidence } from './evidence-binding.js';
import { CARDANO_PREPROD_CAPTURE_BASELINE, verifyCardanoPreprodCaptureSessionManifest } from './preprod-capture-session.js';
import { CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS } from './preprod-invariant-program.js';

const SHA256 = /^[0-9a-f]{64}$/i;

function withoutDigest(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function sameCheckpoint(value, expected) {
  return Object.keys(expected).every(key => value?.[key] === expected[key]);
}

export function createCardanoPreprodCampaignManifest({ sessions }) {
  if (!Array.isArray(sessions)) throw new TypeError('sessions must be an array.');

  const byAction = new Map();
  for (const item of sessions) {
    const manifest = item?.manifest;
    const directory = typeof item?.directory === 'string' ? item.directory.trim() : '';
    if (!directory) throw new TypeError('Each campaign session requires a directory.');
    const verified = verifyCardanoPreprodCaptureSessionManifest(manifest);
    if (!verified.valid) throw new Error(`Invalid ${manifest?.capturePlan?.action ?? 'unknown'} capture manifest: ${verified.errors.join('; ')}`);
    if (!sameCheckpoint(manifest.checkpoint, CARDANO_PREPROD_CAPTURE_BASELINE)) throw new Error('Campaign session checkpoint does not match the sealed Cardano Preprod baseline.');
    const action = manifest.capturePlan.action;
    if (!CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS.includes(action)) throw new Error(`Unsupported campaign action: ${action}`);
    if (byAction.has(action)) throw new Error(`Duplicate campaign action: ${action}`);
    byAction.set(action, Object.freeze({
      action,
      directory,
      sessionId: manifest.sessionId,
      manifestSha256: manifest.manifestSha256,
      invariantProgramSha256: manifest.invariantProgram.programSha256,
      planSha256: manifest.capturePlan.planSha256,
      transactionBodyHash: manifest.capturePlan.transactionBodyHash,
      transactionCborSha256: manifest.capturePlan.transactionCborSha256
    }));
  }

  const missing = CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS.filter(action => !byAction.has(action));
  if (missing.length) throw new Error(`Campaign is missing required lifecycle actions: ${missing.join(', ')}`);

  const ordered = Object.freeze(CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS.map(action => byAction.get(action)));
  const programIds = new Set(ordered.map(item => item.invariantProgramSha256));
  if (programIds.size !== 1) throw new Error('Campaign sessions do not share one invariant-program identity.');

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-evidence-campaign.v1',
    chainId: 'cardano',
    network: 'preprod',
    checkpoint: CARDANO_PREPROD_CAPTURE_BASELINE,
    invariantProgramSha256: ordered[0].invariantProgramSha256,
    requiredLifecycleActions: CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS,
    sessions: ordered,
    synchronizedEvaluationCampaignComplete: false,
    walletSigningAuthorized: false,
    transactionSubmissionAuthorized: false,
    liveValueMovementAuthorized: false,
    publicNetworkRecoveryProven: false,
    supportClaimAuthorized: false,
    purpose: 'Prepare the complete Cardano Preprod lifecycle evidence campaign without authorizing signing, submission, recovery or support promotion.'
  });

  return Object.freeze({ ...core, campaignSha256: hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodCampaignManifest(campaign, { sessionManifests = null } = {}) {
  const errors = [];
  try {
    if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign)) throw new TypeError('Cardano Preprod campaign manifest is required.');
    if (campaign.schema !== 'omegavault.cardano.preprod-evidence-campaign.v1') errors.push('Campaign schema is not supported.');
    if (campaign.chainId !== 'cardano' || campaign.network !== 'preprod') errors.push('Campaign must target Cardano Preprod.');
    if (!sameCheckpoint(campaign.checkpoint, CARDANO_PREPROD_CAPTURE_BASELINE)) errors.push('Campaign checkpoint does not match the sealed Cardano Preprod baseline.');
    if (!Array.isArray(campaign.requiredLifecycleActions) ||
        campaign.requiredLifecycleActions.length !== CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS.length ||
        !campaign.requiredLifecycleActions.every((action, index) => action === CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS[index])) {
      errors.push('Campaign lifecycle actions were weakened or reordered.');
    }
    if (!Array.isArray(campaign.sessions) || campaign.sessions.length !== CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS.length) {
      errors.push('Campaign must contain exactly one session per required lifecycle action.');
    } else {
      campaign.sessions.forEach((item, index) => {
        const expectedAction = CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS[index];
        if (item?.action !== expectedAction) errors.push(`Campaign session ${index} must be ${expectedAction}.`);
        for (const field of ['manifestSha256', 'invariantProgramSha256', 'planSha256', 'transactionBodyHash', 'transactionCborSha256']) {
          if (!SHA256.test(String(item?.[field] ?? ''))) errors.push(`Campaign ${expectedAction} ${field} is invalid.`);
        }
        if (typeof item?.directory !== 'string' || !item.directory.trim()) errors.push(`Campaign ${expectedAction} directory is missing.`);
      });
      const programIds = new Set(campaign.sessions.map(item => item?.invariantProgramSha256));
      if (programIds.size !== 1 || !programIds.has(campaign.invariantProgramSha256)) errors.push('Campaign invariant-program identity is inconsistent.');
    }

    if (campaign.synchronizedEvaluationCampaignComplete !== false ||
        campaign.walletSigningAuthorized !== false ||
        campaign.transactionSubmissionAuthorized !== false ||
        campaign.liveValueMovementAuthorized !== false ||
        campaign.publicNetworkRecoveryProven !== false ||
        campaign.supportClaimAuthorized !== false) {
      errors.push('Campaign authority/status boundary was weakened.');
    }

    if (!SHA256.test(String(campaign.campaignSha256 ?? ''))) {
      errors.push('Campaign digest is invalid.');
    } else if (hashCardanoEvidence(withoutDigest(campaign, 'campaignSha256')) !== campaign.campaignSha256) {
      errors.push('Campaign self-digest mismatch.');
    }

    if (sessionManifests != null) {
      if (!sessionManifests || typeof sessionManifests !== 'object' || Array.isArray(sessionManifests)) throw new TypeError('sessionManifests must be an action-keyed object.');
      for (const entry of campaign.sessions ?? []) {
        const manifest = sessionManifests[entry.action];
        const verified = verifyCardanoPreprodCaptureSessionManifest(manifest);
        if (!verified.valid) {
          errors.push(`${entry.action} session manifest is invalid: ${verified.errors.join('; ')}`);
          continue;
        }
        if (manifest.manifestSha256 !== entry.manifestSha256) errors.push(`${entry.action} session manifest digest does not match the campaign.`);
        if (manifest.capturePlan.action !== entry.action) errors.push(`${entry.action} campaign entry is cross-wired to a different action.`);
        if (manifest.invariantProgram.programSha256 !== campaign.invariantProgramSha256) errors.push(`${entry.action} invariant-program identity does not match the campaign.`);
      }
    }
  } catch (error) {
    errors.push(error.message);
  }

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
