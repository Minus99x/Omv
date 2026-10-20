import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  createInjectedStellarTestnetHorizonDriver,
  extractHorizonBalanceUnits,
  normalizeHorizonAccountSnapshot,
  normalizeHorizonFinality,
  normalizeHorizonSubmissionError,
  normalizeHorizonSubmissionSuccess
} from '../src/chains/stellar/horizon-proof-driver.js';

const KP = n => Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(n));
const G = n => KP(n).publicKey();
const T = byte => StrKey.encodePreAuthTx(Uint8Array.from({ length:32 }, () => byte));

function accountResponse(overrides = {}) {
  return {
    account_id:G(1),
    sequence:'1001',
    sequence_ledger:500,
    sequence_time:'1760000000',
    last_modified_ledger:500,
    last_modified_time:'2026-10-03T00:00:00Z',
    thresholds:{ low_threshold:1, med_threshold:1, high_threshold:1 },
    signers:[
      { key:G(1), weight:1, type:'ed25519_public_key' },
      { key:T(0xaa), weight:1, type:'preauth_tx' }
    ],
    balances:[
      {
        asset_type:'native',
        balance:'100.0000000',
        buying_liabilities:'0.0000000',
        selling_liabilities:'0.0000000'
      },
      {
        asset_type:'credit_alphanum4',
        asset_code:'USDC',
        asset_issuer:G(6),
        balance:'20.5000000',
        limit:'1000.0000000',
        buying_liabilities:'0.0000000',
        selling_liabilities:'0.0000000',
        is_authorized:true
      }
    ],
    ...overrides
  };
}

test('Horizon account normalizer separates master weight from recovery signers', () => {
  const snapshot = normalizeHorizonAccountSnapshot({
    accountResponse:accountResponse(),
    expectedAccount:G(1)
  });
  assert.equal(snapshot.account, G(1));
  assert.equal(snapshot.sequence, '1001');
  assert.equal(snapshot.masterWeight, 1);
  assert.deepEqual(snapshot.thresholds, { low:1, medium:1, high:1 });
  assert.deepEqual(snapshot.signers, [{ type:'preAuthTx', key:T(0xaa), weight:1 }]);
  assert.equal(snapshot.source, 'stellar-horizon-account');
});

test('Horizon account normalizer rejects wrong account, unknown signer type and missing master signer', () => {
  assert.throws(() => normalizeHorizonAccountSnapshot({
    accountResponse:accountResponse(),
    expectedAccount:G(2)
  }), /different account/);

  const unknown = accountResponse({
    signers:[
      { key:G(1), weight:1, type:'ed25519_public_key' },
      { key:'mystery', weight:1, type:'unknown_type' }
    ]
  });
  assert.throws(() => normalizeHorizonAccountSnapshot({ accountResponse:unknown, expectedAccount:G(1) }), /Unsupported Horizon signer type/);

  const missingMaster = accountResponse({
    signers:[{ key:T(0xaa), weight:1, type:'preauth_tx' }]
  });
  assert.throws(() => normalizeHorizonAccountSnapshot({ accountResponse:missingMaster, expectedAccount:G(1) }), /missing the master-key signer/);
});

test('Horizon balance extraction converts native and classic assets to exact 7-decimal units', () => {
  const raw = accountResponse();
  assert.equal(extractHorizonBalanceUnits({
    accountResponse:raw,
    expectedAccount:G(1),
    asset:{ type:'native', code:'XLM' }
  }), '1000000000');
  assert.equal(extractHorizonBalanceUnits({
    accountResponse:raw,
    expectedAccount:G(1),
    asset:{ type:'credit_alphanum', code:'USDC', issuer:G(6) }
  }), '205000000');
  assert.throws(() => extractHorizonBalanceUnits({
    accountResponse:raw,
    expectedAccount:G(1),
    asset:{ type:'credit_alphanum', code:'USDT', issuer:G(6) }
  }), /absent/);
});

test('Horizon success normalization binds hash, ledger and txSUCCESS', () => {
  const hash='aa'.repeat(32);
  const result = normalizeHorizonSubmissionSuccess({
    response:{ hash, successful:true, created_at:'2026-10-03T00:04:00Z', ledger:501 },
    expectedTransactionHashHex:hash
  });
  assert.deepEqual(result, {
    transactionHashHex:hash,
    observedAt:'2026-10-03T00:04:00.000Z',
    includedInLedger:true,
    successful:true,
    resultCode:'txSUCCESS',
    ledger:'501'
  });
});

test('Horizon rejected submission only becomes proof when result code is tx_bad_minseq_age_or_gap', () => {
  const hash='aa'.repeat(32);
  const error={ response:{ data:{ extras:{ result_codes:{ transaction:'tx_bad_minseq_age_or_gap' } } } } };
  const result=normalizeHorizonSubmissionError({
    error,
    expectedTransactionHashHex:hash,
    observedAt:'2026-10-03T00:00:00Z'
  });
  assert.equal(result.resultCode, 'tx_bad_minseq_age_or_gap');
  assert.equal(result.includedInLedger, false);

  const absoluteTimeBound={ response:{ data:{ extras:{ result_codes:{ transaction:'txTOO_EARLY' } } } } };
  assert.throws(() => normalizeHorizonSubmissionError({
    error:absoluteTimeBound,
    expectedTransactionHashHex:hash,
    observedAt:'2026-10-03T00:00:00Z'
  }), /unsupported proof result code/);
  const wrong={ response:{ data:{ extras:{ result_codes:{ transaction:'txBAD_SEQ' } } } } };
  assert.throws(() => normalizeHorizonSubmissionError({
    error:wrong,
    expectedTransactionHashHex:hash,
    observedAt:'2026-10-03T00:00:00Z'
  }), /unsupported proof result code/);
});

test('Horizon finality binds successful transaction to an independently fetched ledger hash', () => {
  const hash='aa'.repeat(32);
  const ledgerHash='bb'.repeat(32);
  const result=normalizeHorizonFinality({
    transactionResponse:{ hash, successful:true, ledger:501, created_at:'2026-10-03T00:04:00Z' },
    ledgerResponse:{ sequence:501, hash:ledgerHash, closed_at:'2026-10-03T00:05:00Z' },
    expectedTransactionHashHex:hash,
    expectedLedger:'501'
  });
  assert.deepEqual(result, {
    status:'finalized',
    transactionHashHex:hash,
    ledger:'501',
    ledgerHash,
    observedAt:'2026-10-03T00:05:00.000Z'
  });

  assert.throws(() => normalizeHorizonFinality({
    transactionResponse:{ hash, successful:true, ledger:501 },
    ledgerResponse:{ sequence:502, hash:ledgerHash, closed_at:'2026-10-03T00:05:00Z' },
    expectedTransactionHashHex:hash,
    expectedLedger:'501'
  }), /ledger response does not match/);
});

test('Horizon proof normalization rejects malformed hashes, timestamps, ledgers and ambiguous balances', () => {
  const hash='aa'.repeat(32);
  assert.throws(() => normalizeHorizonSubmissionSuccess({
    response:{ hash:'not-a-hash', successful:true, created_at:'2026-10-03T00:04:00Z', ledger:501 },
    expectedTransactionHashHex:hash
  }), /32-byte hexadecimal hash/);
  assert.throws(() => normalizeHorizonSubmissionSuccess({
    response:{ hash, successful:true, created_at:'not-a-time', ledger:501 },
    expectedTransactionHashHex:hash
  }), /ISO-compatible timestamp/);
  assert.throws(() => normalizeHorizonAccountSnapshot({
    accountResponse:accountResponse({ last_modified_ledger:Number.MAX_SAFE_INTEGER + 1 }),
    expectedAccount:G(1)
  }), /positive safe integer/);
  const duplicateNative=accountResponse();
  duplicateNative.balances.push({ ...duplicateNative.balances[0] });
  assert.throws(() => extractHorizonBalanceUnits({
    accountResponse:duplicateNative,
    expectedAccount:G(1),
    asset:{ type:'native' }
  }), /duplicate balance entries/);
});

test('injected Horizon proof driver is testnet-only and performs no signing', async () => {
  const hash='aa'.repeat(32);
  const ledgerHash='bb'.repeat(32);
  const submitted=[];
  const transport={
    async loadAccount(account) {
      return accountResponse({ account_id:account, signers:[
        { key:account, weight:1, type:'ed25519_public_key' },
        { key:T(0xaa), weight:1, type:'preauth_tx' }
      ] });
    },
    async submitTransactionXdr(xdr) {
      submitted.push(xdr);
      return { hash, successful:true, created_at:'2026-10-03T00:04:00Z', ledger:501 };
    },
    async loadTransaction(transactionHash) {
      assert.equal(transactionHash, hash);
      return { hash, successful:true, ledger:501, created_at:'2026-10-03T00:04:00Z' };
    },
    async loadLedger(ledger) {
      assert.equal(String(ledger), '501');
      return { sequence:501, hash:ledgerHash, closed_at:'2026-10-03T00:05:00Z' };
    },
    async waitUntilEligible(request) {
      return { eligible:true, observedAt:'2026-10-03T00:03:00Z', request };
    }
  };
  const driver=createInjectedStellarTestnetHorizonDriver({
    transport,
    clock:() => '2026-10-03T00:00:00Z'
  });
  assert.equal(driver.safetyBoundary.networkRef, 'stellar:testnet');
  assert.equal(driver.safetyBoundary.signingKeysAccepted, false);
  assert.equal(driver.safetyBoundary.signingPerformed, false);
  assert.equal(driver.safetyBoundary.productionNetworkAllowed, false);

  const snapshot=await driver.readAccountSnapshot(G(1));
  assert.equal(snapshot.masterWeight, 1);
  assert.equal(await driver.readBalanceUnits({ account:G(1), asset:{ type:'native' } }), '1000000000');
  const submit=await driver.submitEnvelope({ transactionXdr:'AAAA', expectedTransactionHashHex:hash });
  assert.equal(submit.resultCode, 'txSUCCESS');
  assert.deepEqual(submitted, ['AAAA']);
  const eligible=await driver.waitUntilEligible({ sourceAccount:G(1) });
  assert.equal(eligible.eligible, true);
  const finality=await driver.observeFinality({ transactionHashHex:hash, ledger:'501' });
  assert.equal(finality.ledgerHash, ledgerHash);

  assert.throws(() => createInjectedStellarTestnetHorizonDriver({
    transport,
    horizonUrl:'https://horizon.stellar.org'
  }), /restricted to the official Stellar Testnet Horizon endpoint/);
});

test('injected Horizon proof driver normalizes tx_bad_minseq_age_or_gap transport rejection without treating it as inclusion', async () => {
  const hash='aa'.repeat(32);
  const error={ response:{ data:{ extras:{ result_codes:{ transaction:'tx_bad_minseq_age_or_gap' } } } } };
  const transport={
    async loadAccount(){ return accountResponse(); },
    async submitTransactionXdr(){ throw error; },
    async loadTransaction(){ throw new Error('not called'); },
    async loadLedger(){ throw new Error('not called'); },
    async waitUntilEligible(){ return { eligible:true }; }
  };
  const driver=createInjectedStellarTestnetHorizonDriver({
    transport,
    clock:() => '2026-10-03T00:00:00Z'
  });
  const result=await driver.submitEnvelope({ transactionXdr:'AAAA', expectedTransactionHashHex:hash });
  assert.equal(result.resultCode, 'tx_bad_minseq_age_or_gap');
  assert.equal(result.includedInLedger, false);
});

test('Horizon finality rejects zero identifiers and conflicting transaction ledger hashes', () => {
  const hash = 'aa'.repeat(32);
  const ledgerHash = 'bb'.repeat(32);
  const transactionResponse = { hash, successful:true, ledger:501, created_at:'2026-10-03T00:04:00Z' };
  const ledgerResponse = { sequence:501, hash:ledgerHash, closed_at:'2026-10-03T00:05:00Z' };
  const normalize = (tx, ledger = ledgerResponse) => normalizeHorizonFinality({ transactionResponse:tx, ledgerResponse:ledger, expectedTransactionHashHex:tx.hash, expectedLedger:'501' });
  assert.equal(normalize({ ...transactionResponse, ledger_hash:ledgerHash }).ledgerHash, ledgerHash);
  assert.throws(() => normalize({ ...transactionResponse, ledger_hash:'cc'.repeat(32) }), /contradicts/);
  assert.throws(() => normalize({ ...transactionResponse, ledger_hash:'not-a-hash' }), /32-byte hexadecimal hash/);
  assert.throws(() => normalize({ ...transactionResponse, ledger_hash:'0'.repeat(64) }), /nonzero/);
  assert.throws(() => normalize({ ...transactionResponse, hash:'0'.repeat(64) }), /nonzero/);
  assert.throws(() => normalize(transactionResponse, { ...ledgerResponse, hash:'0'.repeat(64) }), /nonzero/);
});
