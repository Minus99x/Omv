import test from 'node:test';
import assert from 'node:assert/strict';
import { listChainCapabilityContracts } from '../src/chains/capability-catalog.js';

test('current multichain catalog has no accidental promotion-eligible connector', () => {
  const contracts = listChainCapabilityContracts();
  assert.ok(contracts.length >= 8);
  for (const contract of contracts) {
    assert.equal(
      contract.promotion.eligible,
      false,
      `${contract.chainId} unexpectedly became promotion eligible without an explicit evidence checkpoint`
    );
  }
});

test('reduced, parked and compatibility stages retain explicit blockers', () => {
  const contracts = listChainCapabilityContracts();
  for (const contract of contracts.filter(item => ['reduced-semantics','parked','compatibility-ready'].includes(item.stage))) {
    assert.ok(contract.blockers.length > 0, `${contract.chainId} must retain an explicit blocker at stage ${contract.stage}`);
  }
});

test('public-testnet-required gates are never satisfied by offline evidence alone', () => {
  const contracts = listChainCapabilityContracts();
  const publicRequired = new Set([
    'wallet-signing','mechanism-create','mechanism-verify','inactivity-semantics',
    'threshold-semantics','immutable-rescue-semantics','native-asset-recovery',
    'token-recovery','fee-finality-model'
  ]);
  for (const contract of contracts) {
    for (const gate of publicRequired) {
      const evidence = contract.gateEvidence[gate];
      if (evidence.passed && evidence.level !== 'public-testnet') {
        assert.equal(
          evidence.evidenceSufficient,
          false,
          `${contract.chainId} ${gate} incorrectly treats ${evidence.level} as sufficient public-testnet evidence`
        );
      }
    }
  }
});
