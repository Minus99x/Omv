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
  fetchImpl = globalThis.fetch
}) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new TypeError('Ogmios HTTP endpoint must be an http(s) URL.');
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers[apiKeyHeader] = apiKey;
  let id = 0;

  return Object.freeze({
    async rpc(method, params = undefined, requestId = undefined) {
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
