import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { buildRecoveryEnvelopeArtifact, createRecoveryEnvelopePlan, verifySignedRecoveryEnvelopeArtifact } from '../src/chains/stellar/native-recovery.js';
import {
  runStellarDisposableTestnetRecovery,
  disposableStellarContactCount,
  requireStellarTestnetTooEarly
} from '../scripts/stellar-testnet-live-disposable-recovery.js';

test('disposable Stellar Testnet proof remains disabled without explicit opt-in', async () => {
  let contacted=false;
  const fetchImpl=async()=>{contacted=true;throw new Error('network must not be contacted');};
  for(const value of [undefined,'true','YES','DISPOSABLE_FAKE_XLM_ONLY_EXTRA']){
    await assert.rejects(
      runStellarDisposableTestnetRecovery({
        env:value==null?{}:{OMEGAVAULT_STELLAR_DISPOSABLE_TESTNET:value},
        fetchImpl
      }),
      /live execution is disabled/
    );
  }
  assert.equal(contacted,false);
});

test('even with explicit disposable Testnet opt-in, no transport means no execution',async()=>{
  await assert.rejects(
    runStellarDisposableTestnetRecovery({
      env:{OMEGAVAULT_STELLAR_DISPOSABLE_TESTNET:'DISPOSABLE_FAKE_XLM_ONLY'},
      fetchImpl:null
    }),
    /requires fetch/
  );
});

test('accepts only the exact genuine Horizon early-rejection code as proof',()=>{
  const expectedHash='12'.repeat(32);
  const observedAt='2026-10-12T00:00:00Z';
  const result=requireStellarTestnetTooEarly({
    response:{ data:{ extras:{ result_codes:{ transaction:'tx_bad_minseq_age_or_gap' } } } }
  },expectedHash,observedAt);
  assert.equal(result.includedInLedger,false);
  assert.equal(result.successful,false);
  assert.equal(result.transactionHashHex,expectedHash);
  assert.equal(result.resultCode,'tx_bad_minseq_age_or_gap');
});

test('rejects bad-sequence, bad-authorization and missing proof codes',()=>{
  const expectedHash='34'.repeat(32);
  for(const code of ['txBAD_SEQ','txBAD_AUTH','txFAILED','txTOO_EARLY',null]){
    assert.throws(
      ()=>requireStellarTestnetTooEarly({
        response:{ data:{ extras:{ result_codes:{ transaction:code } } } }
      },expectedHash,'2026-10-12T00:00:00Z'),
      /Expected native Stellar minimum-sequence-age rejection/
    );
  }
});

test('disposable contacts count is fail-closed and allows only one or two ephemeral guardians',()=>{
 const base={OMEGAVAULT_STELLAR_DISPOSABLE_TESTNET:'DISPOSABLE_FAKE_XLM_ONLY'};
 assert.equal(disposableStellarContactCount(base),1);
 assert.equal(disposableStellarContactCount({...base,OMEGAVAULT_STELLAR_DISPOSABLE_CONTACTS:'2'}),2);
 for(const value of ['0','3',2,'02','true']) {
   assert.throws(()=>disposableStellarContactCount({...base,OMEGAVAULT_STELLAR_DISPOSABLE_CONTACTS:value}),/exactly one or two independent/);
 }
 assert.throws(()=>disposableStellarContactCount({OMEGAVAULT_STELLAR_DISPOSABLE_CONTACTS:'2'}),/live execution is disabled/);
});

test('exact native 2-of-2 requires two independent contact signatures',()=>{
 const kp=n=>Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(n));
 const owner=kp(21),rescue=kp(22),contactA=kp(23),contactB=kp(24);
 const plan=createRecoveryEnvelopePlan({
   vaultAccount:owner.publicKey(),rescueDestination:rescue.publicKey(),
   currentSequence:'1000',inactivitySeconds:45,
   contacts:[contactA.publicKey(),contactB.publicKey()],threshold:2,
   assets:['native'],amounts:{native:'1.0000000'}
 });
 const artifact=buildRecoveryEnvelopeArtifact(plan);
 const tx=TransactionBuilder.fromXdr(artifact.transactionXdr,Networks.TESTNET);
 tx.sign(contactA);
 const partial=verifySignedRecoveryEnvelopeArtifact({plan,artifact,signedTransactionXdr:tx.toXdr()});
 assert.equal(partial.valid,false,'one signature cannot authorize 2-of-2');
 tx.sign(contactB);
 const full=verifySignedRecoveryEnvelopeArtifact({plan,artifact,signedTransactionXdr:tx.toXdr()});
 assert.equal(full.valid,true,full.errors.join('; '));
 assert.equal(plan.signerPolicy.contactAccountSignerWeight,0);
 assert.equal(plan.signerPolicy.threshold,2);
});
