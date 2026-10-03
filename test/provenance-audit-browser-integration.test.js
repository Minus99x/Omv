import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('browser loads validated provenance audit and exposes export action', () => {
  assert.match(app, /api\('\/api\/provenance-audit'\)/);
  assert.match(app, /serializeValidatedProvenanceAudit/);
  assert.match(html, /id="provenanceAuditExport"/);
  assert.match(html, /Missing lineage stays/);
});

test('audit export button is actually wired to validated serialization', () => {
  assert.match(app, /provenanceAuditExport'\)\?\.addEventListener\('click'/);
  assert.match(app, /serializeValidatedProvenanceAudit\(provenanceAuditUiModel\)/);
});
