export function createSolanaProgramBlueprint({ programId = null, inactivitySeconds = 2592000, threshold = 2, contactCount = 2 }) {
  if (!Number.isInteger(inactivitySeconds) || inactivitySeconds < 1) throw new TypeError('inactivitySeconds must be positive.');
  if (!Number.isInteger(contactCount) || contactCount < 1 || contactCount > 16) throw new TypeError('contactCount must be 1-16.');
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > contactCount) throw new TypeError('threshold must be reachable.');
  return Object.freeze({
    chainId: 'solana', networkRef: 'solana:devnet', strategy: 'program-pda-vault', programId,
    stateSeeds: Object.freeze(['omegavault', 'owner-pubkey', 'vault-id']), inactivitySeconds, threshold, contactCount,
    instructions: Object.freeze(['initialize_vault', 'heartbeat', 'approve_recovery', 'revoke_or_reset_approvals', 'execute_native_recovery', 'execute_spl_recovery', 'close_vault']),
    invariants: Object.freeze(['PDA owns/controls vault state; no PDA private key exists', 'only configured owner may heartbeat', 'only configured contacts may approve', 'duplicate approvals do not increment threshold', 'heartbeat clears approvals', 'execute requires inactivity + threshold', 'rescue destination is immutable after initialization', 'SPL mint/token-program identity is explicit'])
  });
}

export { deriveSolanaVaultPdas, buildSolanaInitializeInstruction, buildSolanaHeartbeatInstruction, buildSolanaApprovalInstruction, buildSolanaExecuteNativeInstruction } from '../solana/program-codec.js';
