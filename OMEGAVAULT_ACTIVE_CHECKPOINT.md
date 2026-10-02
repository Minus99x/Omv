# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.36-dev**

Archive filename: `omegavault-mvp-0.6.36-dev.zip`
Sidecar filename: `omegavault-mvp-0.6.36-dev.checkpoint-manifest.json`

The archive SHA-256 is deliberately recorded only in the external sidecar manifest so the archive does not attempt to contain its own digest.

## 0.6.36 delta

- Added a backend evidence-provenance registry for every evidence reference currently used by chain maturity profiles.
- Each provenance record binds an evidence ref to its exact checkpoint ref, checkpoint archive filename, archive SHA-256, applicable chain IDs, claim scope and artifact paths.
- Added fail-closed coverage validation: every maturity evidence ref must resolve to provenance registered for the same chain.
- Added versioned API envelope `omegavault.api.evidence-provenance.v1` at `/api/evidence-provenance`.
- API validation rejects duplicate refs, checkpoint/archive drift, invalid archive digests and unsafe artifact paths.
- Browser provenance data is separately backend-validated and joined to gate refs by exact ref + chain identity.
- Capability cards now expose checkpoint, archive SHA-256, provenance scope and artifact paths for resolved evidence refs.
- Unresolved or cross-wired refs remain visible as unavailable and never create an additional maturity or promotion claim.

## Verification

- Evidence provenance registry/API/browser/HTTP slice: **15/15 passed**.
- Broad dependency-free offline regression: **248/248 passed**.
- `npm run check`: **passed**.
- Deterministic archive rebuild: **passed**.
- Fresh-extraction sidecar verification: **passed**.
- Nine SDK-bound test files remain intentionally workstation-gated until `npm ci` restores their pinned dependencies.

## Promotion boundary

No chain is newly promoted. Provenance explains existing gate evidence but does not alter promotion eligibility.

## Next offline gate

Add operator evidence-history diagnostics and checkpoint lineage summaries, then harden provenance browsing/search without allowing the browser to infer maturity.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
