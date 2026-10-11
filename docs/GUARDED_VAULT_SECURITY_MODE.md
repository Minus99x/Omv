# OmegaVault Guarded Vault — Product and Security Design (Draft v0.1)

Status: **proposed / offline design only**. No smart contract, custody, chain adapter, production deposit, wallet signature, or transaction submission is enabled by this document or any companion preview module.

## Product intent

Offer opt-in **Guarded Vault** theft resistance alongside existing **Recovery**. The owner may choose:
- **Recovery** (current recovery program, unchanged);
- **Guarded Vault** (withdrawal-policy protection for specifically enrolled assets);
- **Combined** (independent spending controls plus the existing owner-selected inactivity/guardian Plan B).

A connected hardware wallet or EOA is *a signer*, not itself a Guarded Vault. Ordinary wallet balances remain unprotected by these policies until assets are deliberately transferred into an independently enforcing vault or bound to a validated smart account. Never imply retroactive protection or make users export a seed.

## Security objective / attack to resist

Attack: adversary obtains the owner signer seed/key (including a malicious supply-chain device) and attempts immediate full-value withdrawal, malicious approval, configuration downgrade, lock release or destination substitution.

Required property: **the compromised owner key alone cannot satisfy, delete or weaken a high-risk transfer policy.** Enforce independent control on chain, including policy updates and exits. A guardian is neither a beneficiary nor a unilateral co-owner. An OmegaVault server/operator never receives keys, spending authority or an emergency override.

## V1 Guarded Vault baseline — EVM proof first

1. **Owner enrolls assets knowingly**. Display what remains outside protection. Distinguish ERC-20 token allowances and arbitrary external DeFi protocols from protected vault balances.
2. **Small routine transfers** may be instantly authorized within a conservative owner-configured per-transfer amount, trusted destination controls and an on-chain cumulative rolling/day-spend cap. A stolen owner key may spend up to this authorized exposure. Explain this explicitly.
3. **High-risk transfers** (larger amount, new destination, limit changes, guardian changes, asset migrations and exits) require fresh transaction-bound independent guardian quorum and a chain-enforced delay. Configurable lower limits may further reduce exposure.
4. **Emergency lock** rejects new outgoing transfers and sensitive policy changes. Independent unlock requires the owner's recovery pathway or sufficiently independent threshold authority plus a delay and explicit owner notification; guardian-only lock/unlock must not create a ransom mechanism.
5. **Policy changes are harder than ordinary transfers**. Owner + independent approval + timelock for relaxation, disablement, guardian threshold reduction, destination reassignment, withdrawal-limit increases or emergency-unlock. Guardian-only approval must never redirect funds.
6. **Replay resistance**: per-vault/chain/domain identity, intent hash, amount, token identity, recipient, expiration, nonce, revision and quorum are bound to the approved exact intent; signatures cannot be reused across chains, policies, revisions or transactions.
7. **On-chain enforcement**: an off-chain suggestion, dashboard, alert, or server authorization is never the spending gate. Missing/stale/contradictory evidence **fails closed**. All unlock, override and recovery pathways receive adversarial review.
8. **Liveness and exit**: the rightful owner retains workable update/migration/exit rights through approved procedures, with explicit recovery paths if contacts become unavailable. No company dependency.
9. **Chain-native**: Ethereum/EVM candidate first. Other networks must demonstrate equivalent outcomes through their own primitives, and honestly expose a reduced capability where a primitive is missing.
10. **UI**: plain-language defaults and a security summary. Prefer “Protected balance / Not protected,” “Everyday withdrawal allowance,” “Require another approval,” and “Emergency lock” over raw threshold jargon. An expert panel may expose custom settings. Do not describe the preview as active security.

## Explicit separation from existing recovery

Existing Plan B continues to have an owner-chosen immutable or approved-update rescue address. Contacts only approve the predetermined recovery route after its stated trigger; a spending guardian's approval must **not** automatically serve as recovery approval, or vice versa. Spending approval must not imply the authority to change owner/rescue.

Keep OV-I01..OV-I13, especially noncustody, original owner lifecycle control, authority separation, multi-credential resistance, independent enforcement, fail-closed evidence, and company independence.

## Progressive release gates

- **G0 Design/model**: document threat model and draft an offline preview of a policy, with no execution/adapters.
- **G1 Auditable test contract**: separate versioned EVM implementation; exact-source and bytecode verification; transaction-bound guardians; no owner-only downgrade/unlock bypass.
- **G2 Adversarial testing**: owner key stolen; guardian key stolen; replay; nonce reuse; malicious tokens/allowances; daily-window boundary; time reorg; lock griefing; unreachable guardians; malicious contract upgrade; allowance bypass; gas griefing; destination reassignment; owner exit/migration.
- **G3 Public testnet**: full end-to-end enrollment, ordinary transfer, blocked theft, independently approved withdrawal, emergency lock/release, recovery, and finality evidence.
- **G4 Professional audit and release**: external audit, remediation, property/fuzz testing, user and custodian disclosure. **Never** turn on mainnet/production asset paths from model-only passing tests.

Test-contract paths and evidence must not accidentally promote existing chain compatibility/support badges. One credible fail-open pathway blocks release.

## Patent boundary

Feature brainstorming / code documentation **does not amend** any USPTO application. Keep a dated design record. Map each material proposed mechanism against the *as-filed* patent specification and claims with qualified patent counsel before making priority/coverage claims. New subject matter may require a separate filing.

## Implementation integration plan

Keep the existing core recovery and Cardano witness/submission safety gates untouched. Introduce separately named guard configuration/intent preview modules; never reuse recovery approvals to authorize withdrawals. Implement a tested isolated contract/module once G0 is reviewed. The preview must always say **cannot authorize transaction** and **not on-chain enforced**.

Branch: `feature/guarded-vault-policy-design-20261010`, branched from `dev/0.6.60-reconcile-overnight-bitcoin`. Do not merge this into `main` or ship a UI badge claiming deployed protection.
