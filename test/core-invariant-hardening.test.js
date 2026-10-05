import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approveRecovery,
  createVault,
  heartbeat,
  markRecovered,
  requestRecovery,
  validatePolicy,
  VaultStatus
} from '../src/core/recovery.js';
import { assessRecoveryReadiness } from '../src/core/recovery-readiness.js';
import { CORE_INVARIANT_IDS } from '../src/core/invariants.js';
import { PROMOTION_GATES } from '../src/chains/maturity.js';
import { createCapabilityMaturityContract } from '../src/chains/capability-contract.js';
import { getChainCapabilityContract } from '../src/chains/capability-catalog.js';
import { evaluateChainSupport } from '../src/chains/support-gates.js';

function addr(n) {
  return `0x${n.toString(16).padStart(40, '0')}`;
}

function policy(overrides = {}) {
  return {
    chainId: 'ethereum',
    owner: addr(1),
    rescueDestination: addr(2),
    trustedContacts: [addr(3), addr(4), addr(5)],
    threshold: 2,
    inactivityDays: 1,
    ...overrides
  };
}

function matureContract(chainId = 'example') {
  const gateEvidence = Object.fromEntries(PROMOTION_GATES.map(gate => [
    gate,
    { passed: true, level: 'public-testnet', refs: [`proof:${gate}`] }
  ]));
  return createCapabilityMaturityContract({
    adapter: { id: chainId, name: chainId, implementationStage: 'live-proof', capabilities: [] },
    networks: [{ id: `${chainId}:testnet`, chainId, name: 'testnet', environment: 'testnet', implementationStage: 'live-proof' }],
    stage: 'live-proof',
    gateEvidence,
    blockers: []
  });
}

function invariantEvidence(chainId, level = 'public-testnet') {
  return Object.fromEntries(CORE_INVARIANT_IDS.map(id => [
    id,
    { chainId, passed: true, level, refs: [`proof:${id}`] }
  ]));
}

test('canonical invariant catalog is stable and complete', () => {
  assert.deepEqual(CORE_INVARIANT_IDS, [
    'OV-I01', 'OV-I02', 'OV-I03', 'OV-I04', 'OV-I05', 'OV-I06', 'OV-I07',
    'OV-I08', 'OV-I09', 'OV-I10', 'OV-I11', 'OV-I12', 'OV-I13'
  ]);
});

test('owner, trusted-contact and rescue-destination roles cannot collapse together', () => {
  const ownerAsContact = validatePolicy(policy({ trustedContacts: [addr(1), addr(4)] }));
  assert.equal(ownerAsContact.ok, false);
  assert.ok(ownerAsContact.errors.some(value => /Owner cannot also be a trusted contact/.test(value)));

  const rescueAsContact = validatePolicy(policy({ trustedContacts: [addr(2), addr(4)] }));
  assert.equal(rescueAsContact.ok, false);
  assert.ok(rescueAsContact.errors.some(value => /Rescue destination cannot also be a trusted contact/.test(value)));

  const ownerAsRescue = validatePolicy(policy({ rescueDestination: addr(1) }));
  assert.equal(ownerAsRescue.ok, false);
  assert.ok(ownerAsRescue.errors.some(value => /Owner and rescue destination must be different/.test(value)));
});

test('trusted contact cannot redirect the predetermined Plan B destination', () => {
  const vault = createVault(policy(), new Date('2026-01-01T00:00:00Z'));
  assert.throws(
    () => requestRecovery(vault, addr(3), addr(999), new Date('2026-01-02T00:00:01Z')),
    /configured rescue destination/
  );
  assert.equal(vault.status, VaultStatus.ACTIVE);
  assert.equal(vault.recovery, null);
});

test('one compromised trusted-contact credential cannot satisfy a larger quorum', () => {
  const vault = createVault(policy(), new Date('2026-01-01T00:00:00Z'));
  requestRecovery(vault, addr(3), addr(2), new Date('2026-01-02T00:00:01Z'));
  for (let i = 0; i < 10; i++) approveRecovery(vault, addr(3), new Date('2026-01-02T00:00:02Z'));
  assert.deepEqual(vault.recovery.approvals, [addr(3)]);
  assert.equal(vault.status, VaultStatus.RECOVERY_PENDING);
});

test('untrusted credential has neither trigger nor approval authority', () => {
  const vault = createVault(policy(), new Date('2026-01-01T00:00:00Z'));
  assert.throws(
    () => requestRecovery(vault, addr(999), addr(2), new Date('2026-01-02T00:00:01Z')),
    /not a trusted contact/
  );
  requestRecovery(vault, addr(3), addr(2), new Date('2026-01-02T00:00:01Z'));
  assert.throws(() => approveRecovery(vault, addr(999), new Date('2026-01-02T00:00:02Z')), /not a trusted contact/);
});

test('owner heartbeat cancels pending or threshold-ready recovery without changing Plan B', () => {
  const vault = createVault(policy(), new Date('2026-01-01T00:00:00Z'));
  requestRecovery(vault, addr(3), addr(2), new Date('2026-01-02T00:00:01Z'));
  approveRecovery(vault, addr(4), new Date('2026-01-02T00:00:02Z'));
  assert.equal(vault.status, VaultStatus.RECOVERY_READY);
  heartbeat(vault, addr(1), new Date('2026-01-02T00:00:03Z'));
  assert.equal(vault.status, VaultStatus.ACTIVE);
  assert.equal(vault.recovery, null);
  assert.equal(vault.rescueDestination, addr(2));
});

test('execution fails closed until the configured approval threshold is met', () => {
  const vault = createVault(policy(), new Date('2026-01-01T00:00:00Z'));
  requestRecovery(vault, addr(3), addr(2), new Date('2026-01-02T00:00:01Z'));
  assert.throws(() => markRecovered(vault, 'chain-adapter', '0xtest'), /threshold has not been met/);
  assert.equal(vault.status, VaultStatus.RECOVERY_PENDING);
});

test('core recovery state machine has no OmegaVault operator credential dependency', () => {
  const vault = createVault(policy({ operator: 'OmegaVault Fintech Solutions' }), new Date('2026-01-01T00:00:00Z'));
  assert.equal('operator' in vault, false);
  requestRecovery(vault, addr(3), addr(2), new Date('2026-01-02T00:00:01Z'));
  approveRecovery(vault, addr(4), new Date('2026-01-02T00:00:02Z'));
  markRecovered(vault, 'native-chain-executor', 'native-test-ref', new Date('2026-01-02T00:00:03Z'));
  assert.equal(vault.status, VaultStatus.RECOVERED);
  assert.equal(vault.recovery.destination, addr(2));
});

test('recovery readiness fails closed when compatibility or migration status is unknown', () => {
  const vault = createVault(policy(), new Date('2026-01-01T00:00:00Z'));
  const readiness = assessRecoveryReadiness(vault);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.failedChecks.includes('compatibility-migration'));
});

test('recovery readiness covers owner, quorum, contacts, rescue config and compatibility', () => {
  const vault = createVault(policy(), new Date('2026-01-01T00:00:00Z'));
  const readiness = assessRecoveryReadiness(vault, {
    compatibility: { compatible: true, migrationRequired: false, ref: 'ethereum:test-proof' }
  });
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.checks.map(item => item.id), [
    'owner-status', 'viable-quorum', 'trusted-contacts', 'rescue-configuration', 'compatibility-migration'
  ]);
});

test('recovery readiness detects destination tampering and does not fail open', () => {
  const vault = createVault(policy(), new Date('2026-01-01T00:00:00Z'));
  requestRecovery(vault, addr(3), addr(2), new Date('2026-01-02T00:00:01Z'));
  vault.recovery.destination = addr(999);
  const readiness = assessRecoveryReadiness(vault, {
    compatibility: { compatible: true, migrationRequired: false, ref: 'ethereum:test-proof' }
  });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.failedChecks.includes('rescue-configuration'));
});

test('a chain cannot be called supported with only offline invariant evidence', () => {
  const capabilityContract = matureContract();
  const support = evaluateChainSupport({
    capabilityContract,
    invariantEvidence: invariantEvidence('example', 'offline-test')
  });
  assert.equal(capabilityContract.promotion.eligible, true);
  assert.equal(support.supported, false);
  assert.equal(support.insufficientInvariants.length, CORE_INVARIANT_IDS.length);
});

test('support evidence is chain-scoped and cross-wired evidence fails closed', () => {
  const capabilityContract = matureContract('example');
  const evidence = invariantEvidence('another-chain');
  const support = evaluateChainSupport({ capabilityContract, invariantEvidence: evidence });
  assert.equal(support.supported, false);
  assert.ok(support.insufficientInvariants.includes('OV-I01'));
});

test('Cardano remains explicitly unsupported until promotion and invariant public-testnet gates pass', () => {
  const cardano = getChainCapabilityContract('cardano');
  const support = evaluateChainSupport({ capabilityContract: cardano });
  assert.equal(cardano.stage, 'offline-verified');
  assert.equal(cardano.promotion.eligible, false);
  assert.equal(support.supported, false);
  assert.equal(support.insufficientInvariants.length, CORE_INVARIANT_IDS.length);
});

test('support gate opens only for complete promotion plus public-testnet invariant evidence', () => {
  const capabilityContract = matureContract('example');
  const support = evaluateChainSupport({
    capabilityContract,
    invariantEvidence: invariantEvidence('example')
  });
  assert.equal(support.supported, true);
  assert.deepEqual(support.reasons, []);
});
