# XDC Apothem — first verified live read-only RPC milestone

**Network:** XDC Apothem Testnet, chain ID 51 (`0x33`). This is reconnaissance and **not** a proof of successful deployment, signing, recovery, finality or production support.

On October 12, 2026 (Phoenix date), a one-shot isolated GitHub CI runner used the public Apothem endpoint to execute four **read-only** JSON-RPC calls with response identity and consistency checks: `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber`, and `eth_gasPrice`.

## Verified public RPC observation

- [Successful XDC Apothem read-only proof](https://github.com/Minus99x/Omegavault/actions/runs/38345382962).
- Network RPC endpoint: `https://rpc.apothem.network` (fixed testnet-only).
- Observed chain ID: `0x33` (decimal 51).
- Block number: **84,027,167**.
- Observed block hash: `0x6e2eb066da6c4dcb7567d95ad15671ff674b7c74db947158d02a15192a7fcc8d`.
- Parent hash: `0x077169c21af88f8a0dd4af53c81dd3bea08fbbaf16beb5b14550e2361b25c5d4`.
- Block timestamp (Unix seconds): `1791864808`.
- RPC gas-price quote: `625000000000` wei, equivalent to **625 gwei**.

The observed gas-price quote is far above the 0.25-gwei figure appearing in some XDC documentation. These values are a single observation and **not** a reliable fee estimate for a deployment. Next steps must independently cross-check gas, EVM fee mode, chain configuration and deployed runtime bytecode before any meaningful gas budget or support claim.

The probe is implemented as `scripts/xdc-apothem-readonly-probe.js` with offline negative tests in `test/xdc-apothem-readonly-probe.test.js`. Its test rejects mismatched mainnet identity, wrong block heights/hashes, malformed quantities and incompatible JSON-RPC responses. No account, wallet, private key, signed transaction, or testnet value was involved.

## Independent two-provider Apothem consensus and gas quote — 2026-10-12

The read-only `scripts/xdc-apothem-independent-rpc-check.js` now checks chain ID 51 at **two independently addressed Apothem JSON-RPC endpoints**, obtains each provider's tip, queries the *exact same shared block height* at both, requires byte-for-byte matching block hashes, and compares the two `eth_gasPrice` responses.

- [Successful live provider comparison](https://github.com/Minus99x/Omegavault/actions/runs/38347097320).
- Endpoints: `https://rpc.apothem.network` and `https://erpc.apothem.network`.
- Both reported decimal chain ID **51** and tip **84,027,733**.
- Matching shared block hash: `0x53d1691e1da9a58a079d9d307b8cd7ca4479992d8538d4578ab16c522abd8ad2`.
- Both independently reported an `eth_gasPrice` quote of **625,000,000,000 wei = 625 gwei**, zero quote divergence in this observation.
- All four read-only methods used per provider were `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber` and `eth_gasPrice`. No keys, transactions, deployers, user wallets, tokens or value were used.
- An initial comparison against the documentation-listed `rpc.apothem.blocksscan.io` [failed because fetch failed](https://github.com/Minus99x/Omegavault/actions/runs/38346664282); this was a provider-connectivity issue, not chain-consensus evidence. An alternative published Apothem endpoint was selected for an independent retry. The code's request errors now identify the failing endpoint.

**Important:** Confirmed identical quote does **not** determine safe contract-deployment fees, EIP-1559 support, gas estimation, node submission acceptance, or XDPoS finality. The unusually high `eth_gasPrice` relative to older official network documentation remains a budget concern. The actual deployment gas and fee mechanism must be tested in a narrowly capped, independently funded Testnet objective before deployment is attempted. `xdc:apothem` remains `compatibility-ready`, not a released connector.

## Next XDC objective

1. Reconcile both providers' 625-gwei gas quotes against block fee fields and a bounded `eth_estimateGas` check; never hardcode historic fees or assume native finality.
2. Prepare disposable Apothem accounts and a bounded fee budget using faucet tokens only.
3. Reproduce OmegaVault's Ethereum Solidity proof on Apothem with XDC-specific chain identity/address handling. Verify deployed runtime bytecode and owner/contact/rescue configuration on-chain.
4. Execute real testnet native recovery, heartbeat and threshold guards, then XDC finality and (if implemented) token-sweep checks.
5. Submit support evidence for independent maturity reconciliation; **no automatic promotion**.

The chain-specific model remains independent of Cardano and the Stellar native signer pathway.
