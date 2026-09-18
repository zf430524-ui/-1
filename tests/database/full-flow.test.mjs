import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createBusinessRepository } from '../../src/db/repositories/business.mjs';
import { createImportRepository } from '../../src/db/repositories/imports.mjs';
import { createOperationLogRepository } from '../../src/db/repositories/operation-logs.mjs';
import { createSchoolRepository } from '../../src/db/repositories/schools.mjs';
import { createAuditService } from '../../src/services/audit.mjs';
import { createBackupService } from '../../src/services/backups.mjs';
import { createBusinessService } from '../../src/services/business.mjs';
import { createExportService } from '../../src/services/exports.mjs';
import { createImportService } from '../../src/services/imports.mjs';
import { createSchoolService } from '../../src/services/schools.mjs';

function distribute(capacity, count, gender, parts, make) {
  const queue = parts.map(([role, remaining]) => ({ role, remaining }));
  return Array.from({ length: count }, (_, index) => {
    let free = capacity;
    const allocations = [];
    while (free && queue.some((x) => x.remaining)) {
      const item = queue.find((x) => x.remaining);
      const peopleCount = Math.min(free, item.remaining);
      allocations.push({ role: item.role, gender, peopleCount });
      item.remaining -= peopleCount; free -= peopleCount;
    }
    return make(index, allocations);
  });
}

function rooms(prefix, gender, parts, count) {
  return distribute(4, count, gender, parts, (index, allocations) => ({ lodgingName: '脱敏住宿点', checkInOn: '2026-10-10', building: gender === '男' ? '3栋' : '4栋', floorLabel: '测试层', roomNumber: `${prefix}${index + 1}`, roomType: '四人间', capacity: 4, genderRule: gender, allocations }));
}

function setup(context) {
  const root = mkdtempSync(join(tmpdir(), 'study-db-flow-'));
  const databasePath = join(root, 'data', 'workbench.sqlite');
  const certificatesPath = join(root, 'certificates');
  const backupsPath = join(root, 'backups');
  const exportsPath = join(root, 'exports');
  const importsPath = join(root, 'imports');
  mkdirSync(certificatesPath, { recursive: true });
  let db; let tick = 0;
  const clock = () => new Date(Date.UTC(2026, 8, 15, 3, 0, tick++)).toISOString();
  const open = () => { db = openDatabase(databasePath); migrate(db); };
  const close = () => { if (db?.open) db.close(); };
  open();
  const schoolRepository = createSchoolRepository(db);
  const auditRepository = createOperationLogRepository(db);
  const audit = createAuditService(auditRepository, clock);
  const schools = createSchoolService({ db, repository: schoolRepository, clock });
  const repository = createBusinessRepository(db);
  const business = createBusinessService({ db, repository, schoolRepository, audit, clock });
  const exports = createExportService({ repository, business, exportsPath, audit, clock });
  const imports = createImportService({ db, repository: createImportRepository(db), schoolRepository, schools, audit, importsPath, targetWriters: business.importWriters(), clock });
  const backup = createBackupService({ databasePath, certificatesPath, backupsPath, getDatabase: () => db, closeDatabase: close, reopenDatabase: open,
    recordAudit: (entry) => createAuditService(createOperationLogRepository(db), clock).record(entry), listAudit: (filters) => createOperationLogRepository(db).list(filters), clock });
  context.after(() => { close(); rmSync(root, { recursive: true, force: true }); });
  return { get db() { return db; }, exportsPath, schools, repository, business, exports, imports, backup };
}

test('同一SQLite项目跑通业务、异常修正、Excel、重启与恢复', async (context) => {
  const f = setup(context);
  assert.equal(f.db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(f.db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(f.db.pragma('busy_timeout', { simple: true }), 5000);
  const school = f.schools.create({ name: '脱敏实验学校', contacts: [{ name: '测试联系人', phone: '13800000001', isDefault: true }] }).data;
  const project = f.business.createProject({ id: 'project-main', schoolId: school.id, grade: '八年级', destination: '脱敏研学地', startsOn: '2026-10-10', endsOn: '2026-10-11', needsLodging: true, includesMeals: true, mealCount: 2 }).data;
  assert.equal(project.school_lead_name, '测试联系人');
  f.business.updateProject(project.id, { schoolLeadName: '项目联系人', schoolLeadPhone: '13800000002' });
  assert.equal(f.schools.get(school.id).data.contacts[0].name, '测试联系人');
  assert.equal(f.schools.remove(school.id).error.code, 'SCHOOL_IN_USE');
  assert.equal(f.business.savePeople(project.id, { classes: [{ name: '801', studentTotal: 41, boys: 22, girls: 20 }] }).error.code, 'STUDENT_TOTAL_MISMATCH');
  const classes = [
    { id: 'c801', name: '801', studentTotal: 42, boys: 22, girls: 20, teachers: [{ name: '老师甲', phone: '13800000101', gender: '男', needsLodging: true, joinsDefaultMeals: true }, { name: '老师乙', phone: '13800000102', gender: '女', needsLodging: true, joinsDefaultMeals: true }] },
    { id: 'c802', name: '802', studentTotal: 43, boys: 21, girls: 22, teachers: [{ name: '老师丙', phone: '13800000103', gender: '男', needsLodging: true, joinsDefaultMeals: true }, { name: '老师丁', phone: '13800000104', gender: '女', needsLodging: true, joinsDefaultMeals: true }] },
    { id: 'c803', name: '803', studentTotal: 40, boys: 20, girls: 20, teachers: [{ name: '老师戊', phone: '13800000105', gender: '女', needsLodging: true, joinsDefaultMeals: true }] }
  ];
  assert.equal(f.business.savePeople(project.id, { classes }).data.students, 125);
  const guides = [['g1', '导游甲', '13900000001', '男'], ['g2', '导游乙', '13900000002', '男'], ['g3', '导游丙', '13900000003', '女'], ['g4', '导游丁', '13900000004', '男']]
    .map(([id, name, workPhone, gender]) => f.business.createGuide({ id, name, workPhone, gender, idNumberEncrypted: `encrypted-${id}`, guideLicenseEncrypted: `license-${id}`, documents: [{ documentType: '导游证', maskedNumber: '****', expiresOn: '2027-12-31' }] }).data);
  const recruitment = f.business.recruit(project.id, { rawText: '脱敏接龙1-3', entries: guides.map((g, index) => ({ order: index + 1, name: g.name, phone: g.work_phone })) }).data;
  recruitment.rows.slice(0, 3).forEach((row, index) => assert.equal(f.business.assignGuide(row.id, { classIds: [`c80${index + 1}`], needsLodging: true, joinsDefaultMeals: true }).ok, true));
  assert.equal(f.business.withdrawGuide(recruitment.rows[0].id, { reason: '脱敏退团原因', replacementProjectGuideId: recruitment.rows[3].id }).data.guides.filter((x) => x.handling_status === '保留').length, 2);
  assert.ok(f.business.summary(project.id).exceptions.some((x) => x.code === 'GUIDE_GAP' && x.status === '待处理'));
  assert.equal(f.business.assignGuide(recruitment.rows[3].id, { classIds: ['c801'], needsLodging: true, joinsDefaultMeals: true }).ok, true);
  const vehicleDraft = [
    { vehicleLabel: '1车', fleetName: '脱敏测试车队', vehicleModel: '49座大巴', plateNumber: '测试车牌1', capacity: 49, driverName: '司机甲', driverPhone: '13700000001', driverGender: '男', driverNeedsLodging: true, driverJoinsDefaultMeals: true },
    { vehicleLabel: '2车', fleetName: '脱敏测试车队', vehicleModel: '49座大巴', plateNumber: '测试车牌2', capacity: 49, driverName: '司机乙', driverPhone: '13700000002', driverGender: '男', driverNeedsLodging: true, driverJoinsDefaultMeals: true },
    { vehicleLabel: '3车', fleetName: '脱敏测试车队', vehicleModel: '49座大巴', plateNumber: '测试车牌3', capacity: 49, driverName: '司机丙', driverPhone: '13700000003', driverGender: '女', driverNeedsLodging: true, driverJoinsDefaultMeals: true }
  ];
  const plannedVehicles = f.business.suggestTransport(project.id, { vehicles: vehicleDraft }).data.vehicles;
  const vehicles = (capacity = 49) => { const rows = structuredClone(plannedVehicles); rows[2].capacity = capacity; return rows; };
  assert.ok(f.business.saveTransport(project.id, vehicles(41)).data.exceptions.some((x) => x.code === 'VEHICLE_OVERLOAD' && x.status === '待处理'));
  assert.equal(f.business.complete(project.id).error.code, 'PROJECT_BLOCKED');
  assert.equal(f.business.saveTransport(project.id, vehicles()).data.transport.reduce((n, x) => n + x.allocated, 0), 133);
  const roomDrafts = [...rooms('M', '男', [], 18), ...rooms('F', '女', [], 17)];
  const roomRows = f.business.suggestLodging(project.id, { rooms: roomDrafts }).data.rooms;
  const wrong = structuredClone(roomRows); wrong[0].genderRule = '女';
  assert.ok(f.business.saveLodging(project.id, wrong).data.exceptions.some((x) => x.code === 'ROOM_GENDER_MISMATCH' && x.status === '待处理'));
  assert.equal(f.business.saveLodging(project.id, roomRows).data.lodging.reduce((n, x) => n + x.allocated, 0), 136);
  const mealDrafts = ['午餐', '晚餐'].map((name, index) => ({ name, restaurantName: `脱敏餐厅${index + 1}`, mealAt: `2026-10-10T${index ? '18' : '12'}:00:00.000Z`, seatsPerTable: 10, tablePrefix: index ? 'B' : 'A', tables: [] }));
  const sessions = f.business.suggestMeals(project.id, { sessions: mealDrafts, includeStaff: true }).data.sessions;
  const short = structuredClone(sessions); short[0].tables.pop();
  assert.ok(f.business.saveMeals(project.id, short).data.exceptions.some((x) => x.code === 'MEAL_PEOPLE_MISMATCH' && x.status === '待处理'));
  assert.ok(f.business.saveMeals(project.id, sessions).data.meals.every((x) => x.allocated === 136));
  assert.equal(f.business.complete(project.id).data.project.status, '已完成安排');
  for (const type of ['insurance', 'transport', 'lodging', 'meals']) {
    const preview = f.exports.preview(project.id, type);
    assert.equal(preview.ok, true);
    const result = await f.exports.exportFile(project.id, type, { purpose: '数据库脱敏验收', confirmed: type === 'insurance', previewVersion: preview.data.dataVersion });
    assert.equal(result.ok, true); assert.equal(existsSync(join(f.exportsPath, result.data.fileRef)), true);
  }
  const version = f.business.summary(project.id).project.data_version;
  f.business.saveTransport(project.id, vehicles());
  assert.equal(f.business.summary(project.id).project.status, '待检查');
  assert.ok(f.business.summary(project.id).project.data_version > version);
  assert.ok(f.repository.exports(project.id).every((x) => x.status === '已过期'));
  assert.equal(f.business.complete(project.id).ok, true);
  const day = f.business.createProject({ id: 'project-day', schoolId: school.id, grade: '一年级', destination: '脱敏营地', startsOn: '2026-11-01', endsOn: '2026-11-01' }).data;
  assert.equal(f.business.saveLodging(day.id, [{ roomNumber: '1' }]).error.code, 'LODGING_NOT_APPLICABLE');
  assert.equal(f.business.saveMeals(day.id, [{ name: '午餐' }]).error.code, 'MEALS_NOT_APPLICABLE');
  assert.equal(f.repository.counts(day.id).rooms, 0); assert.equal(f.repository.counts(day.id).meals, 0);
  const imported = f.business.createProject({ id: 'project-import', schoolId: school.id, grade: '二年级', destination: '脱敏参考项目', startsOn: '2026-12-01', endsOn: '2026-12-02', needsLodging: true, includesMeals: true, mealCount: 1 }).data;
  for (const [targetType, text] of [
    ['classes_teachers', '班级名称,学生总数,男生人数,女生人数,老师角色,老师姓名,老师电话,老师性别,是否乘车,是否住宿,默认参加用餐\n201,30,16,14,班主任,测试老师,13800000201,女,是,是,是'],
    ['guide_recruitment', '1. 导游甲 13900000001'],
    ['transport', '车号,可用座位数,司机姓名,司机电话,司机性别\n1车,37,测试司机,13700000201,男'],
    ['lodging', '住宿点,入住日期,楼栋,楼层,房号,房型,床位数,性别规则\n脱敏住宿点,2026-12-01,主楼,2层,201,四人间,4,男'],
    ['meals', '餐次,餐厅名称,用餐时间,每桌人数,预订桌数\n午餐,脱敏餐厅,2026-12-01 12:00,10,4']
  ]) {
    const batch = await f.imports.create({ projectId: imported.id, targetType, importMethod: '粘贴文字', text });
    assert.equal(batch.ok, true, `${targetType} 应进入临时区`);
    assert.equal(f.imports.confirm(batch.data.id, { strategy: 'all_or_nothing' }).ok, true, `${targetType} 应确认写入`);
  }
  assert.deepEqual(f.repository.counts(imported.id), { classes: 1, guides: 0, vehicles: 1, rooms: 1, meals: 1 });
  const backup = await f.backup.createBackup({ note: '完整项目数据库验收' });
  f.db.prepare("UPDATE projects SET special_notes='备份后临时标记' WHERE id='project-main'").run();
  assert.equal((await f.backup.restore(backup.data.backup.id, { confirmation: backup.data.backup.id, backupCurrent: true })).ok, true);
  assert.equal(f.db.prepare("SELECT special_notes FROM projects WHERE id='project-main'").get().special_notes, '');
  assert.equal(f.db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(f.db.pragma('foreign_key_check'), []);
});
