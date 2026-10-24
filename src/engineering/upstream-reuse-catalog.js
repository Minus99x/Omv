// Upstream reuse assessment only. Does not import/install/deploy any candidate.
// Licenses require confirmation against the exact release before redistribution.
const item = value => Object.freeze(value);
export const UPSTREAM_REUSE_CATALOG = Object.freeze([
  item({id:'stellar-sdk',packageName:'@stellar/stellar-sdk',pinned:'17.1.0',license:'Apache-2.0',decision:'already-integrated',ecosystem:'stellar',project:'https://github.com/stellar/js-stellar-sdk',seam:'src/chains/stellar/native-recovery.js',purpose:'Reuse official Stellar XDR and Horizon primitives'}),
  item({id:'cardano-serialization',packageName:'@emurgo/cardano-serialization-lib-nodejs',pinned:'17.0.0',license:'verify-package-metadata',decision:'already-integrated',ecosystem:'cardano',project:'https://github.com/Emurgo/cardano-serialization-lib',seam:'src/chains/cardano/transaction-body.js',purpose:'Reuse serializing Cardano transactions and Plutus data'}),
  item({id:'noble-curves',packageName:'@noble/curves',pinned:'2.4.0',license:'MIT',decision:'already-integrated',ecosystem:'bitcoin',project:'https://github.com/paulmillr/noble-curves',seam:'src/chains/bitcoin/descriptor.js',purpose:'Reuse audited secp256k1 building blocks'}),
  item({id:'aiken',packageName:'@aiken-lang/aiken',pinned:'1.1.24',license:'Apache-2.0',decision:'already-integrated',ecosystem:'cardano',project:'https://github.com/aiken-lang/aiken',seam:'programs',purpose:'Keep existing Cardano validator toolchain'}),
  item({id:'safe-protocol-kit',packageName:'@safe-global/protocol-kit',license:'MIT',decision:'evaluate',ecosystem:'evm',project:'https://github.com/safe-global/safe-core-sdk',seam:'src/chains/evm/adapter-factory.js',purpose:'Optional Safe account adapter, retaining OmegaVault inactivity policy'}),
  item({id:'openzeppelin',packageName:'@openzeppelin/contracts',license:'MIT',decision:'evaluate',ecosystem:'evm',project:'https://github.com/OpenZeppelin/openzeppelin-contracts',seam:'contracts/OmegaVaultRecoveryVaultV051.sol',purpose:'Standard access controls and safe token transfer primitives'}),
  item({id:'bitcoinjs',packageName:'bitcoinjs-lib',license:'MIT',decision:'evaluate',ecosystem:'bitcoin',project:'https://github.com/bitcoinjs/bitcoinjs-lib',seam:'test/bitcoin-transaction-finalizer.test.js',purpose:'Independent transaction and PSBTv0 verification only; do not assume PSBTv2/BIP370 support'}),
  item({id:'ledger-psbtv2',packageName:'@ledgerhq/psbtv2',license:'Apache-2.0',decision:'evaluate',ecosystem:'bitcoin',project:'https://github.com/LedgerHQ/ts-libs',seam:'test/bitcoin-descriptor-psbt-v2.test.js',purpose:'BIP370 PSBTv2 parser/serializer oracle candidate; review exact pinned tagged release and multisig support before use'}),
  item({id:'rust-psbt',packageName:null,license:'CC0-1.0',decision:'evaluate',ecosystem:'bitcoin',project:'https://github.com/rust-bitcoin/rust-psbt',seam:'test/bitcoin-descriptor-psbt-v2.test.js',purpose:'Independent BIP370 reference in isolated Rust test harness; do not add Rust requirement to production Node app'}),
  item({id:'lucid-evolution',packageName:'@lucid-evolution/lucid',license:'MIT',decision:'evaluate',ecosystem:'cardano',project:'https://github.com/Anastasia-Labs/lucid-evolution',seam:'src/chains/cardano/transaction-body.js',purpose:'Consider transaction-builder use only if existing Emurgo tooling is insufficient'}),
  item({id:'bdk-wallet',packageName:null,license:'MIT OR Apache-2.0',decision:'evaluate',ecosystem:'bitcoin',project:'https://github.com/bitcoindevkit/bdk_wallet',seam:'src/chains/bitcoin/descriptor.js',purpose:'Miniscript/descriptors/PSBT reference; Rust interoperability requires separate design'}),
  item({id:'safe-contracts',packageName:null,license:'LGPL-3.0',decision:'license-review',ecosystem:'evm',project:'https://github.com/safe-fndn/safe-smart-account',seam:'contracts/OmegaVaultRecoveryVaultV051.sol',purpose:'Potential EVM account substrate; requires design migration and license review'}),
  item({id:'safe-recovery',packageName:null,license:'LGPL-3.0',decision:'license-review',ecosystem:'evm',project:'https://github.com/safe-fndn/safe-modules',seam:'contracts/OmegaVaultRecoveryVaultV051.sol',purpose:'Recovery reference, not a replacement for owner heartbeat and threshold'}),
  item({id:'zodiac-delay',packageName:null,license:'LGPL-3.0+',decision:'license-review',ecosystem:'evm',project:'https://github.com/gnosisguild/zodiac-modifier-delay',seam:'contracts/OmegaVaultRecoveryVaultV051.sol',purpose:'Queued delay/veto design; not equivalent to inactivity heartbeat'})
]);
export const OMEGAVAULT_DIFFERENTIATORS = Object.freeze([
  'owner-signed heartbeat with approval reset',
  'threshold trusted-contact recovery after inactivity',
  'immutable rescue destination and per-chain recovery invariants',
  'cross-chain evidence provenance and precise maturity claims',
  'non-custodial coordination without custodial wallet secrets'
]);
export function inspectReuseCatalog({dependencies={},devDependencies={}}={}) {
  const issues=[],ids=new Set(),packages=new Set();
  for (const entry of UPSTREAM_REUSE_CATALOG) {
    if(ids.has(entry.id)) issues.push('Duplicate upstream id: '+entry.id);
    ids.add(entry.id);
    if(!['already-integrated','evaluate','license-review'].includes(entry.decision)) issues.push('Invalid decision: '+entry.id);
    if(!entry.seam || !entry.purpose || !/^https:\/\/github\.com\//.test(entry.project)) issues.push('Missing provenance: '+entry.id);
    if(entry.decision==='license-review' && !/^LGPL-/.test(entry.license)) issues.push('Missing license review: '+entry.id);
    if(entry.packageName) {
      if(packages.has(entry.packageName)) issues.push('Duplicate package: '+entry.packageName);
      packages.add(entry.packageName);
      const installed=dependencies[entry.packageName]??devDependencies[entry.packageName];
      if(entry.decision==='already-integrated' && installed!==entry.pinned) issues.push('Existing '+entry.packageName+' must match pinned '+entry.pinned+'; found '+(installed??'absent'));
      if(entry.decision!=='already-integrated' && installed!==undefined) issues.push('Unreviewed upstream adoption: '+entry.packageName);
    }
  }
  return Object.freeze({ok:issues.length===0,issues:Object.freeze(issues),existing:UPSTREAM_REUSE_CATALOG.filter(v=>v.decision==='already-integrated').length,candidates:UPSTREAM_REUSE_CATALOG.filter(v=>v.decision==='evaluate').length,licenseReview:UPSTREAM_REUSE_CATALOG.filter(v=>v.decision==='license-review').length});
}
