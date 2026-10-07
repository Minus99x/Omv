# OmegaVault Native Network Fee — Architecture Design

Status: design only; not implemented; not authorized for production use.

## Purpose

OmegaVault may later charge a very small, transparent service fee denominated in the native asset of the chain being used. The purpose is to let OmegaVault build a diversified multichain treasury while keeping the recovery architecture fully non-custodial and independent of OmegaVault's continued operation.

Examples:

- Ethereum-family recovery/configuration: ETH
- Bitcoin: BTC
- Cardano: ADA
- Stellar: XLM
- Solana: SOL

The fee is a service/economic layer. It is not part of the security authority model.

## Core rules

1. The fee MUST NOT control, delay, redirect, freeze, veto, or invalidate recovery.
2. OmegaVault MUST NOT receive or control owner private keys, seed phrases, recovery phrases, trusted-contact keys, or rescue-destination authority.
3. Trusted contacts MUST NOT gain authority to redirect the fee or rescue assets.
4. Rescue funds and OmegaVault fee funds MUST remain logically and operationally separate.
5. The fee amount and destination MUST be visible before the owner authorizes any fee-bearing action.
6. A fee failure MUST NOT strand or lock the owner's assets.
7. The owner MUST retain migration, update, disable, and exit rights.
8. Recovery MUST remain possible if OmegaVault ceases to exist.
9. No fee may convert OmegaVault into a custodian or beneficiary of the recovery principal.
10. No chain may receive fee implementation until its recovery/security path satisfies the applicable evidence gates.

## Pricing model

Preferred model: a small fixed-equivalent amount in the chain's native token, rather than a percentage of recovered value.

The exact amount is intentionally undecided. Product policy may later target a low fiat-equivalent range with a hard maximum and chain-specific minimums where required by network economics.

Any amount calculation MUST be deterministic and disclosed before authorization.

## Treasury split

A future fee may be divided between:

- OmegaVault Treasury — infrastructure, audits, testing, development, operations, and network costs.
- Recovery Assistance Reserve — an optional separately accounted reserve intended to help subsidize recovery/network costs where OmegaVault policy allows.

The Recovery Assistance Reserve MUST NOT receive special authority over user funds or recovery execution.

## Security separation

The fee layer MUST be architecturally downstream or parallel to recovery authorization.

A valid recovery plan MUST NOT depend on:
- OmegaVault treasury availability,
- fee-collection success,
- OmegaVault server availability,
- OmegaVault approval,
- fee-recipient key availability.

Where technically possible, recovery should remain independently executable using the already-established blockchain-native mechanism.

## Implementation gate

Do not implement fee-bearing transaction paths yet.

Implementation is deferred until:
1. the relevant chain's core recovery path is stable,
2. adversarial and provenance/evidence gates are green,
3. fee behavior can be added without weakening non-custodial invariants,
4. chain-specific fee mechanics are reviewed for regulatory, tax, accounting, and UX implications,
5. explicit product authorization is given for implementation.

Until those conditions are satisfied, this document is the authoritative design constraint only.
