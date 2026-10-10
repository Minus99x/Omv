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

// Validate the same extended Conway field types consumed by Pallas BEFORE
// reporting two-source agreement. Matching invalid values are not evidence.
const U64_MAX=(1n<<64n)-1n;
const UINT32_FIELDS=Object.freeze([
  'maxBlockBodySize','maxBlockHeaderSize','desiredNumberOfStakePools'
]);
const UINT64_FIELDS=Object.freeze([
  'epochLength','slotLength','keyDeposit','poolDeposit','minPoolCost',
  'maximumEpoch','minCommitteeSize','committeeTermLimit',
  'governanceActionValidityPeriod','governanceActionDeposit',
  'drepDeposit','drepInactivityPeriod'
]);
const POOL_THRESHOLDS=Object.freeze([
  'motionNoConfidence','committeeNormal','committeeNoConfidence',
  'hardForkInitiation','securityVotingThreshold'
]);
const DREP_THRESHOLDS=Object.freeze([
  'motionNoConfidence','committeeNormal','committeeNoConfidence',
  'updateConstitution','hardForkInitiation','ppNetworkGroup',
  'ppEconomicGroup','ppTechnicalGroup','ppGovernanceGroup','treasuryWithdrawal'
]);
function checkedUnsigned(value, label, maximum=U64_MAX, positive=false) {
  if (!((typeof value==='string' && /^(0|[1-9]\\d*)$/.test(value)) ||
        (typeof value==='number' && Number.isSafeInteger(value) && value>=0))) {
    throw new TypeError(label+' must be an exact non-negative integer.');
  }
  const integer=BigInt(value);
  if (integer>maximum || (positive && integer===0n)) {
    throw new RangeError(label+' is outside the supported ledger integer range.');
  }
  return integer;
}
function checkedFraction(value,label,unit=false) {
  if (!value || typeof value!=='object' || Array.isArray(value)) {
    throw new TypeError(label+' must be a normalized rational object.');
  }
  const a=checkedUnsigned(value.numerator,label+'.numerator');
  const b=checkedUnsigned(value.denominator,label+'.denominator',U64_MAX,true);
  if (unit && a>b) throw new RangeError(label+' must be between 0 and 1.');
}
function checkedSystemStart(value,label) {
  if (typeof value!=='string') throw new TypeError(label+' must be an RFC3339 datetime.');
  const match=/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(label+' must be a valid RFC3339 datetime.');
  }
  const [year,month,day,hour,minute,second]=match.slice(1,7).map(Number);
  // Calendar validation is explicit: JS Date.parse normalizes some invalid dates.
  const days=new Date(Date.UTC(year<100?year+400:year,month,0)).getUTCDate();
  if (month<1||month>12||day<1||day>days||hour>23||minute>59||second>59) {
    throw new TypeError(label+' is not a valid calendar time.');
  }
  if (match[7]!=='Z') {
    const hours=Number(match[7].slice(1,3)), minutes=Number(match[7].slice(4,6));
    if(hours>23||minutes>59) throw new TypeError(label+' has an invalid timezone offset.');
  }
}
function validateConwaySource(source,label) {
  checkedSystemStart(source.systemStart,label+'.systemStart');
  for (const field of UINT32_FIELDS)
    checkedUnsigned(source[field],label+'.'+field,4294967295n);
  for (const field of UINT64_FIELDS)
    checkedUnsigned(source[field],label+'.'+field,U64_MAX,field==='epochLength'||field==='slotLength');
  const units=source.maxBlockExUnits;
  if (!units || typeof units!=='object' || Array.isArray(units)) {
    throw new TypeError(label+'.maxBlockExUnits must be an execution-budget object.');
  }
  checkedUnsigned(units.memory,label+'.maxBlockExUnits.memory',U64_MAX,true);
  checkedUnsigned(units.steps,label+'.maxBlockExUnits.steps',U64_MAX,true);
  checkedFraction(source.poolPledgeInfluence,label+'.poolPledgeInfluence');
  for (const name of ['expansionRate','treasuryGrowthRate','minFeeRefScriptCostPerByte'])
    checkedFraction(source[name],label+'.'+name,true);
  for (const [name,fields] of [['poolVotingThresholds',POOL_THRESHOLDS],['drepVotingThresholds',DREP_THRESHOLDS]]) {
    const thresholds=source[name];
    if (!thresholds||typeof thresholds!=='object'||Array.isArray(thresholds))
      throw new TypeError(label+'.'+name+' must be a complete voting-threshold object.');
    for (const field of fields) checkedFraction(thresholds[field],label+'.'+name+'.'+field,true);
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
  validateConwaySource(source,label);
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
