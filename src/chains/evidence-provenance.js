import { CHAIN_MATURITY_PROFILES } from './maturity-profiles.js';

const SHA256 = /^[0-9a-f]{64}$/i;
const REF_PATTERN = /^(0\.6\.\d+):([A-Z0-9_]+)$/;

function record({ ref, archiveSha256, chainIds, scope, artifactPaths, summary, parentBundleSha256 = null }) {
  const match = String(ref).match(REF_PATTERN);
  if (!match) throw new TypeError(`Invalid evidence provenance ref: ${ref}`);
  if (!SHA256.test(String(archiveSha256))) throw new TypeError(`Invalid archive SHA-256 for ${ref}.`);
  if (parentBundleSha256 != null && !SHA256.test(String(parentBundleSha256))) throw new TypeError(`Invalid parent bundle SHA-256 for ${ref}.`);
  if (!Array.isArray(chainIds) || chainIds.length < 1 || new Set(chainIds).size !== chainIds.length) throw new TypeError(`Invalid chainIds for ${ref}.`);
  if (!Array.isArray(artifactPaths) || artifactPaths.length < 1 || artifactPaths.some(path => typeof path !== 'string' || !path || path.startsWith('/') || path.includes('..'))) {
    throw new TypeError(`Invalid artifactPaths for ${ref}.`);
  }
  const version = match[1];
  return Object.freeze({
    ref,
    checkpointRef: `${version}-dev`,
    archiveFilename: `omegavault-mvp-${version}-dev.zip`,
    archiveSha256: archiveSha256.toLowerCase(),
    parentBundleSha256: parentBundleSha256 == null ? null : String(parentBundleSha256).toLowerCase(),
    chainIds: Object.freeze([...chainIds]),
    scope,
    artifactPaths: Object.freeze([...artifactPaths]),
    summary
  });
}

export const EVIDENCE_PROVENANCE_RECORDS = Object.freeze([
  record({
    ref: '0.6.21:SOLANA_TOKEN_SWEEP_SOURCE',
    archiveSha256: 'fd8d1d2b96c10231ee853e2e8e96cc25f92954cce70f8015b9221fa0f5ddf122',
    chainIds: ['solana'],
    scope: 'source-and-offline-regression',
    artifactPaths: ['OmegaVault-0.6.21-Progress.md', 'docs/evidence/SOLANA_TOKEN_SOURCE_0.6.21.json'],
    summary: 'Solana post-recovery SPL/Token-2022 sweep source and focused offline regression checkpoint.'
  }),
  record({
    ref: '0.6.22:XRPL_PERMISSION_DELEGATION',
    archiveSha256: 'ac0a6ad15394b6f8fe12267330e9ef608f91127f8ed63181c65edb5035a98a19',
    chainIds: ['xrpl'],
    scope: 'source-and-offline-regression',
    artifactPaths: ['docs/XRPL_PERMISSION_DELEGATION_0.6.22.md', 'docs/evidence/XRPL_PERMISSION_DELEGATION_0.6.22.json'],
    summary: 'XRPL Permission Delegation support and fail-closed reduced-semantics assessment.'
  }),
  record({
    ref: '0.6.23:BITCOIN_FINALIZER_SOURCE',
    archiveSha256: 'e2a96a522d3f921194f144b4b87276b540bf72bfb2da6bb2a48f6da3ff0f3e88',
    chainIds: ['bitcoin'],
    scope: 'source-and-offline-regression',
    artifactPaths: ['docs/BITCOIN_FINALIZATION_0.6.23.md', 'OmegaVault-0.6.23-Progress.md'],
    summary: 'Bitcoin reduced-semantics PSBTv2 recovery finalizer source checkpoint.'
  }),
  record({
    ref: '0.6.24:TRON_TVM_PROOF_HARDENING',
    archiveSha256: '0e3323aba360ad20248f35fdc6612c8ed8ea2bdc75636619ca3a6674f8594da6',
    chainIds: ['tron'],
    scope: 'source-and-offline-proof-harness',
    artifactPaths: ['docs/TRON_TVM_PROOF_HARDENING_0.6.24.md', 'OmegaVault-0.6.24-Progress.md'],
    summary: 'TRON TVM proof-runner hardening with deployment/config and balance-delta binding.'
  }),
  record({
    ref: '0.6.25:CARDANO_EVIDENCE_BINDING',
    archiveSha256: 'e451a934c7f4cb572bb7b3eea737d9e61da1ea131eddf1684ca1605d2681be07',
    chainIds: ['cardano'],
    scope: 'source-and-offline-evidence-binding',
    artifactPaths: ['docs/CARDANO_EVIDENCE_BINDING_0.6.25.md', 'OmegaVault-0.6.25-Progress.md'],
    summary: 'Cardano synchronized transaction/UTxO/protocol/evaluation/phase-1 evidence binding.'
  }),
  record({
    ref: '0.6.26:EVM_XDC_PROOF_BINDING',
    archiveSha256: '2ec1e6473dceceadb7a72f5324b480b259d7ad1997e28abb297aa234e6bf8017',
    chainIds: ['xdc'],
    scope: 'offline-proof-binding',
    artifactPaths: ['OmegaVault-0.6.26-Progress.md'],
    summary: 'EVM/XDC network, deployment and recovery-proof context binding.'
  }),
  record({
    ref: '0.6.28:EVM_XDC_FINALITY_BINDING',
    archiveSha256: '859a88e7dcae51221f256838c85ec08e75737f8e53da9c13fde295f456a0c597',
    chainIds: ['xdc'],
    scope: 'offline-finality-binding',
    artifactPaths: ['docs/EVM_XDC_FINALITY_BINDING_0.6.28.md', 'OmegaVault-0.6.28-Progress.md'],
    summary: 'XDC/EVM recovery transactions bound independently to network-specific finality evidence.'
  }),
  record({
    ref: '0.6.28:XDC_NETWORK_FINALITY',
    archiveSha256: '859a88e7dcae51221f256838c85ec08e75737f8e53da9c13fde295f456a0c597',
    chainIds: ['xdc'],
    scope: 'network-finality-policy',
    artifactPaths: ['docs/EVM_XDC_FINALITY_BINDING_0.6.28.md'],
    summary: 'XDC Apothem finalized-head policy and chain-specific finality enforcement.'
  }),
  record({
    ref: '0.6.49:STELLAR_NATIVE_RECOVERY_EXECUTION',
    archiveSha256: '6b6253e5851f34727715fb691b87fa37156552372a38b25112a5c2ba9b99038b',
    chainIds: ['stellar'],
    scope: 'offline-native-recovery-execution-evidence',
    artifactPaths: [
      'OmegaVault-0.6.49-Progress.md',
      'src/chains/stellar/native-recovery.js',
      'src/chains/stellar/execution-evidence.js',
      'test/stellar-execution-evidence.test.js'
    ],
    summary: 'Pinned-SDK Stellar native recovery envelope, preflight, submission-result and deterministic execution-evidence verification.'
  }),
  record({
    ref: '0.6.49:BITCOIN_FINALIZER_EXECUTION',
    archiveSha256: '6b6253e5851f34727715fb691b87fa37156552372a38b25112a5c2ba9b99038b',
    chainIds: ['bitcoin'],
    scope: 'offline-finalizer-execution-evidence',
    artifactPaths: [
      'OmegaVault-0.6.49-Progress.md',
      'src/chains/bitcoin/psbt-v2.js',
      'src/chains/bitcoin/execution-evidence.js',
      'test/bitcoin-execution-evidence.test.js'
    ],
    summary: 'Noble-backed Bitcoin PSBTv2 recovery finalizer execution plus deterministic tamper-detectable offline evidence.'
  }),
  record({
    ref: '0.6.30:PROOF_PROVENANCE_RESUME',
    archiveSha256: '96ca6578305dd44e11faff156bf692ebf775202a352b4e2f5d5f9a2e8267b032',
    chainIds: ['xdc', 'tron', 'cardano'],
    scope: 'shared-proof-provenance',
    artifactPaths: ['docs/CHECKPOINT_PROOF_BUNDLE_0.6.30.md', 'docs/OFFLINE_RESUME_VERIFICATION_0.6.30.md'],
    summary: 'Shared checkpoint-bound proof bundles and offline workstation-resume provenance.'
  }),
  record({
    ref: '0.6.31:REPRODUCIBLE_CHECKPOINT_MANIFEST',
    archiveSha256: '81c004db7b58cba7206d251927ef0e25a70b047e8ce81200502627879320f976',
    chainIds: ['cardano'],
    scope: 'shared-checkpoint-provenance',
    artifactPaths: ['OmegaVault-0.6.31-Progress.md', 'src/core/checkpoint-manifest.js'],
    summary: 'Deterministic source-tree inventory and external checkpoint sidecar manifest.'
  })
]);

const BY_REF = new Map(EVIDENCE_PROVENANCE_RECORDS.map(item => [item.ref, item]));

export function resolveEvidenceProvenance(ref) {
  return BY_REF.get(ref) ?? null;
}

export function validateMaturityEvidenceProvenanceCoverage() {
  const errors = [];
  for (const [chainId, profile] of Object.entries(CHAIN_MATURITY_PROFILES)) {
    for (const [gate, evidence] of Object.entries(profile.gateEvidence ?? {})) {
      for (const ref of evidence.refs ?? []) {
        const provenance = resolveEvidenceProvenance(ref);
        if (!provenance) {
          errors.push(`${chainId}.${gate} references unregistered provenance ${ref}.`);
          continue;
        }
        if (!provenance.chainIds.includes(chainId)) errors.push(`${chainId}.${gate} cross-wires ${ref}, which is not registered for ${chainId}.`);
      }
    }
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function createEvidenceProvenanceCatalog() {
  const coverage = validateMaturityEvidenceProvenanceCoverage();
  if (!coverage.ok) throw new Error(`Evidence provenance coverage is invalid: ${coverage.errors.join('; ')}`);
  return Object.freeze({
    schema: 'omegavault.evidence-provenance-catalog.v1',
    records: EVIDENCE_PROVENANCE_RECORDS
  });
}
