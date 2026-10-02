# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.25-dev**

Archive: `omegavault-mvp-0.6.25-dev.zip`
SHA-256: `e451a934c7f4cb572bb7b3eea737d9e61da1ea131eddf1684ca1605d2681be07`

## 0.6.25 delta

- Added a dependency-free Cardano synchronized evidence-binding layer.
- Bound the exact recovery transaction body and CBOR to one acquired node tip.
- Required UTxO, protocol-parameter, Ogmios evaluation and phase-1 evidence to share the exact same node tip.
- Required evaluation and phase-1 evidence to reference the exact same transaction body.
- Required complete phase-1 checks for balance, minimum ADA, collateral and witnesses before evidence promotion.
- Canonicalized and SHA-256 hashed UTxO, protocol-parameter, evaluation and phase-1 evidence individually.
- Hash-bound all component digests, the acquired tip and transaction identity into one deterministic evidence-bundle digest.
- Added fail-closed rejection for mixed-tip, mixed-transaction and non-canonical evidence.

## Verification

- `npm run check`: **passed**.
- Focused Cardano evidence-binding suite: **7/7 passed**.
- Full Cardano live/evaluation execution remains toolchain-gated; no new public-network proof is claimed.

## Source of truth

The complete 0.6.25-dev archive is stored in the ChatGPT file Library under the exact filename and checksum above.

## Next offline gate

Continue independent EVM/XDC/shared-evidence hardening. When a workstation is available, run `npm ci` to restore pinned dependencies and immediately resume Stellar native-recovery and Bitcoin cryptographic finalizer execution.

## Safety boundary

Do not write directly to `main`. Do not perform production deployments, wallet signatures, production-value transfers, or claim live proof until the corresponding promotion gates pass.
