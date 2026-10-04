# OmegaVault Multichain Execution Plan 0.6.55

## Completed checkpoint work

- [x] Verify checkpoint manifest against extracted source tree.
- [x] Verify exact source archive SHA-256.
- [x] Verify external review index before session preparation.
- [x] Verify package/package-lock integrity and installed pinned dependencies.
- [x] Keep generated capture sessions outside the sealed source tree by default.
- [x] Refuse silent overwrite of an existing capture-session manifest.
- [x] Prepare the Cardano session only after all workstation gates pass.
- [x] Keep all network/signing/submission authority false.
- [x] Pass focused workstation-launch tests and inherited verification stack.
- [x] Pass full 451-test regression, offline resume and global checks.
- [x] Build deterministic archive, checkpoint manifest and external review index.
- [x] Verify checkpoint/review bindings.

## Laptop/network objective

1. Extract sealed 0.6.55 artifact bundle and source ZIP.
2. Install pinned dependencies if required with `npm ci`.
3. Run the workstation launch gate.
4. Acquire a single Cardano Preprod tip.
5. Capture UTxOs, independently confirmed protocol parameters, Ogmios evaluation and independent phase-1 validation at that tip.
6. Run the prepared session verifier.
7. Stop after synchronized evaluation evidence; wallet signing and submission remain separate gates.

## Authority boundary

No work here authorizes production deployment, mainnet/live-value transactions, wallet signatures, submission or connector promotion.
