import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createBusinessRepository } from '../../src/db/repositories/business.mjs';
import { createSchoolRepository } from '../../src/db/repositories/schools.mjs';
import { createBusinessService } from '../../src/services/business.mjs';
import { createSchoolService } from '../../src/services/schools.mjs';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  const schoolRepository = createSchoolRepository(db);
  const schools = createSchoolService({ db, repository: schoolRepository, clock: () => '2026-09-15T02:00:00.000Z' });
  const repository = createBusinessRepository(db);
  const projects = createBusinessService({ db, repository, schoolRepository, clock: () => '2026-09-15T02:00:00.000Z' });
  const school = schools.create({ name: '项目测试学校', contacts: [{ name: '周老师', phone: '13800000001', isDefault: true }] }).data;
  return { db, repository, projects, school };
}

const minimal = (schoolId, overrides = {}) => ({ schoolId, grade: '八年级', destination: '脱敏研学地', startsOn: '2026-10-10', endsOn: '2026-10-10', ...overrides });

test('项目创建计算行程类型所需日期，并拒绝倒置日期和前端伪造完成状态', () => {
  const fixture = setup();
  try {
    const day = fixture.projects.createProject(minimal(fixture.school.id, { id: 'project-day', status: '已完成安排' }));
    assert.equal(day.ok, true);
    assert.equal(day.data.starts_on, day.data.ends_on);
    assert.equal(day.data.status, '资料待补充');
    assert.equal(day.data.school_lead_name, '周老师');
    const multi = fixture.projects.createProject(minimal(fixture.school.id, { id: 'project-multi', endsOn: '2026-10-12', needsLodging: true, includesMeals: true, mealCount: 3 }));
    assert.equal(multi.ok, true);
    assert.equal(multi.data.needs_lodging, 1);
    assert.equal(fixture.projects.createProject(minimal(fixture.school.id, { startsOn: '2026-10-12', endsOn: '2026-10-10' })).error.code, 'PROJECT_DATE_INVALID');
    assert.equal(fixture.projects.createProject(minimal(fixture.school.id, { needsLodging: true })).error.code, 'DAY_TRIP_LODGING_NOT_ALLOWED');
  } finally { fixture.db.close(); }
});

test('项目列表支持关键词、日期和多状态筛选，默认不混入已结束项目', () => {
  const fixture = setup();
  try {
    fixture.projects.createProject(minimal(fixture.school.id, { id: 'project-a', destination: '韶山', startsOn: '2026-10-10', endsOn: '2026-10-10' }));
    fixture.projects.createProject(minimal(fixture.school.id, { id: 'project-b', destination: '岳阳', startsOn: '2026-11-10', endsOn: '2026-11-11' }));
    assert.equal(fixture.projects.endProject('project-b', { confirmed: true }).ok, true);
    assert.deepEqual(fixture.projects.listProjects({ query: '韶山' }).data.map((row) => row.id), ['project-a']);
    assert.deepEqual(fixture.projects.listProjects({ startsFrom: '2026-11-01', statuses: ['已结束'] }).data.map((row) => row.id), ['project-b']);
    assert.deepEqual(fixture.projects.listProjects().data.map((row) => row.id), ['project-a']);
    assert.equal(fixture.projects.listProjects({ startsFrom: '2026-12-01', startsTo: '2026-11-01' }).error.code, 'PROJECT_FILTER_INVALID');
  } finally { fixture.db.close(); }
});

test('关闭已有条件数据要求确认，误建项目仅在无业务引用时可删除', () => {
  const fixture = setup();
  try {
    const project = fixture.projects.createProject(minimal(fixture.school.id, { id: 'project-conditional', endsOn: '2026-10-11', needsLodging: true })).data;
    fixture.repository.replaceLodging(project.id, [{ lodgingName: '脱敏酒店', checkInOn: '2026-10-10', roomNumber: '301', roomType: '标间', capacity: 2, genderRule: '不限', allocations: [] }], '2026-09-15T02:00:00.000Z');
    const warning = fixture.projects.updateProject(project.id, { needsLodging: false });
    assert.equal(warning.error.code, 'CONDITIONAL_CLEAR_CONFIRMATION_REQUIRED');
    assert.equal(warning.error.details.lodgingRows, 1);
    assert.match(warning.error.message, /1 条住宿记录/);
    assert.equal(fixture.projects.updateProject(project.id, { needsLodging: false, confirmConditionalClear: true }).data.needs_lodging, 0);
    fixture.projects.savePeople(project.id, { classes: [{ name: '801', studentTotal: 40, boys: 20, girls: 20, teachers: [{ role: '班主任', name: '测试老师', phone: '13800000003', gender: '女', ridesVehicle: true }] }] });
    assert.equal(fixture.projects.removeProject(project.id, { confirmed: true }).error.code, 'PROJECT_IN_USE');
    const mistaken = fixture.projects.createProject(minimal(fixture.school.id, { id: 'project-mistaken' })).data;
    assert.equal(fixture.projects.removeProject(mistaken.id, { confirmed: true }).data.removed, true);
    assert.equal(fixture.projects.summary(mistaken.id), null);
  } finally { fixture.db.close(); }
});
