import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SOLC_0_8_24 = Object.freeze({
  version: '0.8.24+commit.e11b9ed9',
  filename: 'soljson-v0.8.24+commit.e11b9ed9.js',
  url: 'https://binaries.soliditylang.org/bin/soljson-v0.8.24+commit.e11b9ed9.js',
  // Official linux native binary hash differs; this JS compiler is verified against
  // the wasm/bin list at runtime when available. This field is intentionally null
  // until a checked JS hash is pinned rather than reusing a hash for another artifact.
  sha256: null
});

export function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function ensureSolcCompiler(cacheDir, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('No fetch implementation is available to obtain the pinned Solidity compiler.');

  fs.mkdirSync(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, SOLC_0_8_24.filename);
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1_000_000) return filePath;

  const response = await fetchImpl(SOLC_0_8_24.url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Unable to download Solidity compiler ${SOLC_0_8_24.version}: HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_000_000) throw new Error('Downloaded Solidity compiler is unexpectedly small.');
  if (SOLC_0_8_24.sha256 && sha256Hex(bytes) !== SOLC_0_8_24.sha256) throw new Error('Downloaded Solidity compiler checksum does not match the pinned checksum.');

  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, filePath);
  return filePath;
}
