import { getNetwork } from '../network-registry.js';
import { createPreflightResult } from '../preflight.js';

// The current XDC RPC bridge verifies claim consistency, not authenticated
// chain finality. Until a separately implemented verifier exists, neither
// caller-supplied flags nor test fixtures may satisfy this promotion gate.
export const XDC_AUTHENTICATED_FINALITY_GATE = 'authenticated-chain-finality';

export function createEvmCompatibilityProbe(networkId) {
  const network = getNetwork(networkId);
  if (!network || network.rpcProtocol !== 'evm-json-rpc') throw new TypeError('An EVM JSON-RPC network profile is required.');
  return Object.freeze({
    networkId,
    expectedChainIdHex: network.chainIdHex,
    calls: Object.freeze([
      Object.freeze({ method: 'eth_chainId', purpose: 'network identity' }),
      Object.freeze({ method: 'eth_getBlockByNumber', params: ['latest', false], purpose: 'block/fee field inspection' }),
      Object.freeze({ method: 'eth_feeHistory', optional: true, purpose: 'EIP-1559 capability' }),
      Object.freeze({ method: 'eth_getCode', params: ['<deployed-contract>', 'latest'], purpose: 'runtime bytecode verification' }),
      Object.freeze({ method: 'eth_getTransactionReceipt', params: ['<tx-hash>'], purpose: 'receipt/finality evidence' })
    ]),
    requiredChecks: Object.freeze(['chain-id-match', 'rpc-read', 'wallet-network-switch', 'deployment-receipt', 'runtime-code-match', 'policy-config-match', 'native-recovery', 'erc20-recovery', 'finality-evidence', ...(network.chainId === 'xdc' ? [XDC_AUTHENTICATED_FINALITY_GATE] : [])])
  });
}

export function evmProbePreflight({ networkId, observedChainIdHex, checks = {}, warnings = [], errors = [] }) {
  const network = getNetwork(networkId);
  if (!network || network.rpcProtocol !== 'evm-json-rpc') throw new TypeError('An EVM JSON-RPC network profile is required.');
  const chainMatches = observedChainIdHex?.toLowerCase() === network.chainIdHex?.toLowerCase();
  const mergedErrors = [...errors];
  if (!chainMatches) mergedErrors.push(`Observed chain ${observedChainIdHex ?? 'unknown'} does not match expected ${network.chainIdHex}.`);
  const allChecks = { 'chain-id-match': chainMatches, ...checks };
  if (network.chainId === 'xdc') allChecks[XDC_AUTHENTICATED_FINALITY_GATE] = false;
  const required = createEvmCompatibilityProbe(networkId).requiredChecks;
  const ready = mergedErrors.length === 0 && required.every(key => allChecks[key] === true);
  return createPreflightResult({
    chainId: network.chainId, networkRef: network.id, operation: 'evm.compatibility-proof', status: ready ? 'ready' : (mergedErrors.length ? 'blocked' : 'warning'),
    observedNetwork: { chainIdHex: observedChainIdHex }, checks: allChecks, warnings, errors: mergedErrors,
    transactionIntent: { purpose: 'OmegaVault EVM compatibility proof', networkId: network.id, expectedChainIdHex: network.chainIdHex }
  });
}
