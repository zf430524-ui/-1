import { runInTransaction } from '../db/transaction.mjs';
import { failure, success } from './result.mjs';
import { maskDocumentNumber } from './sensitive-values.mjs';

const phonePattern = /^[0-9+()\-\s]{6,24}$/;
const idPattern = /^\d{17}[\dXx]$/;
const licensePattern = /^[A-Za-z0-9\-]{4,32}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const statuses = new Set(['可合作', '暂停合作', '停止合作']);
const documentTypes = new Set(['身份证', '导游证']);

function clean(value) { return String(value || '').trim(); }
function dateOnly(value) { return String(value || '').slice(0, 10); }
function addDays(value, days) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }

export function documentExpiryStatus(document, today, reminderDays = 30) {
  if (!document?.expiresOn) return '缺失';
  if (document.expiresOn < today) return '过期';
  if (document.expiresOn <= addDays(today, reminderDays)) return '临期';
  return '有效';
}

function withDocumentStatuses(guide, today) {
  const documentMap = Object.fromEntries((guide.documents || []).map((item) => [item.documentType, item]));
  const documents = ['身份证', '导游证'].map((documentType) => {
    const document = documentMap[documentType] || { documentType, maskedNumber: '', expiresOn: null, hasControlledFile: 0 };
    return { ...document, status: documentExpiryStatus(document, today), hasControlledFile: Boolean(document.hasControlledFile) };
  });
  return { ...guide, active: Boolean(guide.active), documents, documentStatuses: Object.fromEntries(documents.map((item) => [item.documentType, item.status])) };
}

function normalize(input = {}, protector) {
  const inputDocuments = Array.isArray(input.documents) ? input.documents : [];
  const idNumber = clean(input.idNumber || inputDocuments.find((item) => item.documentType === '身份证')?.number);
  const guideLicenseNumber = clean(input.guideLicenseNumber || inputDocuments.find((item) => item.documentType === '导游证')?.number);
  const mappedStatus = ({ 合作中: '可合作', 暂停: '暂停合作', 停用: '停止合作' })[input.cooperationStatus] || input.cooperationStatus || '可合作';
  return {
    name: clean(input.name), workPhone: clean(input.workPhone), gender: clean(input.gender) || '未填写', birthDate: clean(input.birthDate) || null,
    residenceArea: clean(input.residenceArea), emergencyContactName: clean(input.emergencyContactName), emergencyContactPhone: clean(input.emergencyContactPhone),
    idNumberProtected: idNumber ? protector.protect(idNumber) : null, guideLicenseProtected: guideLicenseNumber ? protector.protect(guideLicenseNumber) : null,
    cooperationStatus: mappedStatus, active: mappedStatus !== '停止合作', notes: clean(input.notes), idNumber, guideLicenseNumber,
    documents: inputDocuments.map((document) => ({
      documentType: clean(document.documentType), number: clean(document.number), expiresOn: clean(document.expiresOn) || null,
      image: document.image && typeof document.image === 'object' ? { mimeType: clean(document.image.mimeType), base64: clean(document.image.base64) } : null,
      imageBack: document.imageBack && typeof document.imageBack === 'object' ? { mimeType: clean(document.imageBack.mimeType), base64: clean(document.imageBack.base64) } : null
    }))
  };
}

export function validateGuideInput(input, protector) {
  const value = normalize(input, protector);
  const errors = [];
  if (!value.name) errors.push({ field: 'name', message: '请填写导游姓名' });
  if (!value.workPhone) errors.push({ field: 'workPhone', message: '请填写工作手机号' });
  else if (!phonePattern.test(value.workPhone)) errors.push({ field: 'workPhone', message: '工作手机号格式不正确' });
  if (!['男', '女', '未填写'].includes(value.gender)) errors.push({ field: 'gender', message: '性别选项不正确' });
  if (value.birthDate && !datePattern.test(value.birthDate)) errors.push({ field: 'birthDate', message: '出生日期格式不正确' });
  if (value.emergencyContactName && !value.emergencyContactPhone) errors.push({ field: 'emergencyContactPhone', message: '填写紧急联系人后必须填写联系电话' });
  if (value.emergencyContactPhone && !value.emergencyContactName) errors.push({ field: 'emergencyContactName', message: '填写紧急联系电话后必须填写联系人' });
  if (value.emergencyContactPhone && !phonePattern.test(value.emergencyContactPhone)) errors.push({ field: 'emergencyContactPhone', message: '紧急联系电话格式不正确' });
  if (!statuses.has(value.cooperationStatus)) errors.push({ field: 'cooperationStatus', message: '合作状态不正确' });
  if (value.idNumber && !idPattern.test(value.idNumber)) errors.push({ field: 'idNumber', message: '身份证号码格式不正确' });
  if (value.guideLicenseNumber && !licensePattern.test(value.guideLicenseNumber)) errors.push({ field: 'guideLicenseNumber', message: '导游证号码格式不正确' });
  for (const [index, document] of value.documents.entries()) {
    if (!documentTypes.has(document.documentType)) errors.push({ field: `documents.${index}.documentType`, message: '证件类型不正确' });
    if (document.expiresOn && !datePattern.test(document.expiresOn)) errors.push({ field: `documents.${index}.expiresOn`, message: '证件有效期格式不正确' });
  }
  return { value, errors };
}

export function createGuideService({ db, repository, protector, files, audit, clock = () => new Date().toISOString(), reminderDays = 30 }) {
  const today = () => dateOnly(clock());
  const decorate = (guide) => withDocumentStatuses(guide, today());
  const auditSensitive = (guideId, summary, result, failureReason = '') => audit.record({ operationType: '查看敏感资料', objectType: '导游档案', objectId: guideId, summary, result, failureReason });

  function list(options = {}) {
    const rows = repository.list(options).map(decorate);
    const filtered = options.documentStatus ? rows.filter((guide) => Object.values(guide.documentStatuses).includes(options.documentStatus)) : rows;
    return success(filtered);
  }

  function get(id) {
    const guide = repository.getById(id);
    return guide ? success({ ...decorate(guide), endedProjects: repository.endedProjects() }) : failure('NOT_FOUND', '导游档案不存在');
  }

  function write(input, id = '') {
    const existing = id ? repository.getById(id, { includeSensitive: true, includeHistory: false }) : null;
    if (id && !existing) return failure('NOT_FOUND', '导游档案不存在');
    const { value, errors } = validateGuideInput(input, protector);
    if (errors.length) return failure('VALIDATION_ERROR', '导游档案未通过校验', { fields: errors });
    if (repository.findExact(value.name, value.workPhone, id)) return failure('DUPLICATE_GUIDE', '姓名和手机号完全一致的导游档案已经存在');
    const futureAssignments = id && value.cooperationStatus !== '可合作' ? repository.futureAssignments(id, today()) : [];
    if (futureAssignments.length) return failure('GUIDE_FUTURE_ASSIGNMENTS', '导游仍有未来项目安排，请先完成替换或移出后再暂停/停用', { assignments: futureAssignments });
    const savedFiles = [];
    try {
      const data = runInTransaction(db, () => {
        const guideInput = { ...value, idNumberProtected: value.idNumberProtected || existing?.idNumberProtected || null,
          guideLicenseProtected: value.guideLicenseProtected || existing?.guideLicenseProtected || null };
        const guide = id ? repository.update(id, guideInput, clock()) : repository.create(guideInput, clock());
        for (const document of value.documents) {
          const number = document.documentType === '身份证' ? value.idNumber || document.number : value.guideLicenseNumber || document.number;
          let controlledFileRef = null; let controlledFileRefBack = null;
          if (document.image) { const stored = files.save({ guideId: guide.id, documentType: document.documentType === '身份证' ? '身份证正面' : '导游证', ...document.image }); controlledFileRef = stored.fileRef; savedFiles.push(stored.fileRef); }
          if (document.imageBack && document.documentType === '身份证') { const stored = files.save({ guideId: guide.id, documentType: '身份证反面', ...document.imageBack }); controlledFileRefBack = stored.fileRef; savedFiles.push(stored.fileRef); }
          repository.upsertDocument(guide.id, { documentType: document.documentType, maskedNumber: number ? maskDocumentNumber(number, document.documentType) : '', expiresOn: document.expiresOn, controlledFileRef, controlledFileRefBack }, clock());
        }
        const saved = decorate(repository.getById(guide.id));
        if (value.idNumber || value.guideLicenseNumber || value.documents.some((document) => document.image || document.imageBack)) {
          audit.record({ operationType: '修改敏感资料', objectType: '导游档案', objectId: saved.id,
            summary: `${id ? '更新' : '新增'}导游证件字段或受控图片`, result: '成功' });
        }
        return saved;
      });
      return success(data);
    } catch (error) {
      for (const fileRef of savedFiles) { try { files.remove(fileRef); } catch {} }
      if (error.code?.startsWith('DOCUMENT_')) return failure(error.code, error.message);
      if (String(error.code).includes('CONSTRAINT')) return failure('GUIDE_SAVE_CONFLICT', '导游档案与现有数据冲突');
      throw error;
    }
  }

  function create(input) { return write(input); }
  function update(id, input) { return write(input, id); }

  function setStatus(id, input = {}) {
    const guide = repository.getById(id);
    if (!guide) return failure('NOT_FOUND', '导游档案不存在');
    const cooperationStatus = ({ 合作中: '可合作', 暂停: '暂停合作', 停用: '停止合作' })[input.cooperationStatus] || input.cooperationStatus;
    if (!statuses.has(cooperationStatus)) return failure('VALIDATION_ERROR', '合作状态不正确');
    const futureAssignments = cooperationStatus === '可合作' ? [] : repository.futureAssignments(id, today());
    if (futureAssignments.length) return failure('GUIDE_FUTURE_ASSIGNMENTS', '导游仍有未来项目安排，请先完成替换或移出后再暂停/停用', { assignments: futureAssignments });
    return success(repository.setStatus(id, cooperationStatus, cooperationStatus !== '停止合作', clock()));
  }

  function remove(id) {
    if (!repository.getById(id)) return failure('NOT_FOUND', '导游档案不存在');
    const refs = repository.references(id); const total = Object.values(refs).reduce((sum, value) => sum + Number(value), 0);
    if (total) return failure('GUIDE_IN_USE', '导游已有项目或事实记录，不能永久删除，请改为停用', { references: refs });
    return success({ id, removed: runInTransaction(db, () => repository.remove(id)) });
  }

  function reveal(id, input = {}) {
    const guide = repository.getById(id, { includeSensitive: true, includeHistory: false });
    if (!guide) return failure('NOT_FOUND', '导游档案不存在');
    if (!input.confirmed || clean(input.purpose).length < 2) {
      auditSensitive(id, '完整证件查看被拒绝', '失败', '缺少二次确认或用途');
      return failure('SENSITIVE_CONFIRMATION_REQUIRED', '查看完整证件需要勾选确认并填写用途');
    }
    try {
      const data = { idNumber: protector.reveal(guide.idNumberProtected), guideLicenseNumber: protector.reveal(guide.guideLicenseProtected) };
      const log = auditSensitive(id, `经二次确认查看完整证件；用途：${clean(input.purpose)}`, '成功');
      return success({ ...data, logId: log.id });
    } catch {
      auditSensitive(id, '完整证件查看失败', '失败', '受保护值无法读取');
      return failure('SENSITIVE_VALUE_UNAVAILABLE', '完整证件暂时无法读取');
    }
  }

  function viewDocument(id, documentType, input = {}) {
    if (!input.confirmed || clean(input.purpose).length < 2) {
      auditSensitive(id, '证件图片查看被拒绝', '失败', '缺少二次确认或用途');
      return failure('SENSITIVE_CONFIRMATION_REQUIRED', '查看证件图片需要勾选确认并填写用途');
    }
    const document = repository.documentFile(id, documentType);
    if (!document?.controlledFileRef) return failure('DOCUMENT_FILE_NOT_FOUND', '该证件没有已上传图片');
    try {
      const file = files.read(document.controlledFileRef);
      const log = auditSensitive(id, `经二次确认查看${documentType}图片；用途：${clean(input.purpose)}`, '成功');
      return success({ mimeType: file.mimeType, base64: file.buffer.toString('base64'), logId: log.id });
    } catch {
      auditSensitive(id, `${documentType}图片查看失败`, '失败', '受控文件不可读');
      return failure('DOCUMENT_FILE_NOT_FOUND', '证件图片文件不可读取');
    }
  }

  function addTourFact(id, input = {}) {
    if (!repository.getById(id)) return failure('NOT_FOUND', '导游档案不存在');
    const projectId = clean(input.projectId); const project = repository.project(projectId);
    if (!project || project.status !== '已结束') return failure('PROJECT_NOT_ENDED', '只能为已结束项目补充带团事实');
    const value = { projectId, endedOn: project.endsOn, responsibleClass: clean(input.responsibleClass), isCompleted: input.isCompleted !== false,
      isPositive: Boolean(input.isPositive), feedbackFact: clean(input.feedbackFact), correctionNote: clean(input.correctionNote), factNotes: clean(input.factNotes) };
    if (value.isPositive && !value.isCompleted) return failure('POSITIVE_REQUIRES_COMPLETION', '未完成带团不能记录好评事实');
    if (value.isPositive && !value.feedbackFact) return failure('FEEDBACK_FACT_REQUIRED', '记录好评必须填写可核实反馈事实');
    try { return success(runInTransaction(db, () => repository.addTourFact(id, value, clock()))); }
    catch (error) { return String(error.code).includes('CONSTRAINT_UNIQUE') ? failure('TOUR_FACT_EXISTS', '该项目的带团事实已经记录') : failure('TOUR_FACT_SAVE_FAILED', '带团事实保存失败'); }
  }

  function correctTourFact(id, factId, input = {}) {
    const fact = repository.tourFact(factId);
    if (!fact || fact.guideId !== id) return failure('NOT_FOUND', '带团事实不存在');
    const value = { isPositive: Boolean(input.isPositive), feedbackFact: clean(input.feedbackFact), correctionNote: clean(input.correctionNote), factNotes: clean(input.factNotes) };
    if (!value.correctionNote) return failure('CORRECTION_NOTE_REQUIRED', '纠正事实必须填写纠正说明');
    if (value.isPositive && !value.feedbackFact) return failure('FEEDBACK_FACT_REQUIRED', '记录好评必须填写可核实反馈事实');
    return success(runInTransaction(db, () => repository.correctTourFact(factId, value)));
  }

  return Object.freeze({ list, get, create, update, setStatus, remove, reveal, viewDocument, addTourFact, correctTourFact });
}
