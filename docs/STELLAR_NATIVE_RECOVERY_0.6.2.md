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

## Remaining promotion gate

This connector remains `scaffold`, not `live-proof`. The remaining gate is a complete Stellar Testnet run with too-early rejection, heartbeat reset, eligible N-of-N execution, fee-bump submission, rescue-balance verification, failed-operation handling and exported digest-bound evidence.
