import { defineAdapter } from '../adapter-interface.js';

export default defineAdapter({
  id: 'xdc',
  family: 'evm-account-compatible',
  name: 'XDC Network',
  accountModel: 'account',
  transactionModel: 'evm-like-account',
  signingModel: 'evm-compatible with XDC-specific network handling',
  recoveryMechanism: 'candidate: separately audited EVM-family deployment, never assumed byte-identical to Ethereum',
  implementationStage: 'scaffold',
  proofAdapter: false,
  capabilities: [],
  securityNotes: [
    'Shared address shape does not imply shared chain behavior',
    'Network-specific gas/finality/RPC assumptions must be isolated'
  ],
  validateAccount(account) {
    return typeof account === 'string' && /^(0x|xdc)[a-fA-F0-9]{40}$/.test(account);
  }
});
