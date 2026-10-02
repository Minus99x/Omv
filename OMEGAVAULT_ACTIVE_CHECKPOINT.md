# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.28-dev**

Authoritative archive: `omegavault-mvp-0.6.28-dev.zip`
SHA-256: `859a88e7dcae51221f256838c85ec08e75737f8e53da9c13fde295f456a0c597`

## 0.6.28 delta

- Added network-specific EVM block-finality evidence.
- Native recovery and ERC-20 sweep proofs now expose their exact state-changing transaction reference.
- Finality evidence binds the selected network, chain ID, exact recovery transaction, receipt block, proof-binding digest, proof-context digest and deployment-verification digest.
- XDC Apothem uses a finalized-head gate: a recovery receipt newer than the observed finalized head fails closed.
- Ethereum Sepolia retains its configured confirmation-count policy.
- EVM compatibility promotion now requires separate valid finality evidence for both the native recovery transaction and the ERC-20 sweep transaction.
- Cross-wired finality evidence between recovery proof kinds is rejected.
- Preserves 0.6.27 canonical evidence/lineage hardening.

## Verification

- Focused EVM/XDC finality + harness suite: **14/14 passed**.
- Combined Cardano/evidence/EVM-XDC/finality/TRON/preflight regression slice: **46/46 passed**.
- `npm run check`: **passed**.
- Existing Solidity and TRON artifact verification: **passed**.

## Promotion boundary

No fresh XDC Apothem transaction, deployment or public-network finality observation is claimed. XDC remains test-only / compatibility-ready until the real proof sequence is executed and captured.

## Source of truth

The complete 0.6.28-dev archive is stored in ChatGPT Library under the exact filename and checksum above. Continue implementation from that archive rather than reconstructing current source from older branches.

## Next offline gate

Harden dependency/lockfile integrity and add a workstation-resume preflight that inventories pinned dependencies/toolchains after `npm ci` without changing chain state. When a workstation is available, immediately rerun Stellar native recovery and the Bitcoin Noble-backed finalizer suite.

## Safety boundary

Do not write directly to `main`. Do not perform production deployments, wallet signatures, production-value transfers, or claim live proof until corresponding promotion gates pass.
