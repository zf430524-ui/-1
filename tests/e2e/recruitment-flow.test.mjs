import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'recruitment-e2e-password';
process.env.WORKBENCH_SENSITIVE_KEY = 'recruitment-e2e-sensitive-key';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P06 API：通知、6 行原序匹配、人工确认与批次保存', async (context) => {
  const server = createWorkbenchServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port; const base = `http://127.0.0.1:${port}`;
  const baseHeaders = { Host: `127.0.0.1:${port}`, Origin: base, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${base}/api/projects/not-found/recruitment`, { headers: baseHeaders })).status, 401);
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ password: 'recruitment-e2e-password' }) });
  const headers = { ...baseHeaders, Cookie: login.headers.get('set-cookie').split(';')[0] };
  const post = async (path, body) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await response.json(); return { response, data };
  };
  const school = (await post('/api/schools', { name: 'P06 端到端学校', contacts: [{ name: '校方联系人', phone: '13800000900', isDefault: true }] })).data;
  const project = (await post('/api/projects', { schoolId: school.id, grade: '六年级', destination: '韶山', startsOn: '2026-10-16', endsOn: '2026-10-17', needsLodging: true })).data;
  const classes = ['601', '602', '603'].map((name, index) => ({ name, studentTotal: 40, boys: 20, girls: 20, guideRequired: 1,
    teachers: [{ role: '班主任', name: `${name}老师`, phone: `1380000090${index + 1}`, gender: '女', ridesVehicle: true, needsLodging: true, joinsDefaultMeals: false }] }));
  assert.equal((await post(`/api/projects/${project.id}/people`, { classes, manualStaff: [] })).response.status, 200);
  const guideInputs = [
    ['王晨', '13800000001'], ['李敏', '13800000002'], ['周妍', '13800000003'],
    ['陈浩', '13800000004'], ['刘芳', '13800000005'], ['赵琳', '13800000006']
  ];
  const guides = [];
  for (const [name, workPhone] of guideInputs) {
    const created = await post('/api/guides', { name, workPhone, gender: '未填写' });
    assert.equal(created.response.status, 201); guides.push(created.data);
  }

  const contextResponse = await fetch(`${base}/api/projects/${project.id}/recruitment`, { headers });
  const recruitmentContext = await contextResponse.json();
  assert.deepEqual({ requiredGuides: recruitmentContext.requiredGuides, classCount: recruitmentContext.classCount }, { requiredGuides: 3, classCount: 3 });
  const minimal = (await post(`/api/projects/${project.id}/recruitment/notice`, {})).data;
  assert.match(minimal.text, /2026-10-16 至 2026-10-17/); assert.match(minimal.text, /需要导游：3 名/);
  assert.equal(minimal.text.includes('P06 端到端学校'), false); assert.equal(minimal.text.includes('六年级'), false);
  const expanded = (await post(`/api/projects/${project.id}/recruitment/notice`, { showSchool: true, showGrade: true })).data;
  assert.match(expanded.text, /学校：P06 端到端学校/); assert.match(expanded.text, /年级：六年级/);

  const rawText = '1. 王晨 13800000001\n2. 李敏 13800000002\n3. 周妍 13800000003\n4. 陈浩 13800000004\n5. 刘芳 13800000005\n6. 赵琳';
  const preview = (await post(`/api/projects/${project.id}/recruitment/preview`, { rawText, notes: '第一轮接龙' })).data;
  assert.deepEqual(preview.entries.map((row) => row.sourceSequence), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(preview.entries.map((row) => row.matchStatus), ['已匹配', '已匹配', '已匹配', '已匹配', '已匹配', '待确认']);
  assert.equal(preview.entries[5].guideId, null); assert.deepEqual(preview.entries[5].candidates.map((row) => row.id), [guides[5].id]);
  const blocked = await post(`/api/projects/${project.id}/recruitment/confirm`, { rawText, notes: '第一轮接龙' });
  assert.equal(blocked.response.status, 409); assert.equal(blocked.data.code, 'RECRUITMENT_RESOLUTION_REQUIRED');
  const confirmed = await post(`/api/projects/${project.id}/recruitment/confirm`, { rawText, notes: '第一轮接龙', decisions: [{ batchOrder: 6, guideId: guides[5].id }] });
  assert.equal(confirmed.response.status, 201); assert.deepEqual(confirmed.data.rows.map((row) => row.sourceSequence), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(confirmed.data.rows.map((row) => row.matchStatus), ['已匹配', '已匹配', '已匹配', '已匹配', '已匹配', '已匹配']);
  const saved = await (await fetch(`${base}/api/projects/${project.id}/recruitment`, { headers })).json();
  assert.equal(saved.batches.length, 1); assert.deepEqual(saved.batches[0].rows.map((row) => row.sourceSequence), [1, 2, 3, 4, 5, 6]);
});
