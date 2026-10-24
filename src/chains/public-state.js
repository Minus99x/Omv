import { createHash } from 'node:crypto';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function definePublicStateCheck({ id, description, expected, comparator = 'equal', required = true }) {
  if (typeof id !== 'string' || !id.trim() || typeof description !== 'string' || !description.trim())
    throw new TypeError('Public-state check requires id and description.');
  if (['__proto__','prototype','constructor'].includes(id))
    throw new TypeError('Public-state check id is reserved.');
  if (!['equal', 'contains', 'truthy', 'custom'].includes(comparator)) throw new TypeError('Unsupported public-state comparator.');
  return Object.freeze({ id, description, expected: structuredClone(expected), comparator, required: required !== false });
}

export function verifyPublicState({ chainId, networkRef, mechanismRef, observedAt, source, checks, observations }) {
  if (!chainId || !networkRef || !mechanismRef || !observedAt || !source) throw new TypeError('Public-state verification requires chain/network/mechanism/time/source.');
  if (!Array.isArray(checks) || !checks.length) throw new TypeError('Public-state verification requires checks.');
  const ids=checks.map(check=>check?.id);
  if(ids.some(id=>typeof id!=='string'||!id.trim()||['__proto__','prototype','constructor'].includes(id))||
    new Set(ids).size!==ids.length)
    throw new TypeError('Public-state checks require unique safe identifiers.');
  const results = checks.map(check => {
    const present=observations!==null&&typeof observations==='object'&&
      Object.hasOwn(observations,check.id);
    const actual = present ? observations[check.id] : undefined;
    let ok = false;
    if (check.comparator === 'equal') ok = JSON.stringify(stable(actual)) === JSON.stringify(stable(check.expected));
    else if (check.comparator === 'contains') ok = Array.isArray(actual) && actual.includes(check.expected);
    else if (check.comparator === 'truthy') ok = Boolean(actual) === Boolean(check.expected ?? true);
    else if (check.comparator === 'custom') ok = actual === true;
    // Missing state cannot equal missing expectations or inherited values.
    ok=present&&ok;
    return Object.freeze({ id: check.id, required: check.required, ok, expected: structuredClone(check.expected), actual: structuredClone(actual) });
  });
  const verified = results.every(item => !item.required || item.ok);
  const body = { chainId, networkRef, mechanismRef, observedAt, source, results };
  return Object.freeze({ ...body, verified, sha256: digest(body) });
}

export function compareIndependentStateSnapshots(a, b, fields) {
  if (!a || !b || a.chainId !== b.chainId || a.networkRef !== b.networkRef || a.mechanismRef !== b.mechanismRef) {
    throw new TypeError('Independent state snapshots must refer to the same mechanism on the same network.');
  }
  if (!Array.isArray(fields) || !fields.length ||
    fields.some(field=>typeof field!=='string'||!field.trim()||['__proto__','prototype','constructor'].includes(field))||
    new Set(fields).size!==fields.length)
    throw new TypeError('fields must be distinct safe field identifiers.');
  const comparisons = fields.map(field => {
    const hasA=a.observations!==null&&typeof a.observations==='object'&&Object.hasOwn(a.observations,field);
    const hasB=b.observations!==null&&typeof b.observations==='object'&&Object.hasOwn(b.observations,field);
    const left=hasA?a.observations[field]:undefined;
    const right=hasB?b.observations[field]:undefined;
    return Object.freeze({
      field, matches:hasA&&hasB&&JSON.stringify(stable(left))===JSON.stringify(stable(right)),
      a:structuredClone(left),b:structuredClone(right)
    });
  });
  return Object.freeze({
    chainId: a.chainId,
    networkRef: a.networkRef,
    mechanismRef: a.mechanismRef,
    independent: a.source !== b.source,
    matches: comparisons.every(item => item.matches),
    comparisons: Object.freeze(comparisons)
  });
}

export function createStateSnapshot({ chainId, networkRef, mechanismRef, observedAt, source, observations }) {
  if (!chainId || !networkRef || !mechanismRef || !observedAt || !source) throw new TypeError('State snapshot requires chain/network/mechanism/time/source.');
  const body = { chainId, networkRef, mechanismRef, observedAt, source, observations: structuredClone(observations ?? {}) };
  return Object.freeze({ ...body, sha256: digest(body) });
}
