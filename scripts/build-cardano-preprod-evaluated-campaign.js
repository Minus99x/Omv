import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';
import {
  createCardanoPreprodEvaluatedUnsignedConstruction
} from '../src/chains/cardano/preprod-evaluated-construction.js';
import {
  verifyCardanoPreprodSynchronizedEvaluationEvidence
} from '../src/chains/cardano/preprod-evidence-harness.js';
import { verifyCardanoPreprodCampaignManifest } from '../src/chains/cardano/preprod-campaign.js';

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

const campaignArg = arg('--campaign');
const projectRoot = resolve(arg('--project-root', '.'));

if (!campaignArg) {
  process.stderr.write('Cardano evaluated construction requires --campaign pointing to a completed synchronized Preprod evaluation campaign.\n');
  process.exitCode = 2;
} else {
  try {
    const campaign = resolve(campaignArg);
    const campaignManifestPath = join(campaign, 'campaign-manifest.json');
    const outputManifestPath = join(campaign, 'evaluated-construction-manifest.json');

    if (!await exists(campaignManifestPath)) throw new Error('Campaign manifest is missing.');
    if (await exists(outputManifestPath)) throw new Error('Evaluated construction manifest already exists; derived evidence is append-only and will not be overwritten.');

    const campaignManifest = await readJson(campaignManifestPath);
    const sessionManifests = {};
    for (const entry of campaignManifest.sessions ?? []) {
      sessionManifests[entry.action] = await readJson(join(campaign, entry.directory, 'capture-manifest.json'));
    }
    const campaignCheck = verifyCardanoPreprodCampaignManifest(campaignManifest, { sessionManifests });
    if (!campaignCheck.valid) throw new Error(`Campaign manifest verification failed: ${campaignCheck.errors.join('; ')}`);

    const beaconBlueprint = await readJson(join(projectRoot, 'validators/cardano/fixtures/state-beacon.applied.json'));
    const vaultBlueprint = await readJson(join(projectRoot, 'validators/cardano/fixtures/recovery-vault.applied.json'));
    const beaconCompiledCode = beaconBlueprint.validators.find(item => item.title === 'omegavault.state_beacon.mint')?.compiledCode;
    const recoveryCompiledCode = vaultBlueprint.validators.find(item => item.title === 'omegavault.recovery_vault.spend')?.compiledCode;
    if (!beaconCompiledCode || !recoveryCompiledCode) throw new Error('Applied Cardano validator compiled code is missing.');

    const prepared = [];
    for (const entry of campaignManifest.sessions) {
      const session = resolve(campaign, entry.directory);
      const manifest = sessionManifests[entry.action];
      const target = join(session, 'evaluated-unsigned-construction.json');
      if (await exists(target)) throw new Error(`${entry.action} evaluated construction already exists; refusing to overwrite derived evidence.`);

      const acquiredTip = await readJson(join(session, manifest.files.acquiredTip));
      const protocolParameterSnapshot = await readJson(join(session, manifest.files.protocolParameters));
      const ogmiosEvaluation = await readJson(join(session, manifest.files.ogmiosEvaluation));
      const evidence = await readJson(join(session, manifest.files.evidence));

      const evidenceCheck = verifyCardanoPreprodSynchronizedEvaluationEvidence({
        evidence,
        plan: manifest.capturePlan,
        acquiredTip,
        protocolParameterSnapshot,
        ogmiosEvaluation
      });
      if (!evidenceCheck.valid) {
        throw new Error(`${entry.action} synchronized evaluation evidence failed verification: ${evidenceCheck.errors.join('; ')}`);
      }

      const parameters = normalizeCardanoProtocolParameterSnapshot(protocolParameterSnapshot);
      const construction = createCardanoPreprodEvaluatedUnsignedConstruction({
        capturePlan: manifest.capturePlan,
        evaluationEvidence: evidence,
        parameters,
        recoveryCompiledCode,
        beaconCompiledCode
      });

      prepared.push(Object.freeze({ entry, session, target, evidence, construction }));
    }

    const campaignCore = Object.freeze({
      schema: 'omegavault.cardano.preprod-evaluated-construction-campaign.v1',
      chainId: 'cardano',
      network: 'preprod',
      sourceCampaignSha256: campaignManifest.campaignSha256,
      invariantProgramSha256: campaignManifest.invariantProgramSha256,
      sessions: Object.freeze(prepared.map(item => Object.freeze({
        action: item.entry.action,
        directory: item.entry.directory,
        sourceEvaluationEvidenceSha256: item.evidence.evidenceSha256,
        constructionSha256: item.construction.constructionSha256,
        candidateTransactionBodyHash: item.construction.candidate.transactionBodyHash,
        candidateTransactionCborSha256: item.construction.candidate.transactionCborSha256,
        minimumFee: item.construction.candidate.minimumFee
      }))),
      synchronizedEvaluationCampaignComplete: true,
      evaluatedUnsignedConstructionCampaignComplete: true,
      syntheticSupplementalUtxoContext: true,
      ledgerUtxoExistenceValidated: false,
      fullPhaseOneValidated: false,
      walletWitnessesValidated: false,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false,
      inclusionOrFinalityProven: false,
      publicNetworkRecoveryProven: false,
      supportClaimAuthorized: false,
      nextGate: 'real-preprod-utxo-binding-and-full-phase-one-validation',
      authorityBoundary: 'Derived construction evidence only. No wallet signing, transaction submission, live-value movement, finality, recovery or connector promotion is authorized.'
    });
    const campaignConstructionManifest = Object.freeze({
      ...campaignCore,
      campaignConstructionSha256: hashCardanoEvidence(campaignCore)
    });

    // All inputs and all four constructions are verified before the first write.
    for (const item of prepared) {
      await writeFile(item.target, `${JSON.stringify(item.construction, null, 2)}\n`);
    }
    await writeFile(outputManifestPath, `${JSON.stringify(campaignConstructionManifest, null, 2)}\n`);

    process.stdout.write(`${JSON.stringify({
      schema: 'omegavault.cardano.preprod-evaluated-construction-cli.v1',
      ok: true,
      campaign,
      campaignConstructionManifest: outputManifestPath,
      campaignConstructionSha256: campaignConstructionManifest.campaignConstructionSha256,
      actions: prepared.map(item => ({
        action: item.entry.action,
        constructionSha256: item.construction.constructionSha256,
        candidateTransactionBodyHash: item.construction.candidate.transactionBodyHash,
        minimumFee: item.construction.candidate.minimumFee
      })),
      fullPhaseOneValidated: false,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      supportClaimAuthorized: false,
      hardStop: 'STOP. Real Preprod UTxO binding and full phase-1 validation remain mandatory before wallet signing or submission.'
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Cardano evaluated construction blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
