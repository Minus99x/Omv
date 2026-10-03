# OmegaVault 0.6.41-dev — Portable external review bundle

- Added deterministic three-file review-bundle descriptor for the sealed ZIP, sidecar and external review index.
- Added machine-readable verification plan and fail-closed verifier.
- Added CLI generation and verification commands.
- Descriptor is generated post-seal and does not create an archive self-hash cycle.

Verification: focused review-bundle 5/5 PASS; dependency-free regression 313/313 PASS; global check PASS.

No chain promotion is claimed.
