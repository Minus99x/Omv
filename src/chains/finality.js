const MODELS = new Set(['evm-block', 'bft-ledger', 'rollup', 'confirmations', 'solana-commitment', 'custom']);

export function defineFinalityPolicy(input) {
  if (typeof input?.chainId !== 'string' || !input.chainId.trim() ||
      typeof input?.networkRef !== 'string' || !input.networkRef.trim() ||
      !MODELS.has(input?.model)) throw new TypeError('Finality policy requires chainId, networkRef and a supported model.');
  if (input.evidenceFields != null && !Array.isArray(input.evidenceFields))
    throw new TypeError('Finality evidenceFields must be an array.');
  if (input.notes != null && !Array.isArray(input.notes))
    throw new TypeError('Finality notes must be an array.');
  if (input.evidenceFields?.some(field=>typeof field!=='string'||!field.trim()) ||
      input.notes?.some(note=>typeof note!=='string'||!note.trim()))
    throw new TypeError('Finality evidence fields and notes must be nonempty primitive text.');
  if (input.evidenceFields && new Set(input.evidenceFields).size!==input.evidenceFields.length)
    throw new TypeError('Finality evidenceFields must not repeat required fields.');
  const policy = {
    chainId: input.chainId,
    networkRef: input.networkRef,
    model: input.model,
    target: structuredClone(input.target ?? {}),
    evidenceFields: Object.freeze([...(input.evidenceFields ?? [])]),
    notes: Object.freeze([...(input.notes ?? [])])
  };
  return Object.freeze(policy);
}

export function createFinalityObservation({ policy, transactionRef, observedAt, status, evidence = {} }) {
  if (!policy || !transactionRef || !observedAt) throw new TypeError('Finality observation requires policy, transactionRef and observedAt.');
  if (!['pending', 'included', 'finalized', 'failed'].includes(status)) throw new TypeError('Unsupported finality status.');
  return Object.freeze({
    chainId: policy.chainId, networkRef: policy.networkRef, model: policy.model,
    transactionRef, observedAt, status, evidence: structuredClone(evidence)
  });
}

export const DEFAULT_FINALITY_POLICIES = Object.freeze({
  ethereumSepolia: defineFinalityPolicy({ chainId: 'ethereum', networkRef: 'ethereum:sepolia', model: 'evm-block', target: { receiptStatus: 'success', confirmations: 2 }, evidenceFields: ['blockNumber', 'blockHash', 'confirmations'] }),
  xdcApothem: defineFinalityPolicy({ chainId: 'xdc', networkRef: 'xdc:apothem', model: 'evm-block', target: { receiptStatus: 'success', finalizedBlockTagPreferred: true }, evidenceFields: ['blockNumber', 'blockHash', 'finalizedBlockNumber'], notes: ['XDC documents XDPoS 2.0 BFT finality and supports the finalized block tag; live compatibility proof must verify the endpoint behavior used by OmegaVault.'] }),
  baseSepolia: defineFinalityPolicy({ chainId: 'base', networkRef: 'base:sepolia', model: 'rollup', target: { l2Receipt: 'success', l2FinalizedTag: true, parentFinalityRequiredForProduction: true }, evidenceFields: ['l2BlockNumber', 'l2BlockHash', 'l1Origin', 'l2FinalizedBlockHash'], notes: ['OP Stack finalized L2 blocks are derived from finalized L1 data; sequencer inclusion alone is not finality.'] }),
  arbitrumSepolia: defineFinalityPolicy({ chainId: 'arbitrum', networkRef: 'arbitrum:sepolia', model: 'rollup', target: { l2Receipt: 'success', parentFinalityRequiredForProduction: true }, evidenceFields: ['l2BlockNumber', 'l2BlockHash', 'l1BatchOrAssertionRef'], notes: ['Test proof may record L2 inclusion separately; production readiness requires explicit parent-chain finality policy.'] }),
  optimismSepolia: defineFinalityPolicy({ chainId: 'optimism', networkRef: 'optimism:sepolia', model: 'rollup', target: { l2Receipt: 'success', l2FinalizedTag: true, parentFinalityRequiredForProduction: true }, evidenceFields: ['l2BlockNumber', 'l2BlockHash', 'l1Origin', 'l2FinalizedBlockHash'], notes: ['OP Stack unsafe, safe, and finalized heads must remain distinct in evidence.'] }),
  polygonAmoy: defineFinalityPolicy({ chainId: 'polygon', networkRef: 'polygon:amoy', model: 'custom', target: { receiptStatus: 'success', chainNativeFinalityProofRequired: true }, evidenceFields: ['blockNumber', 'blockHash', 'chainNativeFinalityEvidence'], notes: ['Do not promote from receipt confirmations alone until Polygon PoS/Amoy finality evidence is implemented and verified against current official protocol documentation.'] }),
  bscTestnet: defineFinalityPolicy({ chainId: 'bsc', networkRef: 'bsc:testnet', model: 'evm-block', target: { receiptStatus: 'success', finalizedBlockTag: true, fastFinalityBlocks: 2 }, evidenceFields: ['blockNumber', 'blockHash', 'finalizedBlockNumber'], notes: ['BSC documents fast finality and supports querying finalized blocks; live proof must verify the testnet endpoint behavior.'] }),
  avalancheFuji: defineFinalityPolicy({ chainId: 'avalanche', networkRef: 'avalanche:fuji-c', model: 'custom', target: { receiptStatus: 'success', acceptedByCChain: true }, evidenceFields: ['blockNumber', 'blockHash', 'accepted'], notes: ['C-Chain EVM inclusion is not treated as independently verified finality until Avalanche acceptance evidence is captured by the live harness.'] }),
  stellarTestnet: defineFinalityPolicy({ chainId: 'stellar', networkRef: 'stellar:testnet', model: 'bft-ledger', target: { ledgerApplied: true }, evidenceFields: ['ledger', 'transactionHash'] }),
  solanaDevnet: defineFinalityPolicy({ chainId: 'solana', networkRef: 'solana:devnet', model: 'solana-commitment', target: { commitment: 'finalized' }, evidenceFields: ['slot', 'confirmationStatus', 'err'] }),
  bitcoinSignet: defineFinalityPolicy({ chainId: 'bitcoin', networkRef: 'bitcoin:signet', model: 'confirmations', target: { confirmations: 6 }, evidenceFields: ['blockHash', 'height', 'confirmations'] })
});
