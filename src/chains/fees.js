const FEE_STATUSES = new Set(['estimate', 'observed']);

function integerString(value, label, { allowZero = true } = {}) {
  const normalized = typeof value === 'bigint' ? value.toString() :
    typeof value === 'number' && Number.isSafeInteger(value) ? value.toString() :
    typeof value === 'string' ? value : '';
  if (!/^(0|[1-9]\d*)$/.test(normalized)) throw new TypeError(`${label} must be a canonical non-negative primitive integer string.`);
  if (!allowZero && BigInt(normalized) === 0n) throw new TypeError(`${label} must be greater than zero.`);
  return normalized;
}

export function createFeeEvidence({
  chainId,
  networkRef,
  status = 'estimate',
  feePayer,
  feeAsset,
  total,
  components = {},
  source = null,
  transactionRef = null,
  observedAt = null,
  expiresAt = null,
  notes = []
}) {
  if (!chainId || !networkRef || !feePayer || !feeAsset) throw new TypeError('Fee evidence requires chainId, networkRef, feePayer and feeAsset.');
  if (!FEE_STATUSES.has(status)) throw new TypeError('Fee evidence status must be estimate or observed.');
  const normalizedTotal = integerString(total, 'fee total');
  if (status === 'observed' && (typeof transactionRef !== 'string' || !transactionRef.trim()))
    throw new TypeError('Observed fee evidence requires transactionRef.');
  if (transactionRef != null && (typeof transactionRef !== 'string' || !transactionRef.trim()))
    throw new TypeError('Fee transactionRef must be primitive non-empty text.');
  if (components != null && (typeof components !== 'object' || Array.isArray(components)))
    throw new TypeError('Fee components must be an object.');
  if (!Array.isArray(notes) && notes != null) throw new TypeError('Fee notes must be an array.');
  const normalizedComponents = {};
  for (const [key, value] of Object.entries(components ?? {})) {
    if (!key.trim() || ['__proto__','prototype','constructor'].includes(key))
      throw new TypeError('Fee component name must be a nonreserved identifier.');
    normalizedComponents[key] = integerString(value, `fee component ${key}`);
  }
  return Object.freeze({
    version: 1,
    chainId,
    networkRef,
    status,
    feePayer,
    feeAsset,
    total: normalizedTotal,
    components: Object.freeze(normalizedComponents),
    source,
    transactionRef,
    observedAt,
    expiresAt,
    notes: Object.freeze([...(notes ?? [])])
  });
}

export function reconcileFeeEvidence(estimate, observed) {
  if (estimate?.status !== 'estimate' || observed?.status !== 'observed') throw new TypeError('Fee reconciliation requires estimate then observed evidence.');
  for (const key of ['chainId', 'networkRef', 'feePayer', 'feeAsset']) {
    if (estimate[key] !== observed[key]) throw new Error(`Fee evidence mismatch for ${key}.`);
  }
  if (estimate.transactionRef != null && estimate.transactionRef !== observed.transactionRef)
    throw new Error('Fee evidence mismatch for transactionRef.');
  if (typeof observed.transactionRef !== 'string' || !observed.transactionRef.trim())
    throw new TypeError('Observed fee evidence requires transactionRef.');
  const estimated = BigInt(integerString(estimate.total,'estimated fee total'));
  const actual = BigInt(integerString(observed.total,'observed fee total'));
  return Object.freeze({
    estimated: estimated.toString(),
    actual: actual.toString(),
    delta: (actual - estimated).toString(),
    exceededEstimate: actual > estimated,
    estimateTransactionRef: estimate.transactionRef ?? null,
    observedTransactionRef: observed.transactionRef
  });
}
