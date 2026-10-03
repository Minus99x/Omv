const TESTNET_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DECIMAL_7 = /^(0|[1-9]\d*)\.(\d{7})$/;

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

function decimalToUnits(value, label) {
  const match = DECIMAL_7.exec(String(value ?? ''));
  if (!match) throw new TypeError(`${label} must be a canonical Stellar amount with seven fractional digits.`);
  return (BigInt(match[1]) * 10000000n + BigInt(match[2])).toString();
}

function threshold(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new TypeError(`${label} must be an integer from 0 through 255.`);
  return value;
}

function signerType(type) {
  if (type === 'preauth_tx') return 'preAuthTx';
  if (type === 'sha256_hash') return 'sha256Hash';
  if (type === 'ed25519_public_key') return 'ed25519PublicKey';
  return null;
}

export function normalizeHorizonAccountSnapshot({ accountResponse, expectedAccount }) {
  if (!accountResponse || typeof accountResponse !== 'object') throw new TypeError('Horizon account response is required.');
  const account = requiredText(accountResponse.account_id, 'accountResponse.account_id');
  if (expectedAccount != null && account !== expectedAccount) throw new Error('Horizon account response is for a different account.');
  const sequence = integerString(accountResponse.sequence, 'accountResponse.sequence');
  const thresholds = accountResponse.thresholds;
  if (!thresholds || typeof thresholds !== 'object') throw new TypeError('Horizon account thresholds are required.');
  if (!Array.isArray(accountResponse.signers)) throw new TypeError('Horizon account signers are required.');

  let masterWeight = null;
  const normalizedSigners = [];
  for (const signer of accountResponse.signers) {
    if (!signer || typeof signer !== 'object') throw new TypeError('Horizon signer entry must be an object.');
    const key = requiredText(signer.key, 'signer.key');
    const weight = threshold(signer.weight, 'signer.weight');
    const type = signerType(signer.type);
    if (!type) throw new TypeError(`Unsupported Horizon signer type: ${signer.type}`);
    if (type === 'ed25519PublicKey' && key === account) {
      if (masterWeight != null) throw new Error('Horizon account response contains duplicate master-key signer entries.');
      masterWeight = weight;
      continue;
    }
    normalizedSigners.push(Object.freeze({ type, key, weight }));
  }
  if (masterWeight == null) throw new Error('Horizon account response is missing the master-key signer entry.');
  const identities = normalizedSigners.map(signer => `${signer.type}:${signer.key}`);
  if (new Set(identities).size !== identities.length) throw new Error('Horizon account response contains duplicate non-master signers.');

  return Object.freeze({
    account,
    sequence,
    sequenceLedger: accountResponse.sequence_ledger == null ? null : Number(accountResponse.sequence_ledger),
    sequenceTime: accountResponse.sequence_time == null ? null : String(accountResponse.sequence_time),
    lastModifiedLedger: Number(accountResponse.last_modified_ledger),
    lastModifiedTime: accountResponse.last_modified_time == null ? null : String(accountResponse.last_modified_time),
    masterWeight,
    thresholds: Object.freeze({
      low: threshold(thresholds.low_threshold, 'thresholds.low_threshold'),
      medium: threshold(thresholds.med_threshold, 'thresholds.med_threshold'),
      high: threshold(thresholds.high_threshold, 'thresholds.high_threshold')
    }),
    signers: Object.freeze(normalizedSigners),
    source: 'stellar-horizon-account'
  });
}

function matchingBalanceLine(accountResponse, asset) {
  if (!Array.isArray(accountResponse?.balances)) throw new TypeError('Horizon account balances are required.');
  if (asset?.type === 'native') {
    return accountResponse.balances.find(line => line?.asset_type === 'native') ?? null;
  }
  return accountResponse.balances.find(line =>
    (line?.asset_type === 'credit_alphanum4' || line?.asset_type === 'credit_alphanum12') &&
    line?.asset_code === asset?.code &&
    line?.asset_issuer === asset?.issuer
  ) ?? null;
}

export function extractHorizonBalanceUnits({ accountResponse, expectedAccount, asset }) {
  const account = requiredText(accountResponse?.account_id, 'accountResponse.account_id');
  if (expectedAccount != null && account !== expectedAccount) throw new Error('Horizon balance response is for a different account.');
  const line = matchingBalanceLine(accountResponse, asset);
  if (!line) throw new Error('Requested Stellar asset balance is absent from Horizon account state.');
  return decimalToUnits(line.balance, 'Horizon balance');
}

export function normalizeHorizonSubmissionSuccess({ response, expectedTransactionHashHex }) {
  if (!response || typeof response !== 'object') throw new TypeError('Horizon submission response is required.');
  const hash = requiredText(response.hash, 'submission.hash').toLowerCase();
  if (expectedTransactionHashHex != null && hash !== String(expectedTransactionHashHex).toLowerCase()) {
    throw new Error('Horizon submission response hash does not match the submitted envelope.');
  }
  if (response.successful !== true) throw new Error('Horizon submission response does not report a successful transaction.');
  return Object.freeze({
    transactionHashHex: hash,
    observedAt: requiredText(response.created_at, 'submission.created_at'),
    includedInLedger: true,
    successful: true,
    resultCode: 'txSUCCESS',
    ledger: integerString(response.ledger, 'submission.ledger', { positive: true })
  });
}

function resultCodeFromError(error) {
  return error?.response?.data?.extras?.result_codes?.transaction ??
    error?.response?.extras?.result_codes?.transaction ??
    error?.extras?.result_codes?.transaction ??
    error?.result_codes?.transaction ??
    null;
}

export function normalizeHorizonSubmissionError({ error, expectedTransactionHashHex, observedAt }) {
  const resultCode = resultCodeFromError(error);
  if (resultCode !== 'txTOO_EARLY') {
    throw new Error(`Horizon rejected the transaction with unsupported proof result code: ${resultCode ?? 'unknown'}`);
  }
  return Object.freeze({
    transactionHashHex: requiredText(expectedTransactionHashHex, 'expectedTransactionHashHex').toLowerCase(),
    observedAt: requiredText(observedAt, 'observedAt'),
    includedInLedger: false,
    successful: false,
    resultCode: 'txTOO_EARLY'
  });
}

export function normalizeHorizonFinality({
  transactionResponse,
  ledgerResponse,
  expectedTransactionHashHex,
  expectedLedger
}) {
  if (!transactionResponse || typeof transactionResponse !== 'object') throw new TypeError('Horizon transaction response is required.');
  if (!ledgerResponse || typeof ledgerResponse !== 'object') throw new TypeError('Horizon ledger response is required.');
  const hash = requiredText(transactionResponse.hash, 'transaction.hash').toLowerCase();
  if (hash !== String(expectedTransactionHashHex).toLowerCase()) throw new Error('Horizon finality response is for a different transaction.');
  const ledger = integerString(transactionResponse.ledger, 'transaction.ledger', { positive: true });
  if (ledger !== String(expectedLedger)) throw new Error('Horizon finality response ledger does not match the inclusion ledger.');
  if (transactionResponse.successful !== true) throw new Error('Horizon finality response is not successful.');

  const ledgerSequence = integerString(ledgerResponse.sequence, 'ledger.sequence', { positive: true });
  if (ledgerSequence !== ledger) throw new Error('Horizon ledger response does not match the transaction ledger.');
  const ledgerHash = requiredText(ledgerResponse.hash, 'ledger.hash').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(ledgerHash)) throw new TypeError('Horizon ledger hash must be a 32-byte hexadecimal digest.');

  return Object.freeze({
    status: 'finalized',
    transactionHashHex: hash,
    ledger,
    ledgerHash,
    observedAt: requiredText(ledgerResponse.closed_at, 'ledger.closed_at')
  });
}

export function createInjectedStellarTestnetHorizonDriver({
  transport,
  horizonUrl = TESTNET_HORIZON_URL,
  clock = () => new Date().toISOString()
}) {
  if (horizonUrl !== TESTNET_HORIZON_URL) throw new TypeError('OmegaVault Stellar proof driver is restricted to the official Stellar Testnet Horizon endpoint.');
  for (const method of ['loadAccount', 'submitTransactionXdr', 'loadTransaction', 'loadLedger', 'waitUntilEligible']) {
    if (typeof transport?.[method] !== 'function') throw new TypeError(`Injected Horizon transport requires ${method}().`);
  }
  if (typeof clock !== 'function') throw new TypeError('clock must be a function.');

  return Object.freeze({
    async readAccountSnapshot(account) {
      const response = await transport.loadAccount(account);
      return normalizeHorizonAccountSnapshot({ accountResponse: response, expectedAccount: account });
    },

    async readBalanceUnits({ account, asset }) {
      const response = await transport.loadAccount(account);
      return extractHorizonBalanceUnits({ accountResponse: response, expectedAccount: account, asset });
    },

    async submitEnvelope({ transactionXdr, expectedTransactionHashHex }) {
      try {
        const response = await transport.submitTransactionXdr(transactionXdr);
        return normalizeHorizonSubmissionSuccess({ response, expectedTransactionHashHex });
      } catch (error) {
        return normalizeHorizonSubmissionError({
          error,
          expectedTransactionHashHex,
          observedAt: clock()
        });
      }
    },

    async waitUntilEligible(request) {
      const result = await transport.waitUntilEligible(structuredClone(request));
      if (!result || result.eligible !== true) throw new Error('Injected Horizon transport did not establish recovery eligibility.');
      return Object.freeze({ ...structuredClone(result), eligible: true });
    },

    async observeFinality({ transactionHashHex, ledger }) {
      const transactionResponse = await transport.loadTransaction(transactionHashHex);
      const transactionLedger = integerString(transactionResponse?.ledger, 'transaction.ledger', { positive: true });
      if (transactionLedger !== String(ledger)) throw new Error('Horizon transaction lookup returned a different inclusion ledger.');
      const ledgerResponse = await transport.loadLedger(transactionLedger);
      return normalizeHorizonFinality({
        transactionResponse,
        ledgerResponse,
        expectedTransactionHashHex: transactionHashHex,
        expectedLedger: ledger
      });
    },

    safetyBoundary: Object.freeze({
      networkRef: 'stellar:testnet',
      horizonUrl: TESTNET_HORIZON_URL,
      signingKeysAccepted: false,
      signingPerformed: false,
      productionNetworkAllowed: false,
      transportInjected: true
    })
  });
}
