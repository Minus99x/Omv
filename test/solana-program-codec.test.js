import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  SOLANA_PROGRAM_STATE_BYTES, buildSolanaInitializeInstruction, buildSolanaHeartbeatInstruction,
  buildSolanaApprovalInstruction, buildSolanaExecuteNativeInstruction, deriveSolanaVaultPdas,
  deriveSolanaAssociatedTokenAddress, SOLANA_ASSOCIATED_TOKEN_PROGRAM_ID
} from '../src/chains/solana/program-codec.js';

const key = byte => bs58.encode(ed25519.getPublicKey(Uint8Array.from({ length: 32 }, () => byte)));
const [programId, payer, owner, rescue, contactA, contactB] = [1, 2, 3, 4, 5, 6].map(key);

test('Solana codec derives distinct canonical state and custody PDAs', () => {
  const value = deriveSolanaVaultPdas({ programId, owner, vaultId: 'fixture-1' });
  assert.notEqual(value.statePda, value.custodyPda);
  assert.ok(value.stateBump >= 0 && value.stateBump <= 255);
  assert.ok(value.custodyBump >= 0 && value.custodyBump <= 255);
});

test('Solana initialize codec freezes exact binary policy and account roles', () => {
  const value = buildSolanaInitializeInstruction({ programId, payer, owner, rescueDestination: rescue, contacts: [contactA, contactB], threshold: 2, inactivitySeconds: 2592000, vaultId: 'fixture-1' });
  const bytes = Buffer.from(value.dataHex, 'hex');
  assert.equal(bytes[0], 0);
  assert.equal(bytes[1], Buffer.byteLength('fixture-1'));
  assert.equal(value.stateBytes, SOLANA_PROGRAM_STATE_BYTES);
  assert.deepEqual(value.keys.map(item => [item.isSigner, item.isWritable]), [[true, true], [true, false], [false, true], [false, true], [false, false]]);
});

test('Solana client instruction tags and writable/signature roles match native processor', () => {
  const pdas = deriveSolanaVaultPdas({ programId, owner, vaultId: 'fixture-1' });
  const heartbeat = buildSolanaHeartbeatInstruction({ programId, owner, statePda: pdas.statePda });
  const approval = buildSolanaApprovalInstruction({ programId, contact: contactA, statePda: pdas.statePda });
  const execute = buildSolanaExecuteNativeInstruction({ programId, executor: payer, statePda: pdas.statePda, custodyPda: pdas.custodyPda, rescueDestination: rescue });
  assert.equal(heartbeat.dataHex, '01'); assert.equal(approval.dataHex, '02'); assert.equal(execute.dataHex, '03');
  assert.deepEqual(execute.keys.map(item => [item.isSigner, item.isWritable]), [[true, false], [false, true], [false, true], [false, true]]);
});

test('Solana initialize codec rejects policy identity and threshold drift', () => {
  const base = { programId, payer, owner, rescueDestination: rescue, contacts: [contactA, contactB], threshold: 2, inactivitySeconds: 60, vaultId: 'fixture-1' };
  assert.throws(() => buildSolanaInitializeInstruction({ ...base, rescueDestination: owner }), /must differ/);
  assert.throws(() => buildSolanaInitializeInstruction({ ...base, contacts: [contactA, contactA] }), /unique/);
  assert.throws(() => buildSolanaInitializeInstruction({ ...base, threshold: 3 }), /reachable/);
  assert.throws(() => buildSolanaInitializeInstruction({ ...base, vaultId: 'x'.repeat(33) }), /1-32 bytes/);
});

test('Solana codec rejects base58-shaped values that are not canonical 32-byte keys', () => {
  assert.throws(() => deriveSolanaVaultPdas({ programId: '1'.repeat(31), owner, vaultId: 'fixture-1' }), /canonical 32-byte/);
});

test('Solana associated token address derivation scopes the PDA to owner, mint and token program', () => {
  const legacy = deriveSolanaAssociatedTokenAddress({ owner, mint: rescue, tokenProgramId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' });
  const token2022 = deriveSolanaAssociatedTokenAddress({ owner, mint: rescue, tokenProgramId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' });
  assert.equal(legacy.associatedTokenProgramId, SOLANA_ASSOCIATED_TOKEN_PROGRAM_ID);
  assert.notEqual(legacy.address, token2022.address);
  assert.ok(legacy.bump >= 0 && legacy.bump <= 255);
  assert.ok(token2022.bump >= 0 && token2022.bump <= 255);
});
