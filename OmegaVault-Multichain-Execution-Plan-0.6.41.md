# OmegaVault Multichain Execution Plan 0.6.41

## Immediate offline sequence
1. Verify archive + checkpoint sidecar + external review index.
2. Allow an external reviewer to create an unsigned receipt recording their result.
3. Optionally attach a detached Ed25519 signature using a reviewer-controlled key.
4. Verify signatures independently with the reviewer's public key.
5. Keep reviewer trust/identity separate from cryptographic validity and from chain promotion.

## Workstation sequence
1. Run `npm ci`.
2. Run `npm run preflight:workstation`.
3. Run `npm run verify:offline-resume`.
4. Resume Stellar and Bitcoin cryptographic suites.
