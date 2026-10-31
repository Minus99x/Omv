//! Build the complete Conway protocol parameter structure consumed by Pallas.
//!
//! Existing OmegaVault pre-submit snapshots contain the critical transaction
//! parameters but NOT every Conway rule parameter. No epoch / governance /
//! Plutus cost-model value is assumed, filled with mainnet defaults, or
//! silently replaced by a test fixture. Missing authentic data fails CLOSED.
//!
//! The caller must independently verify the bound snapshot SHA-256 before
//! calling this parser; an independently reconstructed current-ledger verdict
//! additionally requires live tip/input freshness and human consent.

use std::collections::BTreeMap;
use chrono::DateTime;
use pallas_primitives::{
    conway::{CostModels, DRepVotingThresholds, PoolVotingThresholds},
    ExUnitPrices, ExUnits, RationalNumber,
};
use pallas_validate::utils::ConwayProtParams;
use serde_json::Value;
use sha2::{Digest,Sha256};

const REQUIRED_EXTRA: &[&str] = &[
    "systemStart", "epochLength", "slotLength",
    "maxBlockBodySize", "maxBlockHeaderSize",
    "keyDeposit", "poolDeposit", "desiredNumberOfStakePools",
    "minPoolCost", "maxBlockExUnits", "maximumEpoch",
    "poolPledgeInfluence", "expansionRate", "treasuryGrowthRate",
    "poolVotingThresholds", "drepVotingThresholds",
    "minCommitteeSize", "committeeTermLimit",
    "governanceActionValidityPeriod", "governanceActionDeposit",
    "drepDeposit", "drepInactivityPeriod",
    "minFeeRefScriptCostPerByte", "plutusV1CostModel",
    "plutusV2CostModel"
];

fn required<'a>(root: &'a Value, field: &str) -> Result<&'a Value, String> {
    root.get(field)
        .ok_or_else(|| format!("Missing independently verified Conway ledger parameter: {field}"))
}
fn u64_value(value: &Value, label: &str) -> Result<u64, String> {
    match value {
        Value::String(x) if !x.is_empty() && x.bytes().all(|b| b.is_ascii_digit()) =>
            x.parse::<u64>().map_err(|_| format!("{label} integer overflow")),
        Value::Number(x) => x.as_u64().ok_or_else(|| format!("{label} is not an unsigned integer")),
        _ => Err(format!("{label} must be a non-negative integer")),
    }
}
fn uint(root: &Value, key: &str) -> Result<u64, String> {
    u64_value(required(root, key)?, key)
}
fn uint32(root: &Value, key: &str) -> Result<u32, String> {
    uint(root, key)?.try_into().map_err(|_| format!("{key} exceeds u32"))
}
fn ratio(value: &Value, label: &str, unit: bool) -> Result<RationalNumber, String> {
    let numerator = u64_value(required(value, "numerator")?, &format!("{label}.numerator"))?;
    let denominator = u64_value(required(value, "denominator")?, &format!("{label}.denominator"))?;
    if denominator == 0 || (unit && numerator > denominator) {
        return Err(format!("{label} is not a valid rational"));
    }
    Ok(RationalNumber { numerator, denominator })
}
fn rat(root: &Value, key: &str, unit: bool) -> Result<RationalNumber, String> {
    ratio(required(root,key)?,key,unit)
}
fn exunits(root: &Value, key: &str) -> Result<ExUnits, String> {
    let units = required(root,key)?;
    let mem = uint(units,"memory")?;
    let steps = uint(units,"steps")?;
    if mem == 0 || steps == 0 {return Err(format!("{key} execution limits must be positive"))}
    Ok(ExUnits {mem,steps})
}
fn cost_model(params: &Value, key: &str, len: usize) -> Result<Vec<i64>, String> {
    let array = required(params,key)?.as_array()
        .ok_or_else(|| format!("{key} requires an ordered array"))?;
    if array.len() != len {return Err(format!("{key} requires exactly {len} ordered coefficients"));}
    array.iter().enumerate().map(|(i,v)|
        v.as_i64().ok_or_else(|| format!("{key}[{i}] must be a signed 64-bit integer"))
    ).collect()
}

fn pool_thresholds(root: &Value) -> Result<PoolVotingThresholds,String> {
    let k=required(root,"poolVotingThresholds")?;
    Ok(PoolVotingThresholds{
        motion_no_confidence:rat(k,"motionNoConfidence",true)?,
        committee_normal:rat(k,"committeeNormal",true)?,
        committee_no_confidence:rat(k,"committeeNoConfidence",true)?,
        hard_fork_initiation:rat(k,"hardForkInitiation",true)?,
        security_voting_threshold:rat(k,"securityVotingThreshold",true)?,
    })
}
fn drep_thresholds(root: &Value) -> Result<DRepVotingThresholds,String> {
    let k=required(root,"drepVotingThresholds")?;
    Ok(DRepVotingThresholds{
        motion_no_confidence:rat(k,"motionNoConfidence",true)?,
        committee_normal:rat(k,"committeeNormal",true)?,
        committee_no_confidence:rat(k,"committeeNoConfidence",true)?,
        update_constitution:rat(k,"updateConstitution",true)?,
        hard_fork_initiation:rat(k,"hardForkInitiation",true)?,
        pp_network_group:rat(k,"ppNetworkGroup",true)?,
        pp_economic_group:rat(k,"ppEconomicGroup",true)?,
        pp_technical_group:rat(k,"ppTechnicalGroup",true)?,
        pp_governance_group:rat(k,"ppGovernanceGroup",true)?,
        treasury_withdrawal:rat(k,"treasuryWithdrawal",true)?,
    })
}

/// The current snapshot has a digest-bound abbreviated parameter set.
/// Return exactly which independently agreed properties still need capture.
pub fn missing_conway_parameter_fields(snapshot: &Value) -> Vec<String> {
    let mut missing = Vec::new();
    let extra = snapshot.pointer("/parameters/completeConway");
    for field in REQUIRED_EXTRA {
        if extra.and_then(|v|v.get(*field)).is_none() {
            missing.push((*field).to_owned());
        }
    }
    missing
}

/// Requires full independently agreed Conway extension inside an already
/// digest-verified protocol snapshot. The parser never creates fallback
/// parameters and does not make claims about actual network freshness.
pub fn conway_params_from_verified_snapshot(snapshot: &Value) -> Result<ConwayProtParams,String> {
    if snapshot.get("network").and_then(Value::as_str) != Some("preprod")
        || snapshot.get("networkId").and_then(Value::as_u64) != Some(0)
        || snapshot.pointer("/source/independentSourceCount").and_then(Value::as_u64).unwrap_or(0) < 2
        || snapshot.pointer("/promotion/independentlyConfirmed").and_then(Value::as_bool) != Some(true)
    {
        return Err("Conway parameters require independently confirmed Preprod ledger provenance".into());
    }
    let params = snapshot.get("parameters").ok_or("Missing bound protocol parameters")?;
    if params.get("era").and_then(Value::as_str) != Some("Conway") {
        return Err("Expected Conway protocol era".into());
    }
    let missing = missing_conway_parameter_fields(snapshot);
    if !missing.is_empty() {
        return Err(format!("Complete independently verified Conway parameters missing: {}",missing.join(", ")));
    }
    let extra = required(params,"completeConway")?;
    let agreement=required(params,"completeConwayAgreement")?;
    if uint(agreement,"independentSourceCount")? < 2 {
        return Err("Complete Conway parameters lack two independent provider confirmations".into());
    }
    let source_tip=snapshot.pointer("/tip/blockHash").and_then(Value::as_str)
        .ok_or("Missing independently observed tip hash for extended Conway agreement")?;
    let source_slot=snapshot.pointer("/tip/slot").and_then(Value::as_u64)
        .ok_or("Missing independently observed tip slot for extended Conway agreement")?;
    let agreed_hash=required(agreement,"acquiredStableTipHash")?.as_str()
        .ok_or("Missing stable tip hash in extended agreement")?;
    if agreed_hash != source_tip || uint(agreement,"acquiredStableTipSlot")? != source_slot {
        return Err("Extended Conway agreement was not acquired at the bound stable tip".into());
    }
    let canonical=serde_json::to_vec(extra)
        .map_err(|_|"Could not canonicalize complete Conway parameters")?;
    let actual_digest=hex::encode(Sha256::digest(canonical));
    for provider in ["ogmiosSha256","blockfrostSha256"] {
        let expected=required(agreement,provider)?.as_str()
            .ok_or_else(||format!("Missing {provider} extended Conway digest"))?;
        if expected != actual_digest {
            return Err(format!("Extended Conway provider disagreement: {provider} digest mismatch"));
        }
    }
    let started = required(extra,"systemStart")?.as_str()
        .ok_or("Conway systemStart must be RFC3339 UTC time")?;
    let system_start = DateTime::parse_from_rfc3339(started)
        .map_err(|_| "Invalid Conway systemStart RFC3339 datetime")?;
    let version = required(params,"protocolVersion")?.as_str()
        .ok_or("Missing Conway protocol version")?;
    let mut parts=version.split('.');
    let major = parts.next().ok_or("Missing protocol major")?.parse::<u64>()
        .map_err(|_|"Invalid protocol major")?;
    let minor = parts.next().ok_or("Missing protocol minor")?.parse::<u64>()
        .map_err(|_|"Invalid protocol minor")?;
    if parts.next().is_some() {return Err("Invalid Conway protocol version format".into());}

    let prices = ExUnitPrices{
        mem_price:rat(params,"priceMemory",true)?,
        step_price:rat(params,"priceSteps",true)?,
    };
    let models = CostModels {
        plutus_v1:Some(cost_model(extra,"plutusV1CostModel",if major >= 11 {332} else {166})?),
        plutus_v2:Some(cost_model(extra,"plutusV2CostModel",if major >= 11 {332} else {175})?),
        plutus_v3:Some(cost_model(params,"plutusV3CostModel",350)?),
        unknown:BTreeMap::new()
    };
    Ok(ConwayProtParams{
        system_start,
        epoch_length:uint(extra,"epochLength")?,
        slot_length:uint(extra,"slotLength")?,
        minfee_a:uint32(params,"minFeeA")?,
        minfee_b:uint32(params,"minFeeB")?,
        max_block_body_size:uint32(extra,"maxBlockBodySize")?,
        max_transaction_size:uint32(params,"maxTxSize")?,
        max_block_header_size:uint32(extra,"maxBlockHeaderSize")?,
        key_deposit:uint(extra,"keyDeposit")?,
        pool_deposit:uint(extra,"poolDeposit")?,
        desired_number_of_stake_pools:uint32(extra,"desiredNumberOfStakePools")?,
        protocol_version:(major,minor),
        min_pool_cost:uint(extra,"minPoolCost")?,
        ada_per_utxo_byte:uint(params,"coinsPerUtxoByte")?,
        cost_models_for_script_languages:models,
        execution_costs:prices,
        max_tx_ex_units:exunits(params,"maxTxExUnits")?,
        max_block_ex_units:exunits(extra,"maxBlockExUnits")?,
        max_value_size:uint32(params,"maxValueSize")?,
        collateral_percentage:uint32(params,"collateralPercentage")?,
        max_collateral_inputs:uint32(params,"maxCollateralInputs")?,
        expansion_rate:rat(extra,"expansionRate",true)?,
        treasury_growth_rate:rat(extra,"treasuryGrowthRate",true)?,
        maximum_epoch:uint(extra,"maximumEpoch")?,
        pool_pledge_influence:rat(extra,"poolPledgeInfluence",false)?,
        pool_voting_thresholds:pool_thresholds(extra)?,
        drep_voting_thresholds:drep_thresholds(extra)?,
        min_committee_size:uint(extra,"minCommitteeSize")?,
        committee_term_limit:uint(extra,"committeeTermLimit")?,
        governance_action_validity_period:uint(extra,"governanceActionValidityPeriod")?,
        governance_action_deposit:uint(extra,"governanceActionDeposit")?,
        drep_deposit:uint(extra,"drepDeposit")?,
        drep_inactivity_period:uint(extra,"drepInactivityPeriod")?,
        minfee_refscript_cost_per_byte:rat(extra,"minFeeRefScriptCostPerByte",false)?
    })
}

#[cfg(test)]
mod tests{
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_real_ledger_fields_are_explicit_not_filled_from_mainnet() {
        let snapshot=json!({"parameters":{"era":"Conway","protocolVersion":"10.0"}});
        let names=missing_conway_parameter_fields(&snapshot);
        assert!(names.contains(&"systemStart".to_owned()));
        assert!(names.contains(&"plutusV2CostModel".to_owned()));
        assert!(names.contains(&"poolVotingThresholds".to_owned()));
        assert_eq!(names.len(),REQUIRED_EXTRA.len());
    }
    #[test]
    fn rejects_preprod_without_two_independent_sources() {
        let snapshot=json!({"network":"preprod","networkId":0,"source":{"independentSourceCount":1},"parameters":{"era":"Conway"}});
        assert!(conway_params_from_verified_snapshot(&snapshot).unwrap_err().contains("independently confirmed"));
    }
    #[test]
    fn never_constructs_pallas_parameters_from_partial_live_snapshot() {
        let snapshot=json!({
            "network":"preprod","networkId":0,
            "source":{"independentSourceCount":2},
            "promotion":{"independentlyConfirmed":true},
            "parameters":{"era":"Conway","protocolVersion":"10.0","minFeeA":"44","minFeeB":"155381"}
        });
        let error=conway_params_from_verified_snapshot(&snapshot).unwrap_err();
        assert!(error.contains("systemStart"));
        assert!(error.contains("governanceActionDeposit"));
        assert!(error.contains("plutusV1CostModel"));
    }
    #[test]
    fn rejects_invalid_or_overflowing_snapshot_numeric_fields() {
        assert!(u64_value(&json!("18446744073709551616"),"foo").is_err());
        assert!(u64_value(&json!("-1"),"foo").is_err());
        assert!(ratio(&json!({"numerator":"4","denominator":"0"}),"ratio",true).is_err());
        assert!(ratio(&json!({"numerator":"3","denominator":"2"}),"ratio",true).is_err());
    }
    #[test]
    fn explicit_agreement_is_required_for_extended_conway_fields() {
        let snapshot=json!({
            "network":"preprod","networkId":0,
            "source":{"independentSourceCount":2},
            "promotion":{"independentlyConfirmed":true},
            "parameters":{"era":"Conway","protocolVersion":"10.0","completeConway":{
                "systemStart":"2022-06-21T00:00:00Z"
            }}
        });
        assert!(missing_conway_parameter_fields(&snapshot).len()>0);
        assert!(conway_params_from_verified_snapshot(&snapshot).is_err());
    }

    fn complete_test_snapshot() -> Value {
        let half=json!({"numerator":"1","denominator":"2"});
        let pool=json!({
            "motionNoConfidence":half,"committeeNormal":half,"committeeNoConfidence":half,
            "hardForkInitiation":half,"securityVotingThreshold":half
        });
        let drep=json!({
            "motionNoConfidence":half,"committeeNormal":half,"committeeNoConfidence":half,
            "updateConstitution":half,"hardForkInitiation":half,
            "ppNetworkGroup":half,"ppEconomicGroup":half,"ppTechnicalGroup":half,
            "ppGovernanceGroup":half,"treasuryWithdrawal":half
        });
        let complete=json!({
            "systemStart":"2022-06-21T00:00:00Z",
            "epochLength":432000,"slotLength":1,
            "maxBlockBodySize":90112,"maxBlockHeaderSize":1100,
            "keyDeposit":"2000000","poolDeposit":"500000000",
            "desiredNumberOfStakePools":500,"minPoolCost":"340000000",
            "maxBlockExUnits":{"memory":"62000000","steps":"40000000000"},
            "maximumEpoch":18,"poolPledgeInfluence":half,
            "expansionRate":half,"treasuryGrowthRate":half,
            "poolVotingThresholds":pool,"drepVotingThresholds":drep,
            "minCommitteeSize":1,"committeeTermLimit":100,
            "governanceActionValidityPeriod":100,
            "governanceActionDeposit":"100000000000",
            "drepDeposit":"500000000","drepInactivityPeriod":20,
            "minFeeRefScriptCostPerByte":half,
            "plutusV1CostModel":vec![0;166],
            "plutusV2CostModel":vec![0;175]
        });
        let agreed=hex::encode(Sha256::digest(serde_json::to_vec(&complete).unwrap()));
        json!({
            "network":"preprod","networkId":0,
            "source":{"independentSourceCount":2},
            "promotion":{"independentlyConfirmed":true},
            "tip":{"blockHash":"abababababababababababababababababababababababababababababababab","slot":80000000},
            "parameters":{
                "era":"Conway","protocolVersion":"10.0",
                "minFeeA":"44","minFeeB":"155381","maxTxSize":16384,"maxValueSize":5000,
                "coinsPerUtxoByte":"4310",
                "priceMemory":{"numerator":"577","denominator":"10000"},
                "priceSteps":{"numerator":"721","denominator":"10000000"},
                "maxTxExUnits":{"memory":"14000000","steps":"10000000000"},
                "collateralPercentage":"150","maxCollateralInputs":3,
                "plutusV3CostModel":vec![0;350],
                "completeConway":complete,
                "completeConwayAgreement":{
                    "independentSourceCount":2,"ogmiosSha256":agreed,
                    "blockfrostSha256":agreed,
                    "acquiredStableTipHash":"abababababababababababababababababababababababababababababababab",
                    "acquiredStableTipSlot":80000000
                }
            }
        })
    }
    #[test]
    fn builds_native_pallas_conway_parameters_when_every_field_is_correlated() {
        let source=complete_test_snapshot();
        assert!(missing_conway_parameter_fields(&source).is_empty());
        let params=conway_params_from_verified_snapshot(&source).unwrap();
        assert_eq!(params.minfee_a,44);
        assert_eq!(params.ada_per_utxo_byte,4310);
        assert_eq!(params.max_tx_ex_units.mem,14000000);
        assert_eq!(params.cost_models_for_script_languages.plutus_v3.as_ref().unwrap().len(),350);
    }
    #[test]
    fn rejects_divergent_second_provider_digest_even_when_every_field_exists() {
        let mut source=complete_test_snapshot();
        source["parameters"]["completeConwayAgreement"]["blockfrostSha256"] = json!("0".repeat(64));
        assert!(conway_params_from_verified_snapshot(&source)
            .unwrap_err().contains("provider disagreement"));
    }
    #[test]
    fn rejects_extended_parameters_from_different_tip_slot() {
        let mut source=complete_test_snapshot();
        source["parameters"]["completeConwayAgreement"]["acquiredStableTipSlot"] = json!(80000001);
        assert!(conway_params_from_verified_snapshot(&source)
            .unwrap_err().contains("bound stable tip"));
    }

    fn rebind_test_agreement(source: &mut Value) {
        let digest=hex::encode(Sha256::digest(serde_json::to_vec(
            &source["parameters"]["completeConway"]).unwrap()));
        for provider in ["ogmiosSha256","blockfrostSha256"] {
            source["parameters"]["completeConwayAgreement"][provider]=json!(digest);
        }
    }
    fn pv11_test_snapshot() -> Value {
        let mut source=complete_test_snapshot();
        source["parameters"]["protocolVersion"]=json!("11.0");
        for key in ["plutusV1CostModel","plutusV2CostModel"] {
            source["parameters"]["completeConway"][key]=json!((0..332).map(|i| i-166).collect::<Vec<i64>>());
        }
        source["parameters"]["completeConway"]["minFeeRefScriptCostPerByte"]=json!({"numerator":"15","denominator":"1"});
        rebind_test_agreement(&mut source);
        source
    }
    #[test]
    fn pv11_retains_complete_cost_models_and_non_unit_reference_price() {
        let params=conway_params_from_verified_snapshot(&pv11_test_snapshot()).unwrap();
        for model in [params.cost_models_for_script_languages.plutus_v1,
                      params.cost_models_for_script_languages.plutus_v2] {
            let values=model.unwrap();
            assert_eq!(values.len(),332);
            assert_eq!(values[331],165);
        }
        assert_eq!(params.minfee_refscript_cost_per_byte.numerator,15);
        assert_eq!(params.minfee_refscript_cost_per_byte.denominator,1);
    }
    #[test]
    fn pv11_rejects_truncated_and_noninteger_models_even_with_matching_digests() {
        for key in ["plutusV1CostModel","plutusV2CostModel"] {
            for invalid in [json!(vec![0;331]),json!(vec![0;166]),json!(vec![0;175])] {
                let mut source=pv11_test_snapshot();
                source["parameters"]["completeConway"][key]=invalid;
                rebind_test_agreement(&mut source);
                assert!(conway_params_from_verified_snapshot(&source).unwrap_err().contains("332"));
            }
            let mut source=pv11_test_snapshot();
            source["parameters"]["completeConway"][key][331]=json!(null);
            rebind_test_agreement(&mut source);
            assert!(conway_params_from_verified_snapshot(&source).unwrap_err().contains("signed 64-bit"));
        }
    }
    #[test]
    fn pv10_rejects_pv11_layout_without_protocol_upgrade() {
        let mut source=pv11_test_snapshot();
        source["parameters"]["protocolVersion"]=json!("10.0");
        assert!(conway_params_from_verified_snapshot(&source).unwrap_err().contains("166"));
    }
    #[test]
    fn reference_price_fraction_is_not_a_voting_threshold() {
        for (numerator,denominator) in [(31,2),(0,1)] {
            let mut source=pv11_test_snapshot();
            source["parameters"]["completeConway"]["minFeeRefScriptCostPerByte"]=json!({"numerator":numerator,"denominator":denominator});
            rebind_test_agreement(&mut source);
            let params=conway_params_from_verified_snapshot(&source).unwrap();
            assert_eq!(params.minfee_refscript_cost_per_byte.numerator,numerator);
        }
        let mut source=pv11_test_snapshot();
        source["parameters"]["completeConway"]["minFeeRefScriptCostPerByte"]=json!({"numerator":15,"denominator":0});
        rebind_test_agreement(&mut source);
        assert!(conway_params_from_verified_snapshot(&source).unwrap_err().contains("valid rational"));
    }

}
