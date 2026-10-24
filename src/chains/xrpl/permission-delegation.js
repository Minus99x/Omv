import { assertClassicAddress, normalizeXrplFeeDrops, normalizeXrplSequenceBinding } from './signer-list.js';

const UINT32_MAX=0xffffffff;
const MAX_PERMISSIONS=10;

// Current XRPL PermissionDelegationV1_1 non-delegable transaction-type names
// that are especially relevant to OmegaVault authority boundaries.
const NON_DELEGABLE=new Set([
  'AccountDelete',
  'AccountSet',
  'Batch',
  'ConfidentialMPTConvert',
  'DelegateSet',
  'EnableAmendment',
  'LedgerStateFix',
  'LoanBrokerCoverClawback',
  'LoanBrokerCoverDeposit',
  'LoanBrokerCoverWithdraw',
  'LoanBrokerDelete',
  'LoanBrokerSet',
  'LoanDelete',
  'LoanManage',
  'LoanPay',
  'LoanSet',
  'SetFee',
  'SetRegularKey',
  'SignerListSet',
  'SponsorshipTransfer',
  'VaultClawback',
  'VaultCreate',
  'VaultDelete',
  'VaultDeposit',
  'VaultSet',
  'VaultWithdraw',
  'UNLModify'
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
  // XRPL named permissions use canonical case-sensitive transaction or
  // granular identifiers; malformed names must not enter authority plans.
  if(typeof permission!=='string' || !/^[A-Z][A-Za-z0-9]*$/.test(permission)) {
    throw new TypeError(`permissions[${index}] must identify a canonical PermissionValue string.`);
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
  // A single canonical 32-byte amendment identifier is required. Multiple
  // name matches or response metadata posing as an ID cannot prove capability.
  const matches=Object.entries(result).filter(([_id,feature])=>feature?.name===featureName);
  if(matches.length!==1 || !/^[0-9a-f]{64}$/i.test(matches[0][0])) {
    return Object.freeze({ known:false,supported:false,enabled:false,featureName,amendmentId:null });
  }
  const [id,feature]=matches[0];
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
  permissionDelegationFeature=null,
  existingDelegateEntryObserved=false
}){
  assertClassicAddress(owner,'owner');
  assertClassicAddress(delegate,'delegate');
  if(owner===delegate) throw new TypeError('XRPL delegate must be different from owner.');
  if(permissionDelegationFeature?.featureName!=='PermissionDelegationV1_1' ||
      !/^[0-9a-f]{64}$/i.test(permissionDelegationFeature?.amendmentId ?? '') ||
      !permissionDelegationFeature?.known ||
      !permissionDelegationFeature?.supported ||
      !permissionDelegationFeature?.enabled) {
    throw new TypeError('DelegateSet requires verified enabled PermissionDelegationV1_1 capability on the target network.');
  }
  if(!Array.isArray(permissions) || permissions.length>MAX_PERMISSIONS) {
    throw new TypeError(`permissions must contain 0-${MAX_PERMISSIONS} entries.`);
  }
  const normalized=permissions.map(normalizePermission);
  if(new Set(normalized).size!==normalized.length) throw new TypeError('XRPL delegated permissions must be unique.');
  if(normalized.includes('PaymentBurn')) {
    throw new TypeError('OmegaVault does not delegate PaymentBurn; amendment-dependent historical behavior makes this permission outside the recovery-planning allowlist.');
  }
  if(normalized.length===0 && existingDelegateEntryObserved!==true) {
    throw new TypeError('Revoking all delegated permissions requires an observed existing Delegate ledger entry.');
  }

  const transaction={
    TransactionType:'DelegateSet',
    Account:owner,
    Authorize:delegate,
    Permissions:Object.freeze(normalized.map(PermissionValue=>Object.freeze({ Permission:Object.freeze({ PermissionValue }) }))),
    ...normalizeXrplSequenceBinding({ sequence,ticketSequence })
  };
  if(feeDrops!=null){
    transaction.Fee=normalizeXrplFeeDrops(feeDrops);
  }
  if(lastLedgerSequence!=null){
    assertUInt(lastLedgerSequence,'lastLedgerSequence');
    transaction.LastLedgerSequence=lastLedgerSequence;
  }

  return Object.freeze({
    transaction:Object.freeze(transaction),
    permissions:Object.freeze(normalized),
    revocation:normalized.length===0,
    existingDelegateEntryObserved:normalized.length===0 ? true : existingDelegateEntryObserved===true,
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
  if(!paymentPermission && !escrowCreatePermission && !escrowFinishPermission) {
    risks.push('These delegated permissions contain no recovery-capable Payment or Escrow operation; they cannot implement OmegaVault rescue.');
  }
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
