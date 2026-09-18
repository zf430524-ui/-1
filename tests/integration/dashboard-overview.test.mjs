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
  const school = schools.create({ name: 'T23 脱敏学校', contacts: [{ name: '周老师', phone: '13800002301', isDefault: true }] }).data;
  return { db, repository, business, school };
}

function projectInput(schoolId, overrides = {}) {
  return { schoolId, grade: '八年级', destination: '脱敏基地', startsOn: '2026-09-18', endsOn: '2026-09-18',
    meetingPlace: '学校门口', meetingAt: '2026-09-18T07:00', itinerary: '脱敏行程', ...overrides };
}

test('P01 按真实项目去重汇总未来七天、阻断、导游缺口和证件提醒', (context) => {
  const f = setup(context);
  const near = f.business.createProject(projectInput(f.school.id, { id: 't23-near' })).data;
  f.business.createProject(projectInput(f.school.id, { id: 't23-far', startsOn: '2026-09-30', endsOn: '2026-09-30' }));
  const people = f.business.savePeople(near.id, { classes: [{ id: 't23-c1', name: '801', studentTotal: 40, boys: 20, girls: 20, guideRequired: 1,
    teachers: [{ name: '李老师', phone: '13800002302', gender: '女', ridesVehicle: true }] }], manualStaff: [] });
  assert.equal(people.ok, true);
  const guide = f.business.createGuide({ name: '测试导游', workPhone: '13900002301', gender: '女', documents: [{ documentType: '导游证', expiresOn: '2026-09-20' }] }).data;
  const batch = f.business.recruit(near.id, { rawText: 'T23 脱敏接龙', entries: [{ order: 1, name: guide.name, phone: guide.work_phone }] }).data;
  assert.equal(f.business.assignGuide(batch.rows[0].id, { classIds: ['t23-c1'] }).ok, true);

  const result = f.business.dashboard();
  assert.equal(result.ok, true);
  assert.equal(result.data.stats.upcomingProjects, 1);
  assert.deepEqual(result.data.upcoming.map((row) => row.id), [near.id]);
  assert.equal(new Set(result.data.upcoming.map((row) => row.id)).size, result.data.upcoming.length);
  const activeBlockers = f.repository.listExceptions({ status: '待处理' }).filter((row) => row.project_status !== '已结束' && row.severity === '阻断').length;
  assert.equal(result.data.stats.blockers, activeBlockers);
  assert.equal(result.data.stats.pendingGuides, 0);
  assert.equal(result.data.stats.expiringDocuments, 1);
  assert.equal(result.data.certificateReminders[0].actionPath, `/guides/detail?id=${guide.id}`);
});

test('P04 汇总老师和导游来源，使用正确档案 ID，并把下一步定位到乘车', (context) => {
  const f = setup(context);
  const project = f.business.createProject(projectInput(f.school.id, { id: 't23-overview' })).data;
  f.business.savePeople(project.id, { classes: [{ id: 't23-c2', name: '802', studentTotal: 38, boys: 19, girls: 19, guideRequired: 1,
    teachers: [{ name: '王老师', phone: '13800002303', gender: '男', ridesVehicle: true }] }], manualStaff: [] });
  const guide = f.business.createGuide({ name: '总览导游', workPhone: '13900002302', gender: '女' }).data;
  const batch = f.business.recruit(project.id, { rawText: 'T23 总览接龙', entries: [{ order: 1, name: guide.name, phone: guide.work_phone }] }).data;
  f.business.assignGuide(batch.rows[0].id, { classIds: ['t23-c2'] });

  const result = f.business.overview(project.id);
  assert.equal(result.ok, true);
  assert.equal(result.data.next.id, 'transport');
  assert.equal(result.data.stages.find((row) => row.id === 'lodging').status, 'not_applicable');
  assert.equal(result.data.stages.find((row) => row.id === 'meals').status, 'not_applicable');
  assert.equal(result.data.totals.staff, 2);
  const guideSource = result.data.staff.find((row) => row.source_type === 'project_guide');
  assert.equal(guideSource.source_id, batch.rows[0].id);
  assert.equal(guideSource.guide_id, guide.id);
  assert.deepEqual(result.data.staff.map((row) => row.source_type).sort(), ['project_guide', 'teacher']);
});
