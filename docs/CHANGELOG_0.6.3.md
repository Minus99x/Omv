# OmegaVault 0.6.3-dev progress

- Selected the TRON TVM vault as the exact inactivity + immutable-rescue path; native permissions remain reduced-semantics threshold mode.
- Added `OmegaVaultRecoveryVaultTRONV063` with immutable constructor policy, epoch-based heartbeat reset, threshold approvals, TRX execution and guarded post-recovery TRC-20 sweeping.
- Compiled with the official TRON Solidity 0.8.31 distribution through TronBox 4.11.0 and preserved compiler input/output, bytecode artifact and hash manifest.
- Added full Base58Check / `0x41` address validation, caller-sized deployment/call plans and immutable-aware runtime/config/ABI verification.
- Added live-proof runners requiring verified deployment, current chain/resource preflight and successful solidification for every state change.
- Added offline adversarial tests for checksum corruption, fee-limit refusal, runtime tampering, deployment-gate refusal, solidification and TRC-20 conservation.
- Kept Ethereum Sepolia 0.4.3 as the only live-proven connector; TRON remains scaffold until every Shasta promotion gate passes.
