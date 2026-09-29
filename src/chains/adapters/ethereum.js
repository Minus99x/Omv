import { defineAdapter } from '../adapter-interface.js';

export default defineAdapter({
  id: 'ethereum',
  family: 'evm',
  name: 'Ethereum',
  accountModel: 'account',
  transactionModel: 'nonce-account',
  signingModel: 'eip-1193/eoa-or-smart-account',
  recoveryMechanism: 'versioned smart-contract proof; production model undecided',
  implementationStage: 'live-proof',
  proofAdapter: true,
  proofAdapterVersion: '0.4.0',
  proofNetworks: [{ id: '0xaa36a7', name: 'Sepolia', testOnly: true }],
  capabilities: [
    'account-connect', 'balance-read', 'message-sign', 'recovery-policy-test',
    'mechanism-create', 'mechanism-verify', 'heartbeat', 'recovery-approve',
    'recovery-execute', 'explorer-link'
  ],
  securityNotes: [
    'Sepolia proof only; production value disabled',
    'Browser wallet remains signing boundary',
    'Independent RPC verification still required before production'
  ],
  validateAccount(account) {
    return typeof account === 'string' && /^0x[a-fA-F0-9]{40}$/.test(account);
  }
});
