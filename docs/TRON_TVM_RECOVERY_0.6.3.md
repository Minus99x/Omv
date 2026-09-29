# TRON TVM recovery — 0.6.3 offline design record

## Status

The exact-semantics path is selected and complete through pinned offline compilation, deployment planning, runtime/config verification and custody-free proof-runner logic. It is **not** deployed, Shasta-tested or live-proof.

Native Account Permission Management remains available only as an explicitly reduced-semantics threshold option because it does not enforce owner inactivity or an immutable rescue destination.

## Current official assumptions checked on 2026-09-28

- TRON addresses are 21 bytes with current prefix `0x41`; Base58Check and hex are interchangeable, and the API `visible` flag must match the chosen representation: <https://developers.tron.network/docs/encoding>
- Smart-contract deployment and writes use `CreateSmartContract` / `TriggerSmartContract`, and write transactions require a caller-side `fee_limit` in sun: <https://developers.tron.network/docs/tron-protocol-transaction>
- `fee_limit` must be derived from current Energy estimates and current chain parameters, not a frozen fee constant: <https://developers.tron.network/docs/fee-limit>
- `wallet/getcontractinfo` exposes runtime bytecode needed for deployment comparison: <https://developers.tron.network/reference/getcontractinfo>
- Source verification must reproduce the exact TRON compiler distribution, version, optimizer flag and runs; the TRON and Ethereum compiler distributions are distinct: <https://developers.tron.network/docs/contract-verification>
- TronBox 4.11.0 supports TRON Solidity 0.8.31 and makes it the current project default: <https://github.com/tronprotocol/tronbox/releases/tag/v4.11.0>
- A transaction is treated as final evidence only after solidification, not after broadcast acceptance or initial block inclusion: <https://developers.tron.network/docs/tron-protocol-transaction>

## Contract invariants

`OmegaVaultRecoveryVaultTRONV063` fixes the following at construction:

- owner;
- rescue destination;
- inactivity period;
- trusted-contact set;
- threshold.

The owner heartbeat advances an epoch and clears approval count without looping over contacts. An approval counts at most once in the current epoch and is rejected before inactivity elapses. Execution is permissionless only after threshold and inactivity are satisfied, marks the vault recovered before the external TRX transfer, and cannot redirect funds. TRC-20 recovery is enabled only after native recovery and always targets the same immutable rescue destination. All value-moving paths have a shared reentrancy guard.

## Reproducible offline build

- TronBox: `4.11.0`
- compiler: `tronprotocol/solidity 0.8.31+commit.c2812a3d.Emscripten.clang`
- compiler binary SHA-256: `d0f2092759c99c3e983cf3dce38f75eb32377bf4cfc904cf34c2a6f8b04356b8`
- optimizer: enabled, 200 runs
- creation bytecode: 5,849 bytes
- runtime bytecode: 4,829 bytes
- source SHA-256: `3d4c5d3e7e2fe454640f87ac1c24ae6f00bfb182af9dc3d1a62ee778b1d802d8`

The checked manifest and `npm run verify:tron-contract` bind the source, compiler artifact, standard JSON input/output, compiler identity, optimizer settings, bytecode and immutable-reference table.

With TronBox 4.11.0 installed and the compiler available, reproduce compilation with `tronbox compile contracts/OmegaVaultRecoveryVaultTRONV063.sol --all`; `tronbox-config.js` pins the compiler and optimizer.

## Remaining Shasta promotion sequence

1. Recompile from the preserved standard JSON input and confirm all manifest hashes.
2. Query current Shasta chain parameters, account Energy/Bandwidth and deployment Energy estimate; derive a bounded `fee_limit`.
3. Deploy from a user-controlled test account and wait for solidification.
4. Fetch `wallet/getcontractinfo`; compare immutable-masked runtime bytecode and read every constructor-critical field and trusted contact.
5. Verify the exact flattened source and compiler settings on Shasta TRONSCAN.
6. Run negative cases: early approval, unknown contact, duplicate approval, heartbeat reset, under-threshold execution, repeated execution and pre-recovery TRC-20 sweep.
7. Run positive TRX and TRC-20 recovery paths, solidify every transaction, verify vault/rescue balances and export digest-bound evidence.

No wallet signature or Shasta funding is requested until this offline package has passed its complete test suite.
