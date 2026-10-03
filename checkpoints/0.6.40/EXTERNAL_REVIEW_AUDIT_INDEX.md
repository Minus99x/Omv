# OmegaVault 0.6.40-dev — External review audit index

- Operator audit index deterministically binds provenance-audit and evidence-history state.
- External review index is generated only after ZIP + sidecar sealing.
- Final archive and sidecar identities are bound without embedding the archive's own digest inside itself.
- Review metadata cannot modify promotion eligibility.

Verification: 13/13 focused PASS; 308/308 dependency-free PASS; global check PASS.

No chain promotion is claimed.
