# OmegaVault 0.6.42-dev — Reviewer key trust

Detached signature verification and reviewer trust are separate decisions:

- `signatureAuthenticated` means the supplied Ed25519 public key verifies the signature over the exact receipt SHA-256.
- `reviewerTrusted` requires valid, separately configured `omegavault.reviewer-key-trust.v1` metadata matching both the receipt reviewer label and authenticated SPKI fingerprint.
- A valid signature with no trust configuration is `authenticated-untrusted`.
- `untrusted`, `revoked`, wrong-identity, wrong-key and tampered trust records cannot confer reviewer trust.
- Neither authentication nor trust can promote a chain or evidence record.

Verification: focused 11/11 PASS; dependency-free 318/318 PASS; global check PASS.

No private key is created or persisted by the CLI. Test keys are ephemeral.
