# OmegaVault 0.6.54 Progress

## Cardano Preprod capture-session manifest

- Added a capture-session manifest pinned to the exact sealed 0.6.53 checkpoint:
  - source commit `e4f1c87f572d74852c7602df56e93e4efd70815e`
  - source archive SHA-256 `a25d23e08da6dced47fdfe2af550e1bd0e901a8aed9b69945c6c1dc9269485ce`
  - source-tree SHA-256 `44f490e34761584bb9581c7bde5c3f858263134f7b2598abc42d1746ae9811a9`
- Added an offline preparation CLI that creates the manifest, exact Ogmios request, capture directory and JSON templates without making a network request.
- Added a verification CLI that reports missing capture files before any binding attempt.
- Once all files exist, verification requires at least two independently confirmed current Preprod protocol-parameter sources before accepting the session.
- Complete captures are fed into the 0.6.53 synchronized-evaluation harness and written as deterministic evidence.
- Manifest, capture plan and result all preserve wallet-signing/submission/live-value authority as false.

## Laptop objective

Laptop mode should now start with `npm run cardano:preprod:prepare`, populate only the five required capture files, then run `npm run cardano:preprod:verify`.

## Boundary

The session tooling performs no network calls itself and contains no signing or transaction-submission path.

## Verified working-head baseline

- Capture session/manifest: **4/4 passed**.
- Full suite: **447/447 passed**.
- Offline resume: **16/16 + 11/11 passed; ok: true**.
- Global checks: **passed**.
