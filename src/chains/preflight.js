import { createHash } from 'node:crypto';

const STATUSES = new Set(['ready', 'warning', 'blocked']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function digestIntent(intent) {
  return createHash('sha256').update(JSON.stringify(canonical(intent))).digest('hex');
}

export function createPreflightResult({ chainId, networkRef, operation, status = 'blocked', observedNetwork = null, requiredSigners = [], fee = null, finalityTarget = null, checks = {}, warnings = [], errors = [], transactionIntent = null }) {
  if ([chainId,networkRef,operation].some(value=>typeof value!=='string'||!value.trim()))
    throw new TypeError('Preflight requires chainId, networkRef and operation.');
  if (!STATUSES.has(status)) throw new TypeError('Unknown preflight status.');
  const result = {
    version: 1, chainId, networkRef, operation, status,
    observedNetwork: observedNetwork ? structuredClone(observedNetwork) : null,
    requiredSigners: [...requiredSigners],
    fee: fee ? structuredClone(fee) : null,
    finalityTarget: finalityTarget ? structuredClone(finalityTarget) : null,
    checks: structuredClone(checks), warnings: [...warnings], errors: [...errors],
    transactionIntent: transactionIntent ? structuredClone(transactionIntent) : null,
    intentDigest: transactionIntent ? digestIntent(transactionIntent) : null
  };
  if (status === 'ready' && errors.length) throw new TypeError('A ready preflight cannot contain errors.');
  return Object.freeze(result);
}
