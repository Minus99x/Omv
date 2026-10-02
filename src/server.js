import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonVaultStore } from './core/store.js';
import {
  createVault,
  heartbeat,
  requestRecovery,
  approveRecovery,
  markRecovered,
  bindChainDeployment,
  recordChainActivity,
  publicVault
} from './core/recovery.js';
import { listChains } from './chains/registry.js';
import { createCapabilityCatalogResponse } from './chains/capability-catalog.js';
import { createEvidenceProvenanceCatalog } from './chains/evidence-provenance.js';
import { createEvidenceHistoryCatalog } from './chains/evidence-history.js';
import { createEvidenceDiagnosticsCatalog } from './chains/evidence-diagnostics.js';
import { createValidatedCapabilityCatalogResponse, createValidatedEvidenceProvenanceCatalogResponse, createValidatedEvidenceHistoryCatalogResponse, createValidatedEvidenceDiagnosticsCatalogResponse } from './api/response-contracts.js';
import { ensureSolcCompiler, SOLC_0_8_24 } from './ethereum/compiler-cache.js';

const APP_VERSION = '0.4.3';
const CONTRACT_VERSION = '0.4.0';
const ETHEREUM_ADAPTER_VERSION = '0.4.0';
const SEPOLIA_CHAIN_ID = '0xaa36a7';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const defaultStableDataDir = path.join(os.homedir(), '.omegavault-test');
const dataDir = path.resolve(process.env.OMEGAVAULT_DATA_DIR || defaultStableDataDir);
const contractSourcePath = path.join(root, 'contracts', 'OmegaVaultRecoveryVault.sol');
const compilerCacheDir = path.join(dataDir, 'compiler-cache');
const storeFile = path.join(dataDir, 'vaults.json');
const store = new JsonVaultStore(storeFile);
const port = Number(process.env.PORT || 8787);


function walkForPriorVaultFiles(baseDir, maxDepth = 4) {
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = path.join(dir, entry.name);
      if (/^omegavault-mvp-0\.4(?:\.\d+)?$/i.test(entry.name) || depth > 0) {
        const candidate = path.join(child, 'data', 'vaults.json');
        if (candidate !== storeFile && fs.existsSync(candidate)) hits.push(candidate);
      }
      if (depth < maxDepth && (depth === 0 || /^omegavault-mvp/i.test(entry.name))) walk(child, depth + 1);
    }
  };
  walk(baseDir, 0);
  return [...new Set(hits)];
}

function migratePriorLocalVaults() {
  if (process.env.OMEGAVAULT_DATA_DIR) return { imported: 0, sources: [], compilerFilesCopied: 0 };
  if (store.all().length) return { imported: 0, sources: [], compilerFilesCopied: 0 };
  const candidates = walkForPriorVaultFiles(path.join(os.homedir(), 'Downloads'));
  let imported = 0;
  let compilerFilesCopied = 0;
  const sources = [];
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      let used = false;
      for (const vault of parsed.vaults ?? []) {
        if (!vault?.id || store.get(vault.id)) continue;
        store.put(vault);
        imported += 1;
        used = true;
      }
      const oldCompilerDir = path.join(path.dirname(file), 'compiler-cache');
      if (fs.existsSync(oldCompilerDir)) {
        fs.mkdirSync(compilerCacheDir, { recursive: true });
        for (const name of fs.readdirSync(oldCompilerDir)) {
          const source = path.join(oldCompilerDir, name);
          const target = path.join(compilerCacheDir, name);
          if (!fs.statSync(source).isFile() || fs.existsSync(target)) continue;
          fs.copyFileSync(source, target);
          compilerFilesCopied += 1;
        }
      }
      if (used) sources.push(file);
    } catch { /* ignore malformed prior local build data */ }
  }
  return { imported, sources, compilerFilesCopied };
}

const migrationResult = migratePriorLocalVaults();

const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png'
};

function sourceSha256() {
  return crypto.createHash('sha256').update(fs.readFileSync(contractSourcePath)).digest('hex');
}

function securityHeaders(extra = {}) {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    ...extra
  };
}

function json(res, status, body) {
  res.writeHead(status, securityHeaders({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }));
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Request body too large.');
  }
  if (!body) return {};
  return JSON.parse(body);
}

function routeMatch(urlPath, expression) {
  const match = urlPath.match(expression);
  return match ? match.groups ?? {} : null;
}

function publicRecord(vault) {
  return publicVault(vault);
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (req.method === 'GET' && p === '/api/health') {
    return json(res, 200, { ok: true, service: 'OmegaVault', version: APP_VERSION, mode: 'test-proof' });
  }
  if (req.method === 'GET' && p === '/api/config') {
    return json(res, 200, {
      appVersion: APP_VERSION,
      mode: 'test-proof',
      productionValueAllowed: false,
      mainnetTransactionsEnabled: false,
      ethereumProof: {
        adapterVersion: ETHEREUM_ADAPTER_VERSION,
        contractVersion: CONTRACT_VERSION,
        allowedNetwork: { id: SEPOLIA_CHAIN_ID, name: 'Sepolia', testOnly: true }
      }
    });
  }
  if (req.method === 'GET' && p === '/api/chains') return json(res, 200, { chains: listChains() });
  if (req.method === 'GET' && p === '/api/chain-capabilities') {
    const catalog = createCapabilityCatalogResponse();
    return json(res, 200, createValidatedCapabilityCatalogResponse(catalog));
  }
  if (req.method === 'GET' && p === '/api/evidence-provenance') {
    const catalog = createEvidenceProvenanceCatalog();
    return json(res, 200, createValidatedEvidenceProvenanceCatalogResponse(catalog));
  }
  if (req.method === 'GET' && p === '/api/evidence-history') {
    const catalog = createEvidenceHistoryCatalog();
    return json(res, 200, createValidatedEvidenceHistoryCatalogResponse(catalog));
  }
  if (req.method === 'GET' && p === '/api/evidence-diagnostics') {
    const catalog = createEvidenceDiagnosticsCatalog();
    return json(res, 200, createValidatedEvidenceDiagnosticsCatalogResponse(catalog));
  }
  if (req.method === 'GET' && p === '/api/vaults') return json(res, 200, { vaults: store.all().map(publicRecord) });
  if (req.method === 'GET' && p === '/api/ethereum/contract-source') {
    return json(res, 200, {
      name: 'OmegaVaultRecoveryVault',
      contractVersion: CONTRACT_VERSION,
      adapterVersion: ETHEREUM_ADAPTER_VERSION,
      compilerVersion: SOLC_0_8_24.version,
      sourceSha256: sourceSha256(),
      source: fs.readFileSync(contractSourcePath, 'utf8')
    });
  }
  if (req.method === 'GET' && p === '/api/ethereum/compiler') {
    const cachePath = path.join(compilerCacheDir, SOLC_0_8_24.filename);
    return json(res, 200, {
      version: SOLC_0_8_24.version,
      source: SOLC_0_8_24.url,
      cached: fs.existsSync(cachePath) && fs.statSync(cachePath).size > 1_000_000
    });
  }

  if (req.method === 'POST' && p === '/api/vaults') {
    const vault = createVault(await readJson(req));
    store.put(vault);
    return json(res, 201, { vault: publicRecord(vault) });
  }

  let match = routeMatch(p, /^\/api\/vaults\/(?<id>[0-9a-f-]+)$/i);
  if (req.method === 'GET' && match) {
    const vault = store.get(match.id);
    return vault ? json(res, 200, { vault: publicRecord(vault) }) : json(res, 404, { error: 'Vault not found.' });
  }

  match = routeMatch(p, /^\/api\/vaults\/(?<id>[0-9a-f-]+)\/heartbeat$/i);
  if (req.method === 'POST' && match) {
    const vault = store.get(match.id);
    if (!vault) return json(res, 404, { error: 'Vault not found.' });
    const body = await readJson(req);
    heartbeat(vault, body.owner);
    store.put(vault);
    return json(res, 200, { vault: publicRecord(vault) });
  }

  match = routeMatch(p, /^\/api\/vaults\/(?<id>[0-9a-f-]+)\/recovery\/request$/i);
  if (req.method === 'POST' && match) {
    const vault = store.get(match.id);
    if (!vault) return json(res, 404, { error: 'Vault not found.' });
    const body = await readJson(req);
    requestRecovery(vault, body.requester, body.destination, new Date(), { bypassInactivityForTest: body.testMode === true });
    store.put(vault);
    return json(res, 200, { vault: publicRecord(vault) });
  }

  match = routeMatch(p, /^\/api\/vaults\/(?<id>[0-9a-f-]+)\/recovery\/approve$/i);
  if (req.method === 'POST' && match) {
    const vault = store.get(match.id);
    if (!vault) return json(res, 404, { error: 'Vault not found.' });
    const body = await readJson(req);
    approveRecovery(vault, body.contact);
    store.put(vault);
    return json(res, 200, { vault: publicRecord(vault) });
  }

  match = routeMatch(p, /^\/api\/vaults\/(?<id>[0-9a-f-]+)\/recovery\/complete$/i);
  if (req.method === 'POST' && match) {
    const vault = store.get(match.id);
    if (!vault) return json(res, 404, { error: 'Vault not found.' });
    const body = await readJson(req);
    markRecovered(vault, body.executor, body.txRef);
    store.put(vault);
    return json(res, 200, { vault: publicRecord(vault) });
  }

  match = routeMatch(p, /^\/api\/vaults\/(?<id>[0-9a-f-]+)\/chain\/bind$/i);
  if (req.method === 'POST' && match) {
    const vault = store.get(match.id);
    if (!vault) return json(res, 404, { error: 'Vault not found.' });
    bindChainDeployment(vault, await readJson(req));
    store.put(vault);
    return json(res, 200, { vault: publicRecord(vault) });
  }

  match = routeMatch(p, /^\/api\/vaults\/(?<id>[0-9a-f-]+)\/chain\/activity$/i);
  if (req.method === 'POST' && match) {
    const vault = store.get(match.id);
    if (!vault) return json(res, 404, { error: 'Vault not found.' });
    recordChainActivity(vault, await readJson(req));
    store.put(vault);
    return json(res, 200, { vault: publicRecord(vault) });
  }

  return json(res, 404, { error: 'API route not found.' });
}

async function serveCompiler(res) {
  const filePath = await ensureSolcCompiler(compilerCacheDir);
  res.writeHead(200, securityHeaders({
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'public, max-age=31536000, immutable',
    'content-security-policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'"
  }));
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res, url) {
  const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden.' });
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('not a file');
    res.writeHead(200, securityHeaders({
      'content-type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
    }));
    fs.createReadStream(filePath).pipe(res);
  } catch {
    json(res, 404, { error: 'Not found.' });
  }
}

export function createOmegaVaultServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/vendor/solc-0.8.24.js') return await serveCompiler(res);
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return serveStatic(req, res, url);
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : (error.code === 'INVALID_POLICY' ? 422 : 400);
      json(res, status, { error: error.message, details: error.details ?? undefined });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createOmegaVaultServer();
  server.listen(port, () => {
    console.log(`OmegaVault ${APP_VERSION} test-proof running at http://localhost:${port}`);
    console.log(`Persistent test data: ${dataDir}`);
    if (migrationResult.imported) console.log(`Imported ${migrationResult.imported} prior vault(s) from ${migrationResult.sources.length} local build(s).`);
    if (migrationResult.compilerFilesCopied) console.log(`Reused ${migrationResult.compilerFilesCopied} cached Solidity compiler file(s) from a prior build.`);
    const interfaces = os.networkInterfaces();
    const lan = Object.values(interfaces).flat().filter(item => item?.family === 'IPv4' && !item.internal);
    for (const item of lan) console.log(`Phone on the same trusted LAN: http://${item.address}:${port}`);
  });
}
