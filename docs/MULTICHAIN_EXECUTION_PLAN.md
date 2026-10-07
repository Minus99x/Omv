# OmegaVault Multi-Chain Execution Plan — 0.6.16 development

This is the active build queue. Work is performed offline first; wallet signatures are deferred until a connector has exhausted everything that can be built and tested without them.

## Rules

1. Preserve the completed Ethereum Sepolia 0.4.3 proof and evidence unchanged.
2. No connector is called `live-proof` until every promotion gate is satisfied on a public test network.
3. Chain-native semantics win over superficial API similarity.
4. Never ask for or store a seed phrase/private key.
5. Separate **authorization signer** from **fee payer** wherever the chain permits it.
6. Asset identity is chain + network + exact asset reference; symbols are display metadata only.
7. Evidence records mechanism identity, network identity, transaction references, finality observations, policy-critical state and final destination state.
8. A native primitive that only approximates OmegaVault semantics must be labeled as such; do not silently weaken inactivity or immutable-rescue guarantees.

## Phase 0 — common infrastructure [OFFLINE BASE COMPLETE]

- [x] Chain-neutral recovery policy model.
- [x] Chain adapter contract/registry.
- [x] Network-scoped asset identity.
- [x] Signer / fee-payer action-plan separation.
- [x] Digest-bound evidence records.
- [x] Promotion-gate model.
- [x] Network registry for first EVM and non-EVM proof environments.
- [x] Common transaction-preflight result schema with canonical intent digest.
- [x] Common finality evidence schema.
- [x] Common fee estimate/actual fee evidence schema.
- [x] Common public-state verification interface with independent-source comparison.
- [x] Shared recovery simulator fixtures for happy path, duplicate vote and heartbeat reset.

## Phase 1 — EVM portability harness [OFFLINE HARNESS COMPLETE]

Targets: XDC Apothem, Base Sepolia, Arbitrum Sepolia, OP Sepolia, Polygon Amoy, BSC Testnet, Avalanche Fuji C-Chain.

- [x] Network profiles and independent chain IDs.
- [x] Distinct adapters sharing an EVM-family implementation contract.
- [x] EVM family token/address normalization.
- [x] Offline RPC capability-probe plan and chain-ID preflight.
- [x] Deterministic deployment verification harness with immutable-byte masking.
- [x] Network-specific compatibility-report aggregator.
- [x] Native-asset recovery test runner against custody-free drivers.
- [x] ERC-20 recovery test runner against custody-free drivers.
- [x] Finality policy per first-wave network; rollups distinguish L2 state from parent-chain finality.
- [ ] Execute live RPC probes and store compatibility observations.
- [ ] Only after clean probes: schedule wallet signatures/deployments.

## Phase 2 — Stellar native recovery [OFFLINE ENVELOPE COMPLETE]

- [x] Stellar adapter + Testnet network identity/passphrase.
- [x] Future-safe sequence-number strategy.
- [x] Heartbeat modeled as source-account sequence-age reset.
- [x] Pre-authorized recovery envelope with immutable declared rescue operations.
- [x] Exact contact authorization uses transaction `extraSigners`; contacts are not account signers and cannot authorize arbitrary account transactions.
- [x] Explicit native scope: N-of-N with one or two contacts. Broader M-of-N routes to Soroban because the protocol permits at most two extra signers.
- [x] Fee-bump sponsor plan separating submitter fees from recovery authorization.
- [x] Classic-asset/trustline preflight.
- [x] Reserve-impact calculator for signer/trustline additions and sponsorship.
- [x] Document bounded-asset limitation: a preauthorized envelope only covers assets/amounts encoded into it.
- [x] Complete adversarial envelope tests for invalid checksums, duplicate contacts, unsupported M-of-N, exact signer count, signer removal/policy drift and applied-failure preAuthTx consumption.
- [x] Construct exact XDR with pinned `@stellar/stellar-sdk` 17.1.0, round-trip it and bind a deterministic hash fixture to the local intent model.
- [x] Recheck the native design against current Stellar transaction/precondition, multisig, fee-bump and CAP-28 one-time-signer semantics.
- [ ] Testnet live proof and evidence export.

## Phase 3 — TRON [TVM OFFLINE CORE COMPLETE; SHASTA PROOF PENDING]

- [x] TRON adapter + Shasta network scaffold.
- [x] AccountPermissionUpdate plan.
- [x] Permission validator covering key limits, weight/quorum reachability and operations bitmap.
- [x] Native multisign coordinator rejecting unknown/duplicate signers.
- [x] Dynamic Energy/Bandwidth and permission/multisig fee-query plan; governance-adjustable values are not hardcoded.
- [x] Select TVM vault as the exact-semantics product path; retain native permissions only as an explicitly reduced-semantics threshold mode.
- [x] Implement inactivity + threshold + immutable-rescue TVM vault with O(1) heartbeat approval reset and guarded TRX/TRC-20 recovery.
- [x] Pin and compile with TRON Solidity 0.8.31 via TronBox 4.11.0; preserve standard JSON input/output, artifact and SHA-256 manifest.
- [x] Implement Base58Check/`0x41` address normalization, Shasta deployment/call plans, immutable-aware runtime verifier and required-ABI/config verification.
- [x] Implement TRX/TRC-20 proof runners that require deployment verification, current Energy/resource preflight and successful solidification for every state change.
- [x] Add offline adversarial coverage for invalid checksum, fee-limit refusal, bytecode tampering, unverified deployments, unsolidified calls and token-balance conservation.
- [ ] Shasta live proof and evidence export.

## Phase 4 — XRP Ledger [CANONICAL OFFLINE CODEC COMPLETE; RESETTABLE-INACTIVITY GAP REMAINS]

- [x] XRPL adapter + Testnet endpoint scaffold.
- [x] SignerList plan.
- [x] SignerListSet serializer/validator: 1-32 unique non-owner signers, UInt16 weights, reachable UInt32 quorum.
- [x] Multisign coordinator with signer membership/quorum checks, multisign fee multiplier and Sequence/Ticket rules.
- [x] Ticket transaction binding (`Sequence=0` + `TicketSequence`; no AccountTxnID).
- [x] XRP Escrow plan with immutable destination and absolute `FinishAfter` gate.
- [x] Fungible-token Escrow model for trust-line tokens/MPTs, gated by live `TokenEscrow` amendment capability rather than assumed support.
- [x] EscrowFinish plan and validated-ledger evidence requirements.
- [x] Correct semantic label: `FinishAfter` is an absolute not-before time, **not** resettable owner inactivity.
- [x] Explicitly product-scope the resettable-inactivity gap: native XRPL fixed-time escrow and signer quorum are supported modes, but neither may be advertised as resettable inactivity recovery.
- [x] Pin xrpl.js 4.6.0 and verify signer-specific multisigning preimages, public-key/account binding and signatures before canonical binary combination.
- [x] Enforce canonical numeric AccountID signer ordering, empty top-level `SigningPubKey`, absent top-level `TxnSignature`, exact binary round-trip and deterministic transaction-hash evidence.
- [ ] Testnet proof only after the semantic scope is explicitly resolved.

## Phase 5 — Solana [NATIVE SBF/PROGRAM-TEST VERIFIED; TOKEN EXECUTION PENDING]

- [x] Solana adapter + Devnet network scaffold.
- [x] PDA state/custody derivation plan; no PDA private key assumption; enforce the protocol 32-byte maximum for each seed component.
- [x] Offline versioned vault-state model with owner, immutable rescue, contacts, threshold, liveness, approvals and recovered state.
- [x] Offline heartbeat/approval/execution invariant tests including duplicate prevention and heartbeat reset.
- [x] Explicit Token Program vs Token-2022 asset identity and token-account preflight, including account-kind and expected authority checks so mint accounts/wrong authorities fail closed.
- [x] Recent-blockhash and durable-nonce transaction lifetime plans; fee payer fixed before signatures.
- [x] Program deployment verification plan including bytecode/build provenance and upgrade-authority policy.
- [x] Select and install Agave CLI 4.3.0 with Rust 1.98.1; pin `solana-program` 5.1.0 plus `solana-system-interface` 3.3.0 and retain the Cargo lockfile.
- [x] Implement native Rust source for initialization, owner heartbeat, contact approval and native SOL execution with canonical PDA ownership, signer/writable checks, immutable rescue and exact state layout.
- [x] Add an independently pinned JavaScript client codec for canonical PDA derivation, instruction bytes/account metas and deterministic non-deployable evidence.
- [x] Format and compile the SBF program; bind the 90 KiB artifact, source, manifest, lockfile, client codec and program-test hashes to versioned evidence.
- [x] Execute the compiled SBF artifact under Agave 4.3.0 `solana-program-test`, proving initialization, heartbeat, inactivity, contact membership, threshold, immutable rescue, native SOL lamport movement and post-recovery lockout.
- [ ] SPL Token + Token-2022 recovery, ATA creation/funding policy, extension-aware adversarial tests.
- [x] Add deterministic legacy and v0 JSON-RPC request/response fixtures that bind the frozen message intent and exact serialized transaction/message digests to confirmed blockhash validity, block-height expiry, simulation, fee, rent and payer-balance observations, then require finalized ATA-creation status and a finalized exact-owner/space/base64 refetch. Decode and bind the exact ordered compiled-instruction roster (static program ID, account indexes and data bytes) plus every account public key and header/lookup-derived signer-writable privilege so instruction, account and privilege drift fail closed.
- [ ] Compute budget, rent, blockhash-expiry and finalized-commitment integration tests.
- [ ] Devnet live proof and evidence export.

## Phase 6 — Bitcoin [OFFLINE DESCRIPTOR/PSBTV2 COMPLETE; SIGNET PROOF PENDING]

- [x] Bitcoin adapter + Signet scaffold.
- [x] Owner-immediate + CSV-delayed M-of-N recovery policy model.
- [x] Liveness modeled as confirmed UTXO rollover/refresh, not an account heartbeat.
- [x] PSBTv2 recovery intent model with outputs non-modifiable and `SIGHASH_ALL` signer expectations.
- [x] Threshold signature coordinator bound to a canonical recovery intent digest.
- [x] RBF/CPFP fee-strategy model and warning that fee mutations may invalidate collected signatures.
- [x] Rescue-enforcement assessment: ordinary key+CSV scripts authorize spends but cannot force every valid delayed spend to one immutable output.
- [x] Pre-signed PSBT conclusion: it protects the specific signed intent but does not stop threshold key holders from constructing another valid delayed spend.
- [x] Product scope decision: support delayed-threshold recovery only as reduced semantics with signer-verified rescue intent; do not claim immutable-rescue enforcement.
- [x] Compile `wsh(or_d(pk(owner),and_v(v:older(delay),multi(threshold,contacts...))))`, validate its checksum/script/address with Bitcoin Core 31.1 on Signet, and retain machine-readable evidence.
- [x] Import into a descriptor wallet with private keys disabled; verify solvability and exact script/address, then verify backup/unload/restore preserves the descriptor.
- [x] Encode/decode canonical BIP 370 PSBTv2 with required outpoint, sequence, witness UTXO, witness script, amount and output fields.
- [x] Freeze inputs/outputs before signature collection and verify strict-DER, low-S, SIGHASH_ALL contact signatures against the exact BIP 143 digest and threshold.
- [x] Deterministically extract the canonical delayed-recovery SegWit transaction from frozen PSBTv2 fields, order CHECKMULTISIG signatures by script key order, and bind raw bytes, txid, wtxid, weight and vsize without broadcast authority.
- [x] Add a read-only pinned-version Bitcoin Core cross-check contract that binds the exact extracted raw transaction to `decoderawtransaction` and one non-broadcast `testmempoolaccept` result, with adversarial substitution coverage and no signing/broadcast authority.
- [x] Add a deterministic JSON import/verification CLI that cannot elevate imported observations to authenticated RPC evidence, rejects secret-bearing arguments, and refuses output overwrite.
- [ ] Execute that cross-check against an actual pinned Bitcoin Core runtime and retain the node/version/result evidence; offline injected-driver fixtures do not satisfy this gate.
- [ ] Signet live proof only after rescue semantics are explicitly scoped.

## Phase 7 — Cardano [SIGNED-SIZE/EVALUATION GATE COMPLETE; INDEPENDENT NODE EVALUATION PENDING]

- [x] Cardano adapter + Preprod scaffold.
- [x] Native-script assessment: signatures/timelocks alone cannot inspect outputs or update recovery state, so native scripts are insufficient for exact OmegaVault semantics.
- [x] Select Plutus/Aiken spending-validator path for exact rescue/state semantics.
- [x] Offline datum/state model with owner, immutable rescue, contacts, threshold, inactivity, approvals and a state-beacon asset.
- [x] Offline heartbeat transition: owner-only, clears approvals, preserves protected value and one state beacon.
- [x] Offline approval transition: inactivity-gated, trusted-contact-only, preserves protected value.
- [x] Offline execute transition: threshold + inactivity and full protected value sent to immutable rescue address.
- [x] Fee/collateral preflight rule: use external inputs so protected vault value is not silently consumed for fees.
- [x] Pin Aiken 1.1.24, stdlib 4.0.0 and Plutus V3 in the package toolchain.
- [x] Implement and compile the executable spending validator and one-shot state-beacon policy; generate and verify the CIP-57 blueprint.
- [x] Resolve beacon lifecycle: seed-UTxO-gated `+1` initialization; exact `-1` burn during successful recovery; no continuing beacon output.
- [x] Implement the CIP-55 minimum-ADA formula as a calculator parameterized by current `coinsPerUTxOByte`; refuse a hardcoded Preprod parameter assumption.
- [x] Apply deterministic synthetic fixture parameters, independently derive the resulting script hashes/Preprod enterprise addresses, and bind both applied blueprints to SHA-256 evidence. The synthetic seed is explicitly non-deployable.
- [x] Build and byte-exact round-trip initialization, heartbeat, approval and execute Conway transaction-body CBOR with pinned Cardano Serialization Lib 17.0.0.
- [ ] Select a real Preprod seed UTxO and regenerate deployment-specific policy/address evidence only after all other offline transaction gates pass.
- [x] Capture a provenance-bound current Preprod epoch-316 parameter snapshot and validate the complete 350-entry Plutus V3 cost model.
- [x] Add exact-rational execution-fee, linear-fee and ceiling-collateral calculations with current limits and ADA-only collateral enforcement.
- [x] Build exact fixture redeemers, script-data hashes and Plutus V3 witness sets for initialize/heartbeat/approve/execute; byte-exact round-trip the resulting unsigned transactions.
- [x] Fail closed for live construction because the full cost model currently has only one machine-readable source and execution budgets are Aiken fixture measurements rather than node evaluation.
- [x] Add deterministic synthetic key witnesses for exact signed-size/fee convergence, including the distinct two-witness approval path.
- [x] Verify serialized output minimum-ADA floors and declared collateral against the current parameter snapshot.
- [x] Construct zero-budget Ogmios evaluation candidates and bind exact transaction-body hashes/redeemer pointers to evidence.
- [x] Reject incomplete, duplicate, unexpected, zero or over-cap Ogmios budgets; apply an exact ceiling 10% margin.
- [x] Keep Ogmios evaluation separate from phase-1 validation and require one acquired tip across UTxOs, parameters and evaluation.
- [ ] Independently confirm the full cost model and evaluate exact transactions through a synchronized Preprod node/Ogmios endpoint.
- [ ] Replace Aiken fixture budgets with accepted node evaluation results, rerun final convergence/phase-1 validation, then select the real seed UTxO.
- [ ] Preprod live proof and evidence export.

## Live-test trigger

A chain reaches the user-signature phase only when all offline work possible for that mechanism is complete: network profile, address/key validators, action builder, serializer/compiler, preflight, local unit/adversarial tests, evidence schema, finality rules and a written expected transaction sequence.

At that point user involvement should be limited to wallet authorization/signature prompts and chain-specific test-token funding that cannot be automated.
