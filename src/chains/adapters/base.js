import { defineEvmFamilyAdapter } from '../evm/adapter-factory.js';
export default defineEvmFamilyAdapter({ id: 'base', name: 'Base', proofNetworks: [{ id: 'base:sepolia', testOnly: true }], securityNotes: ['L2 inclusion and parent-chain finality are separate evidence concepts.'] });
