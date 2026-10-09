import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cardanoSameTip,
  createCardanoOgmiosHttpClient,
  createCardanoOgmiosUtxoByOutputReferencesParams,
  fetchCardanoBlockfrostPreprodAddressUtxos,
  fetchCardanoBlockfrostPreprodProtocolParameters,
  normalizeCardanoOgmiosWebSocketUrl,
  parseCardanoOgmiosBlockHeightResponse,
  parseCardanoOgmiosEpochResponse,
  parseCardanoOgmiosProtocolParametersResponse,
  parseCardanoOgmiosTipResponse,
  parseCardanoOgmiosUtxoResponse,
  selectCardanoPreprodInitializeUtxos
} from '../src/chains/cardano/preprod-live-capture.js';

test('Ogmios endpoint normalization forces WebSocket transport without changing host/path/query', () => {
  assert.equal(
    normalizeCardanoOgmiosWebSocketUrl('https://example.invalid/ogmios?token=x'),
    'wss://example.invalid/ogmios?token=x'
  );
  assert.equal(
    normalizeCardanoOgmiosWebSocketUrl('wss://example.invalid/ogmios'),
    'wss://example.invalid/ogmios'
  );
  assert.throws(() => normalizeCardanoOgmiosWebSocketUrl('ftp://example.invalid'), /WebSocket/);
});

test('Ogmios response parsers accept current JSON-RPC tip/epoch/height/parameter shapes', () => {
  const hash = 'ab'.repeat(32);
  assert.deepEqual(parseCardanoOgmiosTipResponse({ result: { tip: { hash, slot: 123 } } }), { hash, slot: 123 });
  assert.equal(parseCardanoOgmiosEpochResponse({ result: { epoch: 400 } }), 400);
  assert.equal(parseCardanoOgmiosBlockHeightResponse({ result: { height: 5000 } }), 5000);
  assert.deepEqual(parseCardanoOgmiosProtocolParametersResponse({ result: { minFeeCoefficient: 44 } }), { minFeeCoefficient: 44 });
  assert.equal(cardanoSameTip({ hash, slot: 1 }, { hash, slot: 1 }), true);
  assert.equal(cardanoSameTip({ hash, slot: 1 }, { hash, slot: 2 }), false);
});

test('Ogmios UTxO query builder and parser bind exact output references and values', () => {
  const txId = 'ab'.repeat(32);
  const params = createCardanoOgmiosUtxoByOutputReferencesParams([
    { transaction: { id: txId.toUpperCase() }, index: 2 }
  ]);
  assert.deepEqual(params, {
    outputReferences: [{ transaction: { id: txId }, index: 2 }]
  });

  const result = parseCardanoOgmiosUtxoResponse({
    result: [{
      transaction: { id: txId },
      index: 2,
      address: 'addr_test1vfixture',
      value: {
        ada: { lovelace: 5000000 },
        ['cd'.repeat(28)]: { '4F56': 1 }
      },
      datum: '80'
    }]
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].transaction.id, txId);
  assert.equal(result[0].index, 2);
  assert.equal(result[0].value.ada.lovelace, '5000000');
  assert.equal(result[0].value['cd'.repeat(28)]['4f56'], '1');
  assert.equal(result[0].datum, '80');

  assert.throws(
    () => createCardanoOgmiosUtxoByOutputReferencesParams([
      { transaction: { id: txId }, index: 2 },
      { transaction: { id: txId }, index: 2 }
    ]),
    /Duplicate/
  );
  assert.throws(
    () => parseCardanoOgmiosUtxoResponse({
      result: [
        { transaction: { id: txId }, index: 2, address: 'addr_test1vfixture', value: { ada: { lovelace: 1 } } },
        { transaction: { id: txId }, index: 2, address: 'addr_test1vfixture', value: { ada: { lovelace: 1 } } }
      ]
    }),
    /duplicate/i
  );
});

test('Ogmios HTTP client sends JSON-RPC plus configured authentication without exposing it in output', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 'x', result: 400 }) };
  };
  const client = createCardanoOgmiosHttpClient({
    url: 'https://preprod.example.invalid',
    apiKey: 'secret',
    apiKeyHeader: 'dmtr-api-key',
    fetchImpl: fakeFetch
  });
  await client.rpc('queryLedgerState/epoch', undefined, 'x');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers['dmtr-api-key'], 'secret');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.method, 'queryLedgerState/epoch');
  assert.equal(body.id, 'x');
});

test('Ogmios WebSocket client reuses one authenticated connection across JSON-RPC calls', async () => {
  let connections = 0;
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      connections += 1;
      queueMicrotask(() => this.emit('open', {}));
    }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(fn);
    }
    emit(name, event) {
      for (const fn of this.listeners.get(name) ?? []) fn(event);
    }
    send(payload) {
      const request = JSON.parse(payload);
      queueMicrotask(() => this.emit('message', {
        data: JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.method === 'queryNetwork/tip' ? { id: 'ab'.repeat(32), slot: 123 } : { epoch: 400 } })
      }));
    }
    close() { this.emit('close', { code: 1000 }); }
  }

  const client = createCardanoOgmiosHttpClient({
    url: 'wss://authenticated.preprod.example.invalid',
    WebSocketImpl: FakeWebSocket
  });
  const tip = await client.rpc('queryNetwork/tip', undefined, 'ws-1');
  const epoch = await client.rpc('queryLedgerState/epoch', undefined, 'ws-2');
  assert.equal(tip.result.slot, 123);
  assert.equal(epoch.result.epoch, 400);
  assert.equal(connections, 1);
  client.close();
});

test('Ogmios WebSocket client closeAndWait releases an authenticated socket before a later reconnect', async () => {
  let connections = 0;
  let closes = 0;
  class FakeWebSocket {
    constructor() {
      this.listeners = new Map();
      connections += 1;
      queueMicrotask(() => this.emit('open', {}));
    }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(fn);
    }
    on(name, fn) { this.addEventListener(name, fn); }
    once(name, fn) {
      const wrapped = event => {
        const list = this.listeners.get(name) ?? [];
        this.listeners.set(name, list.filter(item => item !== wrapped));
        fn(event);
      };
      this.addEventListener(name, wrapped);
    }
    emit(name, event) {
      for (const fn of [...(this.listeners.get(name) ?? [])]) fn(event);
    }
    send(payload) {
      const request = JSON.parse(payload);
      queueMicrotask(() => this.emit('message', {
        data: JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tip: { id: 'ab'.repeat(32), slot: 123 } } })
      }));
    }
    close() {
      closes += 1;
      queueMicrotask(() => this.emit('close', { code: 1000 }));
    }
  }

  const first = createCardanoOgmiosHttpClient({
    url: 'wss://preprod.example.invalid',
    apiKey: 'secret',
    apiKeyHeader: 'dmtr-api-key',
    WebSocketImpl: FakeWebSocket
  });
  await first.rpc('queryNetwork/tip', undefined, 'first');
  await first.closeAndWait();
  assert.equal(closes, 1);

  const second = createCardanoOgmiosHttpClient({
    url: 'wss://preprod.example.invalid',
    apiKey: 'secret',
    apiKeyHeader: 'dmtr-api-key',
    WebSocketImpl: FakeWebSocket
  });
  await second.rpc('queryNetwork/tip', undefined, 'second');
  assert.equal(connections, 2);
  await second.closeAndWait();
  assert.equal(closes, 2);
});

test('Ogmios WebSocket client sends configured Demeter authentication header', async () => {
  let constructorArgs = null;
  class FakeWebSocket {
    constructor(...args) {
      constructorArgs = args;
      this.listeners = new Map();
      queueMicrotask(() => this.emit('open', {}));
    }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(fn);
    }
    emit(name, event) {
      for (const fn of this.listeners.get(name) ?? []) fn(event);
    }
    send(payload) {
      const request = JSON.parse(payload);
      queueMicrotask(() => this.emit('message', {
        data: JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { epoch: 400 } })
      }));
    }
    close() { this.emit('close', { code: 1000 }); }
  }

  const client = createCardanoOgmiosHttpClient({
    url: 'wss://preprod.example.invalid',
    apiKey: 'secret',
    apiKeyHeader: 'dmtr-api-key',
    WebSocketImpl: FakeWebSocket
  });
  const response = await client.rpc('queryLedgerState/epoch', undefined, 'ws-auth');
  assert.equal(response.result.epoch, 400);
  assert.equal(constructorArgs[0], 'wss://preprod.example.invalid');
  assert.equal(constructorArgs[2].headers['dmtr-api-key'], 'secret');
  assert.equal(constructorArgs[2].perMessageDeflate, false);
  client.close();
});

test('Ogmios WebSocket client disables permessage-deflate even without a separate auth header', async () => {
  let constructorArgs = null;
  class FakeWebSocket {
    constructor(...args) {
      constructorArgs = args;
      this.listeners = new Map();
      queueMicrotask(() => this.emit('open', {}));
    }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(fn);
    }
    emit(name, event) {
      for (const fn of this.listeners.get(name) ?? []) fn(event);
    }
    send(payload) {
      const request = JSON.parse(payload);
      queueMicrotask(() => this.emit('message', {
        data: JSON.stringify({ jsonrpc:'2.0', id:request.id, result:{ epoch:400 } })
      }));
    }
    close() { this.emit('close', { code:1000 }); }
  }

  const client = createCardanoOgmiosHttpClient({
    url:'wss://preprod.example.invalid',
    WebSocketImpl:FakeWebSocket
  });
  await client.rpc('queryLedgerState/epoch', undefined, 'ws-no-auth');
  assert.equal(constructorArgs[2].perMessageDeflate, false);
  assert.equal(constructorArgs[2].headers, undefined);
  client.close();
});

test('Blockfrost Preprod wallet UTxO discovery normalizes assets and deterministically selects seed/collateral', async () => {
  const address = 'addr_test1vfixture';
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => [
        {
          tx_hash: 'aa'.repeat(32),
          output_index: 0,
          amount: [{ unit: 'lovelace', quantity: '5000000' }],
          data_hash: null,
          inline_datum: null,
          reference_script_hash: null
        },
        {
          tx_hash: 'bb'.repeat(32),
          output_index: 1,
          amount: [{ unit: 'lovelace', quantity: '20000000' }],
          data_hash: null,
          inline_datum: null,
          reference_script_hash: null
        },
        {
          tx_hash: 'cc'.repeat(32),
          output_index: 2,
          amount: [
            { unit: 'lovelace', quantity: '9000000' },
            { unit: `${'dd'.repeat(28)}4f56`, quantity: '1' }
          ],
          data_hash: null,
          inline_datum: null,
          reference_script_hash: null
        }
      ]
    };
  };
  const utxos = await fetchCardanoBlockfrostPreprodAddressUtxos({
    projectId: 'preprod_key',
    address,
    fetchImpl: fakeFetch
  });
  assert.equal(utxos.length, 3);
  assert.equal(utxos[2].value['dd'.repeat(28)]['4f56'], '1');
  const selected = selectCardanoPreprodInitializeUtxos(utxos);
  assert.equal(selected.seed.transaction.id, 'bb'.repeat(32));
  assert.equal(selected.seedLovelace, '20000000');
  assert.equal(selected.collateral.transaction.id, 'aa'.repeat(32));
  assert.equal(selected.collateralLovelace, '5000000');
  assert.equal(selected.candidateCount, 2);
  assert.match(calls[0].url, /addresses\/addr_test1vfixture\/utxos\?count=100&page=1&order=asc$/);
  assert.equal(calls[0].options.headers.project_id, 'preprod_key');
});

test('Cardano initialize UTxO selection refuses a wallet without two plain ADA-only outputs', () => {
  assert.throws(
    () => selectCardanoPreprodInitializeUtxos([{
      transaction: { id: 'aa'.repeat(32) },
      index: 0,
      address: 'addr_test1vfixture',
      value: { ada: { lovelace: '10000000' } },
      datumHash: null,
      inlineDatum: null,
      referenceScriptHash: null
    }]),
    /at least two distinct/
  );
});

test('Blockfrost Preprod helper uses project_id and latest epoch parameter endpoint', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ epoch: 400 }) };
  };
  const result = await fetchCardanoBlockfrostPreprodProtocolParameters({ projectId: 'preprod_key', fetchImpl: fakeFetch });
  assert.equal(result.epoch, 400);
  assert.match(calls[0].url, /cardano-preprod\.blockfrost\.io\/api\/v0\/epochs\/latest\/parameters$/);
  assert.equal(calls[0].options.headers.project_id, 'preprod_key');
});

test('Ogmios WebSocket client preserves script execution failure code and data', async () => {
  class FakeWebSocket {
    constructor() {
      this.listeners = new Map();
      queueMicrotask(() => this.emit('open', {}));
    }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(fn);
    }
    on(name, fn) { this.addEventListener(name, fn); }
    emit(name, event) {
      for (const fn of this.listeners.get(name) ?? []) fn(event);
    }
    send(payload) {
      const request = JSON.parse(payload);
      queueMicrotask(() => this.emit('message', {
        data: JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: 3010,
            message: 'Some scripts of the transactions terminated with error(s).',
            data: [{ validator: 'spend:0', error: 'fixture-script-failure' }]
          }
        })
      }));
    }
    close() { this.emit('close', { code: 1000 }); }
  }

  const client = createCardanoOgmiosHttpClient({
    url: 'wss://preprod.example.invalid',
    WebSocketImpl: FakeWebSocket
  });

  await assert.rejects(
    () => client.rpc('evaluateTransaction', { transaction: { cbor: '00' } }, 'eval-fail'),
    error => /code=3010/.test(error.message) &&
      /spend:0/.test(error.message) &&
      /fixture-script-failure/.test(error.message) &&
      error.ogmios?.code === 3010 &&
      error.ogmios?.method === 'evaluateTransaction' &&
      error.ogmios?.data?.[0]?.validator === 'spend:0'
  );
  client.close();
});

test('Ogmios/Blockfrost helpers fail closed on RPC or HTTP errors', async () => {
  assert.throws(() => parseCardanoOgmiosTipResponse({ error: { message: 'bad tip' } }), /bad tip/);
  const failFetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const client = createCardanoOgmiosHttpClient({ url: 'https://example.invalid', fetchImpl: failFetch });
  await assert.rejects(() => client.rpc('queryNetwork/tip'), /HTTP 403/);
  await assert.rejects(() => fetchCardanoBlockfrostPreprodProtocolParameters({ projectId: 'x', fetchImpl: failFetch }), /HTTP 403/);
});


test('Cardano live CLI entrypoints normalize configured Ogmios URLs to WebSocket transport', () => {
  for (const relative of [
    '../scripts/capture-cardano-preprod-real-initialize.js',
    '../scripts/capture-cardano-preprod-real-utxo-binding.js',
    '../scripts/capture-cardano-preprod-evaluation-campaign.js',
    '../scripts/check-cardano-preprod-initialize-presubmit.js'
  ]) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.match(source, /normalizeCardanoOgmiosWebSocketUrl/);
    assert.match(source, /url:\s*normalizeCardanoOgmiosWebSocketUrl\(ogmiosUrl\)/);
  }
});
