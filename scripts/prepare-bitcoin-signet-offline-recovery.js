#!/usr/bin/env node
/**
 * Operator-facing offline Bitcoin Signet recovery extraction.
 * Reads a previously signed, threshold-complete PSBTv2. Does NOT sign,
 * contact a node, broadcast, or grant Bitcoin/chain promotion authority.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractBitcoinRecoveryTransaction, createBitcoinFinalTransactionEvidence } from '../src/chains/bitcoin/transaction-finalizer.js';
import { verifyBitcoinFinalTransactionEvidence } from '../src/chains/bitcoin/transaction-finalizer.js';

const allowed = new Set(['--psbt', '--descriptor', '--rescue-script-pubkey', '--expected-fee-sats', '--output']);
function argumentsForOfflinePreparation(argv) {
  if (argv.length !== allowed.size * 2) throw new Error('Expected exactly --psbt, --descriptor, --rescue-script-pubkey, --expected-fee-sats and --output (one value each).');
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i + 1];
    if (!allowed.has(flag)) throw new Error('Unrecognized or forbidden argument: ' + String(flag));
    if (Object.hasOwn(args, flag) || typeof value !== 'string' || !value || value.startsWith('--'))
      throw new Error('Duplicate or missing argument value: ' + flag);
    args[flag] = value;
  }
  if (Object.keys(args).length !== allowed.size) throw new Error('Missing required offline preparation argument.');
  if (!/^(?:0|[1-9][0-9]*)$/.test(args['--expected-fee-sats']))
    throw new Error('Expected fee must be canonical non-negative integer satoshis.');
  return args;
}

function main(argv) {
  const args = argumentsForOfflinePreparation(argv);
  const descriptor = JSON.parse(readFileSync(resolve(args['--descriptor']), 'utf8'));
  // Deliberately accepts only a raw base64 PSBT file, never a wallet key or signing request.
  const psbt = readFileSync(resolve(args['--psbt']), 'utf8').trim();
  const rescueScriptPubKey = args['--rescue-script-pubkey'];
  const transaction = extractBitcoinRecoveryTransaction({ psbt, descriptor, rescueScriptPubKey });
  if (transaction.finalizerEvidence.feeSats !== args['--expected-fee-sats'])
    throw new Error('Finalized Signet recovery fee does not match the operator-approved expected satoshis.');
  const finalTransactionEvidence = createBitcoinFinalTransactionEvidence({ psbt, descriptor, rescueScriptPubKey });
  const verified = verifyBitcoinFinalTransactionEvidence({
    evidence:finalTransactionEvidence, psbt, descriptor, rescueScriptPubKey
  });
  if (!verified.ok || transaction.txid !== finalTransactionEvidence.txid ||
      transaction.wtxid !== finalTransactionEvidence.wtxid ||
      transaction.finalizerEvidence.sha256 !== finalTransactionEvidence.finalizerEvidenceSha256)
    throw new Error('Offline Signet transaction and independent extraction evidence disagree.');
  const artifact = {
    schema:'omegavault.bitcoin.signet-offline-recovery-preparation.v1',
    networkRef:'bitcoin:signet',
    transaction, finalTransactionEvidence,
    operatorExpectedFeeSats:args['--expected-fee-sats'],
    readyForBroadcast:false,
    bitcoinCoreCrossCheckProven:false,
    signetExecutionProven:false,
    authorityBoundary:'Offline signed-PSBT extraction only. Does not sign, submit, broadcast, verify Bitcoin Core, prove inclusion, or authorize live use.'
  };
  // O_EXCL makes existing-output overwrite impossible. Mode 0600 limits local access.
  writeFileSync(resolve(args['--output']), JSON.stringify(artifact,null,2) + '\n', {
    encoding:'utf8', flag:'wx', mode:0o600
  });
  process.stdout.write('BITCOIN_SIGNET_OFFLINE_PREPARATION_OK txid=' + transaction.txid +
    ' output=' + resolve(args['--output']) + '\n');
}

try { main(process.argv.slice(2)); }
catch (error) {
  process.stderr.write('BITCOIN_SIGNET_OFFLINE_PREPARATION_BLOCKED: ' + String(error?.message ?? error) + '\n');
  process.exitCode = 1;
}
