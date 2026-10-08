# Cardano Preprod Signed / Current-Ledger Phase-One Audit

Status: repository-side audit for the post-wallet-witness gate on `dev/0.6.60-reconcile-overnight-bitcoin`.

## Purpose

Define exactly what OmegaVault already proves after a real Preprod initialize capture, an owner Lace signature, and the live pre-submit freshness check — and what must remain **unproven** until an independent complete signed/current-ledger phase-one validation gate exists.

This document does not authorize signing, submission, value movement, support promotion, or any public-network recovery claim.

## Evidence already covered before the remaining phase-one gate

The current pipeline can prove all of the following without claiming complete phase-one validation:

1. **Frozen unsigned candidate**
   - exact seed input and collateral input are bound to real Preprod UTxOs;
   - transaction CBOR round-trips canonically;
   - transaction body hash is bound to evidence;
   - network id is Preprod/testnet;
   - required signer is the bound owner payment key;
   - state output is locked at the derived recovery validator;
   - wallet change and collateral return go back to the bound wallet addresses;
   - min-ADA, fee, collateral, ADA conservation and value-size rules are checked;
   - the transaction validity flag must be true;
   - no wallet key witness is present.

2. **Wallet-produced owner witness**
   - the signed transaction body must be byte-for-byte identical to the frozen body;
   - auxiliary data and non-wallet witness material must remain unchanged;
   - exactly one owner VKey witness is accepted;
   - the witness public-key hash must equal the bound owner payment-key hash;
   - the Ed25519 signature is verified against the frozen transaction body hash;
   - the signed transaction validity flag must be true;
   - transaction submission remains unauthorized.

3. **Live pre-submit freshness evidence**
   - current protocol parameters are independently confirmed and digest-bound;
   - the protocol snapshot is bound to the same stable tip used for freshness checks;
   - the frozen unsigned preflight still reproduces under the current parameters;
   - actual signed transaction size remains within the current maximum;
   - evaluated execution units remain within the current transaction limit through the minimum-fee calculation;
   - the signed fee covers the current minimum;
   - output values remain within the current maximum value size;
   - the seed and collateral UTxOs are still unspent and unchanged;
   - the validity interval is current;
   - the exact signed body still matches the frozen candidate.

## Deliberately unproven

After all evidence above passes, these claims must still remain false:

- `completePhaseOneValidated`
- `transactionSubmissionAuthorized`
- `transactionSubmissionPerformed`
- `liveValueMovementAuthorized`
- `publicNetworkRecoveryProven`
- `supportClaimAuthorized`

The repository currently has no evidence type that is permitted to flip `completePhaseOneValidated` to true.

## Remaining gate

The next engineering milestone is an **independent complete signed/current-ledger phase-one validation** mechanism that:

- consumes the exact already-verified signed transaction bytes;
- is evaluated against a current Cardano Preprod ledger state;
- produces reproducible evidence bound to the signed transaction digest and current ledger/tip evidence;
- cannot mutate or rebuild the signed transaction;
- cannot silently submit or broadcast the transaction;
- leaves transaction submission authorization false;
- fails closed on stale inputs, stale validity, parameter drift, mismatched transaction bytes, or incomplete node/ledger evidence.

Until such a mechanism is implemented and proven, the pre-submit freshness artifact is the strongest signed/current-ledger readiness evidence and must not be described as complete phase-one validation.

## Submission boundary

Even after future complete phase-one validation succeeds, submission remains a **separate explicit human authorization gate**.

No tool, CLI, wallet bridge, provider diagnostic, or evidence verifier in the pre-submit path may infer submission authority from successful validation.

## Current operator sequence

1. generate a fresh real Preprod initialize capture;
2. review the frozen unsigned candidate;
3. explicitly authorize signing for the exact transaction body hash;
4. obtain the owner Lace witness;
5. verify the wallet witness offline;
6. run live pre-submit freshness checks;
7. complete the future independent signed/current-ledger phase-one validation gate;
8. separately request explicit human authorization for Preprod submission;
9. only then may a submission path be considered;
10. prove inclusion/finality and exercise the actual recovery lifecycle before any support promotion.

