# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.50-dev**

Archive filename: `omegavault-mvp-0.6.50-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.50-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.50-dev.review-index.json`

## 0.6.50 delta

- Registered the sealed 0.6.49 Stellar and Bitcoin execution evidence in the provenance catalog.
- Removed the resolved Stellar SDK and Bitcoin Noble dependency blockers.
- Raised Stellar to `offline-verified` while preserving public-Testnet/live gates.
- Kept Bitcoin `reduced-semantics` and retained the explicit immutable-rescue covenant limitation.
- Added offline Bitcoin address-validation/evidence-export bindings from 0.6.49 evidence.
- Preserved Bitcoin Core extraction cross-check and Signet execution as unresolved.
- Updated historical review-basis tests so old artifacts remain immutable snapshots instead of being rewritten to current state.
- Updated capability API/UI tests to match current evidence without deriving promotion.
- Added a focused maturity/provenance verification lane.

## Verification

- Pinned dependency install with `npm ci`: **passed**.
- Focused review/audit suite: **84/84 passed**.
- Focused Stellar recovery suite: **20/20 passed**.
- Focused Bitcoin recovery suite: **22/22 passed**.
- Focused maturity/provenance suite: **21/21 passed**.
- Full suite: **433/433 passed**.
- Offline-resume verification: **ok: true** with **16/16** Stellar and **11/11** Bitcoin checks.
- Global `npm run check`: **passed**.
- Deterministic source archive generation: **passed**.
- Checkpoint manifest generation: **passed**.
- External review index generation/verification: **passed**.

## Promotion boundary

No connector is newly promoted by 0.6.50.

Stellar is offline-verified, not public-testnet verified. Bitcoin remains reduced-semantics and has no covenant enforcement or Signet recovery proof.

## Next safe gate

Branch from the sealed 0.6.50 source checkpoint and select the next unresolved chain-specific execution gap from the corrected maturity catalog.

## Safety boundary

Never modify `main` directly or perform production deployments, live-value transactions, wallet signatures, secret handling or irreversible external actions from this development queue.
