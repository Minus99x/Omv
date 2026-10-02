import { getNetwork } from '../network-registry.js';
import { createEvmCompatibilityProbe } from './compatibility-plan.js';
import { evmProofMatchesBinding } from './proof-binding.js';
import { evmFinalityMatchesProof } from './finality-evidence.js';
import { DEFAULT_FINALITY_POLICIES } from '../finality.js';

const FINALITY_POLICY_BY_NETWORK = Object.freeze({
  'ethereum:sepolia': DEFAULT_FINALITY_POLICIES.ethereumSepolia,
  'xdc:apothem': DEFAULT_FINALITY_POLICIES.xdcApothem
});

export function createEvmCompatibilityReport({ networkId, observations = {}, deploymentVerification = null, nativeProof = null, erc20Proof = null, finality = null, feeEvidence = null }) {
  const network = getNetwork(networkId);
  if (!network || network.rpcProtocol !== 'evm-json-rpc') throw new TypeError('EVM compatibility report requires an EVM network profile.');
  const probe = createEvmCompatibilityProbe(networkId);
  const nativeBound = evmProofMatchesBinding(nativeProof, nativeProof?.binding, {
    networkId,
    deploymentVerification,
    kind: 'native-recovery'
  });
  const erc20Bound = evmProofMatchesBinding(erc20Proof, erc20Proof?.binding, {
    networkId,
    deploymentVerification,
    kind: 'erc20-recovery'
  });
  const sameContext = nativeBound && erc20Bound && nativeProof.binding.contextSha256 === erc20Proof.binding.contextSha256;
  const finalityPolicy = FINALITY_POLICY_BY_NETWORK[network.id] ?? null;
  const nativeFinalityBound = evmFinalityMatchesProof(finality?.native, nativeProof, { networkId, policy: finalityPolicy });
  const erc20FinalityBound = evmFinalityMatchesProof(finality?.erc20, erc20Proof, { networkId, policy: finalityPolicy });

  const checks = {
    'chain-id-match': String(observations.chainIdHex ?? '').toLowerCase() === String(network.chainIdHex).toLowerCase(),
    'rpc-read': observations.rpcRead === true,
    'wallet-network-switch': observations.walletNetworkSwitch === true,
    'deployment-receipt': Boolean(deploymentVerification?.observed?.deploymentTxRef || observations.deploymentReceipt === true),
    'runtime-code-match': deploymentVerification?.checks?.runtimeCodeMatched === true,
    'policy-config-match': Boolean(deploymentVerification?.verified),
    'native-recovery': nativeProof?.success === true,
    'erc20-recovery': erc20Proof?.success === true,
    'proof-context-bound': sameContext,
    'finality-evidence': nativeFinalityBound && erc20FinalityBound
  };
  const missing = probe.requiredChecks.filter(check => checks[check] !== true);
  return Object.freeze({
    version: 3,
    chainId: network.chainId,
    networkRef: network.id,
    expectedChainIdHex: network.chainIdHex,
    deploymentVerificationSha256: deploymentVerification?.sha256 ?? null,
    proofContextSha256: sameContext ? nativeProof.binding.contextSha256 : null,
    finalityEvidenceSha256: nativeFinalityBound && erc20FinalityBound
      ? Object.freeze({ native: finality.native.sha256, erc20: finality.erc20.sha256 })
      : null,
    checks: Object.freeze(checks),
    missing: Object.freeze(missing),
    feeEvidence: feeEvidence ? structuredClone(feeEvidence) : null,
    readyForLiveProofPromotion: missing.length === 0
  });
}
