import { getNetwork } from '../network-registry.js';
import { createEvmCompatibilityProbe } from './compatibility-plan.js';

export function createEvmCompatibilityReport({ networkId, observations = {}, deploymentVerification = null, nativeProof = null, erc20Proof = null, finality = null, feeEvidence = null }) {
  const network = getNetwork(networkId);
  if (!network || network.rpcProtocol !== 'evm-json-rpc') throw new TypeError('EVM compatibility report requires an EVM network profile.');
  const probe = createEvmCompatibilityProbe(networkId);
  const checks = {
    'chain-id-match': String(observations.chainIdHex ?? '').toLowerCase() === String(network.chainIdHex).toLowerCase(),
    'rpc-read': observations.rpcRead === true,
    'wallet-network-switch': observations.walletNetworkSwitch === true,
    'deployment-receipt': Boolean(deploymentVerification?.observed?.deploymentTxRef || observations.deploymentReceipt === true),
    'runtime-code-match': deploymentVerification?.checks?.runtimeCodeMatched === true,
    'policy-config-match': Boolean(deploymentVerification?.verified),
    'native-recovery': nativeProof?.success === true,
    'erc20-recovery': erc20Proof?.success === true,
    'finality-evidence': finality?.status === 'finalized'
  };
  const missing = probe.requiredChecks.filter(check => checks[check] !== true);
  return Object.freeze({
    version: 1,
    chainId: network.chainId,
    networkRef: network.id,
    expectedChainIdHex: network.chainIdHex,
    checks: Object.freeze(checks),
    missing: Object.freeze(missing),
    feeEvidence: feeEvidence ? structuredClone(feeEvidence) : null,
    readyForLiveProofPromotion: missing.length === 0
  });
}
