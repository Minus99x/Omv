# OmegaVault 0.6.40-dev — External review index

The external review index is intentionally generated after the checkpoint ZIP and checkpoint sidecar exist.

It binds:
- exact archive filename + SHA-256,
- checkpoint-sidecar file SHA-256 + logical manifest SHA-256,
- source-tree SHA-256,
- dependency-lock SHA-256,
- provenance audit SHA-256,
- evidence-history SHA-256,
- evidence-provenance SHA-256,
- explicit review/lineage authority semantics.

No archive self-hash is embedded inside the archive. No source ancestry is inferred from version order.

Verification: focused 12/12 PASS; dependency-free regression 307/307 PASS; global check PASS.

No chain promotion is claimed.
