# OmegaVault Chain Assessment 0.6.17

## Solana

The native SOL program is now compile-proven and execution-proven offline. Agave 4.3.0 executed the compiled SBF artifact through `solana-program-test`; two end-to-end scenarios covered all four instructions and adversarial failures around time, contact membership, threshold, rescue binding, heartbeat resets and post-recovery mutation. The artifact and full build inputs are hash-bound in versioned evidence.

The Solana connector is not live-proof. Token execution, extension-aware Token-2022 handling, compute/rent/lifetime integration and Devnet evidence remain open promotion gates.

## Other chains

No connector promotion changed. Ethereum Sepolia remains the only completed public-network proof. Stellar and TRON await public proofs; XRPL retains its resettable-inactivity semantic gap; Bitcoin retains reduced semantics; Cardano awaits independent synchronized-node evaluation.

## 0.6.18 Solana token-safety delta

SPL Token / Token-2022 recovery planning now fails closed unless checked decimals match the mint, the amount is available in base units, both token accounts are thawed, and the rescue token account is independently verified as the canonical associated token account. Token-2022 extensions that can change transfer economics or authority are explicitly blocked pending SBF-level implementation and execution tests. This improves preflight safety but does not promote token recovery to offline execution-proven or live-proof.
