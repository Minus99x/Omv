const NETWORK_STAGES = new Set(['catalogued', 'scaffold', 'compatibility-ready', 'live-proof', 'blocked']);

const networks = new Map();

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function freezeNetwork(spec) {
  const required = ['id', 'chainId', 'name', 'environment', 'nativeSymbol', 'rpcProtocol', 'implementationStage'];
  for (const key of required) {
    if (typeof spec?.[key] !== 'string' || !spec[key].trim())
      throw new TypeError(`Network ${key} is required.`);
  }
  if (!NETWORK_STAGES.has(spec.implementationStage)) throw new TypeError(`Unknown network stage: ${spec.implementationStage}`);
  return Object.freeze({
    ...spec,
    rpcUrls: Object.freeze([...(spec.rpcUrls ?? [])]),
    explorerUrls: Object.freeze([...(spec.explorerUrls ?? [])]),
    notes: Object.freeze([...(spec.notes ?? [])])
  });
}

export function defineNetwork(spec) {
  return freezeNetwork(spec);
}

export function registerNetwork(spec) {
  const network = freezeNetwork(spec);
  if (networks.has(network.id)) throw new Error(`Network already registered: ${network.id}`);
  networks.set(network.id, network);
  return network;
}

export function getNetwork(id) {
  return networks.get(id) ?? null;
}

export function listNetworks({ chainId = null, environment = null } = {}) {
  return [...networks.values()].filter(network => {
    if (chainId && network.chainId !== chainId) return false;
    if (environment && network.environment !== environment) return false;
    return true;
  }).map(network => structuredClone(network));
}

const evmNetworks = [
  {
    id: 'ethereum:sepolia', chainId: 'ethereum', name: 'Ethereum Sepolia', environment: 'testnet', nativeSymbol: 'ETH',
    rpcProtocol: 'evm-json-rpc', implementationStage: 'live-proof', chainIdDecimal: 11155111, chainIdHex: '0xaa36a7',
    rpcUrls: [], explorerUrls: ['https://sepolia.etherscan.io'], notes: ['Existing OmegaVault 0.4.3 live proof baseline.']
  },
  {
    id: 'xdc:apothem', chainId: 'xdc', name: 'XDC Apothem', environment: 'testnet', nativeSymbol: 'TXDC',
    rpcProtocol: 'evm-json-rpc', implementationStage: 'compatibility-ready', chainIdDecimal: 51, chainIdHex: '0x33',
    rpcUrls: ['https://rpc.apothem.network'], explorerUrls: ['https://apothem.xdcscan.io'], notes: ['XDPoS finality and XDC/0x address normalization require independent tests.']
  },
  {
    id: 'base:sepolia', chainId: 'base', name: 'Base Sepolia', environment: 'testnet', nativeSymbol: 'ETH',
    rpcProtocol: 'evm-json-rpc', implementationStage: 'compatibility-ready', chainIdDecimal: 84532, chainIdHex: '0x14a34',
    rpcUrls: ['https://sepolia.base.org'], explorerUrls: ['https://sepolia.basescan.org'], notes: ['L2 finality/evidence must include L2 execution and parent-chain context where relevant.']
  },
  {
    id: 'arbitrum:sepolia', chainId: 'arbitrum', name: 'Arbitrum Sepolia', environment: 'testnet', nativeSymbol: 'ETH',
    rpcProtocol: 'evm-json-rpc', implementationStage: 'compatibility-ready', chainIdDecimal: 421614, chainIdHex: '0x66eee',
    rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'], explorerUrls: ['https://sepolia.arbiscan.io'], notes: ['Rollup finality differs from Ethereum L1 finality.']
  },
  {
    id: 'optimism:sepolia', chainId: 'optimism', name: 'OP Sepolia', environment: 'testnet', nativeSymbol: 'ETH',
    rpcProtocol: 'evm-json-rpc', implementationStage: 'compatibility-ready', chainIdDecimal: 11155420, chainIdHex: '0xaa37dc',
    rpcUrls: [], explorerUrls: ['https://sepolia-optimism.etherscan.io'], notes: ['Rollup finality and fault-proof state must be treated separately from L2 inclusion.']
  },
  {
    id: 'polygon:amoy', chainId: 'polygon', name: 'Polygon Amoy', environment: 'testnet', nativeSymbol: 'POL',
    rpcProtocol: 'evm-json-rpc', implementationStage: 'compatibility-ready', chainIdDecimal: 80002, chainIdHex: '0x13882',
    rpcUrls: ['https://rpc-amoy.polygon.technology/'], explorerUrls: ['https://amoy.polygonscan.com'], notes: ['Independent gas/finality verification required.']
  },
  {
    id: 'bsc:testnet', chainId: 'bsc', name: 'BNB Smart Chain Testnet', environment: 'testnet', nativeSymbol: 'tBNB',
    rpcProtocol: 'evm-json-rpc', implementationStage: 'compatibility-ready', chainIdDecimal: 97, chainIdHex: '0x61',
    rpcUrls: ['https://bsc-testnet-dataseed.bnbchain.org'], explorerUrls: ['https://testnet.bscscan.com'], notes: ['BSC-specific fee/finality behavior requires compatibility tests.']
  },
  {
    id: 'avalanche:fuji-c', chainId: 'avalanche', name: 'Avalanche Fuji C-Chain', environment: 'testnet', nativeSymbol: 'AVAX',
    rpcProtocol: 'evm-json-rpc', implementationStage: 'compatibility-ready', chainIdDecimal: 43113, chainIdHex: '0xa869',
    rpcUrls: ['https://api.avax-test.network/ext/bc/C/rpc'], explorerUrls: ['https://explorer-test.avax.network/c-chain'], notes: ['C-Chain only; P/X-chain semantics are out of scope for the EVM adapter.']
  }
];

const nonEvmNetworks = [
  {
    id: 'xrpl:testnet', chainId: 'xrpl', name: 'XRP Ledger Testnet', environment: 'testnet', nativeSymbol: 'XRP',
    rpcProtocol: 'xrpl-json-rpc-websocket', implementationStage: 'scaffold',
    rpcUrls: ['https://s.altnet.rippletest.net:51234', 'wss://s.altnet.rippletest.net:51233'], explorerUrls: [],
    notes: ['Native SignerList supports weighted quorum; exact account-wide inactivity enforcement remains an open design issue.']
  },
  {
    id: 'solana:devnet', chainId: 'solana', name: 'Solana Devnet', environment: 'testnet', nativeSymbol: 'SOL',
    rpcProtocol: 'solana-json-rpc', implementationStage: 'scaffold', rpcUrls: ['https://api.devnet.solana.com'], explorerUrls: ['https://explorer.solana.com/?cluster=devnet'],
    notes: ['Custom program/PDA path is preferred for exact inactivity + threshold + immutable rescue semantics.']
  },
  {
    id: 'stellar:testnet', chainId: 'stellar', name: 'Stellar Testnet', environment: 'testnet', nativeSymbol: 'XLM',
    rpcProtocol: 'stellar-horizon-rpc', implementationStage: 'scaffold',
    networkPassphrase: 'Test SDF Network ; September 2015', networkId: 'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472',
    rpcUrls: ['https://horizon-testnet.stellar.org', 'https://soroban-testnet.stellar.org'], explorerUrls: [],
    notes: ['Exact native recovery is scoped to N-of-N with one or two transaction extra signers; broader M-of-N requires Soroban. Pre-authorized transactions and minimum sequence age remain promising for the bounded native path.']
  },
  {
    id: 'tron:shasta', chainId: 'tron', name: 'TRON Shasta', environment: 'testnet', nativeSymbol: 'TRX',
    rpcProtocol: 'tron-http-api', implementationStage: 'scaffold', protocolChainIdDecimal: 2494104990,
    rpcUrls: [], explorerUrls: [], notes: ['Native weighted permissions support multisig but do not by themselves enforce inactivity; TVM vault path remains a candidate for exact semantics.']
  },
  {
    id: 'bitcoin:signet', chainId: 'bitcoin', name: 'Bitcoin Signet', environment: 'testnet', nativeSymbol: 'BTC',
    rpcProtocol: 'bitcoin-rpc-p2p', implementationStage: 'scaffold', rpcUrls: [], explorerUrls: [],
    notes: ['Descriptor/Miniscript/PSBT recovery must account for timelocks, UTXO churn, fee-bumping and destination enforcement.']
  },
  {
    id: 'cardano:preprod', chainId: 'cardano', name: 'Cardano Preprod', environment: 'testnet', nativeSymbol: 'ADA',
    rpcProtocol: 'cardano-node-api', implementationStage: 'scaffold', rpcUrls: [], explorerUrls: [],
    notes: ['Native scripts can express signature/timelock logic; EUTXO and fixed-destination recovery need chain-specific design.']
  }
];

for (const network of [...evmNetworks, ...nonEvmNetworks]) registerNetwork(network);
