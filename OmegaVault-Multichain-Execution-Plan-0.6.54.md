# OmegaVault Multichain Execution Plan 0.6.54

## Objective block

- [x] Pin the laptop capture session to the exact sealed 0.6.53 checkpoint identity.
- [x] Generate a deterministic Cardano Preprod capture manifest.
- [x] Generate the exact Ogmios evaluateTransaction request offline.
- [x] Generate capture templates and required file paths.
- [x] Add a one-command incomplete/complete session verifier.
- [x] Require two-source independently confirmed current protocol parameters.
- [x] Feed complete captures into the synchronized evidence harness.
- [x] Keep signing, submission and live-value authority false.
- [x] Add CLI and manifest tamper tests.
- [x] Pass focused session/manifest verification and inherited CI.
- [ ] Build deterministic archive, checkpoint manifest and external review index.
- [ ] Pin 0.6.54 as the workstation-ready Cardano capture-session checkpoint.

## Laptop sequence after seal

1. Resume the exact checkpoint checkout.
2. Run workstation preflight.
3. Run `npm run cardano:preprod:prepare`.
4. Capture the five required same-tip JSON records.
5. Run `npm run cardano:preprod:verify`.
6. Stop after synchronized evaluation evidence; signing/submission remains a separate gate.
