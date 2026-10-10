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
        plutus_v1:Some(cost_model(extra,"plutusV1CostModel",166)?),
        plutus_v2:Some(cost_model(extra,"plutusV2CostModel",175)?),
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
        minfee_refscript_cost_per_byte:rat(extra,"minFeeRefScriptCostPerByte",true)?
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

}
