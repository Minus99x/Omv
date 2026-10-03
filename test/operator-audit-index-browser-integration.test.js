import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app=fs.readFileSync(new URL('../public/app.js', import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html', import.meta.url),'utf8');

test('browser loads backend-validated operator audit index', () => {
  assert.match(app, /api\('\/api\/operator-audit-index'\)/);
  assert.match(app, /createOperatorAuditIndexUiModel/);
  assert.match(html, /id="operatorAuditIndexStatus"/);
  assert.match(html, /No self-reference/);
});
