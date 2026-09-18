import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'guide-arrangements-e2e-password';
process.env.WORKBENCH_SENSITIVE_KEY = 'guide-arrangements-e2e-sensitive-key';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P07 API：冲突与过期阻断、分班、名单移出、替换和 P05 来源同步', async (context) => {
  const server = createWorkbenchServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port; const base = `http://127.0.0.1:${port}`;
  const baseHeaders = { Host: `127.0.0.1:${port}`, Origin: base, 'Content-Type': 'application/json' };
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ password: 'guide-arrangements-e2e-password' }) });
  const headers = { ...baseHeaders, Cookie: login.headers.get('set-cookie').split(';')[0] };
  const request = async (method, path, body) => { const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); const data = await response.json(); return { response, data }; };
  const post = (path, body) => request('POST', path, body);
  const school = (await post('/api/schools', { name: 'P07 脱敏学校', contacts: [{ name: '校方联系人', phone: '13800000900', isDefault: true }] })).data;
  const makeProject = async (id, startsOn, endsOn, classes) => {
    const project = (await post('/api/projects', { id, schoolId: school.id, grade: '八年级', destination: '脱敏研学地', startsOn, endsOn, needsLodging: startsOn !== endsOn, includesMeals: true, mealCount: 1 })).data;
    const people = await post(`/api/projects/${project.id}/people`, { classes: classes.map((name, index) => ({ id: `${id}-c${index + 1}`, name, studentTotal: 40 + index, boys: 20, girls: 20 + index, guideRequired: 1, teachers: [{ role: '班主任', name: `${name}老师`, phone: `1380000090${index + 1}`, gender: '女', ridesVehicle: true, needsLodging: startsOn !== endsOn, joinsDefaultMeals: true }] })), manualStaff: [] });
    assert.equal(people.response.status, 200); return { project, classes: people.data.classes };
  };
  const guideSpecs = [
    ['王晨', '13800000001', '男', '2027-12-31'], ['李敏', '13800000002', '女', '2027-12-31'], ['周妍', '13800000003', '女', '2027-12-31'],
    ['陈浩', '13800000004', '男', '2026-10-15'], ['刘芳', '13800000005', '女', '2027-12-31'], ['赵琳', '13800000006', '男', '2027-12-31']
  ];
  const guides = [];
  for (const [name, workPhone, gender, expiresOn] of guideSpecs) guides.push((await post('/api/guides', { name, workPhone, gender, documents: [{ documentType: '导游证', expiresOn }] })).data);
  const occupied = await makeProject('p07-conflict', '2026-10-16', '2026-10-16', ['参照班']);
  const occupiedRecruitment = (await post(`/api/projects/${occupied.project.id}/recruitment`, { rawText: '1. 李敏 13800000002', entries: [{ order: 1, name: '李敏', phone: '13800000002' }] })).data;
  assert.equal((await post(`/api/project-guides/${occupiedRecruitment.rows[0].id}/assign`, { classIds: [occupied.classes[0].id], needsLodging: true, joinsDefaultMeals: true })).response.status, 200);

  const main = await makeProject('p07-main', '2026-10-16', '2026-10-17', ['801', '802', '803']);
  const recruitment = (await post(`/api/projects/${main.project.id}/recruitment`, { rawText: guideSpecs.map((row, index) => `${index + 1}. ${row[0]} ${row[1]}`).join('\n'), entries: guideSpecs.map((row, index) => ({ order: index + 1, name: row[0], phone: row[1] })) })).data;
  const byName = Object.fromEntries(recruitment.rows.map((row) => [row.name, row]));
  const conflict = await post(`/api/project-guides/${byName.李敏.id}/assign`, { classIds: [main.classes[0].id], needsLodging: true, joinsDefaultMeals: true });
  assert.equal(conflict.response.status, 400); assert.equal(conflict.data.code, 'GUIDE_DATE_CONFLICT'); assert.equal(conflict.data.details.conflicts[0].projectId, occupied.project.id);
  const expired = await post(`/api/project-guides/${byName.陈浩.id}/assign`, { classIds: [main.classes[0].id], needsLodging: true, joinsDefaultMeals: true });
  assert.equal(expired.data.code, 'GUIDE_DOCUMENT_EXPIRED');
  for (const [index, name] of ['王晨', '周妍', '刘芳'].entries()) assert.equal((await post(`/api/project-guides/${byName[name].id}/assign`, { classIds: [main.classes[index].id], needsLodging: true, joinsDefaultMeals: true })).response.status, 200);
  assert.equal((await request('PATCH', `/api/project-guides/${byName.赵琳.id}/status`, { status: '移出' })).response.status, 200);
  let summary = (await request('GET', `/api/projects/${main.project.id}`)).data;
  assert.deepEqual([summary.requiredGuides, summary.arrangedGuides, summary.staff.filter((row) => row.source_type === 'project_guide').length], [3, 3, 3]);
  const replacement = await post(`/api/project-guides/${byName.王晨.id}/replace`, { replacementProjectGuideId: byName.赵琳.id, reason: '脱敏替换原因' });
  assert.equal(replacement.response.status, 200);
  summary = replacement.data;
  assert.equal(summary.guides.find((row) => row.id === byName.王晨.id).handling_status, '已替换');
  assert.deepEqual(summary.guides.find((row) => row.id === byName.赵琳.id).assignments.map((row) => row.className), ['801']);
  assert.deepEqual(summary.staff.filter((row) => row.source_type === 'project_guide').map((row) => row.source_id).sort(), [byName.周妍.id, byName.刘芳.id, byName.赵琳.id].sort());
  assert.equal(summary.staff.filter((row) => row.source_type === 'project_guide').reduce((sum, row) => sum + row.lodging_count, 0), 3);
});
