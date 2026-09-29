# OmegaVault Sepolia Live Test Plan — MVP 0.4

## Goal

Prove the first complete on-chain recovery cycle while keeping the OmegaVault Core policy separate from Ethereum-specific execution.

## Recommended first smoke-test roles

Use only test accounts:

- **Owner:** funded Sepolia test account
- **Trusted contact:** a second test Ethereum account
- **Rescue destination:** a third test Ethereum address
- **Core threshold:** 1-of-1 for the first live pass
- **Core inactivity:** e.g. 30 days
- **Ethereum proof inactivity override:** 60 seconds
- **Deposit:** e.g. 0.001 Sepolia ETH

The trusted-contact account needs enough Sepolia ETH for its approval transaction. The rescue destination does not need gas merely to receive recovered ETH.

After the smoke test passes, repeat with 2-of-3 contacts.

## Pre-test

1. Start the app with `npm start`.
2. If signing from MetaMask Mobile, place phone + computer on the same trusted LAN and open the printed LAN URL in MetaMask's in-app browser.
3. Connect the owner account.
4. Confirm the UI says Sepolia.
5. Create the Core policy.

## Live proof sequence

1. Compile contract.
2. Deploy from owner wallet.
3. Application must verify runtime/config before binding.
4. Deposit a small amount of Sepolia ETH.
5. Confirm on-chain contract balance is nonzero.
6. Wait until `secondsUntilEligible()` reaches zero.
7. Switch to trusted-contact account.
8. Submit recovery approval.
9. Confirm approval count reaches threshold.
10. Execute recovery (any funded account may submit once conditions are met).
11. Confirm contract reports `recovered = true` and balance reaches zero.
12. Confirm rescue address receives the recovered Sepolia ETH.

## Pass criteria

- no seed/private key entered into OmegaVault
- deployment only occurs on Sepolia
- deployment cannot bind until verification passes
- Core inactivity days remain unchanged despite the short test timer
- wrong-role buttons/actions are blocked or revert
- trusted approval increments once only
- threshold is enforced
- execution before eligibility/threshold fails
- successful recovery sends the full contract balance to the immutable rescue destination
- post-recovery second execution fails

## Adversarial follow-up cases

- duplicate approval from same trusted contact
- unauthorized account approval
- approval before inactivity elapses
- execution before threshold
- owner heartbeat after one approval (approval count returns to zero)
- owner heartbeat immediately before eligibility
- wrong-network attempt
- malformed/unverified binding attempt
- duplicate API activity submission
- 2-of-3 recovery where only one contact approves
- 2-of-3 recovery after owner heartbeat resets prior votes

## Evidence export

After any meaningful live-test milestone, use **Export test evidence**. The JSON file captures the local Core record, versioned binding metadata, audit history, observed network/account, and latest public on-chain state. It deliberately omits runtime bytecode from the state snapshot to keep the report compact.
