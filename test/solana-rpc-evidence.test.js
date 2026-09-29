import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSolanaRpcEvidenceBundle } from '../src/chains/solana/rpc-evidence.js';

const fixturePath = new URL('./fixtures/solana-rpc-evidence.json', import.meta.url);
const v0FixturePath = new URL('./fixtures/solana-v0-rpc-payload.json', import.meta.url);
const rosterFixturePath = new URL('./fixtures/solana-instruction-roster-payload.json', import.meta.url);
const loadFixture = () => JSON.parse(readFileSync(fixturePath, 'utf8'));
const loadV0Fixture = () => JSON.parse(readFileSync(v0FixturePath, 'utf8'));
const loadRosterFixture = () => JSON.parse(readFileSync(rosterFixturePath, 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const expected = Object.freeze({
  expectedMessageIntentDigest: 'e'.repeat(64),
  expectedSerializedMessageSha256: 'b1c2eb550490885fc1b60ae992cd958bc7f00cd9a7c9f71e40df3d3b0ded2bb3',
  expectedSerializedTransactionSha256: 'e994eff284e1ad82d6754141a22573d2cf6793340617738f9e80f0a18ff50b5b',
  expectedInstructionRoster: Object.freeze([]),
  expectedAddressTableLookups: Object.freeze([]),
  expectedAccountRoster: Object.freeze([
    Object.freeze({ publicKey: '5KovAGoer61Vvo1Uv7sod2PpdATt74wUm7ezjKsLpKeF', isSigner: true, isWritable: true })
  ]),
  expectedFeePayer: '5KovAGoer61Vvo1Uv7sod2PpdATt74wUm7ezjKsLpKeF',
  expectedAssociatedTokenAccount: '5bV6jUfhDHCQVA1WfKBUnXUsboJgoKgkzkKcxr3joew5',
  expectedTokenProgramId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  expectedDestinationDataBytes: 170
});

test('Solana RPC fixture binds fresh blockhash, fees, rent, finalized creation and finalized ATA refetch', () => {
  const result = createSolanaRpcEvidenceBundle({ fixture: loadFixture(), ...expected });
  assert.equal(result.ok, true);
  assert.equal(result.evidence.currentBlockHeight, 375);
  assert.equal(result.evidence.lastValidBlockHeight, 400);
  assert.equal(result.evidence.minimumRentExemptLamports, 2_039_280n);
  assert.equal(result.evidence.finalizedAccountContextSlot, 500);
  assert.equal(result.evidence.messageVersion, 'legacy');
  assert.equal(result.evidence.requiredSignatures, 1);
  assert.match(result.evidenceDigest, /^[0-9a-f]{64}$/);
});

test('Solana RPC evidence fails closed on expiry, stale contexts, non-finalized creation and malformed ATA state', () => {
  const expired = loadFixture();
  expired.calls.blockHeight.response.result = 401;
  assert.equal(createSolanaRpcEvidenceBundle({ fixture: expired, ...expected }).checks.blockhashNotExpired, false);

  const staleFee = loadFixture();
  staleFee.calls.feeQuote.response.result.context.slot = 351;
  assert.equal(createSolanaRpcEvidenceBundle({ fixture: staleFee, ...expected }).checks.feeQuoteFresh, false);

  const processedCreation = loadFixture();
  processedCreation.calls.creationStatus.response.result.value[0].confirmationStatus = 'processed';
  assert.equal(createSolanaRpcEvidenceBundle({ fixture: processedCreation, ...expected }).checks.creationFinalized, false);

  const wrongOwner = loadFixture();
  wrongOwner.calls.associatedTokenAccount.response.result.value.owner = expected.expectedFeePayer;
  assert.equal(createSolanaRpcEvidenceBundle({ fixture: wrongOwner, ...expected }).checks.associatedTokenAccountOwnerMatches, false);

  const truncated = loadFixture();
  truncated.calls.associatedTokenAccount.response.result.value.data[0] = Buffer.alloc(169).toString('base64');
  assert.equal(createSolanaRpcEvidenceBundle({ fixture: truncated, ...expected }).checks.associatedTokenAccountDataLengthMatches, false);

  const mismatchedId = loadFixture();
  mismatchedId.calls.payerBalance.response.id = 99;
  assert.throws(() => createSolanaRpcEvidenceBundle({ fixture: mismatchedId, ...expected }), /response id/);
});

test('Solana RPC evidence rejects substituted simulation or fee-message payloads', () => {
  const substitutedTransaction = loadFixture();
  const transactionBytes = Buffer.from(substitutedTransaction.calls.simulation.request.params[0], 'base64');
  transactionBytes[1] ^= 1;
  substitutedTransaction.calls.simulation.request.params[0] = transactionBytes.toString('base64');
  const transactionResult = createSolanaRpcEvidenceBundle({ fixture: substitutedTransaction, ...expected });
  assert.equal(transactionResult.checks.serializedTransactionMatchesExpected, false);
  assert.equal(transactionResult.checks.simulationAndFeePayloadsMatch, true);

  const substitutedMessage = loadFixture();
  const messageBytes = Buffer.from(substitutedMessage.calls.feeQuote.request.params[0], 'base64');
  messageBytes[4] ^= 1;
  substitutedMessage.calls.feeQuote.request.params[0] = messageBytes.toString('base64');
  const messageResult = createSolanaRpcEvidenceBundle({ fixture: substitutedMessage, ...expected });
  assert.equal(messageResult.checks.simulationAndFeePayloadsMatch, false);
  assert.equal(messageResult.checks.messageFeePayerMatches, false);

  const wrongBlockhash = loadFixture();
  const simulationBytes = Buffer.from(wrongBlockhash.calls.simulation.request.params[0], 'base64');
  simulationBytes[simulationBytes.length - 2] ^= 1;
  wrongBlockhash.calls.simulation.request.params[0] = simulationBytes.toString('base64');
  const wrongBlockhashResult = createSolanaRpcEvidenceBundle({ fixture: wrongBlockhash, ...expected });
  assert.equal(wrongBlockhashResult.checks.messageBlockhashMatches, false);
  assert.equal(wrongBlockhashResult.checks.serializedMessageMatchesExpected, false);
});

test('Solana RPC evidence accepts a digest-bound versioned-v0 message with an empty lookup vector', () => {
  const fixture = loadFixture();
  const v0 = loadV0Fixture();
  fixture.intent.serializedMessageSha256 = v0.serializedMessageSha256;
  fixture.intent.serializedTransactionSha256 = v0.serializedTransactionSha256;
  fixture.calls.simulation.request.params[0] = v0.serializedTransactionBase64;
  fixture.calls.feeQuote.request.params[0] = v0.serializedMessageBase64;
  const result = createSolanaRpcEvidenceBundle({
    fixture,
    ...expected,
    expectedSerializedMessageSha256: v0.serializedMessageSha256,
    expectedSerializedTransactionSha256: v0.serializedTransactionSha256,
    expectedAddressTableLookups: v0.addressTableLookups,
    expectedAccountRoster: v0.accountRoster
  });
  assert.equal(result.ok, true);
  assert.equal(result.evidence.messageVersion, 0);
  assert.equal(result.evidence.requiredSignatures, 1);
  assert.equal(result.evidence.instructionCount, 0);
  assert.equal(result.evidence.addressTableLookupCount, 0);
  assert.equal(result.evidence.loadedAddressCount, 0);
});

test('Solana RPC evidence validates a v0 compiled instruction against loaded ALT addresses', () => {
  const fixture = loadFixture();
  const payload = loadV0Fixture().withLookup;
  fixture.intent.serializedMessageSha256 = payload.serializedMessageSha256;
  fixture.intent.serializedTransactionSha256 = payload.serializedTransactionSha256;
  fixture.calls.simulation.request.params[0] = payload.serializedTransactionBase64;
  fixture.calls.feeQuote.request.params[0] = payload.serializedMessageBase64;
  const args = {
    fixture,
    ...expected,
    expectedSerializedMessageSha256: payload.serializedMessageSha256,
    expectedSerializedTransactionSha256: payload.serializedTransactionSha256,
    expectedInstructionRoster: [{ programId: expected.expectedAssociatedTokenAccount, accountIndexes: [2], dataHex: '00' }],
    expectedAddressTableLookups: payload.addressTableLookups,
    expectedAccountRoster: payload.accountRoster
  };
  const result = createSolanaRpcEvidenceBundle(args);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.instructionCount, 1);
  assert.equal(result.evidence.addressTableLookupCount, 1);
  assert.equal(result.evidence.loadedAddressCount, 1);
  assert.deepEqual(result.evidence.addressTableLookups, payload.addressTableLookups);
  assert.deepEqual(result.evidence.accountRoster, payload.accountRoster);
  assert.deepEqual(result.evidence.instructionAccounts[0].accounts, [
    { accountIndex: 2, publicKey: payload.accountRoster[2].publicKey, isSigner: false, isWritable: true }
  ]);

  const readonlyLoaded = loadFixture();
  const readonlyMessage = Buffer.from(payload.serializedMessageBase64, 'base64');
  const readonlyTransaction = Buffer.from(payload.serializedTransactionBase64, 'base64');
  readonlyMessage.set([0, 1, 0], readonlyMessage.length - 3);
  readonlyTransaction.set([0, 1, 0], readonlyTransaction.length - 3);
  readonlyLoaded.calls.simulation.request.params[0] = readonlyTransaction.toString('base64');
  readonlyLoaded.calls.feeQuote.request.params[0] = readonlyMessage.toString('base64');
  readonlyLoaded.intent.serializedMessageSha256 = sha256(readonlyMessage);
  readonlyLoaded.intent.serializedTransactionSha256 = sha256(readonlyTransaction);
  const readonlyResult = createSolanaRpcEvidenceBundle({
    ...args,
    fixture: readonlyLoaded,
    expectedSerializedMessageSha256: readonlyLoaded.intent.serializedMessageSha256,
    expectedSerializedTransactionSha256: readonlyLoaded.intent.serializedTransactionSha256
  });
  assert.equal(readonlyResult.checks.instructionRosterMatches, true);
  assert.equal(readonlyResult.checks.addressTableLookupsMatch, false);
  assert.equal(readonlyResult.checks.accountRosterFullyResolved, false);
  assert.equal(readonlyResult.checks.accountRosterMatches, false);

  const invalidIndex = loadFixture();
  const invalidMessage = Buffer.from(payload.serializedMessageBase64, 'base64');
  invalidMessage[104] = 3;
  invalidIndex.calls.simulation.request.params[0] = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), invalidMessage]).toString('base64');
  assert.throws(() => createSolanaRpcEvidenceBundle({ fixture: invalidIndex, ...expected }), /outside the resolved account set/);
});

test('Solana RPC evidence binds the ordered compute, ATA, token and recovery instruction roster', () => {
  const fixture = loadFixture();
  const payload = loadRosterFixture();
  fixture.intent.serializedMessageSha256 = payload.serializedMessageSha256;
  fixture.intent.serializedTransactionSha256 = payload.serializedTransactionSha256;
  fixture.calls.simulation.request.params[0] = payload.serializedTransactionBase64;
  fixture.calls.feeQuote.request.params[0] = payload.serializedMessageBase64;
  const args = {
    fixture,
    ...expected,
    expectedSerializedMessageSha256: payload.serializedMessageSha256,
    expectedSerializedTransactionSha256: payload.serializedTransactionSha256,
    expectedInstructionRoster: payload.instructionRoster,
    expectedAddressTableLookups: payload.addressTableLookups,
    expectedAccountRoster: payload.accountRoster
  };
  const result = createSolanaRpcEvidenceBundle(args);
  assert.equal(result.ok, true);
  assert.deepEqual(result.evidence.instructionRoster, payload.instructionRoster);
  assert.deepEqual(result.evidence.accountRoster, payload.accountRoster);

  const reordered = createSolanaRpcEvidenceBundle({ ...args, expectedInstructionRoster: [...payload.instructionRoster].reverse() });
  assert.equal(reordered.checks.instructionRosterMatches, false);

  const privilegeDrift = loadFixture();
  const privilegeMessage = Buffer.from(payload.serializedMessageBase64, 'base64');
  const privilegeTransaction = Buffer.from(payload.serializedTransactionBase64, 'base64');
  privilegeMessage[2] = 3;
  privilegeTransaction[67] = 3;
  privilegeDrift.calls.simulation.request.params[0] = privilegeTransaction.toString('base64');
  privilegeDrift.calls.feeQuote.request.params[0] = privilegeMessage.toString('base64');
  privilegeDrift.intent.serializedMessageSha256 = sha256(privilegeMessage);
  privilegeDrift.intent.serializedTransactionSha256 = sha256(privilegeTransaction);
  const privilegeResult = createSolanaRpcEvidenceBundle({
    ...args,
    fixture: privilegeDrift,
    expectedSerializedMessageSha256: privilegeDrift.intent.serializedMessageSha256,
    expectedSerializedTransactionSha256: privilegeDrift.intent.serializedTransactionSha256
  });
  assert.equal(privilegeResult.checks.instructionRosterMatches, true);
  assert.equal(privilegeResult.checks.accountRosterMatches, false);

  const messageBytes = Buffer.from(payload.serializedMessageBase64, 'base64');
  const transactionBytes = Buffer.from(payload.serializedTransactionBase64, 'base64');
  const limitData = Buffer.from('02d8d60000', 'hex');
  const messageOffset = messageBytes.indexOf(limitData);
  const transactionOffset = transactionBytes.indexOf(limitData);
  assert.ok(messageOffset > 0 && transactionOffset > 0);
  messageBytes[messageOffset + 1] ^= 1;
  transactionBytes[transactionOffset + 1] ^= 1;
  const mutated = loadFixture();
  mutated.calls.simulation.request.params[0] = transactionBytes.toString('base64');
  mutated.calls.feeQuote.request.params[0] = messageBytes.toString('base64');
  mutated.intent.serializedMessageSha256 = sha256(messageBytes);
  mutated.intent.serializedTransactionSha256 = sha256(transactionBytes);
  const mutationResult = createSolanaRpcEvidenceBundle({
    ...args,
    fixture: mutated,
    expectedSerializedMessageSha256: mutated.intent.serializedMessageSha256,
    expectedSerializedTransactionSha256: mutated.intent.serializedTransactionSha256
  });
  assert.equal(mutationResult.checks.serializedMessageMatchesExpected, true);
  assert.equal(mutationResult.checks.instructionRosterMatches, false);
});

test('Solana RPC envelope parsing rejects unsupported versions and malformed compact arrays', () => {
  const unsupportedVersion = loadFixture();
  const unsupportedMessage = Buffer.from(loadV0Fixture().serializedMessageBase64, 'base64');
  unsupportedMessage[0] = 0x81;
  const unsupportedTransaction = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), unsupportedMessage]);
  unsupportedVersion.calls.simulation.request.params[0] = unsupportedTransaction.toString('base64');
  assert.throws(() => createSolanaRpcEvidenceBundle({ fixture: unsupportedVersion, ...expected }), /unsupported message version/);

  const nonCanonicalCount = loadFixture();
  const validTransaction = Buffer.from(nonCanonicalCount.calls.simulation.request.params[0], 'base64');
  nonCanonicalCount.calls.simulation.request.params[0] = Buffer.concat([Buffer.from([0x81, 0x00]), validTransaction.subarray(1)]).toString('base64');
  assert.throws(() => createSolanaRpcEvidenceBundle({ fixture: nonCanonicalCount, ...expected }), /compact-u16 is non-canonical/);

  const truncatedV0 = loadFixture();
  const v0 = loadV0Fixture();
  const truncatedMessage = Buffer.from(v0.serializedMessageBase64, 'base64').subarray(0, -1);
  truncatedV0.calls.simulation.request.params[0] = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), truncatedMessage]).toString('base64');
  assert.throws(() => createSolanaRpcEvidenceBundle({ fixture: truncatedV0, ...expected }), /address-table lookup count.*truncated/);

  const truncatedLookup = loadFixture();
  const messageWithMissingLookupKey = Buffer.from(v0.serializedMessageBase64, 'base64');
  messageWithMissingLookupKey[messageWithMissingLookupKey.length - 1] = 1;
  truncatedLookup.calls.simulation.request.params[0] = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), messageWithMissingLookupKey]).toString('base64');
  assert.throws(() => createSolanaRpcEvidenceBundle({ fixture: truncatedLookup, ...expected }), /address-table lookup 0 key is truncated/);

  const oversized = loadFixture();
  oversized.calls.simulation.request.params[0] = Buffer.alloc(1233).toString('base64');
  assert.throws(() => createSolanaRpcEvidenceBundle({ fixture: oversized, ...expected }), /1232-byte packet limit/);
});
