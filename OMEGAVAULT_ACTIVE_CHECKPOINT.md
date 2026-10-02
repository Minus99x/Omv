# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.27-dev**

Authoritative archive: `omegavault-mvp-0.6.27-dev.zip`
SHA-256: `bf8638a91bb1e77ab80fb38c2ac89703efc3fc50855657d9a7f66814162102fa`

## 0.6.27 delta

- Upgraded new evidence records to `OmegaVault-evidence/0.6` while retaining validation support for ordinary 0.5 records.
- Added deterministic canonical evidence JSON with sorted keys and explicit BigInt representation.
- Evidence now fails closed on undefined, function, symbol, non-finite number, non-plain object, Date-like object and cyclic structures instead of allowing JSON ambiguity or silent field loss.
- Evidence payloads are canonicalized before storage and deeply frozen after digest creation.
- Added optional parent-evidence SHA-256 binding.
- Added exact project-checkpoint `{ref, sha256}` binding so evidence can identify the precise OmegaVault source checkpoint that produced it.
- Validator reports canonicalization problems in malformed external records as validation errors instead of throwing.
- Preserves the 0.6.26 EVM/XDC proof-context hardening in the authoritative archive.

## Verification

- Focused evidence-recorder suite: **8/8 passed**.
- Combined Cardano/evidence/EVM-XDC/TRON regression slice: **37/37 passed**.
- `npm run check`: **passed**.
- Existing Solidity and TRON artifact verification: **passed**.

## Promotion boundary

This checkpoint hardens evidence provenance and integrity only. It does not promote any additional chain to live-proof status.

## Source of truth

The exact Library archive and checksum above are authoritative for 0.6.27. Continue implementation from that archive rather than reconstructing newer source from older branch files.

## Next offline gate

Advance network-specific EVM/XDC finality evidence binding. Then harden dependency/lockfile integrity and workstation-resume tooling. When a workstation is available, `npm ci` remains the high-leverage gate for Stellar native-recovery execution and the Bitcoin Noble-backed finalizer suite.

## Safety boundary

Do not write directly to `main`. Do not perform production deployments, wallet signatures, production-value transfers, or claim live proof until corresponding promotion gates pass.
