import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  createInjectedStellarTestnetHorizonDriver,
  createStellarTestnetHorizonProofDriver,
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
  }), /valid UTC timestamp/);
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


test('indeterminate Horizon timeout cannot be normalized into a confirmed recovery rejection', async () => {
  let submissions = 0;
  const timeout = Object.assign(
    new Error('Stellar Testnet Horizon request timed out; result is unconfirmed.'),
    { code:'STELLAR_HORIZON_TIMEOUT' }
  );
  const transport = {
    async loadAccount(){ throw new Error('not called'); },
    async submitTransactionXdr(){
      submissions++;
      throw timeout;
    },
    async loadTransaction(){ throw new Error('not called'); },
    async loadLedger(){ throw new Error('not called'); },
    async waitUntilEligible(){ throw new Error('not called'); }
  };
  const driver=createInjectedStellarTestnetHorizonDriver({transport});
  await assert.rejects(
    driver.submitEnvelope({transactionXdr:'signed-envelope-fixture',expectedTransactionHashHex:'aa'.repeat(32)}),
    error => error === timeout && error.code === 'STELLAR_HORIZON_TIMEOUT' &&
      /result is unconfirmed/.test(error.message)
  );
  assert.equal(submissions,1,'do not retry a potentially submitted transaction');
});

test('Horizon account proof rejects unsafe sequence and sequence-time numbers', () => {
  for (const field of ['sequence', 'sequence_time']) {
    for (const value of [Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, 1.5]) {
      assert.throws(() => normalizeHorizonAccountSnapshot({
        accountResponse: accountResponse({ [field]: value }), expectedAccount: G(1)
      }), /exact integer string or safe integer number/, field);
    }
  }
  for (const value of ['invalid', '-1', '1.5']) {
    assert.throws(() => normalizeHorizonAccountSnapshot({
      accountResponse: accountResponse({ sequence_time: value })
    }), /non-negative integer string/);
  }
});

test('Horizon account proof preserves exact large sequences and optional sequence times', () => {
  for (const sequence of ['9007199254740993', 1001]) {
    const snapshot = normalizeHorizonAccountSnapshot({
      accountResponse: accountResponse({ sequence, sequence_time: 1760000000 })
    });
    assert.equal(snapshot.sequence, String(sequence));
    assert.equal(snapshot.sequenceTime, '1760000000');
  }
  assert.equal(normalizeHorizonAccountSnapshot({
    accountResponse: accountResponse({ sequence_time: null })
  }).sequenceTime, null);
});

function precisionFinalityFixture() {
  return {
    transactionResponse: {
      hash: 'aa'.repeat(32), successful: true, ledger: '9007199254740992',
      created_at: '2026-10-03T00:04:00Z'
    },
    ledgerResponse: {
      sequence: '9007199254740992', hash: 'bb'.repeat(32),
      closed_at: '2026-10-03T00:05:00Z'
    },
    expectedTransactionHashHex: 'aa'.repeat(32),
    expectedLedger: '9007199254740992'
  };
}

test('Horizon inclusion proof rejects unsafe numeric submission ledgers', () => {
  const response = precisionFinalityFixture().transactionResponse;
  assert.throws(() => normalizeHorizonSubmissionSuccess({
    response: { ...response, ledger: Number.MAX_SAFE_INTEGER + 1 }
  }), /submission.ledger must use an exact integer string/);
  assert.equal(normalizeHorizonSubmissionSuccess({
    response: { ...response, ledger: 501 }
  }).ledger, '501');
});

test('Horizon finality rejects rounded ledgers on every side of the evidence comparison', () => {
  for (const field of ['transaction', 'ledger', 'expected']) {
    const args = precisionFinalityFixture();
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    if (field === 'transaction') args.transactionResponse.ledger = unsafe;
    if (field === 'ledger') args.ledgerResponse.sequence = unsafe;
    if (field === 'expected') args.expectedLedger = unsafe;
    assert.throws(() => normalizeHorizonFinality(args),
      /exact integer string or safe integer number/, field);
  }
});

test('injected Horizon finality rejects unsafe expected ledgers before lookup', async () => {
  let calls = 0;
  const unexpected = async () => { calls++; throw new Error('unexpected transport call'); };
  const driver = createInjectedStellarTestnetHorizonDriver({
    transport: {
      loadAccount: unexpected, submitTransactionXdr: unexpected,
      loadTransaction: unexpected, loadLedger: unexpected, waitUntilEligible: unexpected
    }
  });
  await assert.rejects(driver.observeFinality({
    transactionHashHex: 'aa'.repeat(32), ledger: Number.MAX_SAFE_INTEGER + 1
  }), /expectedLedger must use an exact integer string/);
  assert.equal(calls, 0);
});

const timestampProofPaths = {
  account: value => normalizeHorizonAccountSnapshot({
    accountResponse: accountResponse({ last_modified_time: value })
  }).lastModifiedTime,
  submission: value => normalizeHorizonSubmissionSuccess({
    response: { hash: 'aa'.repeat(32), successful: true, ledger: 501, created_at: value }
  }).observedAt,
  rejection: value => normalizeHorizonSubmissionError({
    error: { result_codes: { transaction: 'tx_bad_minseq_age_or_gap' } },
    expectedTransactionHashHex: 'aa'.repeat(32), observedAt: value
  }).observedAt,
  transaction: value => {
    const args = precisionFinalityFixture();
    args.transactionResponse.created_at = value;
    args.ledgerResponse.closed_at = '2099-01-01T00:00:00Z';
    return normalizeHorizonFinality(args).observedAt;
  },
  ledger: value => {
    const args = precisionFinalityFixture();
    args.transactionResponse.created_at = '2000-01-01T00:00:00Z';
    args.ledgerResponse.closed_at = value;
    return normalizeHorizonFinality(args).observedAt;
  }
};

for (const [label, normalize] of Object.entries(timestampProofPaths)) {
  test('Horizon ' + label + ' proof rejects impossible or ambiguous timestamps', () => {
    for (const value of [
      '2025-02-29T00:00:00Z', '2026-02-30T00:00:00Z',
      '2026-04-31T00:00:00Z', '2026-01-01T24:00:00Z',
      '2026-01-01', '2026-01-01T00:00:00',
      '2026-01-01T00:00:00+00:00', '01/02/2026',
      '2026-01-01T00:00:00.1234Z'
    ]) {
      assert.throws(() => normalize(value), /valid UTC timestamp/, value);
    }
  });
}

test('Horizon proof timestamps preserve leap days and supported fractional UTC precision', () => {
  for (const value of [
    '2024-02-29T12:34:56Z', '2024-02-29T12:34:56.1Z',
    '2024-02-29T12:34:56.12Z', '2024-02-29T12:34:56.123Z'
  ]) {
    const expected = new Date(value).toISOString();
    for (const [label, normalize] of Object.entries(timestampProofPaths)) {
      const result = normalize(value);
      if (label !== 'transaction') assert.equal(result, expected, label);
    }
  }
  assert.equal(normalizeHorizonAccountSnapshot({
    accountResponse: accountResponse({ last_modified_time: null })
  }).lastModifiedTime, null);
});

test('Horizon finality retains millisecond ordering after timestamp validation', () => {
  const args = precisionFinalityFixture();
  args.transactionResponse.created_at = '2026-10-03T00:05:00.001Z';
  args.ledgerResponse.closed_at = '2026-10-03T00:05:00.000Z';
  assert.throws(() => normalizeHorizonFinality(args), /cannot follow/);
  args.ledgerResponse.closed_at = args.transactionResponse.created_at;
  assert.equal(normalizeHorizonFinality(args).observedAt, '2026-10-03T00:05:00.001Z');
});

for (const [field, normalizedField] of [
  ['sequence_ledger', 'sequenceLedger'],
  ['last_modified_ledger', 'lastModifiedLedger']
]) {
  test('Horizon account rejects coercive and unsafe optional ledger: ' + field, () => {
    let coercions = 0;
    const object = {
      valueOf() { coercions++; return 501; },
      toString() { coercions++; return '501'; }
    };
    for (const value of [
      true, false, [], [501], ['501'], {}, object,
      '', ' ', ' 501 ', '+501', '0501', '5.01e2', '0x1f5', '501.0',
      0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1,
      '9007199254740992', 9007199254740992n
    ]) {
      assert.throws(() => normalizeHorizonAccountSnapshot({
        accountResponse: accountResponse({ [field]: value })
      }), /positive safe integer/);
    }
    assert.equal(coercions, 0, 'untrusted objects must not be coerced');
  });

  test('Horizon account preserves exact and absent optional ledger: ' + field, () => {
    for (const value of [1, 501, '501', 501n, Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)]) {
      const result = normalizeHorizonAccountSnapshot({
        accountResponse: accountResponse({ [field]: value })
      });
      assert.equal(result[normalizedField], Number(value));
    }
    for (const value of [null, undefined]) {
      const result = normalizeHorizonAccountSnapshot({
        accountResponse: accountResponse({ [field]: value })
      });
      assert.equal(result[normalizedField], null);
    }
  });
}

test('Horizon proof integer fields reject arrays and objects without invoking coercion', () => {
  let coercions = 0;
  const trap = { toString() { coercions++; return '1001'; } };
  for (const value of [[1001], ['1001'], trap, new String('1001'), true, null, undefined]) {
    const paths = [
      () => normalizeHorizonAccountSnapshot({ accountResponse: accountResponse({ sequence: value }) }),
      () => normalizeHorizonSubmissionSuccess({
        response: { hash: 'aa'.repeat(32), successful: true, ledger: value, created_at: '2026-10-03T00:00:00Z' }
      }),
      ...['transaction', 'ledger', 'expected'].map(field => () => {
        const args = precisionFinalityFixture();
        if (field === 'transaction') args.transactionResponse.ledger = value;
        if (field === 'ledger') args.ledgerResponse.sequence = value;
        if (field === 'expected') args.expectedLedger = value;
        return normalizeHorizonFinality(args);
      })
    ];
    for (const invoke of paths) assert.throws(invoke, /primitive integer value/);
    if (value != null) assert.throws(() => normalizeHorizonAccountSnapshot({
      accountResponse: accountResponse({ sequence_time: value })
    }), /primitive integer value/);
  }
  assert.equal(coercions, 0);
});

test('Horizon proof integer fields retain bigint and exact decimal primitives', () => {
  for (const value of [1001, '1001', 1001n]) {
    const result = normalizeHorizonAccountSnapshot({
      accountResponse: accountResponse({ sequence: value, sequence_time: value })
    });
    assert.equal(result.sequence, '1001');
    assert.equal(result.sequenceTime, '1001');
  }
});

test('Horizon proof factory validates request timeout configuration', () => {
  for (const requestTimeoutMs of [null, 0, -1, true, [], 2147483648]) {
    assert.throws(() => createStellarTestnetHorizonProofDriver({
      fetchImpl: async () => { throw new Error('No request expected'); },
      requestTimeoutMs
    }), /requestTimeoutMs/);
  }
});

for (const stalledPhase of ['fetch', 'body']) {
  test(`Horizon proof factory bounds stalled account ${stalledPhase}`, { timeout: 2000 }, async () => {
    let signal;
    let calls = 0;
    const driver = createStellarTestnetHorizonProofDriver({
      requestTimeoutMs: 10,
      fetchImpl: async (_url, options) => {
        calls++;
        signal = options.signal;
        if (stalledPhase === 'fetch') return new Promise(() => {});
        return { ok: true, json: () => new Promise(() => {}) };
      }
    });
    await assert.rejects(driver.readAccountSnapshot(G(1)), { code: 'STELLAR_HORIZON_TIMEOUT' });
    assert.equal(signal.aborted, true);
    assert.equal(calls, 1);
  });
}

test('Horizon proof factory preserves unconfirmed submission timeout without retry', { timeout: 2000 }, async () => {
  let signal;
  let calls = 0;
  const driver = createStellarTestnetHorizonProofDriver({
    requestTimeoutMs: 10,
    fetchImpl: async (_url, options) => {
      calls++;
      signal = options.signal;
      assert.equal(options.method, 'POST');
      return new Promise(() => {});
    }
  });
  await assert.rejects(driver.submitEnvelope({
    transactionXdr: 'offline-fixture',
    expectedTransactionHashHex: 'aa'.repeat(32)
  }), error => {
    assert.equal(error.code, 'STELLAR_HORIZON_TIMEOUT');
    assert.match(error.message, /unconfirmed/);
    return true;
  });
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});

test('Horizon proof factory retains default timeout for completed account reads', async () => {
  const driver = createStellarTestnetHorizonProofDriver({
    fetchImpl: async () => ({ ok: true, json: async () => accountResponse() })
  });
  const snapshot = await driver.readAccountSnapshot(G(1));
  assert.equal(snapshot.account, G(1));
  assert.equal(snapshot.sequence, '1001');
});


test('Horizon balances require primitive decimal strings without coercion', () => {
 let coerced=0;const values=[{toString(){coerced++;return '1.0000000';}},['1.0000000'],new String('1.0000000')];
 for(const balance of values) assert.throws(()=>extractHorizonBalanceUnits({accountResponse:accountResponse({balances:[{asset_type:'native',balance}]}),asset:{type:'native'}}),/canonical Stellar amount/);
 assert.equal(coerced,0);
});



test('Horizon balance extraction enforces the int64 stroop boundary', () => {
 const read=balance=>extractHorizonBalanceUnits({accountResponse:accountResponse({balances:[{asset_type:'native',balance}]}),asset:{type:'native'}});
 assert.equal(read('922337203685.4775807'),'9223372036854775807');
 for(const balance of ['922337203685.4775808','9999999999999999999999999.0000000'])assert.throws(()=>read(balance),/int64/);
});



test('Horizon balances reject unknown asset kinds even when code and issuer match', () => {
 for(const type of [undefined,'unknown','liquidity_pool_shares','credit_alphanum4'])assert.throws(()=>extractHorizonBalanceUnits({accountResponse:accountResponse(),asset:{type,code:'USDC',issuer:G(6)}}),/asset type/);
});



test('Horizon balance lookup refuses malformed matching asset codes', () => {
 for(const code of ['', 'A-B', 'ABCDEFGHIJKLM', '😀']) {
  const raw=accountResponse({balances:[{asset_type:'credit_alphanum4',asset_code:code,asset_issuer:G(6),balance:'1.0000000'}]});
  assert.throws(()=>extractHorizonBalanceUnits({accountResponse:raw,asset:{type:'credit_alphanum',code,issuer:G(6)}}),/asset code/);
 }
});



test('Horizon balance lookup refuses invalid matching issuers', () => {
 for(const issuer of ['not-an-account',T(1),G(6).slice(0,-1)+'!']) {
  const raw=accountResponse({balances:[{asset_type:'credit_alphanum4',asset_code:'USDC',asset_issuer:issuer,balance:'1.0000000'}]});
  assert.throws(()=>extractHorizonBalanceUnits({accountResponse:raw,asset:{type:'credit_alphanum',code:'USDC',issuer}}),/issuer/);
 }
});



test('Horizon balance evidence rejects contradictory asset type and code length', () => {
 for(const [code,asset_type] of [['USDC','credit_alphanum12'],['LONGTOKEN','credit_alphanum4']]) {
  const raw=accountResponse({balances:[{asset_type,asset_code:code,asset_issuer:G(6),balance:'1.0000000'}]});
  assert.throws(()=>extractHorizonBalanceUnits({accountResponse:raw,asset:{type:'credit_alphanum',code,issuer:G(6)}}),/asset type.*code length/);
 }
});

