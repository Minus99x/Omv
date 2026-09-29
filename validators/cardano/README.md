# OmegaVault Cardano recovery validator

Status: **compiled offline; Preprod proof pending**. The project pins Aiken 1.1.24, the Aiken standard library 4.0.0 and Plutus V3. `plutus.json` is a generated CIP-57 blueprint verified by `npm run check:cardano`.

The offline model in `src/chains/cardano/recovery-validator.js` defines the validator invariants that an Aiken/Plutus implementation must preserve:

- one state-beacon UTXO identifies the active vault;
- owner heartbeat consumes/recreates state, resets approvals, and advances liveness time;
- trusted-contact approvals are inactivity-gated and update only the approval set;
- policy-critical owner/rescue/threshold/inactivity fields remain immutable;
- recovery requires threshold + inactivity;
- the transaction context must send the full protected value to the immutable rescue address;
- fees/collateral should come from external wallet inputs so recovery does not silently shave protected value;
- every continuing transition preserves protected value and exactly one state beacon;
- the one-shot minting policy requires a unique seed UTxO for the initial `+1` beacon mint;
- successful recovery burns exactly one beacon and sends the exact remaining protected value to the immutable rescue address.

Native scripts remain insufficient for the exact design because they cannot inspect outputs or update a state datum. Version 0.6.12 applies a synthetic, explicitly non-deployable seed and asset name to both validators, independently derives the resulting Preprod enterprise address, and round-trips initialization, heartbeat, approval and execute transaction-body CBOR with `@emurgo/cardano-serialization-lib-nodejs` 17.0.0. The fixture bodies retain marked placeholder fee/script-data values.

Version 0.6.14 adds deterministic synthetic key witnesses for exact signed-size/fee convergence, verifies every output against minimum ADA, checks declared collateral against the current percentage, and builds zero-budget transaction candidates for Ogmios `evaluateTransaction`. Evaluation responses are fail-closed on request identity, exact redeemer pointers, duplicates, omissions, positive budgets, safety-margin arithmetic and transaction execution-unit caps.

Ogmios execution-unit evaluation is not complete ledger validation: it permits omitted key witnesses and does not perform all phase-1 rules. Promotion therefore additionally requires a common acquired tip for UTxOs/parameters/evaluation plus independent balance, minimum-ADA, collateral and witness validation. The remaining offline work is independent full-cost-model confirmation and actual synchronized-node evaluation. This connector is not live-proof.
