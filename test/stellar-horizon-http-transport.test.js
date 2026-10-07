import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { createStellarTestnetHorizonHttpTransport } from '../src/chains/stellar/horizon-http-transport.js';

const G = n => Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(n)).publicKey();
const HASH = 'ab'.repeat(32);

function jsonResponse(data, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return structuredClone(data); } };
}

function routedFetch(routes, calls) {
  return async (url, options = {}) => {
    calls.push({ url, options: structuredClone(options) });
    const route = routes.shift();
    assert.ok(route, `Unexpected request: ${url}`);
    assert.equal(url, route.url);
    assert.equal(options.method, route.method ?? 'GET');
    return jsonResponse(route.data, route.response);
  };
}

test('Testnet Horizon HTTP transport uses fixed official endpoints and form-encoded transaction submission', async () => {
  const calls = [];
  const routes = [
    { url:`https://horizon-testnet.stellar.org/accounts/${G(1)}`, data:{ account_id:G(1) } },
    { url:'https://horizon-testnet.stellar.org/transactions', method:'POST', data:{ hash:HASH } },
    { url:`https://horizon-testnet.stellar.org/transactions/${HASH}`, data:{ hash:HASH } },
    { url:'https://horizon-testnet.stellar.org/ledgers/501', data:{ sequence:501 } }
  ];
  const transport = createStellarTestnetHorizonHttpTransport({ fetchImpl:routedFetch(routes, calls) });
  await transport.loadAccount(G(1));
  await transport.submitTransactionXdr('AAAA+/=');
  await transport.loadTransaction(HASH.toUpperCase());
  await transport.loadLedger('501');
  assert.equal(calls[1].options.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(calls[1].options.body, 'tx=AAAA%2B%2F%3D');
  assert.equal(transport.safetyBoundary.horizonUrl, 'https://horizon-testnet.stellar.org');
  assert.equal(transport.safetyBoundary.productionNetworkAllowed, false);
  assert.equal(transport.safetyBoundary.signingKeysAccepted, false);
});

test('Horizon HTTP errors preserve result-code payloads for fail-closed submission proof normalization', async () => {
  const payload = { extras:{ result_codes:{ transaction:'txTOO_EARLY' } } };
  const transport = createStellarTestnetHorizonHttpTransport({
    fetchImpl:async () => jsonResponse(payload, { ok:false, status:400 })
  });
  await assert.rejects(
    transport.submitTransactionXdr('AAAA'),
    error => error.response?.data?.extras?.result_codes?.transaction === 'txTOO_EARLY'
  );
});

test('eligibility polling succeeds at the exact sequence-age boundary using ledger close time', async () => {
  const calls = [];
  const routes = [
    { url:`https://horizon-testnet.stellar.org/accounts/${G(1)}`, data:{ account_id:G(1), sequence:'1001', sequence_time:'1760000000', sequence_ledger:599 } },
    { url:'https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1', data:{ _embedded:{ records:[{ sequence:600, closed_at:'2025-10-09T10:13:20Z' }] } } }
  ];
  const transport = createStellarTestnetHorizonHttpTransport({ fetchImpl:routedFetch(routes, calls) });
  const result = await transport.waitUntilEligible({ sourceAccount:G(1), minAccountSequenceAge:'4800', currentSequence:'1001', recoverySequence:'5000' });
  assert.deepEqual(result, { eligible:true, observedAt:'2025-10-09T10:13:20.000Z', accountSequence:'1001', sequenceTime:'1760000000', sequenceLedger:'599', latestLedger:'600' });
});

test('eligibility polling waits between observations and then succeeds', async () => {
  const calls = [];
  const sleeps = [];
  const routes = [
    { url:`https://horizon-testnet.stellar.org/accounts/${G(1)}`, data:{ account_id:G(1), sequence:'1001', sequence_time:'1760000000', sequence_ledger:599 } },
    { url:'https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1', data:{ _embedded:{ records:[{ sequence:600, closed_at:'2025-10-09T10:13:19Z' }] } } },
    { url:`https://horizon-testnet.stellar.org/accounts/${G(1)}`, data:{ account_id:G(1), sequence:'1001', sequence_time:'1760000000', sequence_ledger:599 } },
    { url:'https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1', data:{ _embedded:{ records:[{ sequence:601, closed_at:'2025-10-09T10:13:20Z' }] } } }
  ];
  const transport = createStellarTestnetHorizonHttpTransport({ fetchImpl:routedFetch(routes, calls), sleep:async milliseconds => sleeps.push(milliseconds), pollIntervalMs:17, maxEligibilityAttempts:2 });
  const result = await transport.waitUntilEligible({ sourceAccount:G(1), minAccountSequenceAge:'4800', currentSequence:'1001', recoverySequence:'5000' });
  assert.equal(result.latestLedger, '601');
  assert.deepEqual(sleeps, [17]);
});

test('eligibility polling fails closed on account sequence drift and malformed latest-ledger responses', async () => {
  const drift = createStellarTestnetHorizonHttpTransport({ fetchImpl:routedFetch([
    { url:`https://horizon-testnet.stellar.org/accounts/${G(1)}`, data:{ account_id:G(1), sequence:'1002', sequence_time:'1760000000', sequence_ledger:599 } },
    { url:'https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1', data:{ _embedded:{ records:[{ sequence:600, closed_at:'2025-10-09T10:13:20Z' }] } } }
  ], []) });
  await assert.rejects(drift.waitUntilEligible({ sourceAccount:G(1), minAccountSequenceAge:'4800', currentSequence:'1001', recoverySequence:'5000' }), /sequence changed/);

  const malformed = createStellarTestnetHorizonHttpTransport({ fetchImpl:routedFetch([
    { url:`https://horizon-testnet.stellar.org/accounts/${G(1)}`, data:{ account_id:G(1), sequence:'1001', sequence_time:'1760000000', sequence_ledger:599 } },
    { url:'https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1', data:{ _embedded:{ records:[] } } }
  ], []) });
  await assert.rejects(malformed.waitUntilEligible({ sourceAccount:G(1), minAccountSequenceAge:'4800', currentSequence:'1001', recoverySequence:'5000' }), /exactly one ledger record/);

  const crossSnapshot = createStellarTestnetHorizonHttpTransport({ fetchImpl:routedFetch([
    { url:`https://horizon-testnet.stellar.org/accounts/${G(1)}`, data:{ account_id:G(1), sequence:'1001', sequence_time:'1760000000', sequence_ledger:601 } },
    { url:'https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1', data:{ _embedded:{ records:[{ sequence:600, closed_at:'2025-10-09T10:13:20Z' }] } } }
  ], []) });
  await assert.rejects(crossSnapshot.waitUntilEligible({ sourceAccount:G(1), minAccountSequenceAge:'4800', currentSequence:'1001', recoverySequence:'5000' }), /predates the account sequence observation/);
});

test('eligibility polling fails closed when the bounded observation window expires', async () => {
  const fetchImpl = async url => url.includes('/accounts/')
    ? jsonResponse({ account_id:G(1), sequence:'1001', sequence_time:'1760000000', sequence_ledger:599 })
    : jsonResponse({ _embedded:{ records:[{ sequence:600, closed_at:'2025-10-09T10:13:19Z' }] } });
  const transport = createStellarTestnetHorizonHttpTransport({ fetchImpl, sleep:async () => {}, maxEligibilityAttempts:2 });
  await assert.rejects(transport.waitUntilEligible({ sourceAccount:G(1), minAccountSequenceAge:'4800', currentSequence:'1001', recoverySequence:'5000' }), /not established after 2 Horizon observations/);
});

test('transport rejects malformed addresses, hashes, ledgers and unsafe polling settings before fetch', async () => {
  const transport = createStellarTestnetHorizonHttpTransport({ fetchImpl:async () => { throw new Error('must not fetch'); } });
  await assert.rejects(transport.loadAccount('GINVALID'), /valid Stellar G-address/);
  await assert.rejects(transport.loadTransaction('aa'), /32-byte hexadecimal hash/);
  await assert.rejects(transport.loadLedger('0'), /greater than zero/);
  assert.throws(() => createStellarTestnetHorizonHttpTransport({ pollIntervalMs:-1 }), /safe integer/);
  assert.throws(() => createStellarTestnetHorizonHttpTransport({ maxEligibilityAttempts:0 }), /positive safe integer/);
});
