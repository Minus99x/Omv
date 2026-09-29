# XRPL recovery semantics — 0.6.4-dev

## Verified scope decision

OmegaVault MUST distinguish native XRPL fixed-time escrow from resettable inactivity recovery.

- `EscrowCreate.FinishAfter` is an immutable absolute Ripple-epoch time. It can express a fixed maturity date, not an owner heartbeat that moves the deadline.
- `CancelAfter` is also immutable and represents expiration/return semantics, not heartbeat reset.
- `SignerListSet` provides weighted transaction authorization. It does not provide a time/inactivity primitive.
- Tickets reserve sequence numbers for later transactions. They do not add resettable time semantics.
- Fungible-token escrow is capability-gated by TokenEscrow and has issuer/authorization constraints; the connector must query feature state rather than assume support.

## Product mapping

| OmegaVault behavior | XRPL native status |
|---|---|
| Fixed-date XRP release to immutable destination | supported by timed escrow |
| Weighted trusted-contact authorization | supported by SignerList/multisign |
| Resettable owner inactivity heartbeat | NOT established |
| Fixed-date token escrow | capability-gated; not assumed |

No XRPL connector may claim exact resettable inactivity semantics until a separate verified mechanism satisfies all promotion gates.

## Toolchain

Official XRPL JavaScript documentation currently demonstrates xrpl.js 4.4.x. The intended offline codec/signature toolchain is pinned to `xrpl` 4.4.2 only after clean installation and executable serialization/signature tests succeed. Dependency installation was unavailable in this build environment, so that execution-plan item remains unchecked rather than being falsely promoted.
