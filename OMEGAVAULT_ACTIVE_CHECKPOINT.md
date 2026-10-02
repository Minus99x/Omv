# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.26-dev**

Authoritative archive: `omegavault-mvp-0.6.26-dev(1).zip`
SHA-256: `2ec1e6473dceceadb7a72f5324b480b259d7ad1997e28abb297aa234e6bf8017`

## 0.6.26 delta

- Added deterministic EVM-family proof-context binding.
- Native and ERC-20 recovery evidence is now bound to the exact verified deployment, network, contract, policy and rescue destination.
- Cross-network proof reuse now fails closed; a successful proof from one EVM-family network cannot promote another.
- Native EVM recovery proof now verifies exact deposit and rescue balance deltas, including pre-existing rescue balances.
- ERC-20 recovery proof now requires the vault to already be in recovered state before sweep evidence can pass.
- XDC `xdc...` and `0x...` address forms normalize to one canonical address identity while remaining bound to XDC Apothem.
- Compatibility promotion now requires native and ERC-20 proofs to share one proof-context digest and deployment-verification digest.
- Finality evidence must match the same chain/network before satisfying the promotion gate.

## Verification

- Focused EVM/XDC hardening suite: **8/8 passed**.
- Combined Cardano/shared-evidence/EVM-XDC/TRON regression slice: **31/31 passed**.
- `npm run check`: **passed**.
- Existing Solidity and TRON artifact verification: **passed**.
- Current XDC Apothem registry values remain chain ID 51 / `0x33`; no fresh live deployment is claimed.

## Promotion boundary

No new XDC Apothem public-network deployment or recovery proof is claimed. XDC remains compatibility-ready/test-only until its own deployment, recovery and finality evidence is captured.

## Source of truth

The exact Library archive and checksum above are authoritative for 0.6.26. This branch records the handoff checkpoint; continue implementation from the archive rather than reconstructing from older branch files.

## Next offline gate

Advance shared evidence-integrity hardening: fail closed on unsupported or canonicalization-ambiguous evidence values and add explicit parent/checkpoint binding. If complete, continue EVM/XDC finality evidence hardening.

## Safety boundary

Do not write directly to `main`. Do not perform production deployments, wallet signatures, production-value transfers, or claim live proof until corresponding promotion gates pass.
