# Reviewer Trust-Policy Anchor History — 0.6.45

The 0.6.45 checkpoint adds explicit lineage across successive policy anchors.

- Each history entry contains the current anchor digest and exact predecessor entry/anchor digests.
- Sequence numbers are contiguous, reviewer identity is stable and timestamps increase strictly.
- A head snapshot binds the entry count, head entry, head anchor, checkpoint and trust-policy snapshot.
- Receipt verification can require both the anchor history and its head snapshot; an older valid anchor then fails as non-current.
- Append and verification CLIs consume public audit files only and refuse unsafe overwrite.

The lineage does not authenticate its publisher and has no reviewer-approval, chain, evidence, deployment or wallet authority.
