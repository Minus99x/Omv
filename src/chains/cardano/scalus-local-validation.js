import { createHash } from 'node:crypto';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
import { hashCardanoEvidence } from './evidence-binding.js';

const TX_HASH = /^[0-9a-f]{64}$/i;
const CBOR_HEX = /^(?:[0-9a-f]{2})+$/i;
const LOVELACE = /^(?:0|[1-9][0-9]*)$/;

function fail(message) { throw new Error(`Scalus offline initialize gate: ${message}`); }
function digestHex(hex) { return createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex'); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function boundInput(role, snapshot, api) {
  const entry = snapshot?.utxos?.[role];
  const ref = entry?.reference;
  const txHash = ref?.transaction?.id;
  const outputIndex = ref?.index;
  const address = entry?.address;
  const ada = entry?.value?.ada?.lovelace;
  if (!TX_HASH.test(txHash ?? '') || /^0{64}$/.test(txHash) || !Number.isSafeInteger(outputIndex) || outputIndex < 0 || outputIndex > 0xffff_ffff) fail(`${role} UTxO reference invalid`);
  if (typeof address !== 'string' || !address.startsWith('addr_test1')) fail(`${role} requires a testnet wallet address`);
  if (typeof ada !== 'string' || !LOVELACE.test(ada) || BigInt(ada) < 1n) fail(`${role} lovelace invalid`);
  if (Object.keys(entry.value).length !== 1 || Object.keys(entry.value.ada).length !== 1 ||
      entry.datum !== null || entry.datumHash !== null || entry.script !== null) {
    fail(`${role} is not an ADA-only, datum-free, script-free UTxO`);
  }
  return new api.Utxo(txHash.toLowerCase(), outputIndex, address, new api.Value(BigInt(ada)));
}
function verifyCapturedOwnerWitness(transaction, seedAddress) {
  if (transaction.is_valid() !== true) fail('captured initialize transaction validity flag must be true');
  if (transaction.body().network_id()?.kind() !== Cardano.NetworkId.testnet().kind()) {
    fail('captured initialize transaction must target Preprod/testnet network id 0');
  }

  const requiredSigners = transaction.body().required_signers();
  const vkeys = transaction.witness_set().vkeys();
  if (!requiredSigners || requiredSigners.len() !== 1 || !vkeys || vkeys.len() !== 1) {
    fail('captured initialize transaction must contain exactly one required owner signer and one VKey witness');
  }

  const witness = vkeys.get(0);
  const publicKey = witness.vkey().public_key();
  const ownerKeyHash = publicKey.hash().to_hex();
  if (requiredSigners.get(0).to_hex() !== ownerKeyHash) {
    fail('captured initialize VKey witness does not match its required owner signer');
  }
  if (!publicKey.verify(blake2b(transaction.body().to_bytes(), { dkLen: 32 }), witness.signature())) {
    fail('captured initialize owner VKey signature is invalid for its transaction body');
  }

  let address;
  try {
    address = Cardano.Address.from_bech32(seedAddress);
  } catch {
    fail('captured initialize seed must have a valid Preprod payment-key address');
  }
  const paymentCredential = Cardano.BaseAddress.from_address(address)?.payment_cred() ??
    Cardano.EnterpriseAddress.from_address(address)?.payment_cred() ??
    Cardano.PointerAddress.from_address(address)?.payment_cred();
  if (address.network_id() !== 0 || paymentCredential?.to_keyhash()?.to_hex() !== ownerKeyHash) {
    fail('captured initialize seed payment credential must match its owner VKey on Preprod');
  }
}

/**
 * Offline replay of an already signed OmegaVault Preprod initialize candidate.
 * Inputs are supplied from verified pre-submit artifacts; never queries providers,
 * signs, sends a transaction to a network, or promotes the Cardano support gate.
 * Scalus has no network submission access and its ledger is independent of Preprod.
 * The caller must independently run verifyCardanoPreprodInitializePreSubmitEvidence.
 */
export async function runCardanoScalusInitializeTrial({
  signedTransactionCborHex, preSubmitEvidence, simulatedSlot,
  scalusApi = null
}) {
  const evidence = preSubmitEvidence;
  const capturedEvidence = evidence?.schema === 'omegavault.cardano.preprod-initialize-pre-submit-evidence.v3';
  // The repository's synthetic adapter fixture predates the captured-body commitment.
  const syntheticLegacyEvidence = evidence?.schema === 'omegavault.cardano.preprod-initialize-pre-submit-evidence.v2' &&
    evidence.currentProtocolSnapshot == null;
  if ((!capturedEvidence && !syntheticLegacyEvidence) ||
      evidence.network !== 'preprod' || evidence.action !== 'initialize') fail('Preprod initialize evidence v3 required');
  if (syntheticLegacyEvidence && evidence.unsignedTransactionBodyCborHex != null) {
    fail('legacy synthetic evidence cannot carry an unversioned frozen transaction body');
  }
  if (!TX_HASH.test(evidence.preSubmitSha256 ?? '') ||
      hashCardanoEvidence(Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== 'preSubmitSha256'))) !== evidence.preSubmitSha256 ||
      hashCardanoEvidence(evidence.ledgerInputSnapshot) !== evidence.ledgerInputSnapshotSha256) fail('pre-submit or ledger snapshot evidence digest mismatch');
  if (evidence.checks?.preSubmitFreshnessGateComplete !== true ||
      evidence.checks?.walletWitnessEvidenceVerified !== true ||
      evidence.checks?.completePhaseOneValidated !== false ||
      evidence.liveActions?.transactionSubmissionAuthorized !== false ||
      evidence.liveActions?.transactionSubmissionPerformed !== false) fail('verified unsigned/witness pre-submit boundary required; no submission authority accepted');
  if (typeof signedTransactionCborHex !== 'string' || !CBOR_HEX.test(signedTransactionCborHex)) fail('canonical signed CBOR hex required');
  const normalizedHex = signedTransactionCborHex.toLowerCase();
  if (digestHex(normalizedHex) !== evidence.signedTransaction?.sha256) fail('signed transaction bytes differ from bound pre-submit digest');
  let signedTransaction;
  try {
    signedTransaction = Cardano.Transaction.from_hex(normalizedHex);
  } catch {
    fail('signed transaction CBOR could not be decoded');
  }
  if (signedTransaction.to_hex().toLowerCase() !== normalizedHex) fail('signed transaction CBOR is not canonical');
  if (capturedEvidence || evidence.unsignedTransactionBodyCborHex != null) {
    if (typeof evidence.unsignedTransactionBodyCborHex !== 'string' ||
        !CBOR_HEX.test(evidence.unsignedTransactionBodyCborHex)) {
      fail('frozen pre-submit transaction body is missing or malformed');
    }
    const frozenBodyHex = evidence.unsignedTransactionBodyCborHex.toLowerCase();
    let frozenBody;
    try {
      frozenBody = Cardano.TransactionBody.from_hex(frozenBodyHex);
    } catch {
      fail('frozen pre-submit transaction body could not be decoded');
    }
    if (frozenBody.to_hex().toLowerCase() !== frozenBodyHex) fail('frozen pre-submit transaction body is not canonical');
    if (signedTransaction.body().to_hex().toLowerCase() !== frozenBodyHex) {
      fail('signed transaction body differs from frozen pre-submit transaction body');
    }
  }
  if (capturedEvidence) {
    const seedAddress = evidence.ledgerInputSnapshot?.utxos?.seed?.address;
    verifyCapturedOwnerWitness(signedTransaction, seedAddress);
  }
  const snapshot = evidence.ledgerInputSnapshot;
  if (snapshot?.source !== 'read-only-ogmios-queryLedgerState/utxo' ||
      !same(snapshot.tip, evidence.currentTip)) fail('current ledger UTxOs not bound to same stable tip');
  const tip = evidence.currentTip;
  if (!tip || typeof tip !== 'object' || !TX_HASH.test(tip.hash ?? '') || /^0{64}$/.test(tip.hash) ||
      !Number.isSafeInteger(tip.slot) || tip.slot < 0) fail('evidence-bound ledger tip hash or slot invalid');
  const { lowerSlot, upperSlot } = evidence.validity ?? {};
  const slot = simulatedSlot ?? evidence.currentTip?.slot;
  if (!Number.isSafeInteger(lowerSlot) || !Number.isSafeInteger(upperSlot) || lowerSlot >= upperSlot ||
      !Number.isSafeInteger(slot) || slot < lowerSlot || slot >= upperSlot) {
    fail('simulated slot is outside the evidence-bound validity interval');
  }
  // UTxOs and protocol context were observed at the bound read-only tip.
  // Replaying that snapshot at an earlier slot would fabricate historical
  // context and could falsely present an already-spent input as available.
  if (slot < tip.slot) fail('simulated slot cannot precede the evidence-bound ledger tip');
  if (!Number.isSafeInteger(evidence.signedTransaction?.bytes) ||
      Buffer.byteLength(normalizedHex, 'hex') !== evidence.signedTransaction.bytes) fail('signed byte-length mismatch');
  const api = scalusApi ?? await import('scalus');
  if (typeof api.CardanoInfo?.preprod !== 'function' || typeof api.Emulator?.create !== 'function' ||
      typeof api.Utxo !== 'function' || typeof api.Value !== 'function') fail('Scalus v1.3+ API not available');
  const seed = boundInput('seed', snapshot, api);
  const collateral = boundInput('collateral', snapshot, api);
  if (snapshot.utxos.seed.reference.transaction.id.toLowerCase() === snapshot.utxos.collateral.reference.transaction.id.toLowerCase() &&
      snapshot.utxos.seed.reference.index === snapshot.utxos.collateral.reference.index) fail('seed and collateral must be distinct');
  const emulator = api.Emulator.create(api.CardanoInfo.preprod(), { utxos: [seed, collateral], slot });
  // This is the emulator's LOCAL ledger, not a public Preprod transaction submission.
  const result = emulator.submitTx(Buffer.from(normalizedHex, 'hex'));
  if (typeof result?.isSuccess !== 'boolean') fail('emulator did not return a recognized validation result');
  const accepted = result.isSuccess === true;
  if (accepted && (!TX_HASH.test(result.txHash ?? '') || /^0{64}$/.test(result.txHash))) fail('emulator accepted without valid nonzero local transaction hash');
  return Object.freeze({
    schema: 'omegavault.cardano.scalus-offline-initialize-trial.v1',
    network: 'local-emulated-preprod-rules',
    source: 'scalus-emulator',
    signedTransactionSha256: digestHex(normalizedHex),
    preSubmitSha256: evidence.preSubmitSha256 ?? null,
    simulatedSlot: slot,
    acceptedByEmulator: accepted,
    localTransactionHash: accepted ? result.txHash.toLowerCase() : null,
    rejectedByRule: accepted ? null : String(result.errorRule ?? 'unspecified'),
    rejection: accepted ? null : String(result.error ?? 'emulator rejection'),
    authority: Object.freeze({
      completeCurrentPreprodPhaseOneValidated: false,
      publicPreprodTransactionSubmitted: false,
      transactionSubmissionAuthorized: false,
      publicNetworkRecoveryProven: false,
      supportClaimAuthorized: false
    })
  });
}
