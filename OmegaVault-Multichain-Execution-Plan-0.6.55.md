# OmegaVault Multichain Execution Plan 0.6.55

## Objective block

- [x] Verify the checkpoint manifest against the extracted source tree.
- [x] Verify the exact source archive SHA-256.
- [x] Verify the external review index before session preparation.
- [x] Verify package/package-lock integrity and installed pinned dependencies.
- [x] Keep generated capture sessions outside the sealed source tree by default.
- [x] Refuse silent overwrite of an existing capture-session manifest.
- [x] Prepare the Cardano session only after all workstation gates pass.
- [x] Keep all network/signing/submission authority false.
- [ ] Pass focused workstation-launch tests and inherited verification stack.
- [ ] Seal 0.6.55 as the one-command laptop launch checkpoint.

## Laptop sequence after seal

1. Extract the sealed outer artifact bundle.
2. Extract the sealed source ZIP.
3. Open a terminal in the extracted source.
4. If needed, run `npm ci`.
5. Run `npm run cardano:preprod:launch -- --bundle-dir <outer-bundle-directory>`.
6. Only after launch reports `ok: true`, proceed to capture synchronized Preprod evidence.
