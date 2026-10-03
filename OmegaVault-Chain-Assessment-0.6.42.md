# OmegaVault Chain Assessment 0.6.42

0.6.42 changes external-review authentication and trust handling only. Chain maturity remains unchanged.

A valid detached Ed25519 signature proves possession of the corresponding signing key for one exact receipt digest. It does not prove the signer's real-world identity or that OmegaVault trusts the reviewer. Those assertions require separately controlled, digest-bound reviewer-key trust metadata whose reviewer label and key fingerprint must match.

Even a trusted and authenticated reviewer has no chain- or evidence-promotion authority. Connector promotion continues to require the existing chain-specific evidence gates.
