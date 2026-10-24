# OmegaVault 0.6.60 — Prioritized Autonomous Engineering Objectives

Authoritative tracking issue: https://github.com/Minus99x/Omegavault/issues/4
Product branch: `dev/0.6.60-reconcile-overnight-bitcoin`

## Worker operating rule

Pick the first unmet **offline** objective below. Read source and existing
tests before editing. If the objective is already covered, identify the
concrete evidence and move to the next objective; never manufacture churn.

The previous remote/workstation checklist is historical and most remote items
are complete. It is context, **not** an endless source of fresh tasks.

For every substantive change: identify exact component, inspect vetted
open-source upstream patterns/licenses, implement a real fix, add negative and
positive regression coverage, and preserve current safety invariants.
Source and tests only. Do not edit this queue from the autonomous worker.
An actual tested commit SHA is the completion receipt. The supervising
issue is manually reconciled against verified GitHub history.

## Priority OVR-001 — Cardano Preprod signed/current-ledger offline gate

Verify the transaction body hash, witness set, expiry/validity window,
provider state and specific observed UTxO are bound together. Add failing
adversarial tests and implementation changes **only where a concrete gap exists**.
Do not fabricate a wallet signature or claim a public Preprod proof.
Human signing/submission and a workstation freshness check are separate gates.

**Acceptance:** Demonstrable fixture reproducing any discovered mismatch,
rejection of stale/substituted witness/body/UTxO evidence, positive test on
valid fixture, and no signing or submission.

## Priority OVR-002 — Bitcoin Signet PSBT/Core evidence and finalization

Cross-check approved PSBT, finalized transaction, descriptor, authorized
signer evidence, and Bitcoin Core observations without rewriting identifiers.
Investigate digest substitution, stale observations, non-canonical timestamps,
and fee/change mismatches not already covered.

**Acceptance:** Positive and adversarial offline fixture results proving
frozen approvals and truthful evidence binding; no broadcast or mainnet calls.

## Priority OVR-003 — Stellar Testnet Horizon recovery proof

Preserve exact ledger/transaction hash, preAuthTx consumption, threshold
signatures, immutable rescue payments and classic-asset authorization.
Distinguish constructed/injected evidence from public Horizon observations.

**Acceptance:** Positive lifecycle fixture and negative signature/authority/
finality/balance adversarial regressions where current coverage has a gap;
no keys, signatures or actual submission by unattended worker.

## Priority OVR-004 — XDC/EVM finality and receipt integrity

Enforce explicit network identity, finality/confirmation policy, immutable
rescue destination, and refusal of cross-network or altered receipts.

**Acceptance:** Offline positive and negative receipt/confirmation tests,
correct chain-specific finality checks, and no live deployment/execution.

## Priority OVR-005 — XRPL native invariant equivalence

Use supported SignerList / Delegation / Escrow / Ticket / Batch evidence only
where established. Retain fail-closed gaps for resettable inactivity and
immutable rescue; do not claim OmegaVault-equivalent recovery without proof.

**Acceptance:** Tested truthful capabilities and adversarial unsupported-
equivalence rejection, no chain support promotion.

## Priority OVR-006 — Integration readiness

When suitable fixes are integrated, verify `npm test` and `npm run check`
on the full product branch and record exact executed command, environment,
result and SHA. A local fixture is not public-network finality.

## Strict boundaries

The worker may change only `src/chains/` and `test/`.
Do not modify D1, workflow configuration, branch rights, credentials,
wallet keys, live payments, broadcasts, deployments, or release claims.
If an objective is blocked by human authorization, move to another objective.
Do not create cosmetic patches merely to increase commit counts.
