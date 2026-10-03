# OmegaVault MVP 0.6.22-dev

> Development branch built on the **completed 0.4.3 Sepolia recovery proof**. The proven 0.4.3 runtime remains intact while multichain mechanisms are built and tested offline. No new connector is promoted to live proof until its chain-specific gates pass.

## 0.5.0-dev additions

- chain/network-scoped asset identities
- signer vs fee-payer action plans
- digest-bound evidence records
- development ERC-20 post-recovery sweep contract (`OmegaVaultRecoveryVaultV050.sol`)
- relayer/paymaster sponsorship abstraction (scaffold only)
- additional automated tests; no production-value enablement

## Stable 0.4.3 baseline

## 0.4.3 resume + role-switching hardening

This patch is specifically for the live-test friction discovered on MetaMask Mobile. It does **not** change the deployed Solidity proof contract.

- test data now persists in a stable user-level directory (`~/.omegavault-test`) instead of being trapped inside each extracted version folder
- first run automatically imports prior `0.4.x` vault records from common Downloads-folder layouts and reuses a cached Solidity compiler when available
- the latest verified deployed vault is automatically resumed after refresh/restart
- one-time **Authorize test roles** permission flow lets MetaMask expose Owner + trusted-contact accounts together
- contract actions specify the configured signer explicitly, so the user no longer has to disconnect/reconnect for each role
- Owner-only contact funding now tops each trusted contact up to a target Sepolia balance and skips contacts already funded
- on-chain refresh shows each trusted contact's approval status and Sepolia gas balance
- `START-OMEGAVAULT.cmd` starts the Windows test server from the correct folder without manual `cd` navigation
- no redeployment is required to use these improvements with an already bound 0.4.0 proof contract


## 0.4.1 mobile compiler compatibility patch

The local test server CSP now permits WebAssembly compilation via the narrow `wasm-unsafe-eval` CSP token. This is required by the pinned Solidity compiler in Chromium-based mobile wallet browsers such as MetaMask. It does **not** enable general JavaScript `unsafe-eval`. No contract source, recovery policy, adapter logic, or production/network restriction changed in this patch.

Chain-agnostic non-custodial recovery-wallet proof with **Ethereum Sepolia as the first live adapter** and explicit connector scaffolds for XRPL, Solana, Bitcoin, and XDC.

> **Test only.** This build refuses Ethereum mainnet proof bindings and should never hold production value. The Solidity proof contract has not been independently audited.

## What changed in 0.4

- formal chain-adapter interface so non-EVM connectors cannot silently inherit Ethereum assumptions
- separate connector descriptors for Ethereum, XRPL, Solana, Bitcoin, and XDC
- explicit connector implementation stages (`live-proof`, `scaffold`, `planned`)
- connector-specific account, transaction, signing, and candidate recovery-mechanism metadata
- Solidity source manifest with exact source SHA-256 and deployment policy
- contract-manifest verification command included in `npm run check`
- adapter contract version bumped to 0.4.0 / numeric on-chain version `400`
- deterministic property/invariant sweeps covering duplicate votes, threshold behavior, heartbeat reset, and destination immutability
- static contract sanity checks for dangerous primitives and checks-effects-interactions ordering
- connector roadmap for XRPL, Solana, Bitcoin, and XDC
- documented Ethereum smart-contract creation/versioning/deployment lifecycle
- 2026 marketing/channel research notes, including crypto ad-policy constraints and launch experiment design
- all prior 0.3 Sepolia verification, role controls, runbook, audit, and test/mainnet boundaries retained

## Requirements

- Node.js 22.12+
- a browser wallet for the Ethereum proof
- Sepolia test ETH only

Runtime dependencies are pinned for exact Stellar, Cardano, Bitcoin-curve and XRPL offline construction/verification paths.

## Start

```bash
npm start
```

Open the local URL printed by the server:

```text
http://localhost:8787
```

### Keep MetaMask on the phone

When the computer and phone are on the same **trusted** Wi-Fi/LAN, the server also prints addresses similar to:

```text
Phone on the same trusted LAN: http://192.168.1.25:8787
```

Open that LAN URL inside **MetaMask Mobile's in-app browser**. This lets the phone remain the wallet/signing device while the computer merely runs the local OmegaVault server.

Do not use this plain-HTTP LAN test arrangement on public Wi-Fi or for real assets.

## First live smoke test

For the fastest first pass, use test-only addresses and:

- owner: the funded Sepolia account
- trusted contacts: 1 separate test account
- rescue destination: another test address
- threshold: 1
- Core inactivity: 30 days (example)
- Ethereum test override: 60 seconds
- deposit: around 0.001 Sepolia ETH

The trusted-contact account needs a little Sepolia ETH to pay gas for `approveRecovery()`.

The UI's **Live-test runbook** tracks:

1. wallet connected
2. Sepolia active
3. Core policy created
4. proof compiled
5. deployment verified/bound
6. test ETH funded
7. inactivity elapsed
8. threshold approvals reached
9. recovery executed

See `docs/TEST_PLAN.md` for the full pass/fail script.

## Architectural boundary

OmegaVault Core works with concepts such as:

```text
Owner
RescueDestination
TrustedContact
Threshold
InactivityPolicy
RecoveryLifecycle
ChainBinding
ChainActivityReference
```

Ethereum-specific concepts live in the Ethereum/EVM adapter layer. XRPL, Solana, Bitcoin, and XDC have their own connector descriptors and must graduate through independent chain-specific test gates.

See:

- `docs/ARCHITECTURE.md`
- `docs/ADAPTER_SPEC.md`
- `docs/CONNECTOR_ROADMAP.md`
- `docs/SMART_CONTRACT_LIFECYCLE.md`
- `docs/THREAT_MODEL.md`
- `docs/SECURITY_REVIEW.md`
- `docs/TEST_PLAN.md`
- `docs/MARKETING_RESEARCH_2026.md`

## Tests

```bash
npm run check
npm test
```

Detached external-review receipt signatures are verified independently from
reviewer trust. A valid Ed25519 signature proves only that the supplied key
authenticated the receipt. Reviewer trust requires a separately controlled
`omegavault.reviewer-key-trust.v1` file:

```bash
npm run review:receipt:verify -- \
  --receipt receipt.json \
  --signature receipt.signature.json \
  --public-key reviewer-public.pem

npm run review:receipt:verify -- \
  --receipt receipt.json \
  --signature receipt.signature.json \
  --public-key reviewer-public.pem \
  --trust reviewer-trust.json \
  --require-trusted-reviewer
```

Neither signature authentication nor reviewer trust has chain- or
evidence-promotion authority.

Reviewer trust can also be managed as an append-only digest-linked history.
The CLI accepts public keys only; it never reads or creates a private key:

```bash
npm run review:trust:append -- \
  --reviewer audit-team \
  --public-key reviewer-public.pem \
  --action enroll \
  --configured-by review-policy \
  --configured-at 2026-10-03T05:00:00Z \
  --output reviewer-trust-history.json \
  --snapshot-output reviewer-trust-history.snapshot.json

npm run review:receipt:verify -- \
  --receipt receipt.json \
  --signature receipt.signature.json \
  --public-key reviewer-public.pem \
  --trust-history reviewer-trust-history.json \
  --trust-history-snapshot reviewer-trust-history.snapshot.json \
  --require-trusted-reviewer
```

Rotation binds the new key to the previous event and previous key fingerprint.
Revocation is terminal. A separately stored snapshot binds the expected event
count and head digest so a valid historical prefix cannot be replayed as the
current trust policy.

The current trust-policy snapshot can be bound to one exact external review
index in a separate audit sidecar:

```bash
npm run review:trust:anchor -- \
  --external-review-index checkpoint.review-index.json \
  --trust-history reviewer-trust-history.json \
  --trust-history-snapshot reviewer-trust-history.snapshot.json \
  --anchored-by independent-policy-registry \
  --anchored-at 2026-10-03T07:00:00Z \
  --output reviewer-trust-policy.anchor.json

npm run review:trust:anchor:verify -- \
  --anchor reviewer-trust-policy.anchor.json \
  --external-review-index checkpoint.review-index.json \
  --trust-history reviewer-trust-history.json \
  --trust-history-snapshot reviewer-trust-history.snapshot.json

npm run review:trust:anchor:append -- \
  --anchor reviewer-trust-policy.anchor.json \
  --history reviewer-trust-policy-anchor-history.json \
  --output reviewer-trust-policy-anchor-history.next.json \
  --snapshot-output reviewer-trust-policy-anchor-history.snapshot.next.json

npm run review:trust:anchor:history:verify -- \
  --anchor reviewer-trust-policy.anchor.json \
  --history reviewer-trust-policy-anchor-history.next.json \
  --history-snapshot reviewer-trust-policy-anchor-history.snapshot.next.json
```

Receipt verification can require that anchor with `--trust-policy-anchor` and
`--external-review-index`. The external review-index digest must also match the
digest already bound into the receipt. This prevents a valid stale policy pair
or a policy from another checkpoint from being accepted as current. The anchor
is integrity metadata, not reviewer identity authentication or promotion
authority.

Successive policy anchors can be kept in an append-only digest-linked history.
Each entry binds the exact predecessor entry and predecessor anchor. A separate
head snapshot binds the current entry count and head digests, and receipt
verification accepts `--trust-policy-anchor-history` plus
`--trust-policy-anchor-history-snapshot` to reject an otherwise-valid older
anchor. These files remain public integrity metadata with no promotion
authority.

The full 0.6.16 development package currently passes **186 JavaScript tests** with zero failures plus **7/7 Aiken on-chain tests**. `npm run check` syntax-checks the existing JavaScript modules and verifies the pinned EVM/TRON artifacts. `npm run check:xrpl` verifies deterministic signer preimages, signatures and canonical multisigned-binary evidence. `npm run check:solana` verifies native-source hashes, exact PDA derivation and instruction/account-meta evidence without claiming Rust compilation. `npm run check:bitcoin` verifies the Bitcoin Core descriptor/PSBTv2 evidence. `npm run check:cardano` formats, tests and compiles the pinned Aiken Plutus V3 project, reapplies the non-deployable fixture parameters, verifies script identities/addresses, validates the epoch-316 protocol snapshot, and checks deterministic signed-size, fee, minimum-ADA, collateral and zero-budget Ogmios evaluation-request evidence while preserving the independent-node live-construction block.

## Important limitations

Deployment verification currently reads chain state through the injected wallet provider. A production system should independently verify receipts, code, and state through a separate RPC/indexer before treating chain events as authoritative Core state.

The new TRON build pins the exact TRON compiler distribution and binary checksum. The earlier browser-downloaded Ethereum compiler artifact still lacks an independent binary checksum; that remains a production-preparation item for the EVM proof line.

## 0.6.3 multichain offline build

The active build queue lives in `docs/MULTICHAIN_EXECUTION_PLAN.md`. 0.6.3 retains the completed Stellar native-envelope work and closes the TRON exact-semantics offline core:

- complete common fee/public-state/simulator infrastructure
- reusable EVM deterministic-deployment verifier, compatibility report and native/ERC-20 proof runners
- exact Stellar recovery XDR generation and round-trip validation pinned to `@stellar/stellar-sdk` 17.1.0
- fail-closed Stellar account/signer snapshot checks, exact contact-signature coordination and applied-failure/preAuthTx-consumption handling
- corrected native Stellar scope: exact N-of-N with one or two contacts via transaction `extraSigners`; broader M-of-N requires Soroban rather than a weakened weighted-signer claim
- TRON TVM vault selected for exact semantics, with immutable policy, epoch heartbeat reset, threshold approvals, TRX execution and post-recovery TRC-20 sweeping
- official TRON Solidity 0.8.31 compilation via TronBox 4.11.0, preserved standard JSON input/output, bytecode artifacts, compiler checksum and build manifest
- TRON Base58Check address validation, deployment/call plans, immutable-aware runtime/config verifier and solidification-aware TRX/TRC-20 proof runners
- XRPL SignerListSet builder, multisign coordinator, Ticket support, XRP/fungible-token escrow capability gates and EscrowFinish plan
- Solana offline PDA vault state machine, explicit SPL vs Token-2022 identity, transaction-lifetime and program-verification plans, plus a Rust source skeleton (not compiled because no Rust toolchain is present)
- Bitcoin CSV-delayed recovery policy, UTXO-rollover heartbeat, PSBTv2 intent/signature coordinator, fee-bump plan and a fail-closed immutable-rescue assessment
- Cardano exact-path decision in favor of a Plutus/Aiken state-UTXO validator, with offline heartbeat/approval/execute invariant models and a toolchain-pending validator scaffold

No new connector is promoted to live proof by this scaffold. Ethereum Sepolia remains the only completed public-network proof until the corresponding live tests are executed.
