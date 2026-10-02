# OmegaVault 0.6.34-dev — Browser capability rendering

Archive SHA-256: `df889726e08bb0d73c8619d40d99c7bbf6d9b0322f2b826a67712a89c7bc7ae2`
Sidecar file SHA-256: `7838638def05aaeac70f0bd560b485fd923444f468b5b26a3ca98f991ccba31c`
Manifest logical SHA-256: `a9a36c9d5316d1088b217335f7906d56ec02bae846265a983d96ae26526f748d`
Source-tree SHA-256: `e08feaf0f546c9b29f07a49a6bdc7bc000d54ac032b0d1e695a19dc6c4dd5da8`
Dependency-lock binding SHA-256: `38b11afc944e2ab4ac88ec03ce92ed6ea93069a14e8bc943c143fd7c2fa8cbd2`

- Browser consumes only the backend-validated capability envelope.
- Promotion eligibility is displayed, never re-derived in the browser.
- Blockers, missing gates, insufficient evidence and evidence levels are visible.
- Invalid or absent validation fails closed to Status unavailable / no promotion claim.
- Responsive capability cards added to the existing proof UI.

Verification: UI 8/8 PASS; dependency-free regression 229/229 PASS; global check PASS; deterministic archive and fresh-extraction sidecar verification PASS.

No chain promotion is claimed.
