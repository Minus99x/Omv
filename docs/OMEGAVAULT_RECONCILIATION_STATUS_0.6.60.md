# OmegaVault 0.6.60 Reconciliation Status

Status date: 2026-10-07

## Canonical reconciliation branch

`dev/0.6.60-reconcile-overnight-bitcoin`

This branch was created from the Cardano 0.6.60 line at:

`82eadfb5106a4c2ca3f725adcbc75c8823988f9e`

and preserves the substantive unique Bitcoin, Stellar, EVM, TRON and Solana-integrity work from the divergent overnight branch:

`dev/0.6.41-review-receipts`

Overnight handoff head:

`93a256be61f345612fc3eba15eae3fcaa6259214`

The original branches and `main` were not reset or overwritten.

## Reconciled functional work

The integration branch now contains the overnight chain implementations/tests while preserving the later Cardano 0.6.49-0.6.60 program and its authority boundaries.

Shared package, CI, maturity and capability state was reconciled additively rather than accepting either divergent branch wholesale.

Historical 0.6.48 and 0.6.59 checkpoint prose remains historical; it is not used to move the live integration branch backward.

## Bitcoin Core fee-diagnostic hardening

Completed on the integration branch:

- deterministic raw/stripped transaction identity is independently recomputed before Core evidence is accepted;
- exact txid and wtxid are recomputed from serialized bytes;
- transaction byte size, stripped size, weight and virtual size are independently checked;
- bound finalizer evidence digest is verified;
- `testmempoolaccept` accepted results must provide exact vsize and fee diagnostics;
- `fees.base` must equal the deterministic extracted input-minus-output fee;
- effective fee diagnostics must bind exclusively to the extracted wtxid;
- rejected acceptance results cannot carry successful fee/vsize diagnostics;
- imported evidence cannot claim live-RPC proof;
- receipt chains reject stale, replayed, reordered, cross-transaction or mixed-provenance observations.

Primary commits:

- `65ca565dfcad37fc42da1744e827008905ce206d` — bind Core fee diagnostics to extracted transaction
- `39415c0c105f544fe9f21f8dea7c5fb186f254f7` — adversarial fee-diagnostic coverage
- `e29f993f2e593045904613fa8d98cf3a89830de7` — update imported Core fixtures
- `58e41d7af4ad93c386266ebe55ca23db963f1829` — harden observation receipt chain
- `fe1112321ccc720f68ef282cafe2ee7c54adef0a` — reject receipt-chain transaction/provenance drift

Exact verification boundary for that gate:

GitHub Actions run `37576402139`: **completed / success**.

## Signet provenance separation

Signet observation evidence now explicitly distinguishes:

- `offline-fixture`
- `imported-json`
- `bitcoin-core-rpc`

Only explicitly marked Bitcoin-Core RPC provenance can set `publicSignetObservationProven: true`.

Even then:

- `chainPromotionAuthority` remains false;
- `immutableRescueOnChain` remains false;
- no broadcast authority is granted;
- no wallet/private-key/seed authority is granted;
- no mainnet or production authority is granted.

Primary commits:

- `8547e4d59632ddb7fbebd6dbb031fb6ecb5c50d6` — separate Signet observation provenance
- `9cbc74777991c92a5d81d16c529add0f8f6d5cae` — enforce Signet provenance boundaries

Exact verification boundary:

GitHub Actions run `37576655976`: **completed / success**.

## Exact verification counts at 9cbc74777991c92a5d81d16c529add0f8f6d5cae

- Review/audit: **84/84 passed**
- Stellar recovery: **30/30 passed**
- Stellar native: **98/98 passed**
- Bitcoin recovery: **22/22 passed**
- Bitcoin native: **53/53 passed**
- Maturity/provenance: **22/22 passed**
- Core invariant/support gate: **19/19 passed**
- Cardano maturity/provenance reconciliation: **12/12 passed**
- Cardano Preprod evidence harness: **47/47 passed**
- Cardano Preprod capture session/manifest: **4/4 passed**
- Cardano Preprod invariant program: **6/6 passed**
- Cardano Preprod four-action campaign: **7/7 passed**
- Cardano workstation launch gate: **5/5 passed**
- Cardano campaign workstation launch gate: **2/2 passed**
- Full suite: **664/664 passed**
- Offline-resume Stellar: **26/26 passed**
- Offline-resume Bitcoin: **11/11 passed**
- Global checks: **passed**
- Failures: **0**

## Authority state

No chain is promoted by this reconciliation or Bitcoin hardening work.

No production deployment, mainnet/live-value write, wallet signing, private-key handling, seed/recovery-phrase handling, transaction broadcast or chain-promotion authority was performed or granted.

Cardano remains `offline-verified`.

Bitcoin remains `reduced-semantics`.

Solana remains `parked` with the checked-in SBF artifact treated as stale/untrusted until a pinned Rust/Agave rebuild and program-test regenerate trusted evidence.

## External blockers

Bitcoin genuine live evidence still requires an appropriate Bitcoin Core / Signet node environment.

Solana requires the pinned Rust / Agave / SBF build-toolchain boundary.

Any user wallet, credential, signature, private key, seed phrase or live-value authorization remains a user-only gate.

## Next safe objective

Create one fail-closed Bitcoin execution bundle that cross-binds:

1. deterministic finalizer evidence,
2. exact final-transaction evidence,
3. Core cross-check evidence including fee/vsize diagnostics,
4. Signet observation evidence and its provenance,

while preserving the reduced-semantics / immutable-rescue limitation and refusing any promotion claim from offline or imported evidence.

After that bundle is verified, the genuine external Bitcoin dependency is live read-only Bitcoin Core/Signet evidence; submission/broadcast remains a separate authorization boundary.
