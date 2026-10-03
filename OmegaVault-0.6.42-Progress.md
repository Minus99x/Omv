# OmegaVault 0.6.42-dev — Human-readable review receipt

- Added deterministic receipt derived only from the review-bundle descriptor.
- Receipt includes all external file SHA-256 values and cross-binding digests.
- Receipt is byte-verifiable against the descriptor.
- Signature and reviewer-attestation fields explicitly remain `not-recorded`.

Verification: focused receipt 5/5 PASS; dependency-free regression 318/318 PASS; global check PASS.

No chain promotion is claimed.
