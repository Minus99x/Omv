function normalizeAddress(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export function defineErc20Asset({ chainId, networkRef, address, symbol = null, name = null, decimals = null, identityVerified = false }) {
  const assetRef = normalizeAddress(address);
  if (!/^0x[a-f0-9]{40}$/.test(assetRef || '') || assetRef==='0x'+'0'.repeat(40))
    throw new TypeError('ERC-20 address is invalid.');
  if (typeof chainId!=='string'||!chainId.trim()||typeof networkRef!=='string'||!networkRef.trim())
    throw new TypeError('ERC-20 asset requires primitive chain and network identity.');
  if (decimals!=null && (!Number.isInteger(decimals)||decimals<0||decimals>255))
    throw new TypeError('ERC-20 decimals must be a uint8 integer.');
  for (const [label,value] of [['symbol',symbol],['name',name]]) {
    if(value!=null&&(typeof value!=='string'||!value.trim()))
      throw new TypeError(`ERC-20 ${label} must be non-empty primitive text.`);
  }
  return Object.freeze({
    chainId,
    networkRef,
    kind: 'fungible-token',
    assetRef,
    symbol,
    name,
    decimals,
    identityVerified: identityVerified === true,
    recoveryStage: 'development'
  });
}

export function erc20RecoveryAction({ chainId = 'ethereum', networkRef, vaultContract, tokenAddress, requiredSigner, feePayer = requiredSigner, sponsorMode = 'self-funded' }) {
  const token = normalizeAddress(tokenAddress);
  const contract = normalizeAddress(vaultContract);
  if (!/^0x[a-f0-9]{40}$/.test(token || '')) throw new TypeError('ERC-20 token address is invalid.');
  if (!/^0x[a-f0-9]{40}$/.test(contract || '')) throw new TypeError('Vault contract address is invalid.');
  return Object.freeze({
    chainId,
    networkRef,
    operation: 'erc20.recover',
    requiredSigner: normalizeAddress(requiredSigner),
    feePayer: normalizeAddress(feePayer),
    sponsorMode,
    destination: contract,
    transactionTemplate: {
      to: contract,
      method: 'recoverERC20(address)',
      args: [token],
      value: '0x0'
    }
  });
}
