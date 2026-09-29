import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { createXrplSignerListPlan, createXrplEscrowRecoveryPlan } from '../src/chains/plans/xrpl.js';
import { createStellarRecoveryBlueprint, createStellarThresholdPolicy } from '../src/chains/plans/stellar.js';
import { createTronPermissionPlan } from '../src/chains/plans/tron.js';
import { createSolanaProgramBlueprint } from '../src/chains/plans/solana.js';
import { createBitcoinRecoveryBlueprint } from '../src/chains/plans/bitcoin.js';
import { createCardanoRecoveryBlueprint } from '../src/chains/plans/cardano.js';

const xrpl = ['r1111111111111111111111111', 'r2222222222222222222222222', 'r3333333333333333333333333'];
const stellar = [31, 32, 33, 34].map(n => Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(n)).publicKey());
const tron = ['T' + 'A'.repeat(33), 'T' + 'B'.repeat(33), 'T' + 'C'.repeat(33)];

test('XRPL plans distinguish quorum from time-locked escrow semantics', () => {
  const signer = createXrplSignerListPlan({ owner: xrpl[0], contacts: xrpl.slice(1), threshold: 2 });
  assert.equal(signer.securitySemantics.thresholdOnChain, true);
  assert.equal(signer.securitySemantics.resettableInactivityOnChain, false);
  const escrow = createXrplEscrowRecoveryPlan({ owner: xrpl[0], rescueDestination: xrpl[1], amountDrops: 1000000, finishAfterRippleTime: 900000000 });
  assert.equal(escrow.securitySemantics.resettableInactivityOnChain, false);
  assert.match(escrow.scope, /absolute not-before/);
});

test('Stellar blueprint encodes inactivity and exact preauthorization work', () => {
  const plan = createStellarRecoveryBlueprint({ vaultAccount: stellar[0], rescueDestination: stellar[1], contacts: stellar.slice(2), threshold: 2, inactivitySeconds: 60, recoverySequence: '9223372036854770000' });
  assert.equal(plan.strategy, 'preauth-min-sequence-age');
  assert.equal(plan.inactivitySeconds, 60);
  assert.ok(plan.requiredProofs.some(x => /too-early/i.test(x)));
  const policy = createStellarThresholdPolicy({ contactCount: 2, threshold: 2 });
  assert.equal(policy.mediumThreshold, 1);
  assert.equal(policy.requiredExtraSignerCount, 2);
  assert.equal(policy.arbitraryContactSpendBlocked, true);
  assert.throws(() => createStellarThresholdPolicy({ contactCount: 3, threshold: 2 }), /1-2/);
});

test('TRON permission plan refuses to claim an inactivity gate', () => {
  const plan = createTronPermissionPlan({ owner: tron[0], contacts: tron.slice(1), threshold: 2 });
  assert.equal(plan.securitySemantics.thresholdOnChain, true);
  assert.equal(plan.securitySemantics.inactivityOnChain, false);
});

test('Solana, Bitcoin and Cardano blueprints enumerate chain-native work', () => {
  assert.ok(createSolanaProgramBlueprint({}).instructions.includes('heartbeat'));
  assert.ok(createBitcoinRecoveryBlueprint({}).requiredComponents.includes('PSBT v2 capable coordinator'));
  assert.match(createCardanoRecoveryBlueprint({}).strategy, /plutus-v3-aiken/);
});
