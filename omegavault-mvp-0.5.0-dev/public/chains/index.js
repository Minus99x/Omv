import { ethereumAdapter } from './ethereum.js';

const adapters = new Map([[ethereumAdapter.id, ethereumAdapter]]);

export function getBrowserChain(id) {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`No browser adapter registered for ${id}.`);
  return adapter;
}
