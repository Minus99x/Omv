# Cardano applied validators and transaction-body fixtures — 0.6.12

## Verified protocol basis

- Aiken's blueprint command applies typed parameters and derives validator hashes, policy ids and addresses: <https://aiken-lang.org/fundamentals/getting-started>.
- A one-shot minting policy may be parameterized by a unique UTxO reference: <https://aiken-lang.org/fundamentals/common-design-patterns>.
- CIP-19 defines testnet network tag `0` and enterprise script address type `7`: <https://cips.cardano.org/cip/CIP-19>.
- Cardano transaction bodies use era-defined CBOR/CDDL, and the transaction id is the Blake2b-256 hash of the serialized body: <https://developers.cardano.org/docs/developers/curriculum/fundamentals/core-concepts/transactions/>.
- Current fees, collateral percentage, cost models and related economic/technical inputs are protocol parameters rather than constants: <https://docs.cardano.org/about-cardano/explore-more/parameter-guide> and <https://docs.cardano.org/about-cardano/learn/collateral-mechanism>.

## Reproducible fixture

The packaged Aiken blueprints apply the synthetic transaction id `ab…ab#0` and asset name `4f56`. This deterministically produces policy id `3c298bd60240d5d6d89811dc9fcffd9f37c6d60df8f74562cc01fcd6`, recovery validator hash `2f59df4cdf1199ef68d705b6a30f6738cf31075d361692cb8a58c4b4`, and Preprod-format enterprise address `addr_test1wqh4nh6vmugenmmg6uzmdgc0vuuv7vg8t5mpdykt3fvvfdqp2ftmw`.

The seed does not reference a live UTxO and the fixture is not deployable. Its purpose is to prove that parameter encoding, script identity and address derivation remain reproducible across rebuilds.

## Transaction-body boundary

Initialization, heartbeat, approval and execution body fixtures include deterministic inputs/outputs, inline `VaultDatum`, validity bounds, external collateral, required signers and the expected beacon mint/burn field. Cardano Serialization Lib 17.0.0 serializes each body, reparses it, and reproduces identical CBOR bytes and body hash.

These are not submit-ready transactions. Exact script-data hashes, redeemers, current cost models, execution units, fees, minimum ADA, collateral and witnesses remain deliberately unset or marked as fixture values until live Preprod parameters can be queried and independently verified.
