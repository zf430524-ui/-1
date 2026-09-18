import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'people-e2e-password';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P05 API 主流程：字段错误、保存汇总与改名保留内部编号', async (context) => {
  const server = createWorkbenchServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port; const base = `http://127.0.0.1:${port}`;
  const baseHeaders = { Host: `127.0.0.1:${port}`, Origin: base, 'Content-Type': 'application/json' };
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ password: 'people-e2e-password' }) });
  const headers = { ...baseHeaders, Cookie: login.headers.get('set-cookie').split(';')[0] };
  const school = await (await fetch(`${base}/api/schools`, { method: 'POST', headers, body: JSON.stringify({ name: 'P05 端到端学校', contacts: [{ name: '校方联系人', phone: '13800000000', isDefault: true }] }) })).json();
  const project = await (await fetch(`${base}/api/projects`, { method: 'POST', headers, body: JSON.stringify({ schoolId: school.id, grade: '八年级', destination: '脱敏基地', startsOn: '2026-11-01', endsOn: '2026-11-02', needsLodging: true, includesMeals: true, mealCount: 3 }) })).json();
  const classes = [
    { name: '801', studentTotal: 41, boys: 22, girls: 20, guideRequired: 1, teachers: [{ role: '班主任', name: '周老师', phone: '13800000001', gender: '女', ridesVehicle: true, needsLodging: true, joinsDefaultMeals: true }] },
    { name: '802', studentTotal: 43, boys: 21, girls: 22, guideRequired: 1, teachers: [{ role: '班主任', name: '陈老师', phone: '13800000002', gender: '女', ridesVehicle: true, needsLodging: true, joinsDefaultMeals: true }] },
    { name: '803', studentTotal: 40, boys: 20, girls: 20, guideRequired: 1, teachers: [{ role: '班主任', name: '王老师', phone: '13800000003', gender: '女', ridesVehicle: true, needsLodging: true, joinsDefaultMeals: true }] }
  ];
  const badResponse = await fetch(`${base}/api/projects/${project.id}/people`, { method: 'POST', headers, body: JSON.stringify({ classes, manualStaff: [] }) });
  assert.equal(badResponse.status, 400);
  const bad = await badResponse.json();
  assert.equal(bad.code, 'STUDENT_TOTAL_MISMATCH');
  assert.equal(bad.details.fields[0].field, 'classes.0.studentTotal');

  classes[0].studentTotal = 42;
  classes[0].teachers.push({ role: '配班老师', name: '吴老师', phone: '13800000004', gender: '男', ridesVehicle: true, needsLodging: true, joinsDefaultMeals: true });
  classes[1].teachers.push({ role: '配班老师', name: '李老师', phone: '13800000005', gender: '男', ridesVehicle: true, needsLodging: true, joinsDefaultMeals: true });
  const savedResponse = await fetch(`${base}/api/projects/${project.id}/people`, { method: 'POST', headers, body: JSON.stringify({ classes, manualStaff: [{ role: '摄影师', gender: '男', peopleCount: 2, lodgingCount: 2, defaultMealCount: 2, notes: 'API 汇总', name: '不得入库' }] }) });
  assert.equal(savedResponse.status, 200, JSON.stringify(await savedResponse.clone().json()));
  const saved = await savedResponse.json();
  assert.deepEqual({ classes: saved.counts.classes, students: saved.students, teachers: saved.teachers, guides: saved.requiredGuides }, { classes: 3, students: 125, teachers: 5, guides: 3 });
  assert.equal(Object.hasOwn(saved.manualStaff[0], 'name'), false);
  const classId = saved.classes[0].id; const teacherIds = saved.classes[0].teachers.map((row) => row.id);
  const renamedClasses = saved.classes.map((row) => ({ id: row.id, name: row.name === '801' ? '801A' : row.name, studentTotal: row.student_total, boys: row.boys, girls: row.girls, guideRequired: row.guide_required, vehicleDifferenceReason: row.vehicle_difference_reason, specialNotes: row.special_notes, teachers: row.teachers.map((item) => ({ id: item.id, role: item.role, name: item.name, phone: item.phone, gender: item.gender, ridesVehicle: Boolean(item.rides_vehicle), needsLodging: Boolean(item.needs_lodging), joinsDefaultMeals: Boolean(item.joins_default_meals) })) }));
  const renamed = await (await fetch(`${base}/api/projects/${project.id}/people`, { method: 'POST', headers, body: JSON.stringify({ classes: renamedClasses, manualStaff: saved.manualStaff.map((row) => ({ id: row.id, role: row.role, gender: row.gender, peopleCount: row.people_count, lodgingCount: row.lodging_count, defaultMealCount: row.default_meal_count, notes: row.notes })) }) })).json();
  const first = renamed.classes.find((row) => row.name === '801A');
  assert.equal(first.id, classId);
  assert.deepEqual(first.teachers.map((row) => row.id), teacherIds);
});
