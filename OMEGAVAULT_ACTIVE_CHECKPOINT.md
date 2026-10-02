# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.32-dev**

Archive: `omegavault-mvp-0.6.32-dev.zip`
Archive SHA-256: `6432ce6f0dade0138d5aa351b9353aff75209e40961dbd45f735584eaa78c4fe`
Sidecar: `omegavault-mvp-0.6.32-dev.checkpoint-manifest.json`
Sidecar file SHA-256: `bf64d537eda3ffd0d8899c6a7e85be5aff4cd244c44a8b389cdc0a3b739fcc49`
Checkpoint-manifest logical SHA-256: `6231d40f287119be65b4eefc9ee827a6b021afe9a42866b16bcf662a31ef4f91`
Source-tree SHA-256: `0ab288a5e1ad22ebba29b2b9d3f68cc6dd5cb1d621ea0b58d07d6c9d324f8204`
Dependency-lock binding SHA-256: `e768b41214755acef74c1eb9ae2f9136a4fc343983de91333fc05d8d67234b56`

## 0.6.32 delta

- Added evidence-backed chain capability/maturity contracts.
- Promotion gates require explicit evidence levels and minimum evidence strength.
- Legacy implementation labels cannot bypass promotion gates.
- Added explicit maturity profiles and blockers for all active chain lanes.
- Added a dependency-free capability catalog so missing SDKs cannot hide a chain's status.
- Added stable `omegavault.chain-capability-catalog.v1` response builder and `/api/chain-capabilities`.
- Stellar remains explicitly present and dependency-blocked when its SDK is absent.

## Verification

- Capability contract/catalog/maturity slice: **14/14 passed**.
- Combined offline regression slice: **80/80 passed**.
- `npm run check`: **passed**.
- Deterministic archive build: **passed**.
- Fresh-extraction sidecar verification: **passed**.

## Promotion boundary

No chain is newly promoted. Missing or insufficient evidence keeps promotion ineligible.

## Next offline gate

Harden backend/API response schemas around capability and evidence objects, then connect the browser UI to consume the same contract without duplicating maturity logic.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
