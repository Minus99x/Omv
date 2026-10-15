# Cardano Phase 1 — Scalus offline-ledger integration

Status: **adapter and fixture tests implemented; genuine Scalus execution NOT YET VERIFIED**. No public Preprod transaction, wallet signature, submission, production action or promotion is authorized.

## Why this route

OmegaVault already constructs Cardano initialize CBOR with the pinned Cardano serialization library and obtains Ogmios evaluation, an owner witness and pre-submit evidence. Ogmios evaluateTransaction does not constitute complete signed/current-ledger phase-one validation. Instead of rebuilding a ledger emulator, replay the **unaltered** signed CBOR in the external open-source Scalus JavaScript in-memory ledger.

Upstream: https://scalus.org/docs/testing/js-emulator
Package: https://www.npmjs.com/package/scalus (Apache-2.0, review package version/license at install time).

This is a local independent implementation; the emulator does not fetch current Preprod UTxOs or protocol parameters, validate provider authenticity, simulate consensus, prove finality, or substitute for a current Preprod node's phase-one validation. It can expose construction errors before returning to the wallet/provider path.

## What was implemented

- `src/chains/cardano/scalus-local-validation.js` exports `runCardanoScalusInitializeTrial`. It requires existing v2 pre-submit evidence, verifies its canonical digests, requires the exact signed CBOR SHA-256, checks the stable-tip ledger-input snapshot and two plain ADA-only UTxOs, then creates `Emulator.create(CardanoInfo.preprod(), { utxos, slot })` and calls local `emulator.submitTx`.
- The local result **always** retains false for current-public-Preprod phase-one proof, submission authority, public-network recovery, and support claims, even if accepted by the emulator.
- `test/cardano-scalus-local-validation.test.js` runs with `npm test` and uses an injected fake Scalus API strictly to validate our adapter contract. **These tests are not actual Scalus ledger executions.**
- `scripts/cardano-scalus-ledger-regression.mjs` is a separate opt-in REAL Scalus regression runner. It builds an ephemeral test-only CSL payment transaction and checks local acceptance, replay rejection, no-witness rejection, expired-validity rejection, and low-fee rejection. It neither contacts a public network nor uses real wallet credentials.

## Engineering-only execution (not a user workstation task)

Where network-enabled engineering CI or a disposable development environment is available:

```sh
npm ci
npm install --no-save --package-lock=false --ignore-scripts scalus@1.3.0
npm run test:cardano:scalus
npm test
```

The Scalus package is an **opt-in development tool** and is deliberately not added to the pinned OmegaVault production dependency lock. Do not run `npm audit fix`. If installation fails, report **real-emulator verification blocked**, never silently count an injected-fake test as real ledger evidence.

## Remaining integration gates

1. Run the dedicated **actual Scalus** test and fix any API/protocol differences against `scalus@1.3.0`. Reconcile the package hash and provenance before any long-term dependency pin.
2. Feed a fresh already-verified OmegaVault initialize CBOR and exact current input snapshot through the adapter; capture actual emulator acceptance or rejection and its rule, without collecting another wallet signature solely for this step. Historical expired signed CBOR can be replayed only as an explicit offline diagnostic at its old slot, never as current readiness.
3. Exercise actual `initialize -> heartbeat -> approve -> execute` emulator state transitions using OmegaVault-produced CBOR. Keep this separate from live Preprod proof.
4. For genuine current Preprod phase-one validation, integrate complete ledger validation against current independent node state and a **fresh** explicitly authorized signed candidate. Submission remains a separate human gate.

**Operator action right now: none.** Do not ask for a new account, provider credential, Lace signature, funding, or console rerun to complete these offline engineering gates.
