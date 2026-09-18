import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createBusinessRepository } from '../../src/db/repositories/business.mjs';
import { createSchoolRepository } from '../../src/db/repositories/schools.mjs';
import { createBusinessService } from '../../src/services/business.mjs';
import { createSchoolService } from '../../src/services/schools.mjs';

const now = '2026-09-16T08:00:00.000Z';

function setup(context) {
  const db = openDatabase(':memory:'); migrate(db); context.after(() => db.close());
  const schoolRepository = createSchoolRepository(db); const repository = createBusinessRepository(db);
  const schools = createSchoolService({ db, repository: schoolRepository, clock: () => now });
  const business = createBusinessService({ db, repository, schoolRepository, clock: () => now });
  const school = schools.create({ name: 'P09 脱敏学校', contacts: [{ name: '联系人', phone: '13800009000', isDefault: true }] }).data;
  const project = business.createProject({ id: 'p09-main', schoolId: school.id, grade: '八年级', destination: '脱敏基地', startsOn: '2026-10-10', endsOn: '2026-10-11', needsLodging: true }).data;
  const classes = [
    { id: 'c801', name: '801', studentTotal: 42, boys: 22, girls: 20, teachers: [{ role: '班主任', name: '老师甲', phone: '13800009101', gender: '男', needsLodging: true }, { role: '配班老师', name: '老师乙', phone: '13800009102', gender: '女', needsLodging: true }] },
    { id: 'c802', name: '802', studentTotal: 43, boys: 21, girls: 22, teachers: [{ role: '班主任', name: '老师丙', phone: '13800009103', gender: '男', needsLodging: true }, { role: '配班老师', name: '老师丁', phone: '13800009104', gender: '女', needsLodging: true }] },
    { id: 'c803', name: '803', studentTotal: 40, boys: 20, girls: 20, teachers: [{ role: '班主任', name: '老师戊', phone: '13800009105', gender: '女', needsLodging: true }] }
  ];
  assert.equal(business.savePeople(project.id, { classes, manualStaff: [] }).ok, true);
  const guideSpecs = [['g1','导游甲','13900009101','男'],['g2','导游乙','13900009102','女'],['g3','导游丙','13900009103','女']];
  const guides = guideSpecs.map(([id,name,workPhone,gender]) => business.createGuide({ id, name, workPhone, gender }).data);
  const batch = business.recruit(project.id, { rawText: 'P09 测试接龙', entries: guides.map((guide, index) => ({ order: index + 1, name: guide.name, phone: guide.work_phone })) }).data;
  batch.rows.forEach((row, index) => assert.equal(business.assignGuide(row.id, { classIds: [classes[index].id], needsLodging: true, joinsDefaultMeals: false }).ok, true));
  const vehicleDraft = [1,2,3].map((number) => ({ vehicleLabel: `${number}车`, fleetName: '脱敏车队', vehicleModel: '49座大巴', capacity: 49, plateNumber: `湘A0900${number}`, driverName: `司机${number}`, driverPhone: `1370000900${number}`, driverGender: '男', driverNeedsLodging: true }));
  const transport = business.suggestTransport(project.id, { vehicles: vehicleDraft }); assert.equal(transport.ok, true); assert.equal(business.saveTransport(project.id, transport.data.vehicles).ok, true);
  return { business, repository, project, classes };
}

function roomDraft(male = 18, female = 17) {
  return [
    ...Array.from({ length: male }, (_, index) => ({ lodgingName: '脱敏住宿点', checkInOn: '2026-10-10', building: 'A栋', floorLabel: `${Math.floor(index / 10) + 1}层`, roomNumber: `M${String(index + 1).padStart(2, '0')}`, roomType: '四人间', capacity: 4, genderRule: '男', notes: '' })),
    ...Array.from({ length: female }, (_, index) => ({ lodgingName: '脱敏住宿点', checkInOn: '2026-10-10', building: 'B栋', floorLabel: `${Math.floor(index / 10) + 1}层`, roomNumber: `F${String(index + 1).padStart(2, '0')}`, roomType: '四人间', capacity: 4, genderRule: '女', notes: '' }))
  ];
}

test('P09 建议、跨班警告、保存、混住阻断和修正共用统一住宿来源', (context) => {
  const fixture = setup(context); const suggestion = fixture.business.suggestLodging(fixture.project.id, { rooms: roomDraft() });
  assert.equal(suggestion.ok, true); assert.deepEqual(suggestion.data.totals, { rooms: 35, nights: 1, capacity: 140, expected: 136, assigned: 136, emptyBeds: 4, missingPeople: 0, expectedPerNight: 136 });
  assert.ok(suggestion.data.crossClassRooms.length > 0); assert.equal(fixture.repository.counts(fixture.project.id).rooms, 0, '建议预览不能写入数据库');
  let saved = fixture.business.saveLodging(fixture.project.id, suggestion.data.rooms); assert.equal(saved.ok, true);
  assert.equal(saved.data.lodging.reduce((sum, room) => sum + room.allocated, 0), 136);
  const crossClassWarning = saved.data.exceptions.find((row) => row.code === 'CROSS_CLASS_ROOM' && row.severity === '警告' && row.status === '待处理');
  assert.ok(crossClassWarning);
  assert.equal(fixture.business.confirmException(crossClassWarning.id, { reason: '' }).error.code, 'EXCEPTION_REASON_REQUIRED');
  assert.equal(fixture.business.confirmException(crossClassWarning.id, { reason: '同性别且双方班主任已核对人数' }).data.status, '已确认例外');
  assert.equal(fixture.business.recalculate(fixture.project.id).data.exceptions.find((row) => row.id === crossClassWarning.id).status, '已确认例外');
  assert.equal(saved.data.exceptions.some((row) => row.module === '住宿' && row.severity === '阻断' && row.status === '待处理'), false);

  const mixed = structuredClone(suggestion.data.rooms); const maleRoom = mixed.find((room) => room.allocations.some((row) => row.role === '老师' && row.gender === '男'));
  const maleAllocation = maleRoom.allocations.find((row) => row.role === '老师' && row.gender === '男'); maleAllocation.peopleCount -= 1; if (!maleAllocation.peopleCount) maleRoom.allocations.splice(maleRoom.allocations.indexOf(maleAllocation), 1);
  const femaleRoom = mixed.find((room) => room.genderRule === '女' && room.allocations.reduce((sum, row) => sum + row.peopleCount, 0) < room.capacity); femaleRoom.allocations.push({ role: '老师', gender: '男', peopleCount: 1 });
  saved = fixture.business.saveLodging(fixture.project.id, mixed); assert.ok(saved.data.exceptions.some((row) => row.code === 'ROOM_GENDER_MISMATCH' && row.status === '待处理'));
  saved = fixture.business.saveLodging(fixture.project.id, suggestion.data.rooms); assert.equal(saved.data.exceptions.some((row) => row.module === '住宿' && row.severity === '阻断' && row.status === '待处理'), false);
});

test('P09 定位容量不足、重复房号、来源变化和不适用项目', (context) => {
  const fixture = setup(context); const shortage = fixture.business.suggestLodging(fixture.project.id, { rooms: roomDraft(18, 16) });
  assert.equal(shortage.ok, true); assert.equal(shortage.data.totals.missingPeople, 3); assert.ok(shortage.data.unassigned.every((row) => row.gender === '女'));
  const duplicate = roomDraft(); duplicate[1].roomNumber = duplicate[0].roomNumber;
  assert.equal(fixture.business.saveLodging(fixture.project.id, duplicate).error.code, 'DUPLICATE_LODGING_ROOM');
  const suggestion = fixture.business.suggestLodging(fixture.project.id, { rooms: roomDraft() }).data; assert.equal(fixture.business.saveLodging(fixture.project.id, suggestion.rooms).ok, true);
  const changed = structuredClone(fixture.classes); changed[0].teachers[0].needsLodging = false;
  const afterSourceChange = fixture.business.savePeople(fixture.project.id, { classes: changed, manualStaff: [] }).data;
  assert.ok(afterSourceChange.exceptions.some((row) => row.code === 'LODGING_STAFF_MISMATCH' && row.status === '待处理'));
  const day = fixture.business.createProject({ id: 'p09-day', schoolId: fixture.project.school_id, grade: '一年级', destination: '脱敏日营', startsOn: '2026-11-01', endsOn: '2026-11-01' }).data;
  assert.equal(fixture.business.suggestLodging(day.id, { rooms: roomDraft() }).error.code, 'LODGING_NOT_APPLICABLE');
  assert.equal(fixture.repository.counts(day.id).rooms, 0);
});
