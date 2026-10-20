import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Static job-boundary guard. The workflow itself is executed by GitHub Actions;
// this test keeps later refactors from making unrelated chain verification depend
// on an early Cardano failure or accidentally bypassing failing security gates.
const workflow = readFileSync(new URL('../.github/workflows/dev-verification.yml', import.meta.url), 'utf8');

function jobBody(name) {
  const entries = [...workflow.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)];
  const index = entries.findIndex(entry => entry[1] === name);
  assert.ok(index >= 0, name + ' must remain an independent GitHub Actions job');
  const beginning = entries[index].index;
  const end = index + 1 < entries.length ? entries[index+1].index : workflow.length;
  return workflow.slice(beginning, end);
}

test('Cardano Scalus, Bitcoin and Stellar run independent jobs with no masked failures', () => {
  const commands = {
    'cardano-scalus-independent':['npm ci', 'scalus@1.3.0', 'npm run test:cardano:scalus'],
    'bitcoin-independent':['npm ci', 'npm run test:bitcoin-recovery', 'npm run test:bitcoin-native', 'npm run test:bitcoin-signet-cli'],
    'stellar-independent':['npm ci', 'npm run test:stellar-recovery', 'npm run test:stellar-native']
  };
  for (const [name, required] of Object.entries(commands)) {
    const body = jobBody(name);
    assert.doesNotMatch(body, /^\s+needs:/m, name + ' must not depend on another chain');
    assert.doesNotMatch(body, /^\s+continue-on-error:/m, name + ' may not mask a failing verification');
    assert.match(body, /runs-on:\s*ubuntu-latest/);
    for (const command of required) assert.ok(body.includes(command), name + ' must retain ' + command);
  }
});

test('existing complete OmegaVault verification remains a required, unmasked CI job', () => {
  assert.match(workflow, /push:[\s\S]*?branches:[\s\S]*?'dev\/\*\*'/);
  const body = jobBody('verify');
  for (const command of ['npm run test:cardano:scalus','npm run test:bitcoin-recovery',
    'npm run test:stellar-recovery','npm test','npm run check']) {
    assert.ok(body.includes(command), 'complete verification must retain ' + command);
  }
  assert.doesNotMatch(body, /^\s+continue-on-error:/m);
});
