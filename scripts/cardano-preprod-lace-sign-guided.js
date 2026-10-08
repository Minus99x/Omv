import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { CARDANO_PREPROD_SLOT_ANCHOR, CARDANO_PREPROD_TIME_ANCHOR_MS } from '../src/chains/cardano/transaction-body.js';
import {
  mergeCardanoCip30OwnerWitness,
  verifyCardanoCip30OwnerContext
} from '../src/chains/cardano/preprod-cip30-witness-merge.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type':'application/json; charset=utf-8',
    'content-length':Buffer.byteLength(body),
    'cache-control':'no-store',
    'x-content-type-options':'nosniff'
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error('Request body exceeds 1 MiB.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function page() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OmegaVault Preprod Signing Gate</title>
<style>
body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.45}
code{word-break:break-all}button{padding:12px 18px;margin:6px 8px 6px 0;font-size:16px}
.ok{color:#176b2c}.bad{color:#9d1c1c}.box{border:1px solid #bbb;border-radius:10px;padding:16px;margin:16px 0}
</style>
</head>
<body>
<h1>OmegaVault Cardano Preprod signing gate</h1>
<p><strong>Signing only.</strong> This local page has no transaction-submission action.</p>
<div id="summary" class="box">Loading frozen candidate…</div>
<button id="connect">1. Connect Lace</button>
<button id="sign" disabled>2. Sign frozen transaction</button>
<div id="status" class="box">Waiting for Lace connection.</div>
<script>
const token=new URLSearchParams(location.search).get('token');
const status=document.getElementById('status');
const summary=document.getElementById('summary');
const signButton=document.getElementById('sign');
let api=null,state=null;
const post=async(path,body)=>{
  const r=await fetch(path+'?token='+encodeURIComponent(token),{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
  });
  const j=await r.json(); if(!r.ok) throw new Error(j.error||'Request failed'); return j;
};
(async()=>{
  const r=await fetch('/state?token='+encodeURIComponent(token));
  state=await r.json();
  summary.innerHTML=
    '<b>Network:</b> Cardano Preprod<br>'+
    '<b>Body hash:</b> <code>'+state.bodyHash+'</code><br>'+
    '<b>Fee:</b> '+state.feeLovelace+' lovelace<br>'+
    '<b>Protected state:</b> '+state.stateLovelace+' lovelace<br>'+
    '<b>Validity upper slot:</b> '+state.validityUpperSlot+'<br>'+\n    '<b>Submission authorized:</b> NO';
})();
document.getElementById('connect').onclick=async()=>{
  try{
    if(!window.cardano?.lace) throw new Error('Lace browser extension was not detected on this page.');
    api=await window.cardano.lace.enable();
    const networkId=await api.getNetworkId();
    const addressHexes=[];
    try{const x=await api.getChangeAddress(); if(x) addressHexes.push(x);}catch{}
    try{addressHexes.push(...await api.getUsedAddresses());}catch{}
    try{addressHexes.push(...await api.getUnusedAddresses());}catch{}
    await post('/wallet-check',{networkId,addressHexes:[...new Set(addressHexes)]});
    status.className='box ok';
    status.textContent='Correct Preprod Owner account verified. Review the Lace signing popup before approving.';
    signButton.disabled=false;
  }catch(e){
    status.className='box bad'; status.textContent=e.message; signButton.disabled=true;
  }
};
signButton.onclick=async()=>{
  signButton.disabled=true;
  try{
    status.className='box'; status.textContent='Waiting for your explicit approval in Lace…';
    const walletWitnessSetCborHex=await api.signTx(state.unsignedTransactionCborHex,true);
    const result=await post('/witness',{walletWitnessSetCborHex});
    status.className='box ok';
    status.innerHTML='Owner witness verified offline and saved.<br><b>No transaction was submitted.</b><br>Return to PowerShell.';
    document.getElementById('connect').disabled=true;
  }catch(e){
    status.className='box bad'; status.textContent=e.message; signButton.disabled=false;
  }
};
</script>
</body>
</html>`;
}

const captureArg = arg('--capture');
const outputArg = arg('--output');
const signingAuthorized = process.argv.includes('--authorize-signing');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write([
    'OmegaVault Cardano Preprod Lace signing gate',
    '',
    'Usage:',
    '  npm.cmd run cardano:preprod:initialize:lace-sign:guided -- --capture "<capture-dir>" --authorize-signing',
    '',
    'Optional:',
    '  --output <dir>   Append-only signing output directory (default: sibling wallet-signing directory)',
    '',
    'This command starts a loopback-only local page, connects to Lace through CIP-30,',
    'verifies the selected Preprod account controls the frozen owner payment key,',
    'requests signTx only after a human click, verifies the returned owner witness,',
    'and assembles a signed transaction file for offline verification.',
    '',
    'It has no transaction-submission path.',
    ''
  ].join('\n'));
  process.exit(0);
}

if (!captureArg) {
  process.stderr.write('Lace signing gate requires --capture.\n');
  process.exitCode = 2;
} else if (!signingAuthorized) {
  process.stderr.write('Lace signing gate blocked: explicit --authorize-signing is required. This authorizes signing only, never submission.\n');
  process.exitCode = 2;
} else {
  const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let server = null;
  try {
    const capture = resolve(captureArg);
    if (!await exists(capture)) throw new Error('Real initialize capture directory does not exist.');

    const manifest = await readJson(join(capture, 'capture-manifest.json'));
    if (manifest.schema !== 'omegavault.cardano.preprod-real-initialize-capture-manifest.v1' ||
        manifest.network !== 'preprod' ||
        manifest.synchronizedRealInitializeEvaluationComplete !== true ||
        manifest.fullPhaseOneValidated !== false ||
        manifest.transactionSubmissionAuthorized !== false ||
        manifest.supportClaimAuthorized !== false) {
      throw new Error('Capture is not in the expected fail-closed pre-signing state.');
    }
    const manifestCore = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'manifestSha256'));
    if (hashCardanoEvidence(manifestCore) !== manifest.manifestSha256) {
      throw new Error('Capture manifest self-digest mismatch.');
    }

    const unsignedCandidate = await readJson(join(capture, manifest.files.finalUnsignedCandidate));
    const unsignedPreflight = await readJson(join(capture, manifest.files.unsignedPhaseOnePreflight));
    if (unsignedCandidate?.liveActions?.transactionSubmissionAuthorized !== false ||
        unsignedPreflight?.checks?.unsignedPhaseOnePreflightComplete !== true ||
        unsignedPreflight?.checks?.walletWitnessesPresent !== false ||
        unsignedPreflight?.checks?.fullPhaseOneValidated !== false) {
      throw new Error('Frozen candidate/preflight is not at the unsigned wallet-signing gate.');
    }

    const currentApproximateSlot = CARDANO_PREPROD_SLOT_ANCHOR + Math.floor((Date.now() - CARDANO_PREPROD_TIME_ANCHOR_MS) / 1000);
    const upperSlot = Number(unsignedCandidate?.validity?.upperSlot);
    if (!Number.isSafeInteger(upperSlot) || currentApproximateSlot + 120 > upperSlot) {
      throw new Error('Frozen initialize validity window is expired or within two minutes of expiry. Rerun the read/evaluation capture before requesting a wallet signature.');
    }

    const outputDir = resolve(outputArg ?? join(dirname(capture), 'wallet-signing'));
    if (await exists(outputDir)) {
      throw new Error('Signing output directory already exists; refusing to overwrite append-only signing evidence.');
    }

    const token = randomBytes(32).toString('hex');
    const state = Object.freeze({
      network:'preprod',
      bodyHash:unsignedCandidate.transaction.bodyHash,
      feeLovelace:unsignedCandidate.transaction.feeLovelace,
      stateLovelace:unsignedCandidate.recoveryConfiguration.stateLovelace,
      expectedOwnerPaymentKeyHash:unsignedCandidate.ownerPaymentKeyHash,
      unsignedTransactionCborHex:unsignedCandidate.transaction.cborHex,
      validityUpperSlot:upperSlot,
      approximateSlotAtLaunch:currentApproximateSlot,
      submissionAuthorized:false
    });
    let walletContextVerified = false;
    let completed = false;

    server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.searchParams.get('token') !== token) {
          sendJson(res, 403, { error:'Invalid local signing-session token.' });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/') {
          const html = page();
          res.writeHead(200, {
            'content-type':'text/html; charset=utf-8',
            'content-length':Buffer.byteLength(html),
            'cache-control':'no-store',
            'x-content-type-options':'nosniff',
            'content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
          });
          res.end(html);
          return;
        }
        if (req.method === 'GET' && url.pathname === '/state') {
          sendJson(res, 200, state);
          return;
        }
        if (req.method === 'POST' && url.pathname === '/wallet-check') {
          const body = await readJsonBody(req);
          const verification = verifyCardanoCip30OwnerContext({
            networkId:body.networkId,
            addressHexes:body.addressHexes,
            expectedOwnerPaymentKeyHash:state.expectedOwnerPaymentKeyHash
          });
          walletContextVerified = verification.valid === true;
          sendJson(res, 200, { ok:true, walletContextVerified });
          return;
        }
        if (req.method === 'POST' && url.pathname === '/witness') {
          if (completed) throw new Error('Signing session is already complete.');
          if (!walletContextVerified) throw new Error('Owner wallet context must be verified before accepting a witness.');
          const body = await readJsonBody(req);
          const merged = mergeCardanoCip30OwnerWitness({
            unsignedTransactionCborHex:state.unsignedTransactionCborHex,
            walletWitnessSetCborHex:body.walletWitnessSetCborHex,
            expectedOwnerPaymentKeyHash:state.expectedOwnerPaymentKeyHash
          });

          await mkdir(outputDir, { recursive:false });
          const witnessPath = join(outputDir, 'lace-owner-witness-set.cbor');
          const signedTxPath = join(outputDir, 'initialize-signed-transaction.cbor');
          const handoffPath = join(outputDir, 'signing-handoff.json');
          const witnessEvidencePath = join(outputDir, 'wallet-witness-evidence.json');
          await writeFile(witnessPath, `${merged.walletWitnessSetCborHex}\n`, { flag:'wx' });
          await writeFile(signedTxPath, `${merged.signedTransactionCborHex}\n`, { flag:'wx' });
          await writeFile(handoffPath, `${JSON.stringify({
            schema:'omegavault.cardano.preprod-cip30-signing-handoff.v1',
            network:'preprod',
            capture,
            captureManifestSha256:manifest.manifestSha256,
            transactionBodyHash:merged.transactionBodyHash,
            ownerPaymentKeyHash:merged.ownerPaymentKeyHash,
            walletWitnessSetSha256:merged.walletWitnessSetSha256,
            signedTransactionSha256:merged.signedTransactionSha256,
            walletSigningPerformed:true,
            walletSigningAuthorized:true,
            transactionSubmissionPerformed:false,
            transactionSubmissionAuthorized:false,
            supportClaimAuthorized:false,
            nextGate:'offline-wallet-witness-evidence-verification'
          }, null, 2)}\n`, { flag:'wx' });

          const verify = spawnSync(process.execPath, [
            'scripts/verify-cardano-preprod-initialize-wallet-witness.js',
            '--capture', capture,
            '--signed-tx', signedTxPath,
            '--output', witnessEvidencePath
          ], {
            cwd:projectRoot,
            encoding:'utf8',
            stdio:['ignore','pipe','pipe'],
            windowsHide:true
          });
          if (verify.status !== 0) {
            throw new Error(`Offline wallet-witness verification failed: ${String(verify.stderr || verify.stdout).trim()}`);
          }

          completed = true;
          sendJson(res, 200, {
            ok:true,
            bodyHash:merged.transactionBodyHash,
            witnessEvidence:witnessEvidencePath,
            transactionSubmissionPerformed:false,
            transactionSubmissionAuthorized:false
          });
          setTimeout(() => server.close(), 500);
          return;
        }
        sendJson(res, 404, { error:'Not found.' });
      } catch (error) {
        sendJson(res, 400, { error:error.message });
      }
    });

    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    const localUrl = `http://127.0.0.1:${address.port}/?token=${token}`;
    process.stdout.write([
      'OmegaVault Cardano Preprod Lace signing gate is ready.',
      `Frozen body hash: ${state.bodyHash}`,
      'Signing authorization: YES (this session only)',
      'Submission authorization: NO',
      `Local signing page: ${localUrl}`,
      '',
      'The browser page verifies the selected Lace Preprod account before enabling Sign.',
      'Review the Lace popup and approve only if the transaction details match the frozen candidate.',
      ''
    ].join('\n'));

    if (process.platform === 'win32') {
      try {
        spawn('cmd.exe', ['/c', 'start', '', localUrl], {
          detached:true,
          stdio:'ignore',
          windowsHide:true
        }).unref();
      } catch {}
    }

    await new Promise(resolveClose => server.once('close', resolveClose));
    if (completed) {
      process.stdout.write(`\nSigning gate complete. Evidence: ${join(outputDir, 'wallet-witness-evidence.json')}\nHARD STOP: signed witness verified; transaction submission remains unauthorized.\n`);
    }
  } catch (error) {
    try { server?.close?.(); } catch {}
    process.stderr.write(`Cardano Lace signing gate blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
