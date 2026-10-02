# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.24-dev**

Archive: `omegavault-mvp-0.6.24-dev.zip`
SHA-256: `0e3323aba360ad20248f35fdc6612c8ed8ea2bdc75636619ca3a6674f8594da6`

## 0.6.24 delta

- Hardened the TRON TVM proof runner around exact verified-deployment binding.
- The TRX proof now rejects a valid deployment report reused with a different contract, owner, rescue destination, threshold, or trusted-contact set.
- Added strict address/contact/amount validation at the proof boundary.
- Added positive Energy-estimate gates before every state-changing proof action.
- TRX evidence now records vault state before deposit, after deposit, and after recovery.
- The runner verifies that the deposit increased the vault by exactly the requested `amountSun`, then requires the rescue balance delta to equal the entire post-deposit vault balance.
- TRC-20 proof now requires the verified TVM vault to already be recovered and proves an exact vault-to-rescue token balance movement after solidification.
- Existing pinned TRON Solidity artifact/compiler/runtime verification remains unchanged and passing.

## Verification

- `npm run check`: **passed**.
- TRON contract manifest verification: **passed**.
- Pinned TRON Solidity build/artifact verification: **passed**.
- Focused TRON permissions + TVM proof suite: **14/14 passed**.
- Adversarial coverage includes deployment/config mismatch, incorrect rescue delta, unsolidified transaction, and attempted TRC-20 proof before recovered state.

## Promotion boundary

TRON remains test-only. No fresh Shasta deployment or public-network recovery proof is claimed by 0.6.24.

## Source of truth

The complete 0.6.24-dev archive is stored in the ChatGPT file Library under the exact filename and checksum above. Do not reconstruct current source from the older tree on `main`.

## Next offline gate

Advance Stellar native recovery hardening. If the pinned Stellar SDK is unavailable in the active workspace, switch immediately to Cardano evaluation-input preparation or shared evidence/dependency infrastructure rather than waiting.

## Safety boundary

Do not write directly to `main`. Do not perform production deployments, wallet signatures, production-value transfers, or claim live proof until corresponding promotion gates pass.
