# OmegaVault 0.6.39-dev — Provenance audit export

- Explicit parent lineage is nullable and never inferred.
- Current existing evidence contains zero cryptographic parent-bundle bindings; audit reports `not-recorded`.
- Added deterministic SHA-256-bound provenance integrity audit.
- Added CLI and browser export paths gated by backend validation.
- Added static exported audit evidence at `docs/evidence/PROVENANCE_INTEGRITY_AUDIT_0.6.39.json`.

Verification: focused audit/provenance 27/27 PASS; dependency-free regression 295/295 PASS; global check PASS.

No chain promotion is claimed.
