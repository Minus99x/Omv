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

## Remaining promotion gate

An actual Stellar Testnet execution is still required. The public-network evidence must populate the already-hardened pipeline with real Horizon observations for the too-early/heartbeat/recovery/finality sequence and the failed-applied case.

Injected drivers, fixtures and clean CI prove the implementation and evidence contracts; they do not establish public-Testnet execution proof or chain promotion.

## Authority boundary

No Stellar code or evidence in this development block authorizes mainnet deployment, live-value transactions, wallet signing, secret handling, chain promotion, deployment authority or wallet authority.
