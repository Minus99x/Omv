# OmegaVault Smart Contract Lifecycle — 0.4

## What the smart contract is today

`OmegaVaultRecoveryVault.sol` is the Ethereum Sepolia proof mechanism. It is not OmegaVault Core and it is not yet a production custody contract.

It proves these semantics on a real Ethereum-family chain:

- owner liveness heartbeat
- immutable rescue destination
- trusted-contact set
- M-of-N approval threshold
- inactivity gate
- approval reset on owner heartbeat
- recovery execution after both inactivity and threshold are satisfied

The proof currently handles native Sepolia ETH held by the contract.

## Creation and deployment flow

1. The server exposes the exact checked-in Solidity source.
2. The source has a SHA-256 fingerprint recorded in `contracts/manifest.json`.
3. The browser obtains a pinned Solidity compiler version (`0.8.24+commit.e11b9ed9`).
4. Compilation occurs locally in a browser Web Worker with optimizer enabled at 200 runs.
5. Constructor arguments are generated from the chain-neutral Core policy plus a test-only inactivity override.
6. MetaMask signs the deployment transaction. OmegaVault never receives the private key.
7. After mining, OmegaVault reads the deployed bytecode and public configuration back from Sepolia.
8. The deployment is rejected unless runtime bytecode and policy-critical configuration match expectations.
9. Only a verified deployment may be bound to the Core vault record.

## Versioning

The 0.4 proof records:

- application version
- adapter version
- contract version
- numeric on-chain adapter version (`400`)
- compiler version
- exact source SHA-256
- network reference
- deployment transaction reference
- runtime/config verification evidence

Changing contract code requires a new source hash and version. Existing deployments are never silently treated as a different version.

## Why production should not compile arbitrary new contracts for every user

For the proof, local compilation is valuable because it makes the exact code obvious and testable. For production, a stronger deployment model is likely:

- one independently audited implementation or recovery module
- a versioned factory/registry
- deterministic or otherwise reproducible deployments
- source and bytecode published for verification
- explicit upgrade policy (preferably immutable or tightly constrained)

Possible Ethereum production architectures to evaluate:

### A. Dedicated vault contract

Assets are deliberately deposited into an OmegaVault-controlled smart contract whose rules are enforced on-chain.

Advantages: clear policy enforcement, easy state inspection.

Tradeoff: users must move assets into the vault; token/NFT support and integrations broaden attack surface.

### B. Smart account / account-abstraction recovery module

Recovery is attached to a smart account rather than a separate holding vault.

Advantages: recovery can govern the account itself and can support broader assets/actions.

Tradeoff: module architecture, bundlers/paymasters, upgradeability and smart-account ecosystem dependencies require additional audit scope.

### C. Chain-native recovery mechanisms

For non-EVM chains, use the chain's native signer/script/program primitives rather than forcing Solidity concepts into the connector.

## Remaining contract safety gates

Before production value:

1. compile and test with a reproducible local toolchain
2. pin and verify the compiler artifact checksum
3. Foundry/Hardhat executable contract tests
4. fuzz/property testing of the Solidity contract
5. invariant testing
6. static analysis (for example Slither or equivalent)
7. gas griefing and worst-case contact-list tests
8. reentrancy/adversarial recipient tests
9. timestamp-boundary tests
10. forced-ETH and unusual balance behavior tests
11. chain reorg/finality tests in the adapter
12. independent RPC verification
13. external professional smart-contract audit
14. production mechanism decision: vault vs smart account/recovery module
15. token/NFT handling reviewed separately rather than assumed from native ETH

## Current safety posture

The current contract is explicitly a test proof. It should hold only Sepolia test ETH. The application has no switch that enables production Ethereum value.
