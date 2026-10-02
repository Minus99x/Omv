const OFFLINE_PINNED_SUITES = Object.freeze([
  Object.freeze({
    id: 'stellar-native-recovery',
    command: 'node',
    args: Object.freeze(['--test', 'test/stellar-native-recovery.test.js']),
    requiredPackages: Object.freeze(['@stellar/stellar-sdk'])
  }),
  Object.freeze({
    id: 'bitcoin-cryptographic-finalizer',
    command: 'node',
    args: Object.freeze(['--test', 'test/bitcoin-descriptor-psbt-v2.test.js', 'test/bitcoin-finalizer-source.test.js']),
    requiredPackages: Object.freeze(['@noble/curves', '@noble/hashes', 'bs58'])
  })
]);

export function createPostInstallVerificationPlan(workstationReport) {
  if (!workstationReport || typeof workstationReport !== 'object') throw new TypeError('workstationReport is required.');
  const lockOk = workstationReport?.dependencyLock?.ok === true;
  const missing = Array.isArray(workstationReport?.missingPackages) ? workstationReport.missingPackages : [];
  const mismatched = Array.isArray(workstationReport?.mismatchedPackages) ? workstationReport.mismatchedPackages : [];
  const ready = lockOk && missing.length === 0 && mismatched.length === 0 && workstationReport?.readyForPinnedNodeSuites === true;

  const reasons = [];
  if (!lockOk) reasons.push('Dependency lock integrity is not valid.');
  if (missing.length > 0) reasons.push(`Missing pinned packages: ${missing.join(', ')}`);
  if (mismatched.length > 0) reasons.push(`Mismatched pinned packages: ${mismatched.map(item => item.name).join(', ')}`);

  return Object.freeze({
    schema: 'omegavault.post-install-verification-plan.v1',
    mode: 'offline-read-only',
    liveChainActions: false,
    ready,
    recommendedRepair: ready ? null : (lockOk ? 'npm ci' : 'repair package.json/package-lock.json before npm ci'),
    reasons: Object.freeze(reasons),
    suites: OFFLINE_PINNED_SUITES
  });
}
