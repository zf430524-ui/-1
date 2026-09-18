import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'transport-e2e-password';
process.env.WORKBENCH_SENSITIVE_KEY = 'transport-e2e-sensitive-key';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P08 API：建议先预览、保存同步司机、超载阻断、修正清除和座位不足', async (context) => {
  const server = createWorkbenchServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port; const base = `http://127.0.0.1:${port}`; const baseHeaders = { Host: `127.0.0.1:${port}`, Origin: base, 'Content-Type': 'application/json' };
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ password: 'transport-e2e-password' }) });
  const headers = { ...baseHeaders, Cookie: login.headers.get('set-cookie').split(';')[0] };
  const request = async (method, path, body) => { const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); return { response, data: await response.json() }; };
  const post = (path, body) => request('POST', path, body);
  const school = (await post('/api/schools', { name: 'P08 API 脱敏学校', contacts: [{ name: '联系人', phone: '13800008000', isDefault: true }] })).data;
  const project = (await post('/api/projects', { id: 'p08-api-main', schoolId: school.id, grade: '八年级', destination: '脱敏基地', startsOn: '2026-10-20', endsOn: '2026-10-21', needsLodging: true, includesMeals: true, mealCount: 2 })).data;
  const classSpecs = [['c801','801',42,22,20,2],['c802','802',43,21,22,2],['c803','803',40,20,20,1]];
  const people = (await post(`/api/projects/${project.id}/people`, { classes: classSpecs.map(([id,name,studentTotal,boys,girls,teacherCount], classIndex) => ({ id, name, studentTotal, boys, girls, guideRequired: 1, teachers: Array.from({ length: teacherCount }, (_, index) => ({ role: index ? '配班老师' : '班主任', name: `${name}老师${index + 1}`, phone: `13800008${classIndex}${index + 1}1`, gender: index ? '女' : '男', ridesVehicle: true, needsLodging: true, joinsDefaultMeals: true })) })), manualStaff: [] })).data;
  const guides = [];
  for (let index = 0; index < 3; index += 1) guides.push((await post('/api/guides', { name: `导游${index + 1}`, workPhone: `1390000800${index + 1}`, gender: '女' })).data);
  const batch = (await post(`/api/projects/${project.id}/recruitment`, { rawText: 'P08 API 脱敏接龙', entries: guides.map((guide, index) => ({ order: index + 1, name: guide.name, phone: `1390000800${index + 1}` })) })).data;
  for (let index = 0; index < 3; index += 1) assert.equal((await post(`/api/project-guides/${batch.rows[index].id}/assign`, { classIds: [people.classes[index].id], needsLodging: true, joinsDefaultMeals: true })).response.status, 200);
  const vehicles = [1,2,3].map((number) => ({ vehicleLabel: `${number}车`, fleetName: '脱敏车队', vehicleModel: '49座大巴', plateNumber: `湘A0800${number}`, capacity: 49, safetyReserve: 0, driverName: `司机${number}`, driverPhone: `1370000800${number}`, driverGender: '男', driverNeedsLodging: true, driverJoinsDefaultMeals: true, allocations: [] }));
  const suggestion = await post(`/api/projects/${project.id}/transport/suggest`, { vehicles });
  assert.equal(suggestion.response.status, 200); assert.deepEqual(suggestion.data.totals, { capacity: 147, assigned: 133, emptySeats: 14, missingSeats: 0 }); assert.equal(suggestion.data.splitClasses.length, 0);
  assert.equal((await request('GET', `/api/projects/${project.id}`)).data.transport.length, 0, '预览建议不能写数据库');
  let saved = await post(`/api/projects/${project.id}/transport`, { vehicles: suggestion.data.vehicles });
  assert.equal(saved.response.status, 200); assert.equal(saved.data.transport.reduce((sum, row) => sum + row.allocated, 0), 133); assert.equal(saved.data.staff.filter((row) => row.source_type === 'transport_driver').length, 3);
  const smaller = structuredClone(suggestion.data.vehicles); smaller[2].capacity = 41;
  saved = await post(`/api/projects/${project.id}/transport`, { vehicles: smaller });
  assert.ok(saved.data.exceptions.some((row) => row.code === 'VEHICLE_OVERLOAD' && row.status === '待处理'));
  saved = await post(`/api/projects/${project.id}/transport`, { vehicles: suggestion.data.vehicles });
  assert.equal(saved.data.exceptions.some((row) => row.module === '乘车' && row.status === '待处理'), false);
  const shortage = await post(`/api/projects/${project.id}/transport/suggest`, { vehicles: vehicles.map((row, index) => ({ ...row, capacity: [45, 46, 41][index] })) });
  assert.deepEqual(shortage.data.unassigned.map((row) => [row.className, row.missingSeats]), [['803', 1]]);
});
