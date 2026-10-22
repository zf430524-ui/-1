import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createId } from '../db/id.mjs';
import { exceptionActionPath } from './business.mjs';
import { failure, success } from './result.mjs';

const definitions = {
  insurance: {
    label: '保险名单', recordLabel: '保险名单', source: 'insuranceRows', module: '导游',
    columns: [['guideName','导游姓名'],['idNumber','身份证号码'],['phone','联系电话'],['licenseNumber','导游证号码']]
  },
  transport: {
    label: '乘车安排表', recordLabel: '乘车表', source: 'transportDetails', module: '乘车',
    columns: [['vehicleLabel','车号'],['className','班级'],['teachers','班主任 / 配班老师'],['teacherPhones','老师电话'],['guides','研学导游'],['guidePhones','导游电话'],['classStudents','相关班级学生'],['boys','本车男生'],['girls','本车女生'],['vehicleStudents','本车学生'],['teacherCount','随车老师'],['guideCount','导游人数'],['vehicleTotal','本车人数'],['usableSeats','可用座位'],['emptySeats','空车位'],['vehicleModel','车型'],['plateNumber','车牌号'],['driver','司机'],['driverPhone','司机电话'],['arrangementState','安排状态'],['arrangementSummary','合班 / 拆班 / 空位'],['specialRequirements','特殊安排要求'],['notes','备注']]
  },
  lodging: {
    label: '住宿安排表', recordLabel: '住宿表', source: 'lodgingDetails', module: '住宿',
    columns: [['lodgingName','酒店'],['lodgingAddress','住宿地址'],['checkInOn','入住日期 / 晚次'],['building','楼栋'],['floor','楼层'],['roomNumber','房间号'],['roomType','房型'],['capacity','容量'],['emptyBeds','空床'],['className','班级'],['gender','性别'],['role','角色'],['peopleCount','安排人数'],['crossClassReason','跨班拼房信息'],['arrangementState','安排状态'],['arrangementSummary','状态说明'],['specialRequirements','特殊安排要求'],['notes','备注']]
  },
  meals: {
    label: '用餐安排表', recordLabel: '用餐表', source: 'mealDetails', module: '用餐',
    columns: [['sessionName','餐次'],['restaurantName','餐厅'],['mealAt','用餐时间'],['tableNumber','桌号'],['seatsPerTable','每桌人数'],['emptySeats','空位'],['className','班级'],['role','角色'],['peopleCount','人数'],['sharedTableReason','拼桌信息'],['suggestedTables','建议桌数'],['bookedTables','实际预订桌数'],['tableDifference','桌数差额'],['arrangementState','安排状态'],['arrangementSummary','状态说明'],['specialRequirements','特殊安排要求'],['notes','备注']]
  }
};

function safeProjectDirectory(root, projectId) {
  const directory = resolve(root, projectId);
  const child = relative(resolve(root), directory);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('INVALID_EXPORT_PATH');
  return directory;
}

function safeControlledFile(root, fileRef) {
  const file = resolve(root, fileRef);
  const child = relative(resolve(root), file);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('INVALID_EXPORT_PATH');
  return file;
}

const safeFilenamePart = (value) => String(value || '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'project';

const number = (value) => Number(value || 0);

function tableApplicable(project, type) {
  return type === 'lodging' ? Boolean(project.needs_lodging) : type === 'meals' ? Boolean(project.includes_meals) : true;
}

function sourcePath(type, projectId) {
  const path = { insurance: '/projects/guides', transport: '/projects/transport', lodging: '/projects/lodging', meals: '/projects/meals' }[type];
  return `${path}?project=${encodeURIComponent(projectId)}`;
}

function syntheticIssue(type, projectId, code, message) {
  return { code, message, module: definitions[type].module, severity: '阻断', actionPath: sourcePath(type, projectId) };
}

function transportProjection(summary) {
  const classes = new Map(summary.classes.map((row) => [row.id, row]));
  const rows = [];
  for (const vehicle of summary.transport) {
    const groups = new Map();
    for (const allocation of vehicle.allocations) {
      const id = allocation.class_id || '';
      const group = groups.get(id) || { classId: id, students: 0, boys: 0, girls: 0, teachers: 0, guides: [], notes: [] };
      if (allocation.role === '学生') { group.students += number(allocation.people_count); group.boys += number(allocation.boys_count); group.girls += number(allocation.girls_count); }
      if (allocation.role === '老师') group.teachers += number(allocation.people_count);
      if (allocation.role === '导游') group.guides.push({ name: allocation.guide_name || '', phone: allocation.guide_phone || '' });
      if (allocation.notes) group.notes.push(allocation.notes);
      groups.set(id, group);
    }
    if (!groups.size) groups.set('', { classId: '', students: 0, boys: 0, girls: 0, teachers: 0, guides: [], notes: [] });
    const usableSeats = number(vehicle.capacity) - number(vehicle.safety_reserve);
    const vehicleTotal = number(vehicle.allocated);
    const values = [...groups.values()]; const classRows = values.map((group) => classes.get(group.classId)).filter(Boolean);
    const ridingTeachers = classRows.flatMap((row) => row.teachers?.filter((teacher) => teacher.rides_vehicle) || []);
    const teacherCount = values.reduce((sum, group) => sum + group.teachers, 0); const guideRows = values.flatMap((group) => group.guides);
    rows.push({ vehicleLabel: vehicle.vehicle_label, className: classRows.map((row) => row.name).join('、'),
      teachers: teacherCount === ridingTeachers.length ? ridingTeachers.map((row) => row.name).join('、') : teacherCount ? `${teacherCount} 名（P08 按人数记录）` : '',
      teacherPhones: teacherCount === ridingTeachers.length ? ridingTeachers.map((row) => row.phone).filter(Boolean).join('、') : '',
      guides: guideRows.map((row) => row.name).filter(Boolean).join('、'), guidePhones: guideRows.map((row) => row.phone).filter(Boolean).join('、'),
      classStudents: classRows.reduce((sum, row) => sum + number(row.student_total), 0), boys: values.reduce((sum, group) => sum + group.boys, 0),
      girls: values.reduce((sum, group) => sum + group.girls, 0), vehicleStudents: values.reduce((sum, group) => sum + group.students, 0),
      teacherCount, guideCount: guideRows.length, vehicleTotal, usableSeats, emptySeats: usableSeats - vehicleTotal,
      vehicleModel: vehicle.vehicle_model, plateNumber: vehicle.plate_number, driver: vehicle.driver_name, driverPhone: vehicle.driver_phone,
      arrangementState: vehicle.arrangement_state, arrangementSummary: vehicle.arrangement_summary, specialRequirements: vehicle.special_requirements,
      notes: [vehicle.notes, ...values.flatMap((group) => group.notes)].filter(Boolean).join('；') });
  }
  return { rows, totals: { vehicles: summary.transport.length,
    students: summary.transport.flatMap((row) => row.allocations).filter((row) => row.role === '学生').reduce((sum, row) => sum + number(row.people_count), 0),
    teachers: summary.transport.flatMap((row) => row.allocations).filter((row) => row.role === '老师').reduce((sum, row) => sum + number(row.people_count), 0),
    guides: summary.transport.flatMap((row) => row.allocations).filter((row) => row.role === '导游').reduce((sum, row) => sum + number(row.people_count), 0),
    people: summary.transport.reduce((sum, row) => sum + number(row.allocated), 0),
    seats: summary.transport.reduce((sum, row) => sum + number(row.capacity) - number(row.safety_reserve), 0),
    emptySeats: summary.transport.reduce((sum, row) => sum + number(row.capacity) - number(row.safety_reserve) - number(row.allocated), 0) } };
}

function projectTable(repository, summary, type) {
  if (type === 'insurance') {
    const source = repository.insuranceRows(summary.project.id);
    return { rows: source.map((row) => ({ guideName: row.guide_name, idNumber: row.id_number_masked || (row.id_number ? '已受控保存' : '未提供'), phone: row.phone,
      licenseNumber: row.license_number_masked || (row.license_number ? '已受控保存' : '未提供') })), totals: { guides: source.length }, source };
  }
  if (type === 'transport') return transportProjection(summary);
  if (type === 'lodging') {
    const roomTotals = new Map(summary.lodging.map((room) => [room.id, number(room.capacity) - number(room.allocated)]));
    const rows = repository.lodgingDetails(summary.project.id).map((row) => ({ lodgingName: row.lodging_name, lodgingAddress: row.lodging_address, checkInOn: row.check_in_on, building: row.building,
      floor: row.floor_label, roomNumber: row.room_number, roomType: row.room_type, capacity: number(row.capacity), className: row.class_name || '',
      emptyBeds: roomTotals.get(row.id) ?? Math.max(0, number(row.capacity) - number(row.people_count)), gender: row.gender || '', role: row.role || '', peopleCount: number(row.people_count),
      crossClassReason: row.cross_class_reason || '', arrangementState: row.arrangement_state, arrangementSummary: row.arrangement_summary,
      specialRequirements: row.special_requirements, notes: row.notes || '' }));
    return { rows, totals: { people: rows.reduce((sum, row) => sum + row.peopleCount, 0), rooms: summary.lodging.length,
      capacity: summary.lodging.reduce((sum, row) => sum + number(row.capacity), 0),
      remaining: summary.lodging.reduce((sum, row) => sum + number(row.capacity) - number(row.allocated), 0) } };
  }
  const sessions = summary.meals.map((row) => ({ name: row.name, restaurantName: row.restaurant_name, people: number(row.allocated),
    suggestedTables: Math.ceil(number(row.allocated) / Math.max(1, number(row.seats_per_table))), bookedTables: number(row.actual_tables),
    capacity: number(row.actual_tables) * number(row.seats_per_table), remaining: number(row.actual_tables) * number(row.seats_per_table) - number(row.allocated) }));
  const sessionTotals = new Map(sessions.map((row) => [row.name, row]));
  const mealTableTotals = new Map(summary.meals.flatMap((session) => session.tables.map((table) => [table.id, number(table.allocated)])));
  const rows = repository.mealDetails(summary.project.id).map((row) => { const totals = sessionTotals.get(row.session_name) || {};
    return { sessionName: row.session_name, restaurantName: row.restaurant_name, mealAt: row.meal_at,
      tableNumber: row.table_number, seatsPerTable: number(row.seats_per_table), className: row.class_name || '', role: row.role || '',
      peopleCount: number(row.people_count), emptySeats: Math.max(0, number(row.seats_per_table) - number(mealTableTotals.get(row.id))), sharedTableReason: row.shared_table_reason || '', suggestedTables: totals.suggestedTables || 0,
      bookedTables: totals.bookedTables || 0, tableDifference: number(totals.bookedTables) - number(totals.suggestedTables),
      arrangementState: row.arrangement_state, arrangementSummary: row.arrangement_summary, specialRequirements: row.special_requirements,
      notes: [row.session_notes, row.table_notes].filter(Boolean).join('；') }; });
  return { rows, totals: { sessions, people: sessions.reduce((sum, row) => sum + row.people, 0), tables: sessions.reduce((sum, row) => sum + row.bookedTables, 0),
    capacity: sessions.reduce((sum, row) => sum + row.capacity, 0), remaining: sessions.reduce((sum, row) => sum + row.remaining, 0) } };
}

function summaryRows(type, totals) {
  if (type === 'insurance') return [['合计项', '数值'], ['导游人数', totals.guides]];
  if (type === 'transport') return [['合计项', '数值'], ['车辆', totals.vehicles], ['学生', totals.students], ['随车老师', totals.teachers], ['导游', totals.guides], ['总乘车人数', totals.people], ['可用座位', totals.seats], ['空车位', totals.emptySeats]];
  if (type === 'lodging') return [['合计项', '数值'], ['住宿人数', totals.people], ['房间数', totals.rooms], ['总容量', totals.capacity], ['剩余容量', totals.remaining]];
  return [['餐次', '餐厅', '人数', '建议桌数', '实际预订桌数', '容量', '余位'], ...totals.sessions.map((row) => [row.name, row.restaurantName, row.people, row.suggestedTables, row.bookedTables, row.capacity, row.remaining])];
}

function styleWorkbook(workbook, sheet, definition, dataRows, totalsRows) {
  workbook.creator = '研学团负责人工作台'; workbook.company = '本地负责人工作台'; workbook.created = new Date();
  sheet.views = [{ state: 'frozen', ySplit: 4 }];
  sheet.pageSetup = { orientation: definition.columns.length > 8 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  const lastColumn = definition.columns.length;
  sheet.mergeCells(1, 1, 1, lastColumn); sheet.mergeCells(2, 1, 2, lastColumn); sheet.mergeCells(3, 1, 3, lastColumn);
  sheet.getRow(1).font = { name: 'Microsoft YaHei', size: 16, bold: true, color: { argb: 'FF103249' } };
  sheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' }; sheet.getRow(1).height = 28;
  for (const rowNumber of [2, 3]) { sheet.getRow(rowNumber).font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF536776' } }; sheet.getRow(rowNumber).alignment = { horizontal: 'left', vertical: 'middle' }; }
  const header = sheet.getRow(4); header.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B6B61' } }; header.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; header.height = 30;
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + dataRows.length, column: lastColumn } };
  definition.columns.forEach(([key, label], index) => { const column = sheet.getColumn(index + 1); column.width = Math.min(30, Math.max(12, label.length * 2 + 4)); if (/phone|number|plate/i.test(key)) column.numFmt = '@'; });
  for (let rowNumber = 5; rowNumber < 5 + dataRows.length; rowNumber += 1) {
    const row = sheet.getRow(rowNumber); row.font = { name: 'Microsoft YaHei', size: 10 }; row.alignment = { vertical: 'middle', wrapText: true };
    row.eachCell((cell) => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFDDE6EB' } } }; });
  }
  const summaryStart = 6 + dataRows.length;
  for (let offset = 0; offset < totalsRows.length; offset += 1) {
    const row = sheet.getRow(summaryStart + offset); row.font = { name: 'Microsoft YaHei', size: 10, bold: offset === 0 };
    if (offset === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF0F3' } };
  }
  sheet.headerFooter.oddFooter = '第 &P / &N 页';
}

async function verifyWorkbookFile(path, type, projectId, expectedRows, totalsRows) {
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(path); const sheet = workbook.worksheets[0]; const definition = definitions[type];
  if (!sheet || sheet.getCell('A3').text.indexOf(`项目ID：${projectId}`) === -1) throw new Error('EXCEL_METADATA_MISMATCH');
  const headers = sheet.getRow(4).values.slice(1, definition.columns.length + 1);
  if (JSON.stringify(headers) !== JSON.stringify(definition.columns.map(([, label]) => label))) throw new Error('EXCEL_HEADER_MISMATCH');
  if (sheet.actualRowCount < expectedRows.length + totalsRows.length + 4) throw new Error('EXCEL_READBACK_MISMATCH');
  const summaryStart = 6 + expectedRows.length;
  for (let index = 0; index < totalsRows.length; index += 1) {
    const actual = sheet.getRow(summaryStart + index).values.slice(1, totalsRows[index].length + 1);
    if (JSON.stringify(actual) !== JSON.stringify(totalsRows[index])) throw new Error('EXCEL_TOTALS_MISMATCH');
  }
}

export function createExportService({ repository, business, exportsPath, audit, revealSensitive = (value) => String(value || ''), writeWorkbook = (workbook, path) => workbook.xlsx.writeFile(path), clock = () => new Date().toISOString() }) {
  function tableCenter(projectId, { recalculate = false } = {}) {
    const state = recalculate ? business.recalculate(projectId) : (() => { const data = business.summary(projectId); return data ? success(data) : failure('NOT_FOUND', '项目不存在'); })();
    if (!state.ok) return state;
    const summary = state.data; const activeBlockers = summary.exceptions.filter((row) => row.status === '待处理' && row.severity === '阻断');
    const tables = Object.keys(definitions).filter((type) => tableApplicable(summary.project, type)).map((type) => {
      const projection = projectTable(repository, summary, type); const issues = activeBlockers.map((row) => ({ code: row.code, message: row.message, module: row.module,
        severity: row.severity, actionPath: exceptionActionPath(row) }));
      if (!projection.rows.length) issues.push(syntheticIssue(type, projectId, 'NO_PREVIEW_DATA', `${definitions[type].label}没有可预览的业务数据`));
      if (type === 'insurance') for (const row of projection.source.filter((item) => !item.id_number || !item.license_number)) {
        issues.push(syntheticIssue(type, projectId, 'INSURANCE_FIELDS_MISSING', `${row.guide_name}缺少身份证号码或导游证号码`));
      }
      const exports = summary.exports.filter((row) => row.table_type === definitions[type].recordLabel); const latestExport = exports.at(-1) || null;
      return { type, label: definitions[type].label, status: issues.length ? 'blocked' : 'ready', canPreview: issues.length === 0,
        rowCount: projection.rows.length, issues, sourceUpdatedAt: summary.project.updated_at, dataVersion: summary.project.data_version,
        latestExport: latestExport ? { createdAt: latestExport.created_at, status: latestExport.status, filename: latestExport.filename, dataVersion: latestExport.data_version } : null };
    });
    return success({ project: summary.project, checkedAt: recalculate ? clock() : null, dataVersion: summary.project.data_version, tables,
      stats: { ready: tables.filter((row) => row.status === 'ready').length, blocked: tables.filter((row) => row.status === 'blocked').length,
        staleExports: tables.filter((row) => row.latestExport?.status === '已过期').length, currentExports: tables.filter((row) => row.latestExport?.status === '成功').length } });
  }

  function preview(projectId, type) {
    if (!definitions[type]) return failure('UNSUPPORTED_EXPORT', '不支持该表格类型');
    const checked = tableCenter(projectId, { recalculate: true });
    if (!checked.ok) return checked;
    const table = checked.data.tables.find((row) => row.type === type);
    if (!table) return failure('EXPORT_NOT_APPLICABLE', '该表格不适用于当前项目');
    if (!table.canPreview) return failure('TABLE_PREVIEW_BLOCKED', `${table.label}仍有 ${table.issues.length} 个阻断问题`, { issues: table.issues });
    const summary = business.summary(projectId); const projection = projectTable(repository, summary, type);
    return success({ project: summary.project, type, label: definitions[type].label,
      columns: definitions[type].columns.map(([key, label]) => ({ key, label })), rows: projection.rows, totals: projection.totals,
      dataVersion: summary.project.data_version, generatedAt: clock(), containsSensitiveValues: false, requiresPurposeForExport: type === 'insurance' });
  }

  function previewStatus(projectId, type, previewVersion) {
    if (!definitions[type]) return failure('UNSUPPORTED_EXPORT', '不支持该表格类型');
    const summary = business.summary(projectId);
    if (!summary) return failure('NOT_FOUND', '项目不存在');
    if (!tableApplicable(summary.project, type)) return failure('EXPORT_NOT_APPLICABLE', '该表格不适用于当前项目');
    return success({ previewVersion: Number(previewVersion), currentVersion: summary.project.data_version,
      stale: String(previewVersion) !== String(summary.project.data_version), sourceUpdatedAt: summary.project.updated_at });
  }

  async function exportFile(projectId, type, { purpose = '', confirmed = false, previewVersion } = {}) {
    const definition = definitions[type];
    if (!definition) return failure('UNSUPPORTED_EXPORT', '不支持该表格类型');
    const before = business.summary(projectId);
    if (!before) return failure('NOT_FOUND', '项目不存在');
    if (previewVersion === undefined || previewVersion === null || previewVersion === '') return failure('PREVIEW_VERSION_REQUIRED', '必须先生成当前版本预览');
    if (String(previewVersion) !== String(before.project.data_version)) return failure('PREVIEW_STALE', '项目数据已变化，旧预览不能继续导出');
    const checked = tableCenter(projectId, { recalculate: true });
    if (!checked.ok) return checked;
    const table = checked.data.tables.find((row) => row.type === type);
    if (!table) return failure('EXPORT_NOT_APPLICABLE', '该表格不适用于当前项目');
    if (String(previewVersion) !== String(checked.data.dataVersion)) return failure('PREVIEW_STALE', '项目数据已变化，旧预览不能继续导出');
    if (!table.canPreview) return failure('EXPORT_BLOCKED', `${table.label}仍有 ${table.issues.length} 个阻断问题`, { issues: table.issues });
    if (type === 'insurance' && (!confirmed || String(purpose).trim().length < 2)) {
      audit?.record({ projectId, operationType: '导出', objectType: definition.label, objectId: projectId, summary: '保险名单导出被拒绝', result: '失败', failureReason: '缺少二次确认或用途' });
      return failure('SENSITIVE_CONFIRMATION_REQUIRED', '导出完整保险证件号码前必须二次确认并填写用途');
    }
    const id = createId('export'); const project = checked.data.project;
    const filename = `${safeFilenamePart(projectId)}-${type}-v${project.data_version}-${id.slice(-8)}.xlsx`; const directory = safeProjectDirectory(exportsPath, projectId);
    const finalPath = join(directory, filename); const temporaryPath = `${finalPath}.tmp`;
    try {
      await mkdir(directory, { recursive: true });
      const summary = business.summary(projectId); const projection = projectTable(repository, summary, type);
      const rows = type === 'insurance' ? projection.source.map((row) => {
        const idNumber = revealSensitive(row.id_number); const licenseNumber = revealSensitive(row.license_number);
        if (!idNumber || !licenseNumber) throw new Error('SENSITIVE_VALUE_UNAVAILABLE');
        return { guideName: row.guide_name, idNumber, phone: row.phone, licenseNumber };
      }) : projection.rows;
      const totals = summaryRows(type, projection.totals); const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet(definition.label);
      sheet.addRow([definition.label]); sheet.addRow([`${project.school_name} · ${project.grade} · ${project.destination}`]);
      sheet.addRow([`项目ID：${projectId} · 数据版本：${project.data_version} · 生成时间：${clock()}`]);
      sheet.addRow(definition.columns.map(([, label]) => label));
      for (const row of rows) sheet.addRow(definition.columns.map(([key]) => row[key] ?? ''));
      sheet.addRow([]); for (const row of totals) sheet.addRow(row); styleWorkbook(workbook, sheet, definition, rows, totals);
      await writeWorkbook(workbook, temporaryPath); await verifyWorkbookFile(temporaryPath, type, projectId, rows, totals);
      await rename(temporaryPath, finalPath); const info = await stat(finalPath); if (!info.size) throw new Error('EXCEL_EMPTY_FILE');
      const content = await readFile(finalPath); const sha256 = createHash('sha256').update(content).digest('hex');
      repository.addExport({ id, projectId, tableType: definition.recordLabel, filename, fileRef: `${projectId}/${filename}`, version: String(project.data_version), purpose: String(purpose).trim(), status: '成功', error: '', createdAt: clock() });
      audit?.record({ projectId, operationType: '导出', objectType: definition.label, objectId: id, summary: `已生成并回读验证 ${filename}`, result: '成功' });
      return success({ id, filename, fileRef: `${projectId}/${filename}`, downloadUrl: `/api/exports/${encodeURIComponent(id)}/download`, rowCount: rows.length, dataVersion: project.data_version, sizeBytes: info.size, sha256 });
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      repository.addExport({ id, projectId, tableType: definition.recordLabel, filename, fileRef: '', version: String(project.data_version), purpose: String(purpose).trim(), status: '失败', error: String(error.message).slice(0, 300), createdAt: clock() });
      audit?.record({ projectId, operationType: '导出', objectType: definition.label, objectId: id, summary: 'Excel 生成失败', result: '失败', failureReason: error.message });
      return failure('EXPORT_FAILED', 'Excel 生成或回读验证失败');
    }
  }

  async function downloadFile(exportId) {
    const record = repository.exportById(exportId);
    if (!record) return failure('EXPORT_NOT_FOUND', '导出记录不存在');
    if (record.status !== '成功' || !record.controlled_file_ref) return failure('EXPORT_NOT_CURRENT', '该导出文件当前不可下载');
    try {
      const content = await readFile(safeControlledFile(exportsPath, record.controlled_file_ref));
      return success({ filename: record.filename, content, sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
    } catch {
      return failure('EXPORT_FILE_NOT_FOUND', '导出文件不存在或无法读取');
    }
  }
  return Object.freeze({ tableCenter, preview, previewStatus, exportFile, downloadFile });
}
