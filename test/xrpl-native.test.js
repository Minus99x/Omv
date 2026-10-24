import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXrplSignerListSet, coordinateXrplMultisign, normalizeXrplSequenceBinding, validateXrplSignerList } from '../src/chains/xrpl/signer-list.js';
import { createXrplEscrowFinishPlan, createXrplEscrowRecoveryPlan, evaluateXrplFeature, TOKEN_ESCROW_AMENDMENT_ID } from '../src/chains/xrpl/escrow.js';

const owner = 'r1111111111111111111111111';
const a = 'r2222222222222222222222222';
const b = 'r3333333333333333333333333';
const rescue = 'r4444444444444444444444444';

test('XRPL SignerList validator enforces unique non-owner entries, weights and reachable quorum', () => {
  const ok = validateXrplSignerList({ owner, signerEntries: [{ account: a, weight: 2 }, { account: b, weight: 1 }], quorum: 3 });
  assert.equal(ok.totalWeight, 3);
  assert.throws(() => validateXrplSignerList({ owner, signerEntries: [{ account: owner, weight: 1 }], quorum: 1 }), /owner/);
  assert.throws(() => validateXrplSignerList({ owner, signerEntries: [{ account: a, weight: 1 }, { account: a, weight: 1 }], quorum: 1 }), /Duplicate/);
  assert.throws(() => validateXrplSignerList({ owner, signerEntries: [{ account: a, weight: 1 }], quorum: 2 }), /unreachable/);
});

test('XRPL SignerListSet builder emits protocol-shaped signer entries', () => {
  const built = buildXrplSignerListSet({ owner, contacts: [a, b], quorum: 2, sequence: 12, feeDrops: '15', lastLedgerSequence: 1000 });
  assert.equal(built.transaction.TransactionType, 'SignerListSet');
  assert.equal(built.transaction.SignerEntries[0].SignerEntry.SignerWeight, 1);
  assert.equal(built.transaction.Sequence, 12);
});

test('XRPL Ticket binding requires Sequence zero and excludes AccountTxnID', () => {
  assert.deepEqual(normalizeXrplSequenceBinding({ ticketSequence: 55 }), { Sequence: 0, TicketSequence: 55 });
  assert.throws(() => normalizeXrplSequenceBinding({ sequence: 2, ticketSequence: 55 }), /Sequence = 0/);
  assert.throws(() => normalizeXrplSequenceBinding({ ticketSequence: 55, accountTxnId: 'A'.repeat(64) }), /AccountTxnID/);
});

test('XRPL multisign coordinator enforces signer-list membership, quorum and multisign fee multiplier', () => {
  const signerList = { owner, signerEntries: [{ account: a, weight: 1 }, { account: b, weight: 1 }], quorum: 2 };
  const transaction = { TransactionType: 'Payment', Account: owner, Destination: rescue, Amount: '1', Sequence: 10, Fee: '30' };
  const signatures = [
    { account: a, signingPubKey: 'EDA', txnSignature: 'AAA' },
    { account: b, signingPubKey: 'EDB', txnSignature: 'BBB' }
  ];
  const coordinated = coordinateXrplMultisign({ transaction, signerList, signatures, baseFeeDrops: '10' });
  assert.equal(coordinated.signedWeight, 2);
  assert.equal(coordinated.minimumFeeDrops, '30');
  assert.equal(coordinated.transaction.SigningPubKey, '');
  assert.equal(coordinated.transaction.Signers.length, 2);
  assert.throws(() => coordinateXrplMultisign({ transaction: { ...transaction, Fee: '29' }, signerList, signatures, baseFeeDrops: '10' }), /minimum/);
});

test('XRPL TokenEscrow capability gate reads feature response instead of assuming amendment status', () => {
  const enabled = evaluateXrplFeature({ featureResponse: { result: { [TOKEN_ESCROW_AMENDMENT_ID]: { name: 'TokenEscrow', supported: true, enabled: true } } } });
  assert.equal(enabled.enabled, true);
  const unknown = evaluateXrplFeature({ featureResponse: { result: {} } });
  assert.equal(unknown.known, false);
});

test('XRPL escrow plan supports XRP and capability-gated fungible tokens without mislabeling FinishAfter as inactivity', () => {
  const xrp = createXrplEscrowRecoveryPlan({ owner, rescueDestination: rescue, amountDrops: '1000000', finishAfterRippleTime: 900000000 });
  assert.equal(xrp.assetKind, 'xrp');
  assert.equal(xrp.securitySemantics.resettableInactivityOnChain, false);
  assert.match(xrp.scope, /absolute not-before/);

  const feature = evaluateXrplFeature({ featureResponse:{ result:{
    [TOKEN_ESCROW_AMENDMENT_ID]:{ name:'TokenEscrow', supported:true, enabled:true }
  } } });
  const token = createXrplEscrowRecoveryPlan({
    owner, rescueDestination: rescue,
    amount: { currency: 'USD', issuer: a, value: '12.5' },
    finishAfterRippleTime: 900000000,
    cancelAfterRippleTime: 900000600,
    tokenEscrowFeature: feature
  });
  assert.equal(token.assetKind, 'trustline-token');
  assert.deepEqual(token.requiredCapabilities, ['TokenEscrow']);
  assert.throws(() => createXrplEscrowRecoveryPlan({ owner, rescueDestination: rescue, amount: { currency: 'USD', issuer: a, value: '1' }, finishAfterRippleTime: 900000000, cancelAfterRippleTime: 900000600 }), /TokenEscrow/);
});

test('XRPL EscrowFinish plan records that any account may submit while owner identifies the escrow', () => {
  const plan = createXrplEscrowFinishPlan({ submitter: b, owner, escrowSequence: 123 });
  assert.equal(plan.transaction.Account, b);
  assert.equal(plan.transaction.Owner, owner);
  assert.equal(plan.submitterCanBeAnyAccount, true);
});

import { XRPL_RECOVERY_MODES, assessXrplRecoverySemantics, assertXrplProductClaim } from '../src/chains/xrpl/recovery-semantics.js';

test('XRPL fixed-time escrow is explicitly not resettable inactivity recovery', () => {
  const result = assessXrplRecoverySemantics({ mode: XRPL_RECOVERY_MODES.FIXED_TIME_ESCROW });
  assert.equal(result.native, true);
  assert.equal(result.exactResettableInactivity, false);
  assert.match(result.reason, /immutable absolute/);
  assert.throws(() => assertXrplProductClaim({ mode: XRPL_RECOVERY_MODES.FIXED_TIME_ESCROW, claim: 'resettable-inactivity' }), /must not be advertised/);
});

test('XRPL signer quorum is authorization, not an inactivity clock', () => {
  const result = assessXrplRecoverySemantics({ mode: XRPL_RECOVERY_MODES.SIGNER_QUORUM });
  assert.equal(result.native, true);
  assert.equal(result.exactResettableInactivity, false);
  assert.match(result.reason, /do not provide an inactivity clock/);
});

test('XRPL exact resettable inactivity remains unsupported until a verified mechanism exists', () => {
  const result = assessXrplRecoverySemantics({ mode: XRPL_RECOVERY_MODES.RESETTABLE_INACTIVITY });
  assert.equal(result.native, false);
  assert.equal(result.exactResettableInactivity, false);
  assert.equal(result.mechanism, null);
});


test('XRPL TokenEscrow amendment lookup cannot be spoofed by a name-only record', () => {
  for (const result of [
    { ['A'.repeat(64)]: { name:'TokenEscrow', supported:true, enabled:true } },
    { [TOKEN_ESCROW_AMENDMENT_ID]: { name:'DifferentAmendment', supported:true, enabled:true } },
    { TokenEscrow: { name:'TokenEscrow', supported:true, enabled:true } }
  ]) {
    const observed = evaluateXrplFeature({ featureResponse:{ result } });
    assert.equal(observed.known,false);
    assert.equal(observed.enabled,false);
  }
  const observed = evaluateXrplFeature({ featureResponse:{ result:{
    [TOKEN_ESCROW_AMENDMENT_ID]: { name:'TokenEscrow', supported:true, enabled:true }
  } } });
  assert.equal(observed.known,true);
  assert.equal(observed.enabled,true);
});


test('XRPL token escrow construction refuses unverified capability booleans', () => {
  const params={ owner, rescueDestination:rescue,
    amount:{ currency:'USD', issuer:a, value:'1' },
    finishAfterRippleTime:900000000, cancelAfterRippleTime:900000600 };
  for (const tokenEscrowFeature of [
    {supported:true,enabled:true},
    {known:true,supported:true,enabled:true,featureName:'TokenEscrow',amendmentId:'A'.repeat(64)},
    {known:true,supported:true,enabled:true,featureName:'Other',amendmentId:TOKEN_ESCROW_AMENDMENT_ID}
  ]) {
    assert.throws(()=>createXrplEscrowRecoveryPlan({...params,tokenEscrowFeature}),/requires the TokenEscrow amendment/);
  }
});


test('XRPL Ripple-epoch and escrow sequence parameters fit protocol UInt32', () => {
  const params={owner,rescueDestination:rescue,amountDrops:'1',finishAfterRippleTime:4294967295};
  assert.equal(createXrplEscrowRecoveryPlan(params).transaction.FinishAfter,4294967295);
  for(const invalid of [4294967296,Number.MAX_SAFE_INTEGER,-1,1.5]){
    assert.throws(()=>createXrplEscrowRecoveryPlan({...params,finishAfterRippleTime:invalid}),/positive Ripple-epoch/);
    assert.throws(()=>createXrplEscrowRecoveryPlan({...params,finishAfterRippleTime:900000000,cancelAfterRippleTime:invalid}),/later than/);
    assert.throws(()=>createXrplEscrowFinishPlan({submitter:a,owner,escrowSequence:invalid}),/positive integer/);
  }
});


test('XRPL XRP escrow drops stay canonical, exact, and within supply',()=>{
  const base={owner,rescueDestination:rescue,finishAfterRippleTime:900000000};
  assert.equal(createXrplEscrowRecoveryPlan({...base,amountDrops:'100000000000000000'}).transaction.Amount,'100000000000000000');
  for(const amountDrops of ['0','0001','100000000000000001','999999999999999999999999',Number.MAX_SAFE_INTEGER+1,1.5]){
    assert.throws(()=>createXrplEscrowRecoveryPlan({...base,amountDrops}),/positive canonical integer/);
  }
});


test('XRPL escrow trust-line currencies reject invalid and reserved representations',()=>{
  const base={owner,rescueDestination:rescue,finishAfterRippleTime:900000000,
    cancelAfterRippleTime:900000600};
  const enabled=evaluateXrplFeature({featureResponse:{result:{
    [TOKEN_ESCROW_AMENDMENT_ID]:{name:'TokenEscrow',enabled:true,supported:true}
  }}});
  for(const currency of ['USD','EUR','FF'.repeat(20)]){
    const planned=createXrplEscrowRecoveryPlan({...base,amount:{currency,issuer:a,value:'1'},tokenEscrowFeature:enabled});
    assert.equal(planned.transaction.Amount.currency,currency);
  }
  for(const currency of ['XRP','US','four','0'.repeat(40),'0000000000000000000000005852500000000000',{},null]){
    assert.throws(()=>createXrplEscrowRecoveryPlan({...base,amount:{currency,issuer:a,value:'1'},
      tokenEscrowFeature:evaluateXrplFeature({featureResponse:{result:{
        [TOKEN_ESCROW_AMENDMENT_ID]:{name:'TokenEscrow',enabled:true,supported:true}
      }}})}),/currency/);
  }
});


test('XRPL token escrow preserves exact owner-specified decimal strings',()=>{
  const enabled=evaluateXrplFeature({featureResponse:{result:{
    [TOKEN_ESCROW_AMENDMENT_ID]:{name:'TokenEscrow',enabled:true,supported:true}
  }}});
  const params={owner,rescueDestination:rescue,finishAfterRippleTime:900000000,
    cancelAfterRippleTime:900000600,tokenEscrowFeature:enabled};
  assert.equal(createXrplEscrowRecoveryPlan({...params,amount:{currency:'USD',issuer:a,value:'0.0000000001'}}).transaction.Amount.value,'0.0000000001');
  for(const value of [1,1n,true,{toString:()=> '1'},null,'0.000','0001']){
    assert.throws(()=>createXrplEscrowRecoveryPlan({...params,amount:{currency:'USD',issuer:a,value}}),/positive decimal string/);
  }
});


test('XRPL product-claim assertions refuse unknown and mismatched recovery semantics',()=>{
  for(const claim of ['full-recovery','immutable-rescue',null,{},'RESETTABLE-INACTIVITY']){
    assert.throws(()=>assertXrplProductClaim({mode:XRPL_RECOVERY_MODES.FIXED_TIME_ESCROW,claim}),/Unknown XRPL recovery product claim/);
  }
  assert.throws(()=>assertXrplProductClaim({mode:XRPL_RECOVERY_MODES.FIXED_TIME_ESCROW,claim:XRPL_RECOVERY_MODES.SIGNER_QUORUM}),/does not match/);
  assert.equal(assertXrplProductClaim({mode:XRPL_RECOVERY_MODES.FIXED_TIME_ESCROW,claim:XRPL_RECOVERY_MODES.FIXED_TIME_ESCROW}),true);
});


test('XRPL SignerListSet Fee does not coerce unsafe or over-supply drop amounts',()=>{
  const cfg={owner,contacts:[a,b],quorum:2,sequence:12};
  for(const feeDrops of ['0','10','100000000000000000']){
    assert.equal(buildXrplSignerListSet({...cfg,feeDrops}).transaction.Fee,feeDrops);
  }
  for(const feeDrops of ['001',1.5,Number.MAX_SAFE_INTEGER+1,{},new Number(1),true,'100000000000000001']){
    assert.throws(()=>buildXrplSignerListSet({...cfg,feeDrops}),/canonical non-negative/);
  }
});


test('XRPL multisign Fee is exact and fixed before signature coordination',()=>{
  const signerList={owner,signerEntries:[{account:a,weight:1},{account:b,weight:1}],quorum:2};
  const signatures=[{account:a,signingPubKey:'EDA',txnSignature:'AAA'},
    {account:b,signingPubKey:'EDB',txnSignature:'BBB'}];
  const base={TransactionType:'Payment',Account:owner,Destination:rescue,Amount:'1',Sequence:10};
  const run=(fee,baseFeeDrops='10')=>coordinateXrplMultisign({
    transaction:{...base,...(fee===undefined?{}:{Fee:fee})},signerList,signatures,baseFeeDrops
  });
  assert.equal(run('30').minimumFeeDrops,'30');
  for(const fee of [undefined,'029',{},true,'100000000000000001',Number.MAX_SAFE_INTEGER+1]){
    assert.throws(()=>run(fee),/Fee|fee/);
  }
  assert.throws(()=>run('30',{}),/baseFeeDrops/);
});


test('XRPL exact-inactivity claim retains fail-closed semantics across every native mode',()=>{
  for(const mode of Object.values(XRPL_RECOVERY_MODES)){
    assert.throws(()=>assertXrplProductClaim({mode,claim:'resettable-inactivity'}),/must not be advertised/);
  }
});


test('XRPL SignerList transaction freezes every signer entry and the list',()=>{
  const tx=buildXrplSignerListSet({owner,contacts:[a,b],quorum:2,sequence:12}).transaction;
  assert.equal(Object.isFrozen(tx.SignerEntries),true);
  assert.equal(Object.isFrozen(tx.SignerEntries[0]),true);
  assert.equal(Object.isFrozen(tx.SignerEntries[0].SignerEntry),true);
  assert.throws(()=>tx.SignerEntries.push({SignerEntry:{Account:rescue,SignerWeight:50}}),TypeError);
});


test('XRPL coordinated multisign records lock signer identity and signatures',()=>{
  const signerList={owner,signerEntries:[{account:a,weight:1},{account:b,weight:1}],quorum:2};
  const tx={TransactionType:'Payment',Account:owner,Destination:rescue,Amount:'1',Sequence:10,Fee:'30'};
  const signatures=[{account:a,signingPubKey:'EDA',txnSignature:'AAA'},
    {account:b,signingPubKey:'EDB',txnSignature:'BBB'}];
  const result=coordinateXrplMultisign({transaction:tx,signerList,signatures,baseFeeDrops:'10'});
  assert.equal(Object.isFrozen(result.transaction.Signers),true);
  assert.equal(Object.isFrozen(result.transaction.Signers[0].Signer),true);
  assert.throws(()=>result.transaction.Signers.push({Signer:{Account:rescue}}),TypeError);
});
