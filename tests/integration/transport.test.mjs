import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createBusinessRepository } from '../../src/db/repositories/business.mjs';
import { createSchoolRepository } from '../../src/db/repositories/schools.mjs';
import { createBusinessService } from '../../src/services/business.mjs';
import { createSchoolService } from '../../src/services/schools.mjs';

const now = '2026-09-16T06:00:00.000Z';

function setup(context) {
  const db = openDatabase(':memory:'); migrate(db); context.after(() => db.close());
  const schoolRepository = createSchoolRepository(db); const repository = createBusinessRepository(db);
  const schools = createSchoolService({ db, repository: schoolRepository, clock: () => now });
  const business = createBusinessService({ db, repository, schoolRepository, clock: () => now });
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
  return { db, repository, business, project };
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
