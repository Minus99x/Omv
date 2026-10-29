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
  // A ledger u64 has at most 20 decimal digits. Reject excessive provider
  // payloads before invoking BigInt; this diagnostic is evaluation-only.
  const decimal = String(value);
  if (decimal.length > 20) throw new RangeError(label + ' exceeds u64.');
  const number = BigInt(decimal);
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
    // Applies to both rational and decimal representations. The decimal
    // branch was already bounded, but a/b text had no pre-parse size limit.
    if (text.length > 80) throw new RangeError(label + ' exceeds supported integer width.');
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
function normalize(value, kind, label, protocolMajor) {
  if (kind === 'integer') return parseUnsigned(value, label);
  if (kind === 'rational') return rational(value, label);
  if (kind === 'cost166' || kind === 'cost175') {
    // PV11 expands both older-language models to 332 coefficients. Do not
    // truncate them to the historical V1=166 / V2=175 layouts.
    const sizes = protocolMajor >= 11 ? [332] : [Number(kind.slice(4)), 332];
    if (!Array.isArray(value) || !sizes.includes(value.length) ||
        !Array.from({length:value.length}, (_, i) =>
          Object.hasOwn(value, i) && Number.isSafeInteger(value[i])).every(Boolean)) {
      throw new TypeError(label + ' must contain ' + sizes.join(' or ') + ' own safe signed integers.');
    }
    return Object.freeze([...value]);
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

// Shared normalized comparison for diagnostics AND enforcing capture/replay gates.
// Provider authentication and ledger timing are established by the collector.
export function compareCardanoConwayProtocolParameters(ogmiosParameters, blockfrostParameters) {
  const ogmios = ogmiosParameters?.protocolParameters ?? ogmiosParameters;
  const blockfrost = blockfrostParameters;
  if (!ogmios || !blockfrost) throw new TypeError('Both live Conway protocol-parameter responses are required.');
  const agreed = {};
  const unresolved = {};
  const mismatched = {};
  const supplied = {};
  const parameterPaths = {};
  const protocolMajor = Number(ogmios.version?.major ?? blockfrost.protocol_major_ver);
  for (const [name, [ogmiosPath, blockfrostPath, kind]] of Object.entries(MAPPING)) {
    supplied[name] = getPath(ogmios, ogmiosPath) !== undefined || getPath(blockfrost, blockfrostPath) !== undefined;
    parameterPaths[name] = Object.freeze([blockfrostPath]);
    let a, b, errorA = null, errorB = null;
    try { a = normalize(getPath(ogmios, ogmiosPath), kind, 'Ogmios ' + name, protocolMajor); }
    catch (error) { errorA = error.message; }
    try { b = normalize(getPath(blockfrost, blockfrostPath), kind, 'Blockfrost ' + name, protocolMajor); }
    catch (error) { errorB = error.message; }
    if (errorA || errorB) unresolved[name] = Object.freeze({ ogmios: errorA, blockfrost: errorB });
    else if (!same(a, b)) mismatched[name] = Object.freeze({ ogmios: a, blockfrost: b });
    else agreed[name] = a;
  }
  supplied.maxBlockExUnits = ogmios.maxExecutionUnitsPerBlock !== undefined ||
    blockfrost.max_block_ex_mem !== undefined || blockfrost.max_block_ex_steps !== undefined;
  parameterPaths.maxBlockExUnits = Object.freeze(['max_block_ex_mem', 'max_block_ex_steps']);
  try {
    const a = normalizeBudget(ogmios.maxExecutionUnitsPerBlock, 'Ogmios max block execution');
    const b = normalizeBudget({
      memory: blockfrost.max_block_ex_mem, steps: blockfrost.max_block_ex_steps
    }, 'Blockfrost max block execution');
    if (same(a,b)) agreed.maxBlockExUnits = a;
    else mismatched.maxBlockExUnits = Object.freeze({ogmios:a,blockfrost:b});
  } catch(error) { unresolved.maxBlockExUnits = error.message; }

  for (const [name,fields] of Object.entries(VOTING_THRESHOLD_FIELDS)) {
    const root = name === 'poolVotingThresholds' ? 'stakePoolVotingThresholds' : 'delegateRepresentativeVotingThresholds';
    parameterPaths[name] = Object.freeze(Object.values(fields).map(([, path]) => path));
    supplied[name] = ogmios[root] !== undefined || parameterPaths[name].some(path => blockfrost[path] !== undefined);
    let a,b,errorA=null,errorB=null;
    try { a=normalizeVotingGroup(ogmios,name,fields,'Ogmios'); }
    catch(error) {errorA=error.message;}
    try { b=normalizeVotingGroup(blockfrost,name,fields,'Blockfrost'); }
    catch(error) {errorB=error.message;}
    if (errorA || errorB) unresolved[name]=Object.freeze({ogmios:errorA,blockfrost:errorB});
    else if (!same(a,b)) mismatched[name]=Object.freeze({ogmios:a,blockfrost:b});
    else agreed[name]=a;
  }

  // Scalus 1.3.0 RefScriptFee.scala uses Conway's 25,600-byte strides
  // and exact 6/5 multiplier. Blockfrost exposes only the base price, so
  // corroborate that price and explicitly check the other provider's tiers
  // against the implemented ledger formula rather than silently discarding them.
  supplied.minFeeRefScriptCostPerByte = ogmios.minFeeReferenceScripts !== undefined ||
    blockfrost.min_fee_ref_script_cost_per_byte !== undefined;
  parameterPaths.minFeeRefScriptCostPerByte = Object.freeze(['min_fee_ref_script_cost_per_byte']);
  let referenceScriptFeeSchedule = null;
  try {
    const fees = ogmios.minFeeReferenceScripts;
    const range = parseUnsigned(fees?.range, 'Ogmios reference-script range');
    const multiplier = rational(fees?.multiplier, 'Ogmios reference-script multiplier');
    const a = rational(fees?.base, 'Ogmios reference-script base price');
    const b = rational(blockfrost.min_fee_ref_script_cost_per_byte, 'Blockfrost reference-script base price');
    if (range !== '25600' || multiplier.numerator !== '6' || multiplier.denominator !== '5') {
      throw new Error('Reference-script tiers are incompatible with the supported Conway fee formula.');
    }
    if (!same(a, b)) mismatched.minFeeRefScriptCostPerByte = Object.freeze({ogmios:a, blockfrost:b});
    else {
      agreed.minFeeRefScriptCostPerByte = a;
      referenceScriptFeeSchedule = Object.freeze({range, multiplier, base:a});
    }
  } catch (error) { unresolved.minFeeRefScriptCostPerByte = error.message; }

  return Object.freeze({
    agreed: Object.freeze(agreed), unresolved: Object.freeze(unresolved),
    mismatched: Object.freeze(mismatched), supplied: Object.freeze(supplied),
    parameterPaths: Object.freeze(parameterPaths), referenceScriptFeeSchedule
  });
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
  const comparison = compareCardanoConwayProtocolParameters(ogmiosParameters, blockfrostParameters);
  const agreed = {...comparison.agreed};
  const unresolved = {...comparison.unresolved};
  const mismatched = {...comparison.mismatched};

  for (const name of REQUIRED) {
    if (!(name in agreed) && !(name in unresolved) && !(name in mismatched)) {
      unresolved[name] = name === 'systemStart' || name === 'epochLength' || name === 'slotLength'
        ? 'Requires separately verified Cardano Preprod genesis/era-timing evidence.'
        : name === 'minFeeRefScriptCostPerByte'
          ? 'Complete compatible reference-script fee evidence is required.'
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
