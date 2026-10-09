import {
  createCardanoOgmiosHttpClient,
  normalizeCardanoOgmiosWebSocketUrl,
  parseCardanoOgmiosTipResponse
} from '../src/chains/cardano/preprod-live-capture.js';

const urlRaw = process.env.OMEGAVAULT_OGMIOS_URL ?? null;
const apiKey = process.env.OMEGAVAULT_OGMIOS_API_KEY ?? null;
const apiKeyHeader = process.env.OMEGAVAULT_OGMIOS_API_KEY_HEADER ?? 'dmtr-api-key';

function help() {
  process.stdout.write([
    'OmegaVault Cardano Preprod Ogmios reconnect diagnostic',
    '',
    'Required environment values:',
    '  OMEGAVAULT_OGMIOS_URL',
    '',
    'Optional:',
    '  OMEGAVAULT_OGMIOS_API_KEY (used only if the endpoint itself does not authenticate)',
    '  OMEGAVAULT_OGMIOS_API_KEY_HEADER (default: dmtr-api-key)',
    '',
    'The diagnostic opens one authenticated read-only WebSocket connection,',
    'queries the Preprod tip, fully closes it, then opens a second authenticated',
    'connection and queries the tip again. Provider credentials are never printed.',
    'No wallet signing, transaction construction, or submission is performed.',
    ''
  ].join('\n'));
}

async function probeOnce(url, label, selectedApiKey = null) {
  const client = createCardanoOgmiosHttpClient({
    url,
    apiKey:selectedApiKey,
    apiKeyHeader
  });
  try {
    const response = await client.rpc('queryNetwork/tip', undefined, `omegavault-ogmios-diagnostic-${label}`);
    return parseCardanoOgmiosTipResponse(response);
  } finally {
    if (typeof client.closeAndWait === 'function') await client.closeAndWait();
    else client.close();
  }
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  help();
  process.exit(0);
}

if (!urlRaw) {
  process.stderr.write('Ogmios reconnect diagnostic requires OMEGAVAULT_OGMIOS_URL.\n');
  process.exitCode = 2;
} else {
  try {
    const url = normalizeCardanoOgmiosWebSocketUrl(urlRaw);
    let selectedApiKey = null;

    process.stdout.write('Ogmios diagnostic: first authenticated read-only connection...\n');
    let first;
    try {
      first = await probeOnce(url, 'first', null);
    } catch (error) {
      const unauthorized = /(?:HTTP|handshake returned HTTP)\s+401\b/i.test(String(error?.message ?? error));
      if (!unauthorized || !apiKey) throw error;
      selectedApiKey = apiKey;
      first = await probeOnce(url, 'first-header-auth', selectedApiKey);
    }
    process.stdout.write(`First connection passed at Preprod tip slot ${first.slot}. Socket fully closed.\n`);

    process.stdout.write('Ogmios diagnostic: second authenticated read-only connection...\n');
    const second = await probeOnce(url, 'second', selectedApiKey);
    process.stdout.write(`Second connection passed at Preprod tip slot ${second.slot}. Socket fully closed.\n`);

    process.stdout.write(`${JSON.stringify({
      schema:'omegavault.cardano.preprod-ogmios-reconnect-diagnostic.v1',
      ok:true,
      firstTip:first,
      secondTip:second,
      credentialsPrinted:false,
      networkRequestsPerformed:true,
      walletSigningPerformed:false,
      transactionSubmissionPerformed:false
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Ogmios reconnect diagnostic blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
