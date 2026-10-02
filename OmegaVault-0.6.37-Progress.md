# OmegaVault 0.6.37-dev — Evidence history diagnostics

Archive SHA-256: `03040039da58c5d061f2dfd9656effc9b8653b37b6fb857a439ba4c93c018735`
Sidecar file SHA-256: `f47a2456aebd9282e46f8201b260202978063a55a3945aefae58ed59f85dbf36`
Manifest logical SHA-256: `6a133d5e5f158e413a87a3e63643d69e30fa6add8e8c0c4d7c0ee89d1c6450a5`
Source-tree SHA-256: `c4ae37c161cc021654a38fa04160d43cc7cc8b6b290a09d2e6e2514edbcad47a`
Dependency-lock binding SHA-256: `eae5be084c1cd83bca9288bd776e251b5737ec3b6ec6d53ed23b85b698b34e5e`

## Concrete changes

- Evidence checkpoint history grouped from validated provenance records.
- Explicit timeline-order semantics that do not claim source ancestry.
- Versioned validated `/api/evidence-history` endpoint.
- Browser history search, chain filtering and newest/oldest ordering.
- History data contains no promotion-eligibility field and cannot alter maturity.

## Verification

- Focused history stack: 17/17 PASS.
- Dependency-free regression: 265/265 PASS.
- Global project check: PASS.
- Deterministic archive rebuild: PASS.
- Fresh-extraction sidecar verification: PASS.
- Nine known SDK/toolchain-bound files remain workstation-gated.

No chain promotion is claimed.
