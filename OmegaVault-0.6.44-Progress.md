# OmegaVault 0.6.44 Progress

## Completed

- Added `omegavault.reviewer-trust-policy-anchor.v1` audit sidecars.
- Bound one exact reviewer trust-history snapshot to one exact external review-index digest and checkpoint/archive identity.
- Added public create/verify CLIs with overwrite protection and no private-key inputs.
- Integrated policy-anchor enforcement into detached review-receipt verification.
- Required the anchored external review-index digest to equal the review-index digest already bound into the receipt.
- Added stale-history/stale-snapshot, cross-checkpoint, substituted-index and tampered-authority failure tests.

## Security boundary

- Policy anchors prove integrity relationships only; they do not authenticate a reviewer or anchoring authority by themselves.
- Reviewer trust remains separate from signature authentication.
- Review metadata has no chain- or evidence-promotion authority.
- No deployment, transaction, wallet signature or live-value action occurred.

## Remaining gate

Add append-only lineage for successive policy anchors so rotations and revocations can be audited across checkpoint transitions without inferring source ancestry.
