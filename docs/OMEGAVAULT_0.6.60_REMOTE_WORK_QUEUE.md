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
- [x] Diagnose the Ogmios 401 sequence through direct provider tests: raw WebSocket upgrade with the Demeter header succeeds, while Node `ws` required `perMessageDeflate:false` and Demeter can reject rapid second authenticated sessions.
- [x] Add `closeAndWait()` to the Ogmios WebSocket client and disable `permessage-deflate` negotiation for Demeter compatibility.
- [x] Change the guided real-initialize flow to avoid a redundant parent Ogmios session and let the capture own the single authenticated WebSocket session.
- [x] Add regression coverage for authenticated Ogmios socket release, Demeter compression compatibility, and the single-session guided flow.
- [x] Add a read-only two-connection Ogmios reconnect diagnostic that never prints credentials and never signs/submits.
- [x] Normalize live Cardano CLI Ogmios endpoints to WebSocket transport so an `https://` environment endpoint cannot silently fall back to incompatible HTTP RPC behavior.
- [x] Run a repository-side audit of the next signed/current-ledger phase-one gate and document the exact covered/uncovered authority boundary.
- [x] Harden unsigned/wallet-witness validation so the Cardano transaction validity flag must remain true.
- [x] Review current Cardano operator documentation for stale wording after the signing/reconnect changes; retain the explicitly versioned 0.6.11/0.6.12 historical documents unchanged as historical evidence.
- [x] Prepare the exact post-signing operator handoff/checklist so the workstation steps remain one-command-at-a-time.


## Next remote engineering block

- [x] Define the real Cardano Preprod lifecycle roadmap from initialize through immutable rescue.
- [x] Build post-initialize observation/inclusion evidence that binds the exact signed transaction to the expected recovery-vault state UTxO without claiming finality.
- [x] Build the real heartbeat predecessor/funding/collateral plan from an observed active state UTxO.
- [x] Build the unsigned real-heartbeat candidate construction and live-evaluation scaffold from that bound plan.
- [x] Build the real contact-approval construction scaffold with independent-contact authority checks.
- [x] Build the real execute/rescue construction scaffold with immutable-destination and full-value payout checks.
- [x] Add lifecycle adversarial tests covering stale state, duplicate approval, unconfigured contact, premature execute, wrong rescue destination, continuing state/beacon and protected-value leakage.
- [x] Define Cardano Preprod inclusion/finality evidence separately from mere transaction inclusion before any support-promotion work.

Remote implementation note: the lifecycle scaffold was locally executed on the workstation on 2026-10-09: the real-lifecycle suite passed 43/43. The focused Ogmios transport suite also passed locally before the subsequent provider-compatibility fixes; the newest transport-normalization changes still require the next local pull/test.\n\n## Parallel multichain remote work while Cardano awaits workstation verification

- [x] Formalize the invariant-first / chain-native implementation rule for XRPL rather than forcing EVM/Cardano mechanics onto it.
- [x] Add an XRPL native-composition assessment that keeps Signer Lists, Permission Delegation, Escrow, Tickets and Batch distinct and fails closed on unresolved resettable-inactivity/contact-redirection gaps.
- [x] Keep Hooks-family programmable research explicitly separate from XRPL mainnet support claims.
- [x] Reframe XRPL maturity wording around invariant equivalence rather than one missing primitive.
- [x] Prepare a precise Solana pinned-toolchain / SBF artifact provenance rebuild plan without rewriting the existing Solana recovery architecture.
- [x] Add explicit XRPL Permission Delegation transaction/evidence modeling.
- [x] Model the strongest XRPL-native recovery sequence and adversarially test authority leakage, destination substitution, stale recovery, replay and owner-reset behavior.
- [x] Prepare Ethereum 0.4.3 Sepolia live-proof migration mapping into the 0.6 evidence-contract gate without rerunning historical work unnecessarily.

## Additional parallel remote work

- [x] Reconcile the XRPL Permission Delegation and native-sequence findings into the product-tier/capability wording without weakening the canonical invariants.
- [x] Prepare a fail-closed XRPL public-Testnet evidence capture plan for the primitives that *are* honestly supported today (SignerList, DelegateSet, Escrow, Ticket/Batch capability checks) without claiming exact OmegaVault recovery.
- [x] Audit the Ethereum Sepolia legacy migration path for the exact historical identifiers still preserved in repository/checkpoint metadata; if absent, explicitly record which gates require fresh proof.
- [x] Prepare Solana artifact rebuild evidence schema so a future pinned SBF rebuild can replace the stale artifact deterministically rather than by hand-editing evidence JSON.

## Workstation-required gates

- [x] Fast-forward the laptop to the latest remote branch head (through the successful capture/signing state; newest provider-normalization commits require one more pull).
- [ ] Run the read-only Ethereum 0.4.3 identifier inspector against `~/.omegavault-test/vaults.json` so retained Sepolia contract/transaction identifiers can be rebound instead of unnecessarily repeated.
- [x] Run the targeted Ogmios transport regression test locally (14/14 green before the newest transport-normalization follow-up).
- [x] Rerun the guided real Cardano Preprod initialize capture using the existing test-only addresses and provider credentials.
- [x] Confirm the fresh unsigned preflight remains green.
- [x] Human-authorized Lace signing of exact body hash `92a32dd6ec064752525d7482119b8fd20304445f4a63b47ffb5f64dbfe140455` only; submission explicitly not authorized.
- [x] Verify the wallet-produced owner witness offline; signing gate completed with submission still unauthorized.
- [ ] Pull the newest WebSocket-normalization fixes, rerun the focused transport regression, then rerun the live pre-submit freshness gate against the signed transaction. If the signed validity window has expired, regenerate a fresh capture and obtain a new exact-body-hash signing authorization rather than reusing the old one.
- [ ] Independently complete the remaining signed/current-ledger phase-one validation.
- [ ] Obtain a separate explicit human authorization before any Preprod submission.
- [ ] Prove inclusion/finality.
- [ ] Exercise the real Preprod lifecycle/recovery path.
- [ ] Consider support-promotion only after all required evidence gates are satisfied.

## Authority boundary

No remote-only task may create or control wallet private keys, sign transactions, submit transactions, move value, promote Cardano support, or claim public-network recovery. Wallet signing and transaction submission remain separate explicit human gates.
