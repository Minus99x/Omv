import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWorkstationResumeReport } from '../src/core/dependency-integrity.js';
import { createPostInstallVerificationPlan } from '../src/core/post-install-verification.js';

const projectRoot = resolve(process.argv[2] ?? '.');
const report = createWorkstationResumeReport(projectRoot);
const plan = createPostInstallVerificationPlan(report);

if (!plan.ready) {
  process.stdout.write(`${JSON.stringify({ report, plan }, null, 2)}\n`);
  process.stderr.write(`OmegaVault offline resume verification is blocked. ${plan.recommendedRepair ? `Recommended action: ${plan.recommendedRepair}.` : ''}\n`);
  process.exitCode = 2;
} else {
  const results = [];
  for (const suite of plan.suites) {
    const result = spawnSync(suite.command, suite.args, { cwd: projectRoot, stdio: 'inherit', windowsHide: true });
    results.push({ id: suite.id, status: result.status ?? 1 });
  }
  const ok = results.every(result => result.status === 0);
  process.stdout.write(`${JSON.stringify({ schema: 'omegavault.offline-resume-result.v1', ok, liveChainActions: false, results }, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
}
