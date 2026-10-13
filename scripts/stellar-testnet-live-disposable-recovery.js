#!/usr/bin/env node
/**
 * Explicitly gated disposable-identity Stellar Testnet proof.
 * Generates fresh ephemeral Testnet-only keypairs in this process. NEVER
 * accepts a seed or user wallet, prints a secret, or uses a mainnet URL.
 * Funding and native recovery will leave real PUBLIC TESTNET transactions.
 * This is one N-of-N native XLM recovery only, not connector promotion.
 */
import { pathToFileURL } from 'node:url';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  buildHeartbeatEnvelopeArtifact,
  buildFeeBumpEnvelopeArtifact,
  buildRecoveryEnvelopeArtifact,
  createFeeBumpSponsorPlan,
  createHeartbeatPlan,
  createRecoveryEnvelopePlan,
  createSignerSetupPlan,
  validateRecoveryAccountSnapshot,
  verifySignedFeeBumpEnvelopeArtifact,
  verifySignedHeartbeatEnvelopeArtifact,
  verifySignedRecoveryEnvelopeArtifact
} from '../src/chains/stellar/native-recovery.js';
import {
  createStellarTestnetHorizonHttpTransport
} from '../src/chains/stellar/horizon-http-transport.js';
import {
  normalizeHorizonAccountSnapshot,
  normalizeHorizonFinality,
  normalizeHorizonSubmissionSuccess
} from '../src/chains/stellar/horizon-proof-driver.js';

const FRIENDbot = 'https://friendbot.stellar.org';
const TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';
const ENABLE = 'OMEGAVAULT_STELLAR_DISPOSABLE_TESTNET';
const CONFIRM = 'DISPOSABLE_FAKE_XLM_ONLY';
const TEST_XLM = '1.0000000';
const INACTIVITY_SECONDS = 45;

function requireGate(env) {
  if (env?.[ENABLE] !== CONFIRM) {
    throw new Error('Disposable Stellar Testnet live execution is disabled; explicit testnet gate is required.');
  }
}
export function disposableStellarFeeSponsorMode(env) {
  requireGate(env);
  const value=env?.OMEGAVAULT_STELLAR_DISPOSABLE_SPONSOR ?? 'OFF';
  if(value !== 'OFF' && value !== 'SPONSORED_FAKE_XLM_ONLY'){
    throw new Error('Disposable fee sponsorship requires an explicit, exact Testnet-only opt-in.');
  }
  return value==='SPONSORED_FAKE_XLM_ONLY';
}
export function disposableStellarContactCount(env) {
  requireGate(env);
  const value=env?.OMEGAVAULT_STELLAR_DISPOSABLE_CONTACTS ?? '1';
  if(value!=='1' && value!=='2'){
    throw new Error('Disposable Stellar Testnet supports exactly one or two independent ephemeral contacts.');
  }
  return Number(value);
}
function amountUnits(amount) {
  const match = /^(0|[1-9]\d*)\.(\d{7})$/.exec(amount);
  if (!match) throw new TypeError('Horizon amount must have exactly seven decimal places.');
  return BigInt(match[1]) * 10000000n + BigInt(match[2]);
}
function nativeBalance(response, expectedAccount) {
  if (response?.account_id !== expectedAccount) throw new Error('Horizon returned an account other than the requested account.');
  const lines = response?.balances?.filter(x=>x?.asset_type==='native');
  if (!Array.isArray(lines) || lines.length !== 1) throw new Error('Expected exactly one Horizon native-XLM balance.');
  return amountUnits(lines[0].balance);
}
function assertSuccess(response, expectedHash) {
  const normalized = normalizeHorizonSubmissionSuccess({ response, expectedTransactionHashHex:expectedHash });
  if (normalized.resultCode !== 'txSUCCESS') throw new Error('Live transaction did not prove success.');
  return normalized;
}
export function requireStellarTestnetTooEarly(error, expectedTransactionHashHex, observedAt) {
  // minAccountSequenceAge has a distinct native Stellar Core result code.
  // txTOO_EARLY is for absolute minTime timebounds, not sequence age.
  // Do not allow bad sequence, insufficient fee, auth failures or generic
  // Horizon errors to masquerade as successful inactivity enforcement.
  const resultCode = error?.response?.data?.extras?.result_codes?.transaction;
  if (resultCode !== 'tx_bad_minseq_age_or_gap') {
    throw new Error('Expected native Stellar minimum-sequence-age rejection, received '+String(resultCode ?? 'unknown'));
  }
  if (typeof expectedTransactionHashHex !== 'string' ||
      !/^[a-f0-9]{64}$/.test(expectedTransactionHashHex)) {
    throw new Error('Premature rejection requires a bound 32-byte transaction hash.');
  }
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('Premature rejection requires an observation timestamp.');
  return Object.freeze({
    transactionHashHex: expectedTransactionHashHex,
    observedAt: new Date(observedAt).toISOString(),
    includedInLedger: false,
    successful: false,
    resultCode
  });
}
async function proveTooEarly({ transport, signedTransactionXdr, expectedHash, vault, rescue, expectedSequence, expectedPreAuthSigner, expectedRescueBalance, label }) {
  let rejected = null;
  try {
    await transport.submitTransactionXdr(signedTransactionXdr);
  } catch (error) {
    rejected = requireStellarTestnetTooEarly(error, expectedHash, new Date().toISOString());
  }
  if (!rejected || rejected.includedInLedger !== false || rejected.resultCode !== 'tx_bad_minseq_age_or_gap') {
    throw new Error(label+' must produce a real non-included minimum-sequence-age rejection.');
  }
  const [state, beneficiary] = await Promise.all([
    transport.loadAccount(vault), transport.loadAccount(rescue)
  ]);
  if (String(state.sequence) !== String(expectedSequence)) {
    throw new Error(label+' unexpectedly advanced the source sequence.');
  }
  if (!state.signers?.some(s=>s.key === expectedPreAuthSigner && Number(s.weight)>0)) {
    throw new Error(label+' unexpectedly removed the recovery preAuthTx signer.');
  }
  if (nativeBalance(beneficiary,rescue) !== expectedRescueBalance) {
    throw new Error(label+' unexpectedly credited the recovery beneficiary.');
  }
  return Object.freeze({ outcome:rejected.resultCode, transactionHash:expectedHash, sourceSequenceUnchanged:true, preAuthSignerPreserved:true, rescueBalanceUnchanged:true });
}
async function fetchFund(fetchImpl, account) {
  const res = await fetchImpl(FRIENDbot+'/?addr='+encodeURIComponent(account),{
    method:'GET',headers:{accept:'application/json'},signal:AbortSignal.timeout(30000)
  });
  if (res?.ok !== true) throw new Error('Testnet Friendbot funding failed (HTTP '+String(res?.status??'unknown')+').');
  const body=await res.json();
  if (!body || typeof body !== 'object') throw new Error('Friendbot did not supply a transaction receipt.');
  return body;
}
async function pollAccount(transport,account,{attempts=12}={}) {
  for(let i=0;i<attempts;i+=1){
    try {return await transport.loadAccount(account);}
    catch(e){if(e?.response?.data?.status!==404 && !/HTTP 404/.test(e.message))throw e;}
    if(i+1<attempts)await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error('Funded disposable Testnet account did not become observable in Horizon.');
}
function safePublicResult(record) {
  // Strict public-only report; never return a Keypair or private secret.
  return Object.freeze({
    schema:'omegavault.stellar.disposable-testnet-native-recovery.v1',
    network:'stellar:testnet',
    networkPassphrase:Networks.TESTNET,
    ...record,
    mainnetTouched:false,
    ownerOrCustomerKeysUsed:false,
    productionSupportProven:false
  });
}
export async function runStellarDisposableTestnetRecovery({ env=process.env,fetchImpl=globalThis.fetch }={}) {
  requireGate(env);
  if(typeof fetchImpl!=='function') throw new TypeError('Live Testnet proof requires fetch().');
  if(Networks.TESTNET!=='Test SDF Network ; September 2015') throw new Error('Stellar Testnet identity mismatch.');
  const contactCount=disposableStellarContactCount(env);
  const sponsored=disposableStellarFeeSponsorMode(env);
  // Each participating signer is generated afresh; no customer or owner key.
  const vault=Keypair.random(), rescue=Keypair.random();
  const contacts=Array.from({length:contactCount},()=>Keypair.random());
  const feeSponsor=sponsored?Keypair.random():null;
  const contactAddresses=contacts.map(contact=>contact.publicKey());
  const allIdentities=[vault.publicKey(),rescue.publicKey(),...contactAddresses,
    ...(feeSponsor?[feeSponsor.publicKey()]:[])];
  if(new Set(allIdentities).size!==allIdentities.length){
    throw new Error('Discovered duplicate disposable Stellar signer identities.');
  }
  const transport=createStellarTestnetHorizonHttpTransport({
    fetchImpl,pollIntervalMs:2000,maxEligibilityAttempts:90
  });
  await fetchFund(fetchImpl,vault.publicKey());
  await fetchFund(fetchImpl,rescue.publicKey());
  if (feeSponsor) await fetchFund(fetchImpl,feeSponsor.publicKey());
  const initialVault=await pollAccount(transport,vault.publicKey());
  const initialRescue=await pollAccount(transport,rescue.publicKey());
  const rescueBalanceBefore=nativeBalance(initialRescue,rescue.publicKey());

  const recoveryPlan=createRecoveryEnvelopePlan({
    vaultAccount:vault.publicKey(),
    rescueDestination:rescue.publicKey(),
    currentSequence:String(initialVault.sequence),
    inactivitySeconds:INACTIVITY_SECONDS,
    contacts:contactAddresses,
    threshold:contactCount,
    assets:['native'],
    amounts:{native:TEST_XLM}
  });
  const recoveryArtifact=buildRecoveryEnvelopeArtifact(recoveryPlan);
  const signedRecovery=TransactionBuilder.fromXdr(
    recoveryArtifact.transactionXdr,Networks.TESTNET
  );
  signedRecovery.sign(...contacts);
  const verified=verifySignedRecoveryEnvelopeArtifact({
    plan:recoveryPlan,artifact:recoveryArtifact,signedTransactionXdr:signedRecovery.toXdr()
  });
  if(!verified.valid)throw new Error('Disposable recovery XDR failed signature validation: '+verified.errors.join('; '));

  let signedFeeBump=null;
  let feeBumpArtifact=null;
  let feeBumpPlan=null;
  if(feeSponsor){
    feeBumpPlan=createFeeBumpSponsorPlan({
      feeAccount:feeSponsor.publicKey(),
      innerEnvelopeHash:recoveryArtifact.transactionHashHex,
      maxFeeStroops:'1000'
    });
    feeBumpArtifact=buildFeeBumpEnvelopeArtifact({
      recoveryPlan,recoveryArtifact,
      signedRecoveryTransactionXdr:signedRecovery.toXdr(),
      feeBumpPlan,baseFeeStroops:'200'
    });
    signedFeeBump=TransactionBuilder.fromXdr(feeBumpArtifact.feeBumpTransactionXdr,Networks.TESTNET);
    signedFeeBump.sign(feeSponsor);
    const verification=verifySignedFeeBumpEnvelopeArtifact({
      recoveryPlan,recoveryArtifact,feeBumpPlan,artifact:feeBumpArtifact,
      signedFeeBumpTransactionXdr:signedFeeBump.toXdr()
    });
    if(!verification.valid)throw new Error('Sponsored envelope failed signed inner/outer verification: '+verification.errors.join('; '));
    if(signedFeeBump.innerTransaction.toXdr()!==signedRecovery.toXdr() ||
       feeBumpArtifact.innerTransactionHashHex!==recoveryArtifact.transactionHashHex){
      throw new Error('Fee sponsorship changed the protected recovery envelope.');
    }
  }

  // A single owner-authorized, on-ledger atomic setup binds exactly this
  // recovery hash; the contact never acquires account-wide signing authority.
  const setupPlan=createSignerSetupPlan({plan:recoveryPlan,transactionHashHex:recoveryArtifact.transactionHashHex});
  if(setupPlan.operations.length!==2 || setupPlan.preAuthTxSigner!==recoveryArtifact.preAuthTxSigner){
    throw new Error('Live Testnet setup plan differs from the native policy.');
  }
  const setup=new TransactionBuilder(
    new Account(vault.publicKey(),String(initialVault.sequence)),
    {fee:'100',networkPassphrase:Networks.TESTNET}
  ).addOperation(Operation.setOptions({
    masterWeight:1,lowThreshold:1,medThreshold:1,highThreshold:1
  })).addOperation(Operation.setOptions({
    signer:{preAuthTx:recoveryArtifact.transactionHashHex,weight:1}
  })).setTimeout(90).build();
  setup.sign(vault);
  const setupHash=Buffer.from(setup.hash()).toString('hex');
  const setupResult=assertSuccess(await transport.submitTransactionXdr(setup.toXdr()),setupHash);
  const setupState=await pollAccount(transport,vault.publicKey());
  const normalized=normalizeHorizonAccountSnapshot({
    accountResponse:setupState,expectedAccount:vault.publicKey()
  });
  const readiness=validateRecoveryAccountSnapshot({
    plan:recoveryPlan,artifact:recoveryArtifact,snapshot:normalized
  });
  if(!readiness.ready)throw new Error('Real Horizon setup state differs from recovery policy: '+readiness.errors.join('; '));
  if(BigInt(setupState.sequence)<=BigInt(initialVault.sequence)){
    throw new Error('Testnet signer setup did not advance owner account sequence.');
  }

  // The exact pre-authorized recovery must be rejected while owner is active.
  const initialRejection=await proveTooEarly({
    transport,signedTransactionXdr:signedRecovery.toXdr(),
    expectedHash:recoveryArtifact.transactionHashHex,
    vault:vault.publicKey(),rescue:rescue.publicKey(),
    expectedSequence:String(setupState.sequence),
    expectedPreAuthSigner:recoveryArtifact.preAuthTxSigner,
    expectedRescueBalance:rescueBalanceBefore,
    label:'Pre-heartbeat early recovery'
  });

  // Owner heartbeat is an actual signed Stellar bumpSequence, not a local
  // timestamp reset; it must preserve the already-bound preAuthTx signer.
  const heartbeatPlan=createHeartbeatPlan({
    vaultAccount:vault.publicKey(),currentSequence:String(setupState.sequence)
  });
  const heartbeatArtifact=buildHeartbeatEnvelopeArtifact({
    vaultAccount:vault.publicKey(),currentSequence:String(setupState.sequence)
  });
  const signedHeartbeat=TransactionBuilder.fromXdr(heartbeatArtifact.transactionXdr,Networks.TESTNET);
  signedHeartbeat.sign(vault);
  const verifiedHeartbeat=verifySignedHeartbeatEnvelopeArtifact({
    plan:heartbeatPlan,artifact:heartbeatArtifact,signedTransactionXdr:signedHeartbeat.toXdr()
  });
  if(!verifiedHeartbeat.valid)throw new Error('Owner heartbeat did not pass offline signature checks: '+verifiedHeartbeat.errors.join('; '));
  const heartbeatResult=assertSuccess(
    await transport.submitTransactionXdr(signedHeartbeat.toXdr()),heartbeatArtifact.transactionHashHex
  );
  const heartbeatTransaction=await transport.loadTransaction(heartbeatArtifact.transactionHashHex);
  const heartbeatLedger=await transport.loadLedger(heartbeatResult.ledger);
  const heartbeatFinality=normalizeHorizonFinality({
    transactionResponse:heartbeatTransaction,ledgerResponse:heartbeatLedger,
    expectedTransactionHashHex:heartbeatArtifact.transactionHashHex,
    expectedLedger:heartbeatResult.ledger
  });
  const postHeartbeatState=await transport.loadAccount(vault.publicKey());
  const postHeartbeatSequence=String(BigInt(setupState.sequence)+2n);
  if(String(postHeartbeatState.sequence)!==postHeartbeatSequence ||
     BigInt(postHeartbeatState.sequence_time??-1)<=BigInt(setupState.sequence_time??-1)) {
    throw new Error('Real owner heartbeat did not advance the sequence/sequence-age anchor.');
  }
  const afterHeartbeat=normalizeHorizonAccountSnapshot({
    accountResponse:postHeartbeatState,expectedAccount:vault.publicKey()
  });
  const readyAfterHeartbeat=validateRecoveryAccountSnapshot({
    plan:recoveryPlan,artifact:recoveryArtifact,snapshot:afterHeartbeat
  });
  if(!readyAfterHeartbeat.ready)throw new Error('Owner heartbeat destroyed configured recovery policy: '+readyAfterHeartbeat.errors.join('; '));

  // The SAME immutable signed recovery envelope must again be too early
  // after the owner heartbeat. It cannot consume the preAuth signer or funds.
  const resetRejection=await proveTooEarly({
    transport,signedTransactionXdr:signedRecovery.toXdr(),
    expectedHash:recoveryArtifact.transactionHashHex,
    vault:vault.publicKey(),rescue:rescue.publicKey(),
    expectedSequence:postHeartbeatSequence,
    expectedPreAuthSigner:recoveryArtifact.preAuthTxSigner,
    expectedRescueBalance:rescueBalanceBefore,
    label:'Post-heartbeat early recovery'
  });

  // Eligibility is established from genuine latest ledger close time and
  // the freshly reset account sequence age. Never use local clock alone.
  const eligible=await transport.waitUntilEligible({
    sourceAccount:vault.publicKey(),
    minAccountSequenceAge:recoveryPlan.preconditions.minAccountSequenceAge,
    currentSequence:postHeartbeatSequence,
    recoverySequence:recoveryPlan.sequence.recoverySequence
  });
  if(eligible.eligible!==true)throw new Error('Real Testnet post-heartbeat eligibility was not observed.');

  // Establish actual balances immediately before final recovery. With a
  // fee bump, the fee payer must pay and the vault must lose only 1 XLM.
  const beforeRecoveryVault=await transport.loadAccount(vault.publicKey());
  const vaultBeforeBalance=nativeBalance(beforeRecoveryVault,vault.publicKey());
  const beforeSponsor=feeSponsor?await transport.loadAccount(feeSponsor.publicKey()):null;
  const sponsorBeforeBalance=feeSponsor?nativeBalance(beforeSponsor,feeSponsor.publicKey()):null;
  const submittedHash=feeBumpArtifact?.feeBumpTransactionHashHex ?? recoveryArtifact.transactionHashHex;
  const signedFinalXdr=signedFeeBump?.toXdr() ?? signedRecovery.toXdr();
  const recoveryResult=assertSuccess(
    await transport.submitTransactionXdr(signedFinalXdr),
    submittedHash
  );
  const chainTx=await transport.loadTransaction(submittedHash);
  const chainLedger=await transport.loadLedger(recoveryResult.ledger);
  const finality=normalizeHorizonFinality({
    transactionResponse:chainTx,
    ledgerResponse:chainLedger,
    expectedTransactionHashHex:submittedHash,
    expectedLedger:recoveryResult.ledger
  });
  let sponsorshipEvidence=null;
  if(feeSponsor){
    if(chainTx.fee_account!==feeSponsor.publicKey() ||
       String(chainTx.inner_transaction_hash??'').toLowerCase()!==recoveryArtifact.transactionHashHex){
      throw new Error('Real Horizon fee-bump transaction did not bind the expected sponsor and signed inner recovery.');
    }
    const chargedRaw=String(chainTx.fee_charged??'');
    if(!/^[1-9]\d*$/.test(chargedRaw) ||
       BigInt(chargedRaw)>BigInt(feeBumpArtifact.maxFeeStroops)){
      throw new Error('Real fee bump did not report a bounded positive fee charge.');
    }
    const [afterSponsor,afterVault]=await Promise.all([
      transport.loadAccount(feeSponsor.publicKey()),transport.loadAccount(vault.publicKey())
    ]);
    if(sponsorBeforeBalance-nativeBalance(afterSponsor,feeSponsor.publicKey())!==BigInt(chargedRaw)){
      throw new Error('Sponsor XLM balance did not pay the exact on-ledger charged fee.');
    }
    if(vaultBeforeBalance-nativeBalance(afterVault,vault.publicKey())!==amountUnits(TEST_XLM)){
      throw new Error('Sponsored inner recovery unexpectedly charged vault transaction fees or extra funds.');
    }
    sponsorshipEvidence=Object.freeze({
      feePayer:feeSponsor.publicKey(),
      outerTransactionHash:submittedHash,
      innerTransactionHash:recoveryArtifact.transactionHashHex,
      actualFeeChargedStroops:chargedRaw,
      totalBidFeeCapStroops:feeBumpArtifact.maxFeeStroops,
      signedInnerEnvelopePreserved:true,
      sponsorChargedExactHorizonFee:true,
      vaultOnlyPaidProtectedRecoveryAmount:true
    });
  }
  const finalRescue=await pollAccount(transport,rescue.publicKey());
  const rescueBalanceAfter=nativeBalance(finalRescue,rescue.publicKey());
  if(rescueBalanceAfter-rescueBalanceBefore!==amountUnits(TEST_XLM)){
    throw new Error('Testnet rescue balance failed exact 1 XLM recovery conservation.');
  }
  const finalVault=await pollAccount(transport,vault.publicKey());
  if(finalVault.signers?.some(x=>x.key===recoveryArtifact.preAuthTxSigner)){
    throw new Error('Consumed single-use Testnet preAuthTx signer still present after successful recovery.');
  }
  if(finality.status!=='finalized')throw new Error('Real Horizon finality evidence is incomplete.');
  return safePublicResult({
    method:'stellar-native-preauth-sequence-age-extra-signer',
    owner:vault.publicKey(),
    rescue:rescue.publicKey(),
    contacts:contactAddresses,
    threshold:contactCount,
    setupTransactionHash:setupHash,
    setupLedger:setupResult.ledger,
    initialEarlyRejection:initialRejection,
    ownerHeartbeatTransactionHash:heartbeatArtifact.transactionHashHex,
    ownerHeartbeatLedger:heartbeatResult.ledger,
    ownerHeartbeatLedgerHash:heartbeatFinality.ledgerHash,
    postHeartbeatEarlyRejection:resetRejection,
    inactivitySeconds:INACTIVITY_SECONDS,
    recoveryTransactionHash:recoveryArtifact.transactionHashHex,
    networkSubmittedTransactionHash:submittedHash,
    sponsorshipEvidence,
    recoveryLedger:recoveryResult.ledger,
    recoveryLedgerHash:finality.ledgerHash,
    amountRecoveredXlm:TEST_XLM,
    verifiedOwnerSignerSet:true,
    verifiedContactBoundToExactRecovery:true,
    verifiedSequenceAge:true,
    ownerHeartbeatResetProven:true,
    initialAndResetEarlyRejectionsProven:true,
    rescueCreditConfirmed:true,
    singleUseSignerConsumed:true
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  runStellarDisposableTestnetRecovery()
    .then(result=>{console.log(JSON.stringify(result,null,2));})
    .catch(error=>{console.error('STELLAR_TESTNET_PROOF_BLOCKED:',String(error?.message??error));process.exitCode=1;});
}
