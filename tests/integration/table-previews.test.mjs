import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createBusinessRepository } from '../../src/db/repositories/business.mjs';
import { createOperationLogRepository } from '../../src/db/repositories/operation-logs.mjs';
import { createSchoolRepository } from '../../src/db/repositories/schools.mjs';
import { createAuditService } from '../../src/services/audit.mjs';
import { createBusinessService } from '../../src/services/business.mjs';
import { createExportService } from '../../src/services/exports.mjs';
import { createSensitiveValueProtector } from '../../src/services/sensitive-values.mjs';
import { createSchoolService } from '../../src/services/schools.mjs';

const now = '2026-09-16T06:00:00.000Z';

function setup(context) {
  const db = openDatabase(':memory:'); migrate(db); const directory = mkdtempSync(join(tmpdir(), 'table-preview-'));
  context.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const schoolRepository = createSchoolRepository(db); const repository = createBusinessRepository(db); const operationLogs = createOperationLogRepository(db);
  const audit = createAuditService(operationLogs, () => now); const protector = createSensitiveValueProtector('t25-integration-sensitive-key');
  const schools = createSchoolService({ db, repository: schoolRepository, clock: () => now });
  const business = createBusinessService({ db, repository, schoolRepository, audit, clock: () => now });
  const exports = createExportService({ repository, business, exportsPath: directory, audit, revealSensitive: protector.reveal, clock: () => now });
  const school = schools.create({ name: 'T24 脱敏学校', contacts: [{ name: '联系人', phone: '13800002401', isDefault: true }] }).data;
  const project = business.createProject({ id: 't24-main', schoolId: school.id, grade: '八年级', destination: '脱敏基地', startsOn: '2026-10-10', endsOn: '2026-10-11',
    meetingPlace: '学校门口', meetingAt: '2026-10-10T07:00', itinerary: '脱敏行程', needsLodging: true, includesMeals: true, mealCount: 1 }).data;
  const people = business.savePeople(project.id, { classes: [{ id: 't24-c1', name: '801', studentTotal: 10, boys: 5, girls: 5, guideRequired: 1,
    teachers: [{ id: 't24-t1', name: '测试老师', phone: '13800002402', gender: '女', ridesVehicle: true, needsLodging: true, joinsDefaultMeals: true }] }], manualStaff: [] }).data;
  const guide = business.createGuide({ id: 't24-g1', name: '测试导游', workPhone: '13900002401', gender: '女', idNumberEncrypted: protector.protect('430102199001011234'), guideLicenseEncrypted: protector.protect('D-T25-5678'),
    documents: [{ documentType: '身份证', maskedNumber: '**************1234', expiresOn: '2027-12-31' }, { documentType: '导游证', maskedNumber: '******5678', expiresOn: '2027-12-31' }] }).data;
  const batch = business.recruit(project.id, { rawText: 'T24 脱敏接龙', entries: [{ order: 1, name: guide.name, phone: guide.work_phone }] }).data;
  business.assignGuide(batch.rows[0].id, { classIds: [people.classes[0].id], needsLodging: true, joinsDefaultMeals: true });
  const vehicle = { vehicleLabel: '1车', fleetName: '脱敏车队', vehicleModel: '20座大巴', plateNumber: '湘A24001', capacity: 20,
    driverName: '测试司机', driverPhone: '13700002401', driverGender: '男', driverNeedsLodging: true, driverJoinsDefaultMeals: true };
  business.saveTransport(project.id, business.suggestTransport(project.id, { vehicles: [vehicle] }).data.vehicles);
  const rooms = ['M1','M2'].map((roomNumber) => ({ lodgingName: '脱敏酒店', checkInOn: '2026-10-10', building: '主楼', floorLabel: '2层', roomNumber, roomType: '四人间', capacity: 4, genderRule: '男' }))
    .concat(['F1','F2'].map((roomNumber) => ({ lodgingName: '脱敏酒店', checkInOn: '2026-10-10', building: '主楼', floorLabel: '3层', roomNumber, roomType: '四人间', capacity: 4, genderRule: '女' })));
  business.saveLodging(project.id, business.suggestLodging(project.id, { rooms }).data.rooms);
  const meal = { name: '午餐', restaurantName: '脱敏餐厅', mealAt: '2026-10-10T12:00', seatsPerTable: 10, tablePrefix: 'A', tables: [] };
  business.saveMeals(project.id, business.suggestMeals(project.id, { sessions: [meal], includeStaff: true }).data.sessions);
  return { db, directory, repository, operationLogs, audit, protector, business, exports, project };
}

test('P16/P17 四类表共用当前项目投影，保险脱敏且关键合计一致', (context) => {
  const f = setup(context);
  const center = f.exports.tableCenter(f.project.id, { recalculate: true });
  assert.equal(center.ok, true);
  assert.deepEqual(center.data.tables.map((row) => [row.type, row.status]), [['insurance','ready'],['transport','ready'],['lodging','ready'],['meals','ready']]);
  const insurance = f.exports.preview(f.project.id, 'insurance').data;
  assert.deepEqual(insurance.rows, [{ guideName: '测试导游', idNumber: '**************1234', phone: '13900002401', licenseNumber: '******5678' }]);
  assert.equal(JSON.stringify(insurance).includes('encrypted-id'), false);
  assert.deepEqual(f.exports.preview(f.project.id, 'transport').data.totals, { vehicles: 1, students: 10, teachers: 1, guides: 1, people: 12, seats: 20, emptySeats: 8 });
  assert.deepEqual(f.exports.preview(f.project.id, 'lodging').data.totals, { people: 13, rooms: 4, capacity: 16, remaining: 3 });
  assert.deepEqual(f.exports.preview(f.project.id, 'meals').data.totals.sessions, [{ name: '午餐', restaurantName: '脱敏餐厅', people: 13, suggestedTables: 2, bookedTables: 2, capacity: 20, remaining: 7 }]);
});

test('源数据变化后快照版本立即过期，旧版本和缺失版本均不能导出', async (context) => {
  const f = setup(context); const preview = f.exports.preview(f.project.id, 'transport').data;
  assert.equal(f.exports.previewStatus(f.project.id, 'transport', preview.dataVersion).data.stale, false);
  const current = f.business.summary(f.project.id);
  const changedClass = current.classes[0];
  f.business.savePeople(f.project.id, { classes: [{ id: changedClass.id, name: changedClass.name, studentTotal: 11, boys: 5, girls: 6, guideRequired: 1,
    teachers: changedClass.teachers.map((row) => ({ id: row.id, role: row.role, name: row.name, phone: row.phone, gender: row.gender, ridesVehicle: true, needsLodging: true, joinsDefaultMeals: true })) }], manualStaff: [] });
  assert.equal(f.exports.previewStatus(f.project.id, 'transport', preview.dataVersion).data.stale, true);
  assert.equal((await f.exports.exportFile(f.project.id, 'transport', { previewVersion: preview.dataVersion })).error.code, 'PREVIEW_STALE');
  assert.equal((await f.exports.exportFile(f.project.id, 'transport', {})).error.code, 'PREVIEW_VERSION_REQUIRED');
  assert.equal(f.repository.exports(f.project.id).length, 0);
});

test('一日且不含餐项目的 P16 只保留保险与乘车固定入口', (context) => {
  const f = setup(context);
  const day = f.business.createProject({ id: 't24-day', schoolId: f.project.school_id, grade: '一年级', destination: '脱敏营地', startsOn: '2026-11-01', endsOn: '2026-11-01' }).data;
  const center = f.exports.tableCenter(day.id);
  assert.deepEqual(center.data.tables.map((row) => row.type), ['insurance', 'transport']);
});

test('四类 Excel 写入受控目录并回读字段、中文、合计、哈希和完整保险号码', async (context) => {
  const f = setup(context); const fullId = '430102199001011234'; const fullLicense = 'D-T25-5678';
  const expectedHeaders = {
    insurance: ['导游姓名','身份证号码','联系电话','导游证号码'],
    transport: ['车号','班级','班主任 / 配班老师','老师电话','研学导游','导游电话','班级学生','男生','女生','本车学生','随车老师','导游人数','本车人数','可用座位','空车位','车型','车牌号','司机','司机电话','备注'],
    lodging: ['酒店','入住日期','楼栋','楼层','房间号','房型','容量','班级','性别','角色','安排人数','跨班拼房信息','备注'],
    meals: ['餐次','餐厅','用餐时间','桌号','每桌人数','班级','角色','人数','拼桌信息','建议桌数','实际预订桌数','桌数差额','备注']
  };
  const results = {};
  const manifest = [];
  for (const type of ['insurance','transport','lodging','meals']) {
    const preview = f.exports.preview(f.project.id, type).data;
    const result = await f.exports.exportFile(f.project.id, type, { previewVersion: preview.dataVersion, purpose: type === 'insurance' ? '提交本项目保险投保' : '', confirmed: type === 'insurance' });
    assert.equal(result.ok, true, `${type} 应生成成功：${JSON.stringify(result.error || {})}；记录：${JSON.stringify(f.repository.exports(f.project.id).at(-1) || {})}`); results[type] = result.data;
    const path = join(f.directory, f.project.id, result.data.filename); assert.equal(existsSync(path), true);
    const content = readFileSync(path); assert.equal(createHash('sha256').update(content).digest('hex'), result.data.sha256); assert.equal(content.subarray(0, 2).toString(), 'PK');
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(path); const sheet = workbook.worksheets[0];
    assert.deepEqual(sheet.getRow(4).values.slice(1, expectedHeaders[type].length + 1), expectedHeaders[type]);
    assert.match(sheet.getCell('A2').text, /T24 脱敏学校/); assert.match(sheet.getCell('A3').text, /项目ID：t24-main/);
    const downloaded = await f.exports.downloadFile(result.data.id); assert.equal(downloaded.ok, true); assert.equal(downloaded.data.sha256, result.data.sha256);
    const sampleDirectory = resolve('test-results', 't25-excel-samples'); mkdirSync(sampleDirectory, { recursive: true });
    const samplePath = join(sampleDirectory, `${type}.xlsx`); copyFileSync(path, samplePath);
    manifest.push({ type, filename: `${type}.xlsx`, rows: result.data.rowCount, sizeBytes: result.data.sizeBytes, sha256: result.data.sha256 });
  }
  writeFileSync(resolve('test-results', 't25-excel-samples', 'manifest.json'), `${JSON.stringify({ generatedFrom: '脱敏合成项目 t24-main', files: manifest }, null, 2)}\n`, 'utf8');
  const insuranceWorkbook = new ExcelJS.Workbook(); await insuranceWorkbook.xlsx.readFile(join(f.directory, f.project.id, results.insurance.filename));
  assert.equal(insuranceWorkbook.worksheets[0].getCell('B5').text, fullId); assert.equal(insuranceWorkbook.worksheets[0].getCell('D5').text, fullLicense);
  const transportWorkbook = new ExcelJS.Workbook(); await transportWorkbook.xlsx.readFile(join(f.directory, f.project.id, results.transport.filename));
  const transportSummary = new Map(transportWorkbook.worksheets[0].getRows(7, 8).map((row) => [row.getCell(1).value, row.getCell(2).value]));
  assert.deepEqual({ students: transportSummary.get('学生'), people: transportSummary.get('总乘车人数'), seats: transportSummary.get('可用座位'), empty: transportSummary.get('空车位') }, { students: 10, people: 12, seats: 20, empty: 8 });
  const logText = JSON.stringify(f.operationLogs.list({ projectId: f.project.id, operationType: '导出' }));
  assert.equal(logText.includes(fullId), false); assert.equal(logText.includes(fullLicense), false); assert.equal(f.repository.exports(f.project.id).filter((row) => row.status === '成功').length, 4);
});

test('保险缺少二次确认会拒绝并审计，写盘失败不留临时文件且记录失败原因', async (context) => {
  const f = setup(context); const insurancePreview = f.exports.preview(f.project.id, 'insurance').data;
  const refused = await f.exports.exportFile(f.project.id, 'insurance', { previewVersion: insurancePreview.dataVersion, purpose: '投保' });
  assert.equal(refused.error.code, 'SENSITIVE_CONFIRMATION_REQUIRED');
  assert.ok(f.operationLogs.list({ projectId: f.project.id, operationType: '导出', result: '失败' }).some((row) => row.failureReason === '缺少二次确认或用途'));
  const failing = createExportService({ repository: f.repository, business: f.business, exportsPath: f.directory, audit: f.audit, revealSensitive: f.protector.reveal,
    writeWorkbook: async () => { throw new Error('SIMULATED_WRITE_FAILURE'); }, clock: () => now });
  const transportPreview = failing.preview(f.project.id, 'transport').data;
  const failed = await failing.exportFile(f.project.id, 'transport', { previewVersion: transportPreview.dataVersion });
  assert.equal(failed.error.code, 'EXPORT_FAILED');
  const record = f.repository.exports(f.project.id).at(-1); assert.equal(record.status, '失败'); assert.equal(record.error_summary, 'SIMULATED_WRITE_FAILURE'); assert.equal(record.controlled_file_ref, '');
  const projectDirectory = join(f.directory, f.project.id); assert.equal(readdirSync(projectDirectory).some((name) => name.endsWith('.tmp')), false);
});
