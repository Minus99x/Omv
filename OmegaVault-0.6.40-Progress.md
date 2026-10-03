# OmegaVault 0.6.40-dev — External review audit index

- Added deterministic operator audit index binding provenance-audit and evidence-history state.
- Added validated API/browser presentation for the operator review core.
- Added post-seal external review-index generator binding final archive + sidecar identity.
- Explicitly avoids archive self-hash cycles.
- Missing cryptographic parent lineage remains `not-recorded`; no ancestry is synthesized.

Verification: focused review-index 13/13 PASS; dependency-free regression 308/308 PASS; global check PASS.

No chain promotion is claimed.
