# Ethereum Sepolia legacy-proof reconciliation — 2026-10-09

Repository: `Minus99x/Omegavault`  
Development branch: `dev/0.6.60-reconcile-overnight-bitcoin`  
Scope: historical Ethereum Sepolia 0.4.x identifiers and independent read-only chain checks. This is **not** a support-promotion receipt.

## Local workstation metadata (operator output)

The workstation completed `npm.cmd run ethereum:legacy:inspect` against the local test vault store. One displayed candidate is:

- Vault ID: `7b28db3b-85ad-447a-8a6b-f998f38a5ad0`
- Created: `2026-09-22T22:19:43.731Z`
- Owner: `0x926b070d678e10e6ba16cc268dcbd91acf5877bc`
- Immutable rescue destination reported in local metadata: `0x1e8f8d94f7af17df0c81bee0067c35a325e8b4ca`
- Trusted contacts: `0xaba4514c5aa0a2d524995eae821f00b4ef6e62cf` and `0x791b83c4e73e96a2aab936f07d7e804a9e28d051`
- Threshold: 2; test inactivity: 60 seconds (config `inactivityDays: 30`)
- Sepolia network reference `0xaa36a7` (chain ID 11155111)
- Contract: `0x1898006d223617010c12e68d1a441ea10b6ca2d3`
- Source SHA-256: `30334ae7631d350163a14ff96c7226641eddf87cab237959b58df8895976e54e`
- Adapter and contract version: `0.4.0` (historical proof retained from the 0.4.x effort)
- Local inspector readiness: deployment rebind candidate true; native recovery rebind candidate true; threshold evidence identifiers present true; heartbeat identifier absent; token recovery identifier absent.

This is a **partial pasted inspector output**, not the complete vault inventory. At least one preceding displayed candidate had deployment identifiers but lacked native recovery and threshold identifiers. Do not infer total candidate count or universal readiness from the partial output.

## Read-only public chain cross-check

The following transaction statuses were independently queried from Blockscout for Sepolia (chain ID `11155111`) on 2026-10-09. The tool reported final `status: ok` / `result: success` for each:

| Evidence item | Transaction | Successful chain observation |
| --- | --- | --- |
| Contract creation | `0x9553853fd8f8e3646af77ba7b007ca11f047222bcfc3e37e5c58dfde7bec8223` | 2026-09-22T22:20:12Z; creates matching contract `0x1898006d223617010c12e68d1a441ea10b6ca2d3` |
| Contact A, delegated approval-related call | `0x96634798209986aabc00f900bca356206522ad488a84269954024343f60e557e` | 2026-09-28T00:53:36Z; sender matches contact A; calls `redeemDelegations(...)` via delegation contract `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`, with an authorization-list entry |
| Contact B approval | `0xa742009698495c157567610d47dc82625887282a8f39fe74dba0995d4b9090cf` | 2026-09-28T00:55:12Z; sender matches contact B; direct `approveRecovery()` call to vault |
| Recovery-related delegated call | `0x5cb00e289656536cf87509b2aa4e63b82c2ac4ed7cb5ab4931b0094ad78428f2` | 2026-09-28T00:56:00Z; sender matches owner; `redeemDelegations(...)` via delegation contract |

### What this does and does not prove

- All four identifiers correspond to successful Sepolia transactions at the listed timestamps.
- Contract deployment address is corroborated by on-chain creation result.
- A successful outer transaction does **not** by itself establish that the claimed downstream vault state transition, threshold, timelock, or immutable rescue payout occurred.
- **In particular** contact A's and the recovery transaction's delegated call paths require internal call traces, logs, and pre/post vault state inspection to attribute actual downstream operations to OmegaVault.
- The local inspector's `nativeRecoveryRebindCandidate:true` is a candidate flag, not completed independently reproduced recovery validation.
- Rebinding requires receipt/log/trace confirmation, code/source provenance, input/output value evidence, strict ordering, threshold authority and immutable destination proofs, and reproducible evidence mapping. Missing heartbeat/token-recovery identifiers remain missing; do not invent them.
- No transaction signature, broadcast, live asset movement, or support claim was authorized or performed by this reconciliation.

## Follow-up (remote-first)

1. Build a deterministic read-only rebind verifier that accepts explicit historical identifiers and checks receipt status, vault contract identity, event/trace attribution, temporal ordering, two distinct configured contacts, recovery destination, and value conservation. Fail closed when any required public proof is unavailable.
2. Generate a machine-verifiable report without changing historical metadata or inserting `verified:true` manually.
3. Keep Ethereum legacy migration and Cardano validation as separate chain-specific proof tracks. Cardano remains `completePhaseOneValidated:false` and submission unauthorized.
