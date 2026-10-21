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


test('Horizon transport times out stalled requests and aborts the active fetch signal', async () => {
  let signal, calls = 0;
  const transport = createStellarTestnetHorizonHttpTransport({
    requestTimeoutMs: 8,
    fetchImpl: async (_url, options) => {
      calls++;
      signal = options.signal;
      return new Promise(() => {}); // Deliberately noncooperative network adapter.
    }
  });
  await assert.rejects(transport.loadAccount(G(1)), /request timed out; result is unconfirmed/);
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
});

test('Horizon transport enforces deadline across a stalled JSON response body', async () => {
  let calls=0, signal;
  const transport = createStellarTestnetHorizonHttpTransport({
    requestTimeoutMs: 8,
    fetchImpl: async (_url, options) => {
      calls++;
      signal=options.signal;
      return { ok:true, status:200, async json(){return new Promise(()=>{});} };
    }
  });
  await assert.rejects(transport.loadAccount(G(1)), /request timed out; result is unconfirmed/);
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
});

test('timed-out Horizon transaction submission is reported unconfirmed, never retried automatically', async () => {
  let count=0, options;
  const transport=createStellarTestnetHorizonHttpTransport({
    requestTimeoutMs: 8,
    fetchImpl:async (_url, opts)=>{
      count++;options=opts;
      return new Promise(()=>{});
    }
  });
  await assert.rejects(transport.submitTransactionXdr('AAAA+/='), error =>
    error.code === 'STELLAR_HORIZON_TIMEOUT' &&
    /request timed out; result is unconfirmed/.test(error.message)
  );
  assert.equal(count,1);
  assert.equal(options.method,'POST');
  assert.equal(options.redirect,'error');
  assert.equal(options.signal.aborted,true);
});

test('Horizon request timeout accepts only positive safe millisecond deadlines', () => {
  for (const timeout of [0,-1,1.5,Number.POSITIVE_INFINITY,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(
      () => createStellarTestnetHorizonHttpTransport({requestTimeoutMs:timeout}),
      /requestTimeoutMs must be a positive safe integer/
    );
  }
});


test('eligibility polling rejects impossible ledger close dates rather than normalizing them', async () => {
  for (const closedAt of ['2025-02-30T10:13:20Z', '2025-02-29T10:13:20Z', '2025-04-31T10:13:20Z', '2025-13-01T10:13:20Z']) {
    const transport = createStellarTestnetHorizonHttpTransport({ fetchImpl:routedFetch([
      { url:`https://horizon-testnet.stellar.org/accounts/${G(1)}`, data:{ account_id:G(1), sequence:'1001', sequence_time:'1760000000', sequence_ledger:599 } },
      { url:'https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1', data:{ _embedded:{ records:[{ sequence:600, closed_at:closedAt }] } } }
    ], []) });
    await assert.rejects(transport.waitUntilEligible({ sourceAccount:G(1), minAccountSequenceAge:'4800', currentSequence:'1001', recoverySequence:'5000' }), /valid UTC timestamp/, closedAt);
  }
});

test('Horizon transport rejects unsafe numeric ledger identifiers before fetching', async () => {
  let calls = 0;
  const transport = createStellarTestnetHorizonHttpTransport({
    fetchImpl: async () => { calls++; throw new Error('unexpected fetch'); }
  });
  for (const value of [Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, 1.5]) {
    await assert.rejects(transport.loadLedger(value), /exact integer string or safe integer number/);
  }
  assert.equal(calls, 0);
});

const eligibilityArguments = () => ({
  sourceAccount: G(1), minAccountSequenceAge: '4800',
  currentSequence: '1001', recoverySequence: '5000'
});

test('Horizon eligibility rejects unsafe numeric arguments before any observation', async () => {
  let calls = 0;
  const transport = createStellarTestnetHorizonHttpTransport({
    fetchImpl: async () => { calls++; throw new Error('unexpected fetch'); }
  });
  for (const field of ['currentSequence', 'recoverySequence', 'minAccountSequenceAge']) {
    await assert.rejects(transport.waitUntilEligible({
      ...eligibilityArguments(), [field]: Number.MAX_SAFE_INTEGER + 1
    }), new RegExp(field + ' must use an exact integer string'));
  }
  assert.equal(calls, 0);
});

test('Horizon eligibility rejects unsafe numeric evidence fields instead of accepting rounded values', async () => {
  for (const field of ['sequence', 'sequence_time', 'sequence_ledger', 'latestLedger']) {
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    const account = {
      account_id: G(1), sequence: '1001', sequence_time: '1760000000', sequence_ledger: 599
    };
    const ledger = { sequence: 600, closed_at: '2025-10-09T10:13:20Z' };
    if (field === 'latestLedger') ledger.sequence = unsafe;
    else account[field] = unsafe;
    const transport = createStellarTestnetHorizonHttpTransport({
      fetchImpl: async url => jsonResponse(url.includes('/accounts/')
        ? account : { _embedded: { records: [ledger] } })
    });
    const args = eligibilityArguments();
    if (field === 'sequence') {
      // Previously these rounded values compared equal and yielded eligible:true.
      args.currentSequence = String(unsafe);
      args.recoverySequence = '9007199254740993';
    }
    await assert.rejects(transport.waitUntilEligible(args),
      /exact integer string or safe integer number/, field);
  }
});

test('Horizon eligibility preserves exact large decimal sequences and safe numeric observations', async () => {
  for (const sequence of ['9007199254740993', 1001]) {
    const account = {
      account_id: G(1), sequence, sequence_time: 1760000000, sequence_ledger: 599
    };
    const transport = createStellarTestnetHorizonHttpTransport({
      fetchImpl: async url => jsonResponse(url.includes('/accounts/') ? account : {
        _embedded: { records: [{ sequence: 600, closed_at: '2025-10-09T10:13:20Z' }] }
      })
    });
    const result = await transport.waitUntilEligible({
      ...eligibilityArguments(), currentSequence: String(sequence),
      recoverySequence: '9007199254740994'
    });
    assert.equal(result.eligible, true);
    assert.equal(result.accountSequence, String(sequence));
    assert.equal(result.sequenceTime, '1760000000');
  }
});

test('Horizon integer request arguments reject coercible containers before fetch', async () => {
  let calls = 0, coercions = 0;
  const trap = { toString() { coercions++; return '1001'; } };
  const transport = createStellarTestnetHorizonHttpTransport({
    fetchImpl: async () => { calls++; throw new Error('unexpected fetch'); }
  });
  for (const value of [[1001], ['1001'], trap, new String('1001'), true, null, undefined]) {
    await assert.rejects(transport.loadLedger(value), /primitive integer value/);
    for (const field of ['currentSequence', 'recoverySequence', 'minAccountSequenceAge']) {
      await assert.rejects(transport.waitUntilEligible({
        ...eligibilityArguments(), [field]: value
      }), /primitive integer value/);
    }
  }
  assert.equal(calls, 0);
  assert.equal(coercions, 0);
});

test('Horizon integer observations reject arrays in every eligibility evidence field', async () => {
  for (const field of ['sequence', 'sequence_time', 'sequence_ledger', 'latestLedger']) {
    const account = {
      account_id: G(1), sequence: '1001', sequence_time: '1760000000', sequence_ledger: 599
    };
    const ledger = { sequence: 600, closed_at: '2025-10-09T10:13:20Z' };
    if (field === 'latestLedger') ledger.sequence = [600];
    else account[field] = [account[field]];
    const transport = createStellarTestnetHorizonHttpTransport({
      fetchImpl: async url => jsonResponse(url.includes('/accounts/')
        ? account : { _embedded: { records: [ledger] } })
    });
    await assert.rejects(transport.waitUntilEligible(eligibilityArguments()),
      /primitive integer value/, field);
  }
});

test('Horizon ledger requests preserve integer primitive compatibility', async () => {
  const urls = [];
  const transport = createStellarTestnetHorizonHttpTransport({
    fetchImpl: async url => { urls.push(url); return jsonResponse({ sequence: 501 }); }
  });
  for (const value of [501, '501', 501n]) await transport.loadLedger(value);
  assert.deepEqual(urls, Array(3).fill('https://horizon-testnet.stellar.org/ledgers/501'));
});

test('Horizon polling settings reject coercible containers and noncanonical strings', () => {
  let coercions = 0, calls = 0;
  const trap = { valueOf() { coercions++; return 1; }, toString() { coercions++; return '1'; } };
  for (const field of ['pollIntervalMs', 'requestTimeoutMs', 'maxEligibilityAttempts']) {
    for (const value of [true, false, null, [], [1], {}, trap, new Number(1), '', ' ', ' 1 ', '+1', '01', '1e2', '0x10', '1.0']) {
      assert.throws(() => createStellarTestnetHorizonHttpTransport({
        [field]: value, fetchImpl: async () => { calls++; }
      }), /safe integer/, field);
    }
  }
  assert.equal(coercions, 0);
  assert.equal(calls, 0);
});

test('Horizon timer settings reject the first overflow and retain exact upper bounds', () => {
  for (const field of ['pollIntervalMs', 'requestTimeoutMs']) {
    for (const value of [2147483648, '2147483648', 2147483648n, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => createStellarTestnetHorizonHttpTransport({ [field]: value }),
        /must not exceed 2147483647 milliseconds/, field);
    }
    for (const value of [2147483647, '2147483647', 2147483647n]) {
      assert.doesNotThrow(() => createStellarTestnetHorizonHttpTransport({ [field]: value }));
    }
  }
  assert.doesNotThrow(() => createStellarTestnetHorizonHttpTransport({ pollIntervalMs: 0 }));
  assert.throws(() => createStellarTestnetHorizonHttpTransport({ requestTimeoutMs: 0 }), /positive safe integer/);
});

test('Horizon validates primitive polling settings while preserving bounded attempt behavior', async () => {
  for (const value of [2, '2', 2n]) {
    let calls = 0;
    const sleeps = [];
    const transport = createStellarTestnetHorizonHttpTransport({
      maxEligibilityAttempts: value, pollIntervalMs: '2147483647', requestTimeoutMs: 2147483647,
      sleep: async delay => { sleeps.push(delay); },
      fetchImpl: async url => {
        calls++;
        return jsonResponse(url.includes('/accounts/')
          ? { account_id: G(1), sequence: '1001', sequence_time: '1760000000', sequence_ledger: 599 }
          : { _embedded: { records: [{ sequence: 600, closed_at: '2025-10-09T10:13:19Z' }] } });
      }
    });
    await assert.rejects(transport.waitUntilEligible(eligibilityArguments()), /not established after 2 Horizon observations/);
    assert.equal(calls, 4);
    assert.deepEqual(sleeps, [2147483647]);
  }
});
