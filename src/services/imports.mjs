import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { basename, extname, join, normalize } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createId } from '../db/id.mjs';
import { runInTransaction } from '../db/transaction.mjs';
import { convertFieldValue, getImportTarget as catalogTarget, publicTargetCatalog, suggestMapping } from '../imports/targets.mjs';
import { parseImportSource, parserLimits } from '../imports/parsers.mjs';
import { failure, success } from './result.mjs';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const phonePattern = /^[0-9+()\-\s]{6,24}$/;
const finalStatuses = new Set(['成功', '部分成功']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function cleanFilename(value) {
  return basename(String(value || '')).replace(/[\u0000-\u001f]/g, '').slice(0, 180);
}

function safeBatchDirectory(root, batchId) {
  const directory = normalize(join(root, batchId));
  const normalizedRoot = normalize(root + '\\');
  if (!directory.startsWith(normalizedRoot)) throw new Error('INVALID_IMPORT_PATH');
  return directory;
}

function targetUniqueKey(targetType, mapped) {
  if (targetType === 'schools') return String(mapped.name || '').replace(/\s+/g, '').toLowerCase();
  if (targetType === 'classes_teachers') return `${mapped.className || ''}|${mapped.teacherName || ''}|${mapped.teacherPhone || ''}`;
  if (targetType === 'guide_recruitment') return String(mapped.sequence || '');
  if (targetType === 'transport') return String(mapped.vehicleLabel || '').toLowerCase();
  if (targetType === 'lodging') return `${mapped.checkInOn || ''}|${mapped.roomNumber || ''}`.toLowerCase();
  if (targetType === 'meals') return String(mapped.sessionName || '').toLowerCase();
  return '';
}

function validationIssues(target, mapped) {
  const errors = [];
  for (const definition of target.fields) {
    const value = mapped[definition.key];
    if (definition.required && (value === '' || value === null || value === undefined)) errors.push({ severity: 'error', field: definition.key, code: 'REQUIRED_FIELD', message: `“${definition.label}”不能为空` });
    if (value !== '' && definition.type === 'integer' && (!Number.isInteger(value) || value < 0)) errors.push({ severity: 'error', field: definition.key, code: 'INVALID_INTEGER', message: `“${definition.label}”必须是非负整数` });
    if (value !== '' && definition.type === 'phone' && !phonePattern.test(String(value))) errors.push({ severity: 'error', field: definition.key, code: 'INVALID_PHONE', message: `“${definition.label}”格式不正确` });
    if (value !== '' && definition.type === 'boolean' && typeof value !== 'boolean') errors.push({ severity: 'error', field: definition.key, code: 'INVALID_BOOLEAN', message: `“${definition.label}”应填写是或否` });
    if (value !== '' && definition.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) errors.push({ severity: 'error', field: definition.key, code: 'INVALID_DATE', message: `“${definition.label}”日期格式不正确` });
    if (value !== '' && definition.type === 'datetime' && Number.isNaN(new Date(value).valueOf())) errors.push({ severity: 'error', field: definition.key, code: 'INVALID_DATETIME', message: `“${definition.label}”时间格式不正确` });
  }
  if (target.key === 'schools' && Boolean(mapped.contactName) !== Boolean(mapped.contactPhone)) errors.push({ severity: 'error', field: mapped.contactName ? 'contactPhone' : 'contactName', code: 'CONTACT_PAIR_REQUIRED', message: '联系人姓名与电话必须同时填写' });
  if (target.key === 'classes_teachers' && Number.isInteger(mapped.studentTotal) && Number.isInteger(mapped.boys) && Number.isInteger(mapped.girls) && mapped.studentTotal !== mapped.boys + mapped.girls) errors.push({ severity: 'error', field: 'studentTotal', code: 'STUDENT_TOTAL_MISMATCH', message: '学生总数必须等于男生人数与女生人数之和' });
  if (target.key === 'guide_recruitment' && !mapped.phone) errors.push({ severity: 'warning', field: 'phone', code: 'PHONE_MISSING', message: '缺少手机号，后续不能自动匹配导游档案，需人工确认' });
  return errors;
}

function mapRow(row, mapping, target) {
  const mapped = {};
  for (const [sourceHeader, fieldKey] of Object.entries(mapping)) {
    const definition = target.fields.find((item) => item.key === fieldKey);
    if (!definition) continue;
    mapped[fieldKey] = convertFieldValue(row.raw[sourceHeader], definition.type);
  }
  for (const definition of target.fields) if (!(definition.key in mapped)) mapped[definition.key] = '';
  for (const [fieldKey, value] of Object.entries(row.overrides || {})) {
    const definition = target.fields.find((item) => item.key === fieldKey);
    if (definition) mapped[fieldKey] = convertFieldValue(value, definition.type);
  }
  return mapped;
}

function persistentIssues(row) {
  const source = row.cellErrors || row.errors || [];
  return source.filter((issue) => ['FORMULA_NOT_ALLOWED', 'MANUAL_SKIP'].includes(issue.code)).map((issue) => ({ severity: issue.severity || 'error', ...issue }));
}

function evaluateRows(rows, mapping, target, schoolRepository) {
  const seen = new Map();
  return rows.map((row) => {
    if (row.status === '跳过' && row.errors?.some((issue) => issue.code === 'MANUAL_SKIP')) return { ...row, mapped: row.mapped || mapRow(row, mapping, target), errors: row.errors, status: '跳过', rawFingerprint: row.rawFingerprint || sha256(JSON.stringify(row.raw)) };
    const mapped = mapRow(row, mapping, target);
    const sourceByField = Object.fromEntries(Object.entries(mapping).filter(([, fieldKey]) => fieldKey).map(([sourceHeader, fieldKey]) => [fieldKey, sourceHeader]));
    const errors = [...persistentIssues(row), ...validationIssues(target, mapped).map((issue) => ({ ...issue, sourceColumn: sourceByField[issue.field] || '' }))];
    const uniqueKey = targetUniqueKey(target.key, mapped);
    if (uniqueKey) {
      if (seen.has(uniqueKey)) errors.push({ severity: 'warning', code: 'DUPLICATE_ROW', field: '', message: `与第 ${seen.get(uniqueKey)} 行重复，默认跳过` });
      else seen.set(uniqueKey, row.sourceRowNumber);
    }
    if (target.key === 'schools' && mapped.name && !schoolRepository.findExact(mapped.name)) {
      const candidates = schoolRepository.findSimilar(mapped.name);
      if (candidates.length) errors.push({ severity: 'warning', code: 'SIMILAR_SCHOOL', field: 'name', message: `存在相近学校：${candidates.map((item) => item.name).join('、')}；确认导入表示仍新建` });
    }
    const blocking = errors.some((issue) => issue.severity !== 'warning');
    const duplicate = errors.some((issue) => issue.code === 'DUPLICATE_ROW');
    return { ...row, mapped, errors, status: duplicate ? '跳过' : blocking ? '失败' : '有效', rawFingerprint: sha256(JSON.stringify(row.raw)) };
  });
}

function publicBatch(batch, target, schoolRepository) {
  const rows = (batch.rows || []).map((row) => {
    let action = 'preview';
    let matchBasis = '';
    let overwriteFields = [];
    if (target.key === 'schools' && row.status === '有效') {
      const existing = schoolRepository.findExact(row.mapped.name);
      if (existing) {
        action = 'update'; matchBasis = '学校名称完全一致';
        if (row.mapped.cooperationNotes && row.mapped.cooperationNotes !== existing.cooperationNotes) overwriteFields.push('合作备注');
        if (row.mapped.contactName && !existing.contacts.some((contact) => contact.name === row.mapped.contactName && contact.phone === row.mapped.contactPhone)) overwriteFields.push('联系人');
      } else action = 'create';
    }
    return { ...row, rawFingerprint: undefined, displayStatus: row.status === '有效' && row.errors.some((issue) => issue.severity === 'warning') ? '警告' : row.errors.some((issue) => issue.code === 'DUPLICATE_ROW') ? '重复' : row.status, action, matchBasis, overwriteFields };
  });
  const counts = {
    total: rows.length,
    valid: rows.filter((row) => row.status === '有效').length,
    skipped: rows.filter((row) => row.status === '跳过').length,
    failed: rows.filter((row) => row.status === '失败').length,
    warnings: rows.filter((row) => row.displayStatus === '警告').length
  };
  return { ...batch, fingerprint: undefined, storedFileRef: undefined, fileStored: Boolean(batch.storedFileRef), target: { key: target.key, label: target.label, writable: target.writable, requiresProject: target.requiresProject, fields: target.fields.map(({ key, label, required, type }) => ({ key, label, required, type })) }, suggestedMapping: suggestMapping(batch.sourceHeaders, target), rows, counts };
}

function mergeImportedContact(existing, mapped) {
  const contacts = existing.contacts.map((contact) => ({ ...contact, isDefault: Boolean(contact.isDefault) }));
  if (!mapped.contactName || !mapped.contactPhone) return contacts;
  const index = contacts.findIndex((contact) => contact.phone === mapped.contactPhone || contact.name === mapped.contactName);
  const incoming = { name: mapped.contactName, phone: mapped.contactPhone, notes: mapped.contactNotes || '', isDefault: Boolean(mapped.isDefault) };
  if (incoming.isDefault) contacts.forEach((contact) => { contact.isDefault = false; });
  if (index >= 0) contacts[index] = { ...contacts[index], name: incoming.name || contacts[index].name, phone: incoming.phone || contacts[index].phone, notes: incoming.notes || contacts[index].notes, isDefault: incoming.isDefault || contacts[index].isDefault };
  else contacts.push({ ...incoming, isDefault: incoming.isDefault || !contacts.some((contact) => contact.isDefault) });
  return contacts;
}

export function createImportService({ db, repository, schoolRepository, schools, audit, importsPath, targetWriters = {}, clock = () => new Date().toISOString(), parseSource = parseImportSource }) {
  const getImportTarget = (key) => {
    const target = catalogTarget(key);
    return target ? { ...target, writable: target.writable || Boolean(targetWriters[key]) } : null;
  };
  async function create(input = {}) {
    const target = getImportTarget(input.targetType);
    if (!target) return failure('UNSUPPORTED_IMPORT_TARGET', '不支持该资料类型');
    const method = String(input.importMethod || '');
    if (!['Excel', 'CSV', 'Word', '粘贴文字'].includes(method)) return failure('UNSUPPORTED_IMPORT_METHOD', '请选择支持的导入方式');
    const projectId = String(input.projectId || '').trim() || null;
    if (target.requiresProject) {
      if (!projectId) return failure('PROJECT_REQUIRED', '该资料类型必须选择目标项目');
      if (!db.prepare('SELECT id FROM projects WHERE id=?').get(projectId)) return failure('PROJECT_NOT_FOUND', '目标项目不存在');
    }
    const originalFilename = method === '粘贴文字' ? '粘贴文字' : cleanFilename(input.originalFilename);
    let buffer = null;
    let sourceValue;
    if (method === '粘贴文字') {
      sourceValue = String(input.text || '');
      const bytes = Buffer.byteLength(sourceValue);
      if (!bytes) return failure('EMPTY_SOURCE', '请粘贴需要导入的内容');
      if (bytes > MAX_TEXT_BYTES) return failure('SOURCE_TOO_LARGE', '粘贴文字不能超过 1 MB');
    } else {
      if (!originalFilename || !input.fileBase64) return failure('FILE_REQUIRED', '请选择需要导入的文件');
      buffer = Buffer.from(String(input.fileBase64), 'base64');
      if (!buffer.length) return failure('EMPTY_SOURCE', '文件内容为空');
      if (buffer.length > MAX_FILE_BYTES) return failure('SOURCE_TOO_LARGE', '单个导入文件不能超过 5 MB');
      sourceValue = buffer;
    }
    const fingerprint = sha256(Buffer.concat([Buffer.from(`${target.key}|${projectId || ''}|${method}|`), Buffer.isBuffer(sourceValue) ? sourceValue : Buffer.from(sourceValue)]));
    const duplicate = repository.findDuplicate({ projectId, targetType: target.key, fingerprint });
    if (duplicate) return failure('DUPLICATE_IMPORT', '相同资料已经提交过，请打开原批次继续处理', { batchId: duplicate.id, status: duplicate.status });

    const id = createId('import');
    const now = clock();
    const extension = method === '粘贴文字' ? '.txt' : extname(originalFilename).toLowerCase();
    const storedFileRef = `${id}/source${extension}`;
    repository.createBatch({ id, projectId, targetType: target.key, importMethod: method, originalFilename, notes: String(input.notes || '').trim().slice(0, 500), templateVersion: String(input.templateVersion || '').trim().slice(0, 50), fingerprint, storedFileRef, now });
    const directory = safeBatchDirectory(importsPath, id);
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, `source${extension}`), Buffer.isBuffer(sourceValue) ? sourceValue : Buffer.from(sourceValue, 'utf8'), { flag: 'wx' });
      const parsed = await parseSource({ method, filename: originalFilename, buffer, text: String(input.text || ''), targetType: target.key });
      if (!parsed.rows.length) throw Object.assign(new Error('资料只有表头，没有可预览的数据行'), { code: 'EMPTY_DATA_ROWS' });
      const mapping = suggestMapping(parsed.headers, target);
      const evaluations = evaluateRows(parsed.rows, mapping, target, schoolRepository);
      const batch = runInTransaction(db, () => {
        const saved = repository.setParsed(id, { headers: parsed.headers, mapping, rows: evaluations, now: clock() });
        audit.record({ projectId, operationType: '导入', objectType: '导入批次', objectId: id, summary: `资料进入临时预览：${target.label}，${evaluations.length} 行`, result: '成功' });
        return saved;
      });
      return success(publicBatch(batch, target, schoolRepository));
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      const message = String(error.message || '文件解析失败').slice(0, 500);
      runInTransaction(db, () => {
        repository.setFailed(id, message, clock());
        audit.record({ projectId, operationType: '导入', objectType: '导入批次', objectId: id, summary: `资料解析失败：${target.label}`, result: '失败', failureReason: message });
      });
      return failure(error.code || 'PARSE_FAILED', message, { batchId: id });
    }
  }

  function list(filters = {}) {
    return success(repository.list(filters).map((batch) => {
      const target = getImportTarget(batch.targetType);
      return { ...batch, fingerprint: undefined, storedFileRef: undefined, fileStored: Boolean(batch.storedFileRef), targetLabel: target?.label || batch.targetType };
    }));
  }

  function get(id) {
    const batch = repository.getBatch(id);
    if (!batch) return failure('NOT_FOUND', '导入批次不存在');
    const target = getImportTarget(batch.targetType);
    return success(publicBatch(batch, target, schoolRepository));
  }

  function updateMapping(id, input = {}) {
    const batch = repository.getBatch(id);
    if (!batch) return failure('NOT_FOUND', '导入批次不存在');
    if (finalStatuses.has(batch.status) || batch.status === '已取消') return failure('IMPORT_ALREADY_FINAL', '该批次已经结束，不能修改映射');
    const target = getImportTarget(batch.targetType);
    const mapping = {};
    const used = new Set();
    for (const header of batch.sourceHeaders) {
      const value = String(input.mapping?.[header] || '');
      if (value && !target.fields.some((field) => field.key === value)) return failure('INVALID_MAPPING', `字段“${header}”映射目标无效`);
      if (value && used.has(value)) return failure('MAPPING_CONFLICT', '同一个目标字段不能由两列同时写入');
      if (value) used.add(value);
      mapping[header] = value;
    }
    const evaluations = evaluateRows(batch.rows, mapping, target, schoolRepository);
    const updated = runInTransaction(db, () => repository.setMapping(id, mapping, evaluations, clock()));
    return success(publicBatch(updated, target, schoolRepository));
  }

  function updateRow(id, rowId, input = {}) {
    const batch = repository.getBatch(id);
    if (!batch) return failure('NOT_FOUND', '导入批次不存在');
    if (finalStatuses.has(batch.status) || batch.status === '已取消') return failure('IMPORT_ALREADY_FINAL', '该批次已经结束，不能修改预览行');
    const target = getImportTarget(batch.targetType);
    const row = batch.rows.find((item) => item.id === rowId);
    if (!row) return failure('ROW_NOT_FOUND', '预览行不存在');
    if ('skipped' in input) {
      runInTransaction(db, () => repository.setRowSkipped(id, rowId, Boolean(input.skipped), clock()));
      if (input.skipped) return get(id);
    }
    const allowed = new Set(target.fields.map((field) => field.key));
    const overrides = { ...row.overrides };
    for (const [key, value] of Object.entries(input.values || {})) if (allowed.has(key)) overrides[key] = value;
    repository.setRowOverrides(id, rowId, overrides, clock());
    const refreshed = repository.getBatch(id);
    const evaluations = evaluateRows(refreshed.rows, refreshed.mapping, target, schoolRepository);
    const updated = runInTransaction(db, () => repository.setMapping(id, refreshed.mapping, evaluations, clock()));
    return success(publicBatch(updated, target, schoolRepository));
  }

  function writeSchool(mapped) {
    const existing = schoolRepository.findExact(mapped.name);
    if (!existing) {
      const result = schools.create({ name: mapped.name, cooperationNotes: mapped.cooperationNotes || '', confirmSimilar: true, contacts: mapped.contactName ? [{ name: mapped.contactName, phone: mapped.contactPhone, notes: mapped.contactNotes || '', isDefault: mapped.isDefault === true }] : [] });
      if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
      return { action: 'create', id: result.data.id };
    }
    const result = schools.update(existing.id, {
      name: existing.name,
      cooperationNotes: mapped.cooperationNotes || existing.cooperationNotes,
      contacts: mergeImportedContact(existing, mapped),
      confirmSimilar: true
    });
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return { action: 'update', id: result.data.id };
  }

  function confirm(id, input = {}) {
    const batch = repository.getBatch(id);
    if (!batch) return failure('NOT_FOUND', '导入批次不存在');
    if (finalStatuses.has(batch.status) || batch.status === '已取消') return failure('IMPORT_ALREADY_FINAL', '该批次已经确认或取消，不能重复确认');
    const target = getImportTarget(batch.targetType);
    if (!target.writable) return failure('TARGET_NOT_WRITABLE', `${target.label}的正式写入将在对应业务模块完成后启用；当前只能解析和预览`);
    const strategy = input.strategy === 'all_or_nothing' ? 'all_or_nothing' : 'valid_only';
    const evaluations = evaluateRows(batch.rows, batch.mapping, target, schoolRepository);
    const valid = evaluations.filter((row) => row.status === '有效');
    const skipped = evaluations.filter((row) => row.status === '跳过');
    const failed = evaluations.filter((row) => row.status === '失败');
    if (strategy === 'all_or_nothing' && (skipped.length || failed.length)) return failure('IMPORT_HAS_INVALID_ROWS', '批次仍有错误或重复行；请修正后重试，或选择仅导入有效行', { counts: { valid: valid.length, skipped: skipped.length, failed: failed.length } });
    if (!valid.length) {
      const finalized = runInTransaction(db, () => {
        const result = repository.finalize(id, { status: '失败', successCount: 0, skippedCount: skipped.length, failedCount: failed.length, errorSummary: '没有可写入的有效行', now: clock() });
        audit.record({ projectId: batch.projectId, operationType: '导入', objectType: '导入批次', objectId: id, summary: `确认导入：${target.label}，无有效行`, result: '失败', failureReason: '没有可写入的有效行' });
        return result;
      });
      return success(publicBatch(finalized, target, schoolRepository));
    }
    try {
      const finalized = runInTransaction(db, () => {
        if (target.key === 'schools') valid.forEach((row) => writeSchool(row.mapped));
        else targetWriters[target.key]({ projectId: batch.projectId, batchId: id, rows: valid.map((row) => ({ id: row.id, mapped: row.mapped })) });
        repository.setMapping(id, batch.mapping, evaluations, clock());
        repository.markRowsWritten(id, valid.map((row) => row.id));
        const status = failed.length || skipped.length ? '部分成功' : '成功';
        const result = repository.finalize(id, { status, successCount: valid.length, skippedCount: skipped.length, failedCount: failed.length, errorSummary: failed.length ? `${failed.length} 行未写入` : '', now: clock() });
        audit.record({ projectId: batch.projectId, operationType: '导入', objectType: '导入批次', objectId: id, summary: `确认导入：${target.label}，成功 ${valid.length}，跳过 ${skipped.length}，失败 ${failed.length}`, result: status });
        return result;
      });
      return success(publicBatch(finalized, target, schoolRepository));
    } catch (error) {
      const message = String(error.message || '确认写入失败').slice(0, 500);
      runInTransaction(db, () => {
        repository.finalize(id, { status: '失败', successCount: 0, skippedCount: skipped.length, failedCount: valid.length + failed.length, errorSummary: message, now: clock() });
        audit.record({ projectId: batch.projectId, operationType: '导入', objectType: '导入批次', objectId: id, summary: `确认导入失败：${target.label}`, result: '失败', failureReason: message });
      });
      return failure(error.code || 'IMPORT_WRITE_FAILED', '确认写入失败，正式数据未发生部分写入', { batchId: id });
    }
  }

  async function cancel(id) {
    const batch = repository.getBatch(id);
    if (!batch) return failure('NOT_FOUND', '导入批次不存在');
    if (finalStatuses.has(batch.status)) return failure('IMPORT_ALREADY_FINAL', '已确认批次不能取消');
    const canceled = runInTransaction(db, () => {
      const result = repository.cancel(id, clock());
      if (result) audit.record({ projectId: batch.projectId, operationType: '导入', objectType: '导入批次', objectId: id, summary: `取消导入并清理临时数据：${getImportTarget(batch.targetType)?.label || batch.targetType}`, result: '成功' });
      return result;
    });
    if (!canceled) return failure('IMPORT_ALREADY_FINAL', '该批次不能取消');
    await rm(safeBatchDirectory(importsPath, id), { recursive: true, force: true });
    return success(publicBatch(canceled, getImportTarget(batch.targetType), schoolRepository));
  }

  function context() {
    const projects = db.prepare(`SELECT p.id,p.grade,p.destination,p.starts_on AS startsOn,p.ends_on AS endsOn,s.name AS schoolName
      FROM projects p JOIN schools s ON s.id=p.school_id ORDER BY p.starts_on DESC,p.created_at DESC LIMIT 100`).all();
    return success({ targets: publicTargetCatalog().map((item) => ({ ...item, writable: getImportTarget(item.key).writable })), projects, limits: { maxFileBytes: MAX_FILE_BYTES, maxTextBytes: MAX_TEXT_BYTES, ...parserLimits }, supportedExtensions: ['.xlsx', '.csv', '.docx'] });
  }

  async function template(targetType) {
    const target = getImportTarget(targetType);
    if (!target) return failure('UNSUPPORTED_IMPORT_TARGET', '不支持该资料类型');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = '研学派团工作台';
    const sheet = workbook.addWorksheet('导入模板', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.addRow(target.fields.map((item) => item.label));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF163B57' } };
    sheet.columns = target.fields.map((item) => ({ width: Math.max(14, Math.min(26, item.label.length * 2 + 4)) }));
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: target.fields.length } };
    const guide = workbook.addWorksheet('填写说明');
    guide.addRows([['资料类型', target.label], ['模板版本', 'v1'], ['填写规则', '第一行表头不要修改；一行一条记录；公式请先粘贴为值。'], ['确认规则', target.writable ? '上传后必须在预览页人工确认，才会写入正式数据。' : '当前支持解析预览；正式写入将在对应业务模块完成后启用。']]);
    guide.getColumn(1).width = 18; guide.getColumn(2).width = 72;
    return success({ filename: `${target.key}-template-v1.xlsx`, buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  }

  return { create, list, get, updateMapping, updateRow, confirm, cancel, context, template };
}
