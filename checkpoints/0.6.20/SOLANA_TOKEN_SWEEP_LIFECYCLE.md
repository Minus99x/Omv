# Solana post-recovery token sweep lifecycle — 0.6.20-dev

Native recovery is the one-way recovery activation. SPL Token and Token-2022 assets are recovered afterward as repeatable sweeps to the immutable rescue authority. A token sweep must not clear or re-open the recovered state, so recovery of one token account cannot block later assets.

Required future SBF checks:

1. Canonical state PDA is already recovered.
2. Canonical custody PDA is the source token authority.
3. Token program is explicitly original Token Program or Token-2022.
4. Source/destination are token accounts for the supplied mint and exact token program.
5. Destination authority equals the immutable rescue destination.
6. Destination account is the canonical ATA for rescue + token program + mint.
7. Amount fits u64, does not exceed source balance, decimals match the mint, and accounts are not frozen.
8. Token-2022 remains fail-closed: no mint extensions are execution-approved; `ImmutableOwner` is the only account extension currently approved.
9. CPI uses canonical `TransferChecked`.
10. Custody PDA signs CPI only through canonical PDA seeds.

Reserved OmegaVault instruction payload: tag `4`, u64 LE amount, u8 decimals.
Canonical Token Program CPI payload: tag `12`, u64 LE amount, u8 decimals.

No compiled/SBF execution claim is made for tag `4` at this checkpoint.
