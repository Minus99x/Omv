import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  createCardanoOgmiosHttpClient,
  fetchCardanoBlockfrostPreprodProtocolParameters,
  parseCardanoOgmiosTipResponse
} from '../src/chains/cardano/preprod-live-capture.js';

const PLACEHOLDER = /^(?:PASTE-|<|YOUR-|REPLACE-)/i;
const ENDPOINT = /^(?:https?|wss?):\/\//i;

function readClipboard() {
  if (process.platform !== 'win32') {
    throw new Error('Guided provider bootstrap currently requires Windows PowerShell clipboard access.');
  }
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw'],
    { encoding: 'utf8', windowsHide: true }
  );
  if (result.status !== 0) throw new Error('Could not read the Windows clipboard.');
  return String(result.stdout ?? '').trim();
}

function validSecret(value) {
  return typeof value === 'string' &&
    value.length >= 6 &&
    !PLACEHOLDER.test(value) &&
    !ENDPOINT.test(value) &&
    !/[\r\n]/.test(value);
}

function validEndpoint(value) {
  return typeof value === 'string' &&
    ENDPOINT.test(value) &&
    !PLACEHOLDER.test(value) &&
    !/[\r\n]/.test(value);
}

async function collectFromClipboard(rl, label, validator, invalidMessage) {
  for (;;) {
    await rl.question(`Copy ${label} to the clipboard, then press Enter here. `);
    const value = readClipboard();
    if (validator(value)) {
      output.write(`${label}: validated without displaying it.\n`);
      return value;
    }
    output.write(`${invalidMessage}\nNothing was saved. Copy the correct value and try again.\n`);
  }
}

const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const forwarded = process.argv.slice(2);
const rl = createInterface({ input, output });

let client = null;
try {
  output.write('OmegaVault Cardano Preprod guided provider bootstrap\n');
  output.write('Secrets remain process-local and are never printed or placed on the command line.\n');
  output.write('No wallet signing or transaction submission is authorized by this bootstrap.\n\n');

  const blockfrostProjectId = await collectFromClipboard(
    rl,
    'the Blockfrost PREPROD project ID',
    validSecret,
    'That clipboard value does not look like a Blockfrost project ID.'
  );

  const ogmiosUrl = await collectFromClipboard(
    rl,
    'the normal Demeter Ogmios Endpoint URL',
    validEndpoint,
    'That clipboard value is not an http(s)/ws(s) endpoint URL.'
  );

  const ogmiosApiKey = await collectFromClipboard(
    rl,
    'the API Key from that SAME Demeter Ogmios resource',
    validSecret,
    'That clipboard value does not look like an Ogmios API key.'
  );

  rl.close();

  output.write('\nTesting providers before creating any campaign directory...\n');
  client = createCardanoOgmiosHttpClient({
    url: ogmiosUrl,
    apiKey: ogmiosApiKey,
    apiKeyHeader: 'dmtr-api-key'
  });

  const tip = parseCardanoOgmiosTipResponse(
    await client.rpc('queryNetwork/tip', undefined, 'omegavault-guided-provider-preflight')
  );
  await fetchCardanoBlockfrostPreprodProtocolParameters({ projectId: blockfrostProjectId });
  client.close();
  client = null;

  output.write(`Provider preflight passed: Ogmios Preprod tip slot ${tip.slot}; Blockfrost Preprod responded successfully.\n`);
  output.write('Launching evaluation-only capture.\n\n');

  const result = spawnSync(
    process.execPath,
    ['scripts/capture-cardano-preprod-evaluation-campaign.js', ...forwarded],
    {
      cwd: projectRoot,
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        BLOCKFROST_PROJECT_ID: blockfrostProjectId,
        OMEGAVAULT_OGMIOS_URL: ogmiosUrl,
        OMEGAVAULT_OGMIOS_API_KEY: ogmiosApiKey,
        OMEGAVAULT_OGMIOS_API_KEY_HEADER: 'dmtr-api-key'
      }
    }
  );

  process.exitCode = Number.isInteger(result.status) ? result.status : 2;
} catch (error) {
  try { rl.close(); } catch {}
  client?.close?.();
  process.stderr.write(`OmegaVault Cardano provider bootstrap blocked: ${error.message}\n`);
  process.exitCode = 2;
}
