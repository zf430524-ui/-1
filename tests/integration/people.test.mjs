import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createBusinessRepository } from '../../src/db/repositories/business.mjs';
import { createSchoolRepository } from '../../src/db/repositories/schools.mjs';
import { createBusinessService } from '../../src/services/business.mjs';
import { createSchoolService } from '../../src/services/schools.mjs';

const now = '2026-09-15T04:00:00.000Z';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  const schoolRepository = createSchoolRepository(db);
  const schools = createSchoolService({ db, repository: schoolRepository, clock: () => now });
  const repository = createBusinessRepository(db);
  const business = createBusinessService({ db, repository, schoolRepository, clock: () => now });
  const school = schools.create({ name: '人员基线测试学校', contacts: [{ name: '校方老师', phone: '13800000000', isDefault: true }] }).data;
  const project = business.createProject({ id: 'project-people', schoolId: school.id, grade: '八年级', destination: '脱敏研学基地', startsOn: '2026-10-20', endsOn: '2026-10-21', needsLodging: true, includesMeals: true, mealCount: 3 }).data;
  return { db, repository, business, project };
}

const teacher = (id, role, name, gender, ridesVehicle = true) => ({ id, role, name, phone: `13800000${id.slice(-3)}`, gender, ridesVehicle, needsLodging: true, joinsDefaultMeals: true });

function baseline() {
  return {
    classes: [
      { id: 'class-801', name: '801', studentTotal: 42, boys: 22, girls: 20, guideRequired: 1, teachers: [teacher('teacher-001', '班主任', '周老师', '女'), teacher('teacher-002', '配班老师', '吴老师', '男')] },
      { id: 'class-802', name: '802', studentTotal: 43, boys: 21, girls: 22, guideRequired: 1, teachers: [teacher('teacher-003', '班主任', '陈老师', '女'), teacher('teacher-004', '配班老师', '李老师', '男', false)], vehicleDifferenceReason: '李老师自行到达基地' },
      { id: 'class-803', name: '803', studentTotal: 40, boys: 20, girls: 20, guideRequired: 1, teachers: [teacher('teacher-005', '班主任', '王老师', '女')] }
    ],
    manualStaff: [{ id: 'staff-photo-m', role: '摄影师', gender: '男', peopleCount: 2, lodgingCount: 2, defaultMealCount: 2, notes: '只保存角色汇总', name: '不应保存的姓名' }]
  };
}

test('P05 保存 3 班 125 名学生、5 名老师和无姓名手工角色，并保持内部编号稳定', () => {
  const fixture = setup();
  try {
    const saved = fixture.business.savePeople(fixture.project.id, baseline());
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.data.counts.classes, 3);
    assert.equal(saved.data.students, 125);
    assert.equal(saved.data.boys, 63);
    assert.equal(saved.data.girls, 62);
    assert.equal(saved.data.teachers, 5);
    assert.equal(saved.data.teachersRiding, 4);
    assert.equal(saved.data.requiredGuides, 3);
    assert.equal(saved.data.staff.filter((row) => row.source_type === 'teacher').length, 5);
    assert.equal(saved.data.staff.find((row) => row.source_id === 'teacher-004').rides_vehicle_count, 0);
    const manual = saved.data.manualStaff[0];
    assert.equal(manual.role, '摄影师');
    assert.equal(Object.hasOwn(manual, 'name'), false);
    assert.equal(saved.data.staff.find((row) => row.source_type === 'manual_role').source_name, '');

    const renamedPayload = baseline();
    renamedPayload.classes[0].name = '801A';
    renamedPayload.classes[0].teachers[0].phone = '13900000001';
    const renamed = fixture.business.savePeople(fixture.project.id, renamedPayload);
    assert.equal(renamed.ok, true, JSON.stringify(renamed));
    const renamedClass = renamed.data.classes.find((row) => row.name === '801A');
    assert.equal(renamedClass.id, 'class-801');
    assert.deepEqual(renamedClass.teachers.map((row) => row.id), ['teacher-001', 'teacher-002']);
    assert.equal(renamedClass.teachers[0].phone, '13900000001');
  } finally { fixture.db.close(); }
});

test('P05 返回字段级校验错误，并阻止删除已被排车引用的班级', () => {
  const fixture = setup();
  try {
    const invalid = baseline();
    invalid.classes[0].studentTotal = 41;
    invalid.classes[1].vehicleDifferenceReason = '';
    invalid.classes[2].teachers[0].gender = '';
    const rejected = fixture.business.savePeople(fixture.project.id, invalid);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, 'STUDENT_TOTAL_MISMATCH');
    assert.deepEqual(rejected.error.details.fields.map((item) => item.field), ['classes.0.studentTotal', 'classes.1.vehicleDifferenceReason', 'classes.2.teachers.0.gender']);

    assert.equal(fixture.business.savePeople(fixture.project.id, baseline()).ok, true);
    fixture.repository.replaceTransport(fixture.project.id, [{ vehicleLabel: '1号车', capacity: 50, safetyReserve: 2, driverName: '司机甲', driverPhone: '13700000001', driverGender: '男', allocations: [{ classId: 'class-801', role: '学生', peopleCount: 42 }] }], now);
    const withoutReferencedClass = baseline();
    withoutReferencedClass.classes = withoutReferencedClass.classes.slice(1);
    const blocked = fixture.business.savePeople(fixture.project.id, withoutReferencedClass);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, 'CLASS_IN_USE');
    assert.equal(blocked.error.details.classes[0].id, 'class-801');
    assert.equal(blocked.error.details.classes[0].transportAllocations, 1);
    assert.equal(fixture.business.summary(fixture.project.id).classes.some((row) => row.id === 'class-801'), true);
  } finally { fixture.db.close(); }
});
