# Bitcoin Regtest Bech32 Network Conformance — 2026-10-25

## Concrete defect fixed

`src/chains/bitcoin/descriptor.js` previously selected `bc` for mainnet and `tb` for every other network. This incorrectly formatted **regtest** P2WSH addresses using the **testnet/signet** HRP. Regtest requires `bcrt`, which changes the Bech32 checksum as well as the prefix.

The source now selects `bc` (mainnet), `tb` (testnet or signet), or `bcrt` (regtest). The witness script and scriptPubKey are unchanged.

## Established implementations consulted

- Bitcoin BIP 173 Bech32 specification (BSD-2-Clause documentation): https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki
- MIT-licensed `bitcoinjs-lib` network configuration, which defines `regtest.bech32 = 'bcrt'`, mainnet `bc`, and testnet `tb`: https://github.com/bitcoinjs/bitcoinjs-lib
- The OmegaVault synthetic 2-of-2 descriptor fixture already checked against Bitcoin Core v31.1.0: `test/bitcoin-descriptor-psbt-v2.test.js`.

Source use: **semantic adaptation of the network mapping only**, not copied upstream implementation. No upstream code or additional dependency was introduced.

## Offline regression

`node --test test/bitcoin-regtest-bech32-network.test.js`

The four network-address expectations include independently computed BIP 173 checksums from the existing Bitcoin Core synthetic witness program. Tests also assert that the scriptPubKey remains identical and the wallet does not gain on-chain immutable destination semantics.

## Security and rollout limits

This fixes **address formatting only**. It does not authorize signing, broadcasting, recovery promotion, custody, on-chain destination enforcement, or production support. No wallet keys or RPC calls are used. Operators must independently verify addresses/network in Bitcoin Core before funding; tests and code review are not equivalent to network acceptance.

## Engineering workflow

- Separate branch `dev/0.6.61-bitcoin-regtest-address` forked from `dev/0.6.60-reconcile-overnight-bitcoin`.
- Only the descriptor formatter, regression file and this evidence note are changed.
- Merge into the product branch only after test and review acceptance.
- The existing GitHub scheduler on `main` and automation worker branch are not modified.
