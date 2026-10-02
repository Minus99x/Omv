# OmegaVault 0.6.27-dev — Shared evidence integrity

Archive: `omegavault-mvp-0.6.27-dev.zip`

SHA-256:
`bf8638a91bb1e77ab80fb38c2ac89703efc3fc50855657d9a7f66814162102fa`

## Concrete changes

- Canonical evidence JSON.
- Explicit BigInt encoding.
- Fail-closed handling for unsupported or ambiguous evidence values.
- Cyclic evidence rejection.
- Deep-frozen evidence records.
- Parent-evidence lineage SHA binding.
- Exact project-checkpoint ref + SHA binding.
- Validator-safe malformed external-record handling.

## Verification

- Evidence recorder: 8/8 PASS.
- Combined regression slice: 37/37 PASS.
- Global check: PASS.

## Promotion boundary

No chain promotion is claimed by this checkpoint.
