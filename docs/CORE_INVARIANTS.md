# OmegaVault Core Invariants

This document is the canonical engineering statement of what OmegaVault already is intended to be. It does not redesign the recovery model or grant production authority. It turns the existing trust boundaries into explicit requirements that implementations, evidence bundles, and release/support decisions must prove.

## Invariant set

| ID | Invariant | Required meaning |
| --- | --- | --- |
| OV-I01 | Owner control | The owner retains control of protected assets and of policy lifecycle decisions while the owner remains in control. |
| OV-I02 | Non-custodial boundary | OmegaVault does not request, retain, or exercise seed phrases, private keys, or general signing authority. |
| OV-I03 | Native enforcement | OmegaVault may configure and coordinate recovery intent, but the blockchain-native mechanism must enforce the material recovery conditions. |
| OV-I04 | Predetermined Plan B | Trusted contacts approve the owner's already configured recovery plan; they do not author a new destination or beneficiary at recovery time. |
| OV-I05 | Contact non-beneficiary | Trusted contacts are approvers only. A contact cannot redirect recovered value to itself or another address. |
| OV-I06 | Authority separation | Trigger authority, approval authority, destination authority, and execution/finality observation are separate roles. No one role silently inherits another. |
| OV-I07 | Multi-credential resistance | When a policy requires multiple approvals, compromise or repetition of one trusted-contact credential cannot satisfy the larger quorum. |
| OV-I08 | Fail closed | Missing, stale, contradictory, insufficient, or unverified recovery/support evidence defaults to no movement and no support promotion. |
| OV-I09 | Owner lifecycle authority | Policy update, migration, disablement, and exit paths must be owner-authorized. OmegaVault/operator credentials must not gain unilateral lifecycle authority. |
| OV-I10 | Company independence | A configured protection mechanism must not require OmegaVault Fintech Solutions to remain online or in business for the chain-native protection to remain enforceable. |
| OV-I11 | Cross-chain equivalence | Different chains may use different native mechanisms, but they must preserve the same intent and an equivalent protected outcome rather than copying EVM mechanics. |
| OV-I12 | Recovery readiness | Liveness/heartbeat UX must evolve into a readiness view covering owner status, viable quorum, trusted contacts, rescue configuration, and compatibility/migration status. |
| OV-I13 | Support claim gate | A blockchain must not be described as “OmegaVault supported” until its native implementation proves the applicable invariants through adversarial tests and public-testnet evidence. |

## Authority model

OmegaVault separates four concepts:

1. **Destination authority** belongs to the owner at configuration/update time.
2. **Trigger authority** may belong to eligible trusted contacts after the configured inactivity condition is satisfied.
3. **Approval authority** belongs only to configured trusted contacts and is limited by the configured quorum.
4. **Execution/finality** may be permissionless or chain-specific, but execution cannot change the owner-selected rescue destination or bypass required approvals.

A trusted contact is therefore not a beneficiary merely because it can trigger or approve recovery.

## Recovery-readiness model

Heartbeat/liveness remains useful, but a healthy timestamp alone is not sufficient evidence that a recovery plan can still work. Readiness must report each dimension independently:

- owner status and control boundary;
- quorum viability;
- trusted-contact configuration integrity;
- rescue-destination integrity;
- chain compatibility and migration status.

Any unknown or failed required dimension makes aggregate readiness false. Readiness is a diagnostic statement only; it does not authorize movement.

## Chain-native implementation rule

“Same intent / native implementation / equivalent outcome” means:

- Core invariants are chain-neutral.
- Each adapter/mechanism may use the chain's own accounts, scripts, programs, contracts, transaction models, or authorization features.
- Evidence must prove the native mechanism actually enforces the relevant invariants.
- A reduced-semantics connector must remain labeled reduced-semantics rather than being promoted by analogy to another chain.

## Release and support gates

A chain support decision is fail-closed.

A chain can be called **OmegaVault supported** only when:

1. its capability/promotion contract is fully eligible with no remaining blockers;
2. every core invariant required by the support gate has an explicit passing evidence record;
3. each invariant record is public-testnet evidence (or stronger when a future evidence model defines a stronger level);
4. evidence references are chain-scoped and non-empty;
5. adversarial tests for destination substitution, duplicate/single-credential quorum bypass, role confusion, and fail-open behavior pass;
6. public-testnet evidence demonstrates the native mechanism, not only an offline simulator or source fixture.

Source and offline-test evidence remain valuable engineering milestones, but they are insufficient for an “OmegaVault supported” claim.

## Organization-independence requirement

OmegaVault software may provide configuration, evidence capture, monitoring, migration guidance, and user interfaces. Protection itself must remain enforceable by the user's keys plus the configured chain-native mechanism. Loss of OmegaVault-hosted infrastructure must not give the company custody and must not silently disable an already configured native protection mechanism.

## Current status boundary

This invariant specification does not promote any connector. Existing maturity labels and sealed evidence remain unchanged until the corresponding invariant/support gates are satisfied by their own chain-specific evidence.
