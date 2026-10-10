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
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::{PublicKey, Signature};
use pallas_primitives::{AddrKeyhash, alonzo::VKeyWitness};
use pallas_addresses::{Address, Network, ShelleyPaymentPart};
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

// Cryptographic owner checks use Pallas independently from the JS/CIP-30
// witness-verification implementation. No private key is ever needed here.
fn verify_owner_vkey(
    body_hash: &Hash<32>,
    witness: &VKeyWitness,
    required_signer: &AddrKeyhash,
) -> Result<(), String> {
    let public_key = PublicKey::try_from(witness.vkey.as_slice())
        .map_err(|_| "Malformed owner public verification key".to_owned())?;
    let signature = Signature::try_from(witness.signature.as_slice())
        .map_err(|_| "Malformed owner Ed25519 signature".to_owned())?;
    let actual_signer = Hasher::<224>::hash(witness.vkey.as_ref());
    if &actual_signer != required_signer {
        return Err("Owner witness key hash differs from required signer".into());
    }
    if !public_key.verify(body_hash.as_ref(), &signature) {
        return Err("Pallas independent Ed25519 owner signature verification failed".into());
    }
    Ok(())
}

// Both initialize inputs must remain spendable by the exact same owner
// payment verification key. This is independent of the earlier JS preflight.
// Shelley stake credentials may differ; payment credentials may not.
fn verify_owner_utxo_address(address: &str, owner_hash: &AddrKeyhash, role: &str) -> Result<(), String> {
    let decoded = Address::from_bech32(address)
        .map_err(|_| format!("{role} is not a valid Cardano bech32 address"))?;
    match decoded {
        Address::Shelley(shelley) if shelley.network() == Network::Testnet => {
            match shelley.payment() {
                ShelleyPaymentPart::Key(observed) if observed == owner_hash => Ok(()),
                _ => Err(format!("{role} payment credential does not belong to required owner")),
            }
        }
        _ => Err(format!("{role} is not an owner-controlled Shelley testnet address")),
    }
}

// Pallas-native ADA conservation for the intentionally constrained OmegaVault
// initialize profile. No minting, withdrawals, certs, or governance movements
// are permitted. Collateral is accounted for separately on script failure.
fn conway_value_ada(value: &pallas_primitives::conway::Value) -> Result<u64, String> {
    match value {
        pallas_primitives::conway::Value::Coin(amount) => Ok(*amount),
        pallas_primitives::conway::Value::Multiasset(amount, assets) if assets.is_empty() => Ok(*amount),
        _ => Err("Unexpected native assets in initialize output".to_owned()),
    }
}

fn output_ada(output: &pallas_primitives::conway::TransactionOutput<'_>) -> Result<u64, String> {
    match output {
        pallas_primitives::conway::TransactionOutput::PostAlonzo(x) => conway_value_ada(&x.value),
        pallas_primitives::conway::TransactionOutput::Legacy(x) => match &x.amount {
            pallas_primitives::alonzo::Value::Coin(amount) => Ok(*amount),
            pallas_primitives::alonzo::Value::Multiasset(amount, assets) if assets.is_empty() => Ok(*amount),
            _ => Err("Unexpected native assets in legacy initialize output".to_owned()),
        }
    }
}

fn precise_lovelace(request: &Value, role: &str) -> Result<u64, String> {
    let path = format!("/ledgerContext/utxos/{role}/value/ada/lovelace");
    request.pointer(&path)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing {role} lovelace from full ledger snapshot"))?
        .parse::<u64>()
        .map_err(|_| format!("Invalid or overflowing {role} lovelace"))
}

fn checked_ada_conservation(spend: u64, outputs: &[u64], fee: u64) -> Result<(), String> {
    let output_sum = outputs.iter().try_fold(0u64, |sum, amount| sum.checked_add(*amount))
        .ok_or_else(|| "Signed output ADA sum overflow".to_owned())?;
    if output_sum.checked_add(fee) != Some(spend) {
        return Err("Pallas independently detected initialize ADA preservation-of-value mismatch".into());
    }
    Ok(())
}

fn checked_collateral_conservation(input: u64, returned: u64, declared: u64, fee: u64, percent: u64) -> Result<(), String> {
    let paid = input.checked_sub(returned)
        .ok_or_else(|| "Collateral return exceeds current collateral input".to_owned())?;
    let required = fee.checked_mul(percent)
        .and_then(|value| value.checked_add(99))
        .map(|value| value / 100)
        .ok_or_else(|| "Collateral minimum calculation overflow".to_owned())?;
    if paid != declared || paid < required {
        return Err("Pallas independently detected collateral amount/percentage mismatch".into());
    }
    Ok(())
}

fn verify_ada_only_initialize_values(tx: &Tx<'_>, request: &Value) -> Result<(), String> {
    let body = &tx.transaction_body;
    if body.mint.is_some() || body.withdrawals.is_some() || body.certificates.is_some()
        || body.donation.is_some() || body.treasury_value.is_some() {
        return Err("Initialize must not mint, withdraw, donate or carry certificates".into());
    }
    let spend = precise_lovelace(request, "seed")?;
    let collateral = precise_lovelace(request, "collateral")?;
    let output_amounts = body.outputs.iter().map(output_ada).collect::<Result<Vec<_>,_>>()?;
    checked_ada_conservation(spend, &output_amounts, body.fee)?;
    let returned = output_ada(body.collateral_return.as_ref()
        .ok_or_else(|| "Initialize missing collateral return output".to_owned())?)?;
    let declared = body.total_collateral
        .ok_or_else(|| "Initialize missing declared total collateral".to_owned())?;
    let collateral_pct = request.pointer("/ledgerContext/protocolSnapshot/parameters/collateralPercentage")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing live collateralPercentage".to_owned())?
        .parse::<u64>()
        .map_err(|_| "Invalid live collateralPercentage".to_owned())?;
    if collateral_pct < 100 || collateral_pct > 1000 {
        return Err("Live collateralPercentage outside supported bounds".into());
    }
    checked_collateral_conservation(collateral, returned, declared, body.fee, collateral_pct)
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
    let signer = body.required_signers.as_ref()
        .and_then(|signers| signers.iter().next())
        .ok_or_else(|| "Owner required signer missing from decoded transaction".to_owned())?;
    let owner_witness = tx.transaction_witness_set.vkeywitness.as_ref()
        .and_then(|witnesses| witnesses.iter().next())
        .ok_or_else(|| "Owner key witness missing from decoded transaction".to_owned())?;
    let calculated_body_hash = Hasher::<256>::hash(tx.transaction_body.raw_cbor());
    verify_owner_vkey(&calculated_body_hash, owner_witness, signer)?;
    for role in ["seed", "collateral"] {
        let path = format!("/ledgerContext/utxos/{role}/address");
        let address = request.pointer(&path)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Missing {role} Cardano UTxO address"))?;
        verify_owner_utxo_address(address, signer, role)?;
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

// JavaScript hashCardanoEvidence sorts each object key before JSON SHA-256.
// serde_json's default Map is also BTreeMap-ordered; this routine verifies the
// cross-language request commitment, not merely the presence of a 64-char hash.
// Objects contain JSON only (no JS BigInt runtime values).
fn verify_sha256_json(value: &Value, expected: &str, label: &str) -> Result<(), String> {
    let encoded = serde_json::to_vec(value)
        .map_err(|_| format!("Unable to canonicalize {label} JSON"))?;
    let digest = hex::encode(Sha256::digest(encoded));
    if digest != expected.to_ascii_lowercase() {
        return Err(format!("{label} JSON commitment digest mismatch"));
    }
    Ok(())
}

fn verify_request_sha256(request: &Value, expected: &str) -> Result<(), String> {
    let source = request.as_object()
        .ok_or_else(|| "Independent phase-one input must be a JSON object".to_owned())?;
    let mut core = source.clone();
    core.remove("requestSha256");
    verify_sha256_json(&Value::Object(core), expected, "Independent phase-one request")
}

fn verify_snapshot_sha256(request: &Value) -> Result<(), String> {
    let snapshot = request.pointer("/ledgerContext/protocolSnapshot")
        .ok_or_else(|| "Missing current ledger protocol snapshot".to_owned())?;
    let expected = required_string(request, &["sources", "currentProtocolSnapshotSha256"])?;
    verify_sha256_json(snapshot, expected, "Current protocol snapshot")?;
    let source_tip = snapshot.pointer("/tip/blockHash").and_then(Value::as_str)
        .ok_or_else(|| "Protocol snapshot lacks bound tip hash".to_owned())?;
    let source_slot = snapshot.pointer("/tip/slot").and_then(Value::as_u64)
        .ok_or_else(|| "Protocol snapshot lacks bound tip slot".to_owned())?;
    let current_tip = required_string(request, &["ledgerContext", "tip", "hash"])?;
    let current_slot = request.pointer("/ledgerContext/tip/slot").and_then(Value::as_u64)
        .ok_or_else(|| "Missing current ledger slot".to_owned())?;
    if source_tip.to_ascii_lowercase() != current_tip.to_ascii_lowercase() || source_slot != current_slot {
        return Err("Protocol snapshot and current tip identity differ".to_owned());
    }
    Ok(())
}

fn verify_ledger_snapshot_sha256(request: &Value) -> Result<(), String> {
    let current_tip = request.pointer("/ledgerContext/tip")
        .ok_or_else(|| "Missing current ledger tip".to_owned())?;
    let utxos = request.pointer("/ledgerContext/utxos")
        .ok_or_else(|| "Missing full current UTxO observations".to_owned())?;
    let full_snapshot = json!({
        "source": "read-only-ogmios-queryLedgerState/utxo",
        "tip": current_tip,
        "utxos": utxos
    });
    let expected = required_string(request, &["sources", "ledgerInputSnapshotSha256"])?;
    verify_sha256_json(&full_snapshot, expected, "Full ledger input snapshot")
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

    verify_request_sha256(&request, request_sha)?;
    verify_snapshot_sha256(&request)?;
    verify_ledger_snapshot_sha256(&request)?;

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
    verify_ada_only_initialize_values(&conway, &request)?;

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
        "pallasOwnerWitnessSignatureAndRequiredSignerVerified": true,
        "pallasInputPaymentCredentialsBoundToOwner": true,
        "pallasInitializeAdaAndCollateralConservationChecked": true,
        "requestProtocolAndLedgerSnapshotDigestsVerified": true,
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
    #[test]
    fn independently_checks_one_valid_owner_signature_without_wallet_access() {
        // Deterministic test-only key. Production code NEVER creates or holds
        // user signing keys and can only verify publicly supplied witnesses.
        use pallas_crypto::key::ed25519::SecretKey;
        let signing_key = SecretKey::from([9u8; 32]);
        let pk = signing_key.public_key();
        let body = Hasher::<256>::hash(b"preprod-test-body");
        let witness = VKeyWitness {
            vkey: pk.as_ref().to_vec().into(),
            signature: signing_key.sign(body.as_ref()).as_ref().to_vec().into(),
        };
        let signer = Hasher::<224>::hash(pk.as_ref());
        assert!(verify_owner_vkey(&body, &witness, &signer).is_ok());
    }
    #[test]
    fn rejects_owner_witness_with_wrong_required_signer() {
        use pallas_crypto::key::ed25519::SecretKey;
        let signing_key = SecretKey::from([9u8; 32]);
        let pk = signing_key.public_key();
        let body = Hasher::<256>::hash(b"preprod-test-body");
        let witness = VKeyWitness {
            vkey: pk.as_ref().to_vec().into(),
            signature: signing_key.sign(body.as_ref()).as_ref().to_vec().into(),
        };
        let wrong_signer = Hasher::<224>::hash(b"different-owner");
        assert!(verify_owner_vkey(&body, &witness, &wrong_signer)
            .unwrap_err().contains("required signer"));
    }
    #[test]
    fn rejects_owner_signature_for_different_body() {
        use pallas_crypto::key::ed25519::SecretKey;
        let signing_key = SecretKey::from([9u8; 32]);
        let pk = signing_key.public_key();
        let original_body = Hasher::<256>::hash(b"first-body");
        let changed_body = Hasher::<256>::hash(b"second-body");
        let witness = VKeyWitness {
            vkey: pk.as_ref().to_vec().into(),
            signature: signing_key.sign(original_body.as_ref()).as_ref().to_vec().into(),
        };
        let signer = Hasher::<224>::hash(pk.as_ref());
        assert!(verify_owner_vkey(&changed_body, &witness, &signer)
            .unwrap_err().contains("signature verification failed"));
    }
    #[test]
    fn rejects_malformed_owner_public_key() {
        let body = Hasher::<256>::hash(b"test-body");
        let witness = VKeyWitness {
            vkey: vec![0u8; 31].into(),
            signature: vec![0u8; 64].into(),
        };
        let signer = Hasher::<224>::hash(b"owner");
        assert!(verify_owner_vkey(&body, &witness, &signer)
            .unwrap_err().contains("Malformed owner public"));
    }

    #[test]
    fn rejects_changed_cross_language_request_digest() {
        let mut request = json!({
            "schema": INPUT_SCHEMA, "network": "preprod", "action": "initialize",
            "completePhaseOneValidated": false,
            "transactionSubmissionAuthorized": false,
            "transactionSubmissionPerformed": false,
            "requestSha256": "b".repeat(64),
            "signedTransaction": { "sha256": "a".repeat(64), "cborHex": "00" }
        });
        // Request digest must be the hash of the *other* fields, not an
        // arbitrary hash of a transaction or a caller's assertion.
        assert!(verify_request_sha256(&request, request["requestSha256"].as_str().unwrap())
            .unwrap_err().contains("request JSON commitment digest mismatch"));
        let core = request.as_object_mut().unwrap();
        core.remove("requestSha256");
        let digest = hex::encode(Sha256::digest(serde_json::to_vec(&request).unwrap()));
        request["requestSha256"] = Value::String(digest);
        assert!(verify_request_sha256(&request, request["requestSha256"].as_str().unwrap()).is_ok());
    }
    #[test]
    fn rejects_current_protocol_snapshot_digest_drift() {
        let request = json!({
            "ledgerContext": {
                "protocolSnapshot": {"tip": {"blockHash":"ab", "slot":5}},
                "tip": {"hash": "ab", "slot": 5}
            },
            "sources": {"currentProtocolSnapshotSha256": "f".repeat(64)}
        });
        assert!(verify_snapshot_sha256(&request).unwrap_err().contains("commitment digest mismatch"));
    }
    #[test]
    fn rejects_mutated_ledger_utxo_snapshot() {
        let request = json!({
            "ledgerContext": {
                "tip": {"hash": "ab", "slot": 5},
                "utxos": {"seed": {"value":{"ada":{"lovelace":"999"}}}, "collateral":{}}
            },
            "sources": {"ledgerInputSnapshotSha256": "f".repeat(64)}
        });
        assert!(verify_ledger_snapshot_sha256(&request).unwrap_err().contains("commitment digest mismatch"));
    }

    #[test]
    fn accepts_shelley_preprod_utxo_controlled_by_required_owner() {
        use pallas_addresses::{ShelleyAddress, ShelleyDelegationPart};
        let signer = Hasher::<224>::hash(b"same-owner-payment-key");
        let address = ShelleyAddress::new(
            Network::Testnet,
            ShelleyPaymentPart::Key(signer),
            ShelleyDelegationPart::Null,
        ).to_bech32().unwrap();
        assert!(verify_owner_utxo_address(&address, &signer, "seed").is_ok());
        let wrong = Hasher::<224>::hash(b"different-payment-key");
        assert!(verify_owner_utxo_address(&address, &wrong, "seed")
            .unwrap_err().contains("does not belong"));
    }
    #[test]
    fn rejects_mainnet_address_as_preprod_owner_utxo() {
        use pallas_addresses::{ShelleyAddress, ShelleyDelegationPart};
        let signer = Hasher::<224>::hash(b"same-owner-payment-key");
        let address = ShelleyAddress::new(
            Network::Mainnet,
            ShelleyPaymentPart::Key(signer),
            ShelleyDelegationPart::Null,
        ).to_bech32().unwrap();
        assert!(verify_owner_utxo_address(&address, &signer, "seed")
            .unwrap_err().contains("Shelley testnet"));
    }
    #[test]
    fn rejects_malformed_owner_seed_address() {
        let signer = Hasher::<224>::hash(b"valid-signer");
        let error = verify_owner_utxo_address("addr_test1invalid", &signer, "seed").unwrap_err();
        assert!(error.contains("bech32 address"));
    }
    #[test]
    fn rejects_non_shelley_owner_address() {
        let signer = Hasher::<224>::hash(b"valid-signer");
        let error = verify_owner_utxo_address("addr1", &signer, "seed").unwrap_err();
        assert!(error.contains("bech32 address"));
    }

    #[test]
    fn accepts_precise_ada_conservation() {
        assert!(checked_ada_conservation(20_000_000, &[13_000_000, 6_800_000], 200_000).is_ok());
    }
    #[test]
    fn rejects_inflated_initialize_output_values() {
        assert!(checked_ada_conservation(20_000_000, &[13_000_001, 6_800_000], 200_000)
            .unwrap_err().contains("preservation-of-value"));
    }
    #[test]
    fn rejects_arithmetic_overflow_in_ada_outputs() {
        assert!(checked_ada_conservation(u64::MAX, &[u64::MAX, 1], 0)
            .unwrap_err().contains("overflow"));
    }
    #[test]
    fn checks_exact_collateral_return_and_required_amount() {
        assert!(checked_collateral_conservation(5_000_000, 4_700_000, 300_000, 200_000, 150).is_ok());
        assert!(checked_collateral_conservation(5_000_000, 4_700_001, 300_000, 200_000, 150).is_err());
        assert!(checked_collateral_conservation(5_000_000, 4_800_000, 200_000, 200_000, 150).is_err());
    }
    #[test]
    fn rejects_collateral_return_exceeding_ledger_input() {
        assert!(checked_collateral_conservation(2, 3, 0, 0, 150).is_err());
    }
    #[test]
    fn refuses_non_ada_outputs_even_with_lovelace() {
        use std::collections::BTreeMap;
        use pallas_primitives::conway::Value as V;
        let mut assets = BTreeMap::new();
        assets.insert(
            pallas_crypto::hash::Hash::<28>::from([7u8; 28]),
            BTreeMap::new()
        );
        assert!(conway_value_ada(&V::Coin(10)).is_ok());
        assert!(conway_value_ada(&V::Multiasset(10, assets)).is_err());
    }

}
