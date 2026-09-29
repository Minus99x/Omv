import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault } from '../src/core/recovery.js';
import { getChain, listChains } from '../src/chains/registry.js';

const fixtures = {
  xrpl: {
    owner: 'r1111111111111111111111111',
    destination: 'r2222222222222222222222222',
    contact: 'r3333333333333333333333333'
  },
  solana: {
    owner: '11111111111111111111111111111111',
    destination: '22222222222222222222222222222222',
    contact: '33333333333333333333333333333333'
  },
  bitcoin: {
    owner: 'bc1q11111111111111111111111111111111111111',
    destination: 'bc1q22222222222222222222222222222222222222',
    contact: 'bc1q33333333333333333333333333333333333333'
  },
  xdc: {
    owner: 'xdc1111111111111111111111111111111111111111',
    destination: 'xdc2222222222222222222222222222222222222222',
    contact: 'xdc3333333333333333333333333333333333333333'
  }
};

test('registry keeps non-EVM chain families distinct', () => {
  const byId = Object.fromEntries(listChains().map(chain => [chain.id, chain]));
  assert.equal(byId.ethereum.family, 'evm');
  assert.equal(byId.xrpl.family, 'xrpl');
  assert.equal(byId.solana.family, 'solana');
  assert.equal(byId.bitcoin.family, 'utxo');
  assert.equal(byId.xdc.family, 'evm-account-compatible');
});

for (const [chainId, fixture] of Object.entries(fixtures)) {
  test(`Core can model a ${chainId} policy without Ethereum transaction assumptions`, () => {
    const chain = getChain(chainId);
    assert.equal(chain.validateAccount(fixture.owner), true);
    assert.equal(chain.validateAccount(fixture.destination), true);
    assert.equal(chain.validateAccount(fixture.contact), true);
    const vault = createVault({
      chainId,
      owner: fixture.owner,
      rescueDestination: fixture.destination,
      trustedContacts: [fixture.contact],
      threshold: 1,
      inactivityDays: 30
    }, new Date('2026-01-01T00:00:00Z'));
    assert.equal(vault.chainId, chainId);
    assert.equal(vault.threshold, 1);
    assert.deepEqual(vault.chainBindings, {});
  });
}
