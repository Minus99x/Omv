# OmegaVault Chain Assessment — engineering conclusions

## Closest fits to exact OmegaVault semantics

### Ethereum/EVM-family vaults
Already proven on Ethereum Sepolia. Shared Solidity can accelerate other EVM-family proofs, but every network needs independent compatibility/finality evidence.

### Stellar
The bounded native path is now precise and offline executable. A pre-authorized transaction signer authorizes only the hashed recovery envelope, `minAccountSequenceAge` expresses inactivity relative to the account's last sequence change, one or two contact keys are included as transaction `extraSigners`, and fee-bump transactions separate fee payment from the inner recovery authorization.

The earlier generic weighted-signer idea was too broad: if more contacts exist than the selected threshold, enough account-level contact signers could authorize an unrelated transaction. OmegaVault therefore does not use contacts as account signers in exact native mode. The safe native scope is N-of-N with one or two contacts because Stellar allows at most two transaction extra signers. Broader M-of-N policies route to Soroban.

The recovery XDR is now generated and round-tripped with pinned `@stellar/stellar-sdk` 17.1.0. Account-state preflight verifies the exact preAuthTx signer and policy before submission. An applied transaction consumes the one-time signer even when operations fail, so an included failure requires a new envelope and authorization rather than a blind retry. Public Testnet execution and evidence export are still required before promotion to live-proof.

### Solana
A small program with PDA-owned state can express the full state machine directly: owner heartbeat, immutable rescue, M-of-N contacts, inactivity, approvals and execution. Offline hardening now enforces the protocol 32-byte maximum for each PDA seed component and makes token recovery preflight fail closed for mint-account substitution or mismatched expected authorities. It is heavier than Stellar because it requires a deployed program and program-security work. Rust/Agave compilation remains blocked because this execution environment has no cargo, rustc, or solana CLI.

## Partial native fits requiring a design decision

### TRON
The product decision is now explicit: a TVM vault is the exact-semantics path, while Account Permission Management remains an optional threshold-only mode labeled as reduced semantics. The TVM contract encodes immutable owner/rescue/inactivity/threshold values, O(1) heartbeat approval invalidation, permissionless execution to the fixed destination, and post-recovery TRC-20 sweeping only to that destination.

The pinned TRON Solidity 0.8.31 build, standard JSON input/output, bytecode artifact, hash manifest, deployment verifier and solidification-aware TRX/TRC-20 proof runners are complete offline. This does not establish Shasta compatibility or live proof. Promotion still requires deployment/runtime/config verification, dynamic Energy/Bandwidth evidence, adversarial calls, solidified receipts, destination balances and exported evidence on Shasta.

### XRP Ledger
SignerList gives weighted M-of-N. XRP Escrow gives an on-chain fixed not-before time and immutable destination for an XRP amount. The 0.6.4 semantic gate now formally prevents either mechanism from being labeled resettable inactivity recovery: `FinishAfter`/`CancelAfter` are immutable absolute times, SignerList is authorization rather than a clock, and Tickets only reserve sequence numbers. Fixed-date recovery remains a supported XRPL product mode; exact owner-resettable inactivity remains unsupported until a distinct verified mechanism exists. Fungible-token escrow remains amendment/capability gated.

## UTXO/EUTXO families

### Bitcoin
Timelocks and multisig are strong primitives, but liveness is naturally tied to UTXO refresh and scripts authorize spends rather than natively forcing an immutable recovery output. A robust design likely needs descriptors/Miniscript plus constrained vault UTXOs and PSBT/pre-signed recovery machinery.

### Cardano
Native scripts cannot inspect recovery outputs or maintain resettable liveness state. The exact path therefore uses a Plutus/Aiken state UTXO with a beacon asset; executable validator compilation remains pending.
