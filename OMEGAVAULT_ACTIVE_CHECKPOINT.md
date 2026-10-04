# OmegaVault Active Checkpoint

Sealed distributable checkpoint: **0.6.48-dev**

Sealed checkpoint commit: `eae5ea2cdff33c4b86978fa34f7349504bc1ff49`

Archive filename: `omegavault-mvp-0.6.48-dev.zip`  
Checkpoint sidecar filename: `omegavault-mvp-0.6.48-dev.checkpoint-manifest.json`  
External review index filename: `omegavault-mvp-0.6.48-dev.review-index.json`

## Development continuation

The active development branch `dev/0.6.41-review-receipts` now contains post-seal multichain execution-evidence work. This continuation does **not** replace the sealed 0.6.48 archive identity until package/lock/checkpoint artifacts are regenerated coherently and an exact-head clean verification passes.

The connector write guard prevented an atomic `package-lock.json` version bump during an attempted next-version checkpoint. The premature package-version bump was reverted instead of weakening dependency-lock verification. The current package and lock therefore remain coherently labeled `0.6.48-dev` while the post-seal development work is verified.

## Post-seal completed implementation

### Stellar

- Pinned Stellar SDK dependency restored and verified.
- Native recovery XDR round-trip and exact contact-signature verification.
- Owner heartbeat XDR/signature verification.
- Fee-bump inner/outer transaction binding.
- Strict Testnet identity and exact result-code checks.
- Digest-bound successful Testnet-recovery evidence contract.
- Digest-bound failed-applied recovery evidence proving one-time `preAuthTx` signer consumption and forbidding same-envelope retry.
- Execution-input manifest, recovery runner, Horizon proof driver, fail-closed Horizon HTTP transport and end-to-end injected-driver integration.

Stellar remains `offline-verified`. Real public Testnet execution evidence is still required.

### Bitcoin

- Signet-only offline PSBTv2 finalizer-evidence gate for canonical/frozen maps, CSV, descriptor binding, contact threshold, rescue output and fee accounting.
- Read-only Signet observation evidence for confirmation depth and exact rescue UTXO.
- Explicit preservation of `immutableRescueOnChain: false`, `broadcastAuthorized: false` and no chain-promotion authority.

Bitcoin remains `reduced-semantics`. Real Signet observation, final signed-transaction/Bitcoin Core cross-check and the immutable-rescue semantic limitation remain.

### TRON / EVM / cross-chain

- Dedicated TRON TRX/TRC-20 recovery-runner regression coverage.
- Generic EVM native runner now rejects duplicate/unreachable approval policy and checks exact rescue-balance movement.
- Focused XRPL, Solana, TRON, Cardano and EVM suites are included in the multichain offline verification matrix.
- Catalog-wide promotion-boundary tests reject accidental promotion and prevent offline evidence from satisfying public-testnet-required gates.
- Obsolete Stellar/Bitcoin dependency blockers were removed without changing promotion status.

## Verification boundary

A previously clean intermediate post-seal head proved:

- review/audit: **84/84**
- Stellar-focused: **96/96**
- Bitcoin-focused: **19/19**
- full suite: **481/481**
- offline-resume: **26/26**
- global checks: **5/5**
- overall offline-resume status: **ok: true**

The current accumulated head adds further Signet observation, TRON/EVM hardening, multichain verification and documentation. It must complete its own clean exact-head run before being called a verified development checkpoint.

## Genuine remaining gates

- Stellar: actual public Testnet execution.
- Bitcoin: actual Signet execution/observation, final signed-transaction/Bitcoin Core cross-check, immutable-rescue semantics.
- TRON: fresh Shasta deployment/recovery evidence.
- Cardano: Preprod execution evidence; the clean multichain matrix determines whether the old local Aiken-toolchain portion of the blocker is still real.
- Solana: Rust/Agave rebuild and Devnet execution evidence.
- XDC and EVM compatibility chains: fresh network-specific public-testnet recovery/finality evidence.
- XRPL: exact inactivity + immutable-rescue semantics remain protocol-limited under the current native approach.

## Safety and authority boundary

No post-seal work authorizes production deployment, mainnet/live-value transactions, wallet signatures, secret handling, chain promotion, deployment authority or wallet authority. No connector is promoted by audit metadata or offline fixture evidence.


## Solana artifact integrity finding

The cross-chain verification matrix surfaced a pre-existing mismatch between the checked-in Solana SBF binary and its historical 0.6.17 build-evidence digest. The source/Cargo/client/test bindings still match their historical evidence, but the repository binary hashes to `99ec272746b35162efc8ba28ab8acd1fad7edf8d65edfdf7825a8c6ae559c405` while the historical evidence claims `e140b5235505df36f727051adf880f78b8ff7168b4e0269fc2071d4d7f24804e`.

The binary has been marked `stale-untrusted`; its current bytes are **not** relabeled as a verified build. Solana remains parked until a pinned Rust/Agave/cargo-build-sbf toolchain rebuilds the current source, reruns SBF program-test and regenerates exact artifact evidence.
