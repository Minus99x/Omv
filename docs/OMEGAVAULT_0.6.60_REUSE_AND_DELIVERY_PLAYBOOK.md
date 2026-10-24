# OmegaVault 0.6.60 — Open-Source Reuse & Linked-Job Delivery Playbook

**Prepared:** 2026-10-24 · **Status:** implementation guide / design proposal, not executed test evidence  
**Branch:** `dev/0.6.60-reconcile-overnight-bitcoin`  
**Primary queue:** [Issue #4](https://github.com/Minus99x/Omegavault/issues/4) · **Operations ledger:** [Issue #3](https://github.com/Minus99x/Omegavault/issues/3)

## Commander's intent

Reuse, copy, vendor, adapt or depend on functioning open-source implementations **when their exact release licenses permit it**. Eliminate duplicate implementations and costly repeated engineering. Existing OmegaVault chain-native semantics and noncustodial/security boundaries take precedence over convenience. A completed test is not proof of public-network finality. Do not manufacture commits.

**Source-of-truth order:** current checked-out code and tests -> independent upstream source plus tagged LICENSE/NOTICE and security record -> delta analysis -> smallest reuse/adaptation -> positive and adversarial test -> integrated verification -> documented evidence -> next dependent job.

## What is already implemented (do not rebuild)

Verified against the repository source tree and `package.json` on 2026-10-24:

- Cardano: `@emurgo/cardano-serialization-lib-nodejs@17.0.0` and Aiken `@aiken-lang/aiken@1.1.24`; existing UTxO, transaction-body, witness, CIP-30 and pre-submit evidence code/tests.
- Bitcoin: descriptor, PSBT v2, transaction finalization, read-only Bitcoin Core comparisons, Signet evidence and adversarial tests; `@noble/curves@2.4.0` and `@noble/hashes@2.4.0`.
- Stellar: `@stellar/stellar-sdk@17.1.0`, native recovery/XDR, Horizon read-only proof drivers, fee-bump/authority tests.
- XRPL: `xrpl@4.6.0`, native-primitive/equivalence assessment, codec, Escrow/SignerList/Delegation tests.
- EVM/XDC: existing compatibility, receipt, finality, network and deployment-proof code.

`src/engineering/upstream-reuse-catalog.js` already records candidates. Update its decisions only after real adoption and exact tagged-license review; do not bypass its tests. Historical `docs/OMEGAVAULT_0.6.60_REMOTE_WORK_QUEUE.md` already checks off most remote Cardano work. Do not relabel completed work as pending.

## Reuse shortlist (ranked)

| Area | Proven upstream | Upstream license / permission checkpoint | Recommendation and precise seam |
|---|---|---|---|
| **EVM safety** | [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) | MIT; preserve copyright/license and inspect exact tagged release | **High-value adopt as needed:** bounded SafeERC20/ReentrancyGuard/utility primitives in the Solidity contract, retaining OmegaVault immutable rescue and contact/owner roles. Never wholesale replace a working vault. |
| **Bitcoin independent verification** | [bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib) | MIT; use a tagged stable release, not `master` | **High-value test-only candidate:** round-trip/parse a known approved PSBT and final transaction independently of OmegaVault's parser in `test/bitcoin-*`. No signer, seed, broadcast or policy promotion. |
| **Bitcoin descriptor reference** | [Bitcoin Dev Kit (BDK Wallet)](https://github.com/bitcoindevkit/bdk_wallet) | MIT OR Apache-2.0 | **Reference / optional isolated Rust comparison only:** descriptor/miniscript correctness; adding an entire Rust wallet stack to current Node application without a clear gap adds complexity. |
| **Stellar XDR/Horizon** | [Stellar JS SDK](https://github.com/stellar/js-stellar-sdk) | Apache-2.0 | **Keep pinned current integration:** native recovery + Horizon driver; add only verified gaps around preAuthTx one-time consumption, immutable payout and ledger-bound evidence. |
| **Stellar broader M-of-N** | [Soroban Rust SDK](https://github.com/stellar/rs-soroban-sdk) | Review exact SDK tag and NOTICE; commonly Apache-2.0 | **Research branch / later:** broader contact quorums require a contract design, not stretching Stellar's two extra signers or assigning contacts arbitrary account signing power. |
| **Cardano serialization** | [EMURGO Cardano Serialization Lib](https://github.com/Emurgo/cardano-serialization-lib) | **Verify exact v17.0.0 package LICENSE metadata before copying/vendor use** | **Keep pinned current integration** for CBOR and witness/body serialization; require independent current-ledger phase-one evaluation instead of treating serialization as ledger validation. |
| **Cardano validator/compiler** | [Aiken](https://github.com/aiken-lang/aiken) | Apache-2.0 | **Keep current toolchain:** preserve reproducible validator compilation and hash/protocol evidence. |
| **Cardano transaction builder** | [Lucid Evolution](https://github.com/Anastasia-Labs/lucid-evolution) | MIT | **Conditional:** compare to existing EMURGO path in offline experiment only if specific builder defects persist; never silently change body hash after owner approval. |
| **XRPL native codecs** | [XRPLF xrpl.js](https://github.com/XRPLF/xrpl.js) | Verify installed 4.6.0 package license before copying source | **Keep current SDK:** use its read-only RPC and canonical transaction representations, preserve fail-closed limitations on resettable heartbeat/immutable rescue equivalence. |
| **Optional Safe smart-account surface** | [Safe Protocol Kit](https://github.com/safe-global/safe-core-sdk) | MIT SDK | **Conditional adapter only:** evaluate account creation/configuration; never assume Safe quorum equals OmegaVault heartbeat, destination lock, recovery policy or no-custody by itself. |
| **Optional Safe smart-account contracts** | [Safe Smart Account](https://github.com/safe-fndn/safe-smart-account) | LGPL-3.0; check link/reuse obligations and tagged audited release | **Defer full contract migration:** material security, custody-model, deployment and licensing review required. The upstream warns development branch is not audited-release equivalent. |
| **Safe service-layer components** | [Safe licensing FAQ](https://help.safe.global/articles/4365429719-licensing-changes-faq) | Some new service releases use Functional Source License (FSL), not general-purpose permissive OSS | **Do not assume Safe's service/API layer has the SDK/contract license.** Use SDK/contracts subject to their own terms; audit any server/service dependency before commercial use. |

**No evidence of an upstream component automatically enforcing all OmegaVault invariants.** Reuse correct primitives, retain bespoke policy binding and independent proof.

## Security acceptance invariants (cannot be traded away)

Apply `docs/CORE_INVARIANTS.md` OV-I01..OV-I13 to every chain:

1. Owner controls plan and heartbeat; no recovery service/agent handles seed phrases or private keys.
2. Contacts only approve a *preselected immutable rescue destination*; they cannot redirect funds or manufacture a beneficiary.
3. Quorum is comprised of distinct authorized credentials; replay/duplicate/signature substitution never advances it.
4. Invalid, stale, wrong-network or contradictory evidence fails closed.
5. Chain-native state enforces critical conditions; an SDK or UI claim alone is insufficient.
6. No signing, submission, broadcast, deployment, mainnet/value transfer or support promotion from automated workers. Each needs separately authorized human gates.
7. A source fixture, locally passing test, read-only public observation and executed finality have distinct maturity states.

## Linked delivery jobs and dependencies

| Job | Inputs | Operation (prefer reuse) | Mandatory artifact -> unlock |
|---|---|---|---|
| **J00 Inventory & diff** | Dev HEAD, existing test and reuse catalog | Identify first *real* uncovered acceptance criterion; compare against current code | `gap.json`: exact path, tested gap, evidence/ref, no duplication -> J01 |
| **J01 Upstream qualification** | J00 gap | Confirm tagged upstream, LICENSE/NOTICE, maintenance/security, Node/API/toolchain fit; decide dependency vs copy vs no adoption | `reuse-decision.md` with pinned upstream commit/hash, license and rollback -> J02 |
| **J02 Focused implementation** | J01 qualified design | Minimal safe integration in owner component, preserve existing architecture and network identity; no new API surface without reason | patch limited to authorized paths, no secrets -> J03 |
| **J03 Adversarial/positive proof** | J02 patch + frozen fixtures | Independent oracle checks plus negative cases: wrong chain/UTxO/body/witness, changed PSBT/output, wrong signer, stale ledger, altered receipt, mismatched destination | focused commands and complete results -> J04 only if green |
| **J04 Whole-repo verification** | J03 green | Clean dependency install and `npm test`, `npm run check` on exactly same product SHA | test report, environment/node version, SHA and no failures -> J05 |
| **J05 Merge/receipt** | J04 green | Human-reviewed source/test commit on product branch; record upstream license provenance and test SHA; do not force push | immutable SHA, diff, commands, issue #4 objective update -> J06 |
| **J06 Public read-only evidence** | J05 plus network access | Capture independent, network-identified provider/node/Horizon/Core observations with timestamps; distinguish live reads from local fixtures | evidence bundle + independent consistency tests -> J07 |
| **J07 Operator-only authorization** | J06 plus fresh frozen candidate | Obtain exact transaction/body authorization from owner when truly needed; signing and submission are separate actions | separately authorized signed bytes / submission receipt; no reuse of expired approvals -> J08 |
| **J08 Inclusion/finality & capability gate** | J07 legally authorized transaction evidence | Verify chain-specific finality and destination-state proof independently; repeat adversarial claims tests | public-testnet evidence, tier decision and release review (never automatic promotion) |

**Flow:** `J00 -> J01 -> J02 -> J03 -> J04 -> J05 -> J06 -> [J07 human gate] -> J08`.  
**Parallelism:** Run J00/J01 for other independent chains while J07 is blocked. Never launch unrelated jobs just to fill a schedule. Each job should be idempotent (same inputs => no duplicate change), fail closed and hand the next job its exact artifact/SHA rather than conversational text.

### Chain-specific routing from existing issue #4

- **OVR-001 Cardano**: `J00` check `src/chains/cardano/preprod-*`, `evidence-binding.js`, `witness-set.js`; `J01` retain EMURGO/Aiken; `J03` wrong-current-UTxO/body/witness/expiry tests; `J06` fresh ledger parameters; `J07` only if explicit owner permission. Independent complete signed/current-ledger phase-one proof is not yet established by the historical signed preflight.
- **OVR-002 Bitcoin**: `J00` examine `psbt-v2.js`, `transaction-finalizer.js`, `core-cross-check.js`; `J01` compare bitcoinjs tagged PSBT parser as **read-only test oracle**; `J03` mutated inputs, outputs/change/fee, witness/signer set, stale Core observations; `J06` read-only Bitcoin Core Signet; do **not** imply immutable rescue semantics or broadcast.
- **OVR-003 Stellar**: `J00` native recovery, `horizon-proof-driver.js` and evidence tests; `J01` use existing Stellar SDK; `J03` preAuthTx used once, threshold/extraSigners, trustline asset and hash/ledger cross-links; `J06` official Testnet Horizon evidence. Soroban is a separate scoped project if >2 contacts are needed.
- **OVR-004 XDC/EVM**: `J00` inspect network registry, `finality-evidence.js` and XDC provenance tests; `J01` adopt narrowly from OpenZeppelin only if Solidity requires it; `J03` wrong chain ID, altered receipts, reorg/insufficient confirmations, rescue-destination change; `J06` independent read-only RPC. No automatic deployment.
- **OVR-005 XRPL**: `J00` `native-composition.js`, `native-recovery-sequence.js`; `J01` preserve pinned xrpl.js; `J03` assert truth of SignerList/Escrow/Delegation semantics and fail-closed unsupported resettable inactivity. **Do not** equate fixed-date escrow with heartbeat recovery.
- **OVR-006 Integration**: `J04` full `npm test`/`npm run check`, `J05` SHA/coverage and noncustodial release gates; no support promotion until `J08`.

## Making implementation correct on first integration

For **each** selected reuse candidate:

1. Freeze source HEAD; confirm no earlier commit/test already solved it.
2. Fetch tagged upstream release, exact source/LICENSE/NOTICE and security advisories. Identify last supported version, transitive dependencies, API compatibility, build target and available independent tests. Never copy snippets blindly from a search result.
3. Specify a **contract-first integration**: exact input/output schema, chain/network identity, policy ownership, trust boundary, failure modes, and what success must *not* authorize.
4. Add a failing positive/negative fixture for the demonstrated gap **before** integrating. Include one independent oracle when feasible, but do not use the same parser on both sides as purported independent proof.
5. Adopt minimum upstream component: dependency import first if supported; direct source copy if the license allows it and the dependency is unsuitable; new code only for OmegaVault-specific invariants. Retain upstream copyright/licensing/provenance and pinned integrity.
6. Freeze existing output hashes and evidence schema, add compatibility adapters rather than silent migrations, rerun focused suites, then full regression.
7. For every failed run keep the patch and real error; never claim green from a step that did not execute. Document rollback with previous commit and dependency pin.
8. Accept a finished **objective**, not a quota of commits. Promote only after independent network and operator gates.

### Artifact contract (suggested, not currently implemented)

The linking mechanism should store a per-job manifest containing:

```json
{
  "objective": "OVR-002",
  "job": "J03",
  "baseSha": "<40-char commit>",
  "upstream": {"url":"https://github.com/bitcoinjs/bitcoinjs-lib","tag":"<vetted tag>","license":"MIT"},
  "changedFiles": ["test/example.test.js"],
  "command": "node --test test/example.test.js",
  "exitCode": 0,
  "evidenceDigest": "<sha256>",
  "authorization": "offline-read-only",
  "nextJob": "J04"
}
```

Never fabricate a manifest's exit code, SHA, hash or claimed upstream review. Link actual outputs from prior jobs by digest/commit and verify exact match before consuming. An absent/failed job produces a blocker receipt and **must not** unlock a dependent job.

## Operating cost control through October 2026

- The account's GitHub-hosted Actions minutes have reportedly reached the free allowance; GitHub's billing banner blocks new runner allocation. A red zero-step check is an **infrastructure failure, not a code regression**.
- **Manual mode**: perform focused offline tests in an actual Node 22.12+ environment with dependencies present. `npm test` and `npm run check` must be actually executed before claiming overall green. Connected GitHub file edits alone cannot execute tests.
- Commit substantive source/tests only after actual checks, or place unverified proposed patches on a separately identified review branch rather than marking them validated.
- Avoid useless push storms: many pushes generate blocked CI runs; batch only related tested changes. Do not disable or cancel existing automations/incident logs.
- After the monthly GitHub allowance resets, use a single curated verification run per meaningful release candidate; stop heavy 24/50-pass experiments as a default cost strategy.
- If continuous capacity is needed, the existing `.github/offhost/` code on `automation/omegavault-hourly` is **not deployed**. An isolated trusted machine/VM can run tests without GitHub-hosted minutes, subject to secure scoped credentials, uptime and actual installation.
- GitHub free-minute quota belongs to the billing account, not repository; a second repo under the same owner does not reset it.

## First practical work packet (do not assume a fix is needed)

**Bitcoin OVR-002 independent PSBT-v2 oracle** is the highest immediate low-cost reuse experiment, because `bitcoinjs-lib` is MIT, JavaScript-native and appropriate for a second parser while the existing implementation/test surface is extensive.

1. Pin a tagged compatible `bitcoinjs-lib` release and read its PSBT version support before installing. **If it does not fully support OmegaVault's PSBT v2 semantics, do not silently convert a v2 PSBT to v0 or claim full oracle coverage**; restrict comparison to valid common transaction serialization or choose another maintained BIP370-aware library.
2. Confirm one real uncovered test case in the existing `test/bitcoin-*` suite; no uncovered case -> record verified skip and advance to Stellar/Cardano.
3. Create a test-only comparison: approved input outpoints, recipient outputs/change, transaction digest and exact final bytes; vary one field per adversarial test.
4. Run focused test and full tests/check locally; save command/output, SHA, upstream tag and source license.
5. Only then integrate. Do not touch signing, send/broadcast, wallets, secret material or production capabilities.

**Secondary parallel packet:** Cardano J00 signed/current-ledger gap verification; if a true independent node/ledger phase-one oracle is required, classify as an external-environment gate rather than manufacturing another local CBOR validator.

## Acceptance of this guide

This document is **not** proof that any new upstream dependency has been installed, any test executed, code merged, worker deployed or chain promoted. It is a linked execution plan. Execution receipts belong to real git SHAs/tests and issue #4. The D1 diagnostics/incident ledger and authority boundaries remain unchanged.
