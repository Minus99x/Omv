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

## Next XDC objective

1. Compare at least one independent Apothem RPC provider's chain ID, block hash, fee behavior and current gas suggestion; require matching heights for hash comparison.
2. Prepare disposable Apothem accounts and a bounded fee budget using faucet tokens only.
3. Reproduce OmegaVault's Ethereum Solidity proof on Apothem with XDC-specific chain identity/address handling. Verify deployed runtime bytecode and owner/contact/rescue configuration on-chain.
4. Execute real testnet native recovery, heartbeat and threshold guards, then XDC finality and (if implemented) token-sweep checks.
5. Submit support evidence for independent maturity reconciliation; **no automatic promotion**.

The chain-specific model remains independent of Cardano and the Stellar native signer pathway.
