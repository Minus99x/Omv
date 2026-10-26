function requireMethod(driver, name) {
  if (typeof driver?.[name] !== 'function') throw new TypeError(`EVM recovery test driver requires ${name}().`);
}

const MAX_UINT256 = (1n << 256n) - 1n;

function nativeAmount(value, label, { positive = false } = {}) {
  let amount;
  if (typeof value === 'bigint') {
    amount = value;
  } else if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
    amount = BigInt(value);
  } else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    amount = BigInt(value);
  } else {
    throw new TypeError(`${label} must be an exact non-negative integer primitive.`);
  }
  if (amount < 0n || amount > MAX_UINT256 || (positive && amount === 0n)) {
    throw new RangeError(`${label} must be ${positive ? 'a positive' : 'a'} uint256 amount.`);
  }
  return amount;
}

async function action(actions, operation, fn) {
  const startedAt = new Date().toISOString();
  try {
    const result = await fn();
    actions.push(Object.freeze({ operation, startedAt, ok: true, result: structuredClone(result ?? null) }));
    return result;
  } catch (error) {
    actions.push(Object.freeze({ operation, startedAt, ok: false, error: String(error?.message || error) }));
    throw error;
  }
}

export async function runEvmNativeRecoveryProof({ driver, config }) {
  for (const method of ['readState', 'readNativeBalance', 'depositNative', 'approveRecovery', 'executeRecovery']) requireMethod(driver, method);
  if (!config?.contractAddress || !config?.owner || !Array.isArray(config?.contacts) || !config.contacts.length || !config?.rescueDestination) {
    throw new TypeError('Native recovery proof requires contract, owner, contacts and rescue destination.');
  }
  if (new Set(config.contacts).size !== config.contacts.length) throw new TypeError('Native recovery proof contacts must be unique.');
  if (!Number.isInteger(config.threshold) || config.threshold < 1 || config.threshold > config.contacts.length) throw new TypeError('Native recovery proof threshold must be reachable.');
  const expectedAmount = nativeAmount(config.nativeAmount, 'Native recovery proof amount', { positive: true });
  const actions = [];
  const before = await action(actions, 'state.before', () => driver.readState(config.contractAddress));
  const rescueBefore = nativeAmount(
    await action(actions, 'rescue.balance.before', () => driver.readNativeBalance(config.rescueDestination)),
    'Rescue destination balance before recovery'
  );
  await action(actions, 'deposit.native', () => driver.depositNative({ contractAddress: config.contractAddress, actor: config.owner, amount: config.nativeAmount }));
  for (const contact of config.contacts.slice(0, config.threshold)) {
    await action(actions, 'recovery.approve', () => driver.approveRecovery({ contractAddress: config.contractAddress, actor: contact }));
  }
  await action(actions, 'recovery.execute', () => driver.executeRecovery({ contractAddress: config.contractAddress, actor: config.executor ?? config.owner }));
  const after = await action(actions, 'state.after', () => driver.readState(config.contractAddress));
  const rescueAfter = nativeAmount(
    await action(actions, 'rescue.balance.after', () => driver.readNativeBalance(config.rescueDestination)),
    'Rescue destination balance after recovery'
  );
  const rescueDeltaMatches = rescueAfter - rescueBefore === expectedAmount;
  const remainingVaultAmount = nativeAmount(after?.balance, 'Vault balance after recovery');
  const success = after?.recovered === true
    && remainingVaultAmount === 0n
    && rescueDeltaMatches;
  return Object.freeze({
    kind: 'evm-native-recovery-proof',
    success,
    before: structuredClone(before),
    after: structuredClone(after),
    rescueBefore: rescueBefore.toString(),
    rescueAfter: rescueAfter.toString(),
    rescueBalance: rescueAfter.toString(),
    rescueDeltaMatches,
    actions: Object.freeze(actions)
  });
}

export async function runEvmErc20RecoveryProof({ driver, config }) {
  for (const method of ['readTokenBalance', 'recoverErc20']) requireMethod(driver, method);
  if (!config?.contractAddress || !config?.tokenAddress || !config?.rescueDestination) throw new TypeError('ERC-20 proof requires contract, token and rescue destination.');
  const actions = [];
  const vaultBefore = await action(actions, 'token.vault.before', () => driver.readTokenBalance(config.tokenAddress, config.contractAddress));
  const rescueBefore = await action(actions, 'token.rescue.before', () => driver.readTokenBalance(config.tokenAddress, config.rescueDestination));
  await action(actions, 'token.recover', () => driver.recoverErc20({ contractAddress: config.contractAddress, tokenAddress: config.tokenAddress, actor: config.executor }));
  const vaultAfter = await action(actions, 'token.vault.after', () => driver.readTokenBalance(config.tokenAddress, config.contractAddress));
  const rescueAfter = await action(actions, 'token.rescue.after', () => driver.readTokenBalance(config.tokenAddress, config.rescueDestination));
  const moved = BigInt(rescueAfter) - BigInt(rescueBefore);
  const success = BigInt(vaultBefore) > 0n && BigInt(vaultAfter) === 0n && moved === BigInt(vaultBefore);
  return Object.freeze({ kind: 'evm-erc20-recovery-proof', success, vaultBefore: String(vaultBefore), vaultAfter: String(vaultAfter), rescueBefore: String(rescueBefore), rescueAfter: String(rescueAfter), actions: Object.freeze(actions) });
}
