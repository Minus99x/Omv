import { evidenceDigest } from '../core/evidence.js';

const SHA256 = /^[0-9a-f]{64}$/i;

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}
function sha(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${label} must be a SHA-256 hex digest.`);
  return value.toLowerCase();
}

export function createReviewVerificationReceipt(bundleDescriptor) {
  if (!bundleDescriptor || bundleDescriptor.schema !== 'omegavault.external-review-bundle.v1') throw new TypeError('A valid external review-bundle descriptor is required.');
  const checkpointRef = requiredText(bundleDescriptor.checkpointRef, 'bundleDescriptor.checkpointRef');
  const bundleSha256 = sha(bundleDescriptor.sha256, 'bundleDescriptor.sha256');
  if (!Array.isArray(bundleDescriptor.files) || bundleDescriptor.files.length !== 3) throw new TypeError('Review bundle must describe exactly three external review files.');
  const files = Object.freeze(bundleDescriptor.files.map((file, index) => Object.freeze({
    role: requiredText(file?.role, `bundleDescriptor.files[${index}].role`),
    filename: requiredText(file?.filename, `bundleDescriptor.files[${index}].filename`),
    sha256: sha(file?.sha256, `bundleDescriptor.files[${index}].sha256`),
    sizeBytes: Number(file?.sizeBytes)
  })));
  if (files.some(file => !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1)) throw new TypeError('Review receipt file sizes must be positive safe integers.');
  const bindings = bundleDescriptor.bindings ?? {};
  const core = Object.freeze({
    schema: 'omegavault.review-verification-receipt.v1',
    checkpointRef,
    sourceOfTruth: 'omegavault.external-review-bundle.v1',
    reviewBundleSha256: bundleSha256,
    files,
    bindings: Object.freeze({
      operatorAuditIndexSha256: sha(bindings.operatorAuditIndexSha256, 'bindings.operatorAuditIndexSha256'),
      provenanceAuditSha256: sha(bindings.provenanceAuditSha256, 'bindings.provenanceAuditSha256'),
      evidenceHistorySha256: sha(bindings.evidenceHistorySha256, 'bindings.evidenceHistorySha256'),
      checkpointManifestSha256: sha(bindings.checkpointManifestSha256, 'bindings.checkpointManifestSha256'),
      externalReviewIndexSha256: sha(bindings.externalReviewIndexSha256, 'bindings.externalReviewIndexSha256'),
      sourceTreeSha256: sha(bindings.sourceTreeSha256, 'bindings.sourceTreeSha256'),
      dependencyLockSha256: sha(bindings.dependencyLockSha256, 'bindings.dependencyLockSha256')
    }),
    verificationStatus: 'ready-for-independent-verification',
    attestations: Object.freeze({
      cryptographicSignature: 'not-recorded',
      reviewerAttestation: 'not-recorded'
    }),
    semantics: Object.freeze({
      receiptIsSourceOfTruth: false,
      promotionAuthority: 'backend-capability-contract-only',
      lineageAuthority: 'explicit-cryptographic-parent-bindings-only'
    })
  });
  return Object.freeze({ ...core, sha256: evidenceDigest(core) });
}

export function verifyReviewVerificationReceipt(receipt, bundleDescriptor) {
  const errors = [];
  let expected;
  try { expected = createReviewVerificationReceipt(bundleDescriptor); }
  catch (error) { return Object.freeze({ ok: false, errors: Object.freeze([String(error?.message || error)]) }); }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return Object.freeze({ ok: false, errors: Object.freeze(['Review receipt must be an object.']) });
  if (receipt.schema !== expected.schema) errors.push('Unexpected review-receipt schema.');
  if (receipt.sha256 !== expected.sha256) errors.push('Review-receipt digest mismatch.');
  if (receipt.reviewBundleSha256 !== expected.reviewBundleSha256) errors.push('Review-bundle binding mismatch.');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function renderReviewVerificationReceiptText(receipt) {
  if (!receipt || receipt.schema !== 'omegavault.review-verification-receipt.v1' || !SHA256.test(String(receipt.sha256))) throw new TypeError('A valid review verification receipt is required.');
  const lines = [
    'OmegaVault External Review Verification Receipt',
    '===============================================',
    `Checkpoint: ${receipt.checkpointRef}`,
    `Receipt SHA-256: ${receipt.sha256}`,
    `Review bundle SHA-256: ${receipt.reviewBundleSha256}`,
    `Source of truth: ${receipt.sourceOfTruth}`,
    '',
    'Files:'
  ];
  for (const file of receipt.files) lines.push(`- ${file.role}: ${file.filename} | ${file.sizeBytes} bytes | SHA-256 ${file.sha256}`);
  lines.push(
    '',
    'Cross-bindings:',
    `- Operator audit index: ${receipt.bindings.operatorAuditIndexSha256}`,
    `- Provenance audit: ${receipt.bindings.provenanceAuditSha256}`,
    `- Evidence history: ${receipt.bindings.evidenceHistorySha256}`,
    `- Checkpoint manifest: ${receipt.bindings.checkpointManifestSha256}`,
    `- External review index: ${receipt.bindings.externalReviewIndexSha256}`,
    `- Source tree: ${receipt.bindings.sourceTreeSha256}`,
    `- Dependency lock: ${receipt.bindings.dependencyLockSha256}`,
    '',
    `Verification status: ${receipt.verificationStatus}`,
    `Cryptographic signature: ${receipt.attestations.cryptographicSignature}`,
    `Reviewer attestation: ${receipt.attestations.reviewerAttestation}`,
    '',
    'This receipt is a deterministic human-readable rendering of the machine-readable review bundle.',
    'It is not a separate source of truth and does not change any chain maturity or promotion state.',
    ''
  );
  return lines.join('\n');
}
