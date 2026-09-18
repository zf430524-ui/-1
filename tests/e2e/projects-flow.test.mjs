import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'projects-e2e-password';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P02/P03 API 主流程：新建、筛选、编辑、状态展示与结束', async (context) => {
  const server = createWorkbenchServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const baseHeaders = { Host: `127.0.0.1:${port}`, Origin: base, 'Content-Type': 'application/json' };
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ password: 'projects-e2e-password' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { ...baseHeaders, Cookie: cookie };
  const school = await (await fetch(`${base}/api/schools`, { method: 'POST', headers, body: JSON.stringify({ name: '项目端到端学校', contacts: [{ name: '陈老师', phone: '13800000001', isDefault: true }] }) })).json();

  const createdResponse = await fetch(`${base}/api/projects`, { method: 'POST', headers, body: JSON.stringify({ schoolId: school.id, grade: '七年级', destination: '脱敏基地', startsOn: '2026-10-20', endsOn: '2026-10-21', needsLodging: true }) });
  assert.equal(createdResponse.status, 201, JSON.stringify(await createdResponse.clone().json()));
  const created = await createdResponse.json();
  assert.equal(created.status, '资料待补充');
  assert.equal(created.school_lead_name, '陈老师');

  const filtered = await (await fetch(`${base}/api/projects?query=${encodeURIComponent('七年级')}&startsFrom=2026-10-01&startsTo=2026-10-31`, { headers })).json();
  assert.deepEqual(filtered.map((project) => project.id), [created.id]);
  const updated = await (await fetch(`${base}/api/projects/${created.id}`, { method: 'PUT', headers, body: JSON.stringify({ meetingPlace: '学校东门', meetingAt: '2026-10-20T07:30', itinerary: '脱敏行程内容', includesMeals: true, mealCount: 2, schoolLeadName: '项目联系人', schoolLeadPhone: '13800000002' }) })).json();
  assert.equal(updated.includes_meals, 1);
  assert.equal(updated.meal_count, 2);
  assert.equal(updated.status, '资料待补充');

  const ended = await (await fetch(`${base}/api/projects/${created.id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ confirmed: true }) })).json();
  assert.equal(ended.status, '已结束');
  assert.deepEqual(await (await fetch(`${base}/api/projects`, { headers })).json(), []);
  const endedList = await (await fetch(`${base}/api/projects?status=${encodeURIComponent('已结束')}`, { headers })).json();
  assert.equal(endedList[0].id, created.id);
});
