# OmegaVault 0.6.42-dev — Reviewer trust separation

## Concrete changes

- Added detached-signature file verification through `npm run review:receipt:verify`.
- The verifier reads a receipt, detached signature and reviewer-controlled public key without creating or persisting a private key.
- Added digest-bound `omegavault.reviewer-key-trust.v1` metadata with explicit `trusted`, `untrusted` and `revoked` states.
- Reviewer identity, key fingerprint, trust-policy authority and canonical configuration time are bound independently from the receipt signature.
- A valid signature without matching trust configuration is reported as `authenticated-untrusted`.
- `--require-trusted-reviewer` fails closed unless signature authentication, reviewer identity and the configured trusted key all match.
- Receipt signatures and trust metadata continue to carry no chain- or evidence-promotion authority.

## Verification

- Focused receipt/signature/trust/CLI slice: **11/11 PASS**.
- Broad dependency-free regression: **318/318 PASS**.
- Full suite without installed dependencies: **318 PASS / 9 known workstation-gated files**.
- Global syntax and pinned artifact checks: **PASS**.

## Boundary

No reviewer private key was created, stored or requested. Tests use ephemeral Ed25519 keys only. No chain maturity or promotion state changed.

## Next offline task

Bind reviewer-trust policy provenance and key-rotation/revocation history so trust changes are auditable without converting trust metadata into chain evidence.
