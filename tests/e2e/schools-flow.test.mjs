import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'schools-e2e-password';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P13 API 主流程：解锁、新增、筛选、编辑、停用和删除误建学校', async (context) => {
  const server = createWorkbenchServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const baseHeaders = { Host: `127.0.0.1:${address.port}`, Origin: `http://127.0.0.1:${address.port}`, 'Content-Type': 'application/json' };
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ password: 'schools-e2e-password' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { ...baseHeaders, Cookie: cookie };

  const createdResponse = await fetch(`${base}/api/schools`, { method: 'POST', headers, body: JSON.stringify({ name: '端到端测试学校', contacts: [{ name: '周老师', phone: '13800000001', isDefault: true }] }) });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  const list = await (await fetch(`${base}/api/schools?query=${encodeURIComponent('端到端')}`, { headers })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);

  const updated = await (await fetch(`${base}/api/schools/${created.id}`, { method: 'PUT', headers, body: JSON.stringify({ name: '端到端测试学校', cooperationNotes: '资料已核对', contacts: [{ name: '陈老师', phone: '13800000002', isDefault: true }] }) })).json();
  assert.equal(updated.contacts[0].name, '陈老师');

  const disabled = await (await fetch(`${base}/api/schools/${created.id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ active: false }) })).json();
  assert.equal(disabled.active, 0);

  const removed = await (await fetch(`${base}/api/schools/${created.id}`, { method: 'DELETE', headers })).json();
  assert.equal(removed.removed, true);
});
