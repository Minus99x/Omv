const SPONSOR_MODES = new Set(['self-funded', 'relayer', 'paymaster']);

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

export function createActionPlan(input) {
  const chainId = clean(input?.chainId);
  const networkRef = clean(input?.networkRef);
  const operation = clean(input?.operation);
  const requiredSigner = clean(input?.requiredSigner);
  const feePayer = clean(input?.feePayer) || requiredSigner;
  const sponsorMode = clean(input?.sponsorMode) || 'self-funded';

  if (!chainId || !networkRef || !operation || !requiredSigner) {
    throw new TypeError('Action plan requires chainId, networkRef, operation, and requiredSigner.');
  }
  if (!SPONSOR_MODES.has(sponsorMode)) throw new TypeError('Unsupported sponsor mode.');
  if (sponsorMode === 'self-funded' && feePayer !== requiredSigner) {
    throw new TypeError('Self-funded actions must use the required signer as fee payer.');
  }

  return Object.freeze({
    version: 1,
    chainId,
    networkRef,
    operation,
    requiredSigner,
    feePayer,
    sponsorMode,
    destination: clean(input?.destination) || null,
    assetId: clean(input?.assetId) || null,
    amount: clean(input?.amount) || null,
    transactionTemplate: input?.transactionTemplate && typeof input.transactionTemplate === 'object'
      ? structuredClone(input.transactionTemplate)
      : null,
    metadata: input?.metadata && typeof input.metadata === 'object'
      ? structuredClone(input.metadata)
      : {}
  });
}

export function requiresExternalFeePayer(plan) {
  return plan.sponsorMode !== 'self-funded' && plan.feePayer !== plan.requiredSigner;
}
