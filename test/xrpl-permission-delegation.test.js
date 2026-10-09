import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessXrplDelegatedRecoveryAuthority,
  buildXrplDelegateSet,
  evaluateXrplPermissionDelegationFeature,
  XRPL_PERMISSION_DELEGATION_NON_DELEGABLE
} from '../src/chains/xrpl/permission-delegation.js';

const owner='r1111111111111111111111111';
const delegate='r2222222222222222222222222';

function enabledFeature(){
  return evaluateXrplPermissionDelegationFeature({
    featureResponse:{
      result:{
        ['AA'.repeat(32)]:{
          name:'PermissionDelegationV1_1',
          supported:true,
          enabled:true
        }
      }
    }
  });
}

test('XRPL DelegateSet builder requires verified enabled PermissionDelegationV1_1',()=>{
  const feature=enabledFeature();
  const built=buildXrplDelegateSet({
    owner,
    delegate,
    permissions:['Payment','EscrowCreate'],
    sequence:10,
    feeDrops:'12',
    lastLedgerSequence:1000,
    permissionDelegationFeature:feature
  });
  assert.equal(built.transaction.TransactionType,'DelegateSet');
  assert.equal(built.transaction.Account,owner);
  assert.equal(built.transaction.Authorize,delegate);
  assert.deepEqual(
    built.transaction.Permissions,
    [
      { Permission:{ PermissionValue:'Payment' } },
      { Permission:{ PermissionValue:'EscrowCreate' } }
    ]
  );
  assert.equal(built.amendment.enabled,true);

  assert.throws(
    ()=>buildXrplDelegateSet({
      owner,
      delegate,
      permissions:['Payment'],
      sequence:10,
      permissionDelegationFeature:{ known:true,supported:true,enabled:false }
    }),
    /requires verified enabled PermissionDelegationV1_1/
  );
});

test('XRPL DelegateSet rejects duplicate and non-delegable permissions',()=>{
  const feature=enabledFeature();
  assert.throws(
    ()=>buildXrplDelegateSet({
      owner,
      delegate,
      permissions:['Payment','Payment'],
      sequence:10,
      permissionDelegationFeature:feature
    }),
    /must be unique/
  );
  assert.ok(XRPL_PERMISSION_DELEGATION_NON_DELEGABLE.includes('Batch'));
  assert.ok(XRPL_PERMISSION_DELEGATION_NON_DELEGABLE.includes('SignerListSet'));
  assert.throws(
    ()=>buildXrplDelegateSet({
      owner,
      delegate,
      permissions:['SignerListSet'],
      sequence:10,
      permissionDelegationFeature:feature
    }),
    /non-delegable/
  );
});

test('XRPL delegated Payment authority remains too broad for immutable OmegaVault rescue',()=>{
  const assessment=assessXrplDelegatedRecoveryAuthority({
    permissionValues:['Payment'],
    delegateUsesOwnSignerQuorum:true,
    immutableRescueBoundByLedger:false,
    amountBoundByLedger:false,
    currencyBoundByLedger:false,
    resettableInactivityBoundByLedger:false
  });
  assert.equal(assessment.semantics.delegateSignerListCanProvideThreshold,true);
  assert.equal(assessment.semantics.customDestinationRestrictionAvailable,false);
  assert.equal(assessment.exactOmegaVaultDelegatedRecovery,false);
  assert.ok(assessment.risks.some(item=>/destination, amount, or currency/i.test(item)));
});

test('XRPL delegated EscrowFinish does not manufacture a contact-threshold gate',()=>{
  const assessment=assessXrplDelegatedRecoveryAuthority({
    permissionValues:['EscrowFinish'],
    delegateUsesOwnSignerQuorum:true,
    immutableRescueBoundByLedger:true,
    amountBoundByLedger:true,
    currencyBoundByLedger:true,
    resettableInactivityBoundByLedger:false
  });
  assert.equal(assessment.exactOmegaVaultDelegatedRecovery,false);
  assert.ok(assessment.risks.some(item=>/finished by any submitting account/i.test(item)));
});

test('XRPL permission feature parsing fails closed when amendment status is unknown',()=>{
  const feature=evaluateXrplPermissionDelegationFeature({ featureResponse:{ result:{} } });
  assert.equal(feature.known,false);
  assert.equal(feature.enabled,false);
});
