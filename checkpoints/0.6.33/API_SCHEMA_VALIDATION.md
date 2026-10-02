# OmegaVault 0.6.33-dev — API schema validation

Archive SHA-256: `5b691f150e5818f74804c51a2c04a450aef3a2189b5340ac277f31856f889034`
Manifest logical SHA-256: `5fe1c9ab63038509aebf271a2a5dd55387298ec1b67fe56fe70cf32554ed06ab`

- Versioned capability/evidence API envelopes.
- Independent promotion recomputation at the HTTP boundary.
- Chain/network cross-wire rejection.
- Digest-valid but network-mismatched evidence rejection.
- Dependency-free Stellar G-address validation.
- Backend startup no longer depends on the Stellar SDK.

Verification: 8/8 API tests, 41/41 integration slice, 221/221 dependency-free regression, global check PASS.

No chain promotion is claimed.
