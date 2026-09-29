import { defineEvmFamilyAdapter } from '../evm/adapter-factory.js';
export default defineEvmFamilyAdapter({ id: 'bsc', name: 'BNB Smart Chain', proofNetworks: [{ id: 'bsc:testnet', testOnly: true }] });
