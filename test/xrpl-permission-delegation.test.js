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


test('XRPL DelegateSet revocation requires observed existing Delegate state',()=>{
  const feature=enabledFeature();
  assert.throws(
    ()=>buildXrplDelegateSet({
      owner,
      delegate,
      permissions:[],
      sequence:10,
      permissionDelegationFeature:feature
    }),
    /requires an observed existing Delegate ledger entry/
  );
  const revoke=buildXrplDelegateSet({
    owner,
    delegate,
    permissions:[],
    sequence:10,
    permissionDelegationFeature:feature,
    existingDelegateEntryObserved:true
  });
  assert.equal(revoke.revocation,true);
  assert.deepEqual(revoke.transaction.Permissions,[]);
});

test('XRPL OmegaVault delegation planning rejects PaymentBurn and current non-delegable authority-changing permissions',()=>{
  const feature=enabledFeature();
  assert.throws(
    ()=>buildXrplDelegateSet({
      owner,
      delegate,
      permissions:['PaymentBurn'],
      sequence:10,
      permissionDelegationFeature:feature
    }),
    /does not delegate PaymentBurn/
  );
  for(const permission of ['Batch','DelegateSet','SetRegularKey','SignerListSet','VaultWithdraw']){
    assert.throws(
      ()=>buildXrplDelegateSet({
        owner,
        delegate,
        permissions:[permission],
        sequence:10,
        permissionDelegationFeature:feature
      }),
      /non-delegable/
    );
  }
});

test('XRPL delegated non-recovery permissions cannot claim exact OmegaVault rescue', () => {
  const provenElsewhere = {
    delegateUsesOwnSignerQuorum: true,
    immutableRescueBoundByLedger: true,
    amountBoundByLedger: true,
    currencyBoundByLedger: true,
    resettableInactivityBoundByLedger: true
  };
  for (const permissionValues of [['TrustSet'], ['OfferCreate'], ['EscrowCancel']]) {
    const assessment = assessXrplDelegatedRecoveryAuthority({ permissionValues, ...provenElsewhere });
    assert.equal(assessment.exactOmegaVaultDelegatedRecovery, false);
    assert.ok(assessment.risks.some(risk => /no recovery-capable Payment or Escrow/i.test(risk)));
  }
  const payment = assessXrplDelegatedRecoveryAuthority({ permissionValues: ['Payment'], ...provenElsewhere });
  assert.equal(payment.exactOmegaVaultDelegatedRecovery, false);
  assert.ok(payment.risks.some(risk => /destination, amount, or currency/i.test(risk)));
});

test('XRPL permission feature fails closed on duplicate or malformed amendment identifiers', () => {
  const feature={ name:'PermissionDelegationV1_1', supported:true, enabled:true };
  const duplicate=evaluateXrplPermissionDelegationFeature({
    featureResponse:{ result:{ ['aa'.repeat(32)]:feature, ['bb'.repeat(32)]:feature } }
  });
  assert.equal(duplicate.known,false);
  assert.equal(duplicate.enabled,false);
  for(const id of ['metadata','a'.repeat(63),'zz'.repeat(32)]) {
    const found=evaluateXrplPermissionDelegationFeature({ featureResponse:{ result:{ [id]:feature } } });
    assert.equal(found.known,false);
    assert.equal(found.enabled,false);
    assert.equal(found.amendmentId,null);
  }
  const valid=evaluateXrplPermissionDelegationFeature({
    featureResponse:{ result:{ ['ab'.repeat(32)]:feature } }
  });
  assert.equal(valid.known,true);
  assert.equal(valid.amendmentId,'AB'.repeat(32));
});

test('XRPL DelegateSet rejects unverified amendment metadata and coercive fee inputs', () => {
  const base={ owner, delegate, permissions:['Payment'], sequence:10, permissionDelegationFeature:enabledFeature() };
  for(const override of [
    { featureName:'UnrelatedAmendment' },
    { amendmentId:null },
    { amendmentId:'not-an-amendment-hash' },
    { featureName:undefined }
  ]) {
    assert.throws(()=>buildXrplDelegateSet({
      ...base, permissionDelegationFeature:{...base.permissionDelegationFeature,...override}
    }),/requires verified enabled PermissionDelegationV1_1/);
  }
  for(const feeDrops of [[12],new Number(12),{toString:()=> '12'},1.5,Number.MAX_SAFE_INTEGER+1,'01']) {
    assert.throws(()=>buildXrplDelegateSet({...base,feeDrops}),/canonical non-negative primitive integer/);
  }
  assert.equal(buildXrplDelegateSet({...base,feeDrops:12n}).transaction.Fee,'12');
  assert.equal(buildXrplDelegateSet({...base,feeDrops:'0'}).transaction.Fee,'0');
});
