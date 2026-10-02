# OmegaVault Chain Assessment 0.6.28-dev

## Ethereum Sepolia / XDC Apothem finality

OmegaVault no longer accepts a caller-declared `finalized` status as EVM-family promotion evidence. Ethereum Sepolia and XDC Apothem now require a successful recovery receipt tied to the exact proof transaction, independent receipt-block lookup by hash, canonical lookup at the receipt height and a network-native `finalized` head at or beyond that height.

The resulting record is digest-bound to the proof binding, common recovery context and verified deployment. Native and ERC-20 paths must each supply their own matching evidence.

## Current conclusion

- Ethereum Sepolia remains the proven baseline; the new verifier strengthens future evidence capture without replacing the preserved proof.
- XDC Apothem remains compatibility-ready and test-only.
- A synthetic/offline fixture is not public-network proof.
- XDC promotion still requires fresh deployment, recovery and finality capture on Apothem.
