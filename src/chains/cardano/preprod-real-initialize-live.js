import { hashCardanoEvidence } from './evidence-binding.js';
import { createCardanoPreprodLiveProtocolSnapshot } from './live-protocol-parameters.js';
import { normalizeCardanoOgmiosEvaluation } from './ogmios-evaluation.js';
import {
  createCardanoOgmiosUtxoByOutputReferencesParams,
  fetchCardanoBlockfrostPreprodAddressUtxos,
  fetchCardanoBlockfrostPreprodProtocolParameters,
  parseCardanoOgmiosBlockHeightResponse,
  parseCardanoOgmiosEpochResponse,
  parseCardanoOgmiosProtocolParametersResponse,
  parseCardanoOgmiosTipResponse,
  parseCardanoOgmiosUtxoResponse,
  selectCardanoPreprodInitializeUtxos
} from './preprod-live-capture.js';
import { normalizeCardanoProtocolParameterSnapshot } from './protocol-parameters.js';
import {
  createCardanoPreprodRealUtxoBindingEvidence,
  createCardanoPreprodRealUtxoBindingPlan
} from './preprod-real-utxo-binding.js';
import {
  buildCardanoPreprodRealInitializeCandidate,
  verifyCardanoPreprodRealInitializeCandidate
} from './preprod-real-initialize.js';

function sameTip(left, right) {
  return Boolean(left && right && left.hash === right.hash && left.slot === right.slot);
}

function assertProviderClient(client) {
  if (!client || typeof client.rpc !== 'function') throw new TypeError('An Ogmios RPC client is required.');
  return client;
}

function mintBudgetFromEvaluation(evaluation) {
  const mint = evaluation?.budgets?.find(item => item.validator === 'mint:0');
  if (!mint) throw new Error('Live Cardano initialize evaluation did not return mint:0.');
  return Object.freeze({
    memory: mint.budget.memory,
    steps: mint.budget.steps
  });
}

export async function captureCardanoPreprodRealInitializeEvaluation({
  walletAddress,
  blockfrostProjectId,
  client,
  fetchImpl = globalThis.fetch,
  deriveAppliedValidatorIdentity,
  recoveryConfig,
  assetNameHex = '4f56',
  stableTipRetries = 8,
  safetyMarginPercent = 10
}) {
  assertProviderClient(client);
  if (typeof deriveAppliedValidatorIdentity !== 'function') {
    throw new TypeError('deriveAppliedValidatorIdentity must be a function.');
  }
  if (!Number.isInteger(stableTipRetries) || stableTipRetries < 1 || stableTipRetries > 30) {
    throw new RangeError('stableTipRetries must be 1-30.');
  }

  const discovered = await fetchCardanoBlockfrostPreprodAddressUtxos({
    projectId: blockfrostProjectId,
    address: walletAddress,
    fetchImpl
  });
  const selected = selectCardanoPreprodInitializeUtxos(discovered);
  const appliedValidatorIdentity = await deriveAppliedValidatorIdentity({
    seedReference: selected.seed,
    assetNameHex
  });

  const bindingPlan = createCardanoPreprodRealUtxoBindingPlan({
    action: 'initialize',
    roles: {
      seed: selected.seed,
      collateral: selected.collateral
    },
    appliedValidatorIdentity
  });

  for (let attempt = 1; attempt <= stableTipRetries; attempt += 1) {
    const tipBefore = parseCardanoOgmiosTipResponse(await client.rpc('queryNetwork/tip'));
    const queriedUtxo = parseCardanoOgmiosUtxoResponse(
      await client.rpc(
        'queryLedgerState/utxo',
        createCardanoOgmiosUtxoByOutputReferencesParams([
          bindingPlan.roles.seed,
          bindingPlan.roles.collateral
        ])
      )
    );
    const epoch = parseCardanoOgmiosEpochResponse(await client.rpc('queryLedgerState/epoch'));
    const blockHeight = parseCardanoOgmiosBlockHeightResponse(await client.rpc('queryNetwork/blockHeight'));
    const ogmiosParameters = parseCardanoOgmiosProtocolParametersResponse(
      await client.rpc('queryLedgerState/protocolParameters')
    );
    const blockfrostParameters = await fetchCardanoBlockfrostPreprodProtocolParameters({
      projectId: blockfrostProjectId,
      fetchImpl
    });
    const protocolSnapshot = createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters,
      blockfrostParameters,
      epoch,
      tip: tipBefore,
      blockHeight
    });
    const parameters = normalizeCardanoProtocolParameterSnapshot(protocolSnapshot);

    const provisionalBinding = createCardanoPreprodRealUtxoBindingEvidence({
      plan: bindingPlan,
      tipBefore,
      tipAfter: tipBefore,
      queriedUtxo
    });
    const evaluationCandidate = buildCardanoPreprodRealInitializeCandidate({
      appliedValidatorIdentity,
      utxoBindingEvidence: provisionalBinding,
      parameters,
      recoveryConfig,
      evaluationMode: true
    });
    const evaluationResponse = await client.rpc(
      evaluationCandidate.evaluation.request.method,
      evaluationCandidate.evaluation.request.params,
      evaluationCandidate.evaluation.request.id
    );
    const tipAfter = parseCardanoOgmiosTipResponse(await client.rpc('queryNetwork/tip'));
    if (!sameTip(tipBefore, tipAfter)) continue;

    const utxoBindingEvidence = createCardanoPreprodRealUtxoBindingEvidence({
      plan: bindingPlan,
      tipBefore,
      tipAfter,
      queriedUtxo
    });
    if (utxoBindingEvidence.evidenceSha256 !== provisionalBinding.evidenceSha256) {
      throw new Error('Stable-tip real UTxO evidence changed while constructing the initialize candidate.');
    }

    const evaluation = normalizeCardanoOgmiosEvaluation({
      response: evaluationResponse,
      requestId: evaluationCandidate.evaluation.request.id,
      expectedValidators: evaluationCandidate.evaluation.expectedValidators,
      parameters,
      safetyMarginPercent
    });
    const mintBudget = mintBudgetFromEvaluation(evaluation);
    const finalUnsignedCandidate = buildCardanoPreprodRealInitializeCandidate({
      appliedValidatorIdentity,
      utxoBindingEvidence,
      parameters,
      recoveryConfig,
      evaluationMode: false,
      mintBudget
    });

    const evaluationCandidateCheck = verifyCardanoPreprodRealInitializeCandidate({
      candidate: evaluationCandidate,
      appliedValidatorIdentity,
      utxoBindingEvidence,
      parameters,
      recoveryConfig,
      evaluationMode: true
    });
    if (!evaluationCandidateCheck.valid) {
      throw new Error(`Real initialize evaluation candidate verification failed: ${evaluationCandidateCheck.errors.join('; ')}`);
    }
    const finalCandidateCheck = verifyCardanoPreprodRealInitializeCandidate({
      candidate: finalUnsignedCandidate,
      appliedValidatorIdentity,
      utxoBindingEvidence,
      parameters,
      recoveryConfig,
      evaluationMode: false,
      mintBudget
    });
    if (!finalCandidateCheck.valid) {
      throw new Error(`Real initialize post-evaluation candidate verification failed: ${finalCandidateCheck.errors.join('; ')}`);
    }

    const evaluationCore = Object.freeze({
      schema: 'omegavault.cardano.preprod-real-initialize-evaluation.v1',
      network: 'preprod',
      stableTip: Object.freeze({ hash: tipBefore.hash, slot: tipBefore.slot }),
      validatorIdentitySha256: appliedValidatorIdentity.identitySha256,
      utxoBindingPlanSha256: bindingPlan.planSha256,
      utxoBindingEvidenceSha256: utxoBindingEvidence.evidenceSha256,
      protocolSnapshot,
      evaluationCandidateSha256: evaluationCandidate.candidateSha256,
      evaluationResponse,
      normalizedEvaluation: evaluation,
      finalUnsignedCandidateSha256: finalUnsignedCandidate.candidateSha256,
      walletSigningPerformed: false,
      transactionSubmissionPerformed: false,
      fullPhaseOneValidated: false,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      publicNetworkRecoveryProven: false,
      supportClaimAuthorized: false,
      authorityBoundary: 'This capture binds real Preprod UTxOs, current independently confirmed protocol parameters and live Ogmios evaluation to one stable tip, then constructs a budget-applied unsigned initialize candidate. Wallet witnesses, complete phase-1 validation, submission, inclusion/finality, recovery and support promotion remain separately gated.'
    });
    const evaluationEvidence = Object.freeze({
      ...evaluationCore,
      evidenceSha256: hashCardanoEvidence(evaluationCore)
    });

    return Object.freeze({
      ok: true,
      attempt,
      selected,
      appliedValidatorIdentity,
      bindingPlan,
      utxoBindingEvidence,
      protocolSnapshot,
      evaluationCandidate,
      evaluationEvidence,
      finalUnsignedCandidate,
      fullPhaseOneValidated: false,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      supportClaimAuthorized: false
    });
  }

  throw new Error(`Could not bind real Preprod UTxOs, protocol parameters and initialize evaluation to one stable tip after ${stableTipRetries} attempts.`);
}
