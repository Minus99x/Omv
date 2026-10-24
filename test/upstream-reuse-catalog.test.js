import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  UPSTREAM_REUSE_CATALOG,
  OMEGAVAULT_DIFFERENTIATORS,
  inspectReuseCatalog
} from '../src/engineering/upstream-reuse-catalog.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const installed = Object.freeze({
  dependencies: packageJson.dependencies,
  devDependencies: packageJson.devDependencies
});

test('reuse gate matches installed exact-version dependencies and records candidates without importing them', () => {
  const report = inspectReuseCatalog(installed);
  assert.deepEqual(report.issues, []);
  assert.equal(report.ok, true);
  assert.equal(report.existing, 4);
  assert.equal(report.candidates, 7);
  assert.equal(report.licenseReview, 3);

  const ids = new Set();
  for (const entry of UPSTREAM_REUSE_CATALOG) {
    assert.equal(ids.has(entry.id), false, 'duplicate id: ' + entry.id);
    ids.add(entry.id);
    assert.ok(entry.project.startsWith('https://github.com/'));
    assert.ok(entry.seam && entry.purpose && entry.license);
    if (entry.decision !== 'already-integrated' && entry.packageName) {
      assert.equal(packageJson.dependencies?.[entry.packageName], undefined);
      assert.equal(packageJson.devDependencies?.[entry.packageName], undefined);
    }
  }
});

test('reuse gate rejects a missing or drifted existing dependency pin', () => {
  const modified = structuredClone(installed);
  modified.dependencies['@stellar/stellar-sdk'] = '^17.1.0';
  let report = inspectReuseCatalog(modified);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some(issue => issue.includes('@stellar/stellar-sdk')));

  delete modified.dependencies['@emurgo/cardano-serialization-lib-nodejs'];
  report = inspectReuseCatalog(modified);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some(issue => issue.includes('@emurgo/cardano-serialization-lib-nodejs')));
});

test('reuse gate requires explicit review if a candidate is installed', () => {
  const modified = structuredClone(installed);
  modified.dependencies['@openzeppelin/contracts'] = '5.4.0';
  modified.dependencies['@safe-global/protocol-kit'] = '6.0.0';
  const report = inspectReuseCatalog(modified);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some(issue => issue.includes('@openzeppelin/contracts')));
  assert.ok(report.issues.some(issue => issue.includes('@safe-global/protocol-kit')));
});

test('reuse catalog keeps OmegaVault policy distinct from ordinary wallet SDK primitives', () => {
  assert.ok(OMEGAVAULT_DIFFERENTIATORS.some(value => value.includes('heartbeat')));
  assert.ok(OMEGAVAULT_DIFFERENTIATORS.some(value => value.includes('trusted-contact')));
  assert.ok(OMEGAVAULT_DIFFERENTIATORS.some(value => value.includes('cross-chain')));
  assert.ok(OMEGAVAULT_DIFFERENTIATORS.some(value => value.includes('non-custodial')));
  assert.ok(UPSTREAM_REUSE_CATALOG.filter(x => x.decision === 'license-review').every(x => x.license.startsWith('LGPL-')));
});


test('Bitcoin PSBTv2 candidates explicitly distinguish BIP370 from bitcoinjs PSBTv0', () => {
  const byId = new Map(UPSTREAM_REUSE_CATALOG.map(item => [item.id, item]));
  const ledger = byId.get('ledger-psbtv2');
  const rust = byId.get('rust-psbt');
  const bitcoinjs = byId.get('bitcoinjs');
  assert.equal(ledger.packageName, '@ledgerhq/psbtv2');
  assert.equal(ledger.license, 'Apache-2.0');
  assert.equal(ledger.decision, 'evaluate');
  assert.match(ledger.purpose, /BIP370/);
  assert.equal(rust.license, 'CC0-1.0');
  assert.match(rust.purpose, /BIP370/);
  assert.match(bitcoinjs.purpose, /PSBTv0/);
  assert.match(bitcoinjs.purpose, /do not assume PSBTv2/i);
  assert.equal(packageJson.dependencies?.['@ledgerhq/psbtv2'], undefined);
});

test('PSBTv2 upstream may not be silently installed before explicit review', () => {
  const modified = structuredClone(installed);
  modified.dependencies['@ledgerhq/psbtv2'] = '0.6.2';
  const report = inspectReuseCatalog(modified);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some(issue => issue.includes('@ledgerhq/psbtv2')));
});
