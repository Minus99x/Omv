import { StrKey } from '@stellar/stellar-sdk';

const TESTNET_HORIZON_URL = 'https://horizon-testnet.stellar.org';

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function integerString(value, label, { positive = false } = {}) {
  // JSON numbers beyond the safe range may already have lost precision.
  // Preserve exact decimal strings and bigint values without rounding them.
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must use an exact integer string or safe integer number.`);
  }
  const text = String(value ?? '');
  if (!/^\d+$/.test(text)) throw new TypeError(`${label} must be a non-negative integer string.`);
  if (positive && BigInt(text) === 0n) throw new TypeError(`${label} must be greater than zero.`);
  return text;
}

function safeInteger(value, label, { positive = false } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (positive ? 1 : 0)) {
    throw new TypeError(`${label} must be a ${positive ? 'positive ' : ''}safe integer.`);
  }
  return number;
}

function isoTime(value, label) {
  const text = requiredText(value, label);
  const time = Date.parse(text);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text) || !Number.isFinite(time) ||
      !new Date(time).toISOString().startsWith(text.slice(0, 19))) {
    throw new TypeError(`${label} must be a valid UTC timestamp.`);
  }
  return new Date(time).toISOString();
}

function accountId(value, label) {
  const account = requiredText(value, label);
  if (!StrKey.isValidEd25519PublicKey(account)) throw new TypeError(`${label} must be a valid Stellar G-address.`);
  return account;
}

async function responseData(response) {
  if (!response || typeof response !== 'object' || typeof response.json !== 'function') {
    throw new TypeError('Horizon fetch response must provide json().');
  }
  try {
    return await response.json();
  } catch {
    throw new Error('Horizon response was not valid JSON.');
  }
}

export function createStellarTestnetHorizonHttpTransport({
  fetchImpl = globalThis.fetch,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  pollIntervalMs = 5000,
  maxEligibilityAttempts = 120,
  requestTimeoutMs = 15000
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function.');
  if (typeof sleep !== 'function') throw new TypeError('sleep must be a function.');
  const interval = safeInteger(pollIntervalMs, 'pollIntervalMs');
  const attempts = safeInteger(maxEligibilityAttempts, 'maxEligibilityAttempts', { positive: true });
  const requestTimeout = safeInteger(requestTimeoutMs, 'requestTimeoutMs', { positive: true });

  async function request(path, options = {}) {
    const target = `${TESTNET_HORIZON_URL}${path}`;
    const controller = new AbortController();
    let timer;
    // Bound BOTH the HTTP request and JSON body consumption. A stalled
    // Horizon read must not block the bounded eligibility campaign forever.
    // Never retry a timed-out POST: a submission may already have happened.
    const exchange = Promise.resolve().then(async () => {
      const response = await fetchImpl(target, {
        ...options, redirect: 'error', signal: controller.signal
      });
      if (response?.redirected === true ||
          (typeof response?.url === 'string' && response.url && response.url !== target)) {
        throw new Error('Stellar Testnet Horizon redirected or substituted the requested endpoint.');
      }
      const data = await responseData(response);
      if (response.ok !== true) {
        const error = new Error(`Stellar Testnet Horizon request failed with HTTP ${response.status ?? 'unknown'}.`);
        error.response = { data };
        throw error;
      }
      return data;
    });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('Stellar Testnet Horizon request timed out; result is unconfirmed.');
        error.code = 'STELLAR_HORIZON_TIMEOUT';
        reject(error);
        controller.abort();
      }, requestTimeout);
    });
    try {
      return await Promise.race([exchange, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadLatestLedger() {
    const data = await request('/ledgers?order=desc&limit=1', {
      method: 'GET',
      headers: { accept: 'application/json' }
    });
    const records = data?._embedded?.records;
    if (!Array.isArray(records) || records.length !== 1) {
      throw new Error('Horizon latest-ledger response must contain exactly one ledger record.');
    }
    return records[0];
  }

  const transport = {
    async loadAccount(account) {
      const id = accountId(account, 'account');
      return request(`/accounts/${encodeURIComponent(id)}`, {
        method: 'GET',
        headers: { accept: 'application/json' }
      });
    },

    async submitTransactionXdr(transactionXdr) {
      const xdr = requiredText(transactionXdr, 'transactionXdr');
      return request('/transactions', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ tx: xdr }).toString()
      });
    },

    async loadTransaction(transactionHashHex) {
      const hash = requiredText(transactionHashHex, 'transactionHashHex').toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new TypeError('transactionHashHex must be a 32-byte hexadecimal hash.');
      return request(`/transactions/${hash}`, {
        method: 'GET',
        headers: { accept: 'application/json' }
      });
    },

    async loadLedger(sequence) {
      const ledger = integerString(sequence, 'ledger sequence', { positive: true });
      return request(`/ledgers/${ledger}`, {
        method: 'GET',
        headers: { accept: 'application/json' }
      });
    },

    async waitUntilEligible({ sourceAccount, minAccountSequenceAge, currentSequence, recoverySequence }) {
      const account = accountId(sourceAccount, 'sourceAccount');
      const expectedSequence = integerString(currentSequence, 'currentSequence');
      const recovery = integerString(recoverySequence, 'recoverySequence', { positive: true });
      const minimumAge = integerString(minAccountSequenceAge, 'minAccountSequenceAge');
      if (BigInt(expectedSequence) >= BigInt(recovery)) {
        throw new Error('currentSequence must remain below recoverySequence while waiting for eligibility.');
      }

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const [accountState, latestLedger] = await Promise.all([
          transport.loadAccount(account),
          loadLatestLedger()
        ]);
        if (accountState?.account_id !== account) throw new Error('Horizon account response is for a different account.');
        const observedSequence = integerString(accountState.sequence, 'account.sequence');
        if (observedSequence !== expectedSequence) {
          throw new Error('Stellar account sequence changed while waiting for recovery eligibility.');
        }
        if (BigInt(observedSequence) >= BigInt(recovery)) {
          throw new Error('Stellar account sequence reached or exceeded the fixed recovery sequence.');
        }
        const sequenceTime = integerString(accountState.sequence_time, 'account.sequence_time');
        const sequenceLedger = integerString(accountState.sequence_ledger, 'account.sequence_ledger', { positive: true });
        const closedAt = isoTime(latestLedger?.closed_at, 'latestLedger.closed_at');
        const latestLedgerSequence = integerString(latestLedger?.sequence, 'latestLedger.sequence', { positive: true });
        if (BigInt(latestLedgerSequence) < BigInt(sequenceLedger)) {
          throw new Error('Horizon latest-ledger response predates the account sequence observation.');
        }
        const eligibleAtSeconds = BigInt(sequenceTime) + BigInt(minimumAge);
        const ledgerClosedSeconds = BigInt(Math.floor(Date.parse(closedAt) / 1000));
        if (ledgerClosedSeconds >= eligibleAtSeconds) {
          return Object.freeze({
            eligible: true,
            observedAt: closedAt,
            accountSequence: observedSequence,
            sequenceTime,
            sequenceLedger,
            latestLedger: latestLedgerSequence
          });
        }
        if (attempt < attempts) await sleep(interval);
      }
      throw new Error(`Recovery eligibility was not established after ${attempts} Horizon observations.`);
    },

    safetyBoundary: Object.freeze({
      networkRef: 'stellar:testnet',
      horizonUrl: TESTNET_HORIZON_URL,
      signingKeysAccepted: false,
      signingPerformed: false,
      productionNetworkAllowed: false,
      requestsRequireExplicitMethodCall: true
    })
  };
  return Object.freeze(transport);
}
