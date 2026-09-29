import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXrplSignerListSet, coordinateXrplMultisign, normalizeXrplSequenceBinding, validateXrplSignerList } from '../src/chains/xrpl/signer-list.js';
import { createXrplEscrowFinishPlan, createXrplEscrowRecoveryPlan, evaluateXrplFeature, TOKEN_ESCROW_AMENDMENT_ID } from '../src/chains/xrpl/escrow.js';

const owner = 'r1111111111111111111111111';
const a = 'r2222222222222222222222222';
const b = 'r3333333333333333333333333';
const rescue = 'r4444444444444444444444444';

test('XRPL SignerList validator enforces unique non-owner entries, weights and reachable quorum', () => {
  const ok = validateXrplSignerList({ owner, signerEntries: [{ account: a, weight: 2 }, { account: b, weight: 1 }], quorum: 3 });
  assert.equal(ok.totalWeight, 3);
  assert.throws(() => validateXrplSignerList({ owner, signerEntries: [{ account: owner, weight: 1 }], quorum: 1 }), /owner/);
  assert.throws(() => validateXrplSignerList({ owner, signerEntries: [{ account: a, weight: 1 }, { account: a, weight: 1 }], quorum: 1 }), /Duplicate/);
  assert.throws(() => validateXrplSignerList({ owner, signerEntries: [{ account: a, weight: 1 }], quorum: 2 }), /unreachable/);
});

test('XRPL SignerListSet builder emits protocol-shaped signer entries', () => {
  const built = buildXrplSignerListSet({ owner, contacts: [a, b], quorum: 2, sequence: 12, feeDrops: '15', lastLedgerSequence: 1000 });
  assert.equal(built.transaction.TransactionType, 'SignerListSet');
  assert.equal(built.transaction.SignerEntries[0].SignerEntry.SignerWeight, 1);
  assert.equal(built.transaction.Sequence, 12);
});

test('XRPL Ticket binding requires Sequence zero and excludes AccountTxnID', () => {
  assert.deepEqual(normalizeXrplSequenceBinding({ ticketSequence: 55 }), { Sequence: 0, TicketSequence: 55 });
  assert.throws(() => normalizeXrplSequenceBinding({ sequence: 2, ticketSequence: 55 }), /Sequence = 0/);
  assert.throws(() => normalizeXrplSequenceBinding({ ticketSequence: 55, accountTxnId: 'A'.repeat(64) }), /AccountTxnID/);
});

test('XRPL multisign coordinator enforces signer-list membership, quorum and multisign fee multiplier', () => {
  const signerList = { owner, signerEntries: [{ account: a, weight: 1 }, { account: b, weight: 1 }], quorum: 2 };
  const transaction = { TransactionType: 'Payment', Account: owner, Destination: rescue, Amount: '1', Sequence: 10, Fee: '30' };
  const signatures = [
    { account: a, signingPubKey: 'EDA', txnSignature: 'AAA' },
    { account: b, signingPubKey: 'EDB', txnSignature: 'BBB' }
  ];
  const coordinated = coordinateXrplMultisign({ transaction, signerList, signatures, baseFeeDrops: '10' });
  assert.equal(coordinated.signedWeight, 2);
  assert.equal(coordinated.minimumFeeDrops, '30');
  assert.equal(coordinated.transaction.SigningPubKey, '');
  assert.equal(coordinated.transaction.Signers.length, 2);
  assert.throws(() => coordinateXrplMultisign({ transaction: { ...transaction, Fee: '29' }, signerList, signatures, baseFeeDrops: '10' }), /minimum/);
});

test('XRPL TokenEscrow capability gate reads feature response instead of assuming amendment status', () => {
  const enabled = evaluateXrplFeature({ featureResponse: { result: { [TOKEN_ESCROW_AMENDMENT_ID]: { name: 'TokenEscrow', supported: true, enabled: true } } } });
  assert.equal(enabled.enabled, true);
  const unknown = evaluateXrplFeature({ featureResponse: { result: {} } });
  assert.equal(unknown.known, false);
});

test('XRPL escrow plan supports XRP and capability-gated fungible tokens without mislabeling FinishAfter as inactivity', () => {
  const xrp = createXrplEscrowRecoveryPlan({ owner, rescueDestination: rescue, amountDrops: '1000000', finishAfterRippleTime: 900000000 });
  assert.equal(xrp.assetKind, 'xrp');
  assert.equal(xrp.securitySemantics.resettableInactivityOnChain, false);
  assert.match(xrp.scope, /absolute not-before/);

  const feature = { supported: true, enabled: true };
  const token = createXrplEscrowRecoveryPlan({
    owner, rescueDestination: rescue,
    amount: { currency: 'USD', issuer: a, value: '12.5' },
    finishAfterRippleTime: 900000000,
    cancelAfterRippleTime: 900000600,
    tokenEscrowFeature: feature
  });
  assert.equal(token.assetKind, 'trustline-token');
  assert.deepEqual(token.requiredCapabilities, ['TokenEscrow']);
  assert.throws(() => createXrplEscrowRecoveryPlan({ owner, rescueDestination: rescue, amount: { currency: 'USD', issuer: a, value: '1' }, finishAfterRippleTime: 900000000, cancelAfterRippleTime: 900000600 }), /TokenEscrow/);
});

test('XRPL EscrowFinish plan records that any account may submit while owner identifies the escrow', () => {
  const plan = createXrplEscrowFinishPlan({ submitter: b, owner, escrowSequence: 123 });
  assert.equal(plan.transaction.Account, b);
  assert.equal(plan.transaction.Owner, owner);
  assert.equal(plan.submitterCanBeAnyAccount, true);
});

import { XRPL_RECOVERY_MODES, assessXrplRecoverySemantics, assertXrplProductClaim } from '../src/chains/xrpl/recovery-semantics.js';

test('XRPL fixed-time escrow is explicitly not resettable inactivity recovery', () => {
  const result = assessXrplRecoverySemantics({ mode: XRPL_RECOVERY_MODES.FIXED_TIME_ESCROW });
  assert.equal(result.native, true);
  assert.equal(result.exactResettableInactivity, false);
  assert.match(result.reason, /immutable absolute/);
  assert.throws(() => assertXrplProductClaim({ mode: XRPL_RECOVERY_MODES.FIXED_TIME_ESCROW, claim: 'resettable-inactivity' }), /must not be advertised/);
});

test('XRPL signer quorum is authorization, not an inactivity clock', () => {
  const result = assessXrplRecoverySemantics({ mode: XRPL_RECOVERY_MODES.SIGNER_QUORUM });
  assert.equal(result.native, true);
  assert.equal(result.exactResettableInactivity, false);
  assert.match(result.reason, /do not provide an inactivity clock/);
});

test('XRPL exact resettable inactivity remains unsupported until a verified mechanism exists', () => {
  const result = assessXrplRecoverySemantics({ mode: XRPL_RECOVERY_MODES.RESETTABLE_INACTIVITY });
  assert.equal(result.native, false);
  assert.equal(result.exactResettableInactivity, false);
  assert.equal(result.mechanism, null);
});
