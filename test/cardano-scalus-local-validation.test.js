import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { runCardanoScalusInitializeTrial } from '../src/chains/cardano/scalus-local-validation.js';

const hex = '84a0a0f5';
const sha = createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
const address = 'addr_test1' + 's'.repeat(30);
const ref = (id, index) => ({ transaction: { id: id.repeat(64) }, index });
const input = (id, amount) => ({ reference: ref(id, 0), address, value: { ada: { lovelace: amount } }, datum: null, datumHash: null, script: null });
function fixture() {
  const f = {
    signedTransactionCborHex: hex,
    preSubmitEvidence: {
      schema: 'omegavault.cardano.preprod-initialize-pre-submit-evidence.v2',
      network: 'preprod', action: 'initialize',
      checks: { preSubmitFreshnessGateComplete: true, walletWitnessEvidenceVerified: true, completePhaseOneValidated: false },
      liveActions: { transactionSubmissionAuthorized: false, transactionSubmissionPerformed: false },
      signedTransaction: { sha256: sha, bytes: 4 },
      validity: { lowerSlot: 100, upperSlot: 200 },
      currentTip: { hash: 'cd'.repeat(32), slot: 150 },
      ledgerInputSnapshot: {
        source: 'read-only-ogmios-queryLedgerState/utxo',
        tip: { hash: 'cd'.repeat(32), slot: 150 },
        utxos: { seed: input('a', '20000000'), collateral: input('b', '5000000') }
      }
    }
  };
  const e = f.preSubmitEvidence;
  e.ledgerInputSnapshotSha256 = hashCardanoEvidence(e.ledgerInputSnapshot);
  e.preSubmitSha256 = hashCardanoEvidence(Object.fromEntries(Object.entries(e).filter(([key]) => key !== 'preSubmitSha256')));
  return f;
}
function fakeScalus(result = { isSuccess: true, txHash: 'e'.repeat(64) }) {
  const calls = [];
  class Utxo { constructor(txHash, index, addr, value) { Object.assign(this, { txHash, index, addr, value }); } }
  class Value { constructor(coin) { this.coin = coin; } }
  return {
    calls,
    api: {
      Utxo, Value,
      CardanoInfo: { preprod: () => 'preprod-protocol-context' },
      Emulator: { create: (network, opts) => {
        calls.push({ network, opts });
        return { submitTx: bytes => { calls.push({ bytes: Buffer.from(bytes).toString('hex') }); return result; } };
      } }
    }
  };
}

test('offline gate sends exact immutable signed bytes with two bound UTxOs to a local Scalus-compatible emulator', async () => {
  const fake = fakeScalus();
  const output = await runCardanoScalusInitializeTrial({ ...fixture(), scalusApi: fake.api });
  assert.equal(output.acceptedByEmulator, true);
  assert.equal(output.localTransactionHash, 'e'.repeat(64));
  assert.equal(fake.calls[0].network, 'preprod-protocol-context');
  assert.equal(fake.calls[0].opts.slot, 150);
  assert.equal(fake.calls[0].opts.utxos.length, 2);
  assert.equal(fake.calls[0].opts.utxos[0].value.coin, 20_000_000n);
  assert.equal(fake.calls[1].bytes, hex);
  assert.equal(output.authority.publicPreprodTransactionSubmitted, false);
  assert.equal(output.authority.completeCurrentPreprodPhaseOneValidated, false);
  assert.equal(output.authority.supportClaimAuthorized, false);
});

test('emulator rejection is surfaced without claiming ledger validation or network activity', async () => {
  const fake = fakeScalus({ isSuccess: false, errorRule: 'FeeTooSmall', error: 'rejected' });
  const output = await runCardanoScalusInitializeTrial({ ...fixture(), scalusApi: fake.api });
  assert.equal(output.acceptedByEmulator, false);
  assert.equal(output.rejectedByRule, 'FeeTooSmall');
  assert.equal(output.localTransactionHash, null);
  assert.equal(output.authority.transactionSubmissionAuthorized, false);
});

test('rejects forged or altered signed transaction before invoking emulator', async () => {
  const fake = fakeScalus();
  await assert.rejects(() => runCardanoScalusInitializeTrial({ ...fixture(), signedTransactionCborHex: '84a0a0f4', scalusApi: fake.api }), /digest/);
  assert.equal(fake.calls.length, 0);
});

test('rejects pre-submit evidence that asserts submission or phase-one authority', async () => {
  for (const mutation of [
    x => { x.preSubmitEvidence.checks.completePhaseOneValidated = true; },
    x => { x.preSubmitEvidence.liveActions.transactionSubmissionAuthorized = true; },
    x => { x.preSubmitEvidence.liveActions.transactionSubmissionPerformed = true; },
    x => { x.preSubmitEvidence.checks.walletWitnessEvidenceVerified = false; }
  ]) {
    const inputs = fixture(); mutation(inputs);
    const e = inputs.preSubmitEvidence;
    e.preSubmitSha256 = hashCardanoEvidence(Object.fromEntries(Object.entries(e).filter(([key]) => key !== 'preSubmitSha256')));
    await assert.rejects(() => runCardanoScalusInitializeTrial({ ...inputs, scalusApi: fakeScalus().api }), /pre-submit boundary/);
  }
});

test('rejects mismatched ledger snapshot and input drift', async () => {
  for (const mutation of [
    x => { x.preSubmitEvidence.ledgerInputSnapshot.tip.slot = 151; },
    x => { x.preSubmitEvidence.ledgerInputSnapshot.utxos.seed.script = { cbor: '00' }; },
    x => { x.preSubmitEvidence.ledgerInputSnapshot.utxos.seed.value.ada.lovelace = '2.5'; },
    x => { x.preSubmitEvidence.ledgerInputSnapshot.utxos.seed.value.foo = {}; },
    x => { x.preSubmitEvidence.ledgerInputSnapshot.utxos.collateral.reference = structuredClone(x.preSubmitEvidence.ledgerInputSnapshot.utxos.seed.reference); },
    x => { x.preSubmitEvidence.ledgerInputSnapshot.utxos.seed.address = 'addr1mainnet'; }
  ]) {
    const inputs = fixture(); mutation(inputs);
    await assert.rejects(() => runCardanoScalusInitializeTrial({ ...inputs, scalusApi: fakeScalus().api }));
  }
});

test('rejects malformed byte length and slot intervals, preserves deterministic simulated slot', async () => {
  for (const mutation of [
    x => { x.preSubmitEvidence.signedTransaction.bytes = 99; },
    x => { x.preSubmitEvidence.validity.upperSlot = 100; },
    x => { x.simulatedSlot = 1.5; }
  ]) {
    const inputs = fixture(); mutation(inputs);
    await assert.rejects(() => runCardanoScalusInitializeTrial({ ...inputs, scalusApi: fakeScalus().api }));
  }
  const fake = fakeScalus({ isSuccess: false, error: 'ExpiredValidityInterval' });
  const output = await runCardanoScalusInitializeTrial({ ...fixture(), simulatedSlot: 199, scalusApi: fake.api });
  assert.equal(fake.calls[0].opts.slot, 199);
  assert.equal(output.acceptedByEmulator, false);
});

test('refuses unrecognized emulator result rather than treating any truthy value as accepted', async () => {
  await assert.rejects(() => runCardanoScalusInitializeTrial({ ...fixture(), scalusApi: fakeScalus({ isSuccess: 'yes' }).api }), /recognized validation result/);
  await assert.rejects(() => runCardanoScalusInitializeTrial({ ...fixture(), scalusApi: fakeScalus({ isSuccess: true }).api }), /local transaction hash/);
});

test('Scalus gate rejects slots outside the evidence-bound validity interval before emulator invocation', async () => {
  for (const slot of [99, 200, 201]) {
    const fake = fakeScalus();
    await assert.rejects(
      () => runCardanoScalusInitializeTrial({ ...fixture(), simulatedSlot: slot, scalusApi: fake.api }),
      /outside the evidence-bound validity interval/
    );
    assert.equal(fake.calls.length, 0, `emulator invoked for out-of-range slot ${slot}`);
  }
  for (const slot of [100, 150, 199]) {
    const fake = fakeScalus();
    const output = await runCardanoScalusInitializeTrial({ ...fixture(), simulatedSlot: slot, scalusApi: fake.api });
    assert.equal(output.simulatedSlot, slot);
    assert.equal(output.acceptedByEmulator, true);
    assert.equal(fake.calls[0].opts.slot, slot);
  }
});
