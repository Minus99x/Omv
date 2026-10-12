import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { createCardanoPreprodIndependentPhaseOneInput, verifyCardanoPreprodIndependentPhaseOneInput } from '../src/chains/cardano/preprod-independent-phase-one-input.js';
const h=(c)=>c.repeat(64);
function serializedFixtureTransaction() {
  const inputs=Cardano.TransactionInputs.new();
  inputs.add(Cardano.TransactionInput.new(
    Cardano.TransactionHash.from_hex(h('a')), 0
  ));
  const outputs=Cardano.TransactionOutputs.new();
  const address=Cardano.EnterpriseAddress.new(
    0, Cardano.Credential.from_keyhash(Cardano.Ed25519KeyHash.from_hex('3'.repeat(56)))
  ).to_address();
  outputs.add(Cardano.TransactionOutput.new(
    address, Cardano.Value.new(Cardano.BigNum.from_str('3000000'))
  ));
  const body=Cardano.TransactionBody.new_tx_body(
    inputs, outputs, Cardano.BigNum.from_str('200000')
  );
  // A deterministic test-only owner signature keeps this fixture genuinely
  // signed without involving a connected wallet or any real credentials.
  const privateKey=Cardano.PrivateKey.from_normal_bytes(Uint8Array.from({length:32},()=>9));
  const witnessSet=Cardano.TransactionWitnessSet.new();
  const vkeys=Cardano.Vkeywitnesses.new();
  vkeys.add(Cardano.make_vkey_witness(
    Cardano.TransactionHash.from_bytes(blake2b(body.to_bytes(), {dkLen:32})),
    privateKey
  ));
  witnessSet.set_vkeys(vkeys);
  const signed=Cardano.Transaction.new(body, witnessSet).to_hex();
  return Object.freeze({
    signed,
    bodyHash:Buffer.from(blake2b(body.to_bytes(), {dkLen:32})).toString('hex')
  });
}
const {signed,bodyHash}=serializedFixtureTransaction();
const sha=createHash('sha256').update(Buffer.from(signed,'hex')).digest('hex');
const actions={transactionSubmissionAuthorized:false,transactionSubmissionPerformed:false,liveValueMovementAuthorized:false,publicNetworkRecoveryProven:false,supportClaimAuthorized:false};
const checks=Object.fromEntries([
  'currentProtocolParametersIndependentlyConfirmed', 'frozenUnsignedPreflightStillReproduces',
  'walletWitnessEvidenceVerified','exactSignedBodyPreserved', 'currentProtocolSnapshotBoundAndReproducible',
  'currentProtocolSnapshotStableTipBound','currentProtocolParametersBoundByDigest','signedTransactionSizeWithinCurrentMaximum',
  'signedExecutionUnitsWithinCurrentMaximum','signedFeeCoversCurrentMinimum','outputValueSizesWithinCurrentMaximum',
  'seedStillUnspent','collateralStillUnspent','boundInputValuesUnchanged','boundInputOutputShapeUnchanged',
  'validityIntervalCurrent','preSubmitFreshnessGateComplete'
].map(x=>[x,true]));
function fixture() {
 const witness={
   schema:'omegavault.cardano.preprod-initialize-wallet-witness-evidence.v1',network:'preprod',action:'initialize',
   unsignedCandidateSha256:h('a'),unsignedPreflightSha256:h('b'),validatorIdentitySha256:h('c'),utxoBindingEvidenceSha256:h('d'),
   transactionBodyHash:bodyHash,signedTransactionCborHex:signed,signedTransactionSha256:sha,
   checks:{exactWalletProducedSignedBytesPreserved:true,signedTransactionCanonicalRoundTripExact:true,exactUnsignedBodyPreserved:true,auxiliaryDataPreserved:true,nonWalletWitnessesPreserved:true,exactOwnerKeyWitnessCount:true,ownerPaymentKeyHashMatched:true,ownerSignatureCryptographicallyValid:true,walletWitnessesValidated:true,completePhaseOneValidated:false},liveActions:{...actions}
 };
 witness.witnessEvidenceSha256=hashCardanoEvidence(witness);
 const tip={hash:h('f'),slot:10000};
 const snapshot={schemaVersion:2,tip:{blockHash:tip.hash,slot:tip.slot},parameters:{sourceBlockHash:tip.hash}};
 const utxo=(char,index)=>({reference:{transaction:{id:h(char)},index},address:'addr_test1vfixture',lovelace:'5000000',valueSha256:h(char),datumPresent:false,referenceScriptPresent:false,stillUnspent:true,exactValuePreserved:true,exactOutputShapePreserved:true});
 const presubmit={
   schema:'omegavault.cardano.preprod-initialize-pre-submit-evidence.v2',network:'preprod',action:'initialize',
   witnessEvidenceSha256:witness.witnessEvidenceSha256,
   unsignedCandidateSha256:witness.unsignedCandidateSha256,
   unsignedPreflightSha256:witness.unsignedPreflightSha256,
   validatorIdentitySha256:witness.validatorIdentitySha256,
   utxoBindingEvidenceSha256:witness.utxoBindingEvidenceSha256,
   signedTransaction:{sha256:sha,bytes:signed.length/2},
   currentProtocolSnapshot:snapshot,currentProtocolSnapshotSha256:hashCardanoEvidence(snapshot),
   currentProtocolParametersSha256:h('a'),currentTip:tip,
   validity:{lowerSlot:9990,upperSlot:10010,currentTipWithinInterval:true},
   currentInputs:{seed:utxo('1',0),collateral:utxo('2',1)},
   checks:{...checks,completeCurrentInputValuesPreserved:true,completePhaseOneValidated:false},liveActions:{...actions}
 };
 presubmit.ledgerInputSnapshot={
   source:'read-only-ogmios-queryLedgerState/utxo',
   tip:structuredClone(tip),
   utxos:Object.fromEntries(['seed','collateral'].map(name=>[name,{
     reference:structuredClone(presubmit.currentInputs[name].reference),
     address:presubmit.currentInputs[name].address,
     value:{ada:{lovelace:'5000000'}},datumHash:null,datum:null,script:null
   }]))
 };
 for(const role of ['seed','collateral']){
   presubmit.currentInputs[role].valueSha256=hashCardanoEvidence(presubmit.ledgerInputSnapshot.utxos[role].value);
 }
 presubmit.ledgerInputSnapshotSha256=hashCardanoEvidence(presubmit.ledgerInputSnapshot);
 presubmit.preSubmitSha256=hashCardanoEvidence(presubmit);
 return {witnessEvidence:witness,preSubmitEvidence:presubmit,signedTransactionCborHex:signed};
}
function resign(doc,key) { delete doc[key]; doc[key]=hashCardanoEvidence(doc); }
const create=x=>createCardanoPreprodIndependentPhaseOneInput(x);
test('builds a deterministic byte-exact independent verifier request without claiming phase one',()=>{
 const x=fixture();const result=create(x);
 assert.equal(result.signedTransaction.cborHex,signed);
 assert.equal(result.signedTransaction.sha256,sha);
 assert.equal(result.ledgerContext.tip.hash,h('f'));
 assert.equal(result.requestSha256,create(x).requestSha256);
 assert.equal(result.completePhaseOneValidated,false);
 assert.equal(result.transactionSubmissionAuthorized,false);
 assert.equal(result.transactionSubmissionPerformed,false);
 assert.equal(result.validationRequirements.noTransactionRebuild,true);
 assert.equal(result.validationRequirements.noSubmissionOrBroadcast,true);
 assert.equal(verifyCardanoPreprodIndependentPhaseOneInput({input:result,...x}).valid,true);
});
test('does not accept caller-supplied validated status as a valid request',()=>{
 const x=fixture(); const result=structuredClone(create(x));
 result.completePhaseOneValidated=true;
 assert.equal(verifyCardanoPreprodIndependentPhaseOneInput({input:result,...x}).valid,false);
});
test('fails on changed exact signed CBOR bytes',()=>{
 const x=fixture(); x.signedTransactionCborHex='deadbeef02';assert.throws(()=>create(x),/exact already-witnessed/);
});
test('fails on forged witness self-digest',()=>{
 const x=fixture(); x.witnessEvidence.transactionBodyHash=h('0');assert.throws(()=>create(x),/self-digest mismatch/);
});
test('fails on forged pre-submit self-digest',()=>{
 const x=fixture(); x.preSubmitEvidence.validity.upperSlot=10020;assert.throws(()=>create(x),/self-digest mismatch/);
});
test('fails on mutated output with recomputed digest',()=>{
 const x=fixture();x.preSubmitEvidence.signedTransaction.bytes=3;resign(x.preSubmitEvidence,'preSubmitSha256');assert.throws(()=>create(x),/byte length/);
});
test('fails on changed signed transaction sha256',()=>{
 const x=fixture(); x.preSubmitEvidence.signedTransaction.sha256=h('9');resign(x.preSubmitEvidence,'preSubmitSha256');assert.throws(()=>create(x),/digest is inconsistent/);
});
test('fails if pre-submit evidence does not bind the owner witness',()=>{
 const x=fixture();x.preSubmitEvidence.witnessEvidenceSha256=h('0');resign(x.preSubmitEvidence,'preSubmitSha256');assert.throws(()=>create(x),/does not bind/);
});
test('fails if the validator identity changes between witness and pre-submit',()=>{
 const x=fixture();x.preSubmitEvidence.validatorIdentitySha256=h('0');resign(x.preSubmitEvidence,'preSubmitSha256');assert.throws(()=>create(x),/changed the signed candidate/);
});
test('fails closed when a prerequisite check is explicitly false',()=>{
 const x=fixture();x.preSubmitEvidence.checks.seedStillUnspent=false;resign(x.preSubmitEvidence,'preSubmitSha256');assert.throws(()=>create(x),/seedStillUnspent/);
});
test('fails closed on forbidden submission authorization',()=>{
 const x=fixture();x.preSubmitEvidence.liveActions.transactionSubmissionAuthorized=true;resign(x.preSubmitEvidence,'preSubmitSha256');assert.throws(()=>create(x),/deny transactionSubmissionAuthorized/);
});
test('fails closed on a fake phase-one success in existing evidence',()=>{
 const x=fixture();x.preSubmitEvidence.checks.completePhaseOneValidated=true;resign(x.preSubmitEvidence,'preSubmitSha256');assert.throws(()=>create(x),/must not claim/);
});
test('fails closed on protocol snapshot tampering',()=>{
 const x=fixture();x.preSubmitEvidence.currentProtocolSnapshot.parameters.sourceBlockHash=h('0');resign(x.preSubmitEvidence,'preSubmitSha256');assert.throws(()=>create(x),/snapshot does not reproduce/);
});
test('fails closed on protocol snapshot not tied to stable tip',()=>{
 const x=fixture();x.preSubmitEvidence.currentProtocolSnapshot.parameters.sourceBlockHash=h('0');x.preSubmitEvidence.currentProtocolSnapshotSha256=hashCardanoEvidence(x.preSubmitEvidence.currentProtocolSnapshot);resign(x.preSubmitEvidence,'preSubmitSha256');assert.throws(()=>create(x),/not bound to the recorded stable ledger tip/);
});
test('fails closed if the recorded stable tip is outside validity interval',()=>{
 const x=fixture();x.preSubmitEvidence.validity.upperSlot=9999;resign(x.preSubmitEvidence,'preSubmitSha256');assert.throws(()=>create(x),/validity interval/);
});
test('fails closed when seed and collateral references coincide',()=>{
 const x=fixture();x.preSubmitEvidence.currentInputs.collateral.reference=structuredClone(x.preSubmitEvidence.currentInputs.seed.reference);resign(x.preSubmitEvidence,'preSubmitSha256');assert.throws(()=>create(x),/distinct current UTxOs/);
});
test('fails on changed UTxO value shape despite recomputed outer digest',()=>{
 const x=fixture();x.preSubmitEvidence.currentInputs.seed.exactOutputShapePreserved=false;resign(x.preSubmitEvidence,'preSubmitSha256');assert.throws(()=>create(x),/not proven unspent and unchanged/);
});
test('fails closed if the request digest itself is swapped',()=>{
 const x=fixture();const result=structuredClone(create(x));result.requestSha256=h('0');const check=verifyCardanoPreprodIndependentPhaseOneInput({input:result,...x});assert.equal(check.valid,false);assert.equal(check.completePhaseOneValidated,false);
});
test('rejects an Ogmios evaluated-only artifact instead of signed witness record',()=>{
 const x=fixture();x.witnessEvidence.schema='omegavault.cardano.synchronized-evaluation-evidence.v2';resign(x.witnessEvidence,'witnessEvidenceSha256');assert.throws(()=>create(x),/Expected a verified Cardano Preprod initialize owner-witness/);
});
test('rejects a forged cryptographic witness check even if the digest is recomputed',()=>{
 const x=fixture();x.witnessEvidence.checks.ownerSignatureCryptographicallyValid=false;
 resign(x.witnessEvidence,'witnessEvidenceSha256');
 x.preSubmitEvidence.witnessEvidenceSha256=x.witnessEvidence.witnessEvidenceSha256;
 resign(x.preSubmitEvidence,'preSubmitSha256');
 assert.throws(()=>create(x),/ownerSignatureCryptographicallyValid/);
});

test('fails closed when the complete ledger UTxO snapshot is omitted',()=>{
 const x=fixture();delete x.preSubmitEvidence.ledgerInputSnapshot;resign(x.preSubmitEvidence,'preSubmitSha256');
 assert.throws(()=>create(x),/must be an object/);
});
test('fails closed when a full UTxO value is changed without updating its digest',()=>{
 const x=fixture();x.preSubmitEvidence.ledgerInputSnapshot.utxos.seed.value.ada.lovelace='6000000';
 resign(x.preSubmitEvidence,'preSubmitSha256');
 assert.throws(()=>create(x),/full current ledger input snapshot does not match its bound digest/i);
});
test('fails closed when a full UTxO value is changed and its digest is forged',()=>{
 const x=fixture();x.preSubmitEvidence.ledgerInputSnapshot.utxos.seed.value.ada.lovelace='6000000';
 x.preSubmitEvidence.ledgerInputSnapshotSha256=hashCardanoEvidence(x.preSubmitEvidence.ledgerInputSnapshot);
 resign(x.preSubmitEvidence,'preSubmitSha256');
 assert.throws(()=>create(x),/full UTxO value does not match frozen live input commitment/);
});
test('fails closed when complete current UTxO source tip drifts',()=>{
 const x=fixture();x.preSubmitEvidence.ledgerInputSnapshot.tip.slot+=1;
 x.preSubmitEvidence.ledgerInputSnapshotSha256=hashCardanoEvidence(x.preSubmitEvidence.ledgerInputSnapshot);
 resign(x.preSubmitEvidence,'preSubmitSha256');
 assert.throws(()=>create(x),/not captured at the bound stable tip/);
});
test('includes full current input values for the independent ledger implementation',()=>{
 const input=create(fixture());
 assert.deepEqual(input.ledgerContext.utxos.seed.value,{ada:{lovelace:'5000000'}});
 assert.deepEqual(input.ledgerContext.utxos.collateral.value,{ada:{lovelace:'5000000'}});
 assert.equal(input.completePhaseOneValidated,false);
});

test('independent phase-one input rejects exact exclusive invalidHereafter slot',()=>{
 const x=fixture();
 x.preSubmitEvidence.validity.upperSlot=x.preSubmitEvidence.currentTip.slot;
 resign(x.preSubmitEvidence,'preSubmitSha256');
 assert.throws(()=>create(x),/validity interval does not include/);
});
test('independent phase-one input rejects an empty validity interval',()=>{
 const x=fixture();
 x.preSubmitEvidence.validity.lowerSlot=x.preSubmitEvidence.validity.upperSlot;
 resign(x.preSubmitEvidence,'preSubmitSha256');
 assert.throws(()=>create(x),/validity interval does not include/);
});
test('independent phase-one input rejects a negative lower validity slot',()=>{
 const x=fixture();
 x.preSubmitEvidence.validity.lowerSlot=-1;
 resign(x.preSubmitEvidence,'preSubmitSha256');
 assert.throws(()=>create(x),/validity interval does not include/);
});

test('independent phase-one input rehashes the real signed CBOR body rather than trusting coherent forged evidence',()=>{
 const x=fixture();
 x.witnessEvidence.transactionBodyHash=h('e');
 resign(x.witnessEvidence,'witnessEvidenceSha256');
 x.preSubmitEvidence.witnessEvidenceSha256=x.witnessEvidence.witnessEvidenceSha256;
 resign(x.preSubmitEvidence,'preSubmitSha256');
 assert.throws(()=>create(x),/body hash does not match witnessed CBOR/);
});

test('independent phase-one input rejects non-transaction CBOR even with consistent self-digests',()=>{
 const x=fixture();
 const malformed='deadbeef01';
 const digest=createHash('sha256').update(Buffer.from(malformed,'hex')).digest('hex');
 x.signedTransactionCborHex=malformed;
 x.witnessEvidence.signedTransactionCborHex=malformed;
 x.witnessEvidence.signedTransactionSha256=digest;
 resign(x.witnessEvidence,'witnessEvidenceSha256');
 x.preSubmitEvidence.witnessEvidenceSha256=x.witnessEvidence.witnessEvidenceSha256;
 x.preSubmitEvidence.signedTransaction.sha256=digest;
 x.preSubmitEvidence.signedTransaction.bytes=malformed.length/2;
 resign(x.preSubmitEvidence,'preSubmitSha256');
 assert.throws(()=>create(x),/Signed transaction CBOR cannot be decoded/);
});
