# Bitcoin Signet read-only observation and receipt verification

Status: **preproduction, Signet-only**. No transaction submission, signing,
wallet mutation, mainnet operation, or chain-promotion authority is provided.

## Evidence chain and operator workflow

Prerequisite: the operator has already produced an offline signed/frozen PSBT
and matching **finalizer** and **final-transaction** evidence JSON artifacts.
The Bitcoin Core CLI proof reader does not create keys, fund wallets, sign
transactions, or broadcast anything.

Use a fully synchronized **Signet** Bitcoin Core node with locally available
bitcoin-cli, access to the known Signet recovery transaction through
getrawtransaction (which may require a transaction index or retained transaction
data), and a sufficiently confirmed unspent rescue output.

Capture read-only inclusion and unspent output evidence:

```bash
node scripts/verify-bitcoin-signet-observation.js   --finalizer /path/to/finalizer.json   --final-transaction /path/to/final-transaction.json   --minimum-confirmations 6   --output /path/to/readonly-signet-proof.json
```

The output file must **not** exist already. Missing RPC availability or
insufficient confirmations fails without producing a receipt.

Offline verification of the resulting artifact against its two upstream
evidence records:

```bash
node scripts/verify-bitcoin-signet-artifact.js   --evidence /path/to/readonly-signet-proof.json   --finalizer /path/to/finalizer.json   --final-transaction /path/to/final-transaction.json
```


The verifier recomputes the receipt checksum, expected transaction identity,
script, amount, confirmations, provenance label and restricted authority flags.
It does **not** independently authenticate claims of having contacted
Bitcoin Core. Re-run the read-only capture against a trusted node for new
network evidence.

## Fail-closed capture checks

- Only five fixed Bitcoin Core methods are used: getrawtransaction,
  getblockheader, getblockchaininfo, getblockhash, gettxout. The chain tip
  is read again after inspecting the UTXO.
- Signed transaction and finalizer evidence must agree on PSBT hash,
  descriptor policy, fee, rescue script and amount.
- Transaction confirmations must match block-header confirmations, and
  active-chain block hash at the claimed height must match inclusion.
- Signet chain tip identity and reported UTXO best block must match.
  Confirmation depths must agree, and the chain tip must remain stable through
  the proof.
- The rescue output must remain unspent, match the expected index, amount
  and script, and exceed the configured confirmation requirement.
- Clock order and evidence hashes are checked, without inventing a
  finalized or immutable-rescue on-chain guarantee.

## Explicit remaining gates

A passing **offline mock test** demonstrates software checks, not public
Signet inclusion. A real Bitcoin Core RPC capture can supply read-only
observation provenance for a **previously broadcast, already included**
recovery, but this tooling cannot broadcast or authorize signing.

Even after authentic public Signet evidence, the known reduced-semantics
Bitcoin recovery design does **not** implement immutable-rescue enforcement
as a Bitcoin covenant. Production promotion remains prohibited until
separately reviewed and authorized.
