import { assertClassicAddress } from './signer-list.js';

export const TOKEN_ESCROW_AMENDMENT_ID = '138B968F25822EFBF54C00F97031221C47B1EAB8321D93C7C2AEAF85F04EC5DF';

function positiveDecimalString(value, label) {
  // Do not coerce unsafe numbers, objects or booleans into transaction intent.
  // A decimal string retains the exact amount supplied by the owner.
  const text = value;
  if (typeof text !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) || !/[1-9]/.test(text)) {
    throw new TypeError(`${label} must be a positive decimal string.`);
  }
  return text;
}

function normalizeAmount(amount) {
  if (typeof amount === 'string' || typeof amount === 'number' || typeof amount === 'bigint') {
    const drops = String(amount);
    // XRPL Amount cannot exceed the XRP supply (100 billion XRP / 10^17 drops).
    // Numbers beyond JS safe-integer precision must arrive as exact strings.
    if ((typeof amount === 'number' && !Number.isSafeInteger(amount)) ||
        !/^[1-9]\d*$/.test(drops) || BigInt(drops) > 100000000000000000n) {
      throw new TypeError('XRP escrow amount must be a positive canonical integer number of drops within XRP supply.');
    }
    return Object.freeze({ kind: 'xrp', amount: drops, requiresTokenEscrow: false });
  }
  if (!amount || typeof amount !== 'object' || Array.isArray(amount)) throw new TypeError('XRPL escrow amount must be XRP drops or a fungible-token amount object.');
  if ('mpt_issuance_id' in amount) {
    if (typeof amount.mpt_issuance_id !== 'string' || !/^[A-Fa-f0-9]{48}$/.test(amount.mpt_issuance_id)) throw new TypeError('mpt_issuance_id must be a 192-bit hex identifier.');
    const value = positiveDecimalString(amount.value, 'MPT amount value');
    if (value.includes('.')) throw new TypeError('MPT escrow value must be an integer string; AssetScale determines display precision.');
    return Object.freeze({ kind: 'mpt', amount: Object.freeze({ mpt_issuance_id: amount.mpt_issuance_id.toUpperCase(), value }), requiresTokenEscrow: true });
  }
  assertClassicAddress(amount.issuer, 'token issuer');
  const currency=amount.currency;
  // XRPL accepts a 3-character standard code or a 160-bit hexadecimal code;
  // XRP's reserved currency identity cannot denote an issued trust-line asset.
  const standard=typeof currency==='string' && /^[A-Za-z0-9?!@#$%^&*<>(){}\[\]|]{3}$/.test(currency);
  const hex=typeof currency==='string' && /^[A-Fa-f0-9]{40}$/.test(currency);
  if ((!standard && !hex) || currency==='XRP' ||
      (hex && (/^0{40}$/.test(currency) || currency.toUpperCase()==='0000000000000000000000005852500000000000'))) {
    throw new TypeError('Trust-line token currency must be a valid non-XRP 3-character code or 160-bit hex code.');
  }
  const value = positiveDecimalString(amount.value, 'trust-line token amount value');
  return Object.freeze({ kind: 'trustline-token', amount: Object.freeze({ currency: amount.currency, issuer: amount.issuer, value }), requiresTokenEscrow: true });
}

export function evaluateXrplFeature({ featureResponse, featureName = 'TokenEscrow', amendmentId = TOKEN_ESCROW_AMENDMENT_ID }) {
  const result = featureResponse?.result ?? featureResponse ?? {};
  // Do not trust a matching human-readable name when the amendment ID differs.
  // The ID and name must identify the same unique protocol amendment.
  const entries = Object.entries(result).filter(([id, feature]) =>
    /^[a-fA-F0-9]{64}$/.test(id) && id.toUpperCase() === amendmentId && feature?.name === featureName
  );
  if (entries.length !== 1) return Object.freeze({ known: false, supported: false, enabled: false, amendmentId, featureName });
  const [id, feature] = entries[0];
  return Object.freeze({ known: true, supported: feature?.supported === true, enabled: feature?.enabled === true, amendmentId: id.toUpperCase(), featureName });
}

export function createXrplEscrowRecoveryPlan({ owner, rescueDestination, amount = null, amountDrops = null, finishAfterRippleTime, cancelAfterRippleTime = null, tokenEscrowFeature = null }) {
  assertClassicAddress(owner, 'owner');
  assertClassicAddress(rescueDestination, 'rescueDestination');
  if (!Number.isInteger(finishAfterRippleTime) || finishAfterRippleTime <= 0 || finishAfterRippleTime > 0xffffffff) throw new TypeError('finishAfterRippleTime must be a positive Ripple-epoch timestamp.');
  const normalized = normalizeAmount(amount ?? amountDrops);
  if (normalized.requiresTokenEscrow) {
    if (tokenEscrowFeature?.known !== true ||
        tokenEscrowFeature?.enabled !== true ||
        tokenEscrowFeature?.supported !== true ||
        tokenEscrowFeature?.featureName !== 'TokenEscrow' ||
        tokenEscrowFeature?.amendmentId !== TOKEN_ESCROW_AMENDMENT_ID) {
      throw new TypeError('Fungible-token escrow requires the TokenEscrow amendment to be supported and enabled on the target XRPL network.');
    }
    if (!Number.isInteger(cancelAfterRippleTime) || cancelAfterRippleTime > 0xffffffff || cancelAfterRippleTime <= finishAfterRippleTime) {
      throw new TypeError('Fungible-token escrow requires CancelAfter later than FinishAfter.');
    }
  } else if (cancelAfterRippleTime != null && (!Number.isInteger(cancelAfterRippleTime) || cancelAfterRippleTime > 0xffffffff || cancelAfterRippleTime <= finishAfterRippleTime)) {
    throw new TypeError('cancelAfterRippleTime must be later than finishAfterRippleTime.');
  }

  const transaction = {
    TransactionType: 'EscrowCreate',
    Account: owner,
    Destination: rescueDestination,
    Amount: normalized.amount,
    FinishAfter: finishAfterRippleTime
  };
  if (cancelAfterRippleTime != null) transaction.CancelAfter = cancelAfterRippleTime;

  return Object.freeze({
    chainId: 'xrpl',
    networkRef: 'xrpl:testnet',
    operation: 'EscrowCreate',
    owner,
    rescueDestination,
    assetKind: normalized.kind,
    transaction: Object.freeze(transaction),
    requiredCapabilities: Object.freeze(normalized.requiresTokenEscrow ? ['TokenEscrow'] : []),
    securitySemantics: Object.freeze({
      thresholdOnChain: false,
      notBeforeOnChain: true,
      resettableInactivityOnChain: false,
      immutableRescueOnChain: true,
      fixedAssetAndAmount: true
    }),
    scope: 'Fixed-asset, fixed-amount time-locked recovery primitive. FinishAfter is an absolute not-before time and is not an owner-liveness inactivity timer.',
    blockers: Object.freeze([
      'Owner activity does not reset FinishAfter.',
      'Escrowed assets are locked before recovery and only the declared amount/assets are covered.',
      'Combining this primitive with SignerList does not by itself prevent trusted contacts from authorizing unrelated account transactions.'
    ])
  });
}

export function createXrplEscrowFinishPlan({ submitter, owner, escrowSequence, condition = null, fulfillment = null }) {
  assertClassicAddress(submitter, 'submitter');
  assertClassicAddress(owner, 'owner');
  if (!Number.isInteger(escrowSequence) || escrowSequence <= 0 || escrowSequence > 0xffffffff) throw new TypeError('escrowSequence must be a positive integer.');
  if ((condition == null) !== (fulfillment == null)) throw new TypeError('condition and fulfillment must be provided together.');
  const tx = { TransactionType: 'EscrowFinish', Account: submitter, Owner: owner, OfferSequence: escrowSequence };
  if (condition != null) { tx.Condition = condition; tx.Fulfillment = fulfillment; }
  return Object.freeze({ transaction: Object.freeze(tx), submitterCanBeAnyAccount: true, finalityEvidence: Object.freeze(['validated ledger', 'tesSUCCESS transaction result', 'escrow object absent after successful finish', 'destination balance/state change independently observed']) });
}
