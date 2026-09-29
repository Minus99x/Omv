# OmegaVault 0.6.7-dev Progress

## Concrete progress
- Re-verified remaining Solana assumptions against current official documentation. No Solana live-proof promotion: Rust/Solana CLI compilation remains unavailable in this environment.
- Advanced to Bitcoin offline hardening.
- Added BIP68/BIP112 CSV input preflight: tx version >=2, disable flag clear, height-based sequence, and relative value >= configured CSV blocks.
- Added PSBTv2 signing lock plan based on BIP370 transaction-modifiable flags; OmegaVault requires inputs and outputs frozen before signature collection.
- Added adversarial regression coverage for disabled relative locktime, time-based sequence mismatch, old tx version, insufficient delay, and modifiable PSBTv2 outputs.

## Verification
- Bitcoin focused tests: 7/7 pass.
- npm run check: PASS, including EVM manifest and TRON artifact verification.
- Full node test suite: 84/92 pass; 8 test-file startup failures are caused by missing @stellar/stellar-sdk in the extracted workspace. No assertion failures are reported in the 84 executed tests.
- No connector promoted to live-proof.
- No wallet signature or user setup requested.

## Blockers
- Solana Rust/sBPF build and execution still require cargo/rustc/Solana CLI.
- Clean full-suite verification requires restoring the pinned Stellar dependency in this execution environment.
- GitHub push requires an accessible OmegaVault repository.

## Next offline task
Continue Bitcoin descriptor/miniscript policy encoding and executable PSBT/transaction serialization verification where available; then advance to Cardano once the Bitcoin offline toolchain boundary is reached.
