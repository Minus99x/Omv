# OmegaVault MVP 0.4 Threat Model

This document describes the current proof, not a production-security claim.

## Assets and trust boundaries

### Protected in this proof

- Sepolia test ETH
- Core recovery policy integrity
- deployment identity/version metadata
- audit/event history

### Explicitly outside OmegaVault custody

- wallet seed phrases
- private keys
- wallet signing authority

The signing boundary is the user's wallet provider. OmegaVault asks for public-account access and transactions; the wallet presents the final approval.

## Threats addressed in MVP 0.4

### Mainnet use by mistake

Live proof actions require Sepolia in the browser adapter. Server-side binding independently refuses an Ethereum network reference other than `0xaa36a7`, requires `testOnly: true`, and exposes `mainnetTransactionsEnabled: false`.

### Wrong contract bound after deployment

A mined contract is not sufficient. Before binding, the client compares masked runtime bytecode against the locally compiled artifact and verifies owner, rescue destination, threshold, inactivity timer, adapter version, and trusted-contact membership.

### Constructor/configuration mismatch

The contract configuration is read back from chain before the binding is accepted. Failed checks leave the deployment unbound.

### Duplicate trusted-contact approval

Core duplicate approvals are ignored. The Solidity proof also increments `approvalCount` only once per trusted contact.

### Forged audit attribution

Server-side chain activity validation rejects an on-chain heartbeat attributed to anyone except the configured owner and rejects recovery approvals attributed to non-trusted contacts. Duplicate transaction records for the same operation/hash are idempotent.

### Wrong recovery destination

Core recovery requests must use the configured rescue destination. The Ethereum proof destination is immutable after deployment and is verified before binding.

### Owner cancellation

An owner heartbeat resets the inactivity clock and clears existing approvals. This is intentional: while the owner still controls the configured owner key, the recovery process can be cancelled.

### Re-entrancy during recovery transfer

`executeRecovery()` sets `recovered = true` before the external value transfer. A callback cannot execute recovery a second time.

### Unbounded approval-clear loop

The Ethereum proof caps trusted contacts at 32. OmegaVault Core itself remains capable of representing larger policies; the limit is adapter-specific.

## Threats not solved yet

### Independent chain attestation

The server still trusts browser-provider reads when recording the verified deployment. A production design should query an independent RPC provider/indexer and compare chain ID, receipt, code, and contract state before accepting authoritative chain transitions.

### Smart-contract audit

The proof contract has not received an independent professional audit, formal verification, or production-scale fuzzing. Do not place real assets in it.

### Compromised owner key

If the owner key is compromised before recovery, the attacker can heartbeat or withdraw test funds. Production designs need to define whether the recovered asset model uses a smart account, vault, co-signing policy, delayed withdrawal, or another mechanism.

### Compromised trusted contacts / collusion

M-of-N reduces dependence on one contact but does not eliminate coordinated compromise. Production policy design should consider contact diversity, delayed execution, owner notifications, optional hardware-backed authorization, and policy-update rules.

### Rescue-destination loss or malicious contract

An immutable destination can become unusable. If it is a contract that rejects ETH, execution can fail. Production UX should validate destination type, support safer update semantics, and provide explicit recovery-destination confirmation.

### Browser / device compromise

A malicious browser, extension, phone, or operating system can misrepresent transaction intent. Wallet transaction screens remain a critical verification point.

### LAN test serving

Serving the local app over plain HTTP on a LAN is acceptable only for a low-value Sepolia proof on a trusted network. Do not use this arrangement for production signing or public Wi-Fi.

### Compiler supply chain

The Solidity compiler is version-pinned and locally cached but the JavaScript compiler SHA-256 is not yet hard-pinned in `compiler-cache.js`. A production pipeline should pin and verify a known compiler artifact hash and produce reproducible-build evidence.

## Non-goals of this proof

- production custody
- Ethereum mainnet storage
- ERC-20 recovery
- retroactive recovery of an arbitrary EOA
- production account abstraction
- claiming Ethereum logic applies unchanged to XRPL, Solana, Bitcoin, or XDC
