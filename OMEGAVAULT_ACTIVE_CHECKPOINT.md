# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.42-dev**

Archive filename: `omegavault-mvp-0.6.42-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.42-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.42-dev.review-index.json`

## 0.6.42 delta

- Added `npm run review:receipt:verify` for detached receipt-signature file verification.
- Added digest-bound `omegavault.reviewer-key-trust.v1` metadata with `trusted`, `untrusted` and `revoked` states.
- Cryptographic signature authentication is reported independently from reviewer identity and trust.
- A valid signature without separate matching trust configuration is explicitly `authenticated-untrusted`.
- Trusted-reviewer enforcement requires the receipt reviewer label, authenticated SPKI fingerprint and separately configured trusted record to match.
- Wrong keys, wrong reviewer identities, revoked keys and tampered trust authority fail closed.
- Signature and trust objects retain zero chain- or evidence-promotion authority.
- Normal tooling creates and persists no reviewer private keys; tests use ephemeral Ed25519 keys only.

## Verification

- Focused receipt/signature/trust/CLI slice: **11/11 passed**.
- Broad dependency-free offline regression: **318/318 passed**.
- `npm run check`: **passed**.
- Full suite: **318 passed / 9 known workstation-gated files failed to load**.

## Promotion boundary

No chain is newly promoted. Cryptographic authentication and configured reviewer trust remain audit metadata only and cannot satisfy chain promotion gates.

## Next offline gate

Add provenance-bound reviewer trust-policy history, including explicit key rotation and revocation lineage, without converting reviewer trust into chain evidence.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
