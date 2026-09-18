import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createBusinessRepository } from '../../src/db/repositories/business.mjs';
import { createSchoolRepository } from '../../src/db/repositories/schools.mjs';
import { createBusinessService } from '../../src/services/business.mjs';
import { createSchoolService } from '../../src/services/schools.mjs';

const now = '2026-09-16T10:00:00.000Z';

function setup(context) {
  const db = openDatabase(':memory:'); migrate(db); context.after(() => db.close());
  const schoolRepository = createSchoolRepository(db); const repository = createBusinessRepository(db);
  const schools = createSchoolService({ db, repository: schoolRepository, clock: () => now });
  const business = createBusinessService({ db, repository, schoolRepository, clock: () => now });
  const school = schools.create({ name: 'P18 脱敏学校', contacts: [{ name: '负责人', phone: '13800018000', isDefault: true }] }).data;
  return { db, repository, business, school };
}

test('P18 重算去重、筛选、阻断拒绝、提醒确认与源修正自动关闭', (context) => {
  const fixture = setup(context);
  const project = fixture.business.createProject({ id: 'p18-state', schoolId: fixture.school.id, grade: '六年级', destination: '脱敏基地', startsOn: '2026-10-20', endsOn: '2026-10-20' }).data;
  assert.equal(fixture.business.recalculate(project.id).ok, true);
  const first = fixture.business.listExceptions({ projectId: project.id }).data;
  const reminder = first.items.find((row) => row.code === 'MEETING_PLACE_MISSING');
  const blocker = first.items.find((row) => row.severity === '阻断');
  assert.ok(reminder); assert.ok(blocker); assert.equal(first.stats.reminders, 1);
  const ids = first.items.map((row) => row.id).sort();
  fixture.business.recalculate(project.id);
  assert.deepEqual(fixture.business.listExceptions({ projectId: project.id }).data.items.map((row) => row.id).sort(), ids, '重复校验不能制造重复异常');
  assert.equal(fixture.business.confirmException(reminder.id, { reason: '' }).error.code, 'EXCEPTION_REASON_REQUIRED');
  assert.equal(fixture.business.confirmException(blocker.id, { reason: '忽略阻断' }).error.code, 'BLOCKER_CANNOT_BE_IGNORED');
  assert.equal(fixture.business.confirmException(reminder.id, { reason: '集合地点待学校最终确认，负责人已电话核对' }).data.status, '已确认例外');
  fixture.business.recalculate(project.id);
  assert.equal(fixture.business.listExceptions({ projectId: project.id, status: '已确认例外' }).data.items[0].id, reminder.id, '重复重算保留已确认例外');
  assert.equal(fixture.business.updateProject(project.id, { meetingPlace: '学校南门' }).ok, true);
  const resolved = fixture.business.listExceptions({ projectId: project.id, module: '项目', status: '已解决' }).data.items;
  assert.equal(resolved.find((row) => row.id === reminder.id)?.exception_reason, '集合地点待学校最终确认，负责人已电话核对');
  assert.ok(resolved.find((row) => row.id === reminder.id)?.resolved_at);
});

test('T22 统一完成门禁允许无阻断项目，并在核心来源变化后退回待检查', (context) => {
  const fixture = setup(context);
  const project = fixture.business.createProject({ id: 'p18-gate', schoolId: fixture.school.id, grade: '五年级', destination: '脱敏营地', startsOn: '2026-11-01', endsOn: '2026-11-01', meetingPlace: '学校南门' }).data;
  const people = fixture.business.savePeople(project.id, { classes: [{ id: 'p18-class', name: '501', studentTotal: 10, boys: 5, girls: 5, guideRequired: 1, teachers: [{ id: 'p18-teacher', role: '班主任', name: '周老师', phone: '13800018001', gender: '女', ridesVehicle: true, needsLodging: false, joinsDefaultMeals: false }] }], manualStaff: [] }).data;
  const guide = fixture.business.createGuide({ id: 'p18-guide', name: '脱敏导游', workPhone: '13900018001', gender: '男' }).data;
  const batch = fixture.business.recruit(project.id, { rawText: 'P18 接龙', entries: [{ order: 1, name: guide.name, phone: guide.work_phone }] }).data;
  assert.equal(fixture.business.assignGuide(batch.rows[0].id, { classIds: [people.classes[0].id], needsLodging: false, joinsDefaultMeals: false }).ok, true);
  const suggested = fixture.business.suggestTransport(project.id, { vehicles: [{ vehicleLabel: '1车', fleetName: '脱敏车队', vehicleModel: '19座中巴', plateNumber: '湘A18001', capacity: 19, driverName: '陈师傅', driverPhone: '13700018001', driverGender: '男' }] }).data;
  assert.equal(fixture.business.saveTransport(project.id, suggested.vehicles).ok, true);
  assert.equal(fixture.business.complete(project.id).data.project.status, '已完成安排');
  const version = fixture.business.summary(project.id).project.data_version;
  const changed = structuredClone(fixture.business.summary(project.id).classes[0]);
  const saved = fixture.business.savePeople(project.id, { classes: [{ id: changed.id, name: changed.name, studentTotal: 11, boys: 6, girls: 5, guideRequired: changed.guide_required, teachers: changed.teachers.map((teacher) => ({ id: teacher.id, role: teacher.role, name: teacher.name, phone: teacher.phone, gender: teacher.gender, ridesVehicle: Boolean(teacher.rides_vehicle), needsLodging: Boolean(teacher.needs_lodging), joinsDefaultMeals: Boolean(teacher.joins_default_meals) })) }], manualStaff: [] }).data;
  assert.equal(saved.project.status, '待检查');
  assert.ok(saved.project.data_version > version);
  assert.ok(saved.exceptions.some((row) => row.code === 'TRANSPORT_CLASS_STUDENTS_MISMATCH' && row.status === '待处理'));
  assert.equal(fixture.business.complete(project.id).error.code, 'PROJECT_BLOCKED');
});
