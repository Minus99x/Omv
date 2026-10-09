# Ethereum Sepolia 0.4.3 -> 0.6 evidence migration plan

Status: provenance-preserving migration design; no historical proof is discarded and no historical label is allowed to auto-promote current support.

## Objective

OmegaVault already has a historical Ethereum Sepolia live-proof baseline from the 0.4.3 generation. The goal is to preserve useful historical public-network work while moving it into the stricter 0.6 evidence-contract model.

This is a migration/rebinding exercise, not a request to blindly rerun everything.

## Core rule

`legacy-live-proof` is evidence provenance, not a current promotion shortcut.

A legacy observation may reduce duplicate work only when its exact on-chain identity can still be independently verified and rebound into the current schemas.

Examples of reusable identity include:

- exact deployed contract address;
- exact deployment transaction hash;
- exact native-recovery transaction hash;
- exact token-recovery transaction hash;
- exact archived source/build digest;
- exact historical archive digest.

If an exact identifier is missing, that specific public-network gate requires a fresh Sepolia proof rather than inference.

## Current 0.6 destination schemas

The current EVM evidence path already provides:

- deployment runtime/config verification (`omegavault.evm` deployment verification);
- network/deployment/policy proof binding;
- native recovery proof with exact rescue delta checks;
- ERC-20 recovery proof with exact vault-to-rescue movement;
- transaction-bound finality evidence;
- network-specific finality policy;
- capability-contract promotion gates;
- invariant-level support gates that require chain-scoped public-testnet evidence.

## Gate migration classification

### Revalidate against current 0.6 code/offline evidence

These should be re-established using current source/tests instead of inherited from the 0.4.3 label:

- network profile;
- address validation;
- transaction preflight;
- adversarial tests;
- evidence export;
- threat review.

### Legacy public-proof rebind candidate

If exact historical transaction/contract identifiers are available, the old Sepolia chain state can potentially be re-observed and rebound for:

- mechanism creation/deployment;
- mechanism verification;
- wallet-signing observation;
- inactivity semantics;
- threshold semantics;
- immutable-rescue semantics;
- native-asset recovery;
- token recovery;
- fee/finality model.

Rebinding still requires current verification logic. A historical screenshot, note, or stage label alone is insufficient.

### Fresh public proof

If the old proof does not preserve enough exact identity to reproduce a current evidence bundle, only that missing gate needs a fresh Sepolia run.

This prevents two opposite errors:

1. throwing away valid historical public-chain work merely because the schema changed;
2. pretending an old claim satisfies a stricter current evidence contract without reproducible identity.

## Repository guard

`src/chains/evm/legacy-sepolia-migration.js` now formalizes this rule. It classifies every current promotion gate as:

- `revalidate-current-code`,
- `legacy-public-proof-rebind-candidate`, or
- `fresh-public-proof-required`.

It cannot authorize automatic promotion.

## Next execution step

When workstation/public-network work resumes:

1. locate any retained 0.4.3 Sepolia contract and transaction identifiers;
2. feed only exact, independently verifiable identifiers into the migration intake;
3. re-observe contract runtime/configuration and receipts on Sepolia;
4. construct 0.6 deployment/proof/finality evidence;
5. run current adversarial/offline suites;
6. perform fresh transactions only for gates that cannot be rebound;
7. evaluate support only through the current capability/invariant gates.

No part of this plan authorizes wallet signing, value movement, production use, or Ethereum support promotion.
