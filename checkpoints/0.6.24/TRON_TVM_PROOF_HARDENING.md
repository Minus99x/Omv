# OmegaVault 0.6.24-dev — TRON TVM proof hardening

Archive: `omegavault-mvp-0.6.24-dev.zip`

SHA-256:
`0e3323aba360ad20248f35fdc6612c8ed8ea2bdc75636619ca3a6674f8594da6`

## Concrete changes

- Exact deployment/config binding before TRON proof actions.
- Positive Energy-estimate requirements.
- Explicit pre-deposit, post-deposit and post-recovery state evidence.
- Exact TRX rescue-balance delta verification.
- Recovered-state gate before TRC-20 sweep proof.
- Exact token vault-to-rescue balance-delta verification.
- Additional adversarial tests for cross-wired deployment reports and false-success balance transitions.

## Verification

- Global check: PASS.
- TRON contract/build verification: PASS.
- Focused TRON suite: 14/14 PASS.

## Promotion boundary

No fresh Shasta deployment or live recovery proof is claimed. This is a source/evidence-harness checkpoint.
