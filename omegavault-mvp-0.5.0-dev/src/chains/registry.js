import { publicAdapterInfo } from './adapter-interface.js';
import ethereum from './adapters/ethereum.js';
import xrpl from './adapters/xrpl.js';
import solana from './adapters/solana.js';
import bitcoin from './adapters/bitcoin.js';
import xdc from './adapters/xdc.js';

const chains = new Map();

export function registerChain(adapter) {
  if (!adapter?.id || typeof adapter.validateAccount !== 'function') {
    throw new TypeError('A chain adapter needs an id and validateAccount(account).');
  }
  if (chains.has(adapter.id)) throw new Error(`Chain adapter already registered: ${adapter.id}`);
  chains.set(adapter.id, adapter);
}

export function getChain(id) {
  return chains.get(id) ?? null;
}

export function listChains() {
  return [...chains.values()].map(publicAdapterInfo);
}

for (const adapter of [ethereum, xrpl, solana, bitcoin, xdc]) registerChain(adapter);
