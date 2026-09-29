import { defineEvmFamilyAdapter } from '../evm/adapter-factory.js';
export default defineEvmFamilyAdapter({ id: 'arbitrum', name: 'Arbitrum', proofNetworks: [{ id: 'arbitrum:sepolia', testOnly: true }], securityNotes: ['Rollup finality must be modeled independently from an L2 receipt.'] });
