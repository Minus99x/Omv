import test from 'node:test';
import assert from 'node:assert/strict';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { createCardanoPreprodCaptureSessionManifest } from '../src/chains/cardano/preprod-capture-session.js';
import {
  createCardanoPreprodCampaignManifest,
  verifyCardanoPreprodCampaignManifest
} from '../src/chains/cardano/preprod-campaign.js';

const actions = ['initialize', 'heartbeat', 'approve', 'execute'];

function plan(action, index) {
  const hex = (index + 1).toString(16).padStart(2, '0');
  const transactionCborHex = '84'.repeat(8);
  const additionalUtxoSet = [{
    transaction: { id: hex.repeat(32) },
    index: 0,
    address: 'addr_test1vptest',
    value: { ada: { lovelace: 10000000 } }
  }];
  const core = {
    schema: 'omegavault.cardano.preprod-evidence-capture-plan.v2',
    network: 'preprod',
    action,
    captureLabel: 'campaign-test',
    transactionBodyHash: hex.repeat(32),
    transactionCborHex,
    transactionCborSha256: (index + 11).toString(16).padStart(2, '0').repeat(32),
    evaluationRequest: {
      jsonrpc: '2.0',
      method: 'evaluateTransaction',
      id: `test-${action}`,
      params: { transaction: { cbor: transactionCborHex }, additionalUtxo: additionalUtxoSet }
    },
    evaluationContext: {
      supplementalUtxoSha256: hashCardanoEvidence(additionalUtxoSet),
      syntheticSupplementalUtxoContext: true,
      keyWitnessesRequiredForEvaluation: false,
      fullPhaseOneValidationPerformed: false
    },
    expectedValidators: ['spend:0'],
    requiredCaptures: ['acquired-stable-tip', 'same-tip-current-protocol-parameters-with-independent-confirmation', 'tip-bracketed-ogmios-evaluation-response'],
    liveActions: {
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false
    },
    authorityBoundary: 'test-only'
  };
  return Object.freeze({ ...core, planSha256: hashCardanoEvidence(core) });
}

function sessions() {
  return actions.map((action, index) => ({
    directory: `sessions/${action}`,
    manifest: createCardanoPreprodCaptureSessionManifest({
      capturePlan: plan(action, index),
      sessionId: `campaign-${action}`
    })
  }));
}

test('Cardano Preprod campaign binds exactly one evaluation-only session for every required lifecycle action', () => {
  const campaign = createCardanoPreprodCampaignManifest({ sessions: sessions() });
  assert.deepEqual(campaign.requiredLifecycleActions, actions);
  assert.deepEqual(campaign.sessions.map(item => item.action), actions);
  assert.equal(new Set(campaign.sessions.map(item => item.invariantProgramSha256)).size, 1);
  assert.equal(campaign.supportClaimAuthorized, false);
  assert.equal(campaign.walletSigningAuthorized, false);
  assert.match(campaign.campaignSha256, /^[0-9a-f]{64}$/);
});

test('Cardano Preprod campaign refuses an incomplete lifecycle', () => {
  assert.throws(
    () => createCardanoPreprodCampaignManifest({ sessions: sessions().slice(0, 3) }),
    /missing required lifecycle actions/
  );
});

test('Cardano Preprod campaign verifies action-to-session binding and rejects cross-wiring', () => {
  const prepared = sessions();
  const campaign = createCardanoPreprodCampaignManifest({ sessions: prepared });
  const manifests = Object.fromEntries(prepared.map(item => [item.manifest.capturePlan.action, item.manifest]));
  assert.equal(verifyCardanoPreprodCampaignManifest(campaign, { sessionManifests: manifests }).valid, true);

  const crossWired = { ...manifests, approve: manifests.execute };
  const rejected = verifyCardanoPreprodCampaignManifest(campaign, { sessionManifests: crossWired });
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some(error => /approve.*digest|approve.*cross-wired/i.test(error)));
});

test('Cardano Preprod campaign fails closed if authority/status fields are escalated', () => {
  const campaign = structuredClone(createCardanoPreprodCampaignManifest({ sessions: sessions() }));
  campaign.supportClaimAuthorized = true;
  const rejected = verifyCardanoPreprodCampaignManifest(campaign);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some(error => /authority\/status boundary/i.test(error)));
});
