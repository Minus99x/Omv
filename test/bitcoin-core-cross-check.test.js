import test from 'node:test';
import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';

function canonicalForTest(value) {
  if (Array.isArray(value)) return value.map(canonicalForTest);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonicalForTest(value[k])]));
  return value;
}
function rehashReceipt(receipt, edit) {
  const modified=structuredClone(receipt);
  edit(modified);
  const {sha256:_old,...core}=modified;
  return {...core,sha256:createHash('sha256').update(JSON.stringify(canonicalForTest(core))).digest('hex')};
}

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createBitcoinRecoveryDescriptor } from '../src/chains/bitcoin/descriptor.js';
import { createBitcoinWitnessV0Sighash, encodePsbtV2 } from '../src/chains/bitcoin/psbt-v2.js';
import { extractBitcoinRecoveryTransaction } from '../src/chains/bitcoin/transaction-finalizer.js';
import {
  createBitcoinCoreCrossCheckEvidence,
  runBitcoinCoreCrossCheck,
  verifyBitcoinCoreCrossCheckEvidence,
  verifyBitcoinCoreCrossCheckEvidenceChain
} from '../src/chains/bitcoin/core-cross-check.js';

const key = value => Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
const pub = value => Buffer.from(secp256k1.getPublicKey(value, true)).toString('hex');
const contacts = [key(2), key(3)];
const rescueScriptPubKey = `0014${'11'.repeat(20)}`;
const descriptor = createBitcoinRecoveryDescriptor({ ownerKey:pub(key(1)), contactKeys:contacts.map(pub), threshold:2, csvBlocks:144, network:'signet' });

function transaction(inputByte = 'ab') {
  const intent = {
    txVersion:2, fallbackLocktime:0, txModifiable:0,
    inputs:[{ txid:inputByte.repeat(32), vout:0, sequence:144, amountSats:'100000', scriptPubKey:descriptor.scriptPubKeyHex, witnessScript:descriptor.witnessScriptHex }],
    outputs:[{ amountSats:'99000', scriptPubKey:rescueScriptPubKey }]
  };
  const unsigned = encodePsbtV2(intent);
  const { digest } = createBitcoinWitnessV0Sighash({ psbt:unsigned, inputIndex:0 });
  const partialSignatures = contacts.map(privateKey => ({ publicKey:pub(privateKey), signature:`${Buffer.from(secp256k1.sign(digest, privateKey, { prehash:false, lowS:true, format:'der' })).toString('hex')}01` }));
  return extractBitcoinRecoveryTransaction({ psbt:encodePsbtV2({ ...intent, inputs:[{ ...intent.inputs[0], partialSignatures }] }), descriptor, rescueScriptPubKey });
}

function observations(tx, overrides = {}) {
  return {
    node:{ chain:'signet', version:310100, subversion:'/Satoshi:31.1.0/', protocolVersion:70016 },
    decodedTransaction:{
      txid:tx.txid, hash:tx.wtxid, size:tx.bytes, vsize:tx.virtualBytes, weight:tx.weight,
      version:2, locktime:0,
      vin:[{ txid:tx.finalizerEvidence.inputs[0].txid, vout:0, scriptSig:{ hex:'' }, txinwitness:tx.witnesses[0].stackItems, sequence:144 }],
      vout:[{ value:'0.00099000', n:0, scriptPubKey:{ hex:rescueScriptPubKey } }]
    },
    mempoolResult:{
      txid:tx.txid,
      wtxid:tx.wtxid,
      allowed:true,
      vsize:tx.virtualBytes,
      fees:{
        base:'0.00001000',
        'effective-feerate':'0.00005000',
        'effective-includes':[tx.wtxid]
      }
    },
    ...overrides
  };
}

function context(sequence, observedAt, previousEvidenceSha256 = null) {
  return { sequence, observedAt, previousEvidenceSha256 };
}

test('Bitcoin Core fixture cross-check binds node, decode and mempool fee diagnostics without promotion', () => {
  const tx = transaction();
  const input = observations(tx);
  const evidence = createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input });
  assert.equal(evidence.schema, 'omegavault.bitcoin.core-cross-check-evidence.v2');
  assert.equal(evidence.decodedTransactionMatches, true);
  assert.equal(evidence.mempool.allowed, true);
  assert.equal(evidence.mempool.vsize, tx.virtualBytes);
  assert.equal(evidence.mempool.feeSats, '1000');
  assert.equal(evidence.mempool.feeDiagnosticsBound, true);
  assert.equal(evidence.extractedFeeSats, '1000');
  assert.equal(evidence.bitcoinCoreCrossCheckProven, false);
  assert.equal(evidence.broadcastPerformed, false);
  assert.equal(evidence.signetExecutionProven, false);
  assert.deepEqual(verifyBitcoinCoreCrossCheckEvidence({ evidence, transaction:tx, ...input }), { ok:true, errors:[] });
});

test('read-only Bitcoin Core driver binds actual RPC-source observations and receipt context', async () => {
  const tx = transaction();
  const input = observations(tx);
  const calls = [];
  const evidence = await runBitcoinCoreCrossCheck({
    transaction:tx,
    observationSequence:7,
    previousEvidenceSha256:'aa'.repeat(32),
    now:() => '2026-10-07T05:30:00Z',
    driver:{
      getNetworkInfo:async () => (calls.push('network'), { version:310100, subversion:'/Satoshi:31.1.0/', protocolversion:70016 }),
      getBlockchainInfo:async () => (calls.push('chain'), { chain:'signet' }),
      decodeRawTransaction:async ({ rawHex }) => (calls.push(['decode', rawHex]), input.decodedTransaction),
      testMempoolAccept:async ({ rawTransactions }) => (calls.push(['mempool', rawTransactions]), [input.mempoolResult])
    }
  });
  assert.equal(evidence.observationSource, 'bitcoin-core-rpc');
  assert.equal(evidence.bitcoinCoreCrossCheckProven, true);
  assert.deepEqual(evidence.observationContext, {
    sequence:7,
    observedAt:'2026-10-07T05:30:00Z',
    previousEvidenceSha256:'aa'.repeat(32)
  });
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'decode' && call[1] === tx.rawHex), true);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'mempool' && call[1][0] === tx.rawHex), true);
});

test('Bitcoin Core cross-check rejects wrong network or unpinned node version', () => {
  const tx = transaction();
  const input = observations(tx);
  assert.throws(() => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, node:{ ...input.node, chain:'main' } }), /Signet chain identity/);
  assert.throws(() => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, node:{ ...input.node, version:310000 } }), /pinned value/);
});

test('Bitcoin Core cross-check recomputes transaction identity and rejects raw substitution', () => {
  const tx = transaction();
  const input = observations(tx);
  const raw = Buffer.from(tx.rawHex, 'hex');
  raw[raw.length - 1] ^= 0x01;
  assert.throws(
    () => createBitcoinCoreCrossCheckEvidence({ transaction:{ ...tx, rawHex:raw.toString('hex') }, ...input }),
    /wtxid does not match rawHex/
  );
});

test('Bitcoin Core cross-check rejects decoded txid, witness and output substitution', () => {
  const tx = transaction();
  const input = observations(tx);
  assert.throws(() => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, decodedTransaction:{ ...input.decodedTransaction, txid:'00'.repeat(32) } }), /decoded txid/);
  const wrongWitness = structuredClone(input.decodedTransaction);
  wrongWitness.vin[0].txinwitness[1] = '00';
  assert.throws(() => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, decodedTransaction:wrongWitness }), /decoded witness/);
  const wrongOutput = structuredClone(input.decodedTransaction);
  wrongOutput.vout[0].value = '0.00098000';
  assert.throws(() => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, decodedTransaction:wrongOutput }), /output 0 amount/);
});

test('Bitcoin Core mempool result rejects txid or wtxid substitution', () => {
  const tx = transaction();
  const input = observations(tx);
  assert.throws(
    () => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, mempoolResult:{ ...input.mempoolResult, txid:'00'.repeat(32) } }),
    /bound to another transaction/
  );
  assert.throws(
    () => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, mempoolResult:{ ...input.mempoolResult, wtxid:'11'.repeat(32) } }),
    /bound to another transaction/
  );
});

test('Bitcoin Core mempool fee drift fails closed against deterministic extracted fee', () => {
  const tx = transaction();
  const input = observations(tx);
  const drift = structuredClone(input.mempoolResult);
  drift.fees.base = '0.00000999';
  assert.throws(
    () => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, mempoolResult:drift }),
    /base fee does not match/
  );
});

test('Bitcoin Core RPC amounts reject fractional satoshis rather than silently rounding', () => {
  const tx = transaction();
  const input = observations(tx);
  const exact = structuredClone(input);
  exact.decodedTransaction.vout[0].value = 0.00099000;
  exact.mempoolResult.fees.base = 0.00001000;
  exact.mempoolResult.fees['effective-feerate'] = 0.00005000;
  assert.equal(createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...exact }).mempool.feeSats, '1000');

  for (const [label, edit] of [
    ['decoded output', value => { value.decodedTransaction.vout[0].value = 0.000990001; }],
    ['mempool base fee', value => { value.mempoolResult.fees.base = 0.000010001; }],
    ['effective fee rate', value => { value.mempoolResult.fees['effective-feerate'] = 0.000050001; }]
  ]) {
    const altered = structuredClone(input);
    edit(altered);
    assert.throws(
      () => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...altered }),
      /fractional satoshis/,
      label
    );
  }
});

test('Bitcoin Core mempool vsize drift fails closed', () => {
  const tx = transaction();
  const input = observations(tx);
  assert.throws(
    () => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, mempoolResult:{ ...input.mempoolResult, vsize:tx.virtualBytes + 1 } }),
    /vsize does not match/
  );
});

test('Bitcoin Core effective fee diagnostics cannot be cross-wired or malformed', () => {
  const tx = transaction();
  const input = observations(tx);
  const wrongIncludes = structuredClone(input.mempoolResult);
  wrongIncludes.fees['effective-includes'] = ['22'.repeat(32)];
  assert.throws(
    () => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, mempoolResult:wrongIncludes }),
    /not bound exclusively/
  );
  const duplicateIncludes = structuredClone(input.mempoolResult);
  duplicateIncludes.fees['effective-includes'] = [tx.wtxid, tx.wtxid];
  assert.throws(
    () => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, mempoolResult:duplicateIncludes }),
    /not bound exclusively/
  );
  const malformedRate = structuredClone(input.mempoolResult);
  malformedRate.fees['effective-feerate'] = 'not-a-rate';
  assert.throws(
    () => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, mempoolResult:malformedRate }),
    /effective-feerate/
  );
});

test('Bitcoin Core rejected mempool observation is bound without claiming proof or successful diagnostics', () => {
  const tx = transaction();
  const input = observations(tx);
  const rejected = {
    txid:tx.txid,
    wtxid:tx.wtxid,
    allowed:false,
    'reject-reason':'bad-txns-inputs-missingorspent'
  };
  const evidence = createBitcoinCoreCrossCheckEvidence({
    transaction:tx, ...input,
    observationSource:'bitcoin-core-rpc',
    mempoolResult:rejected
  });
  assert.equal(evidence.mempool.allowed, false);
  assert.equal(evidence.mempool.rejectReason, 'bad-txns-inputs-missingorspent');
  assert.equal(evidence.mempool.feeDiagnosticsBound, false);
  assert.equal(evidence.mempool.feeSats, null);
  assert.equal(evidence.bitcoinCoreCrossCheckProven, false);

  assert.throws(
    () => createBitcoinCoreCrossCheckEvidence({
      transaction:tx, ...input,
      mempoolResult:{ ...rejected, vsize:tx.virtualBytes, fees:input.mempoolResult.fees }
    }),
    /must not carry successful fee\/vsize diagnostics/
  );
});

test('imported observations cannot be confused with live Bitcoin Core RPC proof', () => {
  const tx = transaction();
  const input = observations(tx);
  const imported = createBitcoinCoreCrossCheckEvidence({
    transaction:tx,
    ...input,
    observationSource:'imported-json',
    observationContext:context(1, '2026-10-07T05:20:00Z')
  });
  const live = createBitcoinCoreCrossCheckEvidence({
    transaction:tx,
    ...input,
    observationSource:'bitcoin-core-rpc',
    observationContext:context(1, '2026-10-07T05:20:00Z')
  });
  assert.equal(imported.feeDiagnosticsBound, true);
  assert.equal(imported.bitcoinCoreCrossCheckProven, false);
  assert.equal(live.bitcoinCoreCrossCheckProven, true);
  assert.notEqual(imported.sha256, live.sha256);
});

test('Bitcoin Core observation receipt chain rejects stale, replayed and reordered observations', () => {
  const tx = transaction();
  const input = observations(tx);
  const first = createBitcoinCoreCrossCheckEvidence({
    transaction:tx,
    ...input,
    observationSource:'bitcoin-core-rpc',
    observationContext:context(1, '2026-10-07T05:20:00Z')
  });
  const second = createBitcoinCoreCrossCheckEvidence({
    transaction:tx,
    ...input,
    observationSource:'bitcoin-core-rpc',
    observationContext:context(2, '2026-10-07T05:21:00Z', first.sha256)
  });
  assert.deepEqual(verifyBitcoinCoreCrossCheckEvidenceChain([first, second]), { ok:true, errors:[] });

  const stale = verifyBitcoinCoreCrossCheckEvidenceChain(
    [first, second],
    { now:'2026-10-07T05:30:00Z', maxAgeMs:60_000 }
  );
  assert.equal(stale.ok, false);
  assert.ok(stale.errors.some(value => /stale/i.test(value)));

  const replayed = verifyBitcoinCoreCrossCheckEvidenceChain([first, first]);
  assert.equal(replayed.ok, false);
  assert.ok(replayed.errors.some(value => /replay/i.test(value)));

  const reordered = verifyBitcoinCoreCrossCheckEvidenceChain([second, first]);
  assert.equal(reordered.ok, false);
  assert.ok(reordered.errors.some(value => /reordered|predecessor/i.test(value)));
});

test('Bitcoin Core observation receipt chain forbids transaction drift and provenance mixing', () => {
  const txA = transaction('ab');
  const txB = transaction('ac');
  const inputA = observations(txA);
  const inputB = observations(txB);
  const first = createBitcoinCoreCrossCheckEvidence({
    transaction:txA,
    ...inputA,
    observationSource:'bitcoin-core-rpc',
    observationContext:context(1, '2026-10-07T05:20:00Z')
  });
  const differentTransaction = createBitcoinCoreCrossCheckEvidence({
    transaction:txB,
    ...inputB,
    observationSource:'bitcoin-core-rpc',
    observationContext:context(2, '2026-10-07T05:21:00Z', first.sha256)
  });
  const drift = verifyBitcoinCoreCrossCheckEvidenceChain([first, differentTransaction]);
  assert.equal(drift.ok, false);
  assert.ok(drift.errors.some(value => /different extracted transaction/i.test(value)));

  const imported = createBitcoinCoreCrossCheckEvidence({
    transaction:txA,
    ...inputA,
    observationSource:'imported-json',
    observationContext:context(2, '2026-10-07T05:21:00Z', first.sha256)
  });
  const mixed = verifyBitcoinCoreCrossCheckEvidenceChain([first, imported]);
  assert.equal(mixed.ok, false);
  assert.ok(mixed.errors.some(value => /mixes observation provenance/i.test(value)));
});

test('tampered Bitcoin Core cross-check evidence fails closed', () => {
  const tx = transaction();
  const input = observations(tx);
  const evidence = structuredClone(createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input }));
  evidence.node.version = 310000;
  assert.equal(verifyBitcoinCoreCrossCheckEvidence({ evidence, transaction:tx, ...input }).ok, false);
});


test('Bitcoin Core receipt chain rejects digest-rewritten authority inflation for every restricted capability',()=>{
  const tx=transaction(), input=observations(tx);
  const authentic=createBitcoinCoreCrossCheckEvidence({
    transaction:tx,...input,observationSource:'offline-fixture',
    observationContext:context(1,'2026-10-07T05:20:00Z')
  });
  assert.equal(verifyBitcoinCoreCrossCheckEvidenceChain([authentic]).ok,true);
  for(const flag of ['broadcastAuthorized','broadcastPerformed','signetExecutionProven','chainPromotionAuthority']){
    const forged=rehashReceipt(authentic,receipt=>{receipt[flag]=true;});
    const result=verifyBitcoinCoreCrossCheckEvidenceChain([forged]);
    assert.equal(result.ok,false,flag+' must reject even with a matching rewritten SHA-256');
    assert.ok(result.errors.some(error=>error.includes(flag)));
  }
});

test('Bitcoin Core receipt chain rejects digest-rewritten proof and fee flag elevation',()=>{
  const tx=transaction(),input=observations(tx);
  const imported=createBitcoinCoreCrossCheckEvidence({
    transaction:tx,...input,observationSource:'imported-json',
    observationContext:context(1,'2026-10-07T05:20:00Z')
  });
  const promoted=rehashReceipt(imported,receipt=>{receipt.bitcoinCoreCrossCheckProven=true;});
  const rejected=verifyBitcoinCoreCrossCheckEvidenceChain([promoted]);
  assert.equal(rejected.ok,false);
  assert.ok(rejected.errors.some(error=>/forged Bitcoin Core cross-check provenance/.test(error)));
  const mixedFees=rehashReceipt(imported,receipt=>{receipt.mempool.feeDiagnosticsBound=false;});
  assert.equal(verifyBitcoinCoreCrossCheckEvidenceChain([mixedFees]).ok,false);
  const falseDecoded=rehashReceipt(imported,receipt=>{receipt.decodedTransactionMatches=false;});
  assert.equal(verifyBitcoinCoreCrossCheckEvidenceChain([falseDecoded]).ok,false);
});

test('Bitcoin Core receipt chain rejects digest-rewritten network/provenance and missing genesis sequence',()=>{
  const tx=transaction(), input=observations(tx);
  const first=createBitcoinCoreCrossCheckEvidence({
    transaction:tx,...input,observationSource:'bitcoin-core-rpc',
    observationContext:context(1,'2026-10-07T05:20:00Z')
  });
  for(const edit of [
    receipt=>{receipt.networkRef='bitcoin:mainnet';},
    receipt=>{receipt.node.chain='main';},
    receipt=>{receipt.observationSource='unverified-rpc';},
    receipt=>{receipt.observationContext.sequence=7;}
  ]){
    const forged=rehashReceipt(first,edit);
    assert.equal(verifyBitcoinCoreCrossCheckEvidenceChain([forged]).ok,false);
  }
  const second=createBitcoinCoreCrossCheckEvidence({
    transaction:tx,...input,observationSource:'bitcoin-core-rpc',
    observationContext:context(2,'2026-10-07T05:21:00Z',first.sha256)
  });
  assert.equal(verifyBitcoinCoreCrossCheckEvidenceChain([first,second]).ok,true);
  const forgedFirst=rehashReceipt(first,receipt=>{receipt.signetExecutionProven=true;});
  const relinkedSecond=rehashReceipt(second,receipt=>{
    receipt.observationContext.previousEvidenceSha256=forgedFirst.sha256;
  });
  const result=verifyBitcoinCoreCrossCheckEvidenceChain([forgedFirst,relinkedSecond]);
  assert.equal(result.ok,false,'coordinated receipt rehash and predecessor rewrite must still fail');
  assert.ok(result.errors.some(error=>/signetExecutionProven/.test(error)));
});


test('Bitcoin Core node identity rejects control-character subversion spoofing', () => {
  const tx = transaction();
  const input = observations(tx);
  const clean = createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input });
  assert.ok(clean.node.subversion);
  for (const subversion of ['/Satoshi:31.1.0/\nspoof', '/Satoshi:31.1.0/\u0000', '/Satoshi:31.1.0/\t']) {
    assert.throws(() => createBitcoinCoreCrossCheckEvidence({
      transaction:tx, ...input, node:{ ...input.node, subversion }
    }), /subversion.*control characters/);
  }
});


test('Bitcoin Core receipt chain rejects rehashed node subversion control characters', () => {
  const tx = transaction();
  const input = observations(tx);
  const valid = createBitcoinCoreCrossCheckEvidence({
    transaction:tx, ...input,
    observationContext:context(1, '2026-10-07T05:20:00Z')
  });
  assert.equal(verifyBitcoinCoreCrossCheckEvidenceChain([valid]).ok, true);
  for (const subversion of ['/Satoshi:31.1.0/\nforged', '/Satoshi:31.1.0/\u0000', '/Satoshi:31.1.0/\t']) {
    const forged = rehashReceipt(valid, receipt => { receipt.node.subversion = subversion; });
    const result = verifyBitcoinCoreCrossCheckEvidenceChain([forged]);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => /node subversion/.test(error)));
  }
});


test('Bitcoin Core receipt chain rejects rehashed malformed node versions', () => {
  const tx = transaction();
  const input = observations(tx);
  const valid = createBitcoinCoreCrossCheckEvidence({
    transaction:tx, ...input,
    observationContext:context(1, '2026-10-07T05:20:00Z')
  });
  assert.equal(verifyBitcoinCoreCrossCheckEvidenceChain([valid]).ok, true);
  for (const [field, value] of [
    ['version', 0], ['version', '310100'], ['version', 1.5],
    ['protocolVersion', 0], ['protocolVersion', '70016'], ['protocolVersion', -1]
  ]) {
    const forged = rehashReceipt(valid, receipt => { receipt.node[field] = value; });
    const result = verifyBitcoinCoreCrossCheckEvidenceChain([forged]);
    assert.equal(result.ok, false, `${field}=${value} must fail even after receipt rehash`);
    assert.ok(result.errors.some(error => /node version or protocol version/.test(error)));
  }
});


test('Bitcoin Core observation creation rejects unknown and missing context fields', () => {
  const tx = transaction();
  const input = observations(tx);
  const validContext = context(1, '2026-10-07T05:20:00Z');
  const valid = createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, observationContext:validContext });
  assert.equal(valid.observationContext.sequence, 1);
  for (const observationContext of [
    { ...validContext, authority:'bitcoin-core-rpc' },
    { sequence:1, observedAt:'2026-10-07T05:20:00Z' },
    { ...validContext, previousEvidenceSha256:undefined }
  ]) {
    assert.throws(() => createBitcoinCoreCrossCheckEvidence({
      transaction:tx, ...input, observationContext
    }), /observationContext/);
  }
});
