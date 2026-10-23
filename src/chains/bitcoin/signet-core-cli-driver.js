import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const METHODS = Object.freeze(new Set([
  'getrawtransaction', 'getblockheader', 'getblockchaininfo',
  'gettxout', 'getblockhash'
]));
const HEX32 = /^[0-9a-f]{64}$/i;
const SATOSHIS = 100_000_000;
const MAX_MONEY_SATS = 21_000_000n * 100_000_000n;

function hash(value, label) {
  if (typeof value !== 'string' || !HEX32.test(value)) {
    throw new TypeError(label + ' must be 32-byte hex.');
  }
  return value.toLowerCase();
}
function height(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 0xffffffff) {
    throw new TypeError(label + ' must be a positive uint32 height.');
  }
  return value;
}
function vout(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new TypeError('Bitcoin rescue vout must be a uint32 integer.');
  }
  return value;
}
function confirmations(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 0xffffffff) {
    throw new TypeError(label + ' must be a positive uint32 integer.');
  }
  return value;
}
function sats(value) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new TypeError('Bitcoin Core UTXO value must be a BTC decimal.');
  }
  let amount;
  if (typeof value === 'string') {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value)) {
      throw new TypeError('Bitcoin Core UTXO value must be an exact BTC decimal.');
    }
    const [whole, frac = ''] = value.split('.');
    amount = BigInt(whole) * 100_000_000n + BigInt(frac.padEnd(8, '0'));
  } else {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError('Bitcoin Core UTXO value must be finite and non-negative.');
    }
    const scaled = value * SATOSHIS;
    if (!Number.isSafeInteger(Math.round(scaled)) ||
        Math.abs(scaled - Math.round(scaled)) > 1e-6) {
      throw new TypeError('Bitcoin Core UTXO value contains fractional satoshis.');
    }
    amount = BigInt(Math.round(scaled));
  }
  if (amount < 1n || amount > MAX_MONEY_SATS) {
    throw new TypeError('Bitcoin Core rescue UTXO value is outside Bitcoin money limits.');
  }
  return amount.toString();
}
function network(value) {
  if (value !== 'bitcoin:signet') throw new Error('Bitcoin Core observation is Signet-only.');
}
function clock(now) {
  const result = now();
  if (typeof result !== 'string' || !Number.isFinite(Date.parse(result)) ||
      !/(?:Z|[+-]\d{2}:\d{2})$/.test(result)) {
    throw new TypeError('Bitcoin Core observation clock must return an ISO timestamp with timezone.');
  }
  return result;
}

// A purpose-built, fixed-method, read-only observation adapter.
// No wallet, RPC endpoint overrides, shell, credentials, signing or broadcast.
export function createBitcoinSignetObservationCoreCliDriver({
  execute = execFileAsync, now = () => new Date().toISOString()
} = {}) {
  if (typeof execute !== 'function' || typeof now !== 'function') {
    throw new TypeError('Bitcoin Core observation executor and clock must be functions.');
  }
  async function query(method, params = []) {
    if (!METHODS.has(method)) throw new Error('Unapproved Bitcoin Core observation method.');
    let response;
    try {
      response = await execute('bitcoin-cli', ['-signet', method, ...params], {
        timeout:15000, maxBuffer:16 * 1024 * 1024, shell:false, windowsHide:true
      });
    } catch {
      throw new Error('Bitcoin Signet read-only observation unavailable or rejected: ' + method);
    }
    if (typeof response?.stdout !== 'string') throw new Error('Bitcoin Core observation returned non-text output.');
    const output = response.stdout.trim();
    if (method === 'getblockhash' && HEX32.test(output)) return output.toLowerCase();
    try { return JSON.parse(output); }
    catch { throw new Error('Bitcoin Core returned malformed JSON for ' + method); }
  }
  return Object.freeze({
    provenance:'bitcoin-core-rpc',
    async readTransaction({transactionId, networkRef}) {
      network(networkRef);
      const wanted = hash(transactionId, 'transactionId');
      const transaction = await query('getrawtransaction', [wanted, 'true']);
      if (hash(transaction?.txid, 'getrawtransaction.txid') !== wanted) {
        throw new Error('Bitcoin Core returned another transaction.');
      }
      if (transaction.in_active_chain === false) throw new Error('Bitcoin transaction is not on active Signet chain.');
      const depth = confirmations(transaction.confirmations, 'getrawtransaction.confirmations');
      const blockHash = hash(transaction.blockhash, 'getrawtransaction.blockhash');
      const header = await query('getblockheader', [blockHash, 'true']);
      if (hash(header?.hash, 'getblockheader.hash') !== blockHash) {
        throw new Error('Bitcoin Core block header identity differs from transaction block.');
      }
      height(header?.height, 'getblockheader.height');
      confirmations(header?.confirmations, 'getblockheader.confirmations');
      if (header.confirmations !== depth) {
        throw new Error('Bitcoin Core transaction/header confirmation depth changed during observation.');
      }
      return Object.freeze({
        transactionId:wanted, networkRef:'bitcoin:signet',
        confirmations:depth, blockHash, blockHeight:header.height, observedAt:clock(now)
      });
    },
    async readChainTip({networkRef}) {
      network(networkRef);
      const info = await query('getblockchaininfo');
      if (info?.chain !== 'signet' || info?.initialblockdownload !== false) {
        throw new Error('Bitcoin Core is not a synchronized Signet node.');
      }
      return Object.freeze({
        networkRef:'bitcoin:signet',
        blockHash:hash(info.bestblockhash, 'getblockchaininfo.bestblockhash'),
        blockHeight:height(info.blocks, 'getblockchaininfo.blocks'),
        observedAt:clock(now)
      });
    },
    async readBlockHashAtHeight({blockHeight, networkRef}) {
      network(networkRef);
      const target = height(blockHeight, 'blockHeight');
      const result = await query('getblockhash', [String(target)]);
      return hash(result, 'getblockhash result');
    },
    async readTxOut({transactionId, vout:outputIndex, networkRef}) {
      network(networkRef);
      const wanted = hash(transactionId, 'transactionId');
      const n = vout(outputIndex);
      const result = await query('gettxout', [wanted, String(n), 'true']);
      if (result === null) throw new Error('Bitcoin rescue output is spent or not in the active UTXO set.');
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new TypeError('Bitcoin Core gettxout returned an invalid record.');
      }
      confirmations(result.confirmations, 'gettxout.confirmations');
      hash(result.bestblock, 'gettxout.bestblock');
      const script = result.scriptPubKey?.hex;
      if (typeof script !== 'string' || !/^[0-9a-f]+$/i.test(script) || script.length % 2) {
        throw new TypeError('Bitcoin Core gettxout script must be complete hex.');
      }
      return Object.freeze({
        txid:wanted, vout:n, amountSats:sats(result.value),
        scriptPubKey:script.toLowerCase(),
        bestBlockHash:hash(result.bestblock, 'gettxout.bestblock'),
        confirmations:result.confirmations, unspent:true
      });
    }
  });
}
