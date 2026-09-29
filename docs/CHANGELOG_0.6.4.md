# OmegaVault 0.6.4-dev

- Resolved XRPL product scope: fixed-time escrow and signer-quorum modes are native; neither is resettable inactivity recovery.
- Added executable XRPL semantic-assessment/product-claim guard.
- Added three XRPL semantic regression tests.
- Documented current official XRPL primitive constraints and retained TokenEscrow capability gating.
- xrpl.js exact codec/signature item remains unchecked: current official docs show 4.4.x examples, but dependency installation timed out in this build environment, so no serialization/signature execution claim is made.
- Full clean-suite rerun is blocked in this extracted workspace because package dependencies are absent; `npm run check` passes, and the XRPL-only suite passes 10/10.
