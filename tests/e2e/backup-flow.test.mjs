import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const runtimeRoot = mkdtempSync(join(tmpdir(), 'study-tour-backup-api-'));
process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'backup-e2e-password';
process.env.WORKBENCH_RUNTIME_ROOT = runtimeRoot;
process.env.WORKBENCH_DB_PATH = join(runtimeRoot, 'data', 'workbench.sqlite');
process.env.WORKBENCH_CERTIFICATES_PATH = join(runtimeRoot, 'certificates');
process.env.WORKBENCH_BACKUPS_PATH = join(runtimeRoot, 'backups');
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P20 API 跑通创建、校验、修改和恢复闭环', async (context) => {
  const server = createWorkbenchServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(runtimeRoot, { recursive: true, force: true });
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const baseHeaders = { Host: `127.0.0.1:${address.port}`, Origin: `http://127.0.0.1:${address.port}`, 'Content-Type': 'application/json' };
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ password: 'backup-e2e-password' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { ...baseHeaders, Cookie: cookie };

  const school = await (await fetch(`${base}/api/schools`, { method: 'POST', headers, body: JSON.stringify({ name: '备份前学校' }) })).json();
  const createdResponse = await fetch(`${base}/api/backups`, { method: 'POST', headers, body: JSON.stringify({ includeDatabase: true, includeCertificates: true, note: 'API 验收' }) });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.backup.contents.database, true);

  const verified = await fetch(`${base}/api/backups/${created.backup.id}/verify`, { method: 'POST', headers, body: '{}' });
  assert.equal(verified.status, 200);
  const updated = await fetch(`${base}/api/schools/${school.id}`, { method: 'PUT', headers, body: JSON.stringify({ name: '备份后被修改学校' }) });
  assert.equal(updated.status, 200);

  const missingConfirmation = await fetch(`${base}/api/backups/${created.backup.id}/restore`, { method: 'POST', headers, body: JSON.stringify({ backupCurrent: true }) });
  assert.equal(missingConfirmation.status, 409);
  const restored = await fetch(`${base}/api/backups/${created.backup.id}/restore`, { method: 'POST', headers, body: JSON.stringify({ confirmation: created.backup.id, backupCurrent: true }) });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).restored, true);

  const schoolAfterRestore = await (await fetch(`${base}/api/schools/${school.id}`, { headers })).json();
  assert.equal(schoolAfterRestore.name, '备份前学校');
  const status = await (await fetch(`${base}/api/backups/status`, { headers })).json();
  assert.ok(status.todayVerifiedAt);
});
