# OmegaVault Cardano Preprod First-Time Operator Handoff

Status: **operator-preparation only**

Sealed source of truth: **0.6.59-dev** at commit `1353fe9fd94fcbdd787fd594c85937e934b60571`.

This runbook is designed to minimize first-time laptop work without weakening OmegaVault's non-custodial architecture or Cardano evidence boundaries.

## BLUF

The shortest path does **not** require running a full Cardano node on the laptop.

Preferred path:

1. Keep the sealed 0.6.59 artifact untouched.
2. Use the existing strict OmegaVault workstation launcher.
3. Use a managed **Cardano Preprod Ogmios** endpoint for synchronized ledger-state/evaluation capture.
4. Use **two independent current Preprod sources** for protocol-parameter confirmation; Koios + Blockfrost is the recommended pair.
5. Capture and verify the four lifecycle sessions: `initialize`, `heartbeat`, `approve`, `execute`.
6. Stop before wallet signing or transaction submission.

A self-hosted Cardano node + Ogmios remains available as a fallback, but it adds installation, disk use and initial chain synchronization time.

## What must already be on the laptop

Required for OmegaVault itself:

- Git.
- Node.js meeting the repository engine requirement (Node >=22.12).
- npm.
- The sealed 0.6.59 artifact bundle and extracted source.
- Internet access only for the later external Preprod evidence capture.

Optional for the fastest managed-infrastructure path:

- No Docker requirement.
- No local cardano-node requirement.
- No local Ogmios requirement.
- No `cardano-cli` requirement for the synchronized-evaluation-only gate.

Optional self-hosted fallback:

- Docker Desktop.
- `cardanosolutions/cardano-node-ogmios:latest-preprod`.
- Enough disk/RAM for a Preprod node and time for it to synchronize.

## Cardano network identity

Use **Preprod**, not Preview and never Mainnet.

- Network: Cardano Preprod
- network id: 0
- network magic: 1
- expected test address prefix: `addr_test1`

## Test wallet and faucet preparation

Create a **new dedicated Preprod test wallet**. Do not import or reuse a mainnet recovery phrase.

The current synchronized-evaluation campaign does **not** authorize signing or submission, so faucet funds are not consumed by this gate. Preparing a funded test wallet now is still useful because the later, separately-authorized public-network transaction gate will require test ADA.

Official faucet:

- https://docs.cardano.org/cardano-testnet/tools/faucet/

Recommended first-time wallet path:

- install a Cardano wallet that supports Preprod;
- create a fresh test-only wallet;
- switch explicitly to **Preprod Testnet**;
- confirm the receive address begins with `addr_test1`;
- request test ADA from the official faucet;
- never place real ADA or a mainnet seed in this test wallet.

Do not sign an OmegaVault Cardano campaign transaction during the current gate.

## Fastest infrastructure path

### Ogmios

Use a managed Ogmios endpoint on **Preprod** so the laptop does not need to synchronize a Cardano node.

One available managed option is Demeter. OmegaVault does not depend on Demeter; it is only an operator convenience. A self-hosted Ogmios endpoint is interchangeable.

Do not store provider credentials in the repository. Keep endpoint/API credentials outside the sealed source tree and outside committed files.

### Independent protocol-parameter confirmation

The evidence gate requires at least two independent current Preprod sources.

Recommended pair:

1. Koios Preprod.
2. Blockfrost Preprod.

Koios public access can be used for basic requests. Blockfrost requires a Preprod project/API key.

The two sources must describe the same current protocol state used for the acquired session tip. A disagreement fails closed.

## Self-hosted fallback

If a managed Ogmios endpoint is unavailable, Docker can run Cardano node + Ogmios together.

Example image:

`cardanosolutions/cardano-node-ogmios:latest-preprod`

Persist the Preprod node database in its own Docker volume. Never reuse a mainnet or preview database volume for Preprod.

This path is intentionally secondary because initial synchronization can dominate the laptop session.

## OmegaVault workstation sequence

From the extracted sealed source:

```powershell
npm ci
npm run preflight:workstation
```

Then run the strict campaign launch against the sealed 0.6.59 bundle:

```powershell
npm run cardano:preprod:campaign:launch -- --bundle-dir "<PATH-TO-SEALED-0.6.59-BUNDLE>" --campaign "<PATH-TO-NEW-CAMPAIGN-DIR>"
```

The launch must report:

- exact checkpoint identity;
- exact source-tree identity;
- dependency-lock identity;
- external-review verification;
- one campaign SHA-256;
- one invariant-program SHA-256;
- exactly four actions;
- wallet signing = false;
- transaction submission = false;
- support claim = false.

Inspect the operator handoff:

```powershell
npm run cardano:preprod:operator:handoff -- --bundle-dir "<PATH-TO-SEALED-0.6.59-BUNDLE>" --campaign "<PATH-TO-NEW-CAMPAIGN-DIR>"
```

## Capture set for each lifecycle action

For each of:

- `initialize`
- `heartbeat`
- `approve`
- `execute`

the session requires five externally acquired files:

1. acquired Preprod tip;
2. same-tip UTxO snapshot;
3. same-tip current protocol parameters with independent confirmation;
4. same-tip Ogmios evaluation response for the exact prepared candidate;
5. independent same-tip phase-1 validation record.

All five must bind to the same tip and exact transaction body required by that session. Do not hand-edit identities to force a match.

## Final campaign verification

After all four actions have complete capture files:

```powershell
npm run cardano:preprod:campaign:verify -- --campaign "<PATH-TO-NEW-CAMPAIGN-DIR>"
```

A successful result may establish only the synchronized-evaluation campaign state defined by the verifier.

It does **not** establish or authorize:

- wallet signing;
- transaction submission;
- live-value movement;
- inclusion or finality;
- public-network recovery;
- production readiness;
- connector promotion;
- an “OmegaVault supported” claim.

## Hard stop

**STOP after campaign verification.**

A later gate must be separately designed, tested and explicitly authorized before any OmegaVault Cardano transaction is signed or submitted.

## If the operator gets stuck

Run:

```powershell
npm run cardano:preprod:operator:handoff -- --bundle-dir "<bundle>" --campaign "<campaign>"
```

and preserve its JSON output. Do not improvise around a failed evidence gate.
