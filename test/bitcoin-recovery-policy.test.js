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

test('Bitcoin recovery intent rejects duplicated or malformed input outpoints', () => {
  const input = { txid, vout:0, sequence:144, amountSats:'100000' };
  const args = { inputs:[input], outputs:[{ amountSats:'99000', scriptPubKey:'0014'+'11'.repeat(20) }], requiredContactKeys:[a,b], threshold:2, feeSats:'1000' };
  assert.throws(() => createBitcoinPsbtV2RecoveryPlan({ ...args, inputs:[input,{...input,txid:txid.toUpperCase()}], outputs:[{...args.outputs[0],amountSats:'199000'}] }),/Duplicate Bitcoin recovery input outpoint/);
  assert.throws(() => createBitcoinPsbtV2RecoveryPlan({ ...args, inputs:[{...input,vout:0x100000000}] }),/uint32/);
  assert.throws(() => createBitcoinPsbtV2RecoveryPlan({ ...args, inputs:[{...input,sequence:0x100000000}] }),/sequence must be uint32/);
});

test('Bitcoin recovery intent requires distinct threshold identities', () => {
  const args = { inputs:[{txid,vout:0,amountSats:'100000'}], outputs:[{amountSats:'99000',scriptPubKey:'0014'+'11'.repeat(20)}], feeSats:'1000' };
  assert.throws(() => createBitcoinPsbtV2RecoveryPlan({...args,requiredContactKeys:[a,a.toUpperCase()],threshold:2}),/must be unique/);
});

test('Bitcoin recovery intent validates exact signed-fee conservation and canonical satoshi quantities', () => {
  const args = { inputs:[{txid,vout:0,sequence:144,amountSats:'100000'}], outputs:[{amountSats:'99000',scriptPubKey:'0014'+'11'.repeat(20)}],requiredContactKeys:[a,b],threshold:2,feeSats:'1000' };
  assert.equal(createBitcoinPsbtV2RecoveryPlan(args).feeBalanceVerified,true);
  assert.throws(() => createBitcoinPsbtV2RecoveryPlan({...args,feeSats:'2000'}),/do not balance/);
  assert.throws(() => createBitcoinPsbtV2RecoveryPlan({...args,inputs:[{...args.inputs[0],amountSats:'-1'}]}),/non-negative integer/);
  assert.throws(() => createBitcoinPsbtV2RecoveryPlan({...args,inputs:[{...args.inputs[0],amountSats:Number.MAX_SAFE_INTEGER+1}]}),/safe integer/);
  assert.throws(() => createBitcoinPsbtV2RecoveryPlan({...args,outputs:[{...args.outputs[0],scriptPubKey:'001'}]}),/even-length hex/);
});

test('Bitcoin recovery intent never claims fee-balance verification without prevout amounts', () => {
  const plan = createBitcoinPsbtV2RecoveryPlan({
    inputs:[{txid,vout:0}],outputs:[{amountSats:'99000',scriptPubKey:'0014'+'11'.repeat(20)}],
    requiredContactKeys:[a,b],threshold:2,feeSats:'1000'
  });
  assert.equal(plan.feeBalanceVerified,false);
  assert.equal(plan.unsignedIntent.inputs[0].amountSats,null);
});


test('recovery planner refuses impossible Bitcoin supply, fees, and fee-only rescue destinations', () => {
  const cap = 21_000_000n * 100_000_000n;
  const rescue = '0014' + '11'.repeat(20);
  const baseline = {
    inputs:[{txid,vout:0,sequence:144,amountSats:'100000'}],
    outputs:[{amountSats:'99000',scriptPubKey:rescue}],
    requiredContactKeys:[a,b],threshold:2,feeSats:'1000',
    rescueScriptPubKey:rescue
  };
  assert.equal(createBitcoinPsbtV2RecoveryPlan(baseline).feeBalanceVerified,true);
  assert.throws(() => createBitcoinPsbtV2RecoveryPlan({
    ...baseline, feeSats:(cap+1n).toString()
  }),/feeSats exceeds Bitcoin MAX_MONEY/);
  assert.throws(() => createBitcoinPsbtV2RecoveryPlan({
    ...baseline, inputs:[{...baseline.inputs[0],amountSats:(cap+1n).toString()}]
  }),/amountSats exceeds Bitcoin MAX_MONEY/);
  assert.throws(() => createBitcoinPsbtV2RecoveryPlan({
    ...baseline, outputs:[{...baseline.outputs[0],amountSats:(cap+1n).toString()}]
  }),/amountSats exceeds Bitcoin MAX_MONEY/);
  assert.throws(() => createBitcoinPsbtV2RecoveryPlan({
    ...baseline, inputs:[
      {...baseline.inputs[0],amountSats:(cap/2n+1n).toString()},
      {txid:'cd'.repeat(32),vout:0,sequence:144,amountSats:(cap/2n+1n).toString()}
    ],
    outputs:[{...baseline.outputs[0],amountSats:'2'}],
    feeSats:cap.toString()
  }),/aggregate input value exceeds MAX_MONEY/);
  assert.throws(() => createBitcoinPsbtV2RecoveryPlan({
    ...baseline, inputs:[{txid,vout:0,sequence:144}],
    outputs:[
      {amountSats:(cap/2n+1n).toString(),scriptPubKey:rescue},
      {amountSats:(cap/2n+1n).toString(),scriptPubKey:'0014'+'22'.repeat(20)}
    ]
  }),/aggregate output value exceeds MAX_MONEY/);
  assert.throws(() => createBitcoinPsbtV2RecoveryPlan({
    ...baseline, outputs:[{...baseline.outputs[0],amountSats:'0'}],
    feeSats:'100000'
  }),/zero-value rescue output/);
  // Unknown prevout amounts are still explicitly unverified, not treated as
  // sufficient evidence of fee balance or authorization.
  const unresolved=createBitcoinPsbtV2RecoveryPlan({
    ...baseline,inputs:[{txid,vout:0,sequence:144}]
  });
  assert.equal(unresolved.feeBalanceVerified,false);
});

test('recovery planner accepts a maximum-supply value without exceeding the supply boundary', () => {
  const cap = 21_000_000n * 100_000_000n;
  const rescue='0014'+'11'.repeat(20);
  const plan=createBitcoinPsbtV2RecoveryPlan({
    inputs:[{txid,vout:0,sequence:144,amountSats:cap.toString()}],
    outputs:[{amountSats:(cap-1000n).toString(),scriptPubKey:rescue}],
    requiredContactKeys:[a,b],threshold:2,feeSats:'1000',
    rescueScriptPubKey:rescue
  });
  assert.equal(plan.feeBalanceVerified,true);
  assert.equal(plan.rescueOutputPresent,true);
  assert.equal(plan.unsignedIntent.feeSats,'1000');
});

test('Bitcoin PSBT recovery rejects coercible non-primitive satoshi amounts', () => {
  const args = {
    inputs: [{ txid, vout: 0, amountSats: '100000' }],
    outputs: [{ amountSats: '99000', scriptPubKey: '0014' + '11'.repeat(20) }],
    requiredContactKeys: [a, b],
    threshold: 2,
    feeSats: '1000'
  };
  for (const invalid of [[1000], new Number(1000), { toString: () => '1000' }, false, true]) {
    assert.throws(() => createBitcoinPsbtV2RecoveryPlan({ ...args, feeSats: invalid }), /primitive non-negative integer/);
    assert.throws(() => createBitcoinPsbtV2RecoveryPlan({
      ...args, inputs: [{ ...args.inputs[0], amountSats: invalid }]
    }), /primitive non-negative integer/);
    assert.throws(() => createBitcoinPsbtV2RecoveryPlan({
      ...args, outputs: [{ ...args.outputs[0], amountSats: invalid }]
    }), /primitive non-negative integer/);
  }
  assert.equal(createBitcoinPsbtV2RecoveryPlan({ ...args, feeSats: 1000n }).unsignedIntent.feeSats, '1000');
});

test('Bitcoin rollover heartbeat binds a real uint32 output index and bounded confirmation target', () => {
  const args = {
    currentTxid: txid, currentVout: 0,
    currentPolicyDigest: '11'.repeat(32), nextPolicyDigest: '22'.repeat(32)
  };
  assert.equal(createBitcoinRolloverHeartbeatPlan({ ...args, currentVout: 0xffffffff }).spends.vout, 0xffffffff);
  for (const bad of [-1, 1.2, 0x100000000, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => createBitcoinRolloverHeartbeatPlan({ ...args, currentVout: bad }), /currentVout must be a uint32/);
  }
  for (const bad of [0, 1.2, -1, 0x100000000, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => createBitcoinRolloverHeartbeatPlan({ ...args, minimumConfirmations: bad }), /minimumConfirmations must be a positive uint32/);
  }
});

test('Bitcoin immutable-rescue capability must not be asserted from coercible truthy flags', () => {
  for (const value of ['false', 'true', 1, 0, {}, [], null]) {
    assert.throws(() => assessBitcoinImmutableRescue({ covenantActive: value }), /explicit booleans/);
    assert.throws(() => assessBitcoinImmutableRescue({ recoveryPathUsesContactKeys: value }), /explicit booleans/);
  }
  assert.equal(assessBitcoinImmutableRescue({ covenantActive: false }).enforceable, false);
  assert.equal(assessBitcoinImmutableRescue({ covenantActive: true }).status.includes('requires separate'), true);
});

test('Bitcoin signature coordinator rejects non-hexadecimal, odd, and missing signature bytes', () => {
  const plan = createBitcoinPsbtV2RecoveryPlan({
    inputs: [{ txid, vout: 0, amountSats: '100000' }],
    outputs: [{ amountSats: '99000', scriptPubKey: '0014' + '11'.repeat(20) }],
    requiredContactKeys: [a, b], threshold: 2, feeSats: '1000'
  });
  for (const invalid of ['', 'a', 'abc', 'gg', '0g', 12, null, [], {}]) {
    assert.throws(() => coordinateBitcoinRecoverySignatures({
      plan,
      signatures: [{ publicKey: a, intentDigest: plan.intentDigest, signature: invalid }]
    }), /signature bytes must be non-empty even-length hexadecimal/);
  }
  assert.equal(coordinateBitcoinRecoverySignatures({
    plan, signatures: [{ publicKey: a, intentDigest: plan.intentDigest, signature: 'AABB' }]
  }).signatureCount, 1);
});
