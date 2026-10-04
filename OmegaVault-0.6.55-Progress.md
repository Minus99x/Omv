# OmegaVault 0.6.55 Progress

## Cardano workstation launch gate

- Added a strict workstation checkpoint-source verifier that compares:
  - sealed checkpoint sidecar,
  - exact source archive SHA-256,
  - extracted source-tree inventory,
  - package/package-lock dependency binding.
- The launch CLI also verifies the external review index before any capture session is prepared.
- Pinned installed dependencies must already match; otherwise the launch fails closed and directs the operator to run `npm ci`.
- Session preparation now defaults to a sibling directory outside the source tree, preserving the sealed source-tree identity.
- Existing session manifests are not overwritten silently.
- After all local gates pass, the launch command prepares the Cardano session without making a network request.

## Intended laptop command

`npm run cardano:preprod:launch -- --bundle-dir <extracted-checkpoint-bundle>`

This is the first laptop command after extracting the sealed checkpoint source/bundle.

## Boundary

The launch gate does not contact Cardano, does not sign, does not submit and cannot move value.
