function requireMethod(driver, name) {
  if (typeof driver?.[name] !== 'function') throw new TypeError(`TRON TVM recovery test driver requires ${name}().`);
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

function assertTransaction(result, operation) {
  if (!result?.txId) throw new Error(`${operation} did not return a txId.`);
  return result.txId;
}

async function transact(actions, driver, operation, submit) {
  const submitted = await action(actions, `${operation}.submit`, submit);
  const txId = assertTransaction(submitted, operation);
  const receipt = await action(actions, `${operation}.solidify`, () => driver.waitForSolidification(txId));
  if (receipt?.solidified !== true || receipt?.result !== 'SUCCESS') throw new Error(`${operation} was not solidified successfully.`);
  return Object.freeze({ submitted, receipt });
}

function validateConfig(config) {
  if (!config?.contractAddress || !config?.owner || !Array.isArray(config?.contacts) || !config.contacts.length || !config?.rescueDestination) {
    throw new TypeError('TRON TVM recovery proof requires contract, owner, contacts and rescue destination.');
  }
  if (!Number.isInteger(config.threshold) || config.threshold < 1 || config.threshold > config.contacts.length) throw new TypeError('TRON TVM threshold must be reachable.');
}

export async function runTronTrxRecoveryProof({ driver, config, deploymentVerification }) {
  for (const method of ['getChainParameters', 'getAccountResources', 'estimateEnergy', 'readState', 'depositTrx', 'approveRecovery', 'executeRecovery', 'waitForSolidification', 'readTrxBalance']) requireMethod(driver, method);
  validateConfig(config);
  if (deploymentVerification?.verified !== true) throw new Error('TRON TVM deployment verification gate is not satisfied.');
  const actions = [];
  const chainParameters = await action(actions, 'preflight.chain-parameters', () => driver.getChainParameters());
  const resources = await action(actions, 'preflight.account-resources', () => driver.getAccountResources(config.owner));
  const before = await action(actions, 'state.before', () => driver.readState(config.contractAddress));
  await action(actions, 'preflight.deposit', () => driver.estimateEnergy({ operation: 'depositTrx', contractAddress: config.contractAddress, actor: config.owner }));
  await transact(actions, driver, 'deposit.trx', () => driver.depositTrx({ contractAddress: config.contractAddress, actor: config.owner, amountSun: config.amountSun }));
  for (const contact of config.contacts.slice(0, config.threshold)) {
    await action(actions, 'preflight.approve', () => driver.estimateEnergy({ operation: 'approveRecovery', contractAddress: config.contractAddress, actor: contact }));
    await transact(actions, driver, 'recovery.approve', () => driver.approveRecovery({ contractAddress: config.contractAddress, actor: contact }));
  }
  await action(actions, 'preflight.execute', () => driver.estimateEnergy({ operation: 'executeRecovery', contractAddress: config.contractAddress, actor: config.executor ?? config.owner }));
  await transact(actions, driver, 'recovery.execute', () => driver.executeRecovery({ contractAddress: config.contractAddress, actor: config.executor ?? config.owner }));
  const after = await action(actions, 'state.after', () => driver.readState(config.contractAddress));
  const rescueBalance = await action(actions, 'rescue.balance', () => driver.readTrxBalance(config.rescueDestination));
  const success = before?.recovered === false && after?.recovered === true && BigInt(after?.balanceSun ?? -1) === 0n;
  return Object.freeze({ kind: 'tron-tvm-trx-recovery-proof', success, deploymentVerificationSha256: deploymentVerification.sha256, chainParameters: structuredClone(chainParameters), resources: structuredClone(resources), before: structuredClone(before), after: structuredClone(after), rescueBalance: String(rescueBalance), actions: Object.freeze(actions) });
}

export async function runTronTrc20RecoveryProof({ driver, config, deploymentVerification }) {
  for (const method of ['estimateEnergy', 'readTrc20Balance', 'recoverTrc20', 'waitForSolidification']) requireMethod(driver, method);
  if (!config?.contractAddress || !config?.tokenAddress || !config?.rescueDestination) throw new TypeError('TRC-20 proof requires contract, token and rescue destination.');
  if (deploymentVerification?.verified !== true) throw new Error('TRON TVM deployment verification gate is not satisfied.');
  const actions = [];
  const vaultBefore = await action(actions, 'token.vault.before', () => driver.readTrc20Balance(config.tokenAddress, config.contractAddress));
  const rescueBefore = await action(actions, 'token.rescue.before', () => driver.readTrc20Balance(config.tokenAddress, config.rescueDestination));
  await action(actions, 'preflight.trc20-recover', () => driver.estimateEnergy({ operation: 'recoverTRC20', contractAddress: config.contractAddress, tokenAddress: config.tokenAddress, actor: config.executor }));
  await transact(actions, driver, 'token.recover', () => driver.recoverTrc20({ contractAddress: config.contractAddress, tokenAddress: config.tokenAddress, actor: config.executor }));
  const vaultAfter = await action(actions, 'token.vault.after', () => driver.readTrc20Balance(config.tokenAddress, config.contractAddress));
  const rescueAfter = await action(actions, 'token.rescue.after', () => driver.readTrc20Balance(config.tokenAddress, config.rescueDestination));
  const moved = BigInt(rescueAfter) - BigInt(rescueBefore);
  const success = BigInt(vaultBefore) > 0n && BigInt(vaultAfter) === 0n && moved === BigInt(vaultBefore);
  return Object.freeze({ kind: 'tron-tvm-trc20-recovery-proof', success, deploymentVerificationSha256: deploymentVerification.sha256, vaultBefore: String(vaultBefore), vaultAfter: String(vaultAfter), rescueBefore: String(rescueBefore), rescueAfter: String(rescueAfter), actions: Object.freeze(actions) });
}
