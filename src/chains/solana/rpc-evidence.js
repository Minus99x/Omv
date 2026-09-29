import { createHash } from 'node:crypto';
import bs58 from 'bs58';

const COMMITMENT = 'confirmed';
const FINALIZED = 'finalized';

function assertObject(value, label) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function safeUnsignedInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a safe unsigned integer.`);
  return value;
}

function positiveLamports(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive safe integer.`);
  return BigInt(value);
}

function canonicalBase58(value, byteLength, label) {
  try {
    const bytes = Buffer.from(bs58.decode(value));
    if (bytes.length !== byteLength || bs58.encode(bytes) !== value) throw new Error('non-canonical');
    return value;
  } catch {
    throw new TypeError(`${label} must be canonical base58 encoding of ${byteLength} bytes.`);
  }
}

function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? { $bigint: item.toString() } : item))
    .digest('hex');
}

function digestBytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function rpcPair(calls, key, method) {
  const pair = assertObject(calls[key], `fixture.calls.${key}`);
  const request = assertObject(pair.request, `${key}.request`);
  const response = assertObject(pair.response, `${key}.response`);
  if (request.jsonrpc !== '2.0' || response.jsonrpc !== '2.0') throw new Error(`${key} must use JSON-RPC 2.0.`);
  if (request.method !== method) throw new Error(`${key} request method must be ${method}.`);
  if (!Array.isArray(request.params)) throw new TypeError(`${key}.request.params must be an array.`);
  if (!['string', 'number'].includes(typeof request.id) || response.id !== request.id) throw new Error(`${key} response id does not match its request.`);
  if (Object.hasOwn(response, 'error')) throw new Error(`${key} response contains a JSON-RPC error.`);
  if (!Object.hasOwn(response, 'result')) throw new Error(`${key} response is missing result.`);
  return { request, response };
}

function configAt(request, index, label) {
  return assertObject(request.params[index], `${label}.request.params[${index}]`);
}

function contextualResult(response, label) {
  const result = assertObject(response.result, `${label}.response.result`);
  const context = assertObject(result.context, `${label}.response.result.context`);
  return { slot: safeUnsignedInteger(context.slot, `${label}.context.slot`), value: result.value };
}

function decodeCanonicalBase64(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty base64 string.`);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new TypeError(`${label} must use canonical base64 encoding.`);
  return bytes;
}

function readCompactU16(bytes, offset, label) {
  let value = 0;
  let shift = 0;
  for (let index = 0; index < 3; index += 1) {
    if (offset + index >= bytes.length) throw new Error(`${label} compact-u16 is truncated.`);
    const byte = bytes[offset + index];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      if (value > 0xffff || (index > 0 && byte === 0)) throw new Error(`${label} compact-u16 is non-canonical.`);
      return { value, nextOffset: offset + index + 1 };
    }
    shift += 7;
  }
  throw new Error(`${label} compact-u16 exceeds the supported u16 range.`);
}

function skipCompactByteArray(bytes, offset, label) {
  const length = readCompactU16(bytes, offset, `${label} length`);
  const nextOffset = length.nextOffset + length.value;
  if (!Number.isSafeInteger(nextOffset) || nextOffset > bytes.length) throw new Error(`${label} is truncated.`);
  return { length: length.value, dataOffset: length.nextOffset, nextOffset };
}

function parseMessageIdentity(bytes, label) {
  if (bytes.length < 4) throw new Error(`${label} is truncated before its header.`);
  let offset = 0;
  let version = 'legacy';
  if ((bytes[0] & 0x80) !== 0) {
    version = bytes[0] & 0x7f;
    if (version !== 0) throw new Error(`${label} uses an unsupported message version.`);
    offset += 1;
  }
  if (offset + 3 > bytes.length) throw new Error(`${label} header is truncated.`);
  const requiredSignatures = bytes[offset];
  const readonlySignedAccounts = bytes[offset + 1];
  const readonlyUnsignedAccounts = bytes[offset + 2];
  offset += 3;
  const accountCount = readCompactU16(bytes, offset, `${label} account count`);
  offset = accountCount.nextOffset;
  if (accountCount.value === 0) throw new Error(`${label} has no fee-payer account key.`);
  if (requiredSignatures === 0 || requiredSignatures > accountCount.value || readonlySignedAccounts > requiredSignatures || readonlyUnsignedAccounts > accountCount.value - requiredSignatures) {
    throw new Error(`${label} header account counts are inconsistent.`);
  }
  const accountKeysOffset = offset;
  const blockhashOffset = accountKeysOffset + accountCount.value * 32;
  if (!Number.isSafeInteger(blockhashOffset) || blockhashOffset + 32 > bytes.length) {
    throw new Error(`${label} account keys or recent blockhash are truncated.`);
  }
  offset = blockhashOffset + 32;
  const instructionCount = readCompactU16(bytes, offset, `${label} instruction count`);
  offset = instructionCount.nextOffset;
  const instructionIndexes = [];
  for (let index = 0; index < instructionCount.value; index += 1) {
    if (offset >= bytes.length) throw new Error(`${label} instruction ${index} is truncated before its program index.`);
    instructionIndexes.push(bytes[offset]);
    offset += 1;
    const accountIndexes = skipCompactByteArray(bytes, offset, `${label} instruction ${index} account indices`);
    instructionIndexes.push(...bytes.subarray(accountIndexes.dataOffset, accountIndexes.nextOffset));
    offset = accountIndexes.nextOffset;
    offset = skipCompactByteArray(bytes, offset, `${label} instruction ${index} data`).nextOffset;
  }
  let addressTableLookupCount = 0;
  let loadedAddressCount = 0;
  if (version === 0) {
    const lookupCount = readCompactU16(bytes, offset, `${label} address-table lookup count`);
    addressTableLookupCount = lookupCount.value;
    offset = lookupCount.nextOffset;
    for (let index = 0; index < lookupCount.value; index += 1) {
      if (offset + 32 > bytes.length) throw new Error(`${label} address-table lookup ${index} key is truncated.`);
      offset += 32;
      const writableIndexes = skipCompactByteArray(bytes, offset, `${label} address-table lookup ${index} writable indices`);
      loadedAddressCount += writableIndexes.length;
      offset = writableIndexes.nextOffset;
      const readonlyIndexes = skipCompactByteArray(bytes, offset, `${label} address-table lookup ${index} readonly indices`);
      loadedAddressCount += readonlyIndexes.length;
      offset = readonlyIndexes.nextOffset;
    }
  }
  if (offset !== bytes.length) throw new Error(`${label} contains trailing bytes.`);
  const resolvedAccountCount = accountCount.value + loadedAddressCount;
  if (instructionIndexes.some(index => index >= resolvedAccountCount)) throw new Error(`${label} instruction references an account index outside the resolved account set.`);
  return Object.freeze({
    version,
    requiredSignatures,
    instructionCount: instructionCount.value,
    addressTableLookupCount,
    loadedAddressCount,
    feePayer: bs58.encode(bytes.subarray(accountKeysOffset, accountKeysOffset + 32)),
    blockhash: bs58.encode(bytes.subarray(blockhashOffset, blockhashOffset + 32))
  });
}

function parseTransactionEnvelope(bytes) {
  if (bytes.length > 1232) throw new Error('simulation transaction exceeds the 1232-byte packet limit.');
  const signatureCount = readCompactU16(bytes, 0, 'transaction signature count');
  const messageOffset = signatureCount.nextOffset + signatureCount.value * 64;
  if (!Number.isSafeInteger(messageOffset) || messageOffset >= bytes.length) throw new Error('simulation transaction signature array or message is truncated.');
  const messageBytes = bytes.subarray(messageOffset);
  const message = parseMessageIdentity(messageBytes, 'simulation transaction message');
  return Object.freeze({ signatureCount: signatureCount.value, messageBytes, message });
}

export function createSolanaRpcEvidenceBundle({
  fixture,
  expectedMessageIntentDigest,
  expectedSerializedMessageSha256,
  expectedSerializedTransactionSha256,
  expectedFeePayer,
  expectedAssociatedTokenAccount,
  expectedTokenProgramId,
  expectedDestinationDataBytes
}) {
  const root = assertObject(fixture, 'fixture');
  const intent = assertObject(root.intent, 'fixture.intent');
  const calls = assertObject(root.calls, 'fixture.calls');
  if (!/^[0-9a-f]{64}$/.test(expectedMessageIntentDigest ?? '')) throw new TypeError('expectedMessageIntentDigest must be a lowercase SHA-256 digest.');
  if (!/^[0-9a-f]{64}$/.test(expectedSerializedMessageSha256 ?? '')) throw new TypeError('expectedSerializedMessageSha256 must be a lowercase SHA-256 digest.');
  if (!/^[0-9a-f]{64}$/.test(expectedSerializedTransactionSha256 ?? '')) throw new TypeError('expectedSerializedTransactionSha256 must be a lowercase SHA-256 digest.');
  const feePayer = canonicalBase58(expectedFeePayer, 32, 'expectedFeePayer');
  const associatedTokenAccount = canonicalBase58(expectedAssociatedTokenAccount, 32, 'expectedAssociatedTokenAccount');
  const tokenProgramId = canonicalBase58(expectedTokenProgramId, 32, 'expectedTokenProgramId');
  safeUnsignedInteger(expectedDestinationDataBytes, 'expectedDestinationDataBytes');
  if (expectedDestinationDataBytes === 0) throw new TypeError('expectedDestinationDataBytes must be positive.');

  const latest = rpcPair(calls, 'latestBlockhash', 'getLatestBlockhash');
  const latestConfig = configAt(latest.request, 0, 'latestBlockhash');
  const latestResult = contextualResult(latest.response, 'latestBlockhash');
  const latestValue = assertObject(latestResult.value, 'latestBlockhash.value');
  const blockhash = canonicalBase58(latestValue.blockhash, 32, 'latestBlockhash.value.blockhash');
  const lastValidBlockHeight = safeUnsignedInteger(latestValue.lastValidBlockHeight, 'lastValidBlockHeight');

  const validity = rpcPair(calls, 'blockhashValidity', 'isBlockhashValid');
  const validityConfig = configAt(validity.request, 1, 'blockhashValidity');
  const validityResult = contextualResult(validity.response, 'blockhashValidity');
  if (typeof validityResult.value !== 'boolean') throw new TypeError('blockhashValidity.value must be boolean.');

  const blockHeight = rpcPair(calls, 'blockHeight', 'getBlockHeight');
  const blockHeightConfig = configAt(blockHeight.request, 0, 'blockHeight');
  const currentBlockHeight = safeUnsignedInteger(blockHeight.response.result, 'blockHeight.response.result');

  const simulation = rpcPair(calls, 'simulation', 'simulateTransaction');
  const simulationConfig = configAt(simulation.request, 1, 'simulation');
  const simulationResult = contextualResult(simulation.response, 'simulation');
  const simulationValue = assertObject(simulationResult.value, 'simulation.value');
  const unitsConsumed = safeUnsignedInteger(simulationValue.unitsConsumed, 'simulation.value.unitsConsumed');
  const serializedTransaction = decodeCanonicalBase64(simulation.request.params[0], 'simulation.request.params[0]');
  const transactionEnvelope = parseTransactionEnvelope(serializedTransaction);

  const fee = rpcPair(calls, 'feeQuote', 'getFeeForMessage');
  const feeConfig = configAt(fee.request, 1, 'feeQuote');
  const feeResult = contextualResult(fee.response, 'feeQuote');
  const feeQuoteLamports = positiveLamports(feeResult.value, 'feeQuote.value');
  const feeMessageBytes = decodeCanonicalBase64(fee.request.params[0], 'feeQuote.request.params[0]');
  const feeMessage = parseMessageIdentity(feeMessageBytes, 'fee-quote message');
  const serializedMessageSha256 = digestBytes(transactionEnvelope.messageBytes);
  const serializedTransactionSha256 = digestBytes(serializedTransaction);

  const slot = rpcPair(calls, 'observationSlot', 'getSlot');
  const slotConfig = configAt(slot.request, 0, 'observationSlot');
  const observationSlot = safeUnsignedInteger(slot.response.result, 'observationSlot.response.result');

  const rent = rpcPair(calls, 'rentExemption', 'getMinimumBalanceForRentExemption');
  const rentConfig = configAt(rent.request, 1, 'rentExemption');
  const minimumRentExemptLamports = positiveLamports(rent.response.result, 'rentExemption.response.result');

  const balance = rpcPair(calls, 'payerBalance', 'getBalance');
  const balanceConfig = configAt(balance.request, 1, 'payerBalance');
  const balanceResult = contextualResult(balance.response, 'payerBalance');
  const payerBalanceLamports = positiveLamports(balanceResult.value, 'payerBalance.value');

  const status = rpcPair(calls, 'creationStatus', 'getSignatureStatuses');
  const statusResult = assertObject(status.response.result, 'creationStatus.response.result');
  if (!Array.isArray(statusResult.value) || statusResult.value.length !== 1 || statusResult.value[0] == null) {
    throw new Error('creationStatus must contain exactly one non-null status.');
  }
  const creationStatus = assertObject(statusResult.value[0], 'creationStatus.value[0]');
  const creationSlot = safeUnsignedInteger(creationStatus.slot, 'creationStatus.value[0].slot');
  const creationSignature = canonicalBase58(status.request.params[0]?.[0], 64, 'creation signature');

  const account = rpcPair(calls, 'associatedTokenAccount', 'getAccountInfo');
  const accountConfig = configAt(account.request, 1, 'associatedTokenAccount');
  const accountResult = contextualResult(account.response, 'associatedTokenAccount');
  const accountValue = accountResult.value == null ? null : assertObject(accountResult.value, 'associatedTokenAccount.value');
  let accountData = null;
  if (accountValue != null) {
    if (!Array.isArray(accountValue.data) || accountValue.data.length !== 2 || accountValue.data[1] !== 'base64') {
      throw new Error('associatedTokenAccount data must be a [data, "base64"] tuple.');
    }
    accountData = decodeCanonicalBase64(accountValue.data[0], 'associatedTokenAccount.value.data[0]');
  }

  const checks = Object.freeze({
    intentDigestMatches: intent.messageIntentDigest === expectedMessageIntentDigest,
    serializedPayloadDigestsDeclared: intent.serializedMessageSha256 === expectedSerializedMessageSha256 && intent.serializedTransactionSha256 === expectedSerializedTransactionSha256,
    feePayerMatches: intent.feePayer === feePayer && balance.request.params[0] === feePayer,
    associatedTokenAccountMatches: intent.associatedTokenAccount === associatedTokenAccount && account.request.params[0] === associatedTokenAccount,
    tokenProgramMatches: intent.tokenProgramId === tokenProgramId,
    latestBlockhashCommitmentConfirmed: latestConfig.commitment === COMMITMENT,
    blockhashRequestMatches: validity.request.params[0] === blockhash,
    blockhashValidationFresh: validityConfig.commitment === COMMITMENT && validityConfig.minContextSlot >= latestResult.slot && validityResult.slot >= latestResult.slot,
    blockhashValid: validityResult.value === true,
    blockHeightObservationFresh: blockHeightConfig.commitment === COMMITMENT && blockHeightConfig.minContextSlot >= validityResult.slot,
    blockhashNotExpired: currentBlockHeight <= lastValidBlockHeight,
    simulationEncodingBase64: simulationConfig.encoding === 'base64',
    serializedTransactionMatchesExpected: serializedTransactionSha256 === expectedSerializedTransactionSha256,
    serializedMessageMatchesExpected: serializedMessageSha256 === expectedSerializedMessageSha256,
    simulationAndFeePayloadsMatch: transactionEnvelope.messageBytes.equals(feeMessageBytes),
    messageFeePayerMatches: transactionEnvelope.message.feePayer === feePayer && feeMessage.feePayer === feePayer,
    messageBlockhashMatches: transactionEnvelope.message.blockhash === blockhash && feeMessage.blockhash === blockhash,
    signatureCountMatchesHeader: transactionEnvelope.signatureCount === transactionEnvelope.message.requiredSignatures,
    simulationUsesFrozenBlockhash: simulationConfig.commitment === COMMITMENT && simulationConfig.minContextSlot >= validityResult.slot && simulationConfig.replaceRecentBlockhash === false && simulationResult.slot >= validityResult.slot && simulationValue.replacementBlockhash == null,
    simulationSucceeded: simulationValue.err == null && unitsConsumed > 0,
    feeQuoteFresh: feeConfig.commitment === COMMITMENT && feeResult.slot >= simulationResult.slot,
    observationSlotFresh: slotConfig.commitment === COMMITMENT && slotConfig.minContextSlot >= feeResult.slot && observationSlot >= feeResult.slot,
    rentLayoutMatches: rent.request.params[0] === expectedDestinationDataBytes,
    rentCommitmentConfirmed: rentConfig.commitment === COMMITMENT,
    payerBalanceFresh: balanceConfig.commitment === COMMITMENT && balanceConfig.minContextSlot >= observationSlot && balanceResult.slot >= observationSlot,
    payerCanFundRentAndFee: payerBalanceLamports >= minimumRentExemptLamports + feeQuoteLamports,
    creationRequestMatchesSignature: status.request.params[0]?.length === 1 && status.request.params[0][0] === creationSignature,
    creationFinalized: creationStatus.err == null && creationStatus.confirmationStatus === FINALIZED,
    finalizedRefetchFresh: accountConfig.commitment === FINALIZED && accountConfig.encoding === 'base64' && accountConfig.minContextSlot >= creationSlot && accountResult.slot >= creationSlot,
    associatedTokenAccountExists: accountValue != null,
    associatedTokenAccountOwnerMatches: accountValue?.owner === tokenProgramId,
    associatedTokenAccountNotExecutable: accountValue?.executable === false,
    associatedTokenAccountSpaceMatches: accountValue?.space === expectedDestinationDataBytes,
    associatedTokenAccountDataLengthMatches: accountData?.length === expectedDestinationDataBytes,
    associatedTokenAccountRentExempt: Number.isSafeInteger(accountValue?.lamports) && BigInt(accountValue.lamports) >= minimumRentExemptLamports
  });

  const evidence = Object.freeze({
    messageIntentDigest: expectedMessageIntentDigest,
    serializedMessageSha256,
    serializedTransactionSha256,
    messageVersion: transactionEnvelope.message.version,
    requiredSignatures: transactionEnvelope.message.requiredSignatures,
    instructionCount: transactionEnvelope.message.instructionCount,
    addressTableLookupCount: transactionEnvelope.message.addressTableLookupCount,
    loadedAddressCount: transactionEnvelope.message.loadedAddressCount,
    feePayer,
    associatedTokenAccount,
    tokenProgramId,
    blockhash,
    lastValidBlockHeight,
    currentBlockHeight,
    blockhashContextSlot: latestResult.slot,
    validationContextSlot: validityResult.slot,
    simulationContextSlot: simulationResult.slot,
    feeQuoteContextSlot: feeResult.slot,
    observationSlot,
    balanceContextSlot: balanceResult.slot,
    creationSlot,
    finalizedAccountContextSlot: accountResult.slot,
    unitsConsumed,
    feeQuoteLamports,
    minimumRentExemptLamports,
    payerBalanceLamports,
    expectedDestinationDataBytes,
    creationSignature
  });
  const result = Object.freeze({
    ok: Object.values(checks).every(Boolean),
    checks,
    evidence,
    actionIfNotReady: 'discard the fixture and obtain a fresh confirmed blockhash/simulation/fee/rent/balance bundle, then require finalized creation status and a finalized ATA refetch'
  });
  return Object.freeze({ ...result, evidenceDigest: digest(result) });
}
