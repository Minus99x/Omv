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

export async function runEvmNativeRecoveryProof({ driver, config }) {
  for (const method of ['readState', 'depositNative', 'approveRecovery', 'executeRecovery']) requireMethod(driver, method);
  if (!config?.contractAddress || !config?.owner || !Array.isArray(config?.contacts) || !config.contacts.length || !config?.rescueDestination) {
    throw new TypeError('Native recovery proof requires contract, owner, contacts and rescue destination.');
  }
  const actions = [];
  const before = await action(actions, 'state.before', () => driver.readState(config.contractAddress));
  await action(actions, 'deposit.native', () => driver.depositNative({ contractAddress: config.contractAddress, actor: config.owner, amount: config.nativeAmount }));
  for (const contact of config.contacts.slice(0, config.threshold)) {
    await action(actions, 'recovery.approve', () => driver.approveRecovery({ contractAddress: config.contractAddress, actor: contact }));
  }
  await action(actions, 'recovery.execute', () => driver.executeRecovery({ contractAddress: config.contractAddress, actor: config.executor ?? config.owner }));
  const after = await action(actions, 'state.after', () => driver.readState(config.contractAddress));
  const rescueBalance = typeof driver.readNativeBalance === 'function'
    ? await action(actions, 'rescue.balance', () => driver.readNativeBalance(config.rescueDestination))
    : null;
  const success = after?.recovered === true && BigInt(after?.balance ?? 0) === 0n;
  return Object.freeze({ kind: 'evm-native-recovery-proof', success, before: structuredClone(before), after: structuredClone(after), rescueBalance: structuredClone(rescueBalance), actions: Object.freeze(actions) });
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
