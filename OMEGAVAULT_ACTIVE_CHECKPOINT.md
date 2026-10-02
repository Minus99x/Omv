# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.23-dev**

Archive: `omegavault-mvp-0.6.23-dev.zip`
SHA-256: `e2a96a522d3f921194f144b4b87276b540bf72bfb2da6bb2a48f6da3ff0f3e88`

## 0.6.23 delta

- Hardened the Bitcoin reduced-semantics recovery lane from signature verification toward deterministic transaction extraction.
- Added a strict PSBTv2 recovery finalizer that requires the exact configured P2WSH descriptor/witness script on every input.
- Every recovery input must encode the configured block-based CSV delay and meet the configured distinct-contact threshold.
- Unauthorized/owner partial signers are rejected from the delayed recovery finalization path.
- OmegaVault finalization requires exactly one caller-confirmed rescue output and an exact caller-confirmed fee.
- The finalizer constructs the delayed recovery witness stack, raw SegWit transaction bytes, txid, wtxid, weight and vsize.
- Expanded the project-wide syntax gate so Bitcoin descriptor and PSBT execution modules are no longer skipped.
- Bitcoin remains reduced semantics: the OmegaVault-produced transaction is output-bound, but ordinary CSV + multisig Script still cannot covenant every alternative future spend to the rescue address.

## Verification

- `npm run check`: **passed**, including `src/chains/bitcoin/descriptor.js` and `src/chains/bitcoin/psbt-v2.js`.
- Executable Bitcoin recovery-policy + finalizer structural suite: **11/11 passed**.
- The full cryptographic descriptor/PSBT/finalizer test file is present but could not run in this fresh extraction because pinned `@noble/curves` 2.4.0 is absent.
- No full cryptographic finalizer runtime proof, Bitcoin Core extraction cross-check, Signet broadcast or public-network recovery proof is claimed in this checkpoint.

## Source of truth

The complete 0.6.23-dev archive is stored in the ChatGPT file Library under the exact filename and checksum above. Do not reconstruct the current source from the older tree on `main`.

## Next offline gate

Do not wait on the missing Node dependency. Continue Cardano evaluation preparation or Stellar/TRON execution hardening. Revisit Bitcoin when the pinned dependencies are available, then run the full cryptographic finalizer suite and cross-check the extracted raw transaction with Bitcoin Core before any Signet proof.

## Safety boundary

Do not write directly to `main`. Do not perform production deployments, wallet signatures, production-value transfers, or claim live proof until the corresponding promotion gates pass.
