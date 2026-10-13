import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runStellarDisposableTestnetRecovery
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
