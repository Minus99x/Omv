//! OmegaVault Solana recovery program scaffold.
//!
//! SECURITY STATUS: design scaffold only; not compiled, deployed, audited, or suitable for value.
//! The executable implementation is intentionally deferred until a pinned Solana/Agave Rust
//! toolchain is available so we do not fabricate build verification.

/// Versioned state fields that the on-chain account must serialize deterministically.
pub struct VaultStateV1 {
    pub version: u8,
    pub owner: [u8; 32],
    pub rescue_destination: [u8; 32],
    pub inactivity_seconds: i64,
    pub last_heartbeat_unix: i64,
    pub threshold: u8,
    pub recovered: bool,
    // Production implementation: bounded vector/bitset of contacts and approvals.
}

/// Required instruction surface. The production implementation must validate account owners,
/// PDA seeds/canonical bump, signer roles, clock sysvar time, token program identity, and all
/// CPI destinations before state mutation.
pub enum OmegaVaultInstructionV1 {
    InitializeVault,
    Heartbeat,
    ApproveRecovery,
    ExecuteNativeRecovery,
    ExecuteTokenRecovery,
    CloseRecoveredVault,
}

// Required invariants before this scaffold can become executable:
// 1. rescue destination immutable after initialization;
// 2. heartbeat owner-only and clears approvals;
// 3. approvals trusted-contact-only and idempotent;
// 4. approval/execution require Clock time >= last heartbeat + inactivity;
// 5. execution requires approval weight/count >= threshold;
// 6. native SOL destination fixed to rescue;
// 7. token mint + Token Program/Token-2022 program + custody authority are explicit;
// 8. arbitrary CPI/program substitution rejected;
// 9. recovered state committed before outward value movement where re-entry/CPI could matter;
// 10. program upgrade authority/build provenance independently verified before promotion.
