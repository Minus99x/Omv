const CLASSIC_ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

function assertClassicAddress(address, label = 'address') {
  if (typeof address !== 'string' || !CLASSIC_ADDRESS.test(address)) {
    throw new TypeError(`${label} is not a valid XRPL classic address.`);
  }
  return address;
}

function assertUInt(value, max, label) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new TypeError(`${label} must be an integer between 0 and ${max}.`);
  }
  return value;
}

function normalizeEntry(entry, index) {
  const account = assertClassicAddress(entry?.account ?? entry?.Account, `signerEntries[${index}].account`);
  const weight = assertUInt(entry?.weight ?? entry?.SignerWeight, UINT16_MAX, `signerEntries[${index}].weight`);
  if (weight === 0) throw new TypeError('XRPL signer weight must be greater than zero.');
  return Object.freeze({ account, weight });
}

export function validateXrplSignerList({ owner, signerEntries, quorum }) {
  assertClassicAddress(owner, 'owner');
  if (!Array.isArray(signerEntries) || signerEntries.length < 1 || signerEntries.length > 32) {
    throw new TypeError('XRPL signer list requires 1-32 signer entries.');
  }
  const normalized = signerEntries.map(normalizeEntry);
  const seen = new Set();
  for (const entry of normalized) {
    if (entry.account === owner) throw new TypeError('XRPL signer list cannot include the owner account itself.');
    if (seen.has(entry.account)) throw new TypeError(`Duplicate XRPL signer entry: ${entry.account}`);
    seen.add(entry.account);
  }
  assertUInt(quorum, UINT32_MAX, 'quorum');
  if (quorum === 0) throw new TypeError('XRPL signer quorum must be greater than zero.');
  const totalWeight = normalized.reduce((sum, entry) => sum + entry.weight, 0);
  if (quorum > totalWeight) throw new TypeError('XRPL signer quorum is unreachable with the configured signer weights.');
  return Object.freeze({ owner, signerEntries: Object.freeze(normalized), quorum, totalWeight });
}

export function normalizeXrplSequenceBinding({ sequence = null, ticketSequence = null, accountTxnId = null } = {}) {
  if (ticketSequence != null) {
    assertUInt(ticketSequence, UINT32_MAX, 'ticketSequence');
    if (ticketSequence === 0) throw new TypeError('ticketSequence must be greater than zero.');
    if (sequence != null && sequence !== 0) throw new TypeError('Ticketed XRPL transactions require Sequence = 0.');
    if (accountTxnId != null) throw new TypeError('XRPL TicketSequence cannot be combined with AccountTxnID.');
    return Object.freeze({ Sequence: 0, TicketSequence: ticketSequence });
  }
  if (sequence == null) return Object.freeze({});
  assertUInt(sequence, UINT32_MAX, 'sequence');
  if (sequence === 0) throw new TypeError('Sequence 0 is only valid when a TicketSequence is supplied.');
  return Object.freeze({ Sequence: sequence });
}

export function normalizeXrplFeeDrops(value, label='feeDrops') {
  if (!['string','number','bigint'].includes(typeof value) ||
      (typeof value==='number' && !Number.isSafeInteger(value)) ||
      !/^(0|[1-9]\d*)$/.test(String(value)) ||
      BigInt(String(value))>100000000000000000n) {
    throw new TypeError(`${label} must be a canonical non-negative XRP drop amount within supply.`);
  }
  return String(value);
}

export function buildXrplSignerListSet({ owner, signerEntries, contacts = null, quorum, sequence = null, ticketSequence = null, feeDrops = null, lastLedgerSequence = null }) {
  const entries = signerEntries ?? contacts?.map(account => ({ account, weight: 1 }));
  const config = validateXrplSignerList({ owner, signerEntries: entries, quorum });
  const tx = {
    TransactionType: 'SignerListSet',
    Account: owner,
    SignerQuorum: quorum,
    SignerEntries: config.signerEntries.map(({ account, weight }) => ({ SignerEntry: { Account: account, SignerWeight: weight } })),
    ...normalizeXrplSequenceBinding({ sequence, ticketSequence })
  };
  if (feeDrops != null) {
    tx.Fee = normalizeXrplFeeDrops(feeDrops);
  }
  if (lastLedgerSequence != null) {
    assertUInt(lastLedgerSequence, UINT32_MAX, 'lastLedgerSequence');
    tx.LastLedgerSequence = lastLedgerSequence;
  }
  return Object.freeze({
    transaction: Object.freeze(tx),
    config,
    evidenceExpectations: Object.freeze(['validated-ledger inclusion', 'SignerList ledger object read-back', 'quorum and exact signer entries match'])
  });
}

export function coordinateXrplMultisign({ transaction, signerList, signatures, baseFeeDrops = null }) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) throw new TypeError('transaction is required.');
  const config = validateXrplSignerList(signerList);
  if (transaction.Account !== config.owner) throw new TypeError('Transaction Account must equal signer-list owner.');
  normalizeXrplSequenceBinding({
    sequence: transaction.Sequence,
    ticketSequence: transaction.TicketSequence,
    accountTxnId: transaction.AccountTxnID
  });
  if (!Array.isArray(signatures) || signatures.length < 1) throw new TypeError('At least one XRPL multisignature is required.');

  const weights = new Map(config.signerEntries.map(entry => [entry.account, entry.weight]));
  const seen = new Set();
  let signedWeight = 0;
  const signers = signatures.map((signature, index) => {
    const account = assertClassicAddress(signature?.account, `signatures[${index}].account`);
    if (!weights.has(account)) throw new TypeError(`Unknown XRPL signer: ${account}`);
    if (seen.has(account)) throw new TypeError(`Duplicate XRPL signer: ${account}`);
    seen.add(account);
    if (typeof signature.signingPubKey !== 'string' || signature.signingPubKey.length === 0) throw new TypeError('signingPubKey is required for each XRPL signer.');
    if (typeof signature.txnSignature !== 'string' || signature.txnSignature.length === 0) throw new TypeError('txnSignature is required for each XRPL signer.');
    signedWeight += weights.get(account);
    return Object.freeze({ Signer: Object.freeze({ Account: account, SigningPubKey: signature.signingPubKey, TxnSignature: signature.txnSignature }) });
  });

  if (signedWeight < config.quorum) throw new TypeError(`XRPL multisignature weight ${signedWeight} does not meet quorum ${config.quorum}.`);

  // XRPL binary multisigning requires Signers sorted by the numeric value of Account.
  // Classic-address lexical order is not equivalent, so final canonical sorting is delegated
  // to the pinned XRPL codec before binary serialization. Never claim this JSON is binary-ready.
  const tx = { ...transaction, SigningPubKey: '', Signers: signers };
  delete tx.TxnSignature;

  let minimumFeeDrops = null;
  if (baseFeeDrops != null) {
    if (!/^\d+$/.test(String(baseFeeDrops))) throw new TypeError('baseFeeDrops must be a non-negative integer string/number.');
    minimumFeeDrops = BigInt(baseFeeDrops) * BigInt(signatures.length + 1);
    if (tx.Fee != null && BigInt(tx.Fee) < minimumFeeDrops) {
      throw new TypeError(`XRPL multi-signed Fee is below the structural minimum of ${minimumFeeDrops} drops for ${signatures.length} signatures.`);
    }
  }

  return Object.freeze({
    transaction: Object.freeze(tx),
    signedWeight,
    quorum: config.quorum,
    minimumFeeDrops: minimumFeeDrops?.toString() ?? null,
    submission: Object.freeze({
      method: 'submit_multisigned',
      jsonSignerOrdering: 'codec-canonicalized-by-numeric-account-id',
      binaryOfflineSigning: 'verified by pinned xrpl.js codec before submission',
      allFieldsFrozenBeforeSigning: true,
      signingPubKeyMustBeEmpty: true
    })
  });
}

export { assertClassicAddress };
