import WebSocket from 'ws';

const HEX_32 = /^[0-9a-f]{64}$/i;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function formatOgmiosRpcError(method, error) {
  const code = error?.code != null ? ` code=${String(error.code)}` : '';
  let detail = '';
  if (error?.data != null) {
    try {
      const encoded = JSON.stringify(error.data);
      detail = encoded.length > 4000 ? ` data=${encoded.slice(0, 4000)}…` : ` data=${encoded}`;
    } catch {}
  }
  const formatted = new Error(`Ogmios ${method} failed:${code} ${error?.message ?? 'unknown error'}${detail}`);
  formatted.ogmios = Object.freeze({
    method,
    code: error?.code ?? null,
    message: error?.message ?? 'unknown error',
    data: error?.data ?? null
  });
  return formatted;
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

function normalizeUtxoQuantity(value, label) {
  const normalized = String(value);
  if (!/^-?\d+$/.test(normalized)) throw new TypeError(`${label} must be an integer quantity.`);
  return normalized;
}

function normalizeOgmiosValue(value, label) {
  const source = object(value, label);
  const ada = object(source.ada, `${label}.ada`);
  const lovelace = normalizeUtxoQuantity(ada.lovelace, `${label}.ada.lovelace`);
  if (BigInt(lovelace) < 0n) throw new TypeError(`${label}.ada.lovelace must be non-negative.`);
  const normalized = { ada: Object.freeze({ lovelace }) };
  for (const [policyId, assets] of Object.entries(source)) {
    if (policyId === 'ada') continue;
    if (!/^[0-9a-f]{56}$/i.test(policyId)) throw new TypeError(`${label} contains an invalid policy id.`);
    const assetMap = object(assets, `${label}.${policyId}`);
    normalized[policyId.toLowerCase()] = Object.freeze(Object.fromEntries(
      Object.entries(assetMap).map(([assetName, quantity]) => {
        if (!/^[0-9a-f]*$/i.test(assetName) || assetName.length % 2 !== 0 || assetName.length > 64) {
          throw new TypeError(`${label} contains an invalid asset name.`);
        }
        return [assetName.toLowerCase(), normalizeUtxoQuantity(quantity, `${label}.${policyId}.${assetName}`)];
      })
    ));
  }
  return Object.freeze(normalized);
}

export function createCardanoOgmiosUtxoByOutputReferencesParams(outputReferences) {
  if (!Array.isArray(outputReferences) || outputReferences.length < 1) {
    throw new TypeError('At least one Cardano output reference is required.');
  }
  const seen = new Set();
  const normalized = outputReferences.map((reference, index) => {
    const txId = String(reference?.transaction?.id ?? '').toLowerCase();
    const outputIndex = Number(reference?.index);
    if (!HEX_32.test(txId)) throw new TypeError(`outputReferences[${index}].transaction.id must be 32-byte hex.`);
    if (!Number.isSafeInteger(outputIndex) || outputIndex < 0) throw new TypeError(`outputReferences[${index}].index must be a non-negative safe integer.`);
    const key = `${txId}#${outputIndex}`;
    if (seen.has(key)) throw new Error(`Duplicate Cardano output reference: ${key}.`);
    seen.add(key);
    return Object.freeze({ transaction: Object.freeze({ id: txId }), index: outputIndex });
  });
  return Object.freeze({ outputReferences: Object.freeze(normalized) });
}

export function parseCardanoOgmiosUtxoResponse(response) {
  const result = rpcResult(response, 'Ogmios UTxO query');
  if (!Array.isArray(result)) throw new TypeError('Ogmios UTxO query result must be an array.');
  const seen = new Set();
  const normalized = result.map((entry, index) => {
    const txId = String(entry?.transaction?.id ?? '').toLowerCase();
    const outputIndex = Number(entry?.index);
    if (!HEX_32.test(txId)) throw new TypeError(`Ogmios UTxO result ${index} has an invalid transaction id.`);
    if (!Number.isSafeInteger(outputIndex) || outputIndex < 0) throw new TypeError(`Ogmios UTxO result ${index} has an invalid output index.`);
    const address = String(entry?.address ?? '');
    if (!address) throw new TypeError(`Ogmios UTxO result ${index} is missing an address.`);
    const key = `${txId}#${outputIndex}`;
    if (seen.has(key)) throw new Error(`Ogmios UTxO query returned a duplicate output reference: ${key}.`);
    seen.add(key);
    const normalizedEntry = {
      transaction: Object.freeze({ id: txId }),
      index: outputIndex,
      address,
      value: normalizeOgmiosValue(entry.value, `Ogmios UTxO result ${index}.value`)
    };
    if (entry.datumHash != null) normalizedEntry.datumHash = String(entry.datumHash).toLowerCase();
    if (entry.datum != null) normalizedEntry.datum = String(entry.datum).toLowerCase();
    if (entry.script != null) normalizedEntry.script = entry.script;
    return Object.freeze(normalizedEntry);
  });
  return Object.freeze(normalized);
}

export function cardanoSameTip(left, right) {
  return Boolean(left && right && left.hash === right.hash && left.slot === right.slot);
}

export function normalizeCardanoOgmiosWebSocketUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Ogmios endpoint URL is required.');
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new TypeError('Ogmios endpoint must be a valid URL.');
  }
  if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
  else if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
  if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') {
    throw new TypeError('Ogmios endpoint must resolve to a WebSocket URL.');
  }
  return parsed.toString();
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
    if (json?.error) throw formatOgmiosRpcError(method, json.error);
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
          if (json?.error) entry.reject(formatOgmiosRpcError(entry.method, json.error));
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

  async function closeAndWait(timeoutMs = 5000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
      throw new RangeError('closeAndWait timeoutMs must be an integer from 1 through 30000.');
    }
    const closingSocket = socket;
    if (!closingSocket) {
      close();
      return;
    }

    await new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        try { closingSocket.terminate?.(); } catch {}
        finish();
      }, timeoutMs);

      try {
        if (typeof closingSocket.once === 'function') closingSocket.once('close', finish);
        else closingSocket.addEventListener?.('close', finish, { once:true });
      } catch {}

      try { closingSocket.close(); } catch { finish(); }
    });

    if (socket === closingSocket) socket = null;
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
    close,
    closeAndWait
  });
}

function blockfrostAmountToOgmiosValue(amount, label) {
  if (!Array.isArray(amount) || amount.length < 1) throw new TypeError(`${label} amount must be a non-empty array.`);
  const value = {};
  for (const [index, item] of amount.entries()) {
    const unit = String(item?.unit ?? '').toLowerCase();
    const quantity = String(item?.quantity ?? '');
    if (!/^\d+$/.test(quantity)) throw new TypeError(`${label} amount[${index}].quantity must be an unsigned integer.`);
    if (unit === 'lovelace') {
      value.ada = Object.freeze({ lovelace: quantity });
      continue;
    }
    if (!/^[0-9a-f]{56,120}$/.test(unit) || unit.length % 2 !== 0) {
      throw new TypeError(`${label} amount[${index}].unit is not a Cardano asset unit.`);
    }
    const policyId = unit.slice(0, 56);
    const assetName = unit.slice(56);
    value[policyId] = Object.freeze({
      ...(value[policyId] ?? {}),
      [assetName]: quantity
    });
  }
  if (!value.ada) throw new Error(`${label} does not contain lovelace.`);
  return Object.freeze(value);
}

export async function fetchCardanoBlockfrostPreprodAddressUtxos({
  projectId,
  address,
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://cardano-preprod.blockfrost.io/api/v0',
  maxPages = 10
}) {
  if (typeof projectId !== 'string' || !projectId.trim()) throw new TypeError('A Blockfrost Preprod project_id is required.');
  if (typeof address !== 'string' || !address.startsWith('addr_test1')) throw new TypeError('A Cardano testnet addr_test1 address is required.');
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new RangeError('maxPages must be 1-100.');

  const result = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${baseUrl}/addresses/${encodeURIComponent(address)}/utxos?count=100&page=${page}&order=asc`;
    const response = await fetchImpl(url, { headers: { project_id: projectId.trim() } });
    if (!response.ok) throw new Error(`Blockfrost HTTP ${response.status} while reading Preprod address UTxOs.`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new TypeError('Blockfrost address UTxO response must be an array.');
    for (const [index, row] of rows.entries()) {
      const txId = String(row?.tx_hash ?? '').toLowerCase();
      const outputIndex = Number(row?.output_index);
      if (!HEX_32.test(txId)) throw new TypeError(`Blockfrost UTxO page ${page} row ${index} has an invalid transaction id.`);
      if (!Number.isSafeInteger(outputIndex) || outputIndex < 0) throw new TypeError(`Blockfrost UTxO page ${page} row ${index} has an invalid output index.`);
      result.push(Object.freeze({
        transaction: Object.freeze({ id: txId }),
        index: outputIndex,
        address,
        value: blockfrostAmountToOgmiosValue(row.amount, `Blockfrost UTxO page ${page} row ${index}`),
        datumHash: row.data_hash == null ? null : String(row.data_hash).toLowerCase(),
        inlineDatum: row.inline_datum ?? null,
        referenceScriptHash: row.reference_script_hash == null ? null : String(row.reference_script_hash).toLowerCase()
      }));
    }
    if (rows.length < 100) return Object.freeze(result);
  }
  throw new Error(`Blockfrost address UTxO listing exceeded ${maxPages * 100} outputs; narrow the wallet before OmegaVault automatic selection.`);
}

export function selectCardanoPreprodInitializeUtxos(utxos) {
  if (!Array.isArray(utxos)) throw new TypeError('utxos must be an array.');
  const plainAdaOnly = utxos.filter(item => {
    const policies = Object.keys(item?.value ?? {}).filter(key => key !== 'ada');
    const lovelace = String(item?.value?.ada?.lovelace ?? '');
    return /^\d+$/.test(lovelace) &&
      BigInt(lovelace) > 0n &&
      policies.length === 0 &&
      item?.datumHash == null &&
      item?.inlineDatum == null &&
      item?.referenceScriptHash == null;
  });
  plainAdaOnly.sort((left, right) => {
    const amountOrder = BigInt(right.value.ada.lovelace) - BigInt(left.value.ada.lovelace);
    if (amountOrder !== 0n) return amountOrder > 0n ? 1 : -1;
    const leftKey = `${left.transaction.id}#${left.index}`;
    const rightKey = `${right.transaction.id}#${right.index}`;
    return leftKey.localeCompare(rightKey);
  });
  if (plainAdaOnly.length < 2) {
    throw new Error('Cardano real initialize requires at least two distinct plain ADA-only wallet UTxOs: one seed/funding input and one collateral input.');
  }
  return Object.freeze({
    seed: Object.freeze({ transaction: plainAdaOnly[0].transaction, index: plainAdaOnly[0].index }),
    collateral: Object.freeze({ transaction: plainAdaOnly[1].transaction, index: plainAdaOnly[1].index }),
    seedLovelace: plainAdaOnly[0].value.ada.lovelace,
    collateralLovelace: plainAdaOnly[1].value.ada.lovelace,
    candidateCount: plainAdaOnly.length
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
