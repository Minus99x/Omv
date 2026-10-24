import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const METHODS = Object.freeze({
  getNetworkInfo:'getnetworkinfo',
  getBlockchainInfo:'getblockchaininfo',
  decodeRawTransaction:'decoderawtransaction',
  testMempoolAccept:'testmempoolaccept'
});
const HEX = /^[0-9a-f]+$/i;

// Only four local, read-only Core commands are possible. No wallet, signing,
// broadcasting, custom RPC flags, passwords, shell or remote node credentials.
export function createBitcoinSignetCoreCliDriver({ execute = execFileAsync } = {}) {
  if (typeof execute !== 'function') throw new TypeError('Bitcoin Core CLI executor must be a function.');
  async function query(method, parameters = []) {
    if (!Object.values(METHODS).includes(method))
      throw new Error('Unapproved Bitcoin Core RPC method.');
    const args = ['-signet', method, ...parameters];
    let output;
    try {
      output = await execute('bitcoin-cli', args, {
        timeout:15000, maxBuffer:16 * 1024 * 1024,
        shell:false, windowsHide:true
      });
    } catch {
      // Never forward tool stderr (which can contain machine-specific details).
      throw new Error('Bitcoin Signet read-only Core CLI unavailable or RPC command rejected: ' + method);
    }
    if (typeof output?.stdout !== 'string') throw new Error('Bitcoin Core CLI must return textual JSON.');
    try { return JSON.parse(output.stdout); }
    catch { throw new Error('Bitcoin Core CLI returned malformed JSON for ' + method); }
  }
  function raw(value, label) {
    if (typeof value !== 'string' || !HEX.test(value) || value.length % 2 !== 0)
      throw new TypeError(label + ' must be canonical complete transaction hex.');
    return value.toLowerCase();
  }
  return Object.freeze({
    provenance:'bitcoin-core-rpc',
    getNetworkInfo:() => query(METHODS.getNetworkInfo),
    getBlockchainInfo:async () => {
      const info=await query(METHODS.getBlockchainInfo);
      if (!info || typeof info!=='object' || info.chain!=='signet') {
        throw new Error('Bitcoin Core CLI response is not Signet chain identity.');
      }
      return info;
    },
    decodeRawTransaction:({rawHex,networkRef}) => {
      if (networkRef !== 'bitcoin:signet') throw new Error('Bitcoin Core CLI is Signet-only.');
      return query(METHODS.decodeRawTransaction,[raw(rawHex,'rawHex')]);
    },
    testMempoolAccept:({rawTransactions,maxFeeRate,networkRef}) => {
      if (networkRef !== 'bitcoin:signet' || maxFeeRate !== 0 ||
          !Array.isArray(rawTransactions) || rawTransactions.length !== 1)
        throw new Error('Bitcoin Core CLI accepts only a single Signet read-only testmempoolaccept call.');
      return query(METHODS.testMempoolAccept,[JSON.stringify([raw(rawTransactions[0],'rawTransactions[0]')]),'0']);
    }
  });
}
