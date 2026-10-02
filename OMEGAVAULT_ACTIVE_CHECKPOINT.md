# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.34-dev**

Archive filename: `omegavault-mvp-0.6.34-dev.zip`
Sidecar filename: `omegavault-mvp-0.6.34-dev.checkpoint-manifest.json`

The archive SHA-256 is deliberately recorded only in the external sidecar manifest so the archive does not attempt to contain its own digest.

## 0.6.34 delta

- Added a browser capability dashboard backed exclusively by the validated `omegavault.api.chain-capabilities.v1` response.
- Browser presentation does not recalculate promotion eligibility.
- Displays backend-provided blockers, missing gates, insufficient-evidence gates and gate evidence levels.
- Malformed, unvalidated, duplicate-chain or unavailable capability data fails closed to **Status unavailable** with no promotion claim.
- Stellar/XLM remains visible in the browser even when the full Stellar transaction SDK is absent.
- Preserves the 0.6.33 validated backend/API boundary and dependency-free Stellar account validation.

## Verification

- Browser capability UI model/integration tests: **8/8 passed**.
- Broad dependency-free offline regression: **229/229 passed**.
- `npm run check`: **passed**.
- Deterministic archive rebuild: **passed**.
- Fresh-extraction sidecar verification: **passed**.
- Nine SDK-bound test files remain intentionally workstation-gated and are not counted as passing until `npm ci` restores their pinned dependencies.

## Promotion boundary

No chain is newly promoted. The browser may display backend eligibility but cannot independently create or upgrade a promotion claim.

## Next offline gate

Harden capability-dashboard accessibility, sorting/filter semantics and contract-detail UX while keeping maturity logic backend-owned. Then continue evidence-detail/API presentation and operator diagnostics.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
