import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardanoSameTip,
  createCardanoOgmiosHttpClient,
  fetchCardanoBlockfrostPreprodProtocolParameters,
  parseCardanoOgmiosBlockHeightResponse,
  parseCardanoOgmiosEpochResponse,
  parseCardanoOgmiosProtocolParametersResponse,
  parseCardanoOgmiosTipResponse
} from '../src/chains/cardano/preprod-live-capture.js';

test('Ogmios response parsers accept current JSON-RPC tip/epoch/height/parameter shapes', () => {
  const hash = 'ab'.repeat(32);
  assert.deepEqual(parseCardanoOgmiosTipResponse({ result: { tip: { hash, slot: 123 } } }), { hash, slot: 123 });
  assert.equal(parseCardanoOgmiosEpochResponse({ result: { epoch: 400 } }), 400);
  assert.equal(parseCardanoOgmiosBlockHeightResponse({ result: { height: 5000 } }), 5000);
  assert.deepEqual(parseCardanoOgmiosProtocolParametersResponse({ result: { minFeeCoefficient: 44 } }), { minFeeCoefficient: 44 });
  assert.equal(cardanoSameTip({ hash, slot: 1 }, { hash, slot: 1 }), true);
  assert.equal(cardanoSameTip({ hash, slot: 1 }, { hash, slot: 2 }), false);
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
  client.close();
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
