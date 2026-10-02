# OmegaVault 0.6.26-dev — EVM/XDC proof binding

Archive: `omegavault-mvp-0.6.26-dev(1).zip`

SHA-256:
`2ec1e6473dceceadb7a72f5324b480b259d7ad1997e28abb297aa234e6bf8017`

## Concrete changes

- Network/deployment/policy-bound EVM proof context.
- Cross-network proof-reuse rejection.
- Exact native deposit/rescue delta checks.
- Recovered-state gate for ERC-20 sweep proof.
- XDC/0x canonical address normalization without collapsing network identity.
- Network-bound finality promotion gate.

## Verification

- EVM/XDC: 8/8 PASS.
- Combined regression slice: 31/31 PASS.
- Global check: PASS.

## Promotion boundary

XDC remains compatibility-ready and test-only; no fresh Apothem recovery proof is claimed.
