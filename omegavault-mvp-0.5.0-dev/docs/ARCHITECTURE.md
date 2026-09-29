# OmegaVault Architecture — MVP 0.4

## Core rule

OmegaVault Core expresses recovery concepts, not Ethereum concepts.

Core objects include:

- owner account
- rescue destination
- trusted contacts
- M-of-N threshold
- inactivity policy
- recovery lifecycle
- chain binding references
- chain activity references
- audit history

Core does **not** assume every chain has:

- `msg.sender`
- Solidity addresses
- EVM nonces
- ERC-20
- EVM calldata
- Ethereum transaction formats

## Layers

### 1. OmegaVault Core

`src/core/recovery.js`

Validates policies and handles chain-neutral state transitions. `policyState()` exposes a derived lifecycle view (`protected`, `inactive_eligible`, `awaiting_approvals`, `recovery_ready`, `recovered`) without changing the underlying chain model.

A deployment can be attached using `bindChainDeployment()`, but adapter metadata never mutates the Core inactivity policy.

### 2. Chain registry

`src/chains/registry.js`

Defines public chain families and account-validation boundaries. Ethereum, XRPL, Solana, Bitcoin, and XDC are registered separately. An adapter implementation must satisfy OmegaVault's chain interface rather than inheriting Ethereum transaction/signature semantics.

### 3. Ethereum browser adapter

`public/chains/ethereum.js`

Implements the first live proof through EIP-1193:

- wallet connection
- Sepolia-only network guard
- balance reads
- message signing
- transaction preflight / gas estimation
- receipt polling
- Sepolia contract deployment
- runtime/config verification
- `eth_call` state reads
- deposit, heartbeat, trusted-contact approval, execution

The browser wallet remains the signing boundary.

### 4. EVM codec

`public/chains/evm-codec.js`

Contains ABI encoding/decoding, exact ETH quantity conversion, and runtime bytecode comparison with compiler-declared immutable regions masked. This is deliberately outside Core.

### 5. Ethereum proof contract

`contracts/OmegaVaultRecoveryVault.sol`

A Sepolia proof harness. It implements:

- immutable owner
- immutable rescue destination
- trusted-contact set
- M-of-N threshold
- short adapter-only inactivity timer
- owner heartbeat that clears approvals
- trusted-contact approvals
- permissionless execution after eligibility + threshold
- native Sepolia ETH recovery

The proof contract exposes `ADAPTER_VERSION = 400` and limits trusted contacts to 32 to bound the approval-reset loop. That 32-contact cap belongs to the Ethereum proof adapter, not the chain-neutral Core model.

### 6. Verified chain binding

The server refuses to bind the Ethereum proof unless all of the following are supplied:

- chain = Ethereum
- network = Sepolia (`0xaa36a7`)
- `testOnly = true`
- deployment receipt reference
- runtime/config verification passed
- adapter version
- contract version
- source SHA-256

Example:

```json
{
  "chainBindings": {
    "ethereum": {
      "chainId": "ethereum",
      "family": "evm",
      "networkRef": "0xaa36a7",
      "contractRef": "0x...",
      "deploymentTxRef": "0x...",
      "testOnly": true,
      "testInactivitySeconds": 60,
      "adapterVersion": "0.4.0",
      "contractVersion": "0.4.0",
      "sourceSha256": "...",
      "deploymentVerified": true
    }
  }
}
```

### 7. Deployment verification

After mining but **before binding**, the browser adapter checks:

1. active network is Sepolia
2. deployed runtime bytecode matches locally compiled runtime bytecode, with compiler-declared immutable ranges masked
3. owner matches the Core owner
4. rescue destination matches the Core destination
5. threshold matches
6. test inactivity period matches
7. contract adapter version word matches `400`
8. every Core trusted contact is recognized by the contract

A mined contract that fails any check remains unbound.

## Test vs production boundary

MVP 0.4 is hard-coded as `test-proof` mode. The server reports:

- `productionValueAllowed: false`
- `mainnetTransactionsEnabled: false`
- only Sepolia accepted for the Ethereum proof binding

No setting in this build turns on Ethereum mainnet value handling.

## Mobile signing path

The Node server prints both localhost and LAN addresses. This permits a useful test arrangement:

1. run OmegaVault on the computer
2. keep the test wallet on the phone
3. place both devices on the same **trusted** LAN
4. open the printed LAN URL inside MetaMask Mobile's in-app browser
5. sign Sepolia transactions on the phone

This avoids importing the test wallet seed into a desktop browser solely for the proof.

## Trust boundary

OmegaVault receives public accounts, transaction hashes, receipts, signatures, and public chain state. It does not request, collect, or store seed phrases/private keys.

The current server does not yet independently query an Ethereum RPC endpoint to re-verify browser-reported receipts. Runtime/config verification is performed through the injected wallet provider. Production authority should add independent RPC/indexer verification before chain events drive irreversible Core state.
