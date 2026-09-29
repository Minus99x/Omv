# OmegaVault Connector Roadmap — 0.4

## Purpose

OmegaVault does not define a blockchain connector as "something that looks like Ethereum." A connector is a translation layer between OmegaVault Core recovery semantics and one chain's native account, transaction, signature, fee, and finality model.

## Common connector contract

Every connector must describe:

- account model
- transaction model
- signing model
- recovery mechanism
- implementation stage
- supported capabilities
- network identity
- public transaction/reference normalization
- mechanism verification strategy
- finality/reorg behavior
- chain-specific safety assumptions

A connector may expose only capabilities it actually implements. Unsupported capabilities fail closed.

## Ethereum — live proof

Current proof path:

- EIP-1193 wallet connection
- Sepolia only
- native ETH balance read
- browser-wallet signing
- locally compiled Solidity proof contract
- runtime/configuration verification before binding
- owner heartbeat
- trusted-contact approval
- permissionless recovery execution after policy conditions

Production decision still open: direct vault contract versus smart account / account-abstraction recovery module. The Sepolia proof is evidence for the policy semantics, not the final custody architecture.

## XRP Ledger — scaffold

Do not deploy an EVM-shaped contract model.

Candidate mechanisms to investigate:

1. native SignerList / multisigning primitives
2. account configuration and regular-key patterns where appropriate
3. guarded, preconstructed transaction flows
4. a coordination layer that never holds secret material

Required tests include sequence handling, reserve requirements, signer quorum semantics, destination tags, amendments/network feature differences, transaction finality, and safe cancellation/rotation.

## Solana — scaffold

Candidate mechanisms:

1. a small audited program with PDA state
2. integration with an established smart-wallet architecture
3. transaction authorization expressed through Solana account/program semantics rather than EVM calldata assumptions

Required tests include recent blockhash expiry, durable nonce choices if used, program upgrade authority, PDA derivation, account ownership, compute budgets, signer ordering, rent/state sizing, and finalized commitment behavior.

Offline RPC evidence now has deterministic fail-closed fixtures for recent-blockhash expiry, monotonic confirmed contexts, simulation/fee/rent/balance observations, finalized ATA creation status, and finalized account refetch. Legacy and v0 simulation envelopes are decoded so their exact message, fee payer, blockhash, signature count, compiled-instruction vectors and v0 address-table lookup vectors are structurally checked and bound to caller-supplied SHA-256 digests plus the byte-identical `getFeeForMessage` payload. Each compiled instruction is additionally decoded into its static program ID, ordered account indexes and exact data bytes, then compared against the caller's complete expected roster; insertions, removals, reordering, mutations and address-table-loaded program IDs fail closed. Static account privileges are derived from the message header, while v0 loaded addresses are ordered writable-first then readonly and bound to the lookup table ID/index resolution supplied by the caller; account substitution and signer/writable drift fail closed. Independent lookup-table account-state decoding remains pending. Other message versions fail closed until separately implemented and tested. The token/recovery roster fixture is explicitly synthetic and non-deployable; Token/Token-2022 SBF execution, validator-backed integration and Devnet evidence remain required before promotion.

## Bitcoin — scaffold

Bitcoin should be designed from UTXO/script primitives.

Candidate mechanisms:

1. descriptor-based recovery policy
2. CLTV/CSV timelock branches
3. Taproot script-path policy
4. PSBT-based approval/execution flows

Required tests include UTXO selection, fee changes, dust, RBF/CPFP behavior, timelock interpretation, change output safety, descriptor backup, script-path privacy, transaction malleability assumptions, and reorg depth.

## XDC — scaffold

XDC has EVM-compatible account concepts but remains a separate connector. Shared address shape is not permission to inherit Ethereum network assumptions.

Required work:

- independent RPC/network definition
- chain-specific gas/finality review
- compiler/EVM compatibility check
- separate testnet proof
- separate deployment fingerprint and audit evidence

## Connector promotion gates

A connector moves from `scaffold` to `live-proof` only when it has:

1. test-network integration
2. network guardrails
3. transaction preflight
4. mechanism creation/configuration
5. independent mechanism verification
6. public state read-back
7. role/threshold/inactivity tests
8. adversarial tests
9. finality/reorg handling
10. evidence export
11. chain-specific threat review

A connector is not marked production-ready solely because a testnet transaction succeeds.
