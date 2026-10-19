# Bitcoin Signet: offline signed-PSBT recovery preparation

This operator workflow turns a **previously signed, threshold-complete** OmegaVault
Signet PSBTv2 into a deterministic, fully witnessed transaction and bound evidence.
It does not sign, contact the Bitcoin network, check actual UTXO maturity, call a
Bitcoin Core node, broadcast, or establish live recovery success.

## Prerequisites

- Node.js and the repository's pinned dependencies (`npm ci`).
- A canonical, frozen, **already signed** PSBTv2 stored as **base64 text** (not raw
  binary or an unsigned intent). Its embedded contact signatures are public transaction
  authorization material; treat both inputs and outputs as sensitive.
- The matching canonical OmegaVault Signet descriptor saved as JSON, the exact
  operator-approved rescue `scriptPubKey` (hex), and the exact expected fee in satoshis.
- A private destination directory; output is created without overwrite and with
  owner-only file mode on platforms that honor POSIX permissions.

## Offline transaction preparation

```sh
npm run bitcoin:signet:prepare:offline -- \
  --psbt /private/signed-recovery.psbt.base64 \
  --descriptor /private/recovery-descriptor.json \
  --rescue-script-pubkey 0014YOUR_RESCUE_SCRIPT_HEX \
  --expected-fee-sats 1000 \
  --output /private/signet-prepared.json
```

Replace the sample values with actual, independently checked operator inputs.
The command fails closed for missing contact approvals, invalid PSBT encoding,
descriptor mismatch, incomplete CSV sequence policy, different rescue output,
unexpected fee, or an existing output path.

A successful output contains a `transaction` with fully witnessed `rawHex`, exact
`txid` / `wtxid`, and two independently recomputed finalizer evidence records.
It explicitly marks broadcast, Bitcoin Core cross-check, and Signet execution
unproven and unauthorized.

## Optional: independent imported Bitcoin Core observations

Once a separate read-only Bitcoin Core observation JSON has been obtained using
the existing `omegavault.bitcoin.core-cross-check-observations.v1` schema, the
prepared package is now directly consumable by the existing verifier:

```sh
node scripts/verify-bitcoin-core-cross-check.js \
  --transaction /private/signet-prepared.json \
  --observations /private/core-observations.json \
  --output /private/signet-core-import-evidence.json
```

The importer validates the prepared artifact's fee, transaction identity,
bound evidence digest, and strict non-authority flags before accepting it.
**Imported JSON remains `imported-json`, never authenticated live Bitcoin Core
RPC proof.** The verifier does not submit the transaction and does not grant
wallet, network or production authority.

Focus the CLI regression suite with:
`npm run test:bitcoin-signet-cli`.
