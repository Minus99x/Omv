import { createHash } from 'node:crypto';
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
  if (!TX_HASH.test(txHash ?? '') || !Number.isSafeInteger(outputIndex) || outputIndex < 0 || outputIndex > 0xffff_ffff) fail(`${role} UTxO reference invalid`);
  if (typeof address !== 'string' || !address.startsWith('addr_test1')) fail(`${role} requires a testnet wallet address`);
  if (typeof ada !== 'string' || !LOVELACE.test(ada) || BigInt(ada) < 1n) fail(`${role} lovelace invalid`);
  if (Object.keys(entry.value).length !== 1 || Object.keys(entry.value.ada).length !== 1 ||
      entry.datum !== null || entry.datumHash !== null || entry.script !== null) {
    fail(`${role} is not an ADA-only, datum-free, script-free UTxO`);
  }
  return new api.Utxo(txHash.toLowerCase(), outputIndex, address, new api.Value(BigInt(ada)));
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
  if (evidence?.schema !== 'omegavault.cardano.preprod-initialize-pre-submit-evidence.v2' ||
      evidence.network !== 'preprod' || evidence.action !== 'initialize') fail('Preprod initialize evidence v2 required');
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
  const snapshot = evidence.ledgerInputSnapshot;
  if (snapshot?.source !== 'read-only-ogmios-queryLedgerState/utxo' ||
      !same(snapshot.tip, evidence.currentTip)) fail('current ledger UTxOs not bound to same stable tip');
  const { lowerSlot, upperSlot } = evidence.validity ?? {};
  const slot = simulatedSlot ?? evidence.currentTip?.slot;
  if (!Number.isSafeInteger(lowerSlot) || !Number.isSafeInteger(upperSlot) || lowerSlot >= upperSlot ||
      !Number.isSafeInteger(slot) || slot < lowerSlot || slot >= upperSlot) {
    fail('simulated slot is outside the evidence-bound validity interval');
  }
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
  if (accepted && !TX_HASH.test(result.txHash ?? '')) fail('emulator accepted without valid local transaction hash');
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
