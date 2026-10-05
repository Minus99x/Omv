# OmegaVault Multichain Execution Plan 0.6.58

## Completed objective: Preprod execution preparation

- [x] Preserve sealed 0.6.57 work.
- [x] Re-anchor Cardano capture to exact sealed 0.6.57 provenance.
- [x] Prepare all four required lifecycle sessions offline.
- [x] Bind every session to one campaign manifest.
- [x] Bind each action to exact plan/session/transaction identities.
- [x] Reject missing or duplicate lifecycle actions.
- [x] Reject action/session cross-wiring.
- [x] Preserve one invariant-program identity across the campaign.
- [x] Generate capture templates and an operator runbook.
- [x] Report the exact missing capture files per lifecycle action.
- [x] Keep signing, submission, value movement, recovery proof and support authority false.
- [x] Pass the full inherited regression stack.

## Next workstation/network objective

When a workstation is available:

1. Use the sealed 0.6.58 artifact/source.
2. Run the checkpoint/workstation gate.
3. Prepare the full Cardano Preprod campaign.
4. For each of `initialize`, `heartbeat`, `approve`, and `execute`, acquire:
   - one Preprod tip,
   - same-tip UTxO snapshot,
   - same-tip independently confirmed protocol parameters,
   - same-tip Ogmios evaluation,
   - independent same-tip phase-1 validation.
5. Run the campaign verifier.
6. Stop after synchronized-evaluation campaign verification.

Wallet signing, transaction submission, inclusion/finality, public-network recovery and support promotion remain separate later gates.

## Authority boundary

No 0.6.58 operation authorizes production deployment, wallet signing, transaction submission, live-value movement, connector promotion, public-network recovery claims, or an “OmegaVault supported” claim.
