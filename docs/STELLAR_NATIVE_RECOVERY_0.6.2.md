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
- exact `txTOO_EARLY` and success result-code requirements;
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

## Remaining promotion gate

Real public-Testnet **heartbeat/reset and post-heartbeat rejection** remain to be demonstrated alongside failed-applied consumption, wider asset/role cases, negative adversarial evidence, release security review and the full lifecycle binding. The earlier driver-injected end-to-end runs are still synthetic; they cannot be substituted for these public-network proofs.

This isolated native-recovery milestone does **not** remove the existing chain promotion blockers or authorize product deployment.

## Authority boundary

No Stellar code or evidence in this development block authorizes mainnet deployment, live-value transactions, wallet signing, secret handling, chain promotion, deployment authority or wallet authority.
