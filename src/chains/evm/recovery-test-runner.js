function requireMethod(driver, name) {
  if (typeof driver?.[name] !== 'function') throw new TypeError(`EVM recovery test driver requires ${name}().`);
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

function asBigInt(value, label) {
  try { return BigInt(value); }
  catch { throw new TypeError(`${label} must be an integer-like value.`); }
}

function proofBindingFields(binding) {
  if (!binding) return { binding: null, bindingSha256: null, networkRef: null, chainId: null };
  if (typeof binding.sha256 !== 'string' || typeof binding.networkRef !== 'string' || typeof binding.chainId !== 'string') {
    throw new TypeError('EVM proof binding is malformed.');
  }
  return {
    binding: structuredClone(binding),
    bindingSha256: binding.sha256,
    networkRef: binding.networkRef,
    chainId: binding.chainId
  };
}

export async function runEvmNativeRecoveryProof({ driver, config, binding = null }) {
  for (const method of ['readState', 'readNativeBalance', 'depositNative', 'approveRecovery', 'executeRecovery']) requireMethod(driver, method);
  if (!config?.contractAddress || !config?.owner || !Array.isArray(config?.contacts) || !config.contacts.length || !config?.rescueDestination) {
    throw new TypeError('Native recovery proof requires contract, owner, contacts and rescue destination.');
  }
  const threshold = Number(config.threshold);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > config.contacts.length) throw new TypeError('Native recovery proof requires a valid contact threshold.');
  const nativeAmount = asBigInt(config.nativeAmount, 'nativeAmount');
  if (nativeAmount <= 0n) throw new TypeError('nativeAmount must be positive.');

  const actions = [];
  const before = await action(actions, 'state.before', () => driver.readState(config.contractAddress));
  const rescueBefore = await action(actions, 'rescue.balance.before', () => driver.readNativeBalance(config.rescueDestination));
  await action(actions, 'deposit.native', () => driver.depositNative({ contractAddress: config.contractAddress, actor: config.owner, amount: config.nativeAmount }));
  const afterDeposit = await action(actions, 'state.after-deposit', () => driver.readState(config.contractAddress));

  const vaultBefore = asBigInt(before?.balance ?? 0, 'state.before.balance');
  const vaultAfterDeposit = asBigInt(afterDeposit?.balance ?? 0, 'state.after-deposit.balance');
  if (vaultAfterDeposit - vaultBefore !== nativeAmount) throw new Error('Native deposit balance delta does not match requested proof amount.');

  for (const contact of config.contacts.slice(0, threshold)) {
    await action(actions, 'recovery.approve', () => driver.approveRecovery({ contractAddress: config.contractAddress, actor: contact }));
  }
  await action(actions, 'recovery.execute', () => driver.executeRecovery({ contractAddress: config.contractAddress, actor: config.executor ?? config.owner }));
  const after = await action(actions, 'state.after', () => driver.readState(config.contractAddress));
  const rescueAfter = await action(actions, 'rescue.balance.after', () => driver.readNativeBalance(config.rescueDestination));

  const rescueDelta = asBigInt(rescueAfter, 'rescue.balance.after') - asBigInt(rescueBefore, 'rescue.balance.before');
  const success = after?.recovered === true && asBigInt(after?.balance ?? 0, 'state.after.balance') === 0n && rescueDelta === vaultAfterDeposit;
  return Object.freeze({
    kind: 'evm-native-recovery-proof',
    success,
    before: structuredClone(before),
    afterDeposit: structuredClone(afterDeposit),
    after: structuredClone(after),
    rescueBefore: String(rescueBefore),
    rescueAfter: String(rescueAfter),
    rescueDelta: rescueDelta.toString(),
    ...proofBindingFields(binding),
    actions: Object.freeze(actions)
  });
}

export async function runEvmErc20RecoveryProof({ driver, config, binding = null }) {
  for (const method of ['readState', 'readTokenBalance', 'recoverErc20']) requireMethod(driver, method);
  if (!config?.contractAddress || !config?.tokenAddress || !config?.rescueDestination) throw new TypeError('ERC-20 proof requires contract, token and rescue destination.');
  const actions = [];
  const vaultState = await action(actions, 'state.before-token-recovery', () => driver.readState(config.contractAddress));
  if (vaultState?.recovered !== true) throw new Error('ERC-20 recovery proof requires the vault to already be recovered.');
  const vaultBefore = await action(actions, 'token.vault.before', () => driver.readTokenBalance(config.tokenAddress, config.contractAddress));
  const rescueBefore = await action(actions, 'token.rescue.before', () => driver.readTokenBalance(config.tokenAddress, config.rescueDestination));
  await action(actions, 'token.recover', () => driver.recoverErc20({ contractAddress: config.contractAddress, tokenAddress: config.tokenAddress, actor: config.executor }));
  const vaultAfter = await action(actions, 'token.vault.after', () => driver.readTokenBalance(config.tokenAddress, config.contractAddress));
  const rescueAfter = await action(actions, 'token.rescue.after', () => driver.readTokenBalance(config.tokenAddress, config.rescueDestination));
  const moved = asBigInt(rescueAfter, 'token.rescue.after') - asBigInt(rescueBefore, 'token.rescue.before');
  const success = asBigInt(vaultBefore, 'token.vault.before') > 0n && asBigInt(vaultAfter, 'token.vault.after') === 0n && moved === asBigInt(vaultBefore, 'token.vault.before');
  return Object.freeze({
    kind: 'evm-erc20-recovery-proof',
    success,
    vaultBefore: String(vaultBefore),
    vaultAfter: String(vaultAfter),
    rescueBefore: String(rescueBefore),
    rescueAfter: String(rescueAfter),
    moved: moved.toString(),
    ...proofBindingFields(binding),
    actions: Object.freeze(actions)
  });
}
