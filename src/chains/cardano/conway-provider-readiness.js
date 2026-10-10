import { hashCardanoEvidence } from './evidence-binding.js';

const REQUIRED = Object.freeze([
  'systemStart', 'epochLength', 'slotLength', 'maxBlockBodySize', 'maxBlockHeaderSize',
  'keyDeposit', 'poolDeposit', 'desiredNumberOfStakePools', 'minPoolCost',
  'maxBlockExUnits', 'maximumEpoch', 'poolPledgeInfluence', 'expansionRate',
  'treasuryGrowthRate', 'poolVotingThresholds', 'drepVotingThresholds',
  'minCommitteeSize', 'committeeTermLimit', 'governanceActionValidityPeriod',
  'governanceActionDeposit', 'drepDeposit', 'drepInactivityPeriod',
  'minFeeRefScriptCostPerByte', 'plutusV1CostModel', 'plutusV2CostModel'
]);

const MAPPING = Object.freeze({
  maxBlockBodySize: ['maxBlockBodySize.bytes', 'max_block_size', 'integer'],
  maxBlockHeaderSize: ['maxBlockHeaderSize.bytes', 'max_block_header_size', 'integer'],
  keyDeposit: ['stakeCredentialDeposit.ada.lovelace', 'key_deposit', 'integer'],
  poolDeposit: ['stakePoolDeposit.ada.lovelace', 'pool_deposit', 'integer'],
  desiredNumberOfStakePools: ['desiredNumberOfStakePools', 'n_opt', 'integer'],
  minPoolCost: ['minStakePoolCost.ada.lovelace', 'min_pool_cost', 'integer'],
  maximumEpoch: ['stakePoolRetirementEpochBound', 'e_max', 'integer'],
  poolPledgeInfluence: ['stakePoolPledgeInfluence', 'a0', 'rational'],
  expansionRate: ['monetaryExpansion', 'rho', 'rational'],
  treasuryGrowthRate: ['treasuryExpansion', 'tau', 'rational'],
  minCommitteeSize: ['constitutionalCommitteeMinSize', 'committee_min_size', 'integer'],
  committeeTermLimit: ['constitutionalCommitteeMaxTermLength', 'committee_max_term_length', 'integer'],
  governanceActionValidityPeriod: ['governanceActionLifetime', 'gov_action_lifetime', 'integer'],
  governanceActionDeposit: ['governanceActionDeposit.ada.lovelace', 'gov_action_deposit', 'integer'],
  drepDeposit: ['delegateRepresentativeDeposit.ada.lovelace', 'drep_deposit', 'integer'],
  drepInactivityPeriod: ['delegateRepresentativeMaxIdleTime', 'drep_activity', 'integer'],
  plutusV1CostModel: ['plutusCostModels.plutus:v1', 'cost_models_raw.PlutusV1', 'cost166'],
  plutusV2CostModel: ['plutusCostModels.plutus:v2', 'cost_models_raw.PlutusV2', 'cost175']
});

// Exact Conway paths defined in Ogmios' TypeScript schema and Blockfrost's
// epoch parameter response. Incomplete groups remain unresolved, never agreed.
const VOTING_THRESHOLD_FIELDS = Object.freeze({
  poolVotingThresholds: Object.freeze({
    motionNoConfidence:['noConfidence','pvt_motion_no_confidence'],
    committeeNormal:['constitutionalCommittee.default','pvt_committee_normal'],
    committeeNoConfidence:['constitutionalCommittee.stateOfNoConfidence','pvt_committee_no_confidence'],
    hardForkInitiation:['hardForkInitiation','pvt_hard_fork_initiation'],
    securityVotingThreshold:['protocolParametersUpdate.security','pvt_p_p_security_group']
  }),
  drepVotingThresholds: Object.freeze({
    motionNoConfidence:['noConfidence','dvt_motion_no_confidence'],
    committeeNormal:['constitutionalCommittee.default','dvt_committee_normal'],
    committeeNoConfidence:['constitutionalCommittee.stateOfNoConfidence','dvt_committee_no_confidence'],
    updateConstitution:['constitution','dvt_update_to_constitution'],
    hardForkInitiation:['hardForkInitiation','dvt_hard_fork_initiation'],
    ppNetworkGroup:['protocolParametersUpdate.network','dvt_p_p_network_group'],
    ppEconomicGroup:['protocolParametersUpdate.economic','dvt_p_p_economic_group'],
    ppTechnicalGroup:['protocolParametersUpdate.technical','dvt_p_p_technical_group'],
    ppGovernanceGroup:['protocolParametersUpdate.governance','dvt_p_p_gov_group'],
    treasuryWithdrawal:['treasuryWithdrawals','dvt_treasury_withdrawal']
  })
});

function getPath(data, path) {
  return path.split('.').reduce((value, key) => value?.[key], data);
}
function parseUnsigned(value, label) {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      !/^(0|[1-9]\d*)$/.test(String(value)) ||
      (typeof value === 'number' && !Number.isSafeInteger(value))) {
    throw new TypeError(label + ' must be an unsigned integer without truncation.');
  }
  const number = BigInt(String(value));
  if (number > 18446744073709551615n) throw new RangeError(label + ' exceeds u64.');
  return number.toString();
}
function rational(value, label) {
  if (value == null) throw new TypeError(label + ' is missing.');
  let numerator, denominator;
  if (typeof value === 'object' && !Array.isArray(value)) {
    numerator = parseUnsigned(value.numerator, label + '.numerator');
    denominator = parseUnsigned(value.denominator, label + '.denominator');
  } else {
    const text = String(value);
    if (/^\d+\/\d+$/.test(text)) {
      [numerator, denominator] = text.split('/');
    } else {
      if (!/^(?:\d+)(?:\.\d+)?$/.test(text) || text.length > 80) {
        throw new TypeError(label + ' is not an exact decimal or rational.');
      }
      const [whole, fraction = ''] = text.split('.');
      numerator = whole + fraction;
      denominator = (10n ** BigInt(fraction.length)).toString();
    }
  }
  let a = BigInt(numerator), b = BigInt(denominator);
  if (b === 0n) throw new TypeError(label + ' denominator is zero.');
  if (a > 18446744073709551615n || b > 18446744073709551615n) {
    throw new RangeError(label + ' exceeds supported integer width.');
  }
  let x = a, y = b;
  while (y !== 0n) [x, y] = [y, x % y];
  a /= x; b /= x;
  return Object.freeze({ numerator: a.toString(), denominator: b.toString() });
}
function normalize(value, kind, label) {
  if (kind === 'integer') return parseUnsigned(value, label);
  if (kind === 'rational') return rational(value, label);
  if (kind === 'cost166' || kind === 'cost175') {
    const size = Number(kind.slice(4));
    if (!Array.isArray(value) || value.length !== size ||
        value.some(v => !Number.isSafeInteger(v))) {
      throw new TypeError(label + ' must contain exactly ' + size + ' safe signed integers.');
    }
    return [...value];
  }
  throw new TypeError('Unsupported parameter kind.');
}
function normalizeVotingGroup(source, name, fields, label) {
  const isOgmios=label==='Ogmios';
  const ogmiosKey=name==='poolVotingThresholds'
    ? 'stakePoolVotingThresholds' : 'delegateRepresentativeVotingThresholds';
  const root=isOgmios ? source?.[ogmiosKey] : source;
  if (root==null || typeof root!=='object' || Array.isArray(root)) {
    throw new TypeError(label+' '+name+' thresholds are missing or malformed.');
  }
  const normalized={};
  for (const [key,[ogmiosPath,blockfrostField]] of Object.entries(fields)) {
    const value=isOgmios ? getPath(root,ogmiosPath) : root[blockfrostField];
    const fraction=rational(value,label+' '+name+'.'+key);
    if (BigInt(fraction.numerator)>BigInt(fraction.denominator)) {
      throw new RangeError(label+' '+name+'.'+key+' exceeds voting threshold 1.');
    }
    normalized[key]=fraction;
  }
  return Object.freeze(normalized);
}

function normalizeBudget(value, source) {
  return Object.freeze({
    memory: parseUnsigned(value?.memory ?? value?.mem, source + '.memory'),
    steps: parseUnsigned(value?.cpu ?? value?.steps, source + '.steps')
  });
}
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Read-only two-source Conway field coverage report. No provider call is made.
 * Missing genesis fields, unsupported nested fee pricing or disagreement must
 * NOT be papered over with defaults. The report is never an authority grant.
 */
export function createCardanoPreprodConwayReadinessReport({
  ogmiosParameters, blockfrostParameters, tipBefore, tipAfter, protocolSnapshot
}) {
  const tip = protocolSnapshot?.tip;
  if (protocolSnapshot?.network !== 'preprod' ||
      protocolSnapshot?.source?.independentSourceCount !== 2 ||
      protocolSnapshot?.promotion?.independentlyConfirmed !== true ||
      !tip || tip.blockHash !== tipBefore?.hash || tip.blockHash !== tipAfter?.hash ||
      tip.slot !== tipBefore?.slot || tip.slot !== tipAfter?.slot) {
    throw new Error('Conway readiness requires two provider sources at one unchanged, independently agreed Preprod tip.');
  }
  const ogmios = ogmiosParameters?.protocolParameters ?? ogmiosParameters;
  const blockfrost = blockfrostParameters;
  if (!ogmios || !blockfrost) throw new TypeError('Both live Conway protocol-parameter responses are required.');
  const agreed = {};
  const unresolved = {};
  const mismatched = {};
  for (const [name, [ogmiosPath, blockfrostPath, kind]] of Object.entries(MAPPING)) {
    let a, b, errorA = null, errorB = null;
    try { a = normalize(getPath(ogmios, ogmiosPath), kind, 'Ogmios ' + name); }
    catch (error) { errorA = error.message; }
    try { b = normalize(getPath(blockfrost, blockfrostPath), kind, 'Blockfrost ' + name); }
    catch (error) { errorB = error.message; }
    if (errorA || errorB) unresolved[name] = Object.freeze({ ogmios: errorA, blockfrost: errorB });
    else if (!same(a, b)) mismatched[name] = Object.freeze({ ogmios: a, blockfrost: b });
    else agreed[name] = a;
  }
  try {
    const a = normalizeBudget(ogmios.maxExecutionUnitsPerBlock, 'Ogmios max block execution');
    const b = normalizeBudget({
      memory: blockfrost.max_block_ex_mem, steps: blockfrost.max_block_ex_steps
    }, 'Blockfrost max block execution');
    if (same(a,b)) agreed.maxBlockExUnits = a;
    else mismatched.maxBlockExUnits = Object.freeze({ogmios:a,blockfrost:b});
  } catch(error) { unresolved.maxBlockExUnits = error.message; }

  for (const [name,fields] of Object.entries(VOTING_THRESHOLD_FIELDS)) {
    let a,b,errorA=null,errorB=null;
    try { a=normalizeVotingGroup(ogmios,name,fields,'Ogmios'); }
    catch(error) {errorA=error.message;}
    try { b=normalizeVotingGroup(blockfrost,name,fields,'Blockfrost'); }
    catch(error) {errorB=error.message;}
    if (errorA || errorB) unresolved[name]=Object.freeze({ogmios:errorA,blockfrost:errorB});
    else if (!same(a,b)) mismatched[name]=Object.freeze({ogmios:a,blockfrost:b});
    else agreed[name]=a;
  }

  for (const name of REQUIRED) {
    if (!(name in agreed) && !(name in unresolved) && !(name in mismatched)) {
      unresolved[name] = name === 'systemStart' || name === 'epochLength' || name === 'slotLength'
        ? 'Requires separately verified Cardano Preprod genesis/era-timing evidence.'
        : name === 'minFeeRefScriptCostPerByte'
          ? 'Ogmios tiered reference-script fees need explicit compatible transformation; no inferred scalar.'
          : 'Provider governance parameter normalization not yet implemented or source unavailable.';
    }
  }
  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-conway-provider-readiness.v1',
    network: 'preprod',
    tip: Object.freeze({ hash: tip.blockHash, slot: tip.slot }),
    providers: Object.freeze(['Ogmios', 'Blockfrost']),
    agreed: Object.freeze(agreed),
    unresolved: Object.freeze(unresolved),
    mismatched: Object.freeze(mismatched),
    coveredParameterCount: Object.keys(agreed).length,
    requiredParameterCount: REQUIRED.length,
    completeConwayParametersEstablished: false,
    completePhaseOneValidated: false,
    transactionSubmissionAuthorized: false,
    transactionSubmissionPerformed: false,
    nextGate: 'Corroborate missing governance and genesis/era-timing parameters; resolve all mismatches; rebuild live signed candidate separately.',
    authorityBoundary: 'Read-only provider coverage diagnostics. No signed-body freshness, full Conway validation, wallet signing or transaction submission is authorized.'
  });
  return Object.freeze({ ...core, reportSha256: hashCardanoEvidence(core) });
}
