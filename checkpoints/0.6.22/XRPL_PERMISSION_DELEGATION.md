# OmegaVault 0.6.22-dev — XRPL permission-delegation checkpoint

Current source-of-truth archive:
`omegavault-mvp-0.6.22-dev.zip`

SHA-256:
`ac0a6ad15394b6f8fe12267330e9ef608f91127f8ed63181c65edb5035a98a19`

## Concrete changes

- Added XRPL `DelegateSet(Payment)` builder.
- Added explicit PermissionDelegationV1_1 requirement/evidence metadata.
- Added fail-closed XRPL delegated-recovery safety assessment.
- Added product-claim guards for inactivity, destination, amount, currency and exact-recovery claims.
- Added a candidate dedicated-delegate + delegate-owned SignerList architecture.
- Added a standalone permission-delegation regression suite.
- Preserved Solana 0.6.21 unchanged and parked.

## Verification

- Focused XRPL: 16/16 pass.
- npm check: PASS.
- Full JS: 120 pass / 13 dependency-startup failures only.

## Promotion boundary

No XRPL public-network or exact-recovery promotion is claimed. Permission Delegation is supporting least-privilege infrastructure only.

## Next task

Bitcoin reduced-semantics / PSBT hardening and evidence, unless a new XRPL-native primitive changes the analysis.
