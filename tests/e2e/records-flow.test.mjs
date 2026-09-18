import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'records-e2e-password';
process.env.WORKBENCH_SENSITIVE_KEY = 'records-e2e-sensitive-key';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P19 API：登录保护、三类查询参数、来源跳转与只读边界', async (context) => {
  const server = createWorkbenchServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`; const baseHeaders = { Host: `127.0.0.1:${server.address().port}`, Origin: base, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${base}/api/records`, { headers: baseHeaders })).status, 401);
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ password: 'records-e2e-password' }) });
  const headers = { ...baseHeaders, Cookie: login.headers.get('set-cookie').split(';')[0] };
  const request = async (method, path, body) => { const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); return { response, data: await response.json() }; };
  const school = (await request('POST', '/api/schools', { name: 'P19 API 脱敏学校', contacts: [{ name: '负责人', phone: '13800026001', isDefault: true }] })).data;
  const project = (await request('POST', '/api/projects', { id: 'p19-api', schoolId: school.id, grade: '八年级', destination: '脱敏基地', startsOn: '2026-12-20', endsOn: '2026-12-20' })).data;
  const createdImport = await request('POST', '/api/imports', { targetType: 'classes_teachers', projectId: project.id, importMethod: '粘贴文字', text: '班级,学生总数,男生,女生\n801,20,10,10' });
  assert.equal(createdImport.response.status, 201);
  const failedImport = await request('POST', '/api/imports', { targetType: 'classes_teachers', projectId: project.id, importMethod: '粘贴文字', text: '无法识别的一行' });
  assert.equal(failedImport.response.status, 400);
  const listed = await request('GET', `/api/records?projectId=${project.id}&pageSize=1`);
  assert.equal(listed.response.status, 200); assert.ok(listed.data.pagination.total >= 3); assert.equal(listed.data.items.length, 1); assert.equal(listed.data.pagination.pageSize, 1);
  const imports = await request('GET', `/api/records?category=import&projectId=${project.id}&result=待确认`);
  assert.equal(imports.response.status, 200); assert.equal(imports.data.items.length, 1); assert.match(imports.data.items[0].sourcePath, /^#\/imports\/mapping\?batch=/);
  const failures = await request('GET', `/api/records?category=import&projectId=${project.id}&result=失败`);
  assert.equal(failures.data.items.length, 1); assert.ok(failures.data.items[0].failureReason);
  const operations = await request('GET', `/api/records?category=operation&projectId=${project.id}&operationType=修改安排`);
  assert.ok(operations.data.items.some((row) => row.objectType === '项目' && row.sourcePath === `#/projects/overview?project=${project.id}`));
  assert.equal((await request('GET', '/api/records?from=2026-09-18&to=2026-09-17')).response.status, 400);
  assert.equal((await request('DELETE', '/api/records')).response.status, 404);
});
