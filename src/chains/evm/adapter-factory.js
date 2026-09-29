import { defineAdapter } from '../adapter-interface.js';

export function defineEvmFamilyAdapter({ id, name, family = 'evm', recoveryMechanism = 'shared OmegaVault EVM vault implementation with chain-specific compatibility verification', proofNetworks = [], implementationStage = 'scaffold', securityNotes = [] }) {
  return defineAdapter({
    id,
    family,
    name,
    accountModel: 'account',
    transactionModel: 'evm-nonce-account',
    signingModel: 'eip-1193/eoa-or-smart-account',
    recoveryMechanism,
    implementationStage,
    proofAdapter: implementationStage === 'live-proof',
    proofNetworks,
    capabilities: implementationStage === 'live-proof'
      ? ['account-connect', 'balance-read', 'message-sign', 'recovery-policy-test', 'mechanism-create', 'mechanism-verify', 'heartbeat', 'recovery-approve', 'recovery-execute', 'explorer-link']
      : ['account-connect', 'balance-read', 'message-sign', 'explorer-link'],
    securityNotes: [
      'Shared EVM bytecode is not evidence of shared network behavior; every network must pass independent RPC, fee, finality, deployment and recovery tests.',
      ...securityNotes
    ],
    validateAccount(account) {
      return typeof account === 'string' && /^0x[a-fA-F0-9]{40}$/.test(account);
    }
  });
}
