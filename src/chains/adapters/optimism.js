import { defineEvmFamilyAdapter } from '../evm/adapter-factory.js';
export default defineEvmFamilyAdapter({ id: 'optimism', name: 'OP Mainnet / OP Stack', proofNetworks: [{ id: 'optimism:sepolia', testOnly: true }], securityNotes: ['Fault-proof and parent-chain finality evidence must not be collapsed into L2 inclusion.'] });
