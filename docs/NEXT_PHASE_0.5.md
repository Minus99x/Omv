# OmegaVault 0.5 development branch

This branch starts from the completed 0.4.3 Sepolia proof and deliberately does **not** replace that evidence-backed build.

## Proven baseline inherited from 0.4.3

- chain-neutral policy model
- verified Sepolia deployment binding
- owner heartbeat
- M-of-N trusted-contact approvals
- inactivity gate
- native Sepolia ETH recovery to an immutable rescue destination
- local evidence export
- browser wallet remains the signing boundary

## Added in 0.5.0-dev

### Chain-neutral asset identity

`src/core/assets.js` gives assets a network-scoped identity. Mainnet and testnet assets cannot collide merely because they share a symbol or contract address.

### Action plans with signer / fee-payer separation

`src/core/action-plan.js` separates the account that must authorize an action from the account/service that pays its network fee. This is the foundation for relayed or paymaster-funded trusted-contact approvals without changing the non-custodial signing boundary.

### Digest-bound evidence records

`src/core/evidence.js` creates canonical OmegaVault evidence records with a SHA-256 digest so later test harnesses can detect accidental or intentional mutation of the exported record.

### ERC-20 recovery development contract

`contracts/OmegaVaultRecoveryVaultV050.sol` is a **new test-only development contract**. It preserves the 0.4 native recovery mechanism and adds `recoverERC20(address)` after the threshold recovery has executed. The token destination is always the immutable rescue destination.

This contract is not audited, not deployed by this package automatically, and must not hold production value.

### Sponsorship abstraction

`src/chains/evm/sponsorship.js` models self-funded, relayer, and paymaster modes. Only self-funded mode is currently marked available. Relayer/paymaster modes remain scaffolded until an actual independently tested service is integrated.

## Deliberately not claimed yet

- no production Ethereum deployment
- no live ERC-20 recovery proof yet
- no live sponsored/gasless trusted-contact approval yet
- no XRPL/Solana/Bitcoin live proof yet
- no professional contract audit

## Next test sequence

1. Compile and bytecode-verify the 0.5 development contract.
2. Deploy it to Sepolia as a **new test-only mechanism** without modifying the completed 0.4.3 proof evidence.
3. Deposit a test ERC-20 into the new vault.
4. Perform the already-proven 2-of-2 recovery authorization.
5. Execute native recovery.
6. Call `recoverERC20(token)` and verify the full token balance reaches the immutable rescue destination.
7. Export an `OmegaVault-evidence/0.5` record and verify its digest.
8. Only after that proof, wire token recovery into the main UI.
9. Implement and test a relayed approval path so trusted contacts can authorize without holding the gas token.
10. Promote one non-EVM connector from scaffold to live proof using native chain primitives.
