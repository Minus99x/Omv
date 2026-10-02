# OmegaVault 0.6.38-dev — Provenance health & evidence-gap diagnostics

Archive SHA-256: `94fcdfbb507eb4c5b2f34db53b60caf68b863db20326ba329c6f9a3650bee5bc`
Sidecar file SHA-256: `1cee5f14f11ed43ecc6a25967e32ff591c3a6585022fca84e0ce3e0ac58e6c44`
Manifest logical SHA-256: `afdd8542c827a7f4f234f0dcc7140d4b6a83ac74e009959f700c0b4afd1d0f24`
Source-tree SHA-256: `7a1d37ade23bade2b1e50f6539283d30e71d92d44177bbaeede9c4bb5bcac742`
Dependency-lock binding SHA-256: `9512a85637479430ae8c1cbd8cc606d2d258a78998a34a540164cdb51ad2e043`

## Concrete changes

- Per-chain provenance-health diagnostics.
- Evidence-gap summaries for missing gates, insufficient evidence and blockers.
- Explicit cryptographic-lineage coverage separate from timeline order.
- Forged lineage refs rejected unless backed by a real parent-bundle SHA-256 in provenance.
- Versioned `/api/evidence-diagnostics` endpoint.
- Browser diagnostics filters and gap-first sorting.

## Verification

- Focused diagnostics: 15/15 PASS.
- Dependency-free regression: 280/280 PASS.
- Global check: PASS.
- Deterministic archive rebuild: PASS.
- Fresh-extraction sidecar verification: PASS.
- Nine known SDK/toolchain-bound files remain workstation-gated.

No chain promotion is claimed.
