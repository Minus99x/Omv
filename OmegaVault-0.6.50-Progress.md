# OmegaVault 0.6.50 Progress

## Maturity/provenance reconciliation

- Registered the sealed 0.6.49 archive as explicit Stellar and Bitcoin execution-evidence provenance.
- Removed the stale Stellar SDK dependency blocker now that pinned SDK execution is dependency-backed and verified.
- Raised Stellar from scaffold to offline-verified while keeping all public-testnet/live gates unpassed.
- Added Stellar offline evidence for network profile, address validation, transaction preflight, adversarial tests and evidence export.
- Removed the stale Bitcoin Noble dependency blocker now that cryptographic finalizer execution is verified.
- Added Bitcoin offline address-validation and evidence-export gates backed by the 0.6.49 finalizer evidence.
- Preserved Bitcoin reduced semantics and the explicit no-covenant blocker.
- Preserved Bitcoin Core extraction cross-check and Signet broadcast/recovery as unresolved live-evidence work.
- Added a focused maturity/provenance regression lane.

## Promotion boundary

No connector is promoted by this reconciliation. Public-testnet gates remain missing where no public-network evidence exists. Updating stale blockers to match verified evidence is bookkeeping, not promotion.
