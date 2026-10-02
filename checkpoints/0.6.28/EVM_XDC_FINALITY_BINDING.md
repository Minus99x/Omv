# OmegaVault 0.6.28-dev — EVM/XDC finality binding

Archive: `omegavault-mvp-0.6.28-dev.zip`

SHA-256:
`859a88e7dcae51221f256838c85ec08e75737f8e53da9c13fde295f456a0c597`

## Concrete changes

- Exact recovery transaction references in EVM proof outputs.
- Network-specific finality evidence bound to proof, deployment and network identity.
- XDC Apothem finalized-head enforcement.
- Ethereum Sepolia confirmation-count enforcement.
- Independent native-recovery and ERC-20-sweep finality requirements.
- Cross-wired finality evidence fails closed.

## Verification

- Focused EVM/XDC finality + harness: 14/14 PASS.
- Combined regression slice: 46/46 PASS.
- Global check: PASS.

## Promotion boundary

No fresh XDC Apothem public-network finality proof is claimed.
