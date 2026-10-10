// Read-only workstation preflight for the next OmegaVault Cardano Preprod
// console session. No provider calls, no signature, no transaction submission.
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { CARDANO_PREPROD_SLOT_ANCHOR, CARDANO_PREPROD_TIME_ANCHOR_MS } from '../src/chains/cardano/transaction-body.js';

const BRANCH = 'dev/0.6.60-reconcile-overnight-bitcoin';
const HEX64 = /^[0-9a-f]{64}$/i;
const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);

function option(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  if (!args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(flag + ' requires a directory path.');
  }
  return resolve(args[index + 1]);
}
function execRead(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd:packageRoot, encoding:'utf8', windowsHide:true,
    timeout:5000
  });
  return result.status === 0 ? String(result.stdout).trim() : null;
}
async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}
async function getJson(path) {
  return JSON.parse(await readFile(path,'utf8'));
}
function expectedDigest(object, field) {
  if (!object || !HEX64.test(String(object[field] || ''))) return false;
  const stripped = Object.fromEntries(Object.entries(object).filter(([key]) => key !== field));
  return hashCardanoEvidence(stripped) === object[field].toLowerCase();
}

async function captureInfo(path) {
  const report = {
    directory:path, captureDirectory:null, captureManifestPresent:false, captureManifestDigestValid:false,
    ownerWitnessPresent:false, ownerWitnessDigestValid:false,
    ownerWitnessSignaturePreviouslyRecorded:false,
    validityUpperSlot:null, estimatedValidityExpired:null,
    signedTransactionExists:false, preSubmitFreshnessExisting:false,
    freshPhaseOneValidated:false, submissionAuthorized:false,
    issues:[]
  };
  // Guided capture writes the manifest to <session>/capture/ while the
  // Lace owner witness is written to <session>/wallet-signing/. Direct
  // capture output directories have a manifest at their own root.
  const directManifest = join(path, 'capture-manifest.json');
  const nestedManifest = join(path, 'capture', 'capture-manifest.json');
  const manifestPath = await exists(directManifest) ? directManifest :
    await exists(nestedManifest) ? nestedManifest : null;
  if (!manifestPath) {
    report.issues.push('Capture manifest absent at session root AND capture/capture-manifest.json; session may be incomplete.');
    return report;
  }
  const captureDir = dirname(manifestPath);
  report.captureDirectory = captureDir;
  try {
    const manifest = await getJson(manifestPath);
    report.captureManifestPresent = true;
    report.captureManifestDigestValid = expectedDigest(manifest, 'manifestSha256');
    if (!report.captureManifestDigestValid) {
      report.issues.push('Capture manifest SHA-256 does not reproduce; treat artifact as untrusted.');
      return report;
    }
    // Manifests are local evidence, not authority to read arbitrary files.
    // Even a self-consistent manifest digest cannot authorize path traversal.
    const relativeCandidate=manifest.files?.finalUnsignedCandidate;
    const candidatePath=relativeCandidate ? resolve(captureDir,relativeCandidate) : null;
    if (candidatePath) {
      const escape=relative(captureDir,candidatePath);
      if (isAbsolute(escape) || escape === '..' || escape.startsWith('..\\') || escape.startsWith('../')) {
        throw new Error('Capture manifest candidate path escapes the capture directory.');
      }
    }
    if (candidatePath && await exists(candidatePath)) {
      const candidate = await getJson(candidatePath);
      const upperSlot = candidate.validity?.upperSlot;
      if (Number.isSafeInteger(upperSlot) && upperSlot > 0) {
        report.validityUpperSlot=upperSlot;
        const estimatedSlot = CARDANO_PREPROD_SLOT_ANCHOR +
          Math.floor((Date.now() - CARDANO_PREPROD_TIME_ANCHOR_MS) / 1000);
        // This is a conservative DISPLAY-ONLY indication. A live Ogmios
        // tip and completely new stable-tip evidence are always required.
        report.estimatedValidityExpired = estimatedSlot > upperSlot;
        if (report.estimatedValidityExpired) report.issues.push('Old initialize validity window expired; fresh capture and separate authorization required.');
      }
    }
    const witnessCandidates = [
      join(path, 'wallet-signing', 'wallet-witness-evidence.json'),
      join(dirname(captureDir), 'wallet-signing', 'wallet-witness-evidence.json'),
      join(captureDir, 'wallet-signing', 'wallet-witness-evidence.json')
    ];
    let witnessPath = null;
    for (const candidate of witnessCandidates) {
      if (await exists(candidate)) { witnessPath = candidate; break; }
    }
    if (witnessPath) {
      report.ownerWitnessPresent=true;
      const witness=await getJson(witnessPath);
      report.ownerWitnessDigestValid=expectedDigest(witness,'witnessEvidenceSha256');
      report.ownerWitnessSignaturePreviouslyRecorded=report.ownerWitnessDigestValid &&
        witness.checks?.ownerSignatureCryptographicallyValid === true &&
        witness.checks?.walletWitnessesValidated === true;
      report.signedTransactionExists=report.ownerWitnessDigestValid &&
        typeof witness.signedTransactionCborHex === 'string' &&
        /^(?:[0-9a-f]{2})+$/i.test(witness.signedTransactionCborHex);
      if (!report.ownerWitnessDigestValid) report.issues.push('Owner witness evidence SHA-256 does not reproduce; do not reuse.');
      // A digest and prior check flag do NOT independently recheck the
      // wallet signature; the Rust validator must reproduce it separately.
    } else {
      report.issues.push('No owner witness JSON at wallet-signing/wallet-witness-evidence.json.');
    }
    const scanned = [...new Set([path, captureDir, dirname(captureDir)])];
    for (const directory of scanned) {
      const entries = await readdir(directory, { withFileTypes: true });
      if (entries.some(entry => entry.isFile() && /pre.?submit.*\.json$/i.test(entry.name))) {
        report.preSubmitFreshnessExisting = true;
        break;
      }
    }
  } catch (error) {
    report.issues.push('Could not inspect captured artifact: ' + error.message);
  }
  return report;
}

async function findCaptures(root) {
  if (!await exists(root)) return [];
  const list=await readdir(root,{withFileTypes:true});
  const matching=list.filter(entry=>entry.isDirectory() &&
    /^omegavault-cardano-preprod-real-initialize-/i.test(entry.name)).slice(0,60);
  const dated=await Promise.all(matching.map(async entry=>{
    const path=join(root,entry.name);
    const info=await stat(path);
    return {path,modifiedMs:info.mtimeMs};
  }));
  dated.sort((a,b)=>b.modifiedMs-a.modifiedMs);
  return dated.slice(0,5).map(row=>row.path);
}

function envConfigured(name) {
  return typeof process.env[name]==='string' && process.env[name].trim().length>0;
}

if (args.includes('--help')||args.includes('-h')) {
  process.stdout.write([
    'OmegaVault Cardano Preprod console readiness (READ ONLY)',
    'Usage: node scripts/cardano-preprod-console-readiness.js [--evidence-root "<parent-dir>"] [--capture "<capture-dir>"]',
    'Checks the development branch, local tools, credential PRESENCE only, and existing capture artifacts.',
    'No network calls, transaction construction, signing, or submission.',
    'A prior witness cannot be reused to authorize signing or submission.'
  ].join('\n')+'\n');
} else {
  try {
    const root=option('--evidence-root') ?? dirname(packageRoot);
    const capture=option('--capture');
    const branch=execRead('git',['branch','--show-current']);
    const head=execRead('git',['rev-parse','HEAD']);
    const dirtyTracked=execRead('git',['status','--porcelain','--untracked-files=no']);
    const captures=capture?[capture]:await findCaptures(root);
    const observations=await Promise.all(captures.map(captureInfo));
    const readiness={
      schema:'omegavault.cardano.preprod-console-readiness.v1',
      network:'preprod',
      source:{
        projectRoot:packageRoot,
        expectedBranch:BRANCH,
        actualBranch:branch,
        branchMatches:branch===BRANCH,
        commit:head,
        trackedFilesClean:dirtyTracked=== '',
        pinnedDependenciesInstalled:await exists(join(packageRoot,'node_modules'))
      },
      tools:{
        node:process.version,
        gitAvailable:Boolean(execRead('git',['--version'])),
        // Node 24 on Windows may refuse child_process.spawnSync('npm.cmd')
        // even though npm.cmd works normally in PowerShell. npm_execpath
        // proves this command was invoked successfully by npm.
        npmAvailable:Boolean(process.env.npm_execpath) ||
          Boolean(execRead(process.platform==='win32'?'npm.cmd':'npm',['--version']))
      },
      providerEnvironment:{
        ogmiosUrlConfigured:envConfigured('OMEGAVAULT_OGMIOS_URL'),
        ogmiosApiKeyConfigured:envConfigured('OMEGAVAULT_OGMIOS_API_KEY'),
        blockfrostProjectIdConfigured:envConfigured('BLOCKFROST_PROJECT_ID'),
        valuesAndSecretsPrinted:false,
        networkConnectivityTested:false
      },
      evidenceRoot:root,
      captures:observations,
      captureCount:observations.length,
      recommendation: branch!==BRANCH ?
        'Wrong branch. Do not capture or sign. Switch to the authorized OmegaVault development branch first.' :
        dirtyTracked!=='' ?
        'Tracked modifications exist. Review them before any fast-forward update or capture.' :
        !await exists(join(packageRoot,'node_modules')) ?
        'Install pinned dependencies with npm.cmd ci (Windows) before running the network diagnostic.' :
        !envConfigured('OMEGAVAULT_OGMIOS_URL') || !envConfigured('BLOCKFROST_PROJECT_ID') ?
        'Provider environment is incomplete in this PowerShell session; diagnose local configuration without printing credentials.' :
        'Ready to run READ-ONLY Ogmios reconnect diagnostic; then create fresh initialize evaluation evidence if needed.',
      nextReadOnlyCommand:'npm.cmd run cardano:preprod:ogmios:diagnose',
      estimatedSlotSource:'Local wall-clock estimate only; never a substitute for a synchronized Preprod tip.',
      walletSigningAuthorized:false,
      transactionSubmissionAuthorized:false,
      transactionSubmissionPerformed:false,
      completeSignedCurrentLedgerPhaseOneValidated:false,
      supportClaimAuthorized:false,
      hardStop:'NO SIGNING OR SUBMISSION. Historic signing approvals do not carry forward to new transactions.'
    };
    process.stdout.write(JSON.stringify(readiness,null,2)+'\n');
    if (!readiness.source.branchMatches || !readiness.source.trackedFilesClean) process.exitCode=2;
  } catch(error) {
    process.stderr.write('Console readiness blocked: '+error.message+'\n');
    process.exitCode=2;
  }
}
