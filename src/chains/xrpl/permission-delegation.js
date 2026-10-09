import { assertClassicAddress, normalizeXrplSequenceBinding } from './signer-list.js';

const UINT32_MAX=0xffffffff;
const MAX_PERMISSIONS=10;

// Current XRPL PermissionDelegationV1_1 non-delegable transaction-type names
// that are especially relevant to OmegaVault authority boundaries.
const NON_DELEGABLE=new Set([
  'AccountDelete',
  'AccountSet',
  'Batch',
  'DelegateSet',
  'SetRegularKey',
  'SignerListSet'
]);

const GRANULAR_PAYMENT_PERMISSIONS=new Set(['PaymentMint','PaymentBurn']);

function assertUInt(value,label){
  if(!Number.isInteger(value) || value<0 || value>UINT32_MAX) throw new TypeError(`${label} must be uint32.`);
  return value;
}

function normalizePermission(value,index){
  const permission=typeof value==='string'
    ? value
    : value?.PermissionValue ?? value?.Permission?.PermissionValue;
  if(typeof permission!=='string' || permission.length<1) {
    throw new TypeError(`permissions[${index}] must identify a PermissionValue string.`);
  }
  if(NON_DELEGABLE.has(permission)) {
    throw new TypeError(`XRPL permission ${permission} is non-delegable and cannot be placed in DelegateSet.`);
  }
  return permission;
}

export function evaluateXrplPermissionDelegationFeature({
  featureResponse,
  featureName='PermissionDelegationV1_1'
}={}){
  const result=featureResponse?.result ?? featureResponse ?? {};
  const entries=Object.entries(result);
  const match=entries.find(([_id,feature])=>feature?.name===featureName);
  if(!match) return Object.freeze({ known:false,supported:false,enabled:false,featureName,amendmentId:null });
  const [id,feature]=match;
  return Object.freeze({
    known:true,
    supported:feature?.supported===true,
    enabled:feature?.enabled===true,
    featureName:feature?.name ?? featureName,
    amendmentId:String(id).toUpperCase()
  });
}

export function buildXrplDelegateSet({
  owner,
  delegate,
  permissions,
  sequence=null,
  ticketSequence=null,
  feeDrops=null,
  lastLedgerSequence=null,
  permissionDelegationFeature=null
}){
  assertClassicAddress(owner,'owner');
  assertClassicAddress(delegate,'delegate');
  if(owner===delegate) throw new TypeError('XRPL delegate must be different from owner.');
  if(!permissionDelegationFeature?.known ||
      !permissionDelegationFeature?.supported ||
      !permissionDelegationFeature?.enabled) {
    throw new TypeError('DelegateSet requires verified enabled PermissionDelegationV1_1 capability on the target network.');
  }
  if(!Array.isArray(permissions) || permissions.length>MAX_PERMISSIONS) {
    throw new TypeError(`permissions must contain 0-${MAX_PERMISSIONS} entries.`);
  }
  const normalized=permissions.map(normalizePermission);
  if(new Set(normalized).size!==normalized.length) throw new TypeError('XRPL delegated permissions must be unique.');

  const transaction={
    TransactionType:'DelegateSet',
    Account:owner,
    Authorize:delegate,
    Permissions:normalized.map(PermissionValue=>({ Permission:{ PermissionValue } })),
    ...normalizeXrplSequenceBinding({ sequence,ticketSequence })
  };
  if(feeDrops!=null){
    if(!/^\d+$/.test(String(feeDrops)) || BigInt(feeDrops)<0n) throw new TypeError('feeDrops must be a non-negative integer.');
    transaction.Fee=String(feeDrops);
  }
  if(lastLedgerSequence!=null){
    assertUInt(lastLedgerSequence,'lastLedgerSequence');
    transaction.LastLedgerSequence=lastLedgerSequence;
  }

  return Object.freeze({
    transaction:Object.freeze(transaction),
    permissions:Object.freeze(normalized),
    revocation:normalized.length===0,
    amendment:Object.freeze({
      name:'PermissionDelegationV1_1',
      enabled:true,
      amendmentId:permissionDelegationFeature.amendmentId
    }),
    evidenceExpectations:Object.freeze([
      'validated-ledger DelegateSet inclusion',
      'Delegate ledger entry read-back matches owner/delegate',
      'exact PermissionValue set matches',
      'amendment enabled at observed ledger'
    ])
  });
}

export function assessXrplDelegatedRecoveryAuthority({
  permissionValues,
  delegateUsesOwnSignerQuorum=false,
  immutableRescueBoundByLedger=false,
  amountBoundByLedger=false,
  currencyBoundByLedger=false,
  resettableInactivityBoundByLedger=false
}){
  if(!Array.isArray(permissionValues) || permissionValues.length<1) throw new TypeError('permissionValues must be a non-empty array.');
  const normalized=permissionValues.map(normalizePermission);
  if(new Set(normalized).size!==normalized.length) throw new TypeError('permissionValues must be unique.');

  const paymentPermission=normalized.includes('Payment');
  const escrowCreatePermission=normalized.includes('EscrowCreate');
  const escrowFinishPermission=normalized.includes('EscrowFinish');
  const granularPaymentPermission=normalized.some(value=>GRANULAR_PAYMENT_PERMISSIONS.has(value));

  const risks=[];
  if(paymentPermission) {
    risks.push('Delegated Payment authority is transaction-type scoped and is not restricted by XRPL Permission Delegation to one rescue destination, amount, or currency.');
  }
  if(granularPaymentPermission) {
    risks.push('Current granular Payment permissions do not provide a custom rescue-destination/amount/currency recovery permission.');
  }
  if(escrowCreatePermission) {
    risks.push('Delegated EscrowCreate authority can choose escrow transaction fields unless a separate ledger mechanism independently fixes the recovery escrow.');
  }
  if(escrowFinishPermission) {
    risks.push('EscrowFinish permission does not create a threshold recovery gate; an eligible XRPL escrow can be finished by any submitting account.');
  }
  if(!resettableInactivityBoundByLedger) risks.push('No owner-resettable inactivity condition is bound by the delegated authority itself.');
  if(!immutableRescueBoundByLedger) risks.push('Immutable rescue destination is not independently bound across delegated recovery authority.');
  if(!amountBoundByLedger) risks.push('Protected recovery amount is not independently bound across delegated recovery authority.');
  if(!currencyBoundByLedger) risks.push('Protected recovery currency/asset scope is not independently bound across delegated recovery authority.');

  const exactOmegaVaultDelegatedRecovery=
    delegateUsesOwnSignerQuorum===true &&
    immutableRescueBoundByLedger===true &&
    amountBoundByLedger===true &&
    currencyBoundByLedger===true &&
    resettableInactivityBoundByLedger===true &&
    risks.length===0;

  return Object.freeze({
    permissionValues:Object.freeze(normalized),
    delegateUsesOwnSignerQuorum:delegateUsesOwnSignerQuorum===true,
    semantics:Object.freeze({
      permissionScope:'hard-coded-xrpl-permission-values',
      customDestinationRestrictionAvailable:false,
      customAmountRestrictionAvailable:false,
      customCurrencyRestrictionAvailable:false,
      delegatePaysTransactionFee:true,
      delegateSignerListCanProvideThreshold:delegateUsesOwnSignerQuorum===true
    }),
    exactOmegaVaultDelegatedRecovery,
    risks:Object.freeze(risks),
    authorityBoundary:'Permission Delegation can narrow transaction authority and can use the delegate account\'s own signer quorum, but it must not be represented as immutable Plan-B recovery unless destination, amount, currency and resettable inactivity are independently ledger-enforced.'
  });
}

export const XRPL_PERMISSION_DELEGATION_NON_DELEGABLE=Object.freeze([...NON_DELEGABLE].sort());
