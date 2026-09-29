import {
  makeDeploymentData,
  methodData,
  methodDataWithAddress,
  parseEther,
  toHexQuantity,
  decodeUintWord,
  decodeBoolWord,
  decodeAddressWord,
  runtimeBytecodeMatches
} from './evm-codec.js';

const SEPOLIA_CHAIN_ID = '0xaa36a7';
const ADAPTER_VERSION_NUMBER = 400;

function normalizeAddress(value) {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function friendlyWalletError(error) {
  const message = String(error?.message || error || 'Wallet request failed.');
  if (error?.code === 4001) return new Error('The wallet request was rejected. No transaction was sent.');
  if (error?.code === 4902) return new Error('Sepolia is not configured in this wallet. Enable or add the Sepolia test network, then retry.');
  if (/insufficient funds/i.test(message)) return new Error('This wallet does not have enough Sepolia ETH for the transaction and gas.');
  if (/user rejected|denied transaction/i.test(message)) return new Error('The wallet request was rejected. No transaction was sent.');
  if (/nonce too low/i.test(message)) return new Error('The wallet reported an outdated nonce. Refresh the wallet and try again.');
  if (/replacement transaction underpriced/i.test(message)) return new Error('The wallet is already tracking a transaction with this nonce. Wait for it to settle, then retry.');
  return error instanceof Error ? error : new Error(message);
}

async function rpc(method, params = []) {
  if (!window.ethereum?.request) throw new Error('No injected Ethereum wallet was detected.');
  try {
    return await window.ethereum.request({ method, params });
  } catch (error) {
    throw friendlyWalletError(error);
  }
}

export const ethereumAdapter = {
  id: 'ethereum',
  family: 'evm',
  version: '0.4.0',
  displayName: 'Ethereum',
  testNetwork: { id: SEPOLIA_CHAIN_ID, label: 'Sepolia' },

  available() {
    return Boolean(window.ethereum?.request);
  },

  async connectedAccounts() {
    const accounts = await rpc('eth_accounts');
    return (accounts ?? []).map(normalizeAddress);
  },

  async requestAccountAccess() {
    try {
      await rpc('wallet_requestPermissions', [{ eth_accounts: {} }]);
    } catch (error) {
      const message = String(error?.message || '');
      if (/method.*not found|unsupported|does not exist/i.test(message)) await rpc('eth_requestAccounts');
      else throw error;
    }
    return this.connectedAccounts();
  },

  async connectAccount() {
    const accounts = await rpc('eth_requestAccounts');
    const account = accounts?.[0];
    if (!account) throw new Error('Wallet did not return an account.');
    return normalizeAddress(account);
  },

  async currentAccount() {
    const accounts = await this.connectedAccounts();
    return accounts?.[0] ?? null;
  },

  async network() {
    const chainId = await rpc('eth_chainId');
    const labels = {
      '0x1': 'Ethereum Mainnet',
      [SEPOLIA_CHAIN_ID]: 'Sepolia'
    };
    return {
      id: chainId,
      label: labels[chainId] ?? 'Ethereum network',
      isTestnet: chainId !== '0x1',
      isSepolia: chainId === SEPOLIA_CHAIN_ID
    };
  },

  async switchToSepolia() {
    await rpc('wallet_switchEthereumChain', [{ chainId: SEPOLIA_CHAIN_ID }]);
    return this.network();
  },

  async readNativeBalanceWei(account) {
    return BigInt(await rpc('eth_getBalance', [account, 'latest']));
  },

  async readNativeBalance(account) {
    const wei = await this.readNativeBalanceWei(account);
    const whole = wei / 10n ** 18n;
    const fraction = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, 5);
    return `${whole}.${fraction} ETH`;
  },

  async preflight({ requireSepolia = true, minimumWei = 0n, actor = null } = {}) {
    const accounts = await this.connectedAccounts();
    const account = normalizeAddress(actor ?? accounts?.[0] ?? null);
    if (!account) throw new Error('Grant OmegaVault access to a signing account before continuing.');
    if (!accounts.some(value => value === account)) throw new Error(`MetaMask has not granted OmegaVault access to ${account}. Use “Authorize test roles” once and select the required accounts.`);
    const network = await this.network();
    if (requireSepolia && !network.isSepolia) throw new Error(`Wallet is on ${network.label}. Switch to Sepolia before continuing.`);
    const balanceWei = await this.readNativeBalanceWei(account);
    if (balanceWei < BigInt(minimumWei)) throw new Error(`Signing account ${account} does not have enough Sepolia ETH for this step.`);
    return { account, network, balanceWei, accounts };
  },

  async signControlProof(account, nonce) {
    const message = [
      'OmegaVault activation proof',
      'Chain: ethereum',
      `Account: ${account}`,
      `Nonce: ${nonce}`,
      'No private key or seed phrase is being shared.'
    ].join('\n');
    const signature = await rpc('personal_sign', [message, account]);
    return { message, signature };
  },

  async sendTransaction(transaction) {
    return rpc('eth_sendTransaction', [transaction]);
  },

  async waitForReceipt(txHash, { timeoutMs = 180_000, pollMs = 2_500 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const receipt = await rpc('eth_getTransactionReceipt', [txHash]);
      if (receipt) {
        if (receipt.status === '0x0') throw new Error(`Transaction ${txHash} reverted.`);
        return receipt;
      }
      await sleep(pollMs);
    }
    throw new Error(`Transaction ${txHash} was submitted but was not confirmed before the local timeout. The transaction may still confirm; check the hash before retrying.`);
  },

  async deployRecoveryVault({ artifact, policy, inactivitySeconds }) {
    if (policy.trustedContacts.length > 32) throw new Error('The Ethereum proof adapter supports at most 32 trusted contacts.');
    const { account: from, network } = await this.preflight({ requireSepolia: true, actor: policy.owner });
    if (normalizeAddress(policy.owner) !== from) throw new Error('The connected wallet must be the vault owner to deploy this proof contract.');

    const data = makeDeploymentData(artifact.bytecode, {
      trustedContacts: policy.trustedContacts,
      threshold: policy.threshold,
      inactivitySeconds,
      rescueDestination: policy.rescueDestination
    });
    const transaction = { from, data, value: '0x0' };
    await this.estimateTransaction(transaction);
    const txHash = await this.sendTransaction(transaction);
    const receipt = await this.waitForReceipt(txHash);
    if (!receipt.contractAddress) throw new Error('Deployment confirmed without a contract address.');
    return {
      txHash,
      contractAddress: normalizeAddress(receipt.contractAddress),
      receipt,
      network,
      actor: from
    };
  },

  async estimateTransaction(transaction) {
    return BigInt(await rpc('eth_estimateGas', [transaction]));
  },

  async sendContractAction({ contractAddress, artifact, signature, actor = null }) {
    const { account: from } = await this.preflight({ requireSepolia: true, actor });
    const data = methodData(artifact.methodIdentifiers, signature);
    const transaction = { from, to: contractAddress, data, value: '0x0' };
    await this.estimateTransaction(transaction);
    const txHash = await this.sendTransaction(transaction);
    const receipt = await this.waitForReceipt(txHash);
    return { txHash, receipt, actor: from };
  },

  async depositTestEth({ contractAddress, amountEth, actor = null }) {
    const { account: from, balanceWei } = await this.preflight({ requireSepolia: true, actor });
    const amountWei = parseEther(amountEth);
    if (amountWei === 0n) throw new Error('Deposit amount must be greater than zero.');
    if (amountWei >= balanceWei) throw new Error('Leave some Sepolia ETH in the wallet for gas; deposit less than the wallet balance.');
    const transaction = { from, to: contractAddress, value: toHexQuantity(amountWei) };
    await this.estimateTransaction(transaction);
    const txHash = await this.sendTransaction(transaction);
    const receipt = await this.waitForReceipt(txHash);
    return { txHash, receipt, actor: from, amountWei };
  },

  async fundTestAccount({ to, amountEth, actor = null }) {
    const { account: from, balanceWei } = await this.preflight({ requireSepolia: true, actor });
    const recipient = normalizeAddress(to);
    if (!/^0x[a-f0-9]{40}$/.test(recipient || '')) throw new Error('Test funding recipient is not a valid Ethereum address.');
    const amountWei = parseEther(amountEth);
    if (amountWei === 0n) throw new Error('Test funding amount must be greater than zero.');
    if (amountWei >= balanceWei) throw new Error('Leave Sepolia ETH in the owner wallet for gas and remaining test steps.');
    const transaction = { from, to: recipient, value: toHexQuantity(amountWei) };
    await this.estimateTransaction(transaction);
    const txHash = await this.sendTransaction(transaction);
    const receipt = await this.waitForReceipt(txHash);
    return { txHash, receipt, actor: from, recipient, amountWei };
  },

  async topUpTestAccount({ to, targetEth, actor = null }) {
    const recipient = normalizeAddress(to);
    if (!/^0x[a-f0-9]{40}$/.test(recipient || '')) throw new Error('Test funding recipient is not a valid Ethereum address.');
    const targetWei = parseEther(targetEth);
    const currentWei = await this.readNativeBalanceWei(recipient);
    if (currentWei >= targetWei) return { skipped: true, recipient, currentWei, targetWei, amountWei: 0n };
    const amountWei = targetWei - currentWei;
    const { account: from, balanceWei } = await this.preflight({ requireSepolia: true, actor });
    if (amountWei >= balanceWei) throw new Error('Owner does not have enough Sepolia ETH to top up this contact and leave gas.');
    const transaction = { from, to: recipient, value: toHexQuantity(amountWei) };
    await this.estimateTransaction(transaction);
    const txHash = await this.sendTransaction(transaction);
    const receipt = await this.waitForReceipt(txHash);
    return { skipped: false, txHash, receipt, actor: from, recipient, currentWei, targetWei, amountWei };
  },

  async callContract({ contractAddress, artifact, signature, addressArg = null }) {
    const data = addressArg == null
      ? methodData(artifact.methodIdentifiers, signature)
      : methodDataWithAddress(artifact.methodIdentifiers, signature, addressArg);
    return rpc('eth_call', [{ to: contractAddress, data }, 'latest']);
  },

  async readRecoveryState({ contractAddress, artifact }) {
    const [ownerRaw, destinationRaw, thresholdRaw, approvalsRaw, heartbeatRaw, inactivityRaw, eligibleRaw, recoveredRaw, adapterVersionRaw, balanceRaw, code] = await Promise.all([
      this.callContract({ contractAddress, artifact, signature: 'owner()' }),
      this.callContract({ contractAddress, artifact, signature: 'rescueDestination()' }),
      this.callContract({ contractAddress, artifact, signature: 'threshold()' }),
      this.callContract({ contractAddress, artifact, signature: 'approvalCount()' }),
      this.callContract({ contractAddress, artifact, signature: 'lastHeartbeat()' }),
      this.callContract({ contractAddress, artifact, signature: 'inactivityPeriod()' }),
      this.callContract({ contractAddress, artifact, signature: 'secondsUntilEligible()' }),
      this.callContract({ contractAddress, artifact, signature: 'recovered()' }),
      this.callContract({ contractAddress, artifact, signature: 'ADAPTER_VERSION()' }),
      rpc('eth_getBalance', [contractAddress, 'latest']),
      rpc('eth_getCode', [contractAddress, 'latest'])
    ]);
    if (!code || code === '0x') throw new Error('No contract code exists at the bound address on the current network.');
    return {
      owner: decodeAddressWord(ownerRaw),
      rescueDestination: decodeAddressWord(destinationRaw),
      threshold: Number(decodeUintWord(thresholdRaw)),
      approvalCount: Number(decodeUintWord(approvalsRaw)),
      lastHeartbeat: Number(decodeUintWord(heartbeatRaw)),
      inactivityPeriod: Number(decodeUintWord(inactivityRaw)),
      secondsUntilEligible: Number(decodeUintWord(eligibleRaw)),
      recovered: decodeBoolWord(recoveredRaw),
      adapterVersion: Number(decodeUintWord(adapterVersionRaw)),
      balanceWei: BigInt(balanceRaw),
      code
    };
  },

  async readApprovalStatuses({ contractAddress, artifact, contacts }) {
    const statuses = [];
    for (const contact of contacts ?? []) {
      const raw = await this.callContract({ contractAddress, artifact, signature: 'approved(address)', addressArg: contact });
      statuses.push({ contact: normalizeAddress(contact), approved: decodeBoolWord(raw) });
    }
    return statuses;
  },

  async verifyDeployment({ contractAddress, artifact, policy, inactivitySeconds }) {
    const network = await this.network();
    if (!network.isSepolia) throw new Error('Deployment verification must run on Sepolia.');
    const state = await this.readRecoveryState({ contractAddress, artifact });
    const contactChecks = await Promise.all(policy.trustedContacts.map(async contact => {
      const raw = await this.callContract({ contractAddress, artifact, signature: 'isTrustedContact(address)', addressArg: contact });
      return { contact: normalizeAddress(contact), configured: decodeBoolWord(raw) };
    }));

    const checks = {
      networkSepolia: network.id === SEPOLIA_CHAIN_ID,
      runtimeCodeMatched: runtimeBytecodeMatches(artifact.deployedBytecode, state.code, artifact.immutableReferences),
      ownerMatched: state.owner === normalizeAddress(policy.owner),
      destinationMatched: state.rescueDestination === normalizeAddress(policy.rescueDestination),
      thresholdMatched: state.threshold === Number(policy.threshold),
      inactivityMatched: state.inactivityPeriod === Number(inactivitySeconds),
      adapterVersionMatched: state.adapterVersion === ADAPTER_VERSION_NUMBER,
      trustedContactsMatched: contactChecks.every(item => item.configured)
    };
    const verified = Object.values(checks).every(Boolean);
    return { verified, checks, state, contactChecks };
  },

  onAccountChanged(handler) {
    window.ethereum?.on?.('accountsChanged', handler);
  },

  onNetworkChanged(handler) {
    window.ethereum?.on?.('chainChanged', handler);
  }
};
