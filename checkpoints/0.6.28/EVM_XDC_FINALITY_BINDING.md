# OmegaVault 0.6.28-dev — EVM/XDC finality binding

Archive: `omegavault-mvp-0.6.28-dev(2).zip`

SHA-256:
`e9e1aadaaf3a0561c374b75bcfd8ddbff39fc07425487111e33e5976ac3ea819`

## Concrete changes

- Exact Ethereum Sepolia/XDC Apothem chain-ID binding.
- Successful recovery-receipt binding.
- Receipt block verified by hash and canonical height.
- Network-native `finalized` head verified at or beyond the receipt height.
- Finality record bound to proof, context and deployment digests.
- Native/ERC-20 finality records cannot be reused or cross-wired.

## Verification

- Finality suite: 5/5 PASS.
- EVM/finality regression slice: 16/16 PASS.
- Full JavaScript suite: 235/235 PASS.
- Global check: PASS.

## Promotion boundary

No fresh public-network execution is claimed. XDC Apothem remains compatibility-ready/test-only pending a new deployment and full recovery/finality capture.
