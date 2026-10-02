# OmegaVault 0.6.36-dev — Evidence provenance resolution

Archive SHA-256: `21888800b0bbc138eed495d87b4fb8e2642bc7a97ad4ff8aeabb3715d8dfaf18`
Sidecar SHA-256: `e62f0df06236036ef5406b72a6b28d1c090039dbef0945e66fd49d492133f0e4`
Manifest logical SHA-256: `032a311b04f064cb9f827775670f5fd2198cab9e88ca7e0ae9f29a01fc1bf659`
Source-tree SHA-256: `aa2e639231b9952bcc3a7f969677276eee02859181733d441ef1d7c97b765235`

- Every maturity evidence ref resolves through a backend provenance registry.
- Provenance binds exact checkpoint/archive digest, chain scope and artifact paths.
- Cross-wired/unresolved refs fail closed.
- Browser displays provenance without altering maturity eligibility.

Verification: provenance slice 15/15 PASS; dependency-free regression 248/248 PASS; global check PASS; deterministic archive and fresh-extraction sidecar verification PASS.

No chain promotion is claimed.
