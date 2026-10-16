# Cardano Phase 1 — Scalus offline-ledger integration

Status (2026-10-15): **genuine Scalus 1.3.0 local-ledger validation executed in development CI** for test-only Cardano transactions, a synthetic adapter fixture, and a fixture-built OmegaVault Aiken beacon-mint initialize. **Actual wallet-signed/current public Preprod initialize has NOT been validated.** No public submission, production action, signing authority, or support promotion is authorized.

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

## Executed evidence — what passed, and what did not

- Real Scalus 1.3.0 (Apache-2.0) was installed in the existing GitHub Actions *development* workflow via `npm install --no-save --package-lock=false --ignore-scripts --no-audit --no-fund scalus@1.3.0`. No production dependencies or lockfile were changed.
- `npm run test:cardano:scalus` executes the actual JavaScript Scalus emulator. Its ten cases exercise: CSL test-only payment acceptance/replay/missing-witness/expiry/minimum-fee; synthetic immutable-CBOR/evidence binding to the **real** Scalus adapter; a repository-built beacon-mint initialize signed with a disposable test-only key and accepted by Scalus; rejection of the OmegaVault initialize replay, unsigned candidate, unauthorized test-key witness, and expiry.
- Independently: `test/cardano-scalus-local-validation.test.js` covers adapter contracts with a fake dependency. Never count these test-double assertions as genuine Scalus execution.
- Development CI evidence: [workflow run on code commit 3282c739](https://github.com/Minus99x/Omegavault/actions/runs/38843378743) and [first fully green Scalus run on commit 6db99ef9](https://github.com/Minus99x/Omegavault/actions/runs/38842767721). Consult GitHub for **exact** final statuses and test logs before calling any given HEAD fully CI-verified.
- **Important denomination pitfall:** `Value.ada(amount)` converts ADA to lovelace (multiplies by one million); OmegaVault's captured `value.ada.lovelace` values must be passed as `new Value(BigInt(lovelace))`, not `Value.ada(lovelace)`. The new real-ledger fixture initially exposed this discrepancy and was corrected before the ten-case suite passed.

Every fixture here is synthetic or historical. The Scalus ledger does not track current Preprod UTxOs, up-to-date protocol parameters, consensus, finality, or approvals. Acceptance cannot promote `completePhaseOneValidated` or imply authorization to sign/submit.

## Remaining integration gates

1. For reproducibility, pin/check npm package integrity and provenance if Scalus becomes a long-term development dependency. Preserve the present isolated optional install and existing production lockfile meanwhile.
2. Feed the **previously verified actual** wallet-signed OmegaVault initialize CBOR and exact captured input/protocol snapshot through the adapter, if those historical artifacts are independently available, explicitly as an expired-slot offline diagnostic only. **Never** reuse an expired witness for fresh Preprod submission, or require the Captain to sign solely to repeat tests.
3. Exercise genuine `initialize → heartbeat → approve → execute` emulated state transitions using OmegaVault-built CBOR and enforce immutable rescue behavior. The fixture-only initialize stage now passes; later actions remain outstanding.
4. For genuine **current public** Preprod phase-one validation, independently verify current node state, parameters, real signed bytes, UTxOs and an unexpired fresh authorized candidate. Network submission requires separate explicit authorization.

**Operator action right now: none.** Do not ask for a new account, provider credential, Lace signature, funding, or console rerun to complete these offline engineering gates.
