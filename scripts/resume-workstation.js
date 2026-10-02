import { spawnSync } from 'node:child_process';
import process from 'node:process';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`OmegaVault requires Node.js >=22.12; found ${process.versions.node}.`);
  process.exit(1);
}

if (process.argv.includes('--check-runtime')) {
  console.log(`OmegaVault Node.js runtime requirement satisfied: ${process.versions.node}.`);
  process.exit(0);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const skipInstall = process.argv.includes('--skip-install');
const stages = [
  ...(!skipInstall ? [['restore pinned dependencies', ['ci', '--ignore-scripts']]] : []),
  ['verify lockfile and installed tree', ['run', 'verify:dependencies', '--', '--installed']],
  ['run regression suite', ['test']],
  ['run syntax and artifact checks', ['run', 'check']]
];

for (const [label, args] of stages) {
  console.log(`\n[OmegaVault resume] ${label}`);
  const result = spawnSync(npm, args, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\nOmegaVault workstation resume verification passed. No deployment or wallet action was performed.');
