# OmegaVault Chain Assessment 0.6.7

## Bitcoin
Status: offline scaffold/hardening; not live-proof.

Verified design facts now encoded:
- BIP68/BIP112 relative-height recovery requires transaction version >=2, relative-locktime enabled, height-based sequence type, and an nSequence relative value meeting the CSV script requirement.
- Heartbeat remains a UTXO rollover: confirmation of a fresh protected output restarts its relative age.
- PSBTv2 coordination freezes input/output modification before OmegaVault recovery signature collection.
- Standard key+CSV authorization still does not make the rescue destination immutable on-chain; signer-side output verification is not represented as a covenant.

Remaining: executable descriptor/miniscript policy construction, canonical PSBTv2 serialization and signature verification, then Signet proof gates.

## Solana
Status unchanged: offline scaffold; not live-proof. PDA/token validation assumptions were rechecked, but Rust/sBPF compilation cannot be verified in this environment.
