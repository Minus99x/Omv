# OmegaVault 0.6.40-dev — External review index

- Added deterministic internal review basis for provenance audit, evidence history and evidence provenance.
- Added validated `/api/review-basis` response.
- Added external review index generated after ZIP + checkpoint sidecar creation.
- External index binds archive/sidecar/source/dependency/audit/history/provenance identities without archive self-reference.
- Added independent generation and verification CLIs.
- Swapped archive, altered sidecar, stale basis and tampered index fail closed.

Verification: focused 12/12 PASS; dependency-free regression 307/307 PASS; global check PASS.

No chain promotion is claimed.
