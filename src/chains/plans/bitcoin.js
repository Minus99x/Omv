export function createBitcoinRecoveryBlueprint({ threshold = 2, contactCount = 3, relativeTimelockBlocks = 4320 }) {
  if (!Number.isInteger(contactCount) || contactCount < 1 || contactCount > 15) throw new TypeError('contactCount must be 1-15.');
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > contactCount) throw new TypeError('threshold must be reachable.');
  if (!Number.isInteger(relativeTimelockBlocks) || relativeTimelockBlocks < 1) throw new TypeError('relativeTimelockBlocks must be positive.');
  return Object.freeze({
    chainId: 'bitcoin', networkRef: 'bitcoin:signet', strategy: 'descriptor-miniscript-psbt', threshold, contactCount, relativeTimelockBlocks,
    requiredComponents: Object.freeze(['descriptor/miniscript policy compiler', 'PSBT v2 capable coordinator', 'UTXO inventory and coin selection', 'CSV/CLTV policy verification', 'RBF/CPFP fee strategy', 'watch-only recovery monitor', 'evidence recorder for txid + script path + confirmations']),
    unresolved: Object.freeze(['Bitcoin script authorization does not natively force a fixed rescue output without additional construction; destination enforcement needs a pre-signed recovery transaction or another covenant-like design.', 'UTXO changes can invalidate pre-signed recovery transactions unless vault UTXO management is constrained.', 'Timelock reset/liveness semantics must be designed around UTXO spends, not an account heartbeat.'])
  });
}
