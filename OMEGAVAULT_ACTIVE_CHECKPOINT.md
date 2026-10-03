# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.39-dev**

Archive filename: `omegavault-mvp-0.6.39-dev.zip`
Sidecar filename: `omegavault-mvp-0.6.39-dev.checkpoint-manifest.json`

The archive SHA-256 is deliberately recorded only in the external sidecar manifest so the archive does not attempt to contain its own digest.

## 0.6.39 delta

- Every provenance record now explicitly exposes `parentBundleSha256`, using `null` when no cryptographic parent bundle is actually recorded.
- Existing evidence was scanned for explicit parent-bundle lineage; no real parent-bundle digest is present in the current evidence set, so lineage remains **not recorded** rather than inferred.
- Added deterministic `omegavault.provenance-integrity-audit.v1` snapshots covering capability, provenance, evidence-history and diagnostics state.
- Audit snapshots are SHA-256 bound and revalidated against current backend state.
- Added `npm run audit:provenance` / `scripts/export-provenance-audit.js` for local JSON export.
- Added validated API envelope `omegavault.api.provenance-integrity-audit.v1` at `/api/provenance-audit`.
- Browser can export the backend-validated audit JSON and cannot export an unvalidated audit.
- Provenance details visibly distinguish a real parent digest from `Parent bundle: not recorded`.

## Verification

- Provenance audit/export/provenance focused slice: **27/27 passed**.
- Broad dependency-free offline regression: **295/295 passed**.
- `npm run check`: **passed**.
- Full suite: **295 passed / 9 workstation-gated files failed to load**, exactly the known missing pinned SDK/toolchain boundary.

## Promotion boundary

No chain is newly promoted. The audit describes current integrity/evidence state and cannot modify promotion eligibility.

## Next offline gate

Add export verification metadata suitable for external review, plus a deterministic operator audit index that can cross-reference audit SHA-256, evidence checkpoint history and checkpoint sidecar identity without embedding the archive's own digest inside itself.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
