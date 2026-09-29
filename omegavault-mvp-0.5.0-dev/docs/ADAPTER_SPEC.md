# OmegaVault Chain Adapter Contract — Draft 0.3

The purpose of this interface is to prevent the first Ethereum implementation from defining OmegaVault's Core semantics.

## Chain-neutral inputs

An adapter receives concepts such as:

- owner account reference
- rescue destination reference
- trusted-contact references
- threshold
- inactivity policy or adapter test override
- requested operation

It must not require Core to know the chain's nonce model, calldata model, script model, fee market, signature encoding, or transaction serialization.

## Capability model

Adapters advertise capabilities rather than pretending every chain supports the same mechanism. Examples:

- `account-connect`
- `balance-read`
- `message-sign`
- `testnet-contract-deploy`
- `onchain-heartbeat`
- `onchain-recovery`

A future Bitcoin adapter might use a UTXO/script or pre-signed-transaction design; XRPL could use native signer/account features; Solana could use program/PDA semantics. Those implementations should map into the same Core policy lifecycle without copying EVM transaction behavior.

## Required implementation responsibilities

A live adapter should eventually provide equivalents for:

1. `connectAccount()`
2. `currentAccount()`
3. `network()`
4. `readNativeBalance()`
5. `preflight()`
6. `prepare/deploy recovery mechanism` where the chain requires deployment
7. `verifyDeployment()` or equivalent mechanism verification
8. `readRecoveryState()`
9. `heartbeat()` or chain-specific liveness proof
10. `approveRecovery()`
11. `executeRecovery()`
12. transaction/reference normalization
13. explorer/reference generation

## Binding requirements

A binding should record, where applicable:

- chain ID
- chain family
- network reference
- mechanism/contract/account/script reference
- creation transaction reference
- adapter version
- mechanism version
- code/config fingerprint
- verification status + evidence summary
- whether the binding is test-only

## Non-EVM fixture expectations

The registry currently includes validation fixtures for:

- XRPL classic addresses
- Solana base58 public keys
- Bitcoin address families
- XDC account-format compatibility

These fixtures are not implementations. They exist to keep Core tests honest about address-shape diversity while later adapters are designed.
