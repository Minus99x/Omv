import { assertClassicAddress } from './signer-list.js';
import { calculateXrplEscrowFinishFeeDrops } from './escrow-fee.js';

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

// XRPL non-XRP issued amounts encode a 16-digit mantissa and an exponent
// from -96 through +80. Never silently round the owner's recovery amount.
// This validator handles our explicitly supported non-scientific decimal form.
function exactIssuedCurrencyValue(value){
  const validated=positiveDecimalString(value,'trust-line token amount value');
  const [whole,fraction='']=validated.split('.');
  const significantRaw=(whole+fraction).replace(/^0+/,'');
  const significant=significantRaw.replace(/0+$/,'');
  if(significant.length>16){
    throw new RangeError('XRPL trust-line token amount exceeds exact 16-significant-digit precision.');
  }
  const trailingZeroCount=significantRaw.length-significant.length;
  const normalizedExponent=trailingZeroCount-fraction.length-(16-significant.length);
  if(normalizedExponent < -96 || normalizedExponent > 80){
    throw new RangeError('XRPL trust-line token amount is outside its exact issued-currency exponent range.');
  }
  return validated;
}

// XRPL issued-asset Amount objects are transaction authority, not bags of
// optional metadata. Never ignore extra, inherited or accessor-backed fields.
function exactTokenAmountFields(amount) {
  const prototype = Object.getPrototypeOf(amount);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('XRPL token escrow Amount must be a plain own-field object.');
  }
  const mpt = Object.hasOwn(amount, 'mpt_issuance_id');
  const required = mpt ? ['mpt_issuance_id', 'value'] : ['currency', 'issuer', 'value'];
  if (Reflect.ownKeys(amount).length !== required.length ||
      !required.every(key => Object.hasOwn(amount, key))) {
    throw new TypeError('XRPL token escrow Amount must have exactly its canonical asset and value fields.');
  }
  const fields = Object.create(null);
  for (const key of required) {
    const descriptor = Object.getOwnPropertyDescriptor(amount, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('XRPL token escrow Amount fields must be own data values, not accessors.');
    }
    fields[key] = descriptor.value;
  }
  return fields;
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
  const fields = exactTokenAmountFields(amount);
  if (Object.hasOwn(fields, 'mpt_issuance_id')) {
    if (typeof fields.mpt_issuance_id !== 'string' || !/^[A-Fa-f0-9]{48}$/.test(fields.mpt_issuance_id)) throw new TypeError('mpt_issuance_id must be a 192-bit hex identifier.');
    const value = positiveDecimalString(fields.value, 'MPT amount value');
    if (value.includes('.')) throw new TypeError('MPT escrow value must be an integer string; AssetScale determines display precision.');
    if (BigInt(value)>0x7fffffffffffffffn) {
      throw new RangeError('MPT escrow amount exceeds the XRPL signed-int64 token amount range.');
    }
    return Object.freeze({ kind: 'mpt', amount: Object.freeze({ mpt_issuance_id: fields.mpt_issuance_id.toUpperCase(), value }), requiresTokenEscrow: true });
  }
  assertClassicAddress(fields.issuer, 'token issuer');
  const currency=fields.currency;
  // XRPL accepts a 3-character standard code or a 160-bit hexadecimal code;
  // XRP's reserved currency identity cannot denote an issued trust-line asset.
  const standard=typeof currency==='string' && /^[A-Za-z0-9?!@#$%^&*<>(){}\[\]|]{3}$/.test(currency);
  const hex=typeof currency==='string' && /^[A-Fa-f0-9]{40}$/.test(currency);
  if ((!standard && !hex) || currency==='XRP' ||
      (hex && (/^0{40}$/.test(currency) || currency.toUpperCase()==='0000000000000000000000005852500000000000'))) {
    throw new TypeError('Trust-line token currency must be a valid non-XRP 3-character code or 160-bit hex code.');
  }
  const value = exactIssuedCurrencyValue(fields.value);
  return Object.freeze({ kind: 'trustline-token', amount: Object.freeze({ currency: fields.currency, issuer: fields.issuer, value }), requiresTokenEscrow: true });
}

export function evaluateXrplFeature({ featureResponse, featureName = 'TokenEscrow', amendmentId = TOKEN_ESCROW_AMENDMENT_ID }) {
  const unavailable=()=>Object.freeze({known:false,supported:false,enabled:false,amendmentId,featureName});
  // Amendment activation controls whether token escrow plans are constructed.
  // Only own-data snapshots can establish that capability. Object.entries()
  // invokes getters and can observe inconsistent IDs/feature values.
  let result=featureResponse;
  if(result && typeof result==='object' && Object.hasOwn(result,'result')){
    const descriptor=Object.getOwnPropertyDescriptor(result,'result');
    if(!descriptor || !Object.hasOwn(descriptor,'value')) return unavailable();
    result=descriptor.value;
  }
  if(!result || typeof result!=='object' || Array.isArray(result)) return unavailable();
  const matching=Reflect.ownKeys(result).filter(id=>
    typeof id==='string' && /^[a-fA-F0-9]{64}$/.test(id) &&
    id.toUpperCase()===amendmentId
  );
  if(matching.length!==1) return unavailable();
  const id=matching[0];
  const descriptor=Object.getOwnPropertyDescriptor(result,id);
  if(!descriptor || !Object.hasOwn(descriptor,'value')) return unavailable();
  const feature=descriptor.value;
  if(!feature || typeof feature!=='object' || Array.isArray(feature) ||
     (Object.getPrototypeOf(feature)!==Object.prototype && Object.getPrototypeOf(feature)!==null)) return unavailable();
  const fields={};
  for(const name of ['name','supported','enabled']){
    const own=Object.getOwnPropertyDescriptor(feature,name);
    if(!own || !Object.hasOwn(own,'value') || !own.enumerable) return unavailable();
    fields[name]=own.value;
  }
  if(fields.name!==featureName) return unavailable();
  return Object.freeze({
    known:true,supported:fields.supported===true,enabled:fields.enabled===true,
    amendmentId:id.toUpperCase(),featureName
  });
}

// Only immutable-looking, direct data snapshots may enable a token escrow.
// A getter can advertise true during the capability gate and false later.
function validTokenEscrowCapability(snapshot) {
  if(snapshot===null || typeof snapshot!=='object' || Array.isArray(snapshot)) return false;
  const proto=Object.getPrototypeOf(snapshot);
  if(proto!==Object.prototype && proto!==null) return false;
  const names=['known','enabled','supported','featureName','amendmentId'];
  const keys=Reflect.ownKeys(snapshot);
  if(keys.length!==names.length || keys.some(key=>typeof key!=='string'||!names.includes(key))) return false;
  const result=Object.create(null);
  for(const name of names){
    const field=Object.getOwnPropertyDescriptor(snapshot,name);
    if(!field || !field.enumerable || !Object.hasOwn(field,'value')) return false;
    result[name]=field.value;
  }
  return result.known===true && result.enabled===true && result.supported===true &&
    result.featureName==='TokenEscrow' && result.amendmentId===TOKEN_ESCROW_AMENDMENT_ID;
}

export function createXrplEscrowRecoveryPlan({ owner, rescueDestination, amount = null, amountDrops = null, finishAfterRippleTime, cancelAfterRippleTime = null, tokenEscrowFeature = null }) {
  assertClassicAddress(owner, 'owner');
  assertClassicAddress(rescueDestination, 'rescueDestination');
  if (!Number.isInteger(finishAfterRippleTime) || finishAfterRippleTime <= 0 || finishAfterRippleTime > 0xffffffff) throw new TypeError('finishAfterRippleTime must be a positive Ripple-epoch timestamp.');
  const normalized = normalizeAmount(amount ?? amountDrops);
  if (normalized.requiresTokenEscrow) {
    if (!validTokenEscrowCapability(tokenEscrowFeature)) {
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

export function createXrplEscrowFinishPlan({ submitter, owner, escrowSequence, condition = null, fulfillment = null, baseFeeDrops = null, signerCount = 0 }) {
  assertClassicAddress(submitter, 'submitter');
  assertClassicAddress(owner, 'owner');
  if (!Number.isInteger(escrowSequence) || escrowSequence <= 0 || escrowSequence > 0xffffffff) throw new TypeError('escrowSequence must be a positive integer.');
  if ((condition == null) !== (fulfillment == null)) throw new TypeError('condition and fulfillment must be provided together.');
  const tx = { TransactionType: 'EscrowFinish', Account: submitter, Owner: owner, OfferSequence: escrowSequence };
  if (condition != null) {
    // XRPL Crypto-Conditions use hex-serialized, nonempty byte blobs.
    for (const [value,label] of [[condition,'condition'],[fulfillment,'fulfillment']]) {
      if (typeof value!=='string' || !/^(?:[A-Fa-f0-9]{2})+$/.test(value)) {
        throw new TypeError(`${label} must be nonempty, even-length hexadecimal bytes.`);
      }
    }
    tx.Condition = condition.toUpperCase();
    tx.Fulfillment = fulfillment.toUpperCase();
  }
  const feeEvidence=baseFeeDrops==null ? null : calculateXrplEscrowFinishFeeDrops({baseFeeDrops,fulfillmentHex:tx.Fulfillment ?? null,signerCount});
  if(feeEvidence) tx.Fee=feeEvidence.minimumFeeDrops;
  return Object.freeze({ transaction: Object.freeze(tx), feeEvidence, submitterCanBeAnyAccount: true, finalityEvidence: Object.freeze(['validated ledger', 'tesSUCCESS transaction result', 'escrow object absent after successful finish', 'destination balance/state change independently observed']) });
}
