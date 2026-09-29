import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVault, requestRecovery, approveRecovery, heartbeat,
  VaultStatus
} from '../src/core/recovery.js';

function addr(n) {
  return `0x${n.toString(16).padStart(40, '0')}`;
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 2 ** 32);
}

const random = lcg(0x0a6e9a17);

test('property sweep: threshold can never be reached by duplicate votes', () => {
  for (let i = 0; i < 100; i++) {
    const count = 2 + Math.floor(random() * 8);
    const threshold = 2 + Math.floor(random() * (count - 1));
    const contacts = Array.from({ length: count }, (_, k) => addr(1000 + i * 20 + k));
    const owner = addr(1 + i * 20);
    const destination = addr(2 + i * 20);
    const vault = createVault({ chainId: 'ethereum', owner, rescueDestination: destination, trustedContacts: contacts, threshold, inactivityDays: 1 }, new Date('2026-01-01T00:00:00Z'));
    requestRecovery(vault, contacts[0], destination, new Date('2026-01-02T00:00:01Z'));
    for (let j = 0; j < threshold + 5; j++) approveRecovery(vault, contacts[0], new Date('2026-01-02T00:00:02Z'));
    assert.equal(vault.recovery.approvals.length, 1);
    assert.notEqual(vault.status, VaultStatus.RECOVERY_READY);
  }
});

test('property sweep: unique trusted votes reach ready exactly at threshold', () => {
  for (let i = 0; i < 100; i++) {
    const count = 1 + Math.floor(random() * 10);
    const threshold = 1 + Math.floor(random() * count);
    const contacts = Array.from({ length: count }, (_, k) => addr(10000 + i * 20 + k));
    const owner = addr(5000 + i * 20);
    const destination = addr(5001 + i * 20);
    const vault = createVault({ chainId: 'ethereum', owner, rescueDestination: destination, trustedContacts: contacts, threshold, inactivityDays: 1 }, new Date('2026-02-01T00:00:00Z'));
    requestRecovery(vault, contacts[0], destination, new Date('2026-02-02T00:00:01Z'));
    for (let j = 1; j < threshold; j++) {
      assert.notEqual(vault.status, VaultStatus.RECOVERY_READY);
      approveRecovery(vault, contacts[j], new Date(`2026-02-02T00:00:${String(j + 1).padStart(2, '0')}Z`));
    }
    assert.equal(vault.recovery.approvals.length, threshold);
    assert.equal(vault.status, VaultStatus.RECOVERY_READY);
  }
});

test('property sweep: owner heartbeat always clears a pending or ready recovery', () => {
  for (let i = 0; i < 75; i++) {
    const owner = addr(20000 + i * 10);
    const destination = addr(20001 + i * 10);
    const contacts = [addr(20002 + i * 10), addr(20003 + i * 10), addr(20004 + i * 10)];
    const vault = createVault({ chainId: 'ethereum', owner, rescueDestination: destination, trustedContacts: contacts, threshold: 2, inactivityDays: 1 }, new Date('2026-03-01T00:00:00Z'));
    requestRecovery(vault, contacts[0], destination, new Date('2026-03-02T00:00:01Z'));
    if (i % 2 === 0) approveRecovery(vault, contacts[1], new Date('2026-03-02T00:00:02Z'));
    heartbeat(vault, owner, new Date('2026-03-02T00:00:03Z'));
    assert.equal(vault.status, VaultStatus.ACTIVE);
    assert.equal(vault.recovery, null);
  }
});

test('property sweep: recovery destination is immutable from requester input', () => {
  for (let i = 0; i < 75; i++) {
    const owner = addr(30000 + i * 10);
    const destination = addr(30001 + i * 10);
    const contact = addr(30002 + i * 10);
    const attackerDestination = addr(39999 + i);
    const vault = createVault({ chainId: 'ethereum', owner, rescueDestination: destination, trustedContacts: [contact], threshold: 1, inactivityDays: 1 }, new Date('2026-04-01T00:00:00Z'));
    assert.throws(() => requestRecovery(vault, contact, attackerDestination, new Date('2026-04-02T00:00:01Z')), /destination/);
    assert.equal(vault.status, VaultStatus.ACTIVE);
  }
});
