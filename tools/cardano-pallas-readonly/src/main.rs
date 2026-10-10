//! Offline, read-only Pallas transaction-decoding boundary.
//!
//! NOT an independent Cardano phase-one validation verdict. The next
//! implementation must build a genuine Pallas Environment (complete
//! Conway protocol params, current UTxOs, CertState and ledger tip) and
//! invoke pallas_validate::phase1::validate_tx. Until then this executable
//! never returns a passing phase-one verdict or submission authorization.

use std::io::{self, Read};
use sha2::{Digest, Sha256};
use serde_json::{json, Value};
use pallas_crypto::hash::Hasher;
use pallas_primitives::{NetworkId, conway::Tx};

const INPUT_SCHEMA: &str = "omegavault.cardano.preprod-independent-phase-one-input.v1";
const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_TRANSACTION_BYTES: usize = 32768;

fn required_string<'a>(value: &'a Value, path: &[&str]) -> Result<&'a str, String> {
    let mut cursor = value;
    for component in path {
        cursor = cursor
            .get(*component)
            .ok_or_else(|| format!("Missing {}", path.join(".")))?;
    }
    cursor
        .as_str()
        .filter(|item| !item.is_empty())
        .ok_or_else(|| format!("Invalid {}", path.join(".")))
}

// These checks inspect the *decoded, unchanged* transaction rather than
// trusting assertions copied from an earlier JavaScript preflight. They are
// necessary prerequisites, NOT Cardano's complete Conway ledger rules.
fn bind_input_ref(input: &pallas_primitives::TransactionInput, expected: &Value, role: &str) -> Result<(), String> {
    let expected_hash = expected.pointer("/reference/transaction/id")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing {role} ledger input hash"))?;
    let expected_index = expected.pointer("/reference/index")
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("Missing {role} ledger input index"))?;
    if input.transaction_id.to_string() != expected_hash.to_ascii_lowercase() || input.index != expected_index {
        return Err(format!("Decoded transaction {role} input does not match current ledger UTxO"));
    }
    Ok(())
}

fn check_signed_transaction_body(tx: &Tx<'_>, request: &Value, current_slot: u64) -> Result<String, String> {
    if !tx.success {
        return Err("Signed Conway transaction validity flag must be true".into());
    }
    let body = &tx.transaction_body;
    if body.network_id != Some(NetworkId::Testnet) {
        return Err("Decoded transaction does not explicitly bind Cardano testnet network id".into());
    }
    let body_hash = Hasher::<256>::hash(tx.transaction_body.raw_cbor()).to_string();
    let requested_body_hash = required_string(request, &["signedTransaction", "bodyHash"])?;
    if body_hash != requested_body_hash.to_ascii_lowercase() {
        return Err("Pallas decoded transaction body hash differs from frozen signed body".into());
    }
    let validity = request.pointer("/ledgerContext/validity")
        .ok_or_else(|| "Missing ledger transaction validity context".to_owned())?;
    let lower = validity.get("lowerSlot").and_then(Value::as_u64)
        .ok_or_else(|| "Missing lower validity slot".to_owned())?;
    let upper = validity.get("upperSlot").and_then(Value::as_u64)
        .ok_or_else(|| "Missing upper validity slot".to_owned())?;
    if lower > upper || current_slot < lower || current_slot > upper
        || body.validity_interval_start != Some(lower) || body.ttl != Some(upper)
    {
        return Err("Current ledger slot and decoded transaction validity interval disagree".into());
    }
    if body.inputs.len() != 1 || body.collateral.as_ref().map(|c| c.len()) != Some(1) {
        return Err("Initialize must use exactly one spending input and one collateral input".into());
    }
    let seed = body.inputs.iter().next()
        .ok_or_else(|| "Missing signed seed input".to_owned())?;
    let collateral = body.collateral.as_ref().and_then(|c| c.iter().next())
        .ok_or_else(|| "Missing signed collateral input".to_owned())?;
    bind_input_ref(seed, request.pointer("/ledgerContext/utxos/seed")
        .ok_or_else(|| "Missing complete seed UTxO".to_owned())?, "seed")?;
    bind_input_ref(collateral, request.pointer("/ledgerContext/utxos/collateral")
        .ok_or_else(|| "Missing complete collateral UTxO".to_owned())?, "collateral")?;
    if seed == collateral {
        return Err("Seed and collateral cannot refer to the same UTxO".into());
    }
    if body.required_signers.as_ref().map(|v| v.len()) != Some(1)
        || tx.transaction_witness_set.vkeywitness.as_ref().map(|v| v.len()) != Some(1)
    {
        return Err("Initialize must bind one owner required signer and one key witness".into());
    }
    if body.outputs.len() != 2 || body.collateral_return.is_none() || body.total_collateral.is_none() {
        return Err("Initialize is missing state/change or collateral return output".into());
    }
    if body.reference_inputs.is_some() || body.certificates.is_some() || body.withdrawals.is_some()
        || body.voting_procedures.is_some() || body.proposal_procedures.is_some()
        || body.donation.is_some() || body.treasury_value.is_some()
    {
        return Err("Initialize carries unexpected reference, governance or stake operations".into());
    }
    let snapshot = request.pointer("/ledgerContext/protocolSnapshot/parameters")
        .ok_or_else(|| "Missing current protocol parameter snapshot".to_owned())?;
    let max_tx_size = snapshot.get("maxTxSize").and_then(Value::as_u64)
        .ok_or_else(|| "Missing max transaction size".to_owned())?;
    let minimum_a = snapshot.get("minFeeA").and_then(Value::as_str)
        .ok_or_else(|| "Missing current minFeeA".to_owned())?.parse::<u64>()
        .map_err(|_| "Invalid minFeeA".to_owned())?;
    let minimum_b = snapshot.get("minFeeB").and_then(Value::as_str)
        .ok_or_else(|| "Missing current minFeeB".to_owned())?.parse::<u64>()
        .map_err(|_| "Invalid minFeeB".to_owned())?;
    let signed_bytes = required_string(request, &["signedTransaction", "cborHex"])?.len() / 2;
    if signed_bytes as u64 > max_tx_size {
        return Err("Pallas decoded transaction exceeds current maxTxSize".into());
    }
    let linear_floor = (signed_bytes as u64)
        .checked_mul(minimum_a)
        .and_then(|fee| fee.checked_add(minimum_b))
        .ok_or_else(|| "Linear fee calculation overflow".to_owned())?;
    if body.fee < linear_floor {
        return Err("Signed fee is below independently recomputed linear minimum".into());
    }
    Ok(body_hash)
}

fn inspect(request_json: &str) -> Result<Value, String> {
    let request: Value = serde_json::from_str(request_json)
        .map_err(|_| "Request is not valid JSON".to_owned())?;
    if required_string(&request, &["schema"])? != INPUT_SCHEMA
        || required_string(&request, &["network"])? != "preprod"
        || required_string(&request, &["action"])? != "initialize"
    {
        return Err("Expected Cardano Preprod initialize phase-one input schema".to_owned());
    }
    if request.get("completePhaseOneValidated") != Some(&Value::Bool(false))
        || request.get("transactionSubmissionAuthorized") != Some(&Value::Bool(false))
        || request.get("transactionSubmissionPerformed") != Some(&Value::Bool(false))
    {
        return Err("Request claims unauthorized validation or submission authority".to_owned());
    }
    let request_sha = required_string(&request, &["requestSha256"])?;
    let tx_sha = required_string(&request, &["signedTransaction", "sha256"])?;
    let tx_hex = required_string(&request, &["signedTransaction", "cborHex"])?;
    if tx_sha.len() != 64 || !tx_sha.bytes().all(|b| b.is_ascii_hexdigit())
        || request_sha.len() != 64 || !request_sha.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Malformed transaction or request digest".to_owned());
    }
    if tx_hex.len() % 2 != 0 || tx_hex.len() > MAX_TRANSACTION_BYTES * 2 {
        return Err("Malformed or oversized signed transaction hex".to_owned());
    }
    let tx_bytes = hex::decode(tx_hex)
        .map_err(|_| "Signed transaction contains invalid hex".to_owned())?;
    if tx_bytes.is_empty() {
        return Err("Signed transaction cannot be empty".to_owned());
    }
    let computed = Sha256::digest(&tx_bytes);
    if hex::encode(computed) != tx_sha.to_ascii_lowercase() {
        return Err("Signed transaction SHA-256 does not match exact bytes".to_owned());
    }

    // Decode the *actual* signed transaction bytes with a second, Rust-native
    // CBOR implementation, not the Node/Cardano serialization library.
    // The decode is structural only and cannot certify ledger validity.
    let conway: pallas_primitives::conway::Tx =
        pallas_codec::minicbor::decode(&tx_bytes)
            .map_err(|_| "Pallas rejected Conway transaction CBOR".to_owned())?;

    let tip_hash = required_string(&request, &["ledgerContext", "tip", "hash"])?;
    let tip_slot = request.pointer("/ledgerContext/tip/slot")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Missing current tip slot".to_owned())?;
    if tip_hash.len() != 64 || !tip_hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid current tip hash".to_owned());
    }
    for role in ["seed", "collateral"] {
        let value_path = format!("/ledgerContext/utxos/{role}/value/ada/lovelace");
        let lovelace = request.pointer(&value_path)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Missing full {role} UTxO amount"))?;
        if lovelace.is_empty() || !lovelace.bytes().all(|c| c.is_ascii_digit()) {
            return Err(format!("Invalid {role} lovelace amount"));
        }
    }

    if request.pointer("/signedTransaction/bytes").and_then(Value::as_u64) != Some(tx_bytes.len() as u64) {
        return Err("Signed transaction declared byte length differs from actual bytes".into());
    }
    let verified_body_hash = check_signed_transaction_body(&conway, &request, tip_slot)?;

    // Deliberately NO success value, until we have independently reconstructed
    // full Conway ledger parameters and CertState from a current trusted source,
    // and actually run pallas_validate::phase1::validate_tx on these exact bytes.
    Ok(json!({
        "schema": "omegavault.cardano.pallas-readonly-inspection.v1",
        "ok": true,
        "network": "preprod",
        "requestSha256": request_sha.to_ascii_lowercase(),
        "signedTransactionSha256": tx_sha.to_ascii_lowercase(),
        "tipHash": tip_hash.to_ascii_lowercase(),
        "tipSlot": tip_slot,
        "pallasConwayTransactionDecodePassed": true,
        "pallasDecodedBodyHash": verified_body_hash,
        "pallasExactSignedBodyInputAndValidityChecksPassed": true,
        "completePhaseOneValidated": false,
        "transactionSubmissionAuthorized": false,
        "transactionSubmissionPerformed": false,
        "supportClaimAuthorized": false,
        "hardStop": "STRUCTURAL DECODE ONLY. Pallas phase-one validation has not run. Do not sign or submit."
    }))
}

fn main() {
    let mut input = String::new();
    let result = match io::stdin().take((MAX_REQUEST_BYTES + 1) as u64).read_to_string(&mut input) {
        Ok(length) if length <= MAX_REQUEST_BYTES => inspect(&input),
        _ => Err("Invalid or oversized input".to_owned())
    };
    match result {
        Ok(observation) => {
            println!("{}", observation);
            // Even a valid structural decode must not be used as an authorization gate.
            // Exit code 0 only confirms the non-authorizing inspection.
        }
        Err(message) => {
            eprintln!("{}", json!({
                "ok": false,
                "error": message,
                "completePhaseOneValidated": false,
                "transactionSubmissionAuthorized": false,
                "transactionSubmissionPerformed": false
            }));
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_untrusted_request() {
        let error = inspect(r#"{"schema":"unknown"}"#).unwrap_err();
        assert!(error.contains("Expected") || error.contains("Missing"));
    }
    #[test]
    fn refuses_promotion_without_proof() {
        let request = json!({
          "schema": INPUT_SCHEMA, "network": "preprod", "action": "initialize",
          "completePhaseOneValidated": true,
          "transactionSubmissionAuthorized": false,
          "transactionSubmissionPerformed": false
        });
        assert!(inspect(&request.to_string()).unwrap_err().contains("unauthorized validation"));
    }
    #[test]
    fn rejects_malformed_transaction_before_pallas_decode() {
        let request = json!({
          "schema": INPUT_SCHEMA, "network": "preprod", "action": "initialize",
          "completePhaseOneValidated": false,
          "transactionSubmissionAuthorized": false,
          "transactionSubmissionPerformed": false,
          "requestSha256": "a".repeat(64),
          "signedTransaction": { "sha256": "b".repeat(64), "cborHex": "zz" }
        });
        assert!(inspect(&request.to_string()).unwrap_err().contains("invalid hex"));
    }
    #[test]
    fn refuses_to_treat_fake_signed_bytes_as_a_phase_one_pass() {
        let signed = b"not a conway transaction";
        let request = json!({
          "schema": INPUT_SCHEMA, "network": "preprod", "action": "initialize",
          "completePhaseOneValidated": false,
          "transactionSubmissionAuthorized": false,
          "transactionSubmissionPerformed": false,
          "requestSha256": "a".repeat(64),
          "signedTransaction": { "sha256": hex::encode(Sha256::digest(signed)), "cborHex": hex::encode(signed) }
        });
        assert!(inspect(&request.to_string()).unwrap_err().contains("Pallas rejected"));
    }
}
