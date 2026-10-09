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
    let _conway: pallas_primitives::conway::Tx =
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
