# Reviewer Trust-Policy Anchor — 0.6.44

The 0.6.44 checkpoint adds an external policy-integrity sidecar.

- It binds one trust-history snapshot digest, event count, current key, status and head digest.
- It binds one exact external review-index digest, checkpoint reference and archive digest.
- Receipt verification requires the receipt's review-index digest to match the anchored review index.
- Stale history/snapshot pairs and cross-checkpoint review indexes fail closed.
- CLI tooling uses public audit files only and refuses output overwrite.

The sidecar does not authenticate its named anchoring authority and has no chain, evidence, deployment or wallet authority.
