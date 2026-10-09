# XRPL invariant-first native composition — 0.6.60

Status: remote architecture / fail-closed assessment.

## Design rule

OmegaVault standardizes **security invariants**, not one blockchain implementation.

XRPL must therefore be evaluated by asking whether its own native ledger mechanisms can reproduce the protected outcome:

- owner control remains intact;
- OmegaVault never becomes custodian;
- trusted contacts approve a predetermined recovery plan rather than inventing one;
- one contact cannot satisfy a larger quorum;
- contacts cannot redirect protected value;
- inactivity/liveness is enforced on-ledger if claimed;
- rescue destination and protected scope are immutable if claimed;
- owner lifecycle authority remains distinct from recovery execution;
- missing or contradictory evidence fails closed;
- public support is never inferred from source compatibility alone.

This is the same cross-chain architecture principle already captured by `OV-I11`.

## XRPL-native building blocks

The current investigation treats the following as composable XRPL mechanisms rather than forcing an EVM-style contract abstraction:

1. `SignerListSet` / multisigning for weighted trusted-contact quorum.
2. Permission Delegation / `DelegateSet` for transaction-type or granular delegated authority where the target network has the required amendment enabled.
3. Escrow for a ledger-enforced predetermined destination and fixed asset/amount scope.
4. Tickets for one-use sequencing / reserved sequence coordination.
5. Batch transactions for atomic grouped transitions where the required amendment is enabled.

Every amendment-dependent feature must be checked against the actual target network/server state. The repository must not assume amendment activation from documentation alone.

## Current semantic result

The current native-composition assessment remains **reduced-semantics**, not because XRPL is being forced to imitate Ethereum, but because the exact OmegaVault invariant set has not yet been proven by a verified composition.

The unresolved questions are deliberately narrower now:

- Can owner activity reset a ledger-enforced inactivity deadline without recreating or prematurely locking the protected assets?
- Can the recovery quorum be restricted so contacts can approve only the predetermined recovery action rather than unrelated value movement?
- Can destination, asset/currency scope and amount scope remain independently immutable across the entire recovery lifecycle?
- Can the design survive OmegaVault disappearing while preserving all of the above?

Signer Lists solve quorum but not time.
Escrow solves predetermined destination / fixed scope but uses absolute maturity rather than owner-resettable inactivity.
Tickets solve sequencing, not inactivity.
Batch solves atomicity, not authorization semantics by itself.
Permission Delegation narrows authority but does not, by itself, create the missing resettable inactivity or immutable rescue policy.

A composition can only leave `reduced-semantics` after all missing invariants are independently demonstrated and then proven on public network evidence.

## Programmable XRPL-family track

Hooks-family research is useful as a **separate proof track** because programmable account logic may be able to encode heartbeat state, approval accumulation and immutable recovery rules.

That track must remain clearly separated from XRPL mainnet support:

- a Hooks-family proof may demonstrate that XRPL-style ledger/account technology can express the full OmegaVault state machine;
- it must not be presented as proof that XRP Ledger mainnet currently exposes the same programmable enforcement;
- XRPL mainnet promotion remains gated by the actual native primitives and amendments available on XRPL itself.

## Repository implementation

`src/chains/xrpl/native-composition.js` provides a capability/invariant assessment that:

- takes actual feature/semantic evidence as inputs rather than assuming network activation;
- records XRPL native primitives independently;
- refuses exact-equivalence status while resettable inactivity, immutable scope, contact non-redirection or quorum remain unproven;
- keeps the Hooks-family track separate from XRPL mainnet promotion;
- cannot promote XRPL merely because invariant equivalence is theoretically achieved; public-testnet evidence remains separately required.

## Next XRPL engineering work

1. Add explicit Permission Delegation transaction/evidence modeling.
2. Add Batch/Ticket composition builders only where they materially strengthen a specific invariant.
3. Model a candidate native recovery sequence and enumerate every transaction authority at each stage.
4. Attack that sequence adversarially for unrelated-payment authority, destination substitution, stale recovery, replay, duplicate approval and owner-reset behavior.
5. If exact equivalence still cannot be reached, preserve `reduced-semantics` and define the strongest honest XRPL product tier instead of weakening the OmegaVault invariants.

No item in this document authorizes signing, submission, mainnet use, support promotion or public recovery claims.
