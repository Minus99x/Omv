// Live READ-ONLY UTxO and two-provider parameter recheck for an existing
// OmegaVault Cardano Preprod unsigned capture. This cannot sign or submit.
// Old UTxO and protocol evidence is immutable; the latest tip is a NEW check.
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { inspectCardanoPreprodUnsignedCapture } from './inspect-cardano-preprod-unsigned-capture.js';
import {
  createCardanoOgmiosHttpClient,
  normalizeCardanoOgmiosWebSocketUrl,
  createCardanoOgmiosUtxoByOutputReferencesParams,
  parseCardanoOgmiosTipResponse,
  parseCardanoOgmiosUtxoResponse,
  parseCardanoOgmiosEpochResponse,
  parseCardanoOgmiosBlockHeightResponse,
  parseCardanoOgmiosProtocolParametersResponse,
  fetchCardanoBlockfrostPreprodProtocolParameters
} from '../src/chains/cardano/preprod-live-capture.js';
import { createCardanoPreprodLiveProtocolSnapshot } from '../src/chains/cardano/live-protocol-parameters.js';

const MAX_STABLE_RETRIES = 4;
const NETWORK = 'preprod';
const SCHEMA='omegavault.cardano.preprod-initialize-ledger-recheck.v1';

function referenceKey(value) {
  const id=value?.transaction?.id;
  const index=value?.index;
  if (typeof id !== 'string'|| !/^[0-9a-f]{64}$/i.test(id) ||
      !Number.isSafeInteger(index) || index<0) {
    throw new Error('Capture contains invalid original UTxO reference.');
  }
  return id.toLowerCase()+'#'+index;
}
function stable(left,right) {
  return left?.hash===right?.hash && left?.slot===right?.slot;
}
function protocolValues(source) {
  if (!source || source.network!==NETWORK ||
      source.source?.independentSourceCount<2 ||
      source.promotion?.independentlyConfirmed!==true) {
    throw new Error('Captured or current snapshot lacks corroborated Preprod protocol parameters.');
  }
  const { epoch, sourceBlockHash, ...stableValues }=source.parameters ?? {};
  if (Object.keys(stableValues).length<12) throw new Error('Protocol parameter capture is incomplete.');
  return hashCardanoEvidence(stableValues);
}
export function compareCardanoPreprodCapturedLedger({
  capturedBinding,
  capturedCandidate,
  capturedSnapshot,
  currentTip,
  currentUtxos,
  currentSnapshot
}) {
  const roles=capturedBinding?.roles;
  if (!roles?.seed?.reference || !roles?.collateral?.reference) {
    throw new Error('Capture is missing the two original UTxO roles.');
  }
  const seedKey=referenceKey(roles.seed.reference);
  const collateralKey=referenceKey(roles.collateral.reference);
  if (seedKey===collateralKey) throw new Error('Captured seed and collateral must be distinct.');
  if (!Array.isArray(currentUtxos)) throw new Error('Current Ogmios UTxO response is missing.');
  const rows=new Map();
  for (const row of currentUtxos) {
    const key=referenceKey(row);
    if (rows.has(key)) throw new Error('Current ledger returned duplicate UTxO reference.');
    if (key!==seedKey && key!==collateralKey) throw new Error('Current ledger returned an unexpected UTxO reference.');
    rows.set(key,row);
  }
  const result={};
  for (const role of ['seed','collateral']) {
    const key=referenceKey(roles[role].reference);
    const row=rows.get(key);
    result[role]=Object.freeze({
      stillUnspent:Boolean(row),
      addressAndLovelaceUnchanged:Boolean(row &&
        row.address===roles[role].address &&
        row.value?.ada?.lovelace===String(roles[role].lovelace)),
      remainsPlainAdaOnly:Boolean(row &&
        Object.keys(row.value ?? {}).length===1 &&
        row.value?.ada?.lovelace!=null &&
        row.datumHash==null && row.datum==null && row.script==null)
    });
  }
  const boundTip=capturedBinding.stableTip;
  if (!boundTip || !stable({hash:capturedSnapshot.tip?.blockHash,slot:capturedSnapshot.tip?.slot},boundTip)) {
    throw new Error('Captured UTxO and protocol state were not bound to one tip.');
  }
  if (!currentTip || currentTip.slot<boundTip.slot) {
    throw new Error('Current Preprod tip is older than captured ledger evidence.');
  }
  const v=capturedCandidate?.validity;
  if (!Number.isSafeInteger(v?.upperSlot) || !Number.isSafeInteger(v?.lowerSlot) ||
      v.upperSlot<=v.lowerSlot) {
    throw new Error('Captured unsigned candidate has invalid validity bounds.');
  }
  const sameParams=protocolValues(capturedSnapshot)===protocolValues(currentSnapshot);
  const sourceUtxosUnchanged=Object.values(result).every(v=>
    v.stillUnspent && v.addressAndLovelaceUnchanged && v.remainsPlainAdaOnly);
  const candidateStillWithinValidity=currentTip.slot>=v.lowerSlot && currentTip.slot<=v.upperSlot;
  return Object.freeze({
    schema:SCHEMA,
    ok:true,
    network:NETWORK,
    capturedTip:boundTip,
    checkedTip:Object.freeze({hash:currentTip.hash,slot:currentTip.slot}),
    capturedUnsignedCandidateValidUntilSlot:v.upperSlot,
    seed:result.seed,
    collateral:result.collateral,
    originalUTxOsUnspentAndUnchanged:sourceUtxosUnchanged,
    independentlyCorroboratedProtocolValuesUnchanged:sameParams,
    candidateStillWithinValidity,
    liveOgmiosAndBlockfrostReadsPerformed:true,
    currentTwoSourceProtocolAgreement:true,
    currentStableTipAndUTxOStateChecked:true,
    originalUnsignedCandidateReadyForSigning:false,
    newSigningAuthorizationRequired:true,
    completePhaseOneValidated:false,
    walletSigningPerformed:false,
    walletSigningAuthorized:false,
    transactionSubmissionPerformed:false,
    transactionSubmissionAuthorized:false,
    supportClaimAuthorized:false,
    nextGate:!sourceUtxosUnchanged?'STOP: original UTxOs changed or spent; create a new unsigned evaluation capture after reviewing wallet state.':
      !candidateStillWithinValidity?'STOP: candidate validity expired; only a new unsigned evaluation capture can establish a valid window.':
      !sameParams?'STOP: protocol parameters changed; regenerate unsigned evaluation evidence.':
      'Inputs are unchanged as of checked tip; complete independent ledger phase-one validation is still required. No signing or submission.',
    authorityBoundary:'Read-only snapshot comparison at a stable tip. This is NOT complete independent Conway phase-one validation, a future freshness promise, or approval to sign or submit.'
  });
}
async function recheck({capture,client,blockfrostProjectId,fetchImpl=globalThis.fetch,retries=MAX_STABLE_RETRIES}) {
  if (!Number.isSafeInteger(retries)||retries<1||retries>MAX_STABLE_RETRIES) throw new Error('Invalid stable-tip retry count.');
  // Must pass all offline checks first, including manifest transitively
  // digest-binding the COMPLETE saved protocol snapshot.
  await inspectCardanoPreprodUnsignedCapture(capture);
  const root=resolve(capture);
  const manifest=JSON.parse(await readFile(join(root,'capture-manifest.json'),'utf8'));
  const sourceBinding=JSON.parse(await readFile(join(root,manifest.files.utxoBindingEvidence),'utf8'));
  const candidate=JSON.parse(await readFile(join(root,manifest.files.finalUnsignedCandidate),'utf8'));
  const capturedSnapshot=JSON.parse(await readFile(join(root,manifest.files.protocolSnapshot),'utf8'));
  const roles=sourceBinding.roles;
  const params=createCardanoOgmiosUtxoByOutputReferencesParams([
    roles.seed.reference,roles.collateral.reference
  ]);
  for (let attempt=1;attempt<=retries;attempt++) {
    const before=parseCardanoOgmiosTipResponse(await client.rpc('queryNetwork/tip'));
    const currentUtxos=parseCardanoOgmiosUtxoResponse(
      await client.rpc('queryLedgerState/utxo',params)
    );
    const epoch=parseCardanoOgmiosEpochResponse(await client.rpc('queryLedgerState/epoch'));
    const blockHeight=parseCardanoOgmiosBlockHeightResponse(await client.rpc('queryNetwork/blockHeight'));
    const ogmiosParameters=parseCardanoOgmiosProtocolParametersResponse(
      await client.rpc('queryLedgerState/protocolParameters')
    );
    const blockfrostParameters=await fetchCardanoBlockfrostPreprodProtocolParameters({
      projectId:blockfrostProjectId,fetchImpl
    });
    const after=parseCardanoOgmiosTipResponse(await client.rpc('queryNetwork/tip'));
    if (!stable(before,after)) continue;
    const currentSnapshot=createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters,blockfrostParameters,epoch,tip:before,blockHeight
    });
    return Object.freeze({
      ...compareCardanoPreprodCapturedLedger({
        capturedBinding:sourceBinding,
        capturedCandidate:candidate,
        capturedSnapshot,
        currentTip:before,
        currentUtxos,
        currentSnapshot
      }),
      stableTipAttempt:attempt
    });
  }
  throw new Error('Ogmios tip changed during each ledger recheck; no stable ledger evidence obtained.');
}
export { recheck as recheckCardanoPreprodCapturedLedger };

const cli=process.argv[1] ? resolve(process.argv[1])===fileURLToPath(import.meta.url) : false;
if (cli) {
  if (process.argv.includes('--help')||process.argv.includes('-h')) {
    process.stdout.write('Usage: node scripts/recheck-cardano-preprod-unsigned-ledger.js --capture <existing-unsigned-capture>\nRead-only authenticated Ogmios and Blockfrost lookups. NO signing, writing, or submission.\n');
  } else {
    const flag=process.argv.indexOf('--capture');
    const capture=flag<0?null:process.argv[flag+1];
    if (!capture || capture.startsWith('--') ||
        !process.env.OMEGAVAULT_OGMIOS_URL ||
        !process.env.BLOCKFROST_PROJECT_ID) {
      process.stderr.write('Read-only ledger recheck requires --capture plus configured Ogmios and Blockfrost provider environment.\n');
      process.exitCode=2;
    } else {
      let client=null;
      try {
        client=createCardanoOgmiosHttpClient({
          url:normalizeCardanoOgmiosWebSocketUrl(process.env.OMEGAVAULT_OGMIOS_URL),
          apiKey:process.env.OMEGAVAULT_OGMIOS_API_KEY??null,
          apiKeyHeader:process.env.OMEGAVAULT_OGMIOS_API_KEY_HEADER??'dmtr-api-key'
        });
        const report=await recheck({capture,client,blockfrostProjectId:process.env.BLOCKFROST_PROJECT_ID});
        process.stdout.write(JSON.stringify(report,null,2)+'\n');
        if (!report.originalUTxOsUnspentAndUnchanged ||
            !report.independentlyCorroboratedProtocolValuesUnchanged ||
            !report.candidateStillWithinValidity) process.exitCode=2;
      } catch(error) {
        // Never reproduce provider URL/header/API key or untrusted errors.
        const http=String(error?.message??'').match(/\bHTTP\s+([1-5]\d\d)\b/);
        process.stderr.write('Read-only ledger recheck blocked: '+(http?'provider HTTP '+http[1]:'input, provider response or stable-tip verification failed')+'. No signing or submission.\n');
        process.exitCode=2;
      } finally {
        try {if(typeof client?.closeAndWait==='function') await client.closeAndWait();else client?.close?.();}catch{}
      }
    }
  }
}
