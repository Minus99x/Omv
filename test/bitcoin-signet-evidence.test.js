import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createBitcoinRecoveryDescriptor } from '../src/chains/bitcoin/descriptor.js';
import { createBitcoinWitnessV0Sighash, encodePsbtV2 } from '../src/chains/bitcoin/psbt-v2.js';
import { createBitcoinFinalizerEvidence } from '../src/chains/bitcoin/finalizer-evidence.js';
import { createBitcoinFinalTransactionEvidence } from '../src/chains/bitcoin/transaction-finalizer.js';
import {
  createBitcoinSignetObservationEvidence,
  verifyBitcoinSignetObservationArtifact,
  verifyBitcoinSignetObservationFreshness,
  runBitcoinSignetObservationProof,
  verifyBitcoinSignetObservationEvidence
} from '../src/chains/bitcoin/signet-evidence.js';

const priv = n => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
const pub = key => Buffer.from(secp256k1.getPublicKey(key, true)).toString('hex');
const owner = priv(1), a = priv(2), b = priv(3);
const rescueScriptPubKey = `0014${'11'.repeat(20)}`;
const descriptor = createBitcoinRecoveryDescriptor({
  ownerKey:pub(owner), contactKeys:[pub(a), pub(b)], threshold:2, csvBlocks:144, network:'signet'
});

function finalizerArtifacts() {
  const base = {
    txVersion:2,
    fallbackLocktime:0,
    txModifiable:0,
    inputs:[{
      txid:'ab'.repeat(32), vout:0, sequence:144, amountSats:'100000',
      scriptPubKey:descriptor.scriptPubKeyHex, witnessScript:descriptor.witnessScriptHex
    }],
    outputs:[{ amountSats:'99000', scriptPubKey:rescueScriptPubKey }]
  };
  const unsigned = encodePsbtV2(base);
  const { digest } = createBitcoinWitnessV0Sighash({ psbt:unsigned, inputIndex:0 });
  const partialSignatures = [a,b].map(key => ({
    publicKey:pub(key),
    signature:`${Buffer.from(secp256k1.sign(digest, key, { prehash:false, lowS:true, format:'der' })).toString('hex')}01`
  }));
  const signed = encodePsbtV2({
    ...base,
    inputs:[{ ...base.inputs[0], partialSignatures }]
  });
  const finalizer = createBitcoinFinalizerEvidence({ psbt:signed, descriptor, rescueScriptPubKey });
  const finalTransaction = createBitcoinFinalTransactionEvidence({ psbt:signed, descriptor, rescueScriptPubKey });
  return { finalizer, finalTransaction };
}

function observations(evidence, overrides = {}) {
  const transactionId = '0b01a21c7889debcbfb405d4bca27c1c3c3eb11979bbb516567ae0c99f517961';
  return {
    transaction:{
      transactionId,
      networkRef:'bitcoin:signet',
      confirmations:'6',
      blockHash:'ef'.repeat(32),
      blockHeight:'300000',
      observedAt:'2026-10-04T00:00:00Z',
      ...(overrides.transaction ?? {})
    },
    chainTip:{
      networkRef:'bitcoin:signet',
      blockHash:'12'.repeat(32),
      blockHeight:'300005',
      observedAt:'2026-10-04T00:01:00Z',
      ...(overrides.chainTip ?? {})
    },
    rescueUtxo:{
      txid:transactionId,
      vout:0,
      amountSats:evidence.rescueAmountSats,
      scriptPubKey:evidence.rescueScriptPubKey,
      unspent:true,
      ...(overrides.rescueUtxo ?? {})
    }
  };
}

test('Bitcoin Signet observation evidence binds confirmation depth and exact rescue UTXO', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const { transaction, chainTip, rescueUtxo } = observations(finalizer);
  const evidence = createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, transaction, chainTip, rescueUtxo });
  assert.equal(evidence.signetObservationComplete, true);
  assert.equal(evidence.observationSource, 'offline-fixture');
  assert.equal(evidence.publicSignetObservationProven, false);
  assert.equal(evidence.transaction.confirmations, '6');
  assert.equal(evidence.rescueUtxo.amountSats, '99000');
  assert.equal(evidence.immutableRescueOnChain, false);
  assert.equal(evidence.chainPromotionAuthority, false);
  assert.match(evidence.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(verifyBitcoinSignetObservationEvidence({
    evidence, finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, transaction, chainTip, rescueUtxo
  }), { ok:true, errors:[] });
});

test('Bitcoin Signet observation evidence rejects insufficient confirmations', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const { transaction, chainTip, rescueUtxo } = observations(finalizer, { transaction:{ confirmations:'5' } });
  assert.throws(
    () => createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, transaction, chainTip, rescueUtxo }),
    /required confirmation depth/i
  );
});

test('Bitcoin Signet observation evidence rejects rescue outpoint substitution', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const { transaction, chainTip, rescueUtxo } = observations(finalizer, { rescueUtxo:{ txid:'aa'.repeat(32) } });
  assert.throws(
    () => createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, transaction, chainTip, rescueUtxo }),
    /another transaction/i
  );
});

test('Bitcoin Signet observation evidence rejects rescue amount or script drift', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const amountDrift = observations(finalizer, { rescueUtxo:{ amountSats:'98999' } });
  assert.throws(
    () => createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, ...amountDrift }),
    /amount does not match/i
  );
  const scriptDrift = observations(finalizer, { rescueUtxo:{ scriptPubKey:`0014${'22'.repeat(20)}` } });
  assert.throws(
    () => createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, ...scriptDrift }),
    /script does not match/i
  );
});

test('Bitcoin Signet evidence rejects final-transaction substitution and stale chain-tip observations', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const observation = observations(finalizer);
  assert.throws(
    () => createBitcoinSignetObservationEvidence({
      finalizerEvidence:finalizer,
      finalTransactionEvidence:{ ...finalTransaction, wtxid:'aa'.repeat(32) },
      ...observation
    }),
    /digest is invalid/i
  );
  assert.throws(
    () => createBitcoinSignetObservationEvidence({
      finalizerEvidence:finalizer,
      finalTransactionEvidence:{ ...finalTransaction, txid:'aa'.repeat(32) },
      ...observation
    }),
    /digest is invalid/i
  );
  assert.throws(
    () => createBitcoinSignetObservationEvidence({
      finalizerEvidence:finalizer,
      finalTransactionEvidence:finalTransaction,
      ...observations(finalizer, { chainTip:{ observedAt:'2026-10-03T23:59:59Z' } })
    }),
    /stale relative/i
  );
  assert.throws(
    () => createBitcoinSignetObservationEvidence({
      finalizerEvidence:finalizer,
      finalTransactionEvidence:finalTransaction,
      ...observations(finalizer, { chainTip:{ blockHeight:'300006' } })
    }),
    /confirmation count does not match/i
  );
});

test('Bitcoin Signet observation runner is read-only and binds driver results', async () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const { transaction, chainTip, rescueUtxo } = observations(finalizer);
  const calls = [];
  const driver = {
    async readTransaction(request) {
      calls.push(['readTransaction', request]);
      return transaction;
    },
    async readChainTip(request) {
      calls.push(['readChainTip', request]);
      return chainTip;
    },
    async readTxOut(request) {
      calls.push(['readTxOut', request]);
      return rescueUtxo;
    }
  };
  const result = await runBitcoinSignetObservationProof({
    driver,
    finalizerEvidence:finalizer,
    finalTransactionEvidence:finalTransaction
  });
  assert.equal(result.success, true);
  assert.equal(result.kind, 'bitcoin-signet-observation-proof');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call[0]), ['readTransaction','readChainTip','readTxOut']);
  assert.equal(result.evidence.rescueUtxo.txid, transaction.transactionId);
});

test('Bitcoin Signet provenance separates fixture, imported and live RPC observations', async () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const { transaction, chainTip, rescueUtxo } = observations(finalizer);

  const imported = createBitcoinSignetObservationEvidence({
    finalizerEvidence:finalizer,
    finalTransactionEvidence:finalTransaction,
    transaction,
    chainTip,
    rescueUtxo,
    observationSource:'imported-json'
  });
  assert.equal(imported.observationSource, 'imported-json');
  assert.equal(imported.publicSignetObservationProven, false);
  assert.equal(imported.chainPromotionAuthority, false);

  const driver = {
    async readTransaction() { return transaction; },
    async readChainTip() { return chainTip; },
    async readTxOut() { return rescueUtxo; }
  };
  await assert.rejects(
    () => runBitcoinSignetObservationProof({
      driver,
      finalizerEvidence:finalizer,
      finalTransactionEvidence:finalTransaction,
      observationSource:'bitcoin-core-rpc'
    }),
    /requires a driver with bitcoin-core-rpc provenance/i
  );

  const live = await runBitcoinSignetObservationProof({
    driver:{
      ...driver, provenance:'bitcoin-core-rpc',
      async readBlockHashAtHeight() { return transaction.blockHash; },
      async readTxOut() { return {...rescueUtxo, bestBlockHash:chainTip.blockHash, confirmations:transaction.confirmations}; }
    },
    finalizerEvidence:finalizer,
    finalTransactionEvidence:finalTransaction,
    observationSource:'bitcoin-core-rpc'
  });
  assert.equal(live.evidence.observationSource, 'bitcoin-core-rpc');
  assert.equal(live.evidence.publicSignetObservationProven, false);
  assert.equal(live.evidence.chainPromotionAuthority, false);
  assert.equal(live.evidence.immutableRescueOnChain, false);
});

test('Bitcoin Signet observation runner rejects driver transaction substitution', async () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const { transaction, chainTip, rescueUtxo } = observations(finalizer);
  const driver = {
    async readTransaction() {
      return { ...transaction, transactionId:'aa'.repeat(32) };
    },
    async readChainTip() {
      return chainTip;
    },
    async readTxOut() {
      return rescueUtxo;
    }
  };
  await assert.rejects(
    () => runBitcoinSignetObservationProof({
      driver,
      finalizerEvidence:finalizer,
      finalTransactionEvidence:finalTransaction
    }),
    /different transaction/i
  );
});

test('tampered Bitcoin Signet observation evidence fails closed', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const { transaction, chainTip, rescueUtxo } = observations(finalizer);
  const evidence = structuredClone(createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, transaction, chainTip, rescueUtxo }));
  evidence.transaction.confirmations = '7';
  assert.equal(verifyBitcoinSignetObservationEvidence({
    evidence, finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, transaction, chainTip, rescueUtxo
  }).ok, false);
});


test('Bitcoin Signet integer observations reject coercible containers and unsafe numbers', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  let coercions = 0;
  const trap = { toString() { coercions++; return '6'; } };
  const invalid = [[6], ['6'], trap, new Number(6), true, false, null, undefined,
    Number.MAX_SAFE_INTEGER + 1, 1.25, -1, '6.5'];
  for (const [section, field] of [
    ['transaction', 'confirmations'],
    ['transaction', 'blockHeight'],
    ['chainTip', 'blockHeight'],
    ['rescueUtxo', 'amountSats']
  ]) {
    for (const value of invalid) {
      const evidenceInputs = observations(finalizer);
      evidenceInputs[section][field] = value;
      assert.throws(
        () => createBitcoinSignetObservationEvidence({
          finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, ...evidenceInputs
        }),
        /non-negative integer/,
        `${section}.${field}: ${typeof value}`
      );
    }
  }
  assert.equal(coercions, 0, 'Untrusted integer coercion hooks must not execute');
});

test('Bitcoin Signet integer boundaries preserve exact primitive values and enforce safe vout/depth', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const options = observations(finalizer, {
    transaction:{ confirmations:6, blockHeight:300000n },
    chainTip:{ blockHeight:300005n },
    rescueUtxo:{ amountSats:99000n }
  });
  const evidence = createBitcoinSignetObservationEvidence({
    finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction,
    ...options, minimumConfirmations:6
  });
  assert.equal(evidence.transaction.confirmations, '6');
  assert.equal(evidence.transaction.blockHeight, '300000');
  assert.equal(evidence.rescueUtxo.amountSats, '99000');

  for (const minimumConfirmations of [0, 1.5, Number.MAX_SAFE_INTEGER + 1, '6', true]) {
    assert.throws(
      () => createBitcoinSignetObservationEvidence({
        finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction,
        ...observations(finalizer), minimumConfirmations
      }),
      /positive safe integer/
    );
  }
  for (const vout of [Number.MAX_SAFE_INTEGER + 1, 0x100000000, -1, 1.5, '0', true]) {
    assert.throws(
      () => createBitcoinSignetObservationEvidence({
        finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction,
        ...observations(finalizer, { rescueUtxo:{ vout } })
      }),
      /non-negative uint32 integer/
    );
  }
});


test('Bitcoin Signet observation timestamps reject impossible calendar dates and ambiguous formats', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const invalid = [
    '2026-02-30T00:00:00Z', '2026-04-31T00:00:00Z',
    '2026-13-01T00:00:00Z', '2026-10-04T24:00:00Z',
    '2026-10-04T00:00:60Z', '2026-10-04T00:00:00+24:00',
    '2026-10-04T00:00:00+00:60', 'October 4, 2026',
    '2026-10-04T00:00:00'
  ];
  for (const [section, field] of [
    ['transaction', 'observedAt'], ['chainTip', 'observedAt']
  ]) {
    for (const value of invalid) {
      const args = observations(finalizer);
      args[section][field] = value;
      assert.throws(
        () => createBitcoinSignetObservationEvidence({
          finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, ...args
        }),
        /valid ISO-8601 timestamp/,
        `${section}.${field}: ${value}`
      );
    }
  }
});

test('Bitcoin Signet observation timestamps retain valid UTC, fractional and offset clock evidence', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const valid = observations(finalizer, {
    transaction:{ observedAt:'2026-10-04T05:30:00.123456+05:30' },
    chainTip:{ observedAt:'2026-10-04T05:31:00.123456+05:30' }
  });
  const evidence = createBitcoinSignetObservationEvidence({
    finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, ...valid
  });
  assert.equal(evidence.transaction.observedAt, valid.transaction.observedAt);
  assert.equal(evidence.chainTip.observedAt, valid.chainTip.observedAt);
  assert.equal(verifyBitcoinSignetObservationEvidence({
    evidence, finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, ...valid
  }).ok, true);
});


test('Bitcoin Signet rescue observation binds exact finalizer vout', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const valid = observations(finalizer);
  const proof = createBitcoinSignetObservationEvidence({
    finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, ...valid
  });
  assert.equal(proof.rescueUtxo.vout, 0);
  const wrongOutpoint = observations(finalizer, { rescueUtxo:{ vout:1 } });
  assert.throws(
    () => createBitcoinSignetObservationEvidence({
      finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction,
      ...wrongOutpoint
    }),
    /rescue UTXO index does not match/
  );
  assert.equal(verifyBitcoinSignetObservationEvidence({
    evidence:proof, finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction,
    ...wrongOutpoint
  }).ok, false);
});

test('Bitcoin Signet rejects individually rehashed but cross-wired final transaction records', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const input = observations(finalizer);
  const stable = value => Array.isArray(value) ? value.map(stable) :
    value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
      : value;
  for (const field of ['psbtSha256', 'descriptorPolicyDigest', 'feeSats']) {
    const modified = { ...finalTransaction, [field]: field === 'feeSats' ? '999' : '00'.repeat(32) };
    const { sha256:_old, ...core } = modified;
    modified.sha256 = createHash('sha256').update(JSON.stringify(stable(core))).digest('hex');
    assert.throws(() => createBitcoinSignetObservationEvidence({
      finalizerEvidence:finalizer, finalTransactionEvidence:modified, ...input
    }), new RegExp(field + ' does not match finalizer evidence'));
    assert.equal(verifyBitcoinSignetObservationEvidence({
      evidence:createBitcoinSignetObservationEvidence({
        finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, ...input
      }),
      finalizerEvidence:finalizer, finalTransactionEvidence:modified, ...input
    }).ok, false);
  }
});

test('Bitcoin Signet requires identical tip and inclusion hashes for one-confirmation observations', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const input = observations(finalizer, {
    transaction:{ confirmations:'1' },
    chainTip:{ blockHeight:'300000', blockHash:'ef'.repeat(32) }
  });
  const valid = createBitcoinSignetObservationEvidence({
    finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction,
    ...input, minimumConfirmations:1
  });
  assert.equal(valid.transaction.confirmations, '1');
  assert.equal(valid.chainTip.blockHash, valid.transaction.blockHash);
  const altered = observations(finalizer, {
    transaction:{ confirmations:'1' },
    chainTip:{ blockHeight:'300000', blockHash:'ab'.repeat(32) }
  });
  assert.throws(() => createBitcoinSignetObservationEvidence({
    finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction,
    ...altered, minimumConfirmations:1
  }), /chain tip hash does not match the transaction block/);
});

test('live Bitcoin Signet observation requires an independent active-chain hash lookup', async () => {
  const {finalizer,finalTransaction}=finalizerArtifacts();
  const {transaction,chainTip,rescueUtxo}=observations(finalizer);
  const driver={
    provenance:'bitcoin-core-rpc',
    async readTransaction(){return transaction;},
    async readChainTip(){return chainTip;},
    async readTxOut(){return rescueUtxo;}
  };
  await assert.rejects(()=>runBitcoinSignetObservationProof({
    driver,finalizerEvidence:finalizer,finalTransactionEvidence:finalTransaction,
    observationSource:'bitcoin-core-rpc'
  }),/readBlockHashAtHeight/);
  let rescued=false;
  await assert.rejects(()=>runBitcoinSignetObservationProof({
    driver:{...driver,async readBlockHashAtHeight({blockHeight,networkRef}){
      assert.equal(blockHeight,'300000');
      assert.equal(networkRef,'bitcoin:signet');
      return 'aa'.repeat(32);
    },async readTxOut(){rescued=true;return rescueUtxo;}},
    finalizerEvidence:finalizer,finalTransactionEvidence:finalTransaction,
    observationSource:'bitcoin-core-rpc'
  }),/not on the active chain/);
  assert.equal(rescued,false,'unanchored transaction must fail before reading rescue output');
  const result=await runBitcoinSignetObservationProof({
    driver:{
      ...driver,async readBlockHashAtHeight(){return transaction.blockHash;},
      async readTxOut(){return {...rescueUtxo,bestBlockHash:chainTip.blockHash,confirmations:transaction.confirmations};}
    },
    finalizerEvidence:finalizer,finalTransactionEvidence:finalTransaction,
    observationSource:'bitcoin-core-rpc'
  });
  assert.equal(result.evidence.publicSignetObservationProven, false);
});

test('Bitcoin Signet saved proof artifact independently recomputes internal identities and authority flags', () => {
  const {finalizer,finalTransaction}=finalizerArtifacts();
  const input=observations(finalizer);
  const artifact=createBitcoinSignetObservationEvidence({
    finalizerEvidence:finalizer,finalTransactionEvidence:finalTransaction,...input
  });
  assert.equal(verifyBitcoinSignetObservationArtifact({
    evidence:artifact,finalizerEvidence:finalizer,finalTransactionEvidence:finalTransaction
  }).ok,true);
  for(const mutate of [
    v=>{v.publicSignetObservationProven=true;},
    v=>{v.chainPromotionAuthority=true;},
    v=>{v.rescueUtxo.amountSats='1';},
    v=>{v.chainTip.blockHeight='300006';},
    v=>{v.transaction.blockHash='00'.repeat(32);},
    v=>{v.sha256='00'.repeat(32);}
  ]) {
    const forged=structuredClone(artifact);mutate(forged);
    assert.equal(verifyBitcoinSignetObservationArtifact({
      evidence:forged,finalizerEvidence:finalizer,finalTransactionEvidence:finalTransaction
    }).ok,false);
  }
  assert.equal(verifyBitcoinSignetObservationArtifact({
    evidence:null,finalizerEvidence:finalizer,finalTransactionEvidence:finalTransaction
  }).ok,false);
});

test('live Signet runner refuses mixed-tip, depth-drift and in-flight chain reorganization', async () => {
  const {finalizer,finalTransaction}=finalizerArtifacts();
  const {transaction,chainTip,rescueUtxo}=observations(finalizer);
  const base={
    provenance:'bitcoin-core-rpc',
    async readTransaction(){return transaction;},
    async readBlockHashAtHeight(){return transaction.blockHash;},
    async readChainTip(){return chainTip;},
    async readTxOut(){return {...rescueUtxo,bestBlockHash:chainTip.blockHash,confirmations:transaction.confirmations};}
  };
  async function attempt(driver){
    return runBitcoinSignetObservationProof({
      driver,finalizerEvidence:finalizer,finalTransactionEvidence:finalTransaction,
      observationSource:'bitcoin-core-rpc'
    });
  }
  await assert.rejects(()=>attempt({
    ...base,async readTxOut(){return {...rescueUtxo,bestBlockHash:'aa'.repeat(32),confirmations:'6'};}
  }),/UTXO best block differs/);
  await assert.rejects(()=>attempt({
    ...base,async readTxOut(){return {...rescueUtxo,bestBlockHash:chainTip.blockHash,confirmations:'5'};}
  }),/UTXO confirmation depth differs/);
  let reads=0;
  await assert.rejects(()=>attempt({
    ...base,async readChainTip(){
      return ++reads===1?chainTip:{...chainTip,blockHash:'bb'.repeat(32)};
    }
  }),/tip changed during read-only proof/);
  reads=0;
  await assert.rejects(()=>attempt({
    ...base,async readChainTip(){
      return ++reads===1?chainTip:{...chainTip,observedAt:'2026-10-03T23:59:59Z'};
    }
  }),/timestamp regressed/);
  const ok=await attempt(base);
  assert.equal(ok.evidence.publicSignetObservationProven, false);
});


test('Bitcoin Core provenance label alone cannot manufacture independently proven public inclusion', () => {
  const {finalizer,finalTransaction}=finalizerArtifacts();
  const data=observations(finalizer);
  const forged=createBitcoinSignetObservationEvidence({
    finalizerEvidence:finalizer,finalTransactionEvidence:finalTransaction,
    ...data,observationSource:'bitcoin-core-rpc'
  });
  assert.equal(forged.observationSource,'bitcoin-core-rpc');
  assert.equal(forged.publicSignetObservationProven,false);
  assert.match(forged.authorityBoundary,/not independently authenticated inclusion/i);
  assert.equal(verifyBitcoinSignetObservationArtifact({
    evidence:forged,finalizerEvidence:finalizer,
    finalTransactionEvidence:finalTransaction
  }).ok,true);
  const attacker=structuredClone(forged);
  attacker.publicSignetObservationProven=true;
  const {sha256,...core}=attacker;
  attacker.sha256=createHash('sha256').update(JSON.stringify(stable(core))).digest('hex');
  assert.equal(verifyBitcoinSignetObservationArtifact({
    evidence:attacker,finalizerEvidence:finalizer,
    finalTransactionEvidence:finalTransaction
  }).ok,false,'rewriting the digest cannot forge a public chain proof');
});

test('Bitcoin Signet freshness guard rejects stale, future and digest-tampered observations',()=>{
  const {finalizer,finalTransaction}=finalizerArtifacts();
  const observation=createBitcoinSignetObservationEvidence({
    finalizerEvidence:finalizer,finalTransactionEvidence:finalTransaction,
    ...observations(finalizer)
  });
  const check=(now,maxAgeMs=120000,evidence=observation)=>
    verifyBitcoinSignetObservationFreshness({evidence,now,maxAgeMs});
  assert.deepEqual(check('2026-10-04T00:01:15Z'),{ok:true,errors:[]});
  assert.equal(check('2026-10-04T00:02:05Z').ok,false);
  assert.match(check('2026-10-04T00:02:05Z').errors[0],/maximum age/);
  assert.match(check('2026-10-04T00:00:30Z').errors[0],/future/);
  assert.equal(check('2026-10-04T00:01:15Z',-1).ok,false);
  const altered=structuredClone(observation);
  altered.transaction.observedAt='2026-10-04T00:01:14Z';
  assert.match(check('2026-10-04T00:01:15Z',120000,altered).errors[0],/self-digest/);
  const upgraded=structuredClone(observation);
  upgraded.publicSignetObservationProven=true;
  const {sha256,...core}=upgraded;
  upgraded.sha256=createHash('sha256').update(JSON.stringify(stable(core))).digest('hex');
  assert.match(check('2026-10-04T00:01:15Z',120000,upgraded).errors[0],/authority claim/);
});
