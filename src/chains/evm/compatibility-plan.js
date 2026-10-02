import { getNetwork } from '../network-registry.js';
import { createPreflightResult } from '../preflight.js';

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
      Object.freeze({ method: 'eth_getTransactionReceipt', params: ['<tx-hash>'], purpose: 'successful execution receipt' }),
      Object.freeze({ method: 'eth_getBlockByHash', params: ['<receipt-block-hash>', false], purpose: 'receipt block identity' }),
      Object.freeze({ method: 'eth_getBlockByNumber', params: ['<receipt-block-number>', false], purpose: 'receipt block canonicality' }),
      Object.freeze({ method: 'eth_getBlockByNumber', params: ['finalized', false], purpose: 'network-native finalized head' })
    ]),
    requiredChecks: Object.freeze(['chain-id-match', 'rpc-read', 'wallet-network-switch', 'deployment-receipt', 'runtime-code-match', 'policy-config-match', 'native-recovery', 'erc20-recovery', 'proof-context-bound', 'finality-evidence'])
  });
}

export function evmProbePreflight({ networkId, observedChainIdHex, checks = {}, warnings = [], errors = [] }) {
  const network = getNetwork(networkId);
  if (!network || network.rpcProtocol !== 'evm-json-rpc') throw new TypeError('An EVM JSON-RPC network profile is required.');
  const chainMatches = observedChainIdHex?.toLowerCase() === network.chainIdHex?.toLowerCase();
  const mergedErrors = [...errors];
  if (!chainMatches) mergedErrors.push(`Observed chain ${observedChainIdHex ?? 'unknown'} does not match expected ${network.chainIdHex}.`);
  const allChecks = { 'chain-id-match': chainMatches, ...checks };
  const required = createEvmCompatibilityProbe(networkId).requiredChecks;
  const ready = mergedErrors.length === 0 && required.every(key => allChecks[key] === true);
  return createPreflightResult({
    chainId: network.chainId, networkRef: network.id, operation: 'evm.compatibility-proof', status: ready ? 'ready' : (mergedErrors.length ? 'blocked' : 'warning'),
    observedNetwork: { chainIdHex: observedChainIdHex }, checks: allChecks, warnings, errors: mergedErrors,
    transactionIntent: { purpose: 'OmegaVault EVM compatibility proof', networkId: network.id, expectedChainIdHex: network.chainIdHex }
  });
}
