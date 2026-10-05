# OmegaVault 0.6.58 Progress

## Cardano Preprod four-action evidence campaign completed

0.6.58 reduces the later workstation burden by preparing the complete Cardano Preprod synchronized-evaluation campaign offline.

- Re-anchored Cardano Preprod capture to the exact sealed 0.6.57 checkpoint:
  - source commit `85ec91ac28b327f21799c2a63a272dafd3778aa9`
  - source archive SHA-256 `309d607e9c7256d6ba464755e40142f0047f6b30c62187e630c6102c286ac7f3`
  - source-tree SHA-256 `2b0c41d13c6c15aa941916d5e739fe8d5d9d26938b682fa2517162fed860c1f5`
- Added one campaign manifest binding exactly four lifecycle sessions:
  - `initialize`
  - `heartbeat`
  - `approve`
  - `execute`
- Every campaign entry binds its session-manifest digest, invariant-program digest, capture-plan digest, transaction-body hash and transaction-CBOR digest.
- Campaign creation fails closed if an action is missing, duplicated, based on another checkpoint, or uses another invariant program.
- Campaign verification detects action/session cross-wiring before synchronized evidence can be accepted.
- Added an offline campaign preparation CLI that creates all four session directories, manifests, Ogmios requests, capture templates and a runbook in one operation.
- Added a campaign verifier that reports every missing capture per action and verifies each completed synchronized session without granting signing/submission/support authority.
- Preserved all 0.6.57 invariant, non-custodial and no-promotion boundaries.

## Verification

- Review/audit: **84/84 passed**.
- Stellar recovery: **20/20 passed**.
- Bitcoin recovery: **22/22 passed**.
- Maturity/provenance: **21/21 passed**.
- Core invariant/support gate: **19/19 passed**.
- Cardano toolchain/evidence: **passed**.
- Cardano reconciliation: **12/12 passed**.
- Cardano Preprod evidence harness: **6/6 passed**.
- Cardano Preprod capture-session/manifest: **4/4 passed**.
- Cardano Preprod invariant-evidence program: **6/6 passed**.
- Cardano Preprod four-action campaign: **6/6 passed**.
- Cardano workstation launch gate: **4/4 passed**.
- Full suite: **476/476 passed**.
- Offline-resume verification: **16/16 Stellar + 11/11 Bitcoin; ok: true**.
- Global checks: **passed**.

## Laptop impact

The later laptop session no longer needs four separate session setups. One offline campaign preparation command creates the full lifecycle evidence workspace. The operator then supplies only the external Preprod captures for each action and runs the campaign verifier.

## Promotion boundary

Cardano remains `offline-verified`. A prepared or even synchronized-evaluation-complete campaign is not wallet-signing evidence, submission/finality evidence, public-network recovery proof, connector promotion, or an “OmegaVault supported” claim.
