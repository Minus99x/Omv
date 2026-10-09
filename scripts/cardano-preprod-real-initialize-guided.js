import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  createCardanoOgmiosHttpClient,
  fetchCardanoBlockfrostPreprodAddressUtxos,
  fetchCardanoBlockfrostPreprodProtocolParameters,
  selectCardanoPreprodInitializeUtxos,
  normalizeCardanoOgmiosWebSocketUrl,
  parseCardanoOgmiosTipResponse
} from '../src/chains/cardano/preprod-live-capture.js';
import {
  cardanoPreprodPaymentKeyHashFromAddress,
  createCardanoPreprodRecoveryConfiguration,
  verifyCardanoPreprodRecoveryConfiguration
} from '../src/chains/cardano/preprod-recovery-config.js';

const FORBIDDEN = Object.freeze([
  '--private-key',
  '--secret-key',
  '--seed',
  '--seed-phrase',
  '--recovery-phrase',
  '--mnemonic',
  '--sign',
  '--submit',
  '--blockfrost-project-id',
  '--ogmios-api-key'
]);

const EXPECTED_BRANCH = 'dev/0.6.60-reconcile-overnight-bitcoin';
const PLACEHOLDER = /^(?:PASTE-|<|YOUR-|REPLACE-)/i;
const ENDPOINT = /^(?:https?|wss?):\/\//i;

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function git(args) {
  const result = spawnSync('git', args, { encoding:'utf8', windowsHide:true });
  if (result.status !== 0) throw new Error(`Git preflight failed: ${String(result.stderr || result.stdout).trim() || args.join(' ')}`);
  return String(result.stdout ?? '').trim();
}

function requireWorkstationSourceIdentity() {
  const activeBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (activeBranch !== EXPECTED_BRANCH) {
    throw new Error(`Wrong OmegaVault branch. Expected ${EXPECTED_BRANCH}; current branch is ${activeBranch}. Switch/update the reconciliation branch before capture.`);
  }
  const trackedChanges = git(['status', '--porcelain', '--untracked-files=no']);
  if (trackedChanges) {
    throw new Error('Tracked OmegaVault files are modified. Commit/stash/revert them before generating Cardano evidence.');
  }
  const head = git(['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error('Could not resolve the exact OmegaVault source commit.');
  return Object.freeze({ branch:activeBranch, head });
}

function help() {
  output.write([
    'OmegaVault Cardano Preprod guided REAL initialize capture',
    '',
    'Usage:',
    '  npm.cmd run cardano:preprod:real-initialize:guided',
    '',
    'Optional non-secret arguments:',
    '  --session-root <path>        Append-only session directory (default: timestamped sibling directory)',
    '  --stable-tip-retries <1-30> Stable-tip retries (default: 8)',
    '  --inactivity-ms <integer>    Preprod test inactivity interval (default: 60000)',
    '  --state-lovelace <integer>   State output lovelace (default: 10000000)',
    '',
    'The guided flow reads the owner, rescue and two trusted-contact Preprod addresses from the Windows clipboard.',
    'Provider credentials are read from existing environment variables when available or requested through the clipboard without being printed.',
    'The flow performs read/evaluation network requests only and stops at an unsigned initialize candidate.',
    'Wallet signing and transaction submission remain unauthorized.',
    ''
  ].join('\n'));
}

function readClipboard() {
  if (process.platform !== 'win32') throw new Error('Guided real initialize currently requires Windows PowerShell clipboard access.');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw'],
    { encoding:'utf8', windowsHide:true }
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
  if (typeof value !== 'string' || PLACEHOLDER.test(value) || /[\r\n]/.test(value)) return false;
  try {
    normalizeCardanoOgmiosWebSocketUrl(value);
    return true;
  } catch {
    return false;
  }
}

function validPreprodAddress(value) {
  try {
    cardanoPreprodPaymentKeyHashFromAddress(value);
    return true;
  } catch {
    return false;
  }
}

function isUnauthorized(error) {
  return /(?:HTTP|handshake returned HTTP)\s+401\b/i.test(String(error?.message ?? error));
}

async function collectClipboard(rl, label, validator, invalidMessage) {
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

function useEnvironment(name, validator) {
  const value = process.env[name];
  if (!validator(value)) return null;
  output.write(`${name}: using existing environment value without displaying it.\n`);
  return value;
}

async function probeOgmios(url, apiKey = null) {
  const client = createCardanoOgmiosHttpClient({
    url,
    apiKey,
    apiKeyHeader:'dmtr-api-key'
  });
  try {
    const response = await client.rpc('queryNetwork/tip', undefined, 'omegavault-guided-real-initialize-preflight');
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

const forbidden = FORBIDDEN.find(flag => process.argv.includes(flag));
if (forbidden) {
  throw new Error(`${forbidden} is forbidden in the guided real-initialize flow. Secrets/signing/submission authority are never accepted on the command line.`);
}

const retries = Number(arg('--stable-tip-retries', '8'));
const inactivityMs = Number(arg('--inactivity-ms', '60000'));
const stateLovelace = arg('--state-lovelace', '10000000');
if (!Number.isInteger(retries) || retries < 1 || retries > 30) throw new TypeError('--stable-tip-retries must be an integer from 1 through 30.');
if (!Number.isSafeInteger(inactivityMs) || inactivityMs < 1) throw new TypeError('--inactivity-ms must be a positive safe integer.');
if (!/^\d+$/.test(String(stateLovelace)) || BigInt(stateLovelace) < 1n) throw new TypeError('--state-lovelace must be a positive integer.');

const sourceIdentity = requireWorkstationSourceIdentity();

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const sessionRoot = resolve(arg('--session-root', resolve('..', `omegavault-cardano-preprod-real-initialize-${timestamp}`)));
const recoveryConfigPath = resolve(sessionRoot, 'recovery-config.json');
const captureOutput = resolve(sessionRoot, 'capture');
const sessionPlanPath = resolve(sessionRoot, 'session-plan.json');

const rl = createInterface({ input, output });

try {
  output.write('OmegaVault Cardano Preprod guided REAL initialize capture\n');
  output.write('This flow performs read/evaluation requests only. It cannot sign or submit a transaction.\n');
  output.write('Do not place a seed phrase, private key or recovery phrase on the clipboard.\n\n');

  const walletAddress = await collectClipboard(
    rl,
    'the OWNER Cardano PREPROD wallet address (addr_test1...)',
    validPreprodAddress,
    'That clipboard value is not a spendable Cardano Preprod address.'
  );
  const rescueAddress = await collectClipboard(
    rl,
    'the RESCUE Cardano PREPROD address (addr_test1...)',
    validPreprodAddress,
    'That clipboard value is not a spendable Cardano Preprod address.'
  );
  const contactA = await collectClipboard(
    rl,
    'trusted contact A Cardano PREPROD address (addr_test1...)',
    validPreprodAddress,
    'That clipboard value is not a spendable Cardano Preprod address.'
  );
  const contactB = await collectClipboard(
    rl,
    'trusted contact B Cardano PREPROD address (addr_test1...)',
    validPreprodAddress,
    'That clipboard value is not a spendable Cardano Preprod address.'
  );

  const recoveryConfig = createCardanoPreprodRecoveryConfiguration({
    rescueAddress,
    contactAddresses:[contactA, contactB],
    threshold:2,
    inactivityMs,
    stateLovelace
  });
  const recoveryVerification = verifyCardanoPreprodRecoveryConfiguration(recoveryConfig);
  if (!recoveryVerification.valid) throw new Error(`Recovery configuration failed self-verification: ${recoveryVerification.errors.join('; ')}`);

  let blockfrostProjectId = useEnvironment('BLOCKFROST_PROJECT_ID', validSecret);
  if (!blockfrostProjectId) {
    blockfrostProjectId = await collectClipboard(
      rl,
      'the Blockfrost PREPROD project ID',
      validSecret,
      'That clipboard value does not look like a Blockfrost project ID.'
    );
  }

  let copiedOgmiosUrl = useEnvironment('OMEGAVAULT_OGMIOS_URL', validEndpoint);
  if (!copiedOgmiosUrl) {
    copiedOgmiosUrl = await collectClipboard(
      rl,
      'a Demeter Ogmios PREPROD endpoint URL',
      validEndpoint,
      'That clipboard value is not a usable Ogmios endpoint URL.'
    );
  }
  const ogmiosUrl = normalizeCardanoOgmiosWebSocketUrl(copiedOgmiosUrl);

  output.write('\nRead-only provider preflight: checking Ogmios and Blockfrost Preprod...\n');
  let ogmiosApiKey = useEnvironment('OMEGAVAULT_OGMIOS_API_KEY', validSecret);
  let tip;
  if (ogmiosApiKey) {
    tip = await probeOgmios(ogmiosUrl, ogmiosApiKey);
  } else {
    try {
      tip = await probeOgmios(ogmiosUrl, null);
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
      ogmiosApiKey = await collectClipboard(
        rl,
        'the API key from that SAME Demeter Ogmios resource',
        validSecret,
        'That clipboard value does not look like an Ogmios API key.'
      );
      tip = await probeOgmios(ogmiosUrl, ogmiosApiKey);
    }
  }

  await fetchCardanoBlockfrostPreprodProtocolParameters({ projectId:blockfrostProjectId });
  output.write(`Provider preflight passed at Ogmios Preprod tip slot ${tip.slot}.\n`);

  output.write('Checking the owner wallet for two distinct plain ADA-only Preprod UTxOs...\n');
  const discoveredUtxos = await fetchCardanoBlockfrostPreprodAddressUtxos({
    projectId:blockfrostProjectId,
    address:walletAddress
  });
  const selectedUtxos = selectCardanoPreprodInitializeUtxos(discoveredUtxos);
  output.write(`Wallet UTxO preflight passed: ${discoveredUtxos.length} total UTxO(s), with a valid seed/funding + collateral pair selected.\n`);

  rl.close();

  await mkdir(sessionRoot, { recursive:false });
  await writeFile(recoveryConfigPath, `${JSON.stringify(recoveryConfig, null, 2)}\n`, { flag:'wx' });

  const sessionPlan = Object.freeze({
    schema:'omegavault.cardano.preprod-guided-real-initialize-session.v1',
    network:'preprod',
    sourceBranch:sourceIdentity.branch,
    sourceHead:sourceIdentity.head,
    recoveryConfigurationSha256:recoveryConfig.configurationSha256,
    recoveryConfigPath,
    captureOutput,
    stableTipRetries:retries,
    providerPreflightComplete:true,
    walletUtxoPreflightComplete:true,
    discoveredWalletUtxoCount:discoveredUtxos.length,
    selectedSeedReference:selectedUtxos.seed,
    selectedCollateralReference:selectedUtxos.collateral,
    providerSecretsPersisted:false,
    walletSigningAuthorized:false,
    transactionSubmissionAuthorized:false,
    liveValueMovementAuthorized:false,
    supportClaimAuthorized:false,
    nextGate:'real-initialize-read-evaluation-capture'
  });
  await writeFile(sessionPlanPath, `${JSON.stringify(sessionPlan, null, 2)}\n`, { flag:'wx' });

  output.write('\nLaunching the real Preprod initialize READ/EVALUATION capture now.\n');
  const result = spawnSync(
    process.execPath,
    [
      'scripts/capture-cardano-preprod-real-initialize.js',
      '--wallet-address', walletAddress,
      '--recovery-config', recoveryConfigPath,
      '--output', captureOutput,
      '--stable-tip-retries', String(retries)
    ],
    {
      cwd:process.cwd(),
      stdio:'inherit',
      windowsHide:true,
      env:{
        ...process.env,
        BLOCKFROST_PROJECT_ID:blockfrostProjectId,
        OMEGAVAULT_OGMIOS_URL:ogmiosUrl,
        OMEGAVAULT_OGMIOS_API_KEY:ogmiosApiKey ?? '',
        OMEGAVAULT_OGMIOS_API_KEY_HEADER:'dmtr-api-key'
      }
    }
  );

  if (result.status !== 0) {
    process.stderr.write(`Guided real initialize capture stopped with status ${result.status ?? 'unknown'}. The session plan and recovery configuration were preserved for diagnosis/retry.\n`);
    process.exitCode = 2;
  } else {
    output.write('\nOmegaVault guided real initialize capture completed.\n');
    output.write(`Session root: ${sessionRoot}\n`);
    output.write(`Capture evidence: ${captureOutput}\n`);
    output.write('HARD STOP: the candidate is unsigned. Do not sign or submit until the separate authorization gate is explicitly reached.\n');
  }
} catch (error) {
  try { rl.close(); } catch {}
  process.stderr.write(`OmegaVault guided real initialize blocked: ${error.message}\n`);
  process.exitCode = 2;
}
