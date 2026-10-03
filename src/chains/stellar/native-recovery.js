import { Account, Asset, Keypair, Operation, SignerKey, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';

const MAX_INT64 = 9223372036854775807n;
const STELLAR_SDK_VERSION = '17.1.0';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

function assertAccount(address, label) {
  if (typeof address !== 'string' || !StrKey.isValidEd25519PublicKey(address)) throw new TypeError(`${label} is not a valid Stellar account.`);
}

function asSequence(value, label) {
  const n = BigInt(value);
  if (n < 0n || n > MAX_INT64) throw new TypeError(`${label} must fit a non-negative signed 64-bit sequence number.`);
  return n;
}

export function chooseRecoverySequence({ currentSequence, gap = 2147483648n, safetyMargin = 1024n }) {
  const current = asSequence(currentSequence, 'currentSequence');
  const desiredGap = BigInt(gap);
  if (desiredGap < 2n) throw new TypeError('Recovery sequence gap must leave room for future owner transactions.');
  const ceiling = MAX_INT64 - BigInt(safetyMargin);
  const recovery = current + desiredGap <= ceiling ? current + desiredGap : ceiling;
  if (recovery <= current + 1n) throw new Error('Current sequence is too close to the signed 64-bit ceiling for a future-safe recovery transaction.');
  return Object.freeze({
    currentSequence: current.toString(),
    minAccountSequence: current.toString(),
    recoverySequence: recovery.toString(),
    availableSequenceHeadroom: (recovery - current - 1n).toString(),
    invariant: 'Recovery remains sequence-valid while minAccountSequence <= current account sequence < recoverySequence.'
  });
}

export function createHeartbeatPlan({ vaultAccount, currentSequence }) {
  assertAccount(vaultAccount, 'vaultAccount');
  const current = asSequence(currentSequence, 'currentSequence');
  if (current + 2n > MAX_INT64) throw new Error('Sequence number is too high for a heartbeat bump.');
  return Object.freeze({
    sourceAccount: vaultAccount,
    transactionSequence: (current + 1n).toString(),
    operations: Object.freeze([{ type: 'bumpSequence', bumpTo: (current + 2n).toString() }]),
    livenessEffect: 'Successful application changes the source account sequence and therefore resets minAccountSequenceAge for the pre-authorized recovery transaction.',
    requiresOwnerAuthorization: true
  });
}

function normalizeAsset(asset) {
  if (asset === 'native' || asset?.type === 'native') return Object.freeze({ type: 'native', code: 'XLM' });
  const code = String(asset?.code ?? '').trim();
  const issuer = String(asset?.issuer ?? '').trim();
  if (!/^[A-Za-z0-9]{1,12}$/.test(code)) throw new TypeError('Classic Stellar asset code must be 1-12 alphanumeric characters.');
  assertAccount(issuer, 'asset issuer');
  return Object.freeze({ type: 'credit_alphanum', code, issuer });
}

function amountToStroops(value, label = 'amount') {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,7}))?$/.exec(String(value ?? ''));
  if (!match) throw new TypeError(`${label} must be a positive decimal with at most seven fractional digits.`);
  const stroops = BigInt(match[1]) * 10000000n + BigInt((match[2] ?? '').padEnd(7, '0'));
  if (stroops <= 0n || stroops > MAX_INT64) throw new TypeError(`${label} must fit Stellar's positive signed 64-bit amount range.`);
  return stroops;
}

function canonicalAmount(value, label) {
  const stroops = amountToStroops(value, label);
  const whole = stroops / 10000000n;
  const fraction = (stroops % 10000000n).toString().padStart(7, '0');
  return `${whole}.${fraction}`;
}

function toHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function planAssetToSdk(asset) {
  return asset.type === 'native' ? Asset.native() : new Asset(asset.code, asset.issuer);
}

export function createRecoveryEnvelopePlan({
  vaultAccount,
  rescueDestination,
  currentSequence,
  inactivitySeconds,
  contacts,
  threshold,
  assets = ['native'],
  amounts = {},
  baseFeeStroops = '100',
  networkPassphrase = TESTNET_PASSPHRASE
}) {
  assertAccount(vaultAccount, 'vaultAccount');
  assertAccount(rescueDestination, 'rescueDestination');
  if (vaultAccount === rescueDestination) throw new TypeError('rescueDestination must differ from vaultAccount.');
  if (!Array.isArray(contacts) || !contacts.length || contacts.length > 2) throw new TypeError('Exact native Stellar recovery supports one or two contacts because a transaction can require at most two extra signers.');
  contacts.forEach(contact => assertAccount(contact, 'contact'));
  if (new Set(contacts).size !== contacts.length) throw new TypeError('contacts must be unique.');
  if (contacts.includes(vaultAccount) || contacts.includes(rescueDestination)) throw new TypeError('contacts must differ from the vault and rescue accounts.');
  if (!Number.isInteger(threshold) || threshold !== contacts.length) throw new TypeError('Exact native Stellar recovery currently supports N-of-N contact approval only; M-of-N requires the Soroban fallback.');
  if (!Number.isInteger(inactivitySeconds) || inactivitySeconds < 1) throw new TypeError('inactivitySeconds must be positive.');
  const baseFee = BigInt(baseFeeStroops);
  if (baseFee <= 0n) throw new TypeError('baseFeeStroops must be positive.');
  const sequence = chooseRecoverySequence({ currentSequence });
  const normalizedAssets = assets.map(normalizeAsset);
  const assetKeys = normalizedAssets.map(asset => asset.type === 'native' ? 'native' : `${asset.code}:${asset.issuer}`);
  if (new Set(assetKeys).size !== assetKeys.length) throw new TypeError('assets must not contain duplicates.');
  const operations = [];
  const limitations = [];

  for (let i = 0; i < normalizedAssets.length; i += 1) {
    const asset = normalizedAssets[i];
    const key = asset.type === 'native' ? 'native' : `${asset.code}:${asset.issuer}`;
    let amount = null;
    try {
      amount = canonicalAmount(amounts[key], `recovery amount for ${key}`);
    } catch {
      limitations.push(`Exact payment amount for ${key} is required before hashing a pre-authorized native recovery transaction.`);
      continue;
    }
    operations.push(Object.freeze({ type: 'payment', destination: rescueDestination, asset, amount }));
  }

  limitations.push('The pre-authorized transaction is immutable: balances/assets added after setup are not automatically included. Owner must rebuild/re-authorize recovery when the protected asset set or target amounts materially change.');
  limitations.push('A matching preAuthTx signer is removed when the transaction is applied even if an operation fails; preflight must verify rescue trustlines, balances, authorization flags and operation validity immediately before submission.');
  limitations.push('Native-account recovery here is a bounded declared-asset recovery plan, not an unrestricted account-drain primitive.');
  limitations.push('The exact native design is N-of-N for one or two contacts. Broader M-of-N policies require the Soroban fallback because Stellar transaction preconditions allow at most two extra signers.');

  return Object.freeze({
    chainId: 'stellar',
    networkRef: 'stellar:testnet',
    strategy: 'preauth-min-sequence-age',
    sourceAccount: vaultAccount,
    rescueDestination,
    networkPassphrase,
    sequence,
    preconditions: Object.freeze({ minAccountSequence: sequence.minAccountSequence, minAccountSequenceAge: String(inactivitySeconds) }),
    baseFeeStroops: baseFee.toString(),
    feeStroops: baseFee.toString(),
    operations: Object.freeze(operations),
    signerPolicy: Object.freeze({
      contacts: Object.freeze([...contacts]),
      threshold,
      contactAccountSignerWeight: 0,
      preAuthTxWeight: 1,
      masterWeight: 1,
      lowThreshold: 1,
      mediumThreshold: 1,
      highThreshold: 1,
      operationThreshold: 1,
      requiredExtraSigners: Object.freeze([...contacts]),
      exactNativeMode: 'n-of-n-extra-signers'
    }),
    limitations: Object.freeze(limitations),
    hashBindingFields: Object.freeze(['networkPassphrase', 'sourceAccount', 'transactionSequence', 'fee', 'preconditions', 'extraSigners', 'operations']),
    xdrSerializationRequiredBeforeSignerCreation: true
  });
}

export function buildRecoveryEnvelopeArtifact(plan) {
  if (!plan || plan.strategy !== 'preauth-min-sequence-age') throw new TypeError('A Stellar pre-authorized recovery plan is required.');
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) throw new Error('Recovery envelope cannot be built until every protected asset has an exact payment operation.');
  assertAccount(plan.sourceAccount, 'sourceAccount');
  assertAccount(plan.rescueDestination, 'rescueDestination');

  const recoverySequence = asSequence(plan.sequence.recoverySequence, 'recoverySequence');
  if (recoverySequence < 1n) throw new Error('recoverySequence must be positive.');
  const source = new Account(plan.sourceAccount, (recoverySequence - 1n).toString());
  let builder = new TransactionBuilder(source, {
    fee: String(plan.baseFeeStroops ?? plan.feeStroops),
    networkPassphrase: plan.networkPassphrase
  });
  builder = builder
    .setMinAccountSequence(String(plan.preconditions.minAccountSequence))
    .setMinAccountSequenceAge(BigInt(plan.preconditions.minAccountSequenceAge))
    .setExtraSigners(plan.signerPolicy.requiredExtraSigners)
    .setTimeout(0);

  for (const operation of plan.operations) {
    if (operation.type !== 'payment' || operation.destination !== plan.rescueDestination) throw new Error('Recovery plan contains an unsupported or redirected operation.');
    builder = builder.addOperation(Operation.payment({
      destination: operation.destination,
      asset: planAssetToSdk(operation.asset),
      amount: canonicalAmount(operation.amount, 'operation amount')
    }));
  }

  const transaction = builder.build();
  const transactionHashHex = toHex(transaction.hash());
  const transactionXdr = transaction.toXdr();
  const decoded = TransactionBuilder.fromXdr(transactionXdr, plan.networkPassphrase);
  if (decoded.toXdr() !== transactionXdr || toHex(decoded.hash()) !== transactionHashHex) throw new Error('Stellar SDK XDR round-trip verification failed.');

  return Object.freeze({
    format: 'stellar-transaction-envelope-xdr',
    sdk: Object.freeze({ package: '@stellar/stellar-sdk', version: STELLAR_SDK_VERSION }),
    networkPassphrase: plan.networkPassphrase,
    transactionXdr,
    transactionHashHex,
    preAuthTxSigner: StrKey.encodePreAuthTx(transaction.hash()),
    sourceAccount: transaction.source,
    transactionSequence: transaction.sequence,
    minAccountSequence: transaction.minAccountSequence,
    minAccountSequenceAge: transaction.minAccountSequenceAge.toString(),
    baseFeeStroops: String(plan.baseFeeStroops ?? plan.feeStroops),
    totalFeeStroops: transaction.fee,
    operationCount: transaction.operations.length,
    signaturesRequiredAtSubmission: plan.signerPolicy.threshold,
    requiredExtraSigners: Object.freeze([...plan.signerPolicy.requiredExtraSigners]),
    extraSignaturePolicy: 'Submit exactly the selected threshold of contact signatures. Additional valid signatures can fail with TX_BAD_AUTH_EXTRA.',
    roundTripVerified: true
  });
}

export function verifyRecoveryEnvelopeArtifact({ plan, artifact }) {
  if (!artifact?.transactionXdr || !artifact?.transactionHashHex) throw new TypeError('Recovery envelope artifact is incomplete.');
  const transaction = TransactionBuilder.fromXdr(artifact.transactionXdr, plan.networkPassphrase);
  const errors = [];
  if (toHex(transaction.hash()) !== artifact.transactionHashHex) errors.push('Transaction hash does not match XDR.');
  if (transaction.source !== plan.sourceAccount) errors.push('Source account does not match plan.');
  if (transaction.sequence !== plan.sequence.recoverySequence) errors.push('Transaction sequence does not match plan.');
  if (transaction.minAccountSequence !== plan.preconditions.minAccountSequence) errors.push('Minimum account sequence does not match plan.');
  if (transaction.minAccountSequenceAge?.toString() !== plan.preconditions.minAccountSequenceAge) errors.push('Minimum account sequence age does not match plan.');
  const actualExtraSigners = (transaction.extraSigners ?? []).map(signer => SignerKey.encodeSignerKey(signer));
  if (JSON.stringify(actualExtraSigners) !== JSON.stringify(plan.signerPolicy.requiredExtraSigners)) errors.push('Required extra signers do not match plan.');
  if (transaction.operations.length !== plan.operations.length) errors.push('Operation count does not match plan.');

  transaction.operations.forEach((operation, index) => {
    const expected = plan.operations[index];
    if (operation.type !== 'payment' || operation.destination !== expected?.destination || operation.amount !== expected?.amount) errors.push(`Payment operation ${index} does not match plan.`);
    const actualAsset = operation.asset?.isNative() ? { type: 'native', code: 'XLM' } : { type: 'credit_alphanum', code: operation.asset?.code, issuer: operation.asset?.issuer };
    if (JSON.stringify(actualAsset) !== JSON.stringify(expected?.asset)) errors.push(`Asset operation ${index} does not match plan.`);
  });

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), recomputedHashHex: toHex(transaction.hash()) });
}

export function createSignerSetupPlan({ plan, transactionHashHex }) {
  if (!/^[a-f0-9]{64}$/i.test(transactionHashHex ?? '')) throw new TypeError('transactionHashHex must be a 32-byte hexadecimal hash.');
  const policy = plan?.signerPolicy;
  if (!policy) throw new TypeError('Stellar signer policy is required.');
  return Object.freeze({
    sourceAccount: plan.sourceAccount,
    ownerAuthorizationRequired: true,
    atomicSetupRequired: true,
    preAuthTxSigner: StrKey.encodePreAuthTx(Uint8Array.from(transactionHashHex.match(/../g), byte => Number.parseInt(byte, 16))),
    operations: Object.freeze([
      Object.freeze({ type: 'setOptions', masterWeight: policy.masterWeight, lowThreshold: policy.lowThreshold, mediumThreshold: policy.mediumThreshold, highThreshold: policy.highThreshold }),
      Object.freeze({ type: 'setOptions', signer: Object.freeze({ type: 'preAuthTx', hashHex: transactionHashHex.toLowerCase(), weight: policy.preAuthTxWeight }) })
    ]),
    securityInvariant: 'Contacts are transaction extra-signers, not account signers. The preAuthTx signer authorizes only this exact envelope, while every configured contact signature is additionally required by the hashed preconditions.',
    livenessStart: 'The successful signer-setup transaction changes the source sequence and starts the sequence-age inactivity clock.'
  });
}

export function coordinateRecoverySigners({ plan, signerAccounts }) {
  if (!Array.isArray(signerAccounts)) throw new TypeError('signerAccounts must be an array.');
  signerAccounts.forEach(account => assertAccount(account, 'signer account'));
  if (new Set(signerAccounts).size !== signerAccounts.length) throw new TypeError('Duplicate contact signatures are not allowed.');
  const unknown = signerAccounts.filter(account => !plan.signerPolicy.contacts.includes(account));
  if (unknown.length) throw new Error(`Unknown recovery signer: ${unknown[0]}`);
  if (signerAccounts.length !== plan.signerPolicy.threshold) throw new Error(`Exactly ${plan.signerPolicy.threshold} contact signatures are required; extra signatures risk TX_BAD_AUTH_EXTRA.`);
  const selected = plan.signerPolicy.contacts.filter(account => signerAccounts.includes(account));
  return Object.freeze({
    ready: true,
    selectedSigners: Object.freeze(selected),
    requiredExtraSigners: Object.freeze([...plan.signerPolicy.requiredExtraSigners]),
    implicitPreAuthWeight: plan.signerPolicy.preAuthTxWeight,
    totalAuthorizationWeight: plan.signerPolicy.preAuthTxWeight,
    requiredThreshold: plan.signerPolicy.operationThreshold
  });
}

export function validateRecoveryAccountSnapshot({ plan, artifact, snapshot }) {
  const errors = [];
  let sequence;
  try { sequence = asSequence(snapshot?.sequence, 'snapshot sequence'); } catch (error) { errors.push(error.message); }
  const expectedThreshold = plan.signerPolicy.operationThreshold;
  for (const level of ['low', 'medium', 'high']) {
    if (snapshot?.thresholds?.[level] !== expectedThreshold) errors.push(`${level} threshold drifted from recovery policy.`);
  }
  if (snapshot?.masterWeight !== plan.signerPolicy.masterWeight) errors.push('Master weight drifted from recovery policy.');

  const signers = Array.isArray(snapshot?.signers) ? snapshot.signers : [];
  const preAuth = signers.find(item => item.type === 'preAuthTx' && item.key === artifact.preAuthTxSigner);
  if (!preAuth || preAuth.weight !== plan.signerPolicy.preAuthTxWeight) errors.push('Exact pre-authorized transaction signer is missing or has wrong weight.');
  const allowed = new Set([`preAuthTx:${artifact.preAuthTxSigner}`]);
  const unknown = signers.filter(item => !allowed.has(`${item.type}:${item.key}`));
  if (unknown.length) errors.push('Unexpected account signer detected; policy must be reviewed before recovery.');
  if (sequence != null) {
    if (sequence < BigInt(plan.preconditions.minAccountSequence)) errors.push('Account sequence is below the envelope minimum.');
    if (sequence >= BigInt(plan.sequence.recoverySequence)) errors.push('Account sequence has reached or exceeded the fixed recovery transaction sequence.');
  }
  return Object.freeze({ ready: errors.length === 0, errors: Object.freeze(errors) });
}

export function assessRecoverySubmissionResult({ includedInLedger, successful, resultCode }) {
  if (typeof includedInLedger !== 'boolean' || typeof successful !== 'boolean') throw new TypeError('includedInLedger and successful must be booleans.');
  if (!includedInLedger) return Object.freeze({ preAuthSignerConsumed: false, retrySameEnvelope: false, action: 'Re-query account state and re-run preflight before resubmission.', resultCode: resultCode ?? null });
  if (successful) return Object.freeze({ preAuthSignerConsumed: true, retrySameEnvelope: false, action: 'Verify rescue balances and finality evidence.', resultCode: resultCode ?? 'txSUCCESS' });
  return Object.freeze({
    preAuthSignerConsumed: true,
    retrySameEnvelope: false,
    action: 'Do not retry the same envelope. A failed applied transaction consumes the matching preAuthTx signer; diagnose, rebuild, and re-authorize a new envelope.',
    resultCode: resultCode ?? 'txFAILED'
  });
}

export function createFeeBumpSponsorPlan({ feeAccount, innerEnvelopeHash, maxFeeStroops }) {
  assertAccount(feeAccount, 'feeAccount');
  if (!/^[a-f0-9]{64}$/i.test(innerEnvelopeHash ?? '')) throw new TypeError('innerEnvelopeHash must be a 32-byte hex transaction hash.');
  const maxFee = BigInt(maxFeeStroops);
  if (maxFee <= 0n) throw new TypeError('maxFeeStroops must be positive.');
  return Object.freeze({
    mode: 'fee-bump',
    feeAccount,
    innerEnvelopeHash: innerEnvelopeHash.toLowerCase(),
    maxFeeStroops: maxFee.toString(),
    authorizationBoundary: 'Fee payer signs only the outer fee-bump envelope; it cannot alter the already-signed inner recovery transaction.',
    sequenceSource: 'inner transaction source account'
  });
}

export function estimateReserveImpact({ baseReserveStroops, existingSubentries = 0, addedSigners = 0, addedTrustlines = 0, sponsoredEntries = 0 }) {
  const reserve = BigInt(baseReserveStroops);
  if (reserve <= 0n) throw new TypeError('baseReserveStroops must be positive.');
  for (const [name, value] of Object.entries({ existingSubentries, addedSigners, addedTrustlines, sponsoredEntries })) {
    if (!Number.isInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer.`);
  }
  const added = addedSigners + addedTrustlines;
  const before = reserve * BigInt(2 + existingSubentries);
  const afterUnsponsored = reserve * BigInt(2 + existingSubentries + added);
  const sponsored = Math.min(added, sponsoredEntries);
  const afterBeneficiary = reserve * BigInt(2 + existingSubentries + added - sponsored);
  return Object.freeze({
    baseReserveStroops: reserve.toString(),
    minimumBeforeStroops: before.toString(),
    minimumAfterUnsponsoredStroops: afterUnsponsored.toString(),
    minimumAfterBeneficiarySponsorshipStroops: afterBeneficiary.toString(),
    addedReserveUnsponsoredStroops: (afterUnsponsored - before).toString(),
    sponsoredEntriesApplied: sponsored
  });
}

export function createClassicAssetPreflight({ asset, vaultTrustline, rescueTrustline, vaultBalance, paymentAmount }) {
  const normalized = normalizeAsset(asset);
  if (normalized.type === 'native') throw new TypeError('Classic-asset preflight requires a non-native Stellar asset.');
  const amount = Number(paymentAmount);
  const balance = Number(vaultBalance);
  const errors = [];
  if (!vaultTrustline?.exists) errors.push('Vault trustline missing.');
  if (!rescueTrustline?.exists) errors.push('Rescue trustline missing.');
  if (rescueTrustline?.authorized === false) errors.push('Rescue trustline is not authorized by issuer.');
  if (!Number.isFinite(amount) || amount <= 0 || amount > balance) errors.push('Recovery payment amount exceeds or does not validly fit vault balance.');
  if (Number(rescueTrustline?.limit ?? Infinity) - Number(rescueTrustline?.balance ?? 0) < amount) errors.push('Rescue trustline limit does not have enough capacity.');
  return Object.freeze({ asset: normalized, ready: errors.length === 0, errors: Object.freeze(errors) });
}


function decoratedSignatureValue(signature) {
  const value = signature?.signature;
  if (!value) throw new TypeError('Stellar decorated signature is malformed.');
  return value;
}

export function verifySignedRecoveryEnvelopeArtifact({ plan, artifact, signedTransactionXdr }) {
  if (!plan || !artifact) throw new TypeError('Stellar recovery plan and artifact are required.');
  if (typeof signedTransactionXdr !== 'string' || !signedTransactionXdr.trim()) throw new TypeError('signedTransactionXdr is required.');

  const baseVerification = verifyRecoveryEnvelopeArtifact({ plan, artifact });
  const errors = baseVerification.valid
    ? []
    : baseVerification.errors.map(error => `Unsigned artifact: ${error}`);

  let transaction;
  try {
    transaction = TransactionBuilder.fromXdr(signedTransactionXdr, plan.networkPassphrase);
  } catch (error) {
    return Object.freeze({
      valid:false,
      transactionHashHex:null,
      verifiedContactSigners:Object.freeze([]),
      signatureCount:0,
      exactSignatureSet:false,
      errors:Object.freeze([...errors, `Signed Stellar envelope could not be decoded: ${error.message}`])
    });
  }

  const transactionHashHex = toHex(transaction.hash());
  if (transactionHashHex !== artifact.transactionHashHex) {
    errors.push('Signed envelope hash does not match the pre-authorized recovery artifact.');
  }

  const signatures = Array.isArray(transaction.signatures) ? transaction.signatures : [];
  const verified = [];
  const matchedIndexes = new Set();
  const hash = transaction.hash();

  for (const account of plan.signerPolicy.requiredExtraSigners) {
    const keypair = Keypair.fromPublicKey(account);
    let matchIndex = -1;
    for (let index = 0; index < signatures.length; index += 1) {
      if (matchedIndexes.has(index)) continue;
      let signatureValue;
      try { signatureValue = decoratedSignatureValue(signatures[index]); } catch { continue; }
      if (keypair.verify(hash, signatureValue)) {
        matchIndex = index;
        break;
      }
    }
    if (matchIndex < 0) {
      errors.push(`Required contact signature is missing or invalid: ${account}`);
      continue;
    }
    matchedIndexes.add(matchIndex);
    verified.push(account);
  }

  if (signatures.length !== plan.signerPolicy.requiredExtraSigners.length) {
    errors.push(`Signed recovery envelope must contain exactly ${plan.signerPolicy.requiredExtraSigners.length} contact signature(s); found ${signatures.length}.`);
  }
  if (matchedIndexes.size !== signatures.length) {
    errors.push('Signed recovery envelope contains an unknown, duplicate or otherwise unapproved signature.');
  }

  return Object.freeze({
    valid:errors.length === 0,
    transactionHashHex,
    verifiedContactSigners:Object.freeze(verified),
    signatureCount:signatures.length,
    exactSignatureSet:errors.length === 0 && verified.length === plan.signerPolicy.requiredExtraSigners.length,
    errors:Object.freeze(errors)
  });
}
