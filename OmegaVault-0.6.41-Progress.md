# OmegaVault 0.6.41-dev — External review receipts

- Added unsigned external-review receipts bound to exact review-index SHA-256.
- Added outcomes: verified / verified-with-notes / rejected.
- Added optional detached Ed25519 signature objects.
- Signatures authenticate receipts only and have no chain-promotion authority.
- Normal CLI creates unsigned receipts and never persists signing keys.

Verification: focused 6/6 PASS; dependency-free 313/313 PASS; global check PASS.

No chain promotion is claimed.
