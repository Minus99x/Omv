import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runStellarDisposableTestnetRecovery,
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
    response:{ data:{ extras:{ result_codes:{ transaction:'txTOO_EARLY' } } } }
  },expectedHash,observedAt);
  assert.equal(result.includedInLedger,false);
  assert.equal(result.successful,false);
  assert.equal(result.transactionHashHex,expectedHash);
  assert.equal(result.resultCode,'txTOO_EARLY');
});

test('rejects bad-sequence, bad-authorization and missing proof codes',()=>{
  const expectedHash='34'.repeat(32);
  for(const code of ['txBAD_SEQ','txBAD_AUTH','txFAILED',null]){
    assert.throws(
      ()=>requireStellarTestnetTooEarly({
        response:{ data:{ extras:{ result_codes:{ transaction:code } } } }
      },expectedHash,'2026-10-12T00:00:00Z'),
      /unsupported proof result code/
    );
  }
});
