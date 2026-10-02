import { resolve } from 'node:path';
import { createWorkstationResumeReport } from '../src/core/dependency-integrity.js';

const projectRoot = resolve(process.argv[2] ?? '.');
const report = createWorkstationResumeReport(projectRoot);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.dependencyLock.ok || report.mismatchedPackages.length > 0) process.exitCode = 2;
