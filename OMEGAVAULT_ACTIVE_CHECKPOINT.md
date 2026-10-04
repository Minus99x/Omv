# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.49-dev**

Archive filename: `omegavault-mvp-0.6.49-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.49-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.49-dev.review-index.json`

## 0.6.49 delta

- Carried forward the sealed 0.6.48 publisher-trust, review/audit and operator-audit hardening.
- Added exact Stellar signed-recovery-envelope verification.
- Added deterministic Stellar recovery execution evidence with account preflight, submission-result and finality binding.
- Recovered the strict Bitcoin PSBTv2 recovery finalizer from the checksum-verified 0.6.23 archive.
- Executed the previously dependency-blocked Bitcoin cryptographic finalizer tests under the pinned Noble toolchain.
- Added deterministic, tamper-detectable Bitcoin finalizer execution evidence.
- Added focused Stellar and Bitcoin recovery verification lanes.
- Added a deterministic checkpoint-candidate workflow that generates the source ZIP outside the hashed tree, then generates and verifies the checkpoint manifest and external review index.

## Verification

Clean dependency-backed verification for the 0.6.49 source checkpoint:

- Pinned dependency install with `npm ci`: **passed**.
- Focused review/audit suite: **84/84 passed**.
- Focused Stellar recovery suite: **20/20 passed**.
- Focused Bitcoin recovery suite: **22/22 passed**.
- Full test suite: **432/432 passed**.
- Offline-resume verification: **ok: true**.
- Global `npm run check`: **passed**.
- Deterministic source archive generation: **passed**.
- Checkpoint manifest generation: **passed**.
- External review index generation and verification: **passed**.
- Independent extracted-source verification reproduced the source-tree inventory and review-index result.

## Promotion boundary

No connector is newly promoted by this checkpoint.

Stellar execution evidence does not authorize signing, submission, deployment, wallet authority or connector promotion. Bitcoin remains reduced-semantics: OmegaVault can bind the recovery transaction it finalizes to the caller-confirmed rescue output, but ordinary Bitcoin Script does not provide an immutable-rescue covenant. No Bitcoin Signet broadcast or live-value recovery proof is claimed.

## Next safe gate

Continue from a new post-0.6.49 development branch. Select the next chain-specific execution gap from the existing maturity/capability evidence rather than changing the sealed 0.6.49 source checkpoint.

## Safety boundary

Never modify `main` directly or perform production deployments, live-value transactions, wallet signatures, secret handling or irreversible external actions from this development queue.
