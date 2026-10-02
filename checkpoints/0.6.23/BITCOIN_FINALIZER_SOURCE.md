# OmegaVault 0.6.23-dev — Bitcoin finalizer source checkpoint

Archive: `omegavault-mvp-0.6.23-dev.zip`

SHA-256:
`e2a96a522d3f921194f144b4b87276b540bf72bfb2da6bb2a48f6da3ff0f3e88`

## Concrete changes

- Exact descriptor/P2WSH binding on every Bitcoin recovery input.
- Block-based CSV enforcement before delayed recovery finalization.
- Distinct allowed-contact signature threshold enforcement.
- Rejection of unauthorized partial signers.
- Single caller-confirmed rescue output.
- Exact caller-confirmed fee.
- Delayed-branch witness construction.
- Raw SegWit extraction with txid/wtxid/weight/vsize.
- Global syntax check now covers the Bitcoin descriptor and PSBT modules.

## Verification

- Global check: PASS.
- Bitcoin policy + finalizer structural tests: 11/11 PASS.
- Noble-backed cryptographic finalizer test execution: blocked by missing pinned `@noble/curves` in this extraction.

## Promotion boundary

Bitcoin remains offline and reduced-semantics. No Signet recovery proof is claimed.
