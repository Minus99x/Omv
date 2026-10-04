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
    blockers: ref('Live Preprod evaluation/submission evidence and restored pinned Cardano/Aiken toolchain remain required.'),
    gateEvidence: Object.freeze({
      'network-profile': Object.freeze({ passed: true, level: 'source', refs: ref('0.6.25:CARDANO_EVIDENCE_BINDING') }),
      'transaction-preflight': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.25:CARDANO_EVIDENCE_BINDING') }),
      'adversarial-tests': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.25:CARDANO_EVIDENCE_BINDING') }),
      'evidence-export': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.31:REPRODUCIBLE_CHECKPOINT_MANIFEST') })
    })
  }),
  stellar: Object.freeze({
    stage: 'offline-verified',
    blockers: ref('Actual Stellar Testnet execution evidence is still required. The offline pipeline now covers initial/post-heartbeat txTOO_EARLY, owner heartbeat, eligible N-of-N fee-bump recovery, finality/rescue-balance binding, failed-applied preAuthTx consumption, Horizon normalization/transport and digest-bound evidence, but fixture/injected-driver evidence is not public-network proof.'),
    notes: ref(
      'Pinned @stellar/stellar-sdk 17.1.0 is restored and verified in clean CI and on Windows.',
      'Success and failed-applied recovery evidence paths are fail-closed and separately digest-bound.',
      'Offline verification does not satisfy public-testnet gates or promote the connector.'
    )
  }),
  bitcoin: Object.freeze({
    stage: 'reduced-semantics',
    blockers: ref('Actual Signet recovery observation, raw-finalizer/Bitcoin-Core extraction cross-check, and the immutable-rescue semantic limitation remain unresolved. The pinned cryptographic dependencies and offline descriptor/PSBT/finalizer-evidence path are available.'),
    gateEvidence: Object.freeze({
      'network-profile': Object.freeze({ passed: true, level: 'source', refs: ref('0.6.23:BITCOIN_FINALIZER_SOURCE') }),
      'transaction-preflight': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.23:BITCOIN_FINALIZER_SOURCE') }),
      'adversarial-tests': Object.freeze({ passed: true, level: 'offline-test', refs: ref('0.6.23:BITCOIN_FINALIZER_SOURCE') })
    })
  }),
  solana: Object.freeze({
    stage: 'parked',
    blockers: ref('The checked-in Solana SBF artifact does not match its historical build-evidence digest and is explicitly stale/untrusted. A pinned Rust/Agave/cargo-build-sbf toolchain must rebuild the current source, rerun SBF program-test, regenerate artifact evidence, and then capture Devnet execution evidence.'),
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
