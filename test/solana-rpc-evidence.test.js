import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSolanaRpcEvidenceBundle } from '../src/chains/solana/rpc-evidence.js';

const fixturePath = new URL('./fixtures/solana-rpc-evidence.json', import.meta.url);
const loadFixture = () => JSON.parse(readFileSync(fixturePath, 'utf8'));
const expected = Object.freeze({
  expectedMessageIntentDigest: 'e'.repeat(64),
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
