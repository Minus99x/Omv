# OmegaVault — Cardano Preprod console handoff (2026-10-10)

**Purpose:** Resume meaningful workstation work quickly without repeating historical witness/signing steps. This is a no-sign/no-submit preparation. Every step here is read-only or a local source synchronization; no transaction broadcast is authorized.

## Exact workstation checkout

Previously confirmed Windows source checkout:

`C:\Users\heath\Downloads\OmegaVault-current\Omegavault-0.6.60-handoff`

Previously captured signed evidence lives under a sibling directory resembling:

`C:\Users\heath\Downloads\OmegaVault-current\omegavault-cardano-preprod-real-initialize-2026-10-09T20-23-31-084Z`

The previous witness was authorized **only for the previous frozen transaction body hash**, and its validity interval has expired. Do not sign or submit it again. A new candidate and any new signing would require a separately confirmed body hash and explicit authorization.

## First action on console — 2-minute read-only gate

Open **PowerShell** and run:

```powershell
Set-Location 'C:\Users\heath\Downloads\OmegaVault-current\Omegavault-0.6.60-handoff'
git branch --show-current
git status --short
git pull --ff-only origin dev/0.6.60-reconcile-overnight-bitcoin
npm.cmd run cardano:preprod:console:ready -- --evidence-root 'C:\Users\heath\Downloads\OmegaVault-current'
```

If `git pull --ff-only` cannot fast-forward or reports local changes, **stop instead of resetting or deleting anything**. Ask for a source-reconciliation step. There is no reason to overwrite evidence or install another copy of OmegaVault.

If pinned dependencies are missing, `npm.cmd ci` is the supported dependency setup; only run it in the confirmed OmegaVault checkout, and only if necessary. `npm.cmd run cardano:preprod:console:ready` does not contact a provider, ask for secrets, open Lace, sign, or submit.

The readiness report prints **only whether environment credentials are present**, never their values. It identifies the checked-out branch, source commit, existing witness and captured transaction artifacts, and an **estimated** old-candidate expiry. Actual current Preprod validity requires a fresh node tip.

## Next useful gate — provider connectivity only

If the branch is correct, source is clean, dependencies exist and environment values are already configured in the same terminal session:

```powershell
npm.cmd run cardano:preprod:ogmios:diagnose
```

This runs a read-only two-connection tip check. It performs no wallet operation, transaction construction, signing, or submission.

- If a **401** appears, the problem is Demeter provider authentication, **not a lack of signing consent or an error in the former wallet witness**. Report just the error category and HTTP status. Do not paste API keys.
- If a transport or WebSocket issue appears, report the diagnostic error and keep the exact working project branch; no wallet action.
- If both connections succeed, the provider-readiness gate is met. The remaining independent **complete Conway protocol environment / signed-current-ledger phase-one proof** is still separately gated.

## Optional future work (requires a decision, not automatic)

`npm.cmd run cardano:preprod:real-initialize:guided` performs new Preprod **read/evaluation** capture only, requiring valid wallet addresses and provider access. It stops unsigned. Do **not** trigger fresh Lace signing or any submission merely because this handoff exists. Signing requires explicit user authorization for an **exact newly frozen body hash**; submission requires **separate, explicit** authorization and verified validation.

## If sharing only a short result back in chat

Report the `source.branchMatches`, `source.commit`, `source.trackedFilesClean`, the three `providerEnvironment.*Configured` booleans, and the `recommendation` from the readiness report. No provider values, wallet seed phrases, private keys, or full evidence payloads are needed.

**Absolute security boundary:** no signing, no submission, no live fund movement, no public-network recovery claim or production support promotion.
