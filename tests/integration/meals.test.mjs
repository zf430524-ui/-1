import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createBusinessRepository } from '../../src/db/repositories/business.mjs';
import { createSchoolRepository } from '../../src/db/repositories/schools.mjs';
import { createBusinessService } from '../../src/services/business.mjs';
import { createSchoolService } from '../../src/services/schools.mjs';

const now = '2026-09-16T09:00:00.000Z';

function setup(context) {
  const db = openDatabase(':memory:'); migrate(db); context.after(() => db.close());
  const schoolRepository = createSchoolRepository(db); const repository = createBusinessRepository(db);
  const schools = createSchoolService({ db, repository: schoolRepository, clock: () => now });
  const business = createBusinessService({ db, repository, schoolRepository, clock: () => now });
  const school = schools.create({ name: 'P10 脱敏学校', contacts: [{ name: '联系人', phone: '13800010000', isDefault: true }] }).data;
  const project = business.createProject({ id: 'p10-main', schoolId: school.id, grade: '八年级', destination: '脱敏基地', startsOn: '2026-10-10', endsOn: '2026-10-11', includesMeals: true, mealCount: 2 }).data;
  const classes = [
    { id: 'c801', name: '801', studentTotal: 42, boys: 22, girls: 20, teachers: [{ role: '班主任', name: '老师甲', phone: '13800010101', gender: '男', joinsDefaultMeals: true }, { role: '配班老师', name: '老师乙', phone: '13800010102', gender: '女', joinsDefaultMeals: true }] },
    { id: 'c802', name: '802', studentTotal: 43, boys: 21, girls: 22, teachers: [{ role: '班主任', name: '老师丙', phone: '13800010103', gender: '男', joinsDefaultMeals: true }, { role: '配班老师', name: '老师丁', phone: '13800010104', gender: '女', joinsDefaultMeals: true }] },
    { id: 'c803', name: '803', studentTotal: 40, boys: 20, girls: 20, teachers: [{ role: '班主任', name: '老师戊', phone: '13800010105', gender: '女', joinsDefaultMeals: true }] }
  ];
  assert.equal(business.savePeople(project.id, { classes, manualStaff: [] }).ok, true);
  const guides = [['g1','导游甲','13900010101','男'],['g2','导游乙','13900010102','女'],['g3','导游丙','13900010103','女']].map(([id,name,workPhone,gender]) => business.createGuide({ id,name,workPhone,gender }).data);
  const batch = business.recruit(project.id, { rawText: 'P10 脱敏接龙', entries: guides.map((guide, index) => ({ order: index + 1, name: guide.name, phone: guide.work_phone })) }).data;
  batch.rows.forEach((row, index) => assert.equal(business.assignGuide(row.id, { classIds: [classes[index].id], needsLodging: false, joinsDefaultMeals: true }).ok, true));
  const vehicles = [1,2,3].map((number) => ({ vehicleLabel: `${number}车`, fleetName: '脱敏车队', vehicleModel: '49座大巴', capacity: 49, plateNumber: `湘A1000${number}`, driverName: `司机${number}`, driverPhone: `1370001000${number}`, driverGender: '男', driverJoinsDefaultMeals: true }));
  assert.equal(business.saveTransport(project.id, business.suggestTransport(project.id, { vehicles }).data.vehicles).ok, true);
  return { business, repository, project, classes };
}

const mealDrafts = () => [
  { name: '第一餐', restaurantName: '验收餐厅 A', mealAt: '2026-10-10T12:00', seatsPerTable: 10, tablePrefix: 'A', tables: [] },
  { name: '第二餐', restaurantName: '验收餐厅 B', mealAt: '2026-10-10T18:00', seatsPerTable: 10, tablePrefix: 'B', tables: [] }
];

test('P10 基础建议预览不落库，工作人员显式追加后两餐各 14 桌、136 人', (context) => {
  const fixture = setup(context); const base = fixture.business.suggestMeals(fixture.project.id, { sessions: mealDrafts() });
  assert.equal(base.ok, true); assert.equal(fixture.repository.counts(fixture.project.id).meals, 0);
  assert.ok(base.data.sessions.every((row) => row.tables.length === 13 && row.suggestion.allocated === 128 && row.suggestion.unassigned === 8));
  let saved = fixture.business.saveMeals(fixture.project.id, base.data.sessions); assert.equal(saved.ok, true);
  assert.ok(saved.data.exceptions.some((row) => row.code === 'MEAL_CAPACITY_SHORTAGE' && row.status === '待处理'));
  const final = fixture.business.suggestMeals(fixture.project.id, { sessions: mealDrafts(), includeStaff: true }); assert.equal(final.ok, true);
  saved = fixture.business.saveMeals(fixture.project.id, final.data.sessions); assert.equal(saved.ok, true);
  assert.ok(saved.data.meals.every((row) => row.actual_tables === 14 && row.allocated === 136));
  assert.equal(saved.data.exceptions.some((row) => row.module === '用餐' && row.severity === '阻断' && row.status === '待处理'), false);
  assert.deepEqual(saved.data.meals.map((row) => [row.restaurant_name, row.tables[0].table_number, row.tables.at(-1).table_number]), [['验收餐厅 A','A01','A14'],['验收餐厅 B','B01','B14']]);
});

test('P10 拒绝重复桌号、越界日期和无原因差异，并在来源变化后重新产生缺口', (context) => {
  const fixture = setup(context); const final = fixture.business.suggestMeals(fixture.project.id, { sessions: mealDrafts(), includeStaff: true }).data.sessions;
  const duplicate = structuredClone(final); duplicate[0].tables[1].tableNumber = duplicate[0].tables[0].tableNumber;
  assert.equal(fixture.business.saveMeals(fixture.project.id, duplicate).error.code, 'DUPLICATE_MEAL_TABLE_NUMBER');
  const outside = mealDrafts(); outside[0].mealAt = '2026-10-12T12:00'; assert.equal(fixture.business.suggestMeals(fixture.project.id, { sessions: outside }).error.code, 'MEAL_DATE_INVALID');
  const source = fixture.business.summary(fixture.project.id).staff.find((row) => row.role === '老师');
  const invalidOverride = mealDrafts(); invalidOverride[0].overrides = [{ sourceType: source.source_type, sourceId: source.source_id, differenceCount: -1, reason: '' }];
  assert.equal(fixture.business.suggestMeals(fixture.project.id, { sessions: invalidOverride }).error.code, 'MEAL_OVERRIDE_REASON_REQUIRED');
  assert.equal(fixture.business.saveMeals(fixture.project.id, final).ok, true);
  const changed = structuredClone(fixture.classes); changed[0].teachers.push({ role: '配班老师', name: '新增老师', phone: '13800010106', gender: '女', joinsDefaultMeals: true });
  const afterSourceChange = fixture.business.savePeople(fixture.project.id, { classes: changed, manualStaff: [] }).data;
  assert.ok(afterSourceChange.exceptions.some((row) => row.code === 'MEAL_PEOPLE_MISMATCH' && row.status === '待处理'));
});

test('P10 单餐差异只改变指定餐次，不含餐项目始终不创建记录', (context) => {
  const fixture = setup(context); const source = fixture.business.summary(fixture.project.id).staff.find((row) => row.role === '老师'); const drafts = mealDrafts();
  drafts[0].overrides = [{ sourceType: source.source_type, sourceId: source.source_id, differenceCount: -1, reason: '第一餐提前离团' }];
  const final = fixture.business.suggestMeals(fixture.project.id, { sessions: drafts, includeStaff: true }); assert.equal(final.ok, true);
  assert.deepEqual(final.data.sessions.map((row) => row.suggestion.totalPeople), [135,136]);
  const saved = fixture.business.saveMeals(fixture.project.id, final.data.sessions); assert.deepEqual(saved.data.meals.map((row) => row.allocated), [135,136]);
  const day = fixture.business.createProject({ id: 'p10-no-meals', schoolId: fixture.project.school_id, grade: '一年级', destination: '脱敏日营', startsOn: '2026-11-01', endsOn: '2026-11-01' }).data;
  assert.equal(fixture.business.suggestMeals(day.id, { sessions: mealDrafts() }).error.code, 'MEALS_NOT_APPLICABLE');
  assert.equal(fixture.repository.counts(day.id).meals, 0);
});
