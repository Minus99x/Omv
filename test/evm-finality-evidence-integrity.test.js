import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getNetwork } from '../src/chains/network-registry.js';
import { createEvmBlockFinalityEvidence, evmFinalityMatchesProof } from '../src/chains/evm/finality-evidence.js';

const TX = '0x' + '11'.repeat(32);
const RECEIPT_HASH = '0x' + '22'.repeat(32);
const FINALIZED_HASH = '0x' + '33'.repeat(32);
const WRONG_HASH = '0x' + '44'.repeat(32);
function proofFor(networkId, kind = 'native-recovery') {
  const network = getNetwork(networkId);
  return {
    success: true, networkRef: network.id, chainId: network.chainId, transactionRef: TX,
    bindingSha256: 'a'.repeat(64),
    binding: { kind, sha256: 'a'.repeat(64),
      contextSha256: 'b'.repeat(64), deploymentVerificationSha256: 'c'.repeat(64) }
  };
}
function args(networkId = 'xdc:apothem') {
  const network = getNetwork(networkId);
  return {
    networkId, proof: proofFor(networkId), observedChainIdHex: network.chainIdHex,
    receipt: { status: '0x1', transactionHash: TX, blockNumber: '0x2a', blockHash: RECEIPT_HASH },
    receiptBlock: { number: '0x2a', hash: RECEIPT_HASH },
    finalizedBlock: { number: '0x2b', hash: FINALIZED_HASH },
    observedAt: '2026-10-14T18:00:00Z'
  };
}
const digest = value => {
  function stable(x) {
    if (Array.isArray(x)) return x.map(stable);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(key => [key, stable(x[key])]));
    return x;
  }
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
};
function rehash(evidence, replacements) {
  const { sha256: _old, ...core } = evidence;
  const changed = { ...core, ...replacements };
  return { ...changed, sha256: digest(changed) };
}

test('XDC recovery evidence requires receipt-height canonical block and finalized-tag head', () => {
  const a = args();
  const evidence = createEvmBlockFinalityEvidence(a);
  assert.equal(evidence.schema, 'omegavault.evm-finality-evidence.v2');
  assert.equal(evidence.status, 'finalized');
  assert.equal(evidence.method, 'finalized-tag');
  assert.equal(evidence.receipt.canonicalBlockHash, RECEIPT_HASH);
  assert.equal(evidence.receipt.canonicalBlockNumber, '42');
  assert.equal(evmFinalityMatchesProof(evidence, a.proof, { networkId: a.networkId, kind: 'native-recovery' }), true);
});

test('an apparently successful XDC receipt cannot be finalized without canonical block observation', () => {
  const a = args();
  delete a.receiptBlock;
  assert.throws(() => createEvmBlockFinalityEvidence(a), /canonical receipt-block observation/);
});

test('XDC finality rejects receipt block hash and height substitution', () => {
  for (const receiptBlock of [
    { number: '0x2a', hash: WRONG_HASH },
    { number: '0x2b', hash: RECEIPT_HASH },
    { number: 'bad', hash: RECEIPT_HASH },
    { number: '0x2a', hash: '0xdead' }
  ]) {
    assert.throws(() => createEvmBlockFinalityEvidence({ ...args(), receiptBlock }),
      /canonical block|receiptBlock/);
  }
});

test('XDC same-height finalized head must be exactly the receipt block', () => {
  assert.throws(() => createEvmBlockFinalityEvidence({
    ...args(), finalizedBlock: { number: '0x2a', hash: WRONG_HASH }
  }), /Finalized head hash contradicts/);
  const a = args();
  const evidence = createEvmBlockFinalityEvidence({
    ...a, finalizedBlock: { number: '0x2a', hash: RECEIPT_HASH }
  });
  assert.equal(evmFinalityMatchesProof(evidence, a.proof, { networkId: a.networkId, kind: 'native-recovery' }), true);
});

test('rehashing forged receipt canonicality or method cannot bypass the XDC evidence matcher', () => {
  const a = args();
  const original = createEvmBlockFinalityEvidence(a);
  const forgedReceipt = rehash(original, { receipt: {
    ...original.receipt, canonicalBlockHash: WRONG_HASH
  } });
  const forgedMethod = rehash(original, { method: 'confirmations' });
  const forgedFinalizedHeight = rehash(original, { finality: {
    ...original.finality, finalizedBlockNumber: '41'
  } });
  const forgedVersion = rehash(original, { schema: 'omegavault.evm-finality-evidence.v1' });
  for (const forged of [forgedReceipt, forgedMethod, forgedFinalizedHeight, forgedVersion]) {
    assert.equal(evmFinalityMatchesProof(forged, a.proof, {
      networkId: a.networkId, kind: 'native-recovery'
    }), false);
  }
});

test('Sepolia confirmation count remains chain-policy-bound with canonical receipt check', () => {
  const a = args('ethereum:sepolia');
  const evidence = createEvmBlockFinalityEvidence({
    ...a, finalizedBlock: null, latestBlock: { number: '0x2b', hash: FINALIZED_HASH }
  });
  assert.equal(evidence.method, 'confirmations');
  assert.equal(evidence.finality.confirmations, '2');
  assert.equal(evmFinalityMatchesProof(evidence, a.proof, {
    networkId: 'ethereum:sepolia', kind: 'native-recovery'
  }), true);
  const alteredCount = rehash(evidence, { finality: { ...evidence.finality, confirmations: '3' } });
  assert.equal(evmFinalityMatchesProof(alteredCount, a.proof, {
    networkId: 'ethereum:sepolia', kind: 'native-recovery'
  }), false);
  assert.throws(() => createEvmBlockFinalityEvidence({
    ...a, finalizedBlock: null, latestBlock: { number: '0x2a', hash: RECEIPT_HASH }
  }), /fewer than 2/);
});

test('finality verifier rejects evidence bound to another recovery proof or recovery kind', () => {
  const a = args();
  const evidence = createEvmBlockFinalityEvidence(a);
  assert.equal(evmFinalityMatchesProof(evidence, { ...a.proof, transactionRef: WRONG_HASH }, {
    networkId: a.networkId, kind: 'native-recovery'
  }), false);
  assert.equal(evmFinalityMatchesProof(evidence, a.proof, {
    networkId: a.networkId, kind: 'erc20-recovery'
  }), false);
});

test('XDC finality creation and verification reject noncanonical UTC observation timestamps', () => {
  const source=args();
  const evidence=createEvmBlockFinalityEvidence(source);
  for(const observedAt of [
    '2026-02-30T18:00:00Z',
    '2026-10-14T18:00:00+00:00',
    '2026-10-14',
    '2026-10-14T18:00:00',
    '2026-10-14T18:00:00.1234Z',
    '2026-13-14T18:00:00Z'
  ]) {
    assert.throws(()=>createEvmBlockFinalityEvidence({...source,observedAt}),/canonical UTC timestamp/);
    const forged=rehash(evidence,{observedAt});
    assert.equal(evmFinalityMatchesProof(forged,source.proof,{
      networkId:source.networkId,kind:'native-recovery'
    }),false,observedAt);
  }
  assert.equal(evmFinalityMatchesProof(
    createEvmBlockFinalityEvidence({...source,observedAt:'2026-10-14T18:00:00.123Z'}),
    source.proof,{networkId:source.networkId,kind:'native-recovery'}
  ),true);
});

test('XDC matcher rejects internally inconsistent proof binding even with unchanged finality evidence', () => {
  const source=args();
  const evidence=createEvmBlockFinalityEvidence(source);
  for(const forgedProof of [
    {...source.proof,binding:{...source.proof.binding,sha256:'d'.repeat(64)}},
    {...source.proof,binding:{...source.proof.binding,contextSha256:'bad'}},
    {...source.proof,binding:{...source.proof.binding,deploymentVerificationSha256:null}},
    {...source.proof,bindingSha256:null}
  ]) {
    assert.equal(evmFinalityMatchesProof(evidence,forgedProof,{
      networkId:source.networkId,kind:'native-recovery'
    }),false);
  }
});
