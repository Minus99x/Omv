# OmegaVault Cardano Preprod First-Time Operator Handoff — 0.6.60

Status: **development handoff until the 0.6.60 checkpoint is sealed**

## Current operator path — first real initialize

The earlier four-action synthetic/evaluation campaign is complete and remains useful as regression evidence, but it is **not** today's primary workstation objective.

For the next real Cardano Preprod milestone, use:

```powershell
npm.cmd run cardano:preprod:real-initialize:guided
```

The guided command is designed for a short Windows console window. It collects the owner/rescue/contact Preprod addresses and any missing provider values through the clipboard, validates them without printing secrets, checks the owner wallet has two distinct plain ADA-only UTxOs, writes an append-only recovery configuration/session plan, and launches the real initialize read/evaluation capture.

It stops at an unsigned candidate. Wallet signing and submission remain unauthorized.

See `docs/CARDANO_PREPROD_REAL_INITIALIZE_QUICKSTART.md` for the exact one-command-at-a-time workstation sequence.


This runbook minimizes user-controlled workstation time while preserving every OmegaVault non-custodial and evidence boundary.

## BLUF

**Live milestone reached 2026-10-06:** the guided public-Preprod campaign completed synchronized evaluation for the full lifecycle `initialize → heartbeat → approve → execute`. The successful result remained evaluation-only: no wallet signing, transaction submission, full phase-1 validation, finality claim, public recovery claim or support promotion occurred.

The live work exposed and corrected two transport/encoding boundaries before that successful campaign: Aiken `compiledCode` must be preserved as the CBOR-encoded Plutus V3 witness bytes, and Ogmios v7 structured validator pointers must normalize to OmegaVault's canonical `purpose:index` form. Both corrections are regression-tested.

For the current Cardano public-Preprod **evaluation-only** gate, the workstation needs:

1. Git.
2. Node.js >= 22.12 and npm.
3. The sealed OmegaVault checkpoint bundle/source.
4. Internet access.
5. One Cardano **Preprod Ogmios** endpoint.
6. One independent **Blockfrost Preprod** project ID.

The current gate does **not** require:

- a local `cardano-node`;
- a full Cardano chain sync;
- Docker;
- `cardano-cli`;
- a wallet;
- faucet test ADA;
- a wallet signature;
- transaction submission;
- real ADA.

The live command obtains current protocol parameters before constructing candidates. It refuses stale static protocol data as a basis for the live campaign.

## Network identity

Use **Cardano Preprod** only.

- network id: `0`
- network magic: `1`
- test address prefix: `addr_test1`

Do not use Preview or Mainnet for this campaign.

## First-time service setup

### A. Managed Ogmios — fastest path

A managed Ogmios endpoint avoids installing and synchronizing a full Cardano node.

OmegaVault is provider-neutral. One workable option is Demeter:

- https://demeter.run/ports/cardano-ogmios-port

Create/select a project, enable an **Ogmios Port on Preprod**, then copy:

- the Preprod HTTP endpoint;
- the API key, unless using an authenticated endpoint with the key embedded in the hostname.

For a normal Demeter endpoint, the documented header name is `dmtr-api-key`.

PowerShell example:

```powershell
$env:OMEGAVAULT_OGMIOS_URL="https://YOUR-PREPROD-OGMIOS-ENDPOINT"
$env:OMEGAVAULT_OGMIOS_API_KEY="YOUR-OGMIOS-KEY"
$env:OMEGAVAULT_OGMIOS_API_KEY_HEADER="dmtr-api-key"
```

If the provider gives an authenticated URL that needs no separate header, set only `OMEGAVAULT_OGMIOS_URL`.

**Never commit endpoint credentials or API keys into OmegaVault.**

### B. Blockfrost Preprod — independent confirmation

Create a Blockfrost project specifically for **Cardano Preprod**:

- https://blockfrost.io/

The Preprod API base used by the tooling is:

`https://cardano-preprod.blockfrost.io/api/v0`

Copy that project's `project_id` and set it only in the workstation environment:

```powershell
$env:BLOCKFROST_PROJECT_ID="YOUR-PREPROD-PROJECT-ID"
```

OmegaVault cross-checks Ogmios and Blockfrost for:

- current epoch;
- protocol version;
- fee coefficients;
- max transaction size;
- max serialized output-value size (`maxValueSize`);
- coins per UTxO byte;
- script execution prices;
- max transaction execution units;
- collateral percentage/input limit;
- the complete 350-entry Plutus V3 cost model.

A disagreement fails closed before campaign evidence is accepted.

## Workstation sequence

Keep two directories separate:

- **0.6.60 live-evaluation tooling checkout** — run the commands from here.
- **sealed 0.6.59 source** — never modify it; the gate verifies it against the sealed bundle.

### 1. Install pinned tooling dependencies

From the 0.6.60 tooling checkout:

```powershell
npm.cmd ci
npm.cmd run preflight:workstation
```

### 2. Verify the separate sealed package — no network capture yet

Still from the 0.6.60 tooling checkout:

```powershell
npm.cmd run cardano:preprod:first-run -- --bundle-dir "<PATH-TO-SEALED-BUNDLE>" --sealed-source "<PATH-TO-SEALED-0.6.59-SOURCE>" --campaign "<PATH-TO-NEW-LIVE-CAMPAIGN-DIR>"
```

The tooling source and sealed source are intentionally different. The gate records both source-tree identities and fails closed if the sealed source does not match its checkpoint manifest.

This verifies:

- checkpoint manifest;
- exact source archive;
- extracted source tree;
- dependency lock;
- external review index;
- pinned dependency readiness.

It performs no Cardano network request and creates no stale campaign.

### 3. Run the one-command public-Preprod evaluation campaign

After the Ogmios and Blockfrost environment variables are set:

```powershell
npm.cmd run cardano:preprod:campaign:capture -- --campaign "<PATH-TO-NEW-LIVE-CAMPAIGN-DIR>" --bundle-dir "<PATH-TO-SEALED-BUNDLE>" --sealed-source "<PATH-TO-SEALED-0.6.59-SOURCE>"
```

That command first re-runs the sealed-checkpoint workstation gate and writes its receipt into the new campaign directory. It will not make a network request if the sealed source/archive/review/dependency identity fails.

Then it:

1. reads a stable Ogmios Preprod tip;
2. obtains the current epoch and current protocol parameters;
3. independently confirms them with Blockfrost Preprod;
4. fails closed on any parameter/cost-model disagreement;
5. constructs the four lifecycle evaluation candidates using the **current** Plutus V3 cost model and a validity interval anchored to the captured live Preprod tip slot;
6. binds an explicit synthetic supplemental UTxO context for the deterministic offline fixture references using the current Ogmios v7 `additionalUtxo` request field and flat UTxO schema;
7. for each action — `initialize`, `heartbeat`, `approve`, `execute`:
   - reads a tip immediately before evaluation;
   - runs Ogmios `evaluateTransaction`;
   - reads the tip immediately afterward;
   - retries if the tip changed;
   - writes the acquired-tip, protocol-parameter and evaluation evidence;
   - runs the session verifier;
8. runs the complete campaign verifier.

It does **not** request a wallet signature or submit a transaction.

## What the current campaign proves

A successful campaign can establish:

- public-Preprod execution-unit evaluation of the exact prepared lifecycle candidates;
- current independently confirmed protocol parameters;
- stable-tip evaluation binding;
- exact campaign/invariant/session/candidate identities;
- fail-closed evidence integrity.

It explicitly reports:

- `fullPhaseOneValidated: false`
- wallet signing: false
- transaction submission: false
- public-network recovery proven: false
- support claim authorized: false

Ogmios transaction evaluation is not complete phase-1 ledger validation. The later gate must first apply evaluated execution budgets to a finalized transaction candidate, then independently perform full phase-1 checks.

## Post-evaluation construction — offline, no provider credentials

After a synchronized campaign has completed successfully, the 0.6.60 tooling can derive the next fail-closed construction artifacts without another network call:

```powershell
npm.cmd run cardano:preprod:campaign:construct:evaluated -- --campaign "<PATH-TO-COMPLETED-LIVE-CAMPAIGN-DIR>"
```

This constructor:

1. verifies the campaign/session manifests and the captured synchronized evaluation evidence before writing anything;
2. applies the captured safety-margin execution budgets to each action;
3. recomputes script-data hashes and converges the fee using the expected fixed-size wallet witness count;
4. excludes all synthetic sizing witnesses from the derived unsigned candidates;
5. writes one append-only `evaluated-unsigned-construction.json` per lifecycle session plus `evaluated-construction-manifest.json` at campaign root;
6. keeps `ledgerUtxoExistenceValidated`, `fullPhaseOneValidated`, wallet-signing authorization, submission authorization, finality and support promotion explicitly false.

The derived candidates still use the campaign's synthetic supplemental UTxO context. They are evidence/engineering artifacts for the next gate, **not submit-ready transactions**.

The next live gate is therefore narrowed to **real Preprod UTxO binding plus complete phase-1 validation**. Wallet signing and submission remain later and separately authorized steps.

## Real-UTxO initialize path — implemented, not yet executed

The development branch now contains a separate real-Preprod initialize path. It does not reuse the synthetic `additionalUtxo` fixture context.

The path now:

1. discovers the wallet's Cardano Preprod UTxOs through Blockfrost;
2. deterministically selects two distinct plain ADA-only outputs: one seed/funding input and one collateral input;
3. derives the one-shot state-beacon policy and recovery-validator identity from that exact real seed output using the pinned Aiken toolchain;
4. re-queries those exact outputs through Ogmios and binds them at one stable Preprod tip;
5. obtains and independently reconciles current Ogmios + Blockfrost protocol parameters;
6. constructs a balanced unsigned `initialize` candidate with exact state/change/collateral-return outputs, minimum-ADA checks, owner required-signer binding and a finite live validity interval;
7. evaluates the exact real-input zero-budget candidate through Ogmios;
8. applies the returned safety-margin execution budget to a new unsigned candidate;
9. runs a separate unsigned phase-one preflight that rechecks body identity, fee, ADA conservation, collateral conservation, minimum ADA, current maximum serialized output-value size, required signer and exact real input references.

That capture still reports `fullPhaseOneValidated: false`, `walletSigningAuthorized: false`, and `transactionSubmissionAuthorized: false`.

### Prepare an immutable recovery configuration from Preprod addresses

The recovery configuration can now be prepared from normal Preprod wallet addresses rather than manually extracting payment-key hashes:

```powershell
npm.cmd run cardano:preprod:recovery-config:prepare -- --rescue-address "<RESCUE-ADDR_TEST1>" --contact-addresses "<CONTACT-A-ADDR_TEST1>,<CONTACT-B-ADDR_TEST1>" --threshold 2 --inactivity-ms 60000 --output "<NEW-RECOVERY-CONFIG.JSON>"
```

The gate derives the payment verification-key hashes itself and fails closed if:

- an address is not Cardano Preprod/testnet;
- an address is script-controlled rather than key-controlled;
- trusted-contact keys are duplicated;
- the threshold is unreachable;
- the rescue destination is also a trusted-contact approval key.

This command performs no network request, signing or submission.

### Capture the real unsigned initialize candidate

Once the test-only Preprod wallet has at least two suitable plain ADA-only UTxOs and the recovery configuration exists:

```powershell
npm.cmd run cardano:preprod:real-initialize:capture -- --wallet-address "<OWNER-ADDR_TEST1>" --recovery-config "<RECOVERY-CONFIG.JSON>" --output "<NEW-REAL-INITIALIZE-CAPTURE-DIR>"
```

The existing Ogmios and Blockfrost environment credentials are used. The capture writes append-only identity, UTxO-binding, current-protocol, live-evaluation, final-unsigned-candidate and unsigned-preflight artifacts. It does **not** sign or submit the transaction.

### Wallet witness verification — prepared for a later explicitly authorized signing step

If and only if a later gate explicitly authorizes the human operator to sign the frozen initialize body in the test-only wallet, OmegaVault can verify the returned signed transaction offline:

```powershell
npm.cmd run cardano:preprod:initialize:witness:verify -- --capture "<REAL-INITIALIZE-CAPTURE-DIR>" --signed-tx "<SIGNED-TRANSACTION-FILE>" --output "<NEW-WITNESS-EVIDENCE.JSON>"
```

The verifier preserves and hashes the exact wallet-produced signed transaction bytes (normalizing only hex letter case), requires a canonical CBOR round-trip without byte substitution, and rejects body substitution, auxiliary-data changes, non-wallet-witness changes, extra/missing VKey witnesses, a wrong payment key, and an invalid signature. It never creates a wallet signature and does not authorize submission.

### Pre-submit freshness gate — prepared, still no submission

After witness verification, a separate live gate can recheck the frozen signed intent against the current Preprod state:

```powershell
npm.cmd run cardano:preprod:initialize:presubmit -- --capture "<REAL-INITIALIZE-CAPTURE-DIR>" --witness-evidence "<WITNESS-EVIDENCE.JSON>" --output "<NEW-PRESUBMIT-EVIDENCE.JSON>"
```

It requires a stable current Ogmios tip and a fresh Ogmios + Blockfrost protocol snapshot, persists and digest-binds that snapshot, proves the normalized parameters reproduce from it, enforces current `maxValueSize`, checks the fee against the actual serialized signed-transaction size and execution units, requires an unexpired validity interval, and proves that the exact seed and collateral UTxOs remain unspent with unchanged address/value/datum/reference-script shape. It still reports complete phase-1 validation and transaction-submission authorization as false.

## Wallet and faucet — prepare now only if convenient

The current evaluation gate consumes **zero test ADA** and needs no wallet.

Preparing the wallet now can shorten the later signed-public-network gate.

Recommended first-time path:

1. Install a Cardano wallet that supports Preprod. Cardano's current developer tutorial uses **Yoroi**.
2. Create a **brand-new test-only wallet**.
3. Never import a mainnet recovery phrase.
4. In Yoroi: Settings → Switch Network → **Preprod Testnet**.
5. Confirm the receive address begins with `addr_test1`.
6. Use the official Cardano testnet faucet:
   - https://docs.cardano.org/cardano-testnet/tools/faucet/
7. Select **Preprod** and request test ADA to that `addr_test1...` address.

Test ADA has no real-world value. **Never send real ADA for OmegaVault Preprod testing.**

Do not sign an OmegaVault campaign transaction yet even if the test wallet is funded.

## Self-hosted fallback — not recommended for the first session

If a managed Ogmios endpoint is unavailable, a local Cardano node + Ogmios can be used.

That adds:

- Docker or native node/Ogmios installation;
- Preprod database storage;
- initial chain synchronization;
- version compatibility management.

For an Ogmios v7-compatible pinned container pair, the documented combined-image tag pattern supports network-specific tags such as:

`cardanosolutions/cardano-node-ogmios:v7.0.0_11.0.1-preprod`

Use this only as a fallback. The managed endpoint is the shortest first-time path.

## Secrets boundary

Never put any of these in a tracked file:

- `OMEGAVAULT_OGMIOS_API_KEY`
- `BLOCKFROST_PROJECT_ID`
- wallet recovery phrases
- wallet signing keys

Environment variables are intentionally read at runtime; the capture report does not print their values.

## Hard stop

After the campaign verifier reports synchronized public-Preprod evaluation success:

**STOP.**

The implementation now covers evaluated-budget application, real-UTxO initialize construction, an unsigned structural/fee/collateral/value-size preflight, exact-byte strict wallet-witness verification, and a pre-submit freshness gate with persisted current protocol-snapshot evidence and fail-closed current-input shape checks. None of those is permitted to silently promote itself into a stronger claim.

The remaining externally gated sequence is:

1. execute the real-UTxO initialize capture on public Preprod;
2. review the frozen unsigned candidate and explicitly authorize the human wallet-signing step only when its unsigned gates are proven;
3. verify the returned wallet witness offline against the exact frozen body and exact wallet-produced signed bytes;
4. run the live pre-submit freshness gate against a stable current tip and persisted current protocol snapshot;
5. independently complete the remaining signed/current-ledger phase-1 validation;
6. separately and explicitly authorize submission;
7. prove inclusion/finality;
8. exercise heartbeat/approve/execute against the actual initialized state;
9. prove public-network recovery;
10. only then consider Cardano support promotion.

No 0.6.60 operation currently authorizes transaction submission or a Cardano support claim.
