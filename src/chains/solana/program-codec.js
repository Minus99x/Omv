import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519.js';

export const SOLANA_PROGRAM_STATE_BYTES = 642;
export const SOLANA_PROGRAM_INSTRUCTION = Object.freeze({ initialize: 0, heartbeat: 1, approve: 2, executeNative: 3 });
const MAX_CONTACTS = 16;
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const PDA_MARKER = Buffer.from('ProgramDerivedAddress');

function publicKey(value, label) {
  try {
    const bytes = Buffer.from(bs58.decode(value));
    if (bytes.length !== 32 || bs58.encode(bytes) !== value) throw new Error('non-canonical');
    return Object.freeze({ bytes, base58: value });
  } catch {
    throw new TypeError(`${label} must be a canonical 32-byte Solana public key.`);
  }
}

function seed(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 1 || Buffer.byteLength(value, 'utf8') > 32) throw new TypeError('vaultId must encode to 1-32 bytes.');
  return Buffer.from(value, 'utf8');
}

function meta(pubkey, isSigner, isWritable) { return Object.freeze({ pubkey, isSigner, isWritable }); }

function createProgramAddress(seeds, program) {
  if (seeds.length > 16 || seeds.some(value => value.length > 32)) throw new TypeError('PDA seeds exceed Solana protocol limits.');
  const digest = createHash('sha256').update(Buffer.concat([...seeds, program.bytes, PDA_MARKER])).digest();
  try { ed25519.Point.fromBytes(digest); } catch { return digest; }
  throw new Error('PDA candidate lies on the Ed25519 curve.');
}

function findProgramAddress(seeds, program) {
  for (let bump = 255; bump >= 0; bump -= 1) {
    try { return [createProgramAddress([...seeds, Buffer.from([bump])], program), bump]; } catch (error) {
      if (!/lies on/.test(error.message)) throw error;
    }
  }
  throw new Error('Unable to find an off-curve program-derived address.');
}

export function deriveSolanaVaultPdas({ programId, owner, vaultId }) {
  const program = publicKey(programId, 'programId');
  const ownerKey = publicKey(owner, 'owner');
  const vaultSeed = seed(vaultId);
  const [statePda, stateBump] = findProgramAddress([Buffer.from('omegavault-state'), ownerKey.bytes, vaultSeed], program);
  const [custodyPda, custodyBump] = findProgramAddress([Buffer.from('omegavault-custody'), ownerKey.bytes, vaultSeed], program);
  return Object.freeze({ statePda: bs58.encode(statePda), stateBump, custodyPda: bs58.encode(custodyPda), custodyBump });
}

export function buildSolanaInitializeInstruction({ programId, payer, owner, rescueDestination, contacts, threshold, inactivitySeconds, vaultId }) {
  const program = publicKey(programId, 'programId');
  const payerKey = publicKey(payer, 'payer');
  const ownerKey = publicKey(owner, 'owner');
  const rescue = publicKey(rescueDestination, 'rescueDestination');
  const vaultSeed = seed(vaultId);
  if (ownerKey.bytes.equals(rescue.bytes)) throw new TypeError('owner and rescueDestination must differ.');
  if (!Array.isArray(contacts) || contacts.length < 1 || contacts.length > MAX_CONTACTS) throw new TypeError('contacts must contain 1-16 keys.');
  const contactKeys = contacts.map((value, index) => publicKey(value, `contacts[${index}]`));
  if (contactKeys.some(key => key.bytes.equals(ownerKey.bytes))) throw new TypeError('owner cannot be a trusted contact.');
  if (new Set(contactKeys.map(key => key.base58)).size !== contactKeys.length) throw new TypeError('contacts must be unique.');
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > contactKeys.length) throw new TypeError('threshold must be reachable.');
  if (!Number.isSafeInteger(inactivitySeconds) || inactivitySeconds < 1) throw new TypeError('inactivitySeconds must be a positive safe integer.');
  const inactivity = Buffer.alloc(8); inactivity.writeBigUInt64LE(BigInt(inactivitySeconds));
  const data = Buffer.concat([Buffer.from([SOLANA_PROGRAM_INSTRUCTION.initialize, vaultSeed.length]), vaultSeed, Buffer.from([threshold, contactKeys.length]), inactivity, rescue.bytes, ...contactKeys.map(key => key.bytes)]);
  const pdas = deriveSolanaVaultPdas({ programId, owner, vaultId });
  return Object.freeze({
    programId: program.base58, dataHex: data.toString('hex'), stateBytes: SOLANA_PROGRAM_STATE_BYTES, ...pdas,
    keys: Object.freeze([
      meta(payerKey.base58, true, true), meta(ownerKey.base58, true, false),
      meta(pdas.statePda, false, true), meta(pdas.custodyPda, false, true), meta(SYSTEM_PROGRAM_ID, false, false)
    ])
  });
}

export function buildSolanaHeartbeatInstruction({ programId, owner, statePda }) {
  return Object.freeze({ programId: publicKey(programId, 'programId').base58, dataHex: '01', keys: Object.freeze([meta(publicKey(owner, 'owner').base58, true, false), meta(publicKey(statePda, 'statePda').base58, false, true)]) });
}

export function buildSolanaApprovalInstruction({ programId, contact, statePda }) {
  return Object.freeze({ programId: publicKey(programId, 'programId').base58, dataHex: '02', keys: Object.freeze([meta(publicKey(contact, 'contact').base58, true, false), meta(publicKey(statePda, 'statePda').base58, false, true)]) });
}

export function buildSolanaExecuteNativeInstruction({ programId, executor, statePda, custodyPda, rescueDestination }) {
  return Object.freeze({ programId: publicKey(programId, 'programId').base58, dataHex: '03', keys: Object.freeze([
    meta(publicKey(executor, 'executor').base58, true, false), meta(publicKey(statePda, 'statePda').base58, false, true),
    meta(publicKey(custodyPda, 'custodyPda').base58, false, true), meta(publicKey(rescueDestination, 'rescueDestination').base58, false, true)
  ]) });
}
