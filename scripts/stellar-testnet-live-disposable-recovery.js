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
  buildRecoveryEnvelopeArtifact,
  createRecoveryEnvelopePlan,
  createSignerSetupPlan,
  validateRecoveryAccountSnapshot,
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

function requireGate(env) {
  if (env?.[ENABLE] !== CONFIRM) {
    throw new Error('Disposable Stellar Testnet live execution is disabled; explicit testnet gate is required.');
  }
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
  // Fresh disposable identities, never sourced from the environment or stored.
  const vault=Keypair.random(), rescue=Keypair.random(), contact=Keypair.random();
  const transport=createStellarTestnetHorizonHttpTransport({
    fetchImpl,pollIntervalMs:2000,maxEligibilityAttempts:90
  });
  await fetchFund(fetchImpl,vault.publicKey());
  await fetchFund(fetchImpl,rescue.publicKey());
  const initialVault=await pollAccount(transport,vault.publicKey());
  const initialRescue=await pollAccount(transport,rescue.publicKey());
  const rescueBalanceBefore=nativeBalance(initialRescue,rescue.publicKey());

  const recoveryPlan=createRecoveryEnvelopePlan({
    vaultAccount:vault.publicKey(),
    rescueDestination:rescue.publicKey(),
    currentSequence:String(initialVault.sequence),
    inactivitySeconds:12,
    contacts:[contact.publicKey()],
    threshold:1,
    assets:['native'],
    amounts:{native:TEST_XLM}
  });
  const recoveryArtifact=buildRecoveryEnvelopeArtifact(recoveryPlan);
  const signedRecovery=TransactionBuilder.fromXdr(
    recoveryArtifact.transactionXdr,Networks.TESTNET
  );
  signedRecovery.sign(contact);
  const verified=verifySignedRecoveryEnvelopeArtifact({
    plan:recoveryPlan,artifact:recoveryArtifact,signedTransactionXdr:signedRecovery.toXdr()
  });
  if(!verified.valid)throw new Error('Disposable recovery XDR failed signature validation: '+verified.errors.join('; '));

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

  // Strict sequence-age observation against real ledger close times, never
  // wall-clock assumption or simulated result. This can take some seconds.
  const eligible=await transport.waitUntilEligible({
    sourceAccount:vault.publicKey(),
    minAccountSequenceAge:recoveryPlan.preconditions.minAccountSequenceAge,
    currentSequence:String(setupState.sequence),
    recoverySequence:recoveryPlan.sequence.recoverySequence
  });
  if(eligible.eligible!==true)throw new Error('Real Testnet sequence-age precondition was not observed.');

  const recoveryResult=assertSuccess(
    await transport.submitTransactionXdr(signedRecovery.toXdr()),
    recoveryArtifact.transactionHashHex
  );
  const chainTx=await transport.loadTransaction(recoveryArtifact.transactionHashHex);
  const chainLedger=await transport.loadLedger(recoveryResult.ledger);
  const finality=normalizeHorizonFinality({
    transactionResponse:chainTx,
    ledgerResponse:chainLedger,
    expectedTransactionHashHex:recoveryArtifact.transactionHashHex,
    expectedLedger:recoveryResult.ledger
  });
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
    contact:contact.publicKey(),
    setupTransactionHash:setupHash,
    setupLedger:setupResult.ledger,
    recoveryTransactionHash:recoveryResult.transactionHashHex,
    recoveryLedger:recoveryResult.ledger,
    recoveryLedgerHash:finality.ledgerHash,
    amountRecoveredXlm:TEST_XLM,
    verifiedOwnerSignerSet:true,
    verifiedContactBoundToExactRecovery:true,
    verifiedSequenceAge:true,
    rescueCreditConfirmed:true,
    singleUseSignerConsumed:true
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  runStellarDisposableTestnetRecovery()
    .then(result=>{console.log(JSON.stringify(result,null,2));})
    .catch(error=>{console.error('STELLAR_TESTNET_PROOF_BLOCKED:',String(error?.message??error));process.exitCode=1;});
}
