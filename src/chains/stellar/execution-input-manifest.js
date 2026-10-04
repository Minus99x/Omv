import crypto from 'node:crypto';
import { evidenceDigest } from '../../core/evidence.js';
import {
  verifySignedFeeBumpEnvelopeArtifact,
  verifySignedHeartbeatEnvelopeArtifact,
  verifySignedRecoveryEnvelopeArtifact
} from './native-recovery.js';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const SHA256_HEX = /^[a-f0-9]{64}$/;

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} contains missing or undeclared fields.`);
  }
}

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function integerString(value, label, { positive = false } = {}) {
  const text = String(value ?? '');
  if (!/^\d+$/.test(text)) throw new TypeError(`${label} must be a non-negative integer string.`);
  if (positive && BigInt(text) === 0n) throw new TypeError(`${label} must be greater than zero.`);
  return text;
}

function hashHex(value, label) {
  const text = requiredText(value, label).toLowerCase();
  if (!SHA256_HEX.test(text)) throw new TypeError(`${label} must be a SHA-256 hex digest.`);
  return text;
}

function xdrSha256(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()) throw new TypeError(`${label} must be canonical base64 XDR.`);
  const text = value;
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== text) throw new TypeError(`${label} must be canonical base64 XDR.`);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assetBinding(operation, index, rescueDestination) {
  if (operation?.type !== 'payment') throw new TypeError(`recoveryPlan.operations[${index}] must be a payment.`);
  if (operation.destination !== rescueDestination) throw new Error(`recoveryPlan.operations[${index}] targets a different rescue destination.`);
  const amount = requiredText(operation.amount, `recoveryPlan.operations[${index}].amount`);
  if (!/^(0|[1-9]\d*)\.\d{7}$/.test(amount) || BigInt(amount.replace('.', '')) === 0n) {
    throw new TypeError(`recoveryPlan.operations[${index}].amount must be a positive canonical seven-decimal amount.`);
  }
  if (operation.asset?.type === 'native') {
    return Object.freeze({ assetKey: 'native', destination: rescueDestination, amount });
  }
  const code = requiredText(operation.asset?.code, `recoveryPlan.operations[${index}].asset.code`);
  const issuer = requiredText(operation.asset?.issuer, `recoveryPlan.operations[${index}].asset.issuer`);
  return Object.freeze({ assetKey: `${code}:${issuer}`, destination: rescueDestination, amount });
}

function validateSignedArtifacts(input) {
  const recovery = verifySignedRecoveryEnvelopeArtifact({
    plan: input.recoveryPlan,
    artifact: input.recoveryArtifact,
    signedTransactionXdr: input.signedRecoveryTransactionXdr
  });
  if (!recovery.valid) throw new Error(`Signed recovery artifact failed execution-manifest preflight: ${recovery.errors.join('; ')}`);
  const heartbeat = verifySignedHeartbeatEnvelopeArtifact({
    plan: input.heartbeatPlan,
    artifact: input.heartbeatArtifact,
    signedTransactionXdr: input.signedHeartbeatTransactionXdr
  });
  if (!heartbeat.valid) throw new Error(`Signed heartbeat artifact failed execution-manifest preflight: ${heartbeat.errors.join('; ')}`);
  const feeBump = verifySignedFeeBumpEnvelopeArtifact({
    recoveryPlan: input.recoveryPlan,
    recoveryArtifact: input.recoveryArtifact,
    feeBumpPlan: input.feeBumpPlan,
    artifact: input.feeBumpArtifact,
    signedFeeBumpTransactionXdr: input.signedFeeBumpTransactionXdr
  });
  if (!feeBump.valid) throw new Error(`Signed fee-bump artifact failed execution-manifest preflight: ${feeBump.errors.join('; ')}`);
}

function buildCore(input) {
  validateSignedArtifacts(input);
  const { recoveryPlan, recoveryArtifact, heartbeatPlan, heartbeatArtifact, feeBumpPlan, feeBumpArtifact } = input;
  if (recoveryPlan?.networkRef !== 'stellar:testnet' || feeBumpArtifact?.networkRef !== 'stellar:testnet') {
    throw new TypeError('Execution manifest is restricted to stellar:testnet.');
  }
  if (recoveryPlan.networkPassphrase !== TESTNET_PASSPHRASE || recoveryArtifact?.networkPassphrase !== TESTNET_PASSPHRASE ||
      heartbeatArtifact?.networkPassphrase !== TESTNET_PASSPHRASE || feeBumpArtifact?.networkPassphrase !== TESTNET_PASSPHRASE) {
    throw new TypeError('Execution manifest requires the exact Stellar Testnet network passphrase.');
  }
  const sourceAccount = requiredText(recoveryPlan.sourceAccount, 'recoveryPlan.sourceAccount');
  const rescueDestination = requiredText(recoveryPlan.rescueDestination, 'recoveryPlan.rescueDestination');
  if (heartbeatPlan?.sourceAccount !== sourceAccount || heartbeatArtifact?.sourceAccount !== sourceAccount) {
    throw new Error('Heartbeat source account is cross-wired from the recovery vault account.');
  }
  const expectedInitialSequence = (BigInt(integerString(heartbeatPlan.transactionSequence, 'heartbeatPlan.transactionSequence', { positive: true })) - 1n).toString();
  const expectedPostHeartbeatSequence = integerString(heartbeatPlan.operations?.[0]?.bumpTo, 'heartbeatPlan.operations[0].bumpTo', { positive: true });
  const recoverySequence = integerString(recoveryPlan.sequence?.recoverySequence, 'recoveryPlan.sequence.recoverySequence', { positive: true });
  if (BigInt(expectedInitialSequence) >= BigInt(expectedPostHeartbeatSequence) || BigInt(expectedPostHeartbeatSequence) >= BigInt(recoverySequence)) {
    throw new Error('Execution sequences do not preserve initial < post-heartbeat < recovery ordering.');
  }
  if (feeBumpPlan?.feeAccount !== feeBumpArtifact.feeSource) throw new Error('Fee-bump fee account is cross-wired.');
  const maxFeeStroops = integerString(feeBumpPlan.maxFeeStroops, 'feeBumpPlan.maxFeeStroops', { positive: true });
  const totalFeeStroops = integerString(feeBumpArtifact.totalFeeStroops, 'feeBumpArtifact.totalFeeStroops', { positive: true });
  if (BigInt(totalFeeStroops) > BigInt(maxFeeStroops)) throw new Error('Fee-bump total fee exceeds the execution fee cap.');
  const operations = Object.freeze(recoveryPlan.operations.map((operation, index) => assetBinding(operation, index, rescueDestination)));
  if (operations.length < 1 || new Set(operations.map(operation => operation.assetKey)).size !== operations.length) {
    throw new Error('Execution manifest requires a non-empty, duplicate-free recovery asset set.');
  }

  return Object.freeze({
    schema: 'omegavault.stellar.testnet-execution-input-manifest.v1',
    chainId: 'stellar',
    networkRef: 'stellar:testnet',
    networkPassphraseSha256: crypto.createHash('sha256').update(TESTNET_PASSPHRASE).digest('hex'),
    sourceAccount,
    rescueDestination,
    expectedInitialSequence,
    expectedPostHeartbeatSequence,
    recoverySequence,
    minAccountSequence: integerString(recoveryPlan.preconditions?.minAccountSequence, 'recoveryPlan.preconditions.minAccountSequence'),
    minAccountSequenceAge: integerString(recoveryPlan.preconditions?.minAccountSequenceAge, 'recoveryPlan.preconditions.minAccountSequenceAge'),
    operations,
    envelopes: Object.freeze({
      heartbeat: Object.freeze({
        transactionHashHex: hashHex(heartbeatArtifact.transactionHashHex, 'heartbeatArtifact.transactionHashHex'),
        signedEnvelopeSha256: xdrSha256(input.signedHeartbeatTransactionXdr, 'signedHeartbeatTransactionXdr')
      }),
      recovery: Object.freeze({
        transactionHashHex: hashHex(recoveryArtifact.transactionHashHex, 'recoveryArtifact.transactionHashHex'),
        signedEnvelopeSha256: xdrSha256(input.signedRecoveryTransactionXdr, 'signedRecoveryTransactionXdr')
      }),
      feeBump: Object.freeze({
        transactionHashHex: hashHex(feeBumpArtifact.feeBumpTransactionHashHex, 'feeBumpArtifact.feeBumpTransactionHashHex'),
        signedEnvelopeSha256: xdrSha256(input.signedFeeBumpTransactionXdr, 'signedFeeBumpTransactionXdr'),
        feeAccount: feeBumpPlan.feeAccount,
        totalFeeStroops,
        maxFeeStroops
      })
    }),
    signingKeysAccepted: false,
    liveSubmissionAuthority: false,
    chainPromotionAuthority: false,
    authorityBoundary: 'This manifest preflights exact public Stellar Testnet execution inputs. It contains no private keys, performs no signing or submission, and grants no wallet, deployment, production, live-proof or chain-promotion authority.'
  });
}

export function createStellarTestnetExecutionInputManifest(input) {
  const core = buildCore(input ?? {});
  return Object.freeze({ ...core, sha256: evidenceDigest(core) });
}

export function verifyStellarTestnetExecutionInputManifest({ manifest, inputs }) {
  const errors = [];
  try {
    exactKeys(manifest, [
      'schema', 'chainId', 'networkRef', 'networkPassphraseSha256', 'sourceAccount', 'rescueDestination',
      'expectedInitialSequence', 'expectedPostHeartbeatSequence', 'recoverySequence', 'minAccountSequence',
      'minAccountSequenceAge', 'operations', 'envelopes', 'signingKeysAccepted', 'liveSubmissionAuthority',
      'chainPromotionAuthority', 'authorityBoundary', 'sha256'
    ], 'execution manifest');
    const expected = createStellarTestnetExecutionInputManifest(inputs);
    if (manifest.sha256 !== expected.sha256) errors.push('Execution manifest digest does not match the supplied execution inputs.');
    if (evidenceDigest(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'sha256'))) !== manifest.sha256) {
      errors.push('Execution manifest content digest is invalid.');
    }
    if (manifest.authorityBoundary !== expected.authorityBoundary || manifest.signingKeysAccepted !== false ||
        manifest.liveSubmissionAuthority !== false || manifest.chainPromotionAuthority !== false) {
      errors.push('Execution manifest authority boundary is invalid.');
    }
  } catch (error) {
    errors.push(String(error?.message || error));
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
