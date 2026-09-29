/* OmegaVault local compiler worker. The compiler itself is served same-origin by
 * the OmegaVault server from a pinned Solidity 0.8.24 URL and cached locally. */
self.onmessage = async (event) => {
  try {
    const { source } = event.data ?? {};
    if (!source) throw new Error('No Solidity source supplied to compiler worker.');

    if (!self.Module) {
      importScripts('/vendor/solc-0.8.24.js');
    }
    if (!self.Module?.cwrap) throw new Error('Solidity compiler module did not initialize.');

    const version = self.Module.cwrap('solidity_version', 'string', [])();
    const compile = self.Module.cwrap('solidity_compile', 'string', ['string', 'number', 'number']);
    const reset = self.Module._solidity_reset ? self.Module.cwrap('solidity_reset', null, []) : null;

    const input = {
      language: 'Solidity',
      sources: { 'OmegaVaultRecoveryVault.sol': { content: source } },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        outputSelection: {
          '*': {
            '*': [
              'abi',
              'evm.bytecode.object',
              'evm.deployedBytecode.object',
              'evm.deployedBytecode.immutableReferences',
              'evm.methodIdentifiers'
            ]
          }
        }
      }
    };

    let raw;
    try {
      raw = compile(JSON.stringify(input), 0, 0);
    } finally {
      reset?.();
    }
    const output = JSON.parse(raw);
    const fatal = (output.errors ?? []).filter(item => item.severity === 'error');
    if (fatal.length) throw new Error(fatal.map(item => item.formattedMessage || item.message).join('\n'));
    const artifact = output.contracts?.['OmegaVaultRecoveryVault.sol']?.OmegaVaultRecoveryVault;
    if (!artifact?.evm?.bytecode?.object) throw new Error('Compiler did not return deployment bytecode.');

    self.postMessage({
      ok: true,
      artifact: {
        compilerVersion: version,
        abi: artifact.abi,
        bytecode: artifact.evm.bytecode.object,
        deployedBytecode: artifact.evm.deployedBytecode.object,
        immutableReferences: artifact.evm.deployedBytecode.immutableReferences ?? {},
        methodIdentifiers: artifact.evm.methodIdentifiers,
        warnings: (output.errors ?? []).filter(item => item.severity !== 'error').map(item => item.formattedMessage || item.message)
      }
    });
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || String(error) });
  }
};
