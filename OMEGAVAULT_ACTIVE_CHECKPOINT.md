# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.31-dev**

Archive filename: `omegavault-mvp-0.6.31-dev.zip`
Archive SHA-256 (external sidecar authority): `81c004db7b58cba7206d251927ef0e25a70b047e8ce81200502627879320f976`
Sidecar manifest filename: `omegavault-mvp-0.6.31-dev.checkpoint-manifest.json`
Sidecar file SHA-256: `1d876beaa65367e1fc97dc110216eeae3c3c67c9b86533af07b0beb60f3de0b5`
Checkpoint-manifest logical SHA-256: `f72dc5248d648d13e72c59c13d7c667ce480291783ea394a7b7e15339c0b7c70`
Source-tree SHA-256: `0eb66c5de293eda181d6904ffc9ea2317fa01a72db4807af7c0cf0f596c891ec`
Dependency-lock binding SHA-256: `7e6f6915dadd9a45430a1337e037c6402149d262dac62682f1340abdfa84d096`

The archive SHA-256 is deliberately not embedded inside the archive. The exact archive digest is recorded in the external sidecar manifest to avoid self-referential hashing.

## 0.6.31 delta

- Added deterministic source-tree inventory generation with normalized relative paths, byte counts and per-file SHA-256 digests.
- Added a checkpoint sidecar manifest that binds the checkpoint ref, archive filename, archive SHA-256, dependency-lock binding, source-tree digest and optional proof-bundle digest.
- Added independent checkpoint-manifest verification; archive, dependency-lock, source-tree or proof-bundle drift fails closed.
- Added deterministic archive construction with normalized ordering and timestamps.
- Two independent archive builds from the same 351-file source tree produced the exact same SHA-256.
- Removed the self-referential pattern of embedding an archive's own SHA-256 inside that archive.
- Added `npm run checkpoint:manifest`.

## Verification

- Checkpoint-manifest focused tests: **6/6 passed**.
- Manifest/provenance/dependency/evidence slice: **20/20 passed**.
- Combined offline regression slice: **66/66 passed**.
- `npm run check`: **passed**.
- Fresh-extraction sidecar verification: **passed**.
- Reproducible archive comparison: **passed**.

## Promotion boundary

No chain maturity is promoted by this checkpoint. This is checkpoint/provenance infrastructure only.

## Next offline gate

Advance shared multichain capability/maturity metadata so backend and UI consume one explicit evidence-backed maturity contract instead of per-chain assumptions. Then harden backend/API response schemas around that contract.

## Workstation gate

When a workstation is available, run `npm ci` followed by `npm run verify:offline-resume`.

## Safety boundary

Do not write directly to `main`. Do not perform production deployments, wallet signatures, production-value transfers, or claim live proof until corresponding promotion gates pass.
