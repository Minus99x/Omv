# Cardano Preprod Real Initialize — Workstation Quickstart

Status: operator quickstart for the first real Cardano Preprod initialize read/evaluation capture.

## Goal

Use actual test-only Cardano Preprod wallet UTxOs to produce OmegaVault's first real initialize capture through:

- real UTxO discovery;
- deterministic seed/funding + collateral selection;
- exact one-shot validator derivation;
- stable-tip UTxO binding;
- current Ogmios + Blockfrost protocol reconciliation;
- real unsigned initialize construction;
- live Ogmios evaluation;
- evaluated-budget application;
- unsigned phase-one preflight.

The session ends **unsigned**.

No signing or submission is authorized by this quickstart.

## Have these ready before opening the terminal

1. Owner test-only Cardano Preprod wallet receive address beginning with `addr_test1`.
2. Rescue test-only Cardano Preprod address beginning with `addr_test1`.
3. Trusted contact A test-only Cardano Preprod address beginning with `addr_test1`.
4. Trusted contact B test-only Cardano Preprod address beginning with `addr_test1`.
5. A Blockfrost project ID created specifically for Cardano Preprod.
6. A Cardano Preprod Ogmios endpoint, preferably managed.
7. The matching Ogmios API key if that endpoint requires a separate API-key header.
8. The owner Preprod wallet funded with enough **test ADA** to expose at least two distinct plain ADA-only UTxOs.

The guided command checks the owner wallet for the required two-UTxO shape before beginning real construction.

Do **not** prepare or paste:

- a private key;
- a seed phrase;
- a recovery phrase;
- a mnemonic;
- a mainnet wallet;
- real ADA.

## First terminal sequence

Run one command at a time.

### 1. Select the integration branch

```powershell
git switch dev/0.6.60-reconcile-overnight-bitcoin
```

### 2. Fast-forward to the current remote head

```powershell
git pull --ff-only
```

If this reports a conflict or refuses a fast-forward, stop and inspect instead of resetting or forcing the branch.

### 3. Restore the pinned dependency set

```powershell
npm.cmd ci
```

Do not run `npm audit fix`.

### 4. Launch the guided real-initialize flow

```powershell
npm.cmd run cardano:preprod:real-initialize:guided
```

## Guided-flow behavior

The command:

1. verifies it is running from `dev/0.6.60-reconcile-overnight-bitcoin`;
2. refuses tracked source modifications;
3. records the exact local source HEAD;
4. requests the owner, rescue and two contact Preprod addresses through the Windows clipboard;
5. derives and self-verifies the immutable recovery configuration;
6. uses valid existing provider environment variables when already present;
7. otherwise requests provider values through the clipboard without printing them;
8. performs a read-only Ogmios + Blockfrost provider preflight;
9. checks the owner wallet has a valid seed/funding + collateral UTxO pair;
10. creates a timestamped append-only session directory outside the repository;
11. writes the recovery configuration and non-secret session plan;
12. launches the real initialize read/evaluation capture;
13. writes the real identity, UTxO-binding, protocol, evaluation, final unsigned candidate and unsigned-preflight evidence;
14. stops before any wallet signing or transaction submission.

Provider secrets are passed only through process memory/environment for the child capture and are not written into the session plan.

## Clipboard prompts

For each address/provider prompt:

1. copy the requested value;
2. return to PowerShell;
3. press Enter.

The command validates the clipboard value without echoing provider secrets.

Never place a seed phrase, recovery phrase, mnemonic or private key on the clipboard for this workflow.

## Expected hard stop

A successful run ends with an unsigned real initialize candidate and reports:

- synchronized real initialize evaluation complete: true;
- full phase-one validated: false;
- wallet signing performed: false;
- wallet signing authorized: false;
- transaction submission performed: false;
- transaction submission authorized: false;
- public-network recovery proven: false;
- support claim authorized: false.

Do not continue into signing merely because the capture succeeded.

The later order remains:

1. review the frozen unsigned candidate;
2. explicitly authorize the human test-wallet signing step only after unsigned gates are proven;
3. verify the exact wallet-produced witness offline;
4. run the live pre-submit freshness gate;
5. independently complete remaining signed/current-ledger phase-one validation;
6. separately authorize any submission;
7. prove inclusion/finality;
8. exercise real lifecycle recovery;
9. only then consider support promotion.

## If the wallet UTxO check fails

The most likely message is that OmegaVault requires at least two distinct plain ADA-only wallet UTxOs.

Do not improvise inside the terminal.

The owner test wallet must first have an appropriate Preprod funding shape. Any wallet transaction used to create/split test UTxOs remains a human wallet action and is separate from OmegaVault's read/evaluation capture.

## Authority boundary

This quickstart performs public Preprod reads and Ogmios transaction evaluation only.

It grants no wallet, signing, submission, deployment, mainnet, production, recovery-completion or connector-promotion authority.
