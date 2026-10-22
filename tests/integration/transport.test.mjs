import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createBusinessRepository } from '../../src/db/repositories/business.mjs';
import { createSchoolRepository } from '../../src/db/repositories/schools.mjs';
import { createOperationLogRepository } from '../../src/db/repositories/operation-logs.mjs';
import { createBusinessService } from '../../src/services/business.mjs';
import { createSchoolService } from '../../src/services/schools.mjs';
import { createAuditService } from '../../src/services/audit.mjs';

const now = '2026-09-16T06:00:00.000Z';

function setup(context) {
  const db = openDatabase(':memory:'); migrate(db); context.after(() => db.close());
  const schoolRepository = createSchoolRepository(db); const repository = createBusinessRepository(db); const operationLogs = createOperationLogRepository(db);
  const schools = createSchoolService({ db, repository: schoolRepository, clock: () => now });
  const business = createBusinessService({ db, repository, schoolRepository, audit: createAuditService(operationLogs, () => now), clock: () => now });
  const school = schools.create({ name: 'P08 脱敏学校', contacts: [{ name: '联系人', phone: '13800000001', isDefault: true }] }).data;
  const project = business.createProject({ schoolId: school.id, grade: '八年级', destination: '脱敏基地', startsOn: '2026-10-10', endsOn: '2026-10-11', needsLodging: true, includesMeals: true, mealCount: 2 }).data;
  const classes = [
    { id: 'c801', name: '801', studentTotal: 42, boys: 22, girls: 20, teachers: [{ name: '甲老师', phone: '13800000101', gender: '男', needsLodging: true, joinsDefaultMeals: true }, { role: '配班老师', name: '乙老师', phone: '13800000102', gender: '女', needsLodging: true, joinsDefaultMeals: true }] },
    { id: 'c802', name: '802', studentTotal: 43, boys: 21, girls: 22, teachers: [{ name: '丙老师', phone: '13800000103', gender: '男', needsLodging: true, joinsDefaultMeals: true }, { role: '配班老师', name: '丁老师', phone: '13800000104', gender: '女', needsLodging: true, joinsDefaultMeals: true }] },
    { id: 'c803', name: '803', studentTotal: 40, boys: 20, girls: 20, teachers: [{ name: '戊老师', phone: '13800000105', gender: '女', needsLodging: true, joinsDefaultMeals: true }] }
  ];
  assert.equal(business.savePeople(project.id, { classes }).ok, true);
  const guideRows = [['g1','导游甲','13900000001'],['g2','导游乙','13900000002'],['g3','导游丙','13900000003']].map(([id,name,workPhone]) => business.createGuide({ id, name, workPhone, gender: '女' }).data);
  const recruited = business.recruit(project.id, { rawText: 'P08 测试接龙', entries: guideRows.map((guide, index) => ({ order: index + 1, name: guide.name, phone: guide.work_phone })) }).data;
  recruited.rows.forEach((row, index) => assert.equal(business.assignGuide(row.id, { classIds: [classes[index].id], needsLodging: true, joinsDefaultMeals: true }).ok, true));
  return { db, repository, operationLogs, business, project, classes };
}

function vehicleDraft(capacities = [49, 49, 49]) {
  return capacities.map((capacity, index) => ({ vehicleLabel: `${index + 1}车`, fleetName: '脱敏测试车队', vehicleModel: '测试大巴', capacity, plateNumber: `湘A0000${index + 1}`,
    driverName: `司机${index + 1}`, driverPhone: `1370000000${index + 1}`, driverGender: '男', driverNeedsLodging: true, driverJoinsDefaultMeals: true, notes: '' }));
}

test('P08 建议、保存、司机汇总、超载与修正共用同一项目数据', (context) => {
  const fixture = setup(context);
  const suggestion = fixture.business.suggestTransport(fixture.project.id, { vehicles: vehicleDraft() });
  assert.equal(suggestion.ok, true); assert.equal(suggestion.data.totals.assigned, 133); assert.equal(suggestion.data.totals.emptySeats, 14);
  const saved = fixture.business.saveTransport(fixture.project.id, suggestion.data.vehicles);
  assert.equal(saved.ok, true);
  assert.equal(saved.data.transport.reduce((sum, vehicle) => sum + vehicle.allocated, 0), 133);
  assert.equal(saved.data.staff.filter((row) => row.source_type === 'transport_driver').length, 3);
  assert.equal(saved.data.exceptions.filter((row) => row.module === '乘车' && row.status === '待处理').length, 0);
  const smaller = structuredClone(suggestion.data.vehicles); smaller[2].capacity = 41;
  const overloaded = fixture.business.saveTransport(fixture.project.id, smaller);
  assert.ok(overloaded.data.exceptions.some((row) => row.code === 'VEHICLE_OVERLOAD' && row.status === '待处理'));
  const repaired = fixture.business.saveTransport(fixture.project.id, suggestion.data.vehicles);
  assert.equal(repaired.data.exceptions.some((row) => row.module === '乘车' && row.status === '待处理'), false);
});

test('P08 拒绝重复导游并在容量不足时返回未安排班级和缺口', (context) => {
  const fixture = setup(context);
  const shortage = fixture.business.suggestTransport(fixture.project.id, { vehicles: vehicleDraft([45, 46, 41]) });
  assert.deepEqual(shortage.data.unassigned.map((row) => [row.className, row.missingSeats]), [['803', 1]]);
  const full = fixture.business.suggestTransport(fixture.project.id, { vehicles: vehicleDraft() }).data.vehicles;
  const guide = full[0].allocations.find((row) => row.role === '导游');
  full[1].allocations.push({ ...guide });
  const rejected = fixture.business.saveTransport(fixture.project.id, full);
  assert.equal(rejected.error.code, 'TRANSPORT_GUIDE_DUPLICATE');
  assert.equal(fixture.repository.counts(fixture.project.id).vehicles, 0);
});

test('CR01 局部调整不改未选行，人工确认被全表建议跳过且上游变化触发重新确认', (context) => {
  const fixture = setup(context); const draft = fixture.business.suggestTransport(fixture.project.id, { vehicles: vehicleDraft() }).data.vehicles;
  let saved = fixture.business.saveTransport(fixture.project.id, draft).data;
  const selectedId = saved.transport[0].id; const untouched = structuredClone(saved.transport[1]);
  const adjusted = fixture.business.adjustArrangement(fixture.project.id, 'transport', { selectedIds: [selectedId] });
  assert.equal(adjusted.ok, true); assert.equal(adjusted.data.vehicles.find((row) => row.id === selectedId).arrangementState, '调整中');
  assert.match(adjusted.data.vehicles.find((row) => row.id === selectedId).arrangementSummary, /调整中$/);
  const untouchedAfter = adjusted.data.vehicles.find((row) => row.id === untouched.id);
  assert.deepEqual(untouchedAfter.allocations, untouched.allocations.map((row) => ({ id: row.id, classId: row.class_id, role: row.role, peopleCount: row.people_count, boysCount: row.boys_count, girlsCount: row.girls_count, projectGuideId: row.project_guide_id || undefined, notes: row.notes })));
  saved = fixture.business.saveTransport(fixture.project.id, adjusted.data.vehicles, { confirmedIds: [selectedId] }).data;
  const confirmed = saved.transport.find((row) => row.id === selectedId); assert.equal(confirmed.arrangement_state, '人工确认');
  assert.match(confirmed.arrangement_summary, /人工确认$/);
  assert.equal(fixture.business.adjustArrangement(fixture.project.id, 'transport', { selectedIds: [selectedId] }).error.code, 'ARRANGEMENT_LOCKED');
  const rerun = fixture.business.suggestTransport(fixture.project.id, { vehicles: saved.transport }).data;
  const allocationKey = (row) => [row.id, row.classId ?? row.class_id, row.role, row.peopleCount ?? row.people_count, row.projectGuideId ?? row.project_guide_id ?? null];
  assert.deepEqual(rerun.vehicles.find((row) => row.id === selectedId).allocations.map(allocationKey), confirmed.allocations.map(allocationKey));
  const lockedVersion = saved.project.data_version;
  const unlocked = fixture.business.unlockArrangement(fixture.project.id, 'transport', selectedId); assert.equal(unlocked.ok, true);
  assert.equal(unlocked.data.project.data_version, lockedVersion + 1, '解锁必须使旧预览和导出版本过期');
  const unlockedRow = unlocked.data.transport.find((row) => row.id === selectedId); assert.equal(unlockedRow.arrangement_state, '调整中');
  assert.deepEqual(unlockedRow.allocations.map(allocationKey), confirmed.allocations.map(allocationKey), '解锁不得立即改写原分配');
  assert.ok(unlocked.data.exceptions.some((row) => row.code === 'ARRANGEMENT_IN_PROGRESS' && row.source_id === selectedId && row.status === '待处理'));
  assert.equal(fixture.business.unlockArrangement(fixture.project.id, 'transport', selectedId).error.code, 'ARRANGEMENT_NOT_LOCKED');
  const readjusted = fixture.business.adjustArrangement(fixture.project.id, 'transport', { selectedIds: [selectedId] }); assert.equal(readjusted.ok, true);
  saved = fixture.business.saveTransport(fixture.project.id, readjusted.data.vehicles, { confirmedIds: [selectedId] }).data;
  assert.equal(saved.transport.find((row) => row.id === selectedId).arrangement_state, '人工确认');
  const changedClasses = structuredClone(fixture.classes); changedClasses[0].studentTotal += 1; changedClasses[0].boys += 1;
  saved = fixture.business.savePeople(fixture.project.id, { classes: changedClasses }).data;
  assert.equal(saved.transport.find((row) => row.id === selectedId).arrangement_state, '待重新确认');
  assert.ok(saved.exceptions.some((row) => row.code === 'ARRANGEMENT_RECONFIRM_REQUIRED' && row.source_id === selectedId));
  const blockerCodes = new Set(saved.exceptions.filter((row) => row.status === '待处理' && row.severity === '阻断').map((row) => row.code));
  assert.ok(blockerCodes.has('ARRANGEMENT_RECONFIRM_REQUIRED'));
  assert.ok(blockerCodes.has('TRANSPORT_CLASS_STUDENTS_MISMATCH'));
  const logs = fixture.operationLogs.list({ projectId: fixture.project.id, limit: 200 });
  assert.ok(logs.some((row) => row.objectType === '局部自动调整'));
  assert.ok(logs.some((row) => row.objectType === '人工确认'));
  const unlockLog = logs.find((row) => row.objectType === '安排解锁');
  assert.ok(unlockLog, JSON.stringify(logs.map((row) => [row.objectType, row.objectId, row.changeSummary])));
  assert.equal(unlockLog.objectId, selectedId); assert.match(unlockLog.changeSummary, /保留原分配/);
  assert.ok(logs.some((row) => row.changeSummary.includes('待重新确认')));
});
