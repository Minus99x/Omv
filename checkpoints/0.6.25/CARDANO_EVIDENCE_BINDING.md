# OmegaVault 0.6.25-dev — Cardano synchronized evidence binding

Archive: `omegavault-mvp-0.6.25-dev.zip`

SHA-256:
`e451a934c7f4cb572bb7b3eea737d9e61da1ea131eddf1684ca1605d2681be07`

## Concrete changes

- Added dependency-free Cardano evidence canonicalization and SHA-256 component hashing.
- Required one exact transaction body across evaluation and phase-1 evidence.
- Required one synchronized node tip across UTxO, protocol parameters, evaluation and phase-1 validation.
- Required all independent phase-1 checks to pass.
- Added one deterministic evidence-bundle digest for promotion provenance.

## Verification

- Global project check: PASS.
- Focused Cardano evidence-binding suite: 7/7 PASS.

## Promotion boundary

This is an offline evidence-integrity checkpoint. No live Preprod evaluation or submitted recovery transaction is claimed.
