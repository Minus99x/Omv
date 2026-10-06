# OmegaVault Cardano Preprod First-Time Operator Handoff — 0.6.60

Status: **development handoff until the 0.6.60 checkpoint is sealed**

This runbook minimizes user-controlled workstation time while preserving every OmegaVault non-custodial and evidence boundary.

## BLUF

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
npm.cmd run cardano:preprod:campaign:capture -- --campaign "<PATH-TO-NEW-LIVE-CAMPAIGN-DIR>"
```

That command:

1. reads a stable Ogmios Preprod tip;
2. obtains the current epoch and current protocol parameters;
3. independently confirms them with Blockfrost Preprod;
4. fails closed on any parameter/cost-model disagreement;
5. constructs the four lifecycle evaluation candidates using the **current** Plutus V3 cost model;
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

The next separately designed/tested gate must cover:

1. evaluated-budget application to final transaction bodies;
2. complete phase-1 validation;
3. wallet witness/signing policy;
4. submission;
5. inclusion/finality;
6. public-network recovery proof;
7. only then any Cardano support-promotion decision.

No 0.6.60 evaluation operation authorizes those steps.
