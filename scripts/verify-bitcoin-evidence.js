import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createBitcoinRecoveryDescriptor } from '../src/chains/bitcoin/descriptor.js';
import { encodePsbtV2 } from '../src/chains/bitcoin/psbt-v2.js';

const evidence = JSON.parse(await readFile(new URL('../docs/evidence/BITCOIN_CORE_31_1_DESCRIPTOR.json', import.meta.url), 'utf8'));
const descriptor = createBitcoinRecoveryDescriptor({
  ownerKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  contactKeys: [
    '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
    '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9'
  ],
  threshold: 2,
  csvBlocks: 144,
  network: 'signet'
});

assert.equal(descriptor.checkedDescriptor, evidence.policy.checkedDescriptor);
assert.equal(descriptor.address, evidence.policy.address);
assert.equal(descriptor.scriptPubKeyHex, evidence.policy.scriptPubKey);
assert.equal(descriptor.witnessScriptHex, evidence.policy.witnessScript);
assert.equal(evidence.coreResults.descriptorIsSolvable, true);
assert.equal(evidence.coreResults.restoreWalletSuccess, true);
assert.equal(evidence.execution.networkConnectionsDisabled, true);

const psbt = encodePsbtV2({
  txVersion: 2,
  txModifiable: 0,
  inputs: [{
    txid: 'ab'.repeat(32), vout: 0, sequence: 144, amountSats: '100000',
    scriptPubKey: descriptor.scriptPubKeyHex, witnessScript: descriptor.witnessScriptHex
  }],
  outputs: [{ amountSats: '99000', scriptPubKey: `0014${'11'.repeat(20)}` }]
});
assert.equal(createHash('sha256').update(psbt).digest('hex'), evidence.psbtV2.unsignedFixtureSha256);

console.log(`Verified Bitcoin Core ${evidence.tool.version} descriptor and deterministic PSBTv2 evidence.`);
