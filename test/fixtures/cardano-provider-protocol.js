// Synthetic paired provider responses for offline comparison tests. No network.
export function blockfrostProtocolFixture() {
  return {
    epoch:400, protocol_major_ver:11, protocol_minor_ver:0,
    min_fee_a:44, min_fee_b:155381, max_tx_size:16384, max_val_size:'5000',
    coins_per_utxo_size:'4310', price_mem:0.0577, price_step:0.0000721,
    max_tx_ex_mem:'17500000', max_tx_ex_steps:'10000000000',
    collateral_percent:150, max_collateral_inputs:3,
    key_deposit:'2000000', pool_deposit:'500000000', min_pool_cost:'170000000',
    max_block_size:90112, max_block_header_size:1100, e_max:18, n_opt:500,
    a0:0.3, rho:0.003, tau:0.2, max_block_ex_mem:'62000000', max_block_ex_steps:'20000000000',
    committee_min_size:'3', committee_max_term_length:'146', gov_action_lifetime:'6',
    gov_action_deposit:'1000000000', drep_deposit:'500000000', drep_activity:'20',
    pvt_motion_no_confidence:0.51, pvt_committee_normal:0.6, pvt_committee_no_confidence:0.7,
    pvt_hard_fork_initiation:0.4, pvt_p_p_security_group:0.25,
    dvt_motion_no_confidence:0.5, dvt_committee_normal:0.6, dvt_committee_no_confidence:0.7,
    dvt_update_to_constitution:0.4, dvt_hard_fork_initiation:0.25,
    dvt_p_p_network_group:0.1, dvt_p_p_economic_group:0.2, dvt_p_p_technical_group:0.3,
    dvt_p_p_gov_group:0.8, dvt_treasury_withdrawal:0.9,
    min_fee_ref_script_cost_per_byte:15,
    cost_models_raw:{
      PlutusV1:Array.from({length:332},(_,i)=>i-12),
      PlutusV2:Array.from({length:332},(_,i)=>i+34),
      PlutusV3:Array.from({length:350},(_,i)=>i-10)
    }
  };
}

// Test-only inverse mapping, also used with the installed Scalus document to
// exercise its real importer without fetching provider data or signing wallets.
export function ogmiosProtocolFixture(p=blockfrostProtocolFixture()) {
  const ada=lovelace=>({ada:{lovelace}});
  return {
    version:{major:p.protocol_major_ver,minor:p.protocol_minor_ver},
    minFeeCoefficient:p.min_fee_a,minFeeConstant:ada(p.min_fee_b),
    maxTransactionSize:{bytes:p.max_tx_size},maxValueSize:{bytes:Number(p.max_val_size)},
    minUtxoDepositCoefficient:p.coins_per_utxo_size,
    scriptExecutionPrices:{memory:p.price_mem,cpu:p.price_step},
    maxExecutionUnitsPerTransaction:{memory:p.max_tx_ex_mem,cpu:p.max_tx_ex_steps},
    collateralPercentage:p.collateral_percent,maxCollateralInputs:p.max_collateral_inputs,
    stakeCredentialDeposit:ada(p.key_deposit),stakePoolDeposit:ada(p.pool_deposit),
    minStakePoolCost:ada(p.min_pool_cost),maxBlockBodySize:{bytes:p.max_block_size},
    maxBlockHeaderSize:{bytes:p.max_block_header_size},stakePoolRetirementEpochBound:p.e_max,
    desiredNumberOfStakePools:p.n_opt,stakePoolPledgeInfluence:p.a0,
    monetaryExpansion:p.rho,treasuryExpansion:p.tau,
    maxExecutionUnitsPerBlock:{memory:p.max_block_ex_mem,cpu:p.max_block_ex_steps},
    constitutionalCommitteeMinSize:p.committee_min_size,
    constitutionalCommitteeMaxTermLength:p.committee_max_term_length,
    governanceActionLifetime:p.gov_action_lifetime,governanceActionDeposit:ada(p.gov_action_deposit),
    delegateRepresentativeDeposit:ada(p.drep_deposit),delegateRepresentativeMaxIdleTime:p.drep_activity,
    stakePoolVotingThresholds:{noConfidence:p.pvt_motion_no_confidence,
      constitutionalCommittee:{default:p.pvt_committee_normal,stateOfNoConfidence:p.pvt_committee_no_confidence},
      hardForkInitiation:p.pvt_hard_fork_initiation,protocolParametersUpdate:{security:p.pvt_p_p_security_group}},
    delegateRepresentativeVotingThresholds:{noConfidence:p.dvt_motion_no_confidence,
      constitutionalCommittee:{default:p.dvt_committee_normal,stateOfNoConfidence:p.dvt_committee_no_confidence},
      constitution:p.dvt_update_to_constitution,hardForkInitiation:p.dvt_hard_fork_initiation,
      protocolParametersUpdate:{network:p.dvt_p_p_network_group,economic:p.dvt_p_p_economic_group,
        technical:p.dvt_p_p_technical_group,governance:p.dvt_p_p_gov_group},
      treasuryWithdrawals:p.dvt_treasury_withdrawal},
    minFeeReferenceScripts:{range:25600,multiplier:'6/5',base:p.min_fee_ref_script_cost_per_byte},
    plutusCostModels:{'plutus:v1':[...p.cost_models_raw.PlutusV1],
      'plutus:v2':[...p.cost_models_raw.PlutusV2],'plutus:v3':[...p.cost_models_raw.PlutusV3]}
  };
}
