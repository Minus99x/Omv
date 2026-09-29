const ASSET_KINDS = new Set(['native', 'fungible-token']);

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeEvmAddress(value) {
  const text = clean(value);
  return typeof text === 'string' ? text.toLowerCase() : text;
}

export function canonicalAssetId(asset) {
  const chainId = clean(asset?.chainId);
  const networkRef = clean(asset?.networkRef);
  const kind = clean(asset?.kind);
  if (!chainId || !networkRef || !kind) throw new TypeError('Asset chainId, networkRef, and kind are required.');
  if (kind === 'native') return `${chainId}:${networkRef}:native`;
  const reference = chainId === 'ethereum' || chainId === 'xdc'
    ? normalizeEvmAddress(asset?.assetRef)
    : clean(asset?.assetRef);
  if (!reference) throw new TypeError('Token assets require an assetRef.');
  return `${chainId}:${networkRef}:${kind}:${reference}`;
}

export function defineAsset(input) {
  const chainId = clean(input?.chainId);
  const networkRef = clean(input?.networkRef);
  const kind = clean(input?.kind);
  if (!chainId || !networkRef) throw new TypeError('Asset chainId and networkRef are required.');
  if (!ASSET_KINDS.has(kind)) throw new TypeError('Unsupported asset kind.');

  let assetRef = clean(input?.assetRef) || null;
  if (kind === 'native' && assetRef) throw new TypeError('Native assets must not define assetRef.');
  if (kind === 'fungible-token' && !assetRef) throw new TypeError('Fungible-token assets require assetRef.');
  if ((chainId === 'ethereum' || chainId === 'xdc') && assetRef) {
    assetRef = normalizeEvmAddress(assetRef);
    if (!/^0x[a-f0-9]{40}$/.test(assetRef)) throw new TypeError('EVM token assetRef must be a 20-byte address.');
  }

  const decimals = input?.decimals == null ? null : Number(input.decimals);
  if (decimals != null && (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)) {
    throw new TypeError('Asset decimals must be an integer from 0 to 255.');
  }

  const asset = {
    chainId,
    networkRef,
    kind,
    assetRef,
    symbol: clean(input?.symbol) || null,
    name: clean(input?.name) || null,
    decimals,
    identityVerified: input?.identityVerified === true,
    recoveryStage: clean(input?.recoveryStage) || 'catalogued'
  };
  return Object.freeze({ ...asset, id: canonicalAssetId(asset) });
}

export function publicAsset(asset) {
  return structuredClone(asset);
}
