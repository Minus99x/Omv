# Stellar native recovery — 0.6.2 offline design record

## Decision

OmegaVault's exact native Stellar path is intentionally bounded:

- one or two trusted contacts;
- N-of-N contact approval;
- contacts are transaction `extraSigners`, not account signers;
- one `preAuthTx` account signer binds authorization to the exact recovery envelope;
- `minAccountSequenceAge` gates the envelope on owner inactivity;
- a fee-bump envelope may sponsor submission without modifying the signed inner transaction;
- broader M-of-N policies use the Soroban fallback.

This avoids a security flaw in the earlier generalized weighted-signer proposal. If contacts were ordinary account signers and the configured contact population exceeded the selected threshold, a sufficient subset could potentially authorize a different account transaction. Requiring the contacts as envelope preconditions binds their signatures to the pre-authorized recovery transaction instead.

## Offline artifact

`buildRecoveryEnvelopeArtifact()` now:

1. validates Stellar StrKey checksums;
2. canonicalizes asset amounts to seven decimal places without floating-point conversion;
3. fixes network passphrase, source, future sequence, minimum source sequence, minimum sequence age, extra signers, fees and rescue payment operations;
4. emits transaction-envelope XDR;
5. computes the transaction hash and `T...` preAuthTx signer;
6. decodes and re-encodes the XDR with the pinned SDK and rejects any round-trip/hash mismatch.

The deterministic test fixture currently binds hash `32bf2e38816f6f50b5f765593f38e4effe9f07f8224dfa948eaf42005afa0917` to the two-asset local intent fixture.

## Fail-closed checks

- Exact configured contact count is required; duplicates, unknown signers, missing signatures and extra signatures are rejected.
- Account snapshot verification checks sequence headroom, thresholds, master weight, exact preAuthTx signer presence/weight and unexpected signers.
- The exact native builder rejects M-of-N and more than two contacts rather than weakening the policy.
- An included failed transaction is treated as consuming the matching preAuthTx signer. The same envelope is never blindly retried.
- Asset/trustline state still requires immediate pre-submission verification because a pre-authorized envelope is immutable and bounded to declared amounts.

## Toolchain and primary references

- `@stellar/stellar-sdk` pinned at `17.1.0`; Node.js `>=22.12`.
- Stellar transaction preconditions and extra-signer rules: <https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions>
- Stellar signatures, extra-signature failure and preAuthTx behavior: <https://developers.stellar.org/docs/learn/fundamentals/transactions/signatures-multisig>
- CAP-21 generalized transaction preconditions: <https://github.com/stellar/stellar-protocol/blob/master/core/cap-0021.md>
- CAP-28 failed-transaction preAuthTx clearing: <https://github.com/stellar/stellar-protocol/blob/master/core/cap-0028.md>
- CAP-15 fee-bump transactions: <https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md>
- SDK releases: <https://github.com/stellar/js-stellar-sdk/releases>

## Current maturity

The dependency-restoration gate is cleared. The pinned `@stellar/stellar-sdk` 17.1.0 stack executes in clean CI and was also exercised on Windows.

The offline execution-evidence pipeline now covers:

- deterministic recovery XDR construction and round-trip verification;
- exact contact-signature set verification;
- owner heartbeat XDR and owner-signature verification;
- fee-bump inner/outer envelope binding;
- exact `tx_bad_minseq_age_or_gap` (native minSeqAge) and success result-code requirements;
- Testnet network-identity fail-closed checks;
- digest-bound success evidence for initial too-early rejection, heartbeat reset, post-heartbeat too-early rejection, eligible N-of-N recovery, rescue-balance movement and finality;
- digest-bound failed-applied evidence proving that an applied failed recovery consumes the matching one-time `preAuthTx` signer and forbids retry of the same envelope;
- execution-input manifest binding;
- driver-injected recovery orchestration;
- fail-closed Horizon response normalization and HTTP transport;
- end-to-end Horizon-driver integration coverage.

The connector remains `offline-verified`, not `live-proof`.

## First genuine public-Testnet native recovery — 2026-10-12 (development)

A standalone, expressly gated **disposable Testnet-only** runner now uses fresh ephemeral keys (never customer or owner wallets), funded by Friendbot, to execute a real native Stellar recovery with **one trusted contact** and **1-of-1 threshold**.

The real on-ledger sequence was:

1. Fund separate disposable vault and rescue G-accounts using fake Testnet XLM.
2. Build the immutable **1.0000000 XLM** rescue payment envelope with a preauthorized transaction hash, trusted-contact extra-signer and `minAccountSequenceAge`.
3. Sign that exact recovery envelope with the disposable contact key.
4. Owner-sign and submit a real atomic `setOptions` setup to register the one-time `preAuthTx` account signer (the contact is **not** an account-wide signer).
5. Observe the real account signer and sequence through Horizon; wait until ledger close-time proves inactivity eligibility.
6. Submit the contact-signed recovery; verify inclusion, ledger hash/finality, exact 1-XLM rescue balance increase and consumption of the one-time `preAuthTx` signer.

**Recorded public-Testnet evidence:**

- Dev commit: `fc2a71aca6333258e084b99fcbb1da1fd47fd6cf`.
- [Successful isolated GitHub Actions execution](https://github.com/Minus99x/Omegavault/actions/runs/38330316217).
- Setup transaction: `b53b11b3773c7fc23767c261a50f3c2aba3953487946ddd99a6882183a6f7ff5` (ledger **5165976**).
- Recovery transaction: `3c0948a212195dc2449c4a7b0cb87bcd55e9a6ef986941d7b7e651d11eefcb69` (ledger **5165980**).
- Ledger hash: `b18b12c25fa8e7539ff32a0e57a1bcaedf79454237a7c40cfbbb413e2259f2b1`.
- Verification booleans recorded: owner signer setup, exact contact binding, sequence-age eligibility, rescue credit and single-use signer consumption, all **true**.
- Source: `scripts/stellar-testnet-live-disposable-recovery.js`; Tests: `test/stellar-testnet-live-disposable-recovery.test.js`.

**Scope is deliberately narrow:** This proves a *single genuine on-network native recovery*, not the full OmegaVault lifecycle, broad M-of-N, token rescue, owner heartbeat/reset, premature failure, failed-applied/preAuth consumption, all chain invariants, repeated reliability or external security audit. No mainnet, real assets, customer keys or chain-support promotion.

## Public-Testnet owner-heartbeat/reset and 1-of-1 recovery — 2026-10-12

The native proof runner was extended on **fresh disposable Stellar Testnet accounts**, using an owner-signed `bumpSequence` heartbeat and the **same immutable contact-signed recovery envelope** before and after that heartbeat.

[Successful end-to-end public-Testnet run](https://github.com/Minus99x/Omegavault/actions/runs/38331699707) confirms:

1. Owner-authorized on-ledger setup: transaction `8fe93873b144ff891db049df7d68a33f8978caf5d06d80f8d287db98061e19c0`, ledger **5166181**.
2. The premature recovery was rejected with Stellar's **actual minimum-sequence-age code `tx_bad_minseq_age_or_gap`**. The vault sequence, one-time `preAuthTx` signer and rescue balance remained unchanged.
3. Owner heartbeat: `49e89d58f31c93e8c2a164bc85ee379620a4f98fdd859366d8b46324fb4e4d00`, ledger **5166182**; verified new source sequence/sequence-time and preserved recovery signer.
4. The **same** recovery envelope was rejected again after heartbeat with `tx_bad_minseq_age_or_gap` and no balance or signer change.
5. After **45 seconds** of new account-sequence age as observed using real ledger close times, recovery `62ea42fbfe668809d2b61ec8541b01c127ba2e03ba19e6790df264f315d683b0` succeeded in ledger **5166192**, ledger hash `6e7403d3d45a325895f0073a09122fd3b1fe5c9c88c3b74232835eebad98aa7b`.
6. Horizon confirmed exact **1.0000000 fake XLM** rescue credit and consumption of the single-use `preAuthTx` signer.

**Important protocol correction:** The previous synthetic evidence path modeled early native recovery as `txTOO_EARLY`, which is for absolute `minTime` timebounds. Native `minAccountSequenceAge` enforcement instead returned `tx_bad_minseq_age_or_gap` on actual public Testnet. Normalization, injected driver fixtures, evidence checks and negative tests were corrected to require the real native result, without accepting unrelated network rejection codes as evidence of an inactivity rule.

This verifies a meaningful **1-of-1 owner-heartbeat and native recovery sequence**, not multi-contact threshold coverage, broad asset rescue, failure-applied one-time authorizer consumption, adversarial end-to-end threats, or production readiness. No customer assets or owner wallets were involved.

## Public-Testnet 2-of-2 independent-guardian native recovery — 2026-10-12

With two independently generated disposable contact keys, the same native Testnet path (one exact pre-authorized recovery, extra signers and owner sequence-age heartbeat) has now passed a complete public-network execution:

- [Successful one-shot 2-of-2 GitHub Actions run](https://github.com/Minus99x/Omegavault/actions/runs/38336534794), commit `cd99f1ea3a47b15fa588a93129e0fa2282495731`.
- Owner's native setup transaction: `ce172fd4966ba444398df62b28e3faa9f8130176d7492a18d5cd46f8e08d7da3`, ledger **5166913**.
- Early recovery rejected with `tx_bad_minseq_age_or_gap`; both vault state and rescue balance unchanged.
- Owner's real `bumpSequence` heartbeat: `59621a2775c2b5240b6b3c45413e0a1d4aa71cf95c2208e781e6336820b53a6c`, ledger **5166914**, and the same signed envelope rejected a second time.
- Recovery transaction: `1e9fe486e26895b3959964d775c4087dacc68393c49d2d0f4eb81d22e5aa96ac`, ledger **5166924**, ledger hash `5cc7552103920f34767a84541f157c433b65383402560886247e85e817e8ff10`.
- After a **45-second sequence-age interval** measured against ledger close times, Horizon confirmed **exactly 1.0000000 fake XLM** credited to the designated rescue wallet and removal of the one-time preAuthTx signer.
- Offline negative test separately confirms one signature does not satisfy 2-of-2; the native execution was signed by two separate ephemeral contact keypairs, not by owner or an account-wide trusted-contact signer.

This is a genuine two-guardian public-Testnet proof with disposable tokens, not an assertion of production readiness or support for arbitrary M-of-N. Native Stellar transaction preconditions allow at most two extra signers; broader policies need their own separately verified Soroban implementation.

## Live disposable 2-of-2 fee sponsorship — 2026-10-12

[Successful Stellar sponsored Testnet run](https://github.com/Minus99x/Omegavault/actions/runs/38345033796) used fresh vault, rescue, two guardian and fee-payer keypairs, all generated within one isolated CI process and funded with disposable Friendbot Testnet XLM.

- Owner setup: `b277367c84b1da46b37814b3d50ade7da0b47c1878d3ce76b26157dcceffe673`, ledger **5168195**.
- Initial recovery was rejected with native `tx_bad_minseq_age_or_gap`; owner heartbeat `963bf0eb68d403ef09edbc228d1bb01587088eeb496b75a722bb811f38916441` was included in ledger **5168196**, and the same signed recovery was rejected again.
- Following 45 seconds of current sequence-age eligibility, exact preauthorized **inner recovery** hash `a65de38a55e54b47f1998566ad1279ef479930ee426d7abdc716ee5792ffc9bd` was included inside sponsored **outer fee-bump** hash `e3389bbc6d4c14b9464f3ed800c4f2526c4ec21eeb914f4c7e25c1eb71cb11e8`, ledger **5168206**; ledger hash `0b8fea5c5e094d49c53e3022f04e9740205bce76d65d070e49527d3f5620209b`.
- Independent signer and sponsor checks validated the on-ledger signed envelope XDR byte-for-byte, original guardian signatures and rescue destination, exact one-XLM rescue credit, and consumed one-time `preAuthTx` signer.
- Horizon charged the separate disposable fee payer **200 stroops**, versus maximum bid cap 1,000 stroops; actual sponsor XLM balance decreased by the exact charge and vault XLM balance decreased by only **1.0000000** for the protected recovery.
- Earlier live attempt [run 38344820722](https://github.com/Minus99x/Omegavault/actions/runs/38344820722) rejected proof because the verifier expected a top-level Horizon inner hash not guaranteed by the API. The corrected verification validates the canonical on-ledger XDR first and uses optional metadata for conflict detection. An evidence-format failure must not be confused with an on-chain transaction failure.

Scope: genuine public Stellar Testnet, fee-bump sponsor, two independently generated contact identities and XLM native asset only. It does **not** prove token recovery, failed-applied one-time authorization handling on public Testnet, broadly variable guardian thresholds or production security. No mainnet funds or user wallets were used.

## Remaining promotion gate

Additional real public-Testnet cases remain required: **classic asset/trustline preflight, failed-applied `preAuthTx` consumption**, owner/contact compromise scenarios, complete independent security review and release policy. The already-tested driver-injected pipelines remain valuable regressions but cannot substitute for chain evidence.

Stellar remains **not promoted for product support**; observed Testnet milestones do not authorize deployment.

## Authority boundary

No Stellar code or evidence in this development block authorizes mainnet deployment, live-value transactions, wallet signing, secret handling, chain promotion, deployment authority or wallet authority.
