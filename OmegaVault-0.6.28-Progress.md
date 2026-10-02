# OmegaVault 0.6.28-dev Progress

## EVM/XDC finality-evidence binding

- Added a fail-closed Ethereum Sepolia/XDC Apothem finality verifier.
- Finality now binds the exact recovery-proof transaction hash, proof-binding digest, proof-context digest, deployment-verification digest, network and chain ID.
- The verifier requires the exact `eth_chainId`, `eth_getTransactionReceipt`, `eth_getBlockByHash`, receipt-height `eth_getBlockByNumber` and `finalized` `eth_getBlockByNumber` requests.
- A successful receipt must match the proof transaction, its block must match both hash and canonical-height queries, and the network-native finalized head must be at or beyond the receipt height.
- Native and ERC-20 recovery proofs require distinct finality evidence. Cross-wiring the two evidence records fails closed.
- XDC remains a separate network boundary even though it shares EVM JSON-RPC shapes.

## Verification

- Focused finality suite: **5/5 PASS**.
- EVM/finality regression slice: **16/16 PASS**.
- Full JavaScript suite after pinned `npm ci`: **235/235 PASS**.
- `npm run check`: **PASS**.
- Existing Solidity and TRON artifact verification: **PASS**.

## Promotion boundary

This closes the offline finality-binding implementation gate for Ethereum Sepolia and XDC Apothem evidence. It does not create fresh public-network evidence and does not promote XDC to live-proof. XDC still requires a fresh Apothem deployment, native/ERC-20 recovery execution and captured RPC finality evidence from the same proof context.

## Next offline task

Harden dependency/lockfile integrity and workstation-resume tooling so a fresh checkout can verify the pinned dependency graph and resume the remaining Stellar, Bitcoin and Solana execution gates without reconstructing state.
