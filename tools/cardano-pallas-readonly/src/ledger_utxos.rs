//! Convert exact, digest-bound current Preprod ledger observations into the
//! actual UTxOs type consumed by pallas_validate::phase1.
//!
//! All entries are owned Conway outputs; this assembly cannot fetch network
//! state or turn local observations into independently authenticated facts.
//! The caller must first validate all input digests, stable-tip identity,
//! transaction refs, and owner credentials. The final ledger verdict remains
//! blocked until full authenticated Conway protocol parameters are available.

use std::borrow::Cow;
use pallas_addresses::{Address, Network};
use pallas_primitives::{
    TransactionInput,
    conway::{PostAlonzoTransactionOutput, TransactionOutput, Value as ConwayValue},
};
use pallas_traverse::{MultiEraInput, MultiEraOutput};
use pallas_validate::utils::UTxOs;
use serde_json::Value;

fn role_snapshot<'a>(request: &'a Value, role: &str) -> Result<&'a Value, String> {
    request.pointer(&format!("/ledgerContext/utxos/{role}"))
        .ok_or_else(|| format!("Missing complete current-ledger {role} observation"))
}

fn to_conway_output(role: &str, input: &TransactionInput, data: &Value)
    -> Result<TransactionOutput<'static>, String>
{
    let reference = data.pointer("/reference")
        .ok_or_else(|| format!("Missing current {role} UTxO output reference"))?;
    let tx_id = reference.pointer("/transaction/id").and_then(Value::as_str)
        .ok_or_else(|| format!("Missing current {role} UTxO transaction hash"))?;
    let index = reference.get("index").and_then(Value::as_u64)
        .ok_or_else(|| format!("Missing current {role} UTxO output index"))?;
    if input.transaction_id.to_string() != tx_id.to_ascii_lowercase() || input.index != index {
        return Err(format!("Decoded {role} transaction reference differs from current UTxO"));
    }

    let address = data.get("address").and_then(Value::as_str)
        .ok_or_else(|| format!("Missing {role} Cardano testnet address"))?;
    let decoded = Address::from_bech32(address)
        .map_err(|_| format!("Current {role} UTxO address is not valid Bech32"))?;
    let address_bytes = match decoded {
        Address::Shelley(shelley) if shelley.network() == Network::Testnet => shelley.to_vec(),
        _ => return Err(format!("Current {role} UTxO is not a Shelley Preprod input"))
    };
    for field in ["datumHash", "datum", "script"] {
        if data.get(field) != Some(&Value::Null) {
            return Err(format!("Current {role} UTxO unexpected {field} or missing explicit null"));
        }
    }
    let value = data.get("value").and_then(Value::as_object)
        .ok_or_else(|| format!("Missing complete {role} UTxO value"))?;
    if value.len() != 1 || !value.contains_key("ada") {
        return Err(format!("Current {role} UTxO unexpectedly carries native assets"));
    }
    let ada = value.get("ada").and_then(Value::as_object)
        .ok_or_else(|| format!("Missing current {role} ADA value"))?;
    if ada.len() != 1 || !ada.contains_key("lovelace") {
        return Err(format!("Current {role} UTxO has unsupported ADA value shape"));
    }
    let amount = ada.get("lovelace").and_then(Value::as_str)
        .ok_or_else(|| format!("Missing current {role} lovelace text"))?
        .parse::<u64>()
        .map_err(|_| format!("Invalid or overflowing {role} lovelace"))?;
    if amount == 0 {
        return Err(format!("Current {role} UTxO must contain positive lovelace"));
    }
    Ok(TransactionOutput::PostAlonzo(
        PostAlonzoTransactionOutput {
            address: address_bytes.into(),
            value: ConwayValue::Coin(amount),
            datum_option: None,
            script_ref: None
        }.into()
    ))
}

/// Construct an *owned* Pallas UTxOs map from the two proven current input
/// references and full unspent output values. No JSON-reported "verified"
/// boolean is allowed to create another input or invent any missing value.
pub fn assemble_conway_initialize_utxos(
    spending: &TransactionInput,
    collateral: &TransactionInput,
    request: &Value
) -> Result<UTxOs<'static>, String> {
    if spending == collateral {
        return Err("Initialize seed and collateral are the same UTxO".into());
    }
    let mut utxos = UTxOs::new();
    for (role, input) in [("seed", spending), ("collateral", collateral)] {
        let output = to_conway_output(role, input, role_snapshot(request, role)?)?;
        let key = MultiEraInput::AlonzoCompatible(Box::new(Cow::Owned(input.clone())));
        let value = MultiEraOutput::Conway(Box::new(Cow::Owned(output)));
        if utxos.insert(key, value).is_some() {
            return Err("Duplicate current-ledger UTxO reference".into());
        }
    }
    if utxos.len() != 2 {
        return Err("Initialize must contain exactly two independently bound current UTxOs".into());
    }
    Ok(utxos)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pallas_addresses::{ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart};
    use pallas_crypto::hash::{Hash, Hasher};
    use serde_json::json;

    fn fixture() -> (TransactionInput, TransactionInput, Value) {
        let owner = Hasher::<224>::hash(b"owner-of-fixture");
        let address = ShelleyAddress::new(
            Network::Testnet, ShelleyPaymentPart::Key(owner), ShelleyDelegationPart::Null
        ).to_bech32().unwrap();
        let seed = TransactionInput { transaction_id: Hash::from([1u8; 32]), index: 0 };
        let collateral = TransactionInput { transaction_id: Hash::from([2u8; 32]), index: 1 };
        let record = |input: &TransactionInput, amount: &str| json!({
            "reference": {"transaction": {"id":input.transaction_id.to_string()}, "index":input.index},
            "address": address,
            "value": {"ada":{"lovelace":amount}},
            "datum":null, "datumHash":null, "script":null
        });
        let request = json!({"ledgerContext":{"utxos":{
            "seed":record(&seed,"20000000"),
            "collateral":record(&collateral,"5000000")
        }}});
        (seed, collateral, request)
    }

    #[test]
    fn returns_two_actual_pallas_conway_utxos() {
        let (seed, collateral, request) = fixture();
        let map = assemble_conway_initialize_utxos(&seed, &collateral, &request).unwrap();
        assert_eq!(map.len(), 2);
        for (input, expected) in [(seed,20_000_000u64),(collateral,5_000_000)] {
            let key = MultiEraInput::AlonzoCompatible(Box::new(Cow::Owned(input)));
            let output = map.get(&key).expect("Pallas map must contain UTxO");
            assert_eq!(output.lovelace_amount(), expected);
        }
    }

    #[test]
    fn missing_snapshot_role_fails_closed() {
        let (seed, collateral, mut request) = fixture();
        request["ledgerContext"]["utxos"].as_object_mut().unwrap().remove("collateral");
        assert!(assemble_conway_initialize_utxos(&seed,&collateral,&request)
            .unwrap_err().contains("Missing complete current-ledger collateral"));
    }

    #[test]
    fn changed_current_ref_is_rejected() {
        let (seed, collateral, mut request) = fixture();
        request["ledgerContext"]["utxos"]["seed"]["reference"]["index"] = json!(42);
        assert!(assemble_conway_initialize_utxos(&seed,&collateral,&request)
            .unwrap_err().contains("reference differs"));
    }

    #[test]
    fn duplicated_spend_and_collateral_fails_closed() {
        let (seed, _, request) = fixture();
        assert!(assemble_conway_initialize_utxos(&seed,&seed,&request)
            .unwrap_err().contains("same UTxO"));
    }

    #[test]
    fn unexpected_native_assets_fail_closed() {
        let (seed, collateral, mut request) = fixture();
        request["ledgerContext"]["utxos"]["seed"]["value"]["policy-id"] = json!({"token":"1"});
        assert!(assemble_conway_initialize_utxos(&seed,&collateral,&request)
            .unwrap_err().contains("native assets"));
    }

    #[test]
    fn missing_explicit_datum_proof_fails_closed() {
        let (seed, collateral, mut request) = fixture();
        request["ledgerContext"]["utxos"]["seed"].as_object_mut().unwrap().remove("datum");
        assert!(assemble_conway_initialize_utxos(&seed,&collateral,&request)
            .unwrap_err().contains("datum"));
    }

    #[test]
    fn overflowing_ada_value_fails_closed() {
        let (seed, collateral, mut request) = fixture();
        request["ledgerContext"]["utxos"]["seed"]["value"]["ada"]["lovelace"] =
            json!("18446744073709551616");
        assert!(assemble_conway_initialize_utxos(&seed,&collateral,&request)
            .unwrap_err().contains("overflowing"));
    }

    #[test]
    fn wrong_address_network_fails_closed() {
        let (seed, collateral, mut request) = fixture();
        let address = ShelleyAddress::new(
            Network::Mainnet,
            ShelleyPaymentPart::Key(Hasher::<224>::hash(b"owner-of-fixture")),
            ShelleyDelegationPart::Null
        ).to_bech32().unwrap();
        request["ledgerContext"]["utxos"]["seed"]["address"] = json!(address);
        assert!(assemble_conway_initialize_utxos(&seed,&collateral,&request)
            .unwrap_err().contains("Shelley Preprod"));
    }
}
