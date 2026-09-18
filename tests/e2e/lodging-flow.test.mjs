import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'lodging-e2e-password';
process.env.WORKBENCH_SENSITIVE_KEY = 'lodging-e2e-sensitive-key';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P09 API：导入房源、统一来源建议、混住修正、来源联动和关闭确认', async (context) => {
  const server = createWorkbenchServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port; const base = `http://127.0.0.1:${port}`; const baseHeaders = { Host: `127.0.0.1:${port}`, Origin: base, 'Content-Type': 'application/json' };
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ password: 'lodging-e2e-password' }) }); const headers = { ...baseHeaders, Cookie: login.headers.get('set-cookie').split(';')[0] };
  const request = async (method, path, body) => { const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); return { response, data: await response.json() }; }; const post = (path, body) => request('POST', path, body);
  const school = (await post('/api/schools', { name: 'P09 API 脱敏学校', contacts: [{ name: '联系人', phone: '13800009200', isDefault: true }] })).data;
  const project = (await post('/api/projects', { id: 'p09-api-main', schoolId: school.id, grade: '八年级', destination: '脱敏基地', startsOn: '2026-10-10', endsOn: '2026-10-11', needsLodging: true })).data;
  const specs = [['ac801','801',42,22,20,2],['ac802','802',43,21,22,2],['ac803','803',40,20,20,1]];
  const peoplePayload = { classes: specs.map(([id,name,studentTotal,boys,girls,teacherCount], ci) => ({ id, name, studentTotal, boys, girls, guideRequired: 1, teachers: Array.from({ length: teacherCount }, (_, i) => ({ role: i ? '配班老师' : '班主任', name: `${name}老师${i + 1}`, phone: `138000092${ci}${i}1`, gender: i ? '女' : ci < 2 ? '男' : '女', ridesVehicle: true, needsLodging: true, joinsDefaultMeals: false })) })), manualStaff: [] };
  const people = (await post(`/api/projects/${project.id}/people`, peoplePayload)).data;
  const guideSpecs = [['API导游甲','13900009201','男'],['API导游乙','13900009202','女'],['API导游丙','13900009203','女']]; for (const [name,workPhone,gender] of guideSpecs) await post('/api/guides', { name, workPhone, gender });
  const batch = (await post(`/api/projects/${project.id}/recruitment`, { rawText: 'P09 API 接龙', entries: guideSpecs.map(([name,phone], index) => ({ order: index + 1, name, phone })) })).data;
  for (let index = 0; index < 3; index += 1) assert.equal((await post(`/api/project-guides/${batch.rows[index].id}/assign`, { classIds: [people.classes[index].id], needsLodging: true, joinsDefaultMeals: false })).response.status, 200);
  const vehicles = [1,2,3].map((number) => ({ vehicleLabel: `${number}车`, fleetName: '脱敏车队', vehicleModel: '49座大巴', capacity: 49, plateNumber: `湘A0920${number}`, driverName: `司机${number}`, driverPhone: `1370000920${number}`, driverGender: '男', driverNeedsLodging: true }));
  const transport = (await post(`/api/projects/${project.id}/transport/suggest`, { vehicles })).data; assert.equal((await post(`/api/projects/${project.id}/transport`, { vehicles: transport.vehicles })).response.status, 200);
  const csvRows = ['住宿点,入住日期,楼栋,楼层,房号,房型,床位数,性别规则']; for (let index = 0; index < 18; index += 1) csvRows.push(`脱敏住宿点,2026-10-10,A栋,${Math.floor(index / 10) + 1}层,M${String(index + 1).padStart(2, '0')},四人间,4,男`); for (let index = 0; index < 17; index += 1) csvRows.push(`脱敏住宿点,2026-10-10,B栋,${Math.floor(index / 10) + 1}层,F${String(index + 1).padStart(2, '0')},四人间,4,女`);
  const imported = (await post('/api/imports', { projectId: project.id, targetType: 'lodging', importMethod: '粘贴文字', text: csvRows.join('\n') })).data; const confirmed = await post(`/api/imports/${imported.id}/confirm`, { strategy: 'all_or_nothing' }); assert.equal(confirmed.response.status, 200);
  let summary = (await request('GET', `/api/projects/${project.id}`)).data; assert.equal(summary.lodging.length, 35); assert.equal(summary.lodging.reduce((sum, row) => sum + row.capacity, 0), 140);
  const suggestion = await post(`/api/projects/${project.id}/lodging/suggest`, { rooms: summary.lodging }); assert.equal(suggestion.response.status, 200); assert.deepEqual(suggestion.data.totals, { rooms: 35, nights: 1, capacity: 140, expected: 136, assigned: 136, emptyBeds: 4, missingPeople: 0, expectedPerNight: 136 }); assert.ok(suggestion.data.crossClassRooms.length > 0);
  assert.equal(summary.lodging.reduce((sum, room) => sum + room.allocations.length, 0), 0, '建议不能直接写数据库');
  let saved = await post(`/api/projects/${project.id}/lodging`, { rooms: suggestion.data.rooms }); assert.equal(saved.response.status, 200); assert.equal(saved.data.lodging.reduce((sum, room) => sum + room.allocated, 0), 136);
  const mixed = structuredClone(suggestion.data.rooms); const maleRoom = mixed.find((room) => room.allocations.some((row) => row.role === '老师' && row.gender === '男')); const male = maleRoom.allocations.find((row) => row.role === '老师' && row.gender === '男'); male.peopleCount -= 1; if (!male.peopleCount) maleRoom.allocations.splice(maleRoom.allocations.indexOf(male), 1); const femaleRoom = mixed.find((room) => room.genderRule === '女' && room.allocations.reduce((sum, row) => sum + row.peopleCount, 0) < room.capacity); femaleRoom.allocations.push({ role: '老师', gender: '男', peopleCount: 1 });
  saved = await post(`/api/projects/${project.id}/lodging`, { rooms: mixed }); assert.ok(saved.data.exceptions.some((row) => row.code === 'ROOM_GENDER_MISMATCH' && row.status === '待处理'));
  saved = await post(`/api/projects/${project.id}/lodging`, { rooms: suggestion.data.rooms }); assert.equal(saved.data.exceptions.some((row) => row.module === '住宿' && row.severity === '阻断' && row.status === '待处理'), false);
  const changedPeople = structuredClone(peoplePayload); changedPeople.classes[0].teachers[0].needsLodging = false; summary = (await post(`/api/projects/${project.id}/people`, changedPeople)).data; assert.ok(summary.exceptions.some((row) => row.code === 'LODGING_STAFF_MISMATCH' && row.status === '待处理'));
  const refused = await request('PUT', `/api/projects/${project.id}`, { needsLodging: false }); assert.equal(refused.data.code, 'CONDITIONAL_CLEAR_CONFIRMATION_REQUIRED'); assert.equal(refused.data.details.lodgingRows, 35);
  const closed = await request('PUT', `/api/projects/${project.id}`, { needsLodging: false, confirmConditionalClear: true }); assert.equal(closed.response.status, 200); summary = (await request('GET', `/api/projects/${project.id}`)).data; assert.equal(summary.project.needs_lodging, 0); assert.equal(summary.lodging.length, 0);
});
