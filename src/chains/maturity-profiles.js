const ref = (...values) => Object.freeze(values);

export const CHAIN_MATURITY_PROFILES = Object.freeze({
  ethereum: Object.freeze({
    stage: 'legacy-live-proof',
    blockers: ref('Migrate the 0.4.3 Sepolia live-proof baseline into the 0.6 evidence-contract gate format before using it for new promotion decisions.'),
    notes: ref('Legacy live-proof status remains descriptive; it does not bypass the new evidence-backed promotion contract.')
  }),
  xdc: Object.freeze({
    stage: 'compatibility-ready',
    blockers: ref('Fresh XDC Apothem deployment, native recovery, token sweep and finalized-head evidence are still required.'),
    notes: ref('2026-10-12 read-only chain-51 Apothem RPC probe succeeded (Actions 38345382962). Follow-up independent official and eRPC providers agreed on same block 84027733 hash and 625-gwei gas quote (Actions 38347097320); live fee estimates, XDPoS finality, deployment and recovery are not yet proven. The high observed price requires bounded testnet gas-budget analysis before any contract transaction.'),
    gateEvidence: Object.freeze({
      'network-profile': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.28:XDC_NETWORK_FINALITY') }),
      'address-validation': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.26:EVM_XDC_PROOF_BINDING') }),
      'transaction-preflight': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.26:EVM_XDC_PROOF_BINDING') }),
      'adversarial-tests': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.28:EVM_XDC_FINALITY_BINDING') }),
      'evidence-export': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.30:PROOF_PROVENANCE_RESUME') })
    })
  }),
  tron: Object.freeze({
    stage: 'offline-verified',
    blockers: ref('Fresh Shasta deployment/recovery evidence is required before public-testnet promotion.'),
    gateEvidence: Object.freeze({
      'network-profile': Object.freeze({ passed: true, level: 'source', refs: ref('0.6.24:TRON_TVM_PROOF_HARDENING') }),
      'transaction-preflight': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.24:TRON_TVM_PROOF_HARDENING') }),
      'adversarial-tests': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.24:TRON_TVM_PROOF_HARDENING') }),
      'evidence-export': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.30:PROOF_PROVENANCE_RESUME') })
    })
  }),
  cardano: Object.freeze({
    stage: 'offline-verified',
    blockers: ref(
      'Synchronized Preprod Ogmios evaluation and independent phase-1 validation at one acquired tip remain required.',
      'Preprod transaction submission/finality, wallet signing and public-network recovery evidence remain required before promotion.'
    ),
    gateEvidence: Object.freeze({
      'network-profile': Object.freeze({ passed: true, level: 'source', refs: ref('0.6.25:CARDANO_EVIDENCE_BINDING', '0.6.51:CARDANO_TOOLCHAIN_EXECUTION') }),
      'address-validation': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.51:CARDANO_TOOLCHAIN_EXECUTION') }),
      'transaction-preflight': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.25:CARDANO_EVIDENCE_BINDING', '0.6.51:CARDANO_TOOLCHAIN_EXECUTION') }),
      'adversarial-tests': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.25:CARDANO_EVIDENCE_BINDING', '0.6.51:CARDANO_TOOLCHAIN_EXECUTION') }),
      'evidence-export': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.31:REPRODUCIBLE_CHECKPOINT_MANIFEST', '0.6.51:CARDANO_TOOLCHAIN_EXECUTION') })
    }),
    notes: ref('Pinned Aiken 1.1.24+bacbeb3 and CSL 17.0.0 execution are clean-CI verified. This does not claim Preprod node evaluation, submission, wallet signing, finality or connector promotion.')
  }),
  stellar: Object.freeze({
    stage: 'offline-verified',
    blockers: ref(
      'Native 1-of-1 and 2-of-2 disposable-account XLM recoveries, owner heartbeat/reset, premature rejections, final recovery and rescue credit have genuine public Stellar Testnet evidence; independently sponsored fee-bump native recovery is also proven on Testnet; one restricted-scope newly issued OMVT classic asset recovered on public Testnet, but adversarial issuer/trustline states, failed-applied recovery and broader security validation remain required before promotion.',
      'Offline/injected-driver evidence is not public-network proof even when transaction, finality and rescue-balance bindings verify.'
    ),
    gateEvidence: Object.freeze({
      'network-profile': Object.freeze({ passed: true, level: 'source', refs: ref('0.6.49:STELLAR_NATIVE_RECOVERY_EXECUTION') }),
      'address-validation': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.49:STELLAR_NATIVE_RECOVERY_EXECUTION') }),
      'transaction-preflight': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.49:STELLAR_NATIVE_RECOVERY_EXECUTION') }),
      'adversarial-tests': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.49:STELLAR_NATIVE_RECOVERY_EXECUTION') }),
      'evidence-export': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.49:STELLAR_NATIVE_RECOVERY_EXECUTION') })
    }),
    notes: ref(
      'Pinned @stellar/stellar-sdk 17.1.0 execution is verified offline.',
      '2026-10-12: Disposable-account public Stellar Testnet recovered exactly 1.0000000 fake XLM via preAuthTx plus one contact extra-signer, with on-ledger setup 5165976 and recovery 5165980, observed finality, rescue credit and single-use signer consumption (GitHub Actions run 38330316217). This is a narrow real-network proof, not a complete lifecycle or audit.',
      '2026-10-12 independent two-guardian 2-of-2 public-Testnet recovery: owner setup ledger 5166913, heartbeat ledger 5166914, two early rejections, exact 1 fake XLM recovered in ledger 5166924, and consumed preAuthTx signer (Actions run 38336534794). This remains a bounded native 2-of-2 proof, not broad M-of-N support.',
      '2026-10-12 follow-up: public Testnet observed genuine tx_bad_minseq_age_or_gap rejection, owner-signed heartbeat (ledger 5166182), second post-heartbeat rejection of the same envelope and successful 1.0000000 fake-XLM rescue (ledger 5166192), verified single-use signer consumption (GitHub Actions run 38331699707). Does not prove all policy modes or production safety.',
      'The offline pipeline now covers initial/post-heartbeat tx_bad_minseq_age_or_gap, owner heartbeat, eligible N-of-N fee-bump recovery, finality/rescue-balance binding, failed-applied preAuthTx consumption, Horizon normalization/transport and digest-bound evidence.',
      '2026-10-12 public Stellar Testnet fee sponsorship: exact 2-of-2 guardian-signed inner rescue recovered 1 fake XLM with independent sponsor charged 200 stroops; on-ledger XDR, sponsor balance, vault only 1 XLM debit and rescue balance matched (Actions run 38345033796; recovery ledger 5168206).',
      '2026-10-12 public Stellar Testnet classic asset (run 38346812996): fresh OMVT issuer and independent vault/rescue trustlines, 10 newly issued tokens, owner heartbeat and two early rejections, 2-of-2 contact preAuth recovery of precisely 3.0000000 OMVT via independent 200-stroop fee sponsor in ledger 5168476; exact on-ledger token balances and consumed one-time signer verified. Does not cover adversarial issuer controls or arbitrary tokens.',
      'Customer-wallet signing, adversarial classic-asset permissions, failed-applied public-Testnet recovery, broader policy proofs and connector promotion remain separately gated.'
    )
  }),
  bitcoin: Object.freeze({
    stage: 'reduced-semantics',
    blockers: ref(
      'Genuine Bitcoin Core / Signet RPC execution evidence and actual Signet recovery observation remain required.',
      'The delayed-threshold Script policy still cannot independently enforce an immutable rescue destination outside OmegaVault finalization.'
    ),
    gateEvidence: Object.freeze({
      'network-profile': Object.freeze({ passed: true, level: 'source', refs: ref('0.6.23:BITCOIN_FINALIZER_SOURCE') }),
      'address-validation': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.49:BITCOIN_FINALIZER_EXECUTION') }),
      'transaction-preflight': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.49:BITCOIN_FINALIZER_EXECUTION') }),
      'adversarial-tests': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.49:BITCOIN_FINALIZER_EXECUTION') }),
      'evidence-export': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.49:BITCOIN_FINALIZER_EXECUTION') })
    }),
    notes: ref(
      'Pinned Noble cryptographic execution plus deterministic finalizer extraction, exact txid/wtxid/witness/output/weight binding, imported read-only Core observation verification and Signet evidence binding are verified offline.',
      'Imported observations remain provenance-distinct from live RPC evidence; no Signet public-network proof or connector promotion is claimed.'
    )
  }),
  solana: Object.freeze({
    stage: 'parked',
    blockers: ref('The checked-in Solana SBF artifact is stale/untrusted against its historical build-evidence digest. A pinned Rust/Agave/cargo-build-sbf toolchain must rebuild current source, rerun SBF program-test, regenerate artifact evidence and then capture Devnet execution evidence.'),
    gateEvidence: Object.freeze({
      'network-profile': Object.freeze({ passed: true, level: 'source', refs: ref('0.6.21:SOLANA_TOKEN_SWEEP_SOURCE') }),
      'adversarial-tests': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.21:SOLANA_TOKEN_SWEEP_SOURCE') })
    })
  }),
  xrpl: Object.freeze({
    stage: 'reduced-semantics',
    blockers: ref(
      'No verified XRPL-native composition yet enforces the complete OmegaVault combination of owner-resettable inactivity, threshold approval, immutable rescue scope and contact non-redirection.',
      'Signer Lists, Permission Delegation, Escrow, Tickets and Batch must be evaluated as a composition against the canonical invariants rather than treated as substitutes for one another.'
    ),
    gateEvidence: Object.freeze({
      'network-profile': Object.freeze({ passed: true, level: 'source', refs: ref('0.6.22:XRPL_PERMISSION_DELEGATION') }),
      'adversarial-tests': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.22:XRPL_PERMISSION_DELEGATION') })
    }),
    notes: ref(
      '0.6.60 adds an invariant-first native-composition assessment. XRPL remains reduced-semantics until exact equivalence is independently demonstrated and public-network evidence is captured.',
      'Hooks-family programmable research is a separate proof track and cannot be used to claim XRPL mainnet support.'
    )
  }),
  base: Object.freeze({ stage: 'compatibility-ready', blockers: ref('Base Sepolia live recovery and parent-finality evidence have not been captured.') }),
  arbitrum: Object.freeze({ stage: 'compatibility-ready', blockers: ref('Arbitrum Sepolia live recovery and rollup-finality evidence have not been captured.') }),
  optimism: Object.freeze({ stage: 'compatibility-ready', blockers: ref('OP Sepolia live recovery and fault-proof/parent-finality evidence have not been captured.') }),
  polygon: Object.freeze({ stage: 'compatibility-ready', blockers: ref('Polygon Amoy live recovery/finality evidence has not been captured.') }),
  bsc: Object.freeze({ stage: 'compatibility-ready', blockers: ref('BSC Testnet live recovery/finality evidence has not been captured.') }),
  avalanche: Object.freeze({ stage: 'compatibility-ready', blockers: ref('Avalanche Fuji C-Chain live recovery/finality evidence has not been captured.') })
});

export function getMaturityProfile(chainId) {
  return CHAIN_MATURITY_PROFILES[chainId] ?? Object.freeze({ stage: 'catalogued', blockers: ref('No explicit maturity profile has been recorded for this chain.') });
}
