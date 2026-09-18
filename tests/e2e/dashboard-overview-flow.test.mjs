import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'dashboard-e2e-password';
process.env.WORKBENCH_SENSITIVE_KEY = 'dashboard-e2e-sensitive-key';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

function dateAfter(days) {
  const value = new Date(); value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

test('P01/P04 API 返回空态、实时指标、唯一项目和第一个适用未完成环节', async (context) => {
  const server = createWorkbenchServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port; const base = `http://127.0.0.1:${port}`;
  const baseHeaders = { Host: `127.0.0.1:${port}`, Origin: base, 'Content-Type': 'application/json' };
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ password: 'dashboard-e2e-password' }) });
  const headers = { ...baseHeaders, Cookie: login.headers.get('set-cookie').split(';')[0] };
  const request = async (method, path, body) => { const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); return { response, data: await response.json() }; };
  const post = (path, body) => request('POST', path, body);

  const empty = await request('GET', '/api/dashboard');
  assert.deepEqual(empty.data.stats, { upcomingProjects: 0, blockers: 0, pendingGuides: 0, pendingGuideProjects: 0, expiringDocuments: 0 });
  assert.deepEqual(empty.data.upcoming, []);

  const school = (await post('/api/schools', { name: 'T23 API 脱敏学校', contacts: [{ name: '联系人', phone: '13800002310', isDefault: true }] })).data;
  const startsOn = dateAfter(2);
  const project = (await post('/api/projects', { id: 't23-api', schoolId: school.id, grade: '八年级', destination: '脱敏基地', startsOn, endsOn: startsOn,
    meetingPlace: '学校门口', meetingAt: `${startsOn}T07:00`, itinerary: '脱敏行程' })).data;
  await post(`/api/projects/${project.id}/people`, { classes: [{ id: 't23-api-c1', name: '801', studentTotal: 40, boys: 20, girls: 20, guideRequired: 1,
    teachers: [{ name: '测试老师', phone: '13800002311', gender: '女', ridesVehicle: true }] }], manualStaff: [] });

  const dashboard = await request('GET', '/api/dashboard');
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.data.stats.upcomingProjects, 1);
  assert.deepEqual(dashboard.data.upcoming.map((row) => row.id), [project.id]);
  assert.ok(dashboard.data.stats.blockers > 1, '同一项目有多个阻断时仍只应出现一次');

  const overview = await request('GET', `/api/projects/${project.id}/overview`);
  assert.equal(overview.response.status, 200);
  assert.equal(overview.data.next.id, 'recruitment');
  assert.equal(overview.data.stages.find((row) => row.id === 'lodging').status, 'not_applicable');
  assert.equal(overview.data.stages.find((row) => row.id === 'meals').status, 'not_applicable');
  assert.equal(overview.data.staff.filter((row) => row.source_type === 'teacher').length, 1);
});
