import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createProvenanceIntegrityAudit, verifyProvenanceIntegrityAudit } from '../src/chains/provenance-audit.js';

const output = resolve(process.argv[2] ?? 'omegavault-provenance-integrity-audit.json');
const audit = createProvenanceIntegrityAudit();
const verification = verifyProvenanceIntegrityAudit(audit);
if (!verification.ok) {
  process.stderr.write(`OmegaVault provenance audit verification failed: ${verification.errors.join('; ')}\n`);
  process.exit(2);
}
writeFileSync(output, `${JSON.stringify(audit, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, sha256: audit.sha256, lineageStatus: audit.lineageRecovery.status, recoveredBindingCount: audit.lineageRecovery.recoveredBindingCount }, null, 2)}\n`);
