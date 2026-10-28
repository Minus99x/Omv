import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  buildFeeBumpEnvelopeArtifact,
  buildHeartbeatEnvelopeArtifact,
  buildRecoveryEnvelopeArtifact,
  createFeeBumpSponsorPlan,
  createHeartbeatPlan,
  createRecoveryEnvelopePlan
} from '../src/chains/stellar/native-recovery.js';
import { createStellarTestnetExecutionInputManifest } from '../src/chains/stellar/execution-input-manifest.js';
import { createStellarTestnetHorizonProofDriver } from '../src/chains/stellar/horizon-proof-driver.js';
import { runStellarTestnetRecoveryProof } from '../src/chains/stellar/recovery-test-runner.js';

const KP = n => Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(n));
const G = n => KP(n).publicKey();
const T = byte => StrKey.encodePreAuthTx(new Uint8Array(32).fill(byte));

function executionInputs() {
  const recoveryPlan = createRecoveryEnvelopePlan({
    vaultAccount:G(1), rescueDestination:G(2), currentSequence:'1000', inactivitySeconds:2,
    contacts:[G(3), G(4)], threshold:2, assets:['native', { code:'USDC', issuer:G(6) }],
    amounts:{ native:'10', [`USDC:${G(6)}`]:'20.5' }
  });
  const recoveryArtifact = buildRecoveryEnvelopeArtifact(recoveryPlan);
  const recovery = TransactionBuilder.fromXdr(recoveryArtifact.transactionXdr, recoveryPlan.networkPassphrase);
  recovery.sign(KP(3), KP(4));
  const signedRecoveryTransactionXdr = recovery.toXdr();
  const heartbeatPlan = createHeartbeatPlan({ vaultAccount:G(1), currentSequence:'1001' });
  const heartbeatArtifact = buildHeartbeatEnvelopeArtifact({ vaultAccount:G(1), currentSequence:'1001' });
  const heartbeat = TransactionBuilder.fromXdr(heartbeatArtifact.transactionXdr, heartbeatArtifact.networkPassphrase);
  heartbeat.sign(KP(1));
  const signedHeartbeatTransactionXdr = heartbeat.toXdr();
  const feeBumpPlan = createFeeBumpSponsorPlan({ feeAccount:G(7), innerEnvelopeHash:recoveryArtifact.transactionHashHex, maxFeeStroops:'1000' });
  const feeBumpArtifact = buildFeeBumpEnvelopeArtifact({ recoveryPlan, recoveryArtifact, signedRecoveryTransactionXdr, feeBumpPlan, baseFeeStroops:'200' });
  const feeBump = TransactionBuilder.fromXdr(feeBumpArtifact.feeBumpTransactionXdr, feeBumpArtifact.networkPassphrase);
  feeBump.sign(KP(7));
  const result = { recoveryPlan, recoveryArtifact, signedRecoveryTransactionXdr, heartbeatPlan, heartbeatArtifact, signedHeartbeatTransactionXdr, feeBumpPlan, feeBumpArtifact, signedFeeBumpTransactionXdr:feeBump.toXdr() };
  return { ...result, executionManifest:createStellarTestnetExecutionInputManifest(result) };
}

function response(data, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return structuredClone(data); } };
}

function accountState(inputs, {
  sequence, recovered = false, vault = true,
  sellingLiabilities = '0.0000000', buyingLiabilities = '0.0000000',
  nativeSellingLiabilities = '0.0000000', nativeBalance = null
}) {
  return {
    account_id:vault ? inputs.recoveryPlan.sourceAccount : inputs.recoveryPlan.rescueDestination,
    sequence:String(sequence),
    sequence_ledger:recovered ? 501 : 500,
    sequence_time:String(Date.parse('2026-10-03T00:02:00Z') / 1000),
    last_modified_ledger:recovered ? 501 : 500,
    last_modified_time:recovered ? '2026-10-03T00:04:00Z' : '2026-10-03T00:02:00Z',
    subentry_count:2, num_sponsoring:0, num_sponsored:0,
    thresholds:{ low_threshold:1, med_threshold:1, high_threshold:1 },
    signers:recovered ? [{ key:inputs.recoveryPlan.sourceAccount, weight:1, type:'ed25519_public_key' }] : [
      { key:inputs.recoveryPlan.sourceAccount, weight:1, type:'ed25519_public_key' },
      { key:inputs.recoveryArtifact.preAuthTxSigner, weight:1, type:'preauth_tx' }
    ],
    balances:[
      { asset_type:'native', balance:nativeBalance ?? (vault ? (recovered ? '90.0000000' : '100.0000000') : (recovered ? '15.0000000' : '5.0000000')),selling_liabilities:nativeSellingLiabilities },
      { asset_type:'credit_alphanum4', asset_code:'USDC', asset_issuer:G(6),
        is_authorized:true, limit:'1000.0000000', selling_liabilities:sellingLiabilities,
        buying_liabilities:buyingLiabilities,
        balance:vault ? (recovered ? '29.5000000' : '50.0000000') : (recovered ? '21.5000000' : '1.0000000') }
    ]
  };
}

function scriptedHorizon(inputs, {
  vaultSellingLiabilities='0.0000000', rescueBuyingLiabilities='0.0000000',
  vaultNativeSellingLiabilities='0.0000000', vaultNativeBalance=null
}={}) {
  const calls = [];
  let vaultReads = 0;
  let rescueReads = 0;
  let submissions = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method:options.method, body:options.body ?? null });
    if (url.endsWith(`/accounts/${inputs.recoveryPlan.sourceAccount}`)) {
      vaultReads += 1;
      if (vaultReads === 1) return response(accountState(inputs, { sequence:'1001', sellingLiabilities:vaultSellingLiabilities, nativeSellingLiabilities:vaultNativeSellingLiabilities,nativeBalance:vaultNativeBalance }));
      if (vaultReads <= 6) return response(accountState(inputs, { sequence:'1003', sellingLiabilities:vaultSellingLiabilities, nativeSellingLiabilities:vaultNativeSellingLiabilities,nativeBalance:vaultNativeBalance }));
      return response(accountState(inputs, { sequence:inputs.recoveryPlan.sequence.recoverySequence, recovered:true, sellingLiabilities:vaultSellingLiabilities, nativeSellingLiabilities:vaultNativeSellingLiabilities,nativeBalance:vaultNativeBalance }));
    }
    if (url.endsWith(`/accounts/${inputs.recoveryPlan.rescueDestination}`)) {
      rescueReads += 1;
      return response(accountState(inputs, {
        sequence:'77', recovered:rescueReads > 2, vault:false,
        buyingLiabilities:rescueBuyingLiabilities
      }));
    }
    if (url.endsWith('/ledgers?order=desc&limit=1')) {
      return response({ _embedded:{ records:[{ sequence:600, hash:'cc'.repeat(32), closed_at:'2026-10-03T00:03:00Z',base_reserve_in_stroops:'5000000' }] } });
    }
    if (url.endsWith('/transactions') && options.method === 'POST') {
      submissions += 1;
      const xdr = new URLSearchParams(options.body).get('tx');
      if (submissions === 1 || submissions === 3) {
        assert.equal(xdr, inputs.signedRecoveryTransactionXdr);
        return response({ extras:{ result_codes:{ transaction:'tx_bad_minseq_age_or_gap' } } }, { ok:false, status:400 });
      }
      if (submissions === 2) {
        assert.equal(xdr, inputs.signedHeartbeatTransactionXdr);
        return response({ hash:inputs.heartbeatArtifact.transactionHashHex, successful:true, created_at:'2026-10-03T00:01:00Z', ledger:500 });
      }
      assert.equal(xdr, inputs.signedFeeBumpTransactionXdr);
      return response({ hash:inputs.feeBumpArtifact.feeBumpTransactionHashHex, successful:true, created_at:'2026-10-03T00:04:00Z', ledger:501 });
    }
    if (url.endsWith(`/transactions/${inputs.feeBumpArtifact.feeBumpTransactionHashHex}`)) {
      return response({ hash:inputs.feeBumpArtifact.feeBumpTransactionHashHex, successful:true, created_at:'2026-10-03T00:04:00Z', ledger:501 });
    }
    if (url.endsWith('/ledgers/501')) {
      return response({ sequence:501, hash:'dd'.repeat(32), closed_at:'2026-10-03T00:05:00Z' });
    }
    throw new Error(`Unexpected scripted Horizon request: ${url}`);
  };
  return { fetchImpl, calls, counts:() => ({ vaultReads, rescueReads, submissions }) };
}

test('composed Testnet Horizon driver completes the full recovery proof against scripted HTTP evidence', async () => {
  const inputs = executionInputs();
  const horizon = scriptedHorizon(inputs);
  const rejectionTimes = ['2026-10-03T00:00:00Z', '2026-10-03T00:02:00Z'];
  const driver = createStellarTestnetHorizonProofDriver({
    fetchImpl:horizon.fetchImpl,
    sleep:async () => {},
    pollIntervalMs:0,
    maxEligibilityAttempts:1,
    clock:() => rejectionTimes.shift()
  });
  const proof = await runStellarTestnetRecoveryProof({ ...inputs, driver });
  assert.equal(proof.success, true);
  assert.equal(proof.evidenceBundle.sha256.length, 64);
  assert.equal(proof.evidenceBundle.balanceMovements.length, 2);
  assert.equal(proof.evidenceBundle.observationSource, 'injected-driver');
  assert.equal(proof.evidenceBundle.publicTestnetEvidenceReady, false);
  assert.deepEqual(horizon.counts(), { vaultReads:9, rescueReads:4, submissions:4 });
  assert.equal(driver.safetyBoundary.networkRef, 'stellar:testnet');
  assert.equal(driver.safetyBoundary.signingPerformed, false);
  assert.equal(driver.safetyBoundary.productionNetworkAllowed, false);
  assert.equal(horizon.calls.some(call => call.url === 'https://horizon.stellar.org'), false);
});

test('composed driver propagates malformed Horizon proof data and cannot silently complete', async () => {
  const inputs = executionInputs();
  const horizon = scriptedHorizon(inputs);
  let changed = false;
  const driver = createStellarTestnetHorizonProofDriver({
    fetchImpl:async (url, options) => {
      const result = await horizon.fetchImpl(url, options);
      if (!changed && url.endsWith('/transactions') && options.method === 'POST') {
        changed = true;
        return response({ extras:{ result_codes:{ transaction:'txBAD_SEQ' } } }, { ok:false, status:400 });
      }
      return result;
    },
    clock:() => '2026-10-03T00:00:00Z'
  });
  await assert.rejects(() => runStellarTestnetRecoveryProof({ ...inputs, driver }), /unsupported proof result code: txBAD_SEQ/);
});

test('composed Horizon recovery refuses locked vault assets and insufficient receiving trustline before final POST', async () => {
  for(const [state,expected] of [
    [{vaultSellingLiabilities:'40.0000000'},/net of selling liabilities/],
    [{rescueBuyingLiabilities:'980.0000000'},/net of buying liabilities/]
  ]) {
    const inputs=executionInputs(), horizon=scriptedHorizon(inputs,state);
    const rejectionTimes=['2026-10-03T00:00:00Z','2026-10-03T00:02:00Z'];
    const driver=createStellarTestnetHorizonProofDriver({
      fetchImpl:horizon.fetchImpl,sleep:async()=>{},pollIntervalMs:0,
      maxEligibilityAttempts:1,clock:()=>rejectionTimes.shift()
    });
    await assert.rejects(
      runStellarTestnetRecoveryProof({...inputs,driver}),expected
    );
    assert.equal(horizon.counts().submissions,3,
      'only the two expected early rejections and owner heartbeat should reach Horizon');
  }
});

test('Horizon native recovery refuses insufficient reserve or XLM selling liabilities before final POST',async()=>{
 for(const state of [
  {vaultNativeBalance:'11.0000000',vaultNativeSellingLiabilities:'0.0000000'},
  {vaultNativeBalance:'14.0000000',vaultNativeSellingLiabilities:'3.0000000'}
 ]){
  const inputs=executionInputs(),horizon=scriptedHorizon(inputs,state);
  const clockTimes=['2026-10-03T00:00:00Z','2026-10-03T00:02:00Z'];
  const driver=createStellarTestnetHorizonProofDriver({
   fetchImpl:horizon.fetchImpl,sleep:async()=>{},pollIntervalMs:0,
   maxEligibilityAttempts:1,clock:()=>clockTimes.shift()
  });
  await assert.rejects(runStellarTestnetRecoveryProof({...inputs,driver}),/net of account reserve/);
  assert.equal(horizon.counts().submissions,3,'ineligible native recovery never reaches final POST');
 }
});
