# OmegaVault 0.6.2-dev progress

- Pinned `@stellar/stellar-sdk` 17.1.0 and raised the Node.js floor to 22.12.
- Added exact Stellar recovery XDR generation, hash/preAuthTx derivation and SDK round-trip verification.
- Replaced regex-only Stellar account checks with checksum-valid StrKey validation.
- Corrected the native contact model: exact N-of-N approval with one or two transaction extra signers; broader M-of-N explicitly routes to Soroban.
- Added signer setup planning, exact contact-signature coordination, account snapshot/preAuthTx drift checks and applied-failure consumption handling.
- Added adversarial coverage for duplicate/unknown/extra contacts, removed one-time signers, invalid account checksums and unsupported native policy shapes.
- Kept Ethereum Sepolia 0.4.3 as the only live-proven connector.
- Full suite: 126 tests passing; syntax and pinned contract-manifest checks passing.
