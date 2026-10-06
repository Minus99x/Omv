import WebSocket from 'ws';

const HEX_32 = /^[0-9a-f]{64}$/i;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function rpcResult(response, label) {
  const value = object(response, label);
  if (value.error) throw new Error(`${label} failed: ${value.error.message ?? value.error.code ?? 'unknown JSON-RPC error'}`);
  if (!('result' in value)) throw new Error(`${label} did not return a JSON-RPC result.`);
  return value.result;
}

export function parseCardanoOgmiosTipResponse(response) {
  const result = rpcResult(response, 'Ogmios tip query');
  const tip = result?.tip ?? result;
  const hash = String(tip?.hash ?? tip?.id ?? '').toLowerCase();
  const slot = Number(tip?.slot);
  if (!HEX_32.test(hash) || !Number.isSafeInteger(slot) || slot < 0) throw new Error('Ogmios tip response is missing a valid hash/slot.');
  return Object.freeze({ hash, slot });
}

export function parseCardanoOgmiosEpochResponse(response) {
  const result = rpcResult(response, 'Ogmios epoch query');
  const epoch = Number(result?.epoch ?? result);
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error('Ogmios epoch response is invalid.');
  return epoch;
}

export function parseCardanoOgmiosBlockHeightResponse(response) {
  const result = rpcResult(response, 'Ogmios block-height query');
  const height = Number(result?.height ?? result?.blockHeight ?? result);
  if (!Number.isSafeInteger(height) || height < 0) throw new Error('Ogmios block-height response is invalid.');
  return height;
}

export function parseCardanoOgmiosProtocolParametersResponse(response) {
  return object(rpcResult(response, 'Ogmios protocol-parameters query'), 'Ogmios protocol parameters');
}

export function cardanoSameTip(left, right) {
  return Boolean(left && right && left.hash === right.hash && left.slot === right.slot);
}

export function createCardanoOgmiosHttpClient({
  url,
  apiKey = null,
  apiKeyHeader = 'dmtr-api-key',
  fetchImpl = globalThis.fetch,
  WebSocketImpl = WebSocket
}) {
  if (typeof url !== 'string' || !/^(https?|wss?):\/\//i.test(url)) throw new TypeError('Ogmios endpoint must be an http(s) or ws(s) URL.');

  const isWebSocket = /^wss?:\/\//i.test(url);
  if (!isWebSocket && typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  if (isWebSocket && typeof WebSocketImpl !== 'function') throw new TypeError('A WebSocket implementation is required.');

  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers[apiKeyHeader] = apiKey;
  let id = 0;

  async function rpcHttp(method, params, requestId) {
    const body = { jsonrpc: '2.0', method, id: requestId ?? `omegavault-${++id}` };
    if (params !== undefined) body.params = params;
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Ogmios HTTP ${response.status} for ${method}.`);
    const json = await response.json();
    if (json?.error) throw new Error(`Ogmios ${method} failed: ${json.error.message ?? json.error.code ?? 'unknown error'}`);
    return json;
  }

  let socket = null;
  let socketOpen = false;
  let socketOpening = null;
  const pending = new Map();

  function rejectPending(error) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  }

  async function ensureWebSocket() {
    if (socket && socketOpen) return socket;
    if (socketOpening) return socketOpening;

    socketOpening = new Promise((resolve, reject) => {
      const ws = apiKey
        ? new WebSocketImpl(url, [], { headers: { [apiKeyHeader]: apiKey } })
        : new WebSocketImpl(url);
      socket = ws;
      let opened = false;

      ws.addEventListener('open', () => {
        opened = true;
        socketOpen = true;
        const ready = socketOpening;
        socketOpening = null;
        resolve(ws);
        return ready;
      });

      ws.addEventListener('message', event => {
        try {
          const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
          const json = JSON.parse(raw);
          const entry = pending.get(json?.id);
          if (!entry) return;
          pending.delete(json.id);
          clearTimeout(entry.timer);
          if (json?.error) entry.reject(new Error(`Ogmios ${entry.method} failed: ${json.error.message ?? json.error.code ?? 'unknown error'}`));
          else entry.resolve(json);
        } catch (error) {
          rejectPending(error);
        }
      });

      const onSocketError = rawError => {
        const detail = String(rawError?.message || rawError?.error?.message || '').trim();
        const error = new Error(`Ogmios WebSocket connection failed${detail ? `: ${detail}` : ''}.`);
        if (!opened) {
          socketOpening = null;
          socket = null;
          reject(error);
        }
        rejectPending(error);
      };

      if (typeof ws.on === 'function') {
        ws.on('error', onSocketError);
        ws.on('unexpected-response', (_request, response) => {
          const status = Number(response?.statusCode);
          const message = Number.isInteger(status)
            ? `Ogmios WebSocket handshake returned HTTP ${status}`
            : 'Ogmios WebSocket handshake returned an unexpected HTTP response';
          const error = new Error(message);
          if (!opened) {
            socketOpening = null;
            socket = null;
            reject(error);
          }
          rejectPending(error);
          try { ws.terminate?.(); } catch {}
        });
      } else {
        ws.addEventListener('error', onSocketError);
      }

      ws.addEventListener('close', event => {
        socketOpen = false;
        socketOpening = null;
        socket = null;
        rejectPending(new Error(`Ogmios WebSocket closed (code ${event.code}).`));
      });
    });

    return socketOpening;
  }

  async function rpcWebSocket(method, params, requestId) {
    const ws = await ensureWebSocket();
    const rpcId = requestId ?? `omegavault-${++id}`;
    const request = { jsonrpc: '2.0', method, id: rpcId };
    if (params !== undefined) request.params = params;

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(rpcId);
        reject(new Error(`Ogmios WebSocket timeout for ${method}.`));
      }, 15000);
      pending.set(rpcId, { resolve, reject, timer, method });
      try {
        ws.send(JSON.stringify(request));
      } catch (error) {
        pending.delete(rpcId);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  function close() {
    if (socket) {
      try { socket.close(); } catch {}
    }
    socket = null;
    socketOpen = false;
    socketOpening = null;
    rejectPending(new Error('Ogmios client closed.'));
  }

  return Object.freeze({
    async rpc(method, params = undefined, requestId = undefined) {
      return isWebSocket
        ? rpcWebSocket(method, params, requestId)
        : rpcHttp(method, params, requestId);
    },
    close
  });
}

export async function fetchCardanoBlockfrostPreprodProtocolParameters({
  projectId,
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://cardano-preprod.blockfrost.io/api/v0'
}) {
  if (typeof projectId !== 'string' || !projectId.trim()) throw new TypeError('A Blockfrost Preprod project_id is required.');
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  const response = await fetchImpl(`${baseUrl}/epochs/latest/parameters`, {
    headers: { project_id: projectId.trim() }
  });
  if (!response.ok) throw new Error(`Blockfrost HTTP ${response.status} while reading latest Preprod protocol parameters.`);
  return object(await response.json(), 'Blockfrost protocol parameters');
}
