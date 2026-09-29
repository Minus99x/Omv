import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defineErc20Asset, erc20RecoveryAction } from '../src/chains/evm/erc20.js';
import { sponsorshipPlan, EVM_SPONSORSHIP_MODES } from '../src/chains/evm/sponsorship.js';

test('0.5 development contract gates ERC-20 sweep behind completed recovery', () => {
  const source = fs.readFileSync(new URL('../contracts/OmegaVaultRecoveryVaultV050.sol', import.meta.url), 'utf8');
  assert.match(source, /function recoverERC20\(address token\)/);
  assert.match(source, /if \(!recovered\) revert NotRecovered\(\)/);
  assert.match(source, /rescueDestination, amount/);
  assert.match(source, /nonReentrantTokenRecovery/);
  assert.match(source, /ADAPTER_VERSION = 500/);
});

test('ERC-20 recovery action targets immutable vault mechanism rather than rescue directly', () => {
  const token = defineErc20Asset({
    chainId: 'ethereum', networkRef: '0xaa36a7', address: '0x1111111111111111111111111111111111111111', symbol: 'TEST'
  });
  const plan = erc20RecoveryAction({
    networkRef: token.networkRef,
    vaultContract: '0x2222222222222222222222222222222222222222',
    tokenAddress: token.assetRef,
    requiredSigner: '0x3333333333333333333333333333333333333333'
  });
  assert.equal(plan.transactionTemplate.method, 'recoverERC20(address)');
  assert.deepEqual(plan.transactionTemplate.args, [token.assetRef]);
});

test('sponsorship stays scaffolded until a relayer endpoint exists', () => {
  const plan = sponsorshipPlan({ mode: EVM_SPONSORSHIP_MODES.RELAYER, signer: 'contact', feePayer: 'relayer' });
  assert.equal(plan.status, 'scaffold');
});
