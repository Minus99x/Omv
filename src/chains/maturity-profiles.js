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
      'Actual Stellar Testnet execution evidence is still required before public-testnet promotion.',
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
      'The offline pipeline now covers initial/post-heartbeat txTOO_EARLY, owner heartbeat, eligible N-of-N fee-bump recovery, finality/rescue-balance binding, failed-applied preAuthTx consumption, Horizon normalization/transport and digest-bound evidence.',
      'Wallet signing, public-testnet submission, finalized public-network recovery and connector promotion remain separately gated.'
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
    blockers: ref('XRPL Permission Delegation does not independently enforce resettable inactivity, immutable rescue destination, amount or currency restrictions.'),
    gateEvidence: Object.freeze({
      'network-profile': Object.freeze({ passed: true, level: 'source', refs: ref('0.6.22:XRPL_PERMISSION_DELEGATION') }),
      'adversarial-tests': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.22:XRPL_PERMISSION_DELEGATION') })
    })
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
