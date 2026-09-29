import { defineEvmFamilyAdapter } from '../evm/adapter-factory.js';
export default defineEvmFamilyAdapter({ id: 'avalanche', name: 'Avalanche C-Chain', proofNetworks: [{ id: 'avalanche:fuji-c', testOnly: true }], securityNotes: ['This adapter covers C-Chain EVM semantics only, not Avalanche P-Chain or X-Chain.'] });
