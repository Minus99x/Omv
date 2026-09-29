# Bitcoin Descriptor and PSBTv2 Offline Gate — 0.6.10

## Implemented scope

- Exact P2WSH Miniscript policy: immediate owner key or CSV-delayed contact threshold.
- Bitcoin Core descriptor checksum, witness-script compiler, P2WSH scriptPubKey and Bech32 v0 address generation.
- Canonical BIP 370 PSBTv2 serialization and strict parsing with frozen inputs and outputs.
- BIP 143 witness-v0 SIGHASH_ALL construction and strict-DER, low-S secp256k1 signature verification.
- Distinct-contact threshold verification against the configured recovery contact set.

## Bitcoin Core validation

On 2026-09-28, the deterministic 2-of-2/144-block fixture was checked with Bitcoin Core v31.1.0 in Signet mode with peer connections and listening disabled. The official archive SHA-256 was checked against Bitcoin Core's published `SHA256SUMS` before execution.

Core accepted the checked descriptor, reported it solvable with no private keys, and returned the same address, scriptPubKey and witness script as OmegaVault. A descriptor wallet created with private keys disabled imported the descriptor successfully. Backup, unload and restore preserved the exact solvable address. The machine-readable fixture is in `docs/evidence/BITCOIN_CORE_31_1_DESCRIPTOR.json`.

## Safety boundary

This construction does not enforce an immutable rescue destination on chain. The delayed threshold keys authorize a spend after CSV maturity, but ordinary Bitcoin Script does not force all such spends to the destination shown in an OmegaVault PSBT. OmegaVault therefore labels this connector as reduced semantics, freezes the PSBT transaction intent before signatures, and requires every signer to verify the rescue output. It is not promoted as an exact-semantics or live-proof connector.

## Official references

- Bitcoin Core 31.1 binaries/checksums: <https://bitcoincore.org/bin/bitcoin-core-31.1/>
- Output descriptors: <https://bitcoincore.org/en/doc/31.0.0/rpc/util/getdescriptorinfo/>
- BIP 379 Miniscript: <https://github.com/bitcoin/bips/blob/master/bip-0379.mediawiki>
- BIP 370 PSBTv2: <https://github.com/bitcoin/bips/blob/master/bip-0370.mediawiki>
- BIP 143 witness-v0 sighash: <https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki>

## Verification

```bash
npm run check:bitcoin
npm test
```
