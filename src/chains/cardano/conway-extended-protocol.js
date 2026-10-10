import { canonicalCardanoEvidenceJson, hashCardanoEvidence } from './evidence-binding.js';
import { normalizeCardanoProtocolParameterSnapshot } from './protocol-parameters.js';

const REQUIRED_CONWAY_FIELDS = Object.freeze([
  'systemStart', 'epochLength', 'slotLength',
  'maxBlockBodySize', 'maxBlockHeaderSize', 'keyDeposit',
  'poolDeposit', 'desiredNumberOfStakePools', 'minPoolCost',
  'maxBlockExUnits', 'maximumEpoch', 'poolPledgeInfluence',
  'expansionRate', 'treasuryGrowthRate', 'poolVotingThresholds',
  'drepVotingThresholds', 'minCommitteeSize', 'committeeTermLimit',
  'governanceActionValidityPeriod', 'governanceActionDeposit',
  'drepDeposit', 'drepInactivityPeriod', 'minFeeRefScriptCostPerByte',
  'plutusV1CostModel', 'plutusV2CostModel'
]);

function boundTip(tip, expected, label) {
  if (!tip || String(tip.hash ?? tip.blockHash ?? '').toLowerCase() !== expected.blockHash ||
      tip.slot !== expected.slot) {
    throw new Error(label + ' must match the exact unchanged current Cardano ledger tip.');
  }
}

function checkedSource(source, label) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError(label + ' must be independently collected normalized Conway parameters.');
  }
  for (const field of REQUIRED_CONWAY_FIELDS) {
    if (source[field] == null) throw new Error(label + ' missing complete Conway parameter: ' + field);
  }
  for (const [key, count] of [['plutusV1CostModel', 166], ['plutusV2CostModel', 175]]) {
    if (!Array.isArray(source[key]) || source[key].length !== count ||
        source[key].some(value => !Number.isSafeInteger(value))) {
      throw new Error(label + ' must include exactly ' + count + ' ordered coefficients for ' + key);
    }
  }
  // Produces a cloned plain JSON object; neither caller mutation nor
  // provider-specific JS prototypes may change the committed result.
  return JSON.parse(canonicalCardanoEvidenceJson(source));
}

/**
 * Bind complete Conway parameters only after two independently acquired and
 * normalized provider records agree on EVERY extended field at one stable tip.
 *
 * This is an offline agreement/integrity adapter, not a provider fetch or a
 * claim that phase-one validation, freshness, or submission has occurred.
 * The upstream collector must independently authenticate both responses.
 */
export function createCardanoPreprodExtendedConwaySnapshot({
  baseSnapshot,
  ogmiosCompleteConway,
  blockfrostCompleteConway,
  observedTipBefore,
  observedTipAfter
}) {
  if (!baseSnapshot || baseSnapshot.schemaVersion !== 2 ||
      baseSnapshot.network !== 'preprod' || baseSnapshot.networkId !== 0 ||
      baseSnapshot.source?.independentSourceCount < 2 ||
      baseSnapshot.promotion?.independentlyConfirmed !== true) {
    throw new Error('Complete Conway extension requires an independently confirmed Preprod V2 protocol snapshot.');
  }
  normalizeCardanoProtocolParameterSnapshot(baseSnapshot);
  const expected = baseSnapshot.tip;
  boundTip(observedTipBefore, expected, 'Prior verified ledger tip');
  boundTip(observedTipAfter, expected, 'Subsequent verified ledger tip');

  const ogmios = checkedSource(ogmiosCompleteConway, 'Ogmios');
  const blockfrost = checkedSource(blockfrostCompleteConway, 'Blockfrost');
  const ogmiosSha256 = hashCardanoEvidence(ogmios);
  const blockfrostSha256 = hashCardanoEvidence(blockfrost);
  if (ogmiosSha256 !== blockfrostSha256) {
    throw new Error('Two independent Conway protocol sources disagree; refusing incomplete or conflicting ledger environment.');
  }
  const agreement = Object.freeze({
    independentSourceCount: 2,
    ogmiosSha256,
    blockfrostSha256,
    acquiredStableTipHash: expected.blockHash,
    acquiredStableTipSlot: expected.slot,
    providerAuthenticationClaim: 'must-be-verified-by-upstream-collector-not-by-this-offline-adapter',
    phaseOneValidated: false,
    submissionAuthorized: false
  });
  return Object.freeze({
    ...baseSnapshot,
    parameters: Object.freeze({
      ...baseSnapshot.parameters,
      completeConway: Object.freeze(ogmios),
      completeConwayAgreement: agreement
    }),
    promotion: Object.freeze({
      ...baseSnapshot.promotion,
      eligibleForLiveTransactionConstruction: false,
      connectorLiveProof: false
    })
  });
}
