import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'exceptions-e2e-password';
process.env.WORKBENCH_SENSITIVE_KEY = 'exceptions-e2e-sensitive-key';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P18 API：筛选、去重、例外确认、自动关闭与阻断门禁', async (context) => {
  const server = createWorkbenchServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`; const baseHeaders = { Host: `127.0.0.1:${server.address().port}`, Origin: base, 'Content-Type': 'application/json' };
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ password: 'exceptions-e2e-password' }) }); const headers = { ...baseHeaders, Cookie: login.headers.get('set-cookie').split(';')[0] };
  const request = async (method, path, body) => { const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); return { response, data: await response.json() }; };
  const school = (await request('POST', '/api/schools', { name: 'P18 API 脱敏学校', contacts: [{ name: '负责人', phone: '13800018100', isDefault: true }] })).data;
  const project = (await request('POST', '/api/projects', { id: 'p18-api', schoolId: school.id, grade: '六年级', destination: '脱敏基地', startsOn: '2026-12-01', endsOn: '2026-12-01' })).data;
  await request('POST', `/api/projects/${project.id}/recalculate`, {});
  let listed = await request('GET', `/api/exceptions?projectId=${project.id}&status=待处理`); assert.equal(listed.response.status, 200);
  const reminder = listed.data.items.find((row) => row.code === 'MEETING_PLACE_MISSING'); const blocker = listed.data.items.find((row) => row.severity === '阻断'); assert.ok(reminder); assert.ok(blocker);
  const initialIds = listed.data.items.map((row) => row.id).sort(); await request('POST', `/api/projects/${project.id}/recalculate`, {});
  listed = await request('GET', `/api/exceptions?projectId=${project.id}&status=待处理`); assert.deepEqual(listed.data.items.map((row) => row.id).sort(), initialIds);
  let result = await request('POST', `/api/exceptions/${reminder.id}/confirm`, { reason: '' }); assert.equal(result.response.status, 400); assert.equal(result.data.code, 'EXCEPTION_REASON_REQUIRED');
  result = await request('POST', `/api/exceptions/${blocker.id}/confirm`, { reason: '尝试忽略' }); assert.equal(result.response.status, 409); assert.equal(result.data.code, 'BLOCKER_CANNOT_BE_IGNORED');
  result = await request('POST', `/api/exceptions/${reminder.id}/confirm`, { reason: '学校尚未最终通知，负责人已登记跟进' }); assert.equal(result.response.status, 200); assert.equal(result.data.status, '已确认例外');
  assert.equal((await request('GET', `/api/exceptions?projectId=${project.id}&module=项目&severity=提醒&status=已确认例外`)).data.items[0].id, reminder.id);
  result = await request('POST', `/api/projects/${project.id}/complete`, {}); assert.equal(result.response.status, 409); assert.equal(result.data.code, 'PROJECT_BLOCKED');
  await request('PUT', `/api/projects/${project.id}`, { meetingPlace: '学校南门' });
  listed = await request('GET', `/api/exceptions?projectId=${project.id}&status=已解决`); assert.ok(listed.data.items.some((row) => row.id === reminder.id && row.resolved_at));
});
