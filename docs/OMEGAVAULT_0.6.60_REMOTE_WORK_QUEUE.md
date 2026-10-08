# OmegaVault 0.6.60 Remote / Workstation Work Queue

Branch: `dev/0.6.60-reconcile-overnight-bitcoin`

This checklist separates work that can be completed remotely in the repository from work that requires Joel at the Windows/Lace workstation.

## Remote-only work

- [x] Add fail-closed Lace/CIP-30 owner-witness merge logic.
- [x] Add guided local Lace signing gate with no transaction-submission path.
- [x] Bind every Lace signing authorization to the exact fresh frozen transaction body hash so an expired/changed candidate cannot inherit an earlier approval.
- [x] Add stale/near-expiry candidate guard before wallet signing.
- [x] Add wrong-signer, extra-witness and non-VKey-injection regression tests.
- [x] Add operator documentation for the Lace signing-only gate.
- [x] Diagnose the repeated post-preflight Ogmios HTTP 401 as a second WebSocket connection/reconnect boundary, not an address or recovery-config failure.
- [x] Add `closeAndWait()` to the Ogmios WebSocket client so the preflight connection is fully released before capture starts.
- [x] Change the guided preflight to await the Ogmios socket shutdown before launching the capture child process.
- [x] Add a regression test covering authenticated Ogmios socket release followed by a later reconnect.
- [x] Add a read-only two-connection Ogmios reconnect diagnostic that never prints credentials and never signs/submits.
- [x] Wire the reconnect diagnostic into package scripts/checks and document the HTTP 401 diagnostic path.
- [x] Run a repository-side audit of the next signed/current-ledger phase-one gate and document the exact covered/uncovered authority boundary.
- [x] Harden unsigned/wallet-witness validation so the Cardano transaction validity flag must remain true.
- [x] Review current Cardano operator documentation for stale wording after the signing/reconnect changes; retain the explicitly versioned 0.6.11/0.6.12 historical documents unchanged as historical evidence.
- [x] Prepare the exact post-signing operator handoff/checklist so the workstation steps remain one-command-at-a-time.


## Next remote engineering block

- [x] Define the real Cardano Preprod lifecycle roadmap from initialize through immutable rescue.
- [x] Build post-initialize observation/inclusion evidence that binds the exact signed transaction to the expected recovery-vault state UTxO without claiming finality.
- [x] Build the real heartbeat predecessor/funding/collateral plan from an observed active state UTxO.
- [ ] Build the unsigned real-heartbeat candidate construction and live-evaluation scaffold from that bound plan.
- [ ] Build the real contact-approval construction scaffold with independent-contact authority checks.
- [ ] Build the real execute/rescue construction scaffold with immutable-destination and full-value payout checks.
- [ ] Add lifecycle adversarial tests covering stale state, duplicate approval, unconfigured contact, premature execute, wrong rescue destination, continuing state/beacon and protected-value leakage.
- [ ] Define Cardano Preprod inclusion/finality evidence separately from mere transaction inclusion before any support-promotion work.

## Workstation-required gates

- [ ] Fast-forward the laptop to the latest remote branch head.
- [ ] Run the targeted Ogmios transport regression test locally.
- [ ] Rerun the guided real Cardano Preprod initialize capture using the existing test-only addresses and provider credentials.
- [ ] Confirm the fresh unsigned preflight remains green.
- [ ] Human-authorized Lace signing of the exact fresh frozen transaction only.
- [ ] Verify the wallet-produced owner witness offline.
- [ ] Run the live pre-submit freshness gate against the signed transaction.
- [ ] Independently complete the remaining signed/current-ledger phase-one validation.
- [ ] Obtain a separate explicit human authorization before any Preprod submission.
- [ ] Prove inclusion/finality.
- [ ] Exercise the real Preprod lifecycle/recovery path.
- [ ] Consider support-promotion only after all required evidence gates are satisfied.

## Authority boundary

No remote-only task may create or control wallet private keys, sign transactions, submit transactions, move value, promote Cardano support, or claim public-network recovery. Wallet signing and transaction submission remain separate explicit human gates.
