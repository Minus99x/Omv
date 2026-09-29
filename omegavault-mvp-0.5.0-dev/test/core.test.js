import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVault, heartbeat, requestRecovery, approveRecovery,
  markRecovered, inactivityEligible, policyState, VaultStatus,
  bindChainDeployment, recordChainActivity
} from '../src/core/recovery.js';

const OWNER = '0x1111111111111111111111111111111111111111';
const DEST = '0x2222222222222222222222222222222222222222';
const A = '0x3333333333333333333333333333333333333333';
const B = '0x4444444444444444444444444444444444444444';
const C = '0x5555555555555555555555555555555555555555';
const CONTRACT = '0x6666666666666666666666666666666666666666';
const TX = `0x${'ab'.repeat(32)}`;
const SOURCE_HASH = '11'.repeat(32);

function make(now = new Date('2026-01-01T00:00:00Z')) {
  return createVault({ chainId: 'ethereum', owner: OWNER, rescueDestination: DEST, trustedContacts: [A, B, C], threshold: 2, inactivityDays: 30 }, now);
}

function bind(vault, overrides = {}) {
  return bindChainDeployment(vault, {
    chainId: 'ethereum', networkRef: '0xaa36a7', contractRef: CONTRACT,
    deploymentTxRef: TX, testOnly: true, testInactivitySeconds: 60,
    adapterVersion: '0.4.0', contractVersion: '0.4.0', sourceSha256: SOURCE_HASH,
    deploymentVerified: true, verification: { checks: { runtimeCodeMatched: true } },
    ...overrides
  }, new Date('2026-01-02T00:00:00Z'));
}

test('validates and creates a chain-agnostic policy record', () => {
  const vault = make();
  assert.equal(vault.chainId, 'ethereum');
  assert.equal(vault.status, VaultStatus.ACTIVE);
  assert.equal(vault.version, 3);
  assert.equal(vault.threshold, 2);
  assert.deepEqual(vault.chainBindings, {});
});

test('rejects a threshold larger than trusted contact count', () => {
  assert.throws(() => createVault({ chainId: 'ethereum', owner: OWNER, rescueDestination: DEST, trustedContacts: [A], threshold: 2, inactivityDays: 30 }), /Threshold/);
});

test('rejects owner equal to rescue destination', () => {
  assert.throws(() => createVault({ chainId: 'ethereum', owner: OWNER, rescueDestination: OWNER, trustedContacts: [A], threshold: 1, inactivityDays: 30 }), /must be different/);
});

test('inactivity eligibility and derived policy stage change at boundary', () => {
  const vault = make();
  const before = new Date('2026-01-30T23:59:59Z');
  const at = new Date('2026-01-31T00:00:00Z');
  assert.equal(inactivityEligible(vault, before), false);
  assert.equal(policyState(vault, before).stage, 'protected');
  assert.equal(inactivityEligible(vault, at), true);
  assert.equal(policyState(vault, at).stage, 'inactive_eligible');
});

test('recovery requires trusted contacts and reaches threshold', () => {
  const vault = make();
  requestRecovery(vault, A, DEST, new Date('2026-01-31T00:00:01Z'));
  assert.equal(vault.status, VaultStatus.RECOVERY_PENDING);
  approveRecovery(vault, B, new Date('2026-01-31T00:01:00Z'));
  assert.equal(vault.status, VaultStatus.RECOVERY_READY);
  assert.deepEqual(vault.recovery.approvals, [A, B]);
});

test('duplicate approvals do not increment threshold count', () => {
  const vault = make();
  requestRecovery(vault, A, DEST, new Date('2026-01-31T00:00:01Z'));
  approveRecovery(vault, A, new Date('2026-01-31T00:00:02Z'));
  assert.deepEqual(vault.recovery.approvals, [A]);
  assert.equal(vault.status, VaultStatus.RECOVERY_PENDING);
  assert.equal(vault.audit.at(-1).event, 'recovery.approval.duplicate_ignored');
});

test('unauthorized account cannot request or approve recovery', () => {
  const vault = make();
  const stranger = '0x9999999999999999999999999999999999999999';
  assert.throws(() => requestRecovery(vault, stranger, DEST, new Date('2026-01-31T00:00:01Z')), /trusted contact/);
  requestRecovery(vault, A, DEST, new Date('2026-01-31T00:00:01Z'));
  assert.throws(() => approveRecovery(vault, stranger), /trusted contact/);
});

test('recovery cannot redirect to a different destination', () => {
  const vault = make();
  assert.throws(() => requestRecovery(vault, A, OWNER, new Date('2026-01-31T00:00:01Z')), /destination/);
});

test('owner heartbeat cancels pending recovery', () => {
  const vault = make();
  requestRecovery(vault, A, DEST, new Date('2026-01-31T00:00:01Z'));
  heartbeat(vault, OWNER, new Date('2026-01-31T00:02:00Z'));
  assert.equal(vault.status, VaultStatus.ACTIVE);
  assert.equal(vault.recovery, null);
  assert.equal(vault.audit.at(-1).cancelledApprovals, 1);
});

test('non-owner cannot heartbeat', () => {
  const vault = make();
  assert.throws(() => heartbeat(vault, A), /Only the owner/);
});

test('recovery execution is only markable after threshold', () => {
  const vault = make();
  requestRecovery(vault, A, DEST, new Date('2026-01-31T00:00:01Z'));
  assert.throws(() => markRecovered(vault, A, '0xabc'), /threshold/i);
  approveRecovery(vault, B, new Date('2026-01-31T00:01:00Z'));
  markRecovered(vault, 'ethereum-adapter', '0xabc', new Date('2026-01-31T00:02:00Z'));
  assert.equal(vault.status, VaultStatus.RECOVERED);
  assert.equal(policyState(vault).stage, 'recovered');
});

test('test mode can exercise recovery without waiting thirty days', () => {
  const vault = make();
  requestRecovery(vault, A, DEST, new Date('2026-01-02T00:00:00Z'), { bypassInactivityForTest: true });
  assert.equal(vault.status, VaultStatus.RECOVERY_PENDING);
});

test('verified Sepolia deployment binds without changing core timer', () => {
  const vault = make();
  bind(vault);
  assert.equal(vault.inactivityDays, 30);
  assert.equal(vault.chainBindings.ethereum.testInactivitySeconds, 60);
  assert.equal(vault.chainBindings.ethereum.testOnly, true);
  assert.equal(vault.chainBindings.ethereum.deploymentVerified, true);
  assert.equal(vault.status, VaultStatus.ACTIVE);
});

test('Ethereum proof binding rejects mainnet, unverified, and non-test deployments', () => {
  assert.throws(() => bind(make(), { networkRef: '0x1' }), /only bind Sepolia/);
  assert.throws(() => bind(make(), { deploymentVerified: false }), /must pass runtime\/config verification/);
  assert.throws(() => bind(make(), { testOnly: false }), /test-only/);
});

test('binding is idempotent for the exact same verified deployment', () => {
  const vault = make();
  bind(vault);
  const count = vault.chainActivity.length;
  bind(vault);
  assert.equal(vault.chainActivity.length, count);
});

test('chain activity is independent from core state and duplicate tx records are idempotent', () => {
  const vault = make();
  bind(vault);
  const tx2 = `0x${'cd'.repeat(32)}`;
  recordChainActivity(vault, { chainId: 'ethereum', operation: 'recovery.approved', actor: A, txRef: tx2 });
  recordChainActivity(vault, { chainId: 'ethereum', operation: 'recovery.approved', actor: A, txRef: tx2 });
  assert.equal(vault.chainActivity.filter(x => x.txRef === tx2).length, 1);
  assert.equal(vault.status, VaultStatus.ACTIVE);
});

test('chain audit rejects forged role attribution', () => {
  const vault = make();
  bind(vault);
  const tx2 = `0x${'cd'.repeat(32)}`;
  assert.throws(() => recordChainActivity(vault, { chainId: 'ethereum', operation: 'heartbeat', actor: A, txRef: tx2 }), /configured owner/);
  assert.throws(() => recordChainActivity(vault, { chainId: 'ethereum', operation: 'recovery.approved', actor: OWNER, txRef: tx2 }), /trusted contact/);
});
