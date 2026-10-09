# Solana rebuild/provenance recovery plan — 0.6.60

Status: remote preparation while Cardano waits for workstation execution.

## Why Solana is parked

The Solana program source is substantial and the offline semantic model is not the blocker. The blocker is artifact provenance.

Historical build evidence binds:

- rustc 1.98.1
- cargo 1.98.1
- Agave CLI 4.3.0
- cargo-build-sbf 4.3.0
- platform-tools 1.57
- solana-program 5.1.0
- solana-system-interface 3.3.0
- solana-program-test 4.3.0
- historical artifact SHA-256 `e140b5235505df36f727051adf880f78b8ff7168b4e0269fc2071d4d7f24804e`
- historical artifact size 92120 bytes.

The repository currently contains an SBF artifact with SHA-256 `99ec272746b35162efc8ba28ab8acd1fad7edf8d65edfdf7825a8c6ae559c405` and size 90059 bytes.

Because those identities differ, the repository correctly records the artifact as `stale-untrusted` rather than pretending the old execution evidence applies to the current bytes.

## Invariant-first rule

No Solana redesign is required merely because the artifact is stale.

The current program already models the OmegaVault chain-native objectives through program-owned state/custody PDAs, immutable rescue configuration, owner heartbeat, inactivity-gated trusted-contact approvals, threshold execution and full protected-value movement.

The recovery task is therefore:

`current source -> pinned toolchain -> rebuilt SBF -> program-test -> new artifact evidence -> Devnet execution evidence`

not:

`rewrite the Solana implementation`.

## Remote preparation completed/available

The repository already has:

- current Rust source under `validators/solana/src/lib.rs`;
- retained Cargo.toml and Cargo.lock;
- native program-test source under `validators/solana/tests/native_recovery.rs`;
- client codec binding;
- source verification script;
- RPC evidence machinery for blockhash freshness, simulation, fee quote, account/instruction roster and finality observations;
- explicit fail-closed Token/Token-2022 handling.

## Required rebuild gate

A new Solana artifact may become trusted only if all of the following are captured together:

1. Exact Git/source checkpoint.
2. Exact Rust, Cargo, Agave, cargo-build-sbf and platform-tools versions.
3. SHA-256 of Rust source, Cargo.toml, Cargo.lock, client codec and program-test source.
4. Successful `cargo build-sbf` from that exact source/toolchain.
5. SHA-256 and byte length of the rebuilt `.so`.
6. SBF program-test loading that exact `.so` rather than a native host substitute.
7. Passing initialize, heartbeat, approval and execute-native lifecycle tests.
8. Passing adversarial gates for inactivity, unknown contact, threshold, wrong rescue, heartbeat approval reset and post-recovery lockout.
9. Fresh generated evidence replacing the historical artifact identity rather than editing history in place.

## Devnet gate after rebuild

Rebuilding does not promote Solana.

After the artifact is trusted, Devnet evidence still has to prove:

- program deployment identity;
- exact program/account roster;
- state PDA and custody PDA creation/ownership;
- owner heartbeat;
- independent contact approval;
- threshold recovery;
- immutable rescue destination;
- protected SOL movement;
- token recovery only for explicitly supported Token/Token-2022 semantics;
- transaction confirmation/finality under the Solana evidence policy;
- rescue balance/state read-back.

Wallet signing, deployment, Devnet submission and support promotion remain separate explicit authority gates.

## Workstation/tooling note

The last known workstation preflight did not have the required Rust/Solana toolchain available. That is not a design failure. The rebuild can be scheduled once an appropriate pinned environment is available, while Cardano and XRPL remote work proceed independently.

## Deterministic replacement evidence

`src/chains/solana/artifact-build-evidence.js` now defines the replacement evidence envelope for a future rebuild.

It requires the exact source Git commit, all source/config/test digests, the pinned toolchain versions, rebuilt artifact SHA-256/byte length, and an SBF program-test run that loads that exact compiled artifact and covers initialize/heartbeat/approve/execute-native with zero failures.

Even a trusted rebuilt artifact keeps `devnetDeploymentProven`, `liveSubmissionReady`, `publicNetworkRecoveryProven`, and `supportClaimAuthorized` false. Rebuild provenance restores artifact trust only; it does not collapse the later Devnet authority gates.
