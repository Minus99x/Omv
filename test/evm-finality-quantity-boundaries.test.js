import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvmBlockFinalityEvidence } from '../src/chains/evm/finality-evidence.js';

const TX = '0x' + '11'.repeat(32);
const RECEIPT_HASH = '0x' + '22'.repeat(32);
const FINALIZED_HASH = '0x' + '33'.repeat(32);
const DIGEST = 'aa'.repeat(32);
const proof = {
  success: true,
  networkRef: 'xdc:apothem',
  chainId: 'xdc',
  transactionRef: TX,
  bindingSha256: DIGEST,
  binding: {
    sha256: DIGEST,
    contextSha256: 'bb'.repeat(32),
    deploymentVerificationSha256: 'cc'.repeat(32)
  }
};
const base = {
  networkId: 'xdc:apothem',
  proof,
  observedChainIdHex: '0x33',
  receipt: { status: '0x1', transactionHash: TX, blockHash: RECEIPT_HASH, blockNumber: '0x10' },
  receiptBlock: { number: '0x10', hash: RECEIPT_HASH },
  finalizedBlock: { number: '0x11', hash: FINALIZED_HASH },
  observedAt: '2026-10-20T00:00:00Z'
};

test('EVM finalized-tag builder rejects block quantities beyond uint256', () => {
  const oversized = '0x1' + '0'.repeat(64);
  for (const change of [
    { receipt: { ...base.receipt, blockNumber: oversized } },
    { receiptBlock: { ...base.receiptBlock, number: oversized } },
    { finalizedBlock: { ...base.finalizedBlock, number: oversized } }
  ]) {
    assert.throws(() => createEvmBlockFinalityEvidence({ ...base, ...change }), /exceeds uint256/);
  }
});

test('EVM finalized-tag builder rejects receipt hash reused at another height', () => {
  assert.throws(() => createEvmBlockFinalityEvidence({
    ...base,
    finalizedBlock: { number: '0x11', hash: RECEIPT_HASH.toUpperCase().replace('0X', '0x') }
  }), /reuses receipt block hash/);
});

test('EVM finalized-tag builder accepts distinct canonical block hashes', () => {
  const evidence = createEvmBlockFinalityEvidence(base);
  assert.equal(evidence.method, 'finalized-tag');
  assert.equal(evidence.finality.finalizedBlockHash, FINALIZED_HASH);
  assert.equal(evidence.status, 'finalized');
});

test('EVM finalized-tag builder accepts matching hash at receipt height despite letter case', () => {
  const mixedHash = '0x' + 'aB'.repeat(32);
  const evidence = createEvmBlockFinalityEvidence({
    ...base,
    receipt: { ...base.receipt, blockHash: mixedHash },
    receiptBlock: { ...base.receiptBlock, hash: mixedHash.toLowerCase() },
    finalizedBlock: { number: '0x10', hash: mixedHash.toUpperCase().replace('0X', '0x') }
  });
  assert.equal(evidence.finality.finalizedBlockHash, mixedHash.toLowerCase());
  assert.equal(evidence.receipt.blockHash, mixedHash.toLowerCase());
});

test('EVM finalized-tag builder rejects conflicting hashes at receipt height', () => {
  assert.throws(() => createEvmBlockFinalityEvidence({
    ...base,
    finalizedBlock: { number: '0x10', hash: FINALIZED_HASH }
  }), /contradicts recovery receipt block/);
});
