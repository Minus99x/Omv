import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runTronTrc20RecoveryProof,
  runTronTrxRecoveryProof
} from '../src/chains/tron/recovery-test-runner.js';

function trxConfig() {
  return {
    contractAddress:'TContract',
    owner:'TOwner',
    contacts:['TContactA','TContactB'],
    threshold:2,
    rescueDestination:'TRescue',
    executor:'TExecutor',
    amountSun:'1000000'
  };
}

function trxDriver(overrides = {}) {
  const calls = [];
  const driver = {
    async getChainParameters() {
      calls.push(['getChainParameters']);
      return { energyFee:'420', transactionFee:'1000' };
    },
    async getAccountResources(account) {
      calls.push(['getAccountResources', account]);
      return { energyLimit:'100000', bandwidth:'5000' };
    },
    async estimateEnergy(request) {
      calls.push(['estimateEnergy', request.operation]);
      if (overrides.estimateEnergy) return overrides.estimateEnergy(request);
      return { energyRequired:'10000' };
    },
    async readState(address) {
      calls.push(['readState', address]);
      const reads = calls.filter(call => call[0] === 'readState').length;
      if (overrides.readState) return overrides.readState({ address, reads });
      return reads === 1
        ? { recovered:false, balanceSun:'1000000' }
        : { recovered:true, balanceSun:'0' };
    },
    async depositTrx(request) {
      calls.push(['depositTrx', request]);
      return { txId:'tx-deposit' };
    },
    async approveRecovery(request) {
      calls.push(['approveRecovery', request.actor]);
      return { txId:`tx-approve-${request.actor}` };
    },
    async executeRecovery(request) {
      calls.push(['executeRecovery', request.actor]);
      return { txId:'tx-execute' };
    },
    async waitForSolidification(txId) {
      calls.push(['waitForSolidification', txId]);
      if (overrides.waitForSolidification) return overrides.waitForSolidification(txId);
      return { solidified:true, result:'SUCCESS', txId };
    },
    async readTrxBalance(account) {
      calls.push(['readTrxBalance', account]);
      return '1000000';
    }
  };
  return { driver, calls };
}

test('TRON TRX runner proves deposit, threshold approvals, recovery and solidification', async () => {
  const fake = trxDriver();
  const result = await runTronTrxRecoveryProof({
    driver:fake.driver,
    config:trxConfig(),
    deploymentVerification:{ verified:true, sha256:'aa'.repeat(32) }
  });
  assert.equal(result.success, true);
  assert.equal(result.kind, 'tron-tvm-trx-recovery-proof');
  assert.equal(result.deploymentVerificationSha256, 'aa'.repeat(32));
  assert.equal(result.before.recovered, false);
  assert.equal(result.after.recovered, true);
  assert.equal(result.after.balanceSun, '0');
  assert.equal(fake.calls.filter(call => call[0] === 'approveRecovery').length, 2);
  assert.equal(fake.calls.filter(call => call[0] === 'waitForSolidification').length, 4);
});

test('TRON TRX runner rejects unverified deployment before any chain action', async () => {
  const fake = trxDriver();
  await assert.rejects(
    () => runTronTrxRecoveryProof({
      driver:fake.driver,
      config:trxConfig(),
      deploymentVerification:{ verified:false, sha256:'aa'.repeat(32) }
    }),
    /deployment verification gate/i
  );
  assert.equal(fake.calls.length, 0);
});

test('TRON TRX runner fails closed when a transaction is not solidified successfully', async () => {
  const fake = trxDriver({
    waitForSolidification(txId) {
      if (txId === 'tx-execute') return { solidified:false, result:'PENDING', txId };
      return { solidified:true, result:'SUCCESS', txId };
    }
  });
  await assert.rejects(
    () => runTronTrxRecoveryProof({
      driver:fake.driver,
      config:trxConfig(),
      deploymentVerification:{ verified:true, sha256:'aa'.repeat(32) }
    }),
    /not solidified successfully/i
  );
});

function tokenDriver(overrides = {}) {
  const reads = new Map();
  const calls = [];
  const driver = {
    async estimateEnergy(request) {
      calls.push(['estimateEnergy', request.operation]);
      return { energyRequired:'12000' };
    },
    async readTrc20Balance(tokenAddress, account) {
      calls.push(['readTrc20Balance', tokenAddress, account]);
      const count = (reads.get(account) ?? 0) + 1;
      reads.set(account, count);
      if (overrides.readTrc20Balance) {
        const value = overrides.readTrc20Balance({ tokenAddress, account, count });
        if (value != null) return value;
      }
      if (account === 'TContract') return count === 1 ? '500' : '0';
      return count === 1 ? '100' : '600';
    },
    async recoverTrc20(request) {
      calls.push(['recoverTrc20', request.tokenAddress]);
      return { txId:'tx-token-recover' };
    },
    async waitForSolidification(txId) {
      calls.push(['waitForSolidification', txId]);
      return { solidified:true, result:'SUCCESS', txId };
    }
  };
  return { driver, calls };
}

test('TRON TRC-20 runner proves exact vault-to-rescue token movement', async () => {
  const fake = tokenDriver();
  const result = await runTronTrc20RecoveryProof({
    driver:fake.driver,
    config:{
      contractAddress:'TContract',
      tokenAddress:'TToken',
      rescueDestination:'TRescue',
      executor:'TExecutor'
    },
    deploymentVerification:{ verified:true, sha256:'bb'.repeat(32) }
  });
  assert.equal(result.success, true);
  assert.equal(result.vaultBefore, '500');
  assert.equal(result.vaultAfter, '0');
  assert.equal(result.rescueBefore, '100');
  assert.equal(result.rescueAfter, '600');
});

test('TRON TRC-20 runner reports false when rescue delta does not match vault amount', async () => {
  const fake = tokenDriver({
    readTrc20Balance({ account, count }) {
      if (account === 'TRescue' && count === 2) return '599';
      return null;
    }
  });
  const result = await runTronTrc20RecoveryProof({
    driver:fake.driver,
    config:{
      contractAddress:'TContract',
      tokenAddress:'TToken',
      rescueDestination:'TRescue',
      executor:'TExecutor'
    },
    deploymentVerification:{ verified:true, sha256:'bb'.repeat(32) }
  });
  assert.equal(result.success, false);
});
