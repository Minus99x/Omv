# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.43-dev**

Archive filename: `omegavault-mvp-0.6.43-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.43-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.43-dev.review-index.json`

## 0.6.43 delta

- Added digest-linked reviewer enrollment, rotation and terminal revocation events.
- Rotation binds the preceding event SHA-256 and preceding SPKI fingerprint; only the current key may confer trust.
- Added policy snapshots binding event count and head digest to reject valid-prefix rollback.
- Extended receipt verification with trust-history and snapshot enforcement.
- Added public-key-only trust-history append tooling with fail-closed output overwrite protection.
- Trust events and snapshots retain zero chain- or evidence-promotion authority.
- Normal tooling creates, reads and persists no reviewer private keys; tests use ephemeral Ed25519 keys only.

## Verification

- Focused receipt/signature/trust-history/CLI slice: **20/20 passed**.
- Broad dependency-free offline regression: **327/327 passed**.
- `npm run check`: **passed**; new trust-history core and CLIs also passed explicit syntax checks.
- Full suite: **327 passed / 9 known workstation-gated files failed to load**.

## Promotion boundary

No chain is newly promoted. Cryptographic authentication and reviewer trust history remain audit metadata only and cannot satisfy chain promotion gates.

## Next offline gate

Bind the reviewer trust-policy snapshot into an independently anchored audit index or policy registry.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
