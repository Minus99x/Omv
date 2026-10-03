# OmegaVault 0.6.39-dev — Provenance integrity audit export

- Provenance records explicitly carry nullable parent-bundle lineage.
- No existing parent-bundle digest was found; no lineage was synthesized.
- Audit snapshots are deterministic and SHA-256 bound.
- CLI/API/browser export paths require valid backend state.
- Browser export refuses unvalidated audit data.

Verification: 27/27 focused PASS; 295/295 dependency-free PASS; global check PASS.

No chain promotion is claimed.
