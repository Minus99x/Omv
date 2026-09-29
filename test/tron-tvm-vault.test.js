import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  TRON_TVM_REQUIRED_ABI, createTvmCallPlan, createTvmDeploymentPlan,
  createTvmDeploymentVerificationReport, normalizeTronAddress
} from '../src/chains/tron/tvm-vault.js';
import { runTronTrc20RecoveryProof, runTronTrxRecoveryProof } from '../src/chains/tron/recovery-test-runner.js';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function sha256(value) {
  return createHash('sha256').update(value).digest();
}

function base58Encode(bytes) {
  let number = BigInt(`0x${bytes.toString('hex')}`);
  let text = '';
  while (number > 0n) {
    const remainder = Number(number % 58n);
    text = BASE58[remainder] + text;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text;
}

function address(seed) {
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.alloc(20, seed)]);
  return base58Encode(Buffer.concat([payload, sha256(sha256(payload)).subarray(0, 4)]));
}

const OWNER = address(1);
const CONTACT_A = address(2);
const CONTACT_B = address(3);
const RESCUE = address(4);
const CONTRACT = address(5);
const TOKEN = address(6);

function verifiedDeployment() {
  return createTvmDeploymentVerificationReport({
    compiledRuntimeBytecode: '60016002',
    liveRuntimeBytecode: '60ff6002',
    immutableReferences: { owner: [{ start: 1, length: 1 }] },
    compilerArtifact: { distribution: 'tronprotocol/solidity', version: '0.8.31', optimizer: { enabled: true, runs: 200 } },
    expected: { owner: OWNER, rescueDestination: RESCUE, threshold: 2, inactivitySeconds: 86400, trustedContacts: [CONTACT_A, CONTACT_B] },
    observed: { networkRef: 'tron:shasta', contractAddress: CONTRACT, owner: OWNER, rescueDestination: RESCUE, threshold: 2, inactivitySeconds: 86400, adapterVersion: 603, trustedContacts: [CONTACT_B, CONTACT_A], abiFunctions: TRON_TVM_REQUIRED_ABI },
    sourceSha256: 'a'.repeat(64),
    observedAt: '2026-09-28T05:00:00.000Z'
  });
}

test('TRON base58check normalization validates checksum and 0x41 prefix', () => {
  assert.equal(normalizeTronAddress(OWNER), `41${'01'.repeat(20)}`);
  assert.equal(normalizeTronAddress(`41${'01'.repeat(20)}`), `41${'01'.repeat(20)}`);
  assert.throws(() => normalizeTronAddress(`${OWNER.slice(0, -1)}1`), /checksum/i);
  assert.throws(() => normalizeTronAddress(`42${'01'.repeat(20)}`), /base58|address/i);
});

test('TRON TVM deployment and call plans preserve visible address mode and caller-sized fee limits', () => {
  const deployment = createTvmDeploymentPlan({ ownerAddress: OWNER, contractName: 'OmegaVaultRecoveryVaultTRONV063', abi: [{ type: 'constructor' }], bytecode: '6000', constructorParameterHex: '', feeLimitSun: 80_000_000, originEnergyLimit: 10_000_000 });
  assert.equal(deployment.endpoint, 'wallet/deploycontract');
  assert.equal(deployment.body.visible, true);
  assert.equal(deployment.body.fee_limit, 80_000_000);
  const call = createTvmCallPlan({ ownerAddress: OWNER, contractAddress: CONTRACT, functionSelector: 'approveRecovery()', feeLimitSun: 20_000_000 });
  assert.equal(call.endpoint, 'wallet/triggersmartcontract');
  assert.equal(call.preflightEndpoint, 'wallet/triggerconstantcontract');
  assert.throws(() => createTvmCallPlan({ ownerAddress: OWNER, contractAddress: CONTRACT, functionSelector: 'approveRecovery()', feeLimitSun: 0 }), /feeLimitSun/);
});

test('TRON TVM verifier masks immutable slots and binds compiler, ABI and constructor state', () => {
  const report = verifiedDeployment();
  assert.equal(report.verified, true);
  assert.equal(report.checks.runtimeCodeMatched, true);
  assert.match(report.runtimeSha256, /^[a-f0-9]{64}$/);
  const tampered = createTvmDeploymentVerificationReport({
    compiledRuntimeBytecode: '60016002', liveRuntimeBytecode: '60ff6003', immutableReferences: { owner: [{ start: 1, length: 1 }] },
    compilerArtifact: report.compilerArtifact, expected: report.expected, observed: report.observed, observedAt: report.observedAt
  });
  assert.equal(tampered.verified, false);
  assert.equal(tampered.checks.runtimeCodeMatched, false);
});

test('TRON TRX live-proof runner requires verified deployment and solidifies every state change', async () => {
  let stateReads = 0;
  let transaction = 0;
  const driver = {
    async getChainParameters() { return { getEnergyFee: 100 }; },
    async getAccountResources() { return { EnergyLimit: 1_000_000 }; },
    async estimateEnergy() { return { energy_required: 50_000 }; },
    async readState() { return stateReads++ === 0 ? { recovered: false, balanceSun: '0' } : { recovered: true, balanceSun: '0' }; },
    async depositTrx() { return { txId: `tx${++transaction}` }; },
    async approveRecovery() { return { txId: `tx${++transaction}` }; },
    async executeRecovery() { return { txId: `tx${++transaction}` }; },
    async waitForSolidification(txId) { return { txId, solidified: true, result: 'SUCCESS' }; },
    async readTrxBalance() { return '1000000'; }
  };
  const config = { contractAddress: CONTRACT, owner: OWNER, contacts: [CONTACT_A, CONTACT_B], threshold: 2, rescueDestination: RESCUE, amountSun: 1_000_000 };
  await assert.rejects(() => runTronTrxRecoveryProof({ driver, config, deploymentVerification: { verified: false } }), /verification gate/);
  const result = await runTronTrxRecoveryProof({ driver, config, deploymentVerification: verifiedDeployment() });
  assert.equal(result.success, true);
  assert.equal(result.actions.filter(item => item.operation.endsWith('.solidify')).length, 4);
});

test('TRON TRX live-proof runner rejects a broadcast that is not successfully solidified', async () => {
  const driver = {
    async getChainParameters() { return { getEnergyFee: 100 }; },
    async getAccountResources() { return { EnergyLimit: 1_000_000 }; },
    async estimateEnergy() { return { energy_required: 50_000 }; },
    async readState() { return { recovered: false, balanceSun: '0' }; },
    async depositTrx() { return { txId: 'pending' }; },
    async approveRecovery() { throw new Error('must not advance'); },
    async executeRecovery() { throw new Error('must not advance'); },
    async waitForSolidification(txId) { return { txId, solidified: false, result: 'PENDING' }; },
    async readTrxBalance() { return '0'; }
  };
  const config = { contractAddress: CONTRACT, owner: OWNER, contacts: [CONTACT_A], threshold: 1, rescueDestination: RESCUE, amountSun: 1_000_000 };
  await assert.rejects(() => runTronTrxRecoveryProof({ driver, config, deploymentVerification: verifiedDeployment() }), /not solidified successfully/);
});

test('TRON TRC-20 runner verifies full vault-to-rescue movement after solidification', async () => {
  const balances = new Map([[`${TOKEN}:${CONTRACT}`, ['250', '0']], [`${TOKEN}:${RESCUE}`, ['10', '260']]]);
  const driver = {
    async estimateEnergy() { return { energy_required: 80_000 }; },
    async readTrc20Balance(token, holder) { return balances.get(`${token}:${holder}`).shift(); },
    async recoverTrc20() { return { txId: 'token-tx' }; },
    async waitForSolidification(txId) { return { txId, solidified: true, result: 'SUCCESS' }; }
  };
  const result = await runTronTrc20RecoveryProof({ driver, config: { contractAddress: CONTRACT, tokenAddress: TOKEN, rescueDestination: RESCUE, executor: OWNER }, deploymentVerification: verifiedDeployment() });
  assert.equal(result.success, true);
  assert.equal(result.vaultAfter, '0');
});

test('TRON TVM Solidity source pins compiler and contains epoch reset, immutable rescue and post-recovery token gate', () => {
  const source = readFileSync(new URL('../contracts/OmegaVaultRecoveryVaultTRONV063.sol', import.meta.url), 'utf8');
  assert.match(source, /pragma solidity 0\.8\.31;/);
  assert.match(source, /address payable public immutable rescueDestination/);
  assert.match(source, /recoveryEpoch \+= 1;/);
  assert.match(source, /if \(!recovered\) revert NotRecovered\(\);/);
  assert.match(source, /rescueDestination, amount/);
  assert.doesNotMatch(source, /selfdestruct|delegatecall/);
});
