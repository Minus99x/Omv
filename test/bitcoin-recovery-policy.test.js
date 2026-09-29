import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBitcoinRecoveryPolicy, createBitcoinRolloverHeartbeatPlan, createBitcoinPsbtV2RecoveryPlan,
  coordinateBitcoinRecoverySignatures, assessBitcoinImmutableRescue, createBitcoinFeeBumpPlan, validateBitcoinCsvRecoveryInput, createBitcoinPsbtV2LockPlan
} from '../src/chains/bitcoin/recovery-policy.js';

const key = n => `${n % 2 ? '02' : '03'}${String(n).repeat(64)}`;
const owner = key(1), a = key(2), b = key(3);
const txid = 'ab'.repeat(32);

test('Bitcoin policy separates immediate owner path from delayed threshold recovery path', () => {
  const plan = createBitcoinRecoveryPolicy({ ownerKey: owner, contactKeys: [a, b], threshold: 2, csvBlocks: 144 });
  assert.equal(plan.policy.ownerPath.availability, 'immediate');
  assert.equal(plan.policy.recoveryPath.timelock.value, 144);
  assert.equal(plan.semantics.relativeDelayOnChain, true);
  assert.equal(plan.semantics.immutableRescueOnChain, false);
});

test('Bitcoin heartbeat is modeled as a confirmed UTXO rollover, not an account timestamp update', () => {
  const policy = createBitcoinRecoveryPolicy({ ownerKey: owner, contactKeys: [a, b], threshold: 2, csvBlocks: 144 });
  const heartbeat = createBitcoinRolloverHeartbeatPlan({ currentTxid: txid, currentVout: 0, currentPolicyDigest: policy.policyDigest, nextPolicyDigest: policy.policyDigest });
  assert.match(heartbeat.effect, /fresh relative timelock age/);
});

test('Bitcoin PSBTv2 coordinator binds signatures to one immutable transaction intent digest', () => {
  const plan = createBitcoinPsbtV2RecoveryPlan({
    inputs: [{ txid, vout: 0, sequence: 144, amountSats: '100000' }],
    outputs: [{ amountSats: '99000', scriptPubKey: '0014' + '11'.repeat(20) }],
    requiredContactKeys: [a, b], threshold: 2, feeSats: '1000', rescueScriptPubKey: '0014' + '11'.repeat(20)
  });
  assert.equal(plan.rescueOutputPresent, true);
  const partial = coordinateBitcoinRecoverySignatures({ plan, signatures: [{ publicKey: a, signature: 'aa', intentDigest: plan.intentDigest }] });
  assert.equal(partial.thresholdReached, false);
  const ready = coordinateBitcoinRecoverySignatures({ plan, signatures: [{ publicKey: a, signature: 'aa', intentDigest: plan.intentDigest }, { publicKey: b, signature: 'bb', intentDigest: plan.intentDigest }] });
  assert.equal(ready.thresholdReached, true);
  assert.throws(() => coordinateBitcoinRecoverySignatures({ plan, signatures: [{ publicKey: a, signature: 'aa', intentDigest: '00'.repeat(32) }] }), /different recovery transaction intent/);
});

test('Bitcoin immutable rescue gate fails closed for ordinary delayed multisig without a covenant', () => {
  const assessment = assessBitcoinImmutableRescue();
  assert.equal(assessment.enforceable, false);
  assert.match(assessment.reason, /do not by themselves commit/);
});

test('Bitcoin fee plan warns that fee mutations after signing may require recollection', () => {
  const plan = createBitcoinFeeBumpPlan({ signaturesAlreadyCollected: true, rbfEnabled: true });
  assert.match(plan.rules[0], /invalidate existing signatures/);
});


test('Bitcoin CSV preflight rejects disabled, time-based, old-version, and too-short recovery sequences', () => {
  assert.equal(validateBitcoinCsvRecoveryInput({ txVersion: 2, sequence: 144, csvBlocks: 144 }).ok, true);
  assert.equal(validateBitcoinCsvRecoveryInput({ txVersion: 1, sequence: 144, csvBlocks: 144 }).checks.transactionVersionAtLeast2, false);
  assert.equal(validateBitcoinCsvRecoveryInput({ txVersion: 2, sequence: 0x80000090, csvBlocks: 144 }).checks.relativeLocktimeEnabled, false);
  assert.equal(validateBitcoinCsvRecoveryInput({ txVersion: 2, sequence: 0x00400090, csvBlocks: 144 }).checks.heightBasedSequence, false);
  assert.equal(validateBitcoinCsvRecoveryInput({ txVersion: 2, sequence: 143, csvBlocks: 144 }).checks.sequenceMeetsPolicy, false);
});

test('Bitcoin PSBTv2 plan freezes inputs and outputs before OmegaVault signature collection', () => {
  const locked = createBitcoinPsbtV2LockPlan();
  assert.equal(locked.psbtVersion, 2);
  assert.equal(locked.unsignedTxFieldExcluded, true);
  assert.equal(locked.modifiableFlags, 0);
  assert.equal(locked.safeForOmegaVaultSignatureCollection, true);
  const unsafe = createBitcoinPsbtV2LockPlan({ outputsModifiable: true });
  assert.equal(unsafe.safeForOmegaVaultSignatureCollection, false);
  assert.equal(unsafe.modifiableFlags, 2);
});
