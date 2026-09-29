import { defineEvmFamilyAdapter } from '../evm/adapter-factory.js';
export default defineEvmFamilyAdapter({ id: 'polygon', name: 'Polygon PoS', proofNetworks: [{ id: 'polygon:amoy', testOnly: true }] });
