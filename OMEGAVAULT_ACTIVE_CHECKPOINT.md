# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.33-dev**

Archive: `omegavault-mvp-0.6.33-dev.zip`
Archive SHA-256: `5b691f150e5818f74804c51a2c04a450aef3a2189b5340ac277f31856f889034`
Sidecar: `omegavault-mvp-0.6.33-dev.checkpoint-manifest.json`
Sidecar file SHA-256: `028c7e010e00d752416a6603e8831a14e224e7176cf987ec1dc77d59c964692a`
Checkpoint-manifest logical SHA-256: `5fe1c9ab63038509aebf271a2a5dd55387298ec1b67fe56fe70cf32554ed06ab`
Source-tree SHA-256: `1523cfc1d9009b2b5e7f25ce0bc9a2f1fa47ea1fd036d0908faac0b65529e378`
Dependency-lock binding SHA-256: `519631a969f38d45e8cdaee7fceb3941f7d4975b15933999737d6df79792b111`

## 0.6.33 delta

- Added versioned API response validation for chain-capability catalogs and evidence records.
- Capability API validation independently recomputes promotion eligibility from gate evidence and blockers.
- Rejects forged gate sufficiency, gate-count drift, missing/insufficient-gate drift, duplicate chain contracts, unregistered networks and chain/network cross-wiring.
- Evidence API validation requires both a valid evidence digest and a registered network whose chain matches the evidence chain.
- `/api/chain-capabilities` now returns `omegavault.api.chain-capabilities.v1`.
- Added dependency-free Stellar G-address StrKey validation, removing the full Stellar SDK from the basic adapter/account-validation path.
- Backend status/capability APIs now start without the pinned Stellar SDK installed; Stellar transaction/recovery execution remains dependency-gated.

## Verification

- API response-contract tests: **8/8 passed**.
- Server/API/capability/evidence/Stellar integration slice: **41/41 passed**.
- Broad dependency-free offline regression: **221/221 passed**.
- `npm run check`: **passed**.
- Deterministic archive build: **passed**.
- Fresh-extraction sidecar verification: **passed**.

## Promotion boundary

No chain is newly promoted. API validation is fail-closed and cannot convert incomplete evidence into a live-proof claim.

## Next offline gate

Connect the browser UI to the validated `omegavault.api.chain-capabilities.v1` response. The UI must render blockers, missing gates and evidence levels directly from backend data and must not duplicate promotion logic.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
