import { createCapabilityMaturityContract } from './capability-contract.js';
import { getMaturityProfile } from './maturity-profiles.js';
import { listNetworks } from './network-registry.js';

const EVM_BASIC = Object.freeze(['account-connect', 'balance-read', 'message-sign', 'explorer-link']);
const ETHEREUM_FULL = Object.freeze([
  'account-connect', 'balance-read', 'message-sign', 'recovery-policy-test',
  'mechanism-create', 'mechanism-verify', 'heartbeat', 'recovery-approve',
  'recovery-execute', 'explorer-link'
]);

export const CHAIN_CAPABILITY_METADATA = Object.freeze({
  ethereum: Object.freeze({ id: 'ethereum', name: 'Ethereum', implementationStage: 'live-proof', capabilities: ETHEREUM_FULL }),
  xdc: Object.freeze({ id: 'xdc', name: 'XDC Network', implementationStage: 'scaffold', capabilities: Object.freeze([]) }),
  base: Object.freeze({ id: 'base', name: 'Base', implementationStage: 'scaffold', capabilities: EVM_BASIC }),
  arbitrum: Object.freeze({ id: 'arbitrum', name: 'Arbitrum', implementationStage: 'scaffold', capabilities: EVM_BASIC }),
  optimism: Object.freeze({ id: 'optimism', name: 'OP Mainnet / OP Stack', implementationStage: 'scaffold', capabilities: EVM_BASIC }),
  polygon: Object.freeze({ id: 'polygon', name: 'Polygon PoS', implementationStage: 'scaffold', capabilities: EVM_BASIC }),
  bsc: Object.freeze({ id: 'bsc', name: 'BNB Smart Chain', implementationStage: 'scaffold', capabilities: EVM_BASIC }),
  avalanche: Object.freeze({ id: 'avalanche', name: 'Avalanche C-Chain', implementationStage: 'scaffold', capabilities: EVM_BASIC }),
  xrpl: Object.freeze({ id: 'xrpl', name: 'XRP Ledger', implementationStage: 'scaffold', capabilities: Object.freeze([]) }),
  solana: Object.freeze({ id: 'solana', name: 'Solana', implementationStage: 'scaffold', capabilities: Object.freeze([]) }),
  stellar: Object.freeze({ id: 'stellar', name: 'Stellar', implementationStage: 'scaffold', capabilities: Object.freeze([]) }),
  tron: Object.freeze({ id: 'tron', name: 'TRON', implementationStage: 'scaffold', capabilities: Object.freeze([]) }),
  bitcoin: Object.freeze({ id: 'bitcoin', name: 'Bitcoin', implementationStage: 'scaffold', capabilities: Object.freeze([]) }),
  cardano: Object.freeze({ id: 'cardano', name: 'Cardano', implementationStage: 'scaffold', capabilities: Object.freeze([]) })
});

export function getChainCapabilityContract(chainId) {
  const adapter = CHAIN_CAPABILITY_METADATA[chainId];
  if (!adapter) return null;
  return createCapabilityMaturityContract({
    adapter,
    networks: listNetworks({ chainId }),
    ...getMaturityProfile(chainId)
  });
}

export function listChainCapabilityContracts() {
  return Object.keys(CHAIN_CAPABILITY_METADATA).sort().map(chainId => getChainCapabilityContract(chainId));
}

export function createCapabilityCatalogResponse() {
  return Object.freeze({
    schema: 'omegavault.chain-capability-catalog.v1',
    contracts: Object.freeze(listChainCapabilityContracts())
  });
}
