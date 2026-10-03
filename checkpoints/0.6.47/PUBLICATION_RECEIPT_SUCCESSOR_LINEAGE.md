# Publication-Receipt Successor Lineage — 0.6.47

The 0.6.47 checkpoint adds explicit ordering across publication-head receipts.

- Each entry binds its publication receipt and exact predecessor entry/receipt digests.
- Publisher identity remains stable within one history and timestamps increase strictly.
- A snapshot binds the entry count, current receipt, anchor-history head and checkpoint.
- An older valid receipt is rejected as non-current when current lineage is supplied, including when its detached publisher signature is valid.
- Non-canonical extra fields, reordered/skipped links, duplicates, altered authority and unsafe output overwrite fail closed.
- Normal tooling refuses private-key, secret-key, seed and key-output arguments.

This lineage authenticates no publisher and grants no reviewer, anchoring, chain, evidence, deployment or wallet authority.
