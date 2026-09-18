import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'imports-e2e-password';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P11/P12 API 完成临时预览、映射、确认写入、重复拒绝和模板下载', async (context) => {
  const runtimeRoot = mkdtempSync(join(tmpdir(), 'study-import-api-'));
  process.env.WORKBENCH_RUNTIME_ROOT = runtimeRoot;
  const server = createWorkbenchServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(runtimeRoot, { recursive: true, force: true }); });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const baseHeaders = { Host: `127.0.0.1:${port}`, Origin: base, 'Content-Type': 'application/json' };
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ password: 'imports-e2e-password' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { ...baseHeaders, Cookie: cookie };

  const source = { targetType: 'schools', importMethod: '粘贴文字', text: '单位名称,联系人,联系电话\n接口导入学校,周老师,13800000001' };
  const createdResponse = await fetch(`${base}/api/imports`, { method: 'POST', headers, body: JSON.stringify(source) });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.counts.failed, 1);

  const remappedResponse = await fetch(`${base}/api/imports/${created.id}/mapping`, { method: 'PUT', headers, body: JSON.stringify({ mapping: { 单位名称: 'name', 联系人: 'contactName', 联系电话: 'contactPhone' } }) });
  assert.equal(remappedResponse.status, 200);
  const remapped = await remappedResponse.json();
  assert.equal(remapped.counts.valid, 1);

  const confirmedResponse = await fetch(`${base}/api/imports/${created.id}/confirm`, { method: 'POST', headers, body: JSON.stringify({ strategy: 'all_or_nothing' }) });
  assert.equal(confirmedResponse.status, 200);
  assert.equal((await confirmedResponse.json()).status, '成功');
  const schools = await (await fetch(`${base}/api/schools?query=${encodeURIComponent('接口导入')}`, { headers })).json();
  assert.equal(schools.length, 1);

  const duplicateResponse = await fetch(`${base}/api/imports`, { method: 'POST', headers, body: JSON.stringify(source) });
  assert.equal(duplicateResponse.status, 400);
  assert.equal((await duplicateResponse.json()).code, 'DUPLICATE_IMPORT');

  const template = await fetch(`${base}/api/imports/templates/schools`, { headers });
  assert.equal(template.status, 200);
  assert.equal(template.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.ok((await template.arrayBuffer()).byteLength > 1000);
});
