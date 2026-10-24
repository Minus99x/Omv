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
    getNetworkInfo:async () => {
      const info=await query(METHODS.getNetworkInfo);
      if (!Number.isSafeInteger(info?.version) || info.version<=0 ||
          !Number.isSafeInteger(info?.protocolversion) || info.protocolversion<=0 ||
          typeof info?.subversion!=='string' || !info.subversion.trim() ||
          /[\u0000-\u001f\u007f]/.test(info.subversion)) {
        throw new Error('Bitcoin Core returned invalid node version/protocol metadata.');
      }
      return info;
    },
    getBlockchainInfo:async () => {
      const info=await query(METHODS.getBlockchainInfo);
      if (!info || typeof info!=='object' || info.chain!=='signet') {
        throw new Error('Bitcoin Core CLI response is not Signet chain identity.');
      }
      if(info.initialblockdownload!==false ||
          !Number.isSafeInteger(info.blocks) || info.blocks<1 ||
          !Number.isSafeInteger(info.headers) || info.headers<info.blocks) {
        throw new Error('Bitcoin Core CLI requires a synchronized Signet tip with coherent block identity.');
      }
      return info;
    },
    decodeRawTransaction:({rawHex,networkRef}) => {
      if (networkRef !== 'bitcoin:signet') throw new Error('Bitcoin Core CLI is Signet-only.');
      const verifiedHex=raw(rawHex,'rawHex');
      return query(METHODS.decodeRawTransaction,[verifiedHex]).then(decoded => {
        if (!decoded || typeof decoded!=='object' || Array.isArray(decoded) ||
            typeof decoded.txid!=='string' || !/^[a-fA-F0-9]{64}$/.test(decoded.txid)) {
          throw new Error('Bitcoin Core returned malformed decoded transaction identity.');
        }
        return decoded;
      });
    },
    testMempoolAccept:({rawTransactions,maxFeeRate,networkRef}) => {
      if (networkRef !== 'bitcoin:signet' || maxFeeRate !== 0 ||
          !Array.isArray(rawTransactions) || rawTransactions.length !== 1)
        throw new Error('Bitcoin Core CLI accepts only a single Signet read-only testmempoolaccept call.');
      const verifiedHex=raw(rawTransactions[0],'rawTransactions[0]');
      return query(METHODS.testMempoolAccept,[JSON.stringify([verifiedHex]),'0']).then(outcome => {
        if (!Array.isArray(outcome) || outcome.length!==1 || !outcome[0] ||
            typeof outcome[0]!=='object' || Array.isArray(outcome[0]) ||
            typeof outcome[0].allowed!=='boolean') {
          throw new Error('Bitcoin Core returned malformed single-transaction mempool acceptance evidence.');
        }
        return outcome;
      });
    }
  });
}
