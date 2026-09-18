import { runInTransaction } from '../db/transaction.mjs';
import { failure, success } from './result.mjs';

const phonePattern = /^[0-9+()\-\s]{6,24}$/;

function normalizeInput(input = {}) {
  return {
    name: String(input.name || '').trim(),
    cooperationNotes: String(input.cooperationNotes || '').trim(),
    contacts: Array.isArray(input.contacts) ? input.contacts.map((contact) => ({
      id: contact.id || undefined,
      name: String(contact.name || '').trim(),
      phone: String(contact.phone || '').trim(),
      notes: String(contact.notes || '').trim(),
      isDefault: Boolean(contact.isDefault)
    })).filter((contact) => contact.name || contact.phone || contact.notes) : [],
    confirmSimilar: Boolean(input.confirmSimilar)
  };
}

export function validateSchoolInput(input) {
  const value = normalizeInput(input);
  const errors = [];
  if (!value.name) errors.push({ field: 'name', message: '请填写学校名称' });
  if (value.name.length > 100) errors.push({ field: 'name', message: '学校名称不能超过 100 个字' });
  if (value.contacts.filter((contact) => contact.isDefault).length > 1) errors.push({ field: 'contacts', message: '同一学校最多设置一个默认联系人' });
  value.contacts.forEach((contact, index) => {
    if (!contact.name) errors.push({ field: `contacts.${index}.name`, message: '已填写联系人信息时，姓名不能为空' });
    if (!contact.phone) errors.push({ field: `contacts.${index}.phone`, message: '填写联系人姓名后，联系电话必填' });
    else if (!phonePattern.test(contact.phone)) errors.push({ field: `contacts.${index}.phone`, message: '联系电话格式不正确' });
  });
  return { value, errors };
}

export function createSchoolService({ db, repository, clock = () => new Date().toISOString() }) {
  function list(options) { return success(repository.list(options)); }
  function get(id) {
    const school = repository.getById(id);
    return school ? success(school) : failure('NOT_FOUND', '学校不存在');
  }
  function checkSimilar(value, excludeId = '') {
    const candidates = repository.findSimilar(value.name, excludeId);
    if (!candidates.length || value.confirmSimilar) return null;
    return failure('SIMILAR_SCHOOL', '发现名称相近的学校，请确认不是重复资料', { candidates, requiresConfirmation: true });
  }
  function create(input) {
    const { value, errors } = validateSchoolInput(input);
    if (errors.length) return failure('VALIDATION_ERROR', '学校资料未通过校验', { fields: errors });
    const similar = checkSimilar(value);
    if (similar) return similar;
    try { return success(runInTransaction(db, () => repository.create(value, clock()))); }
    catch (error) {
      if (String(error.code).includes('CONSTRAINT_UNIQUE')) return failure('DUPLICATE_SCHOOL', '学校名称已经存在');
      throw error;
    }
  }
  function update(id, input) {
    if (!repository.getById(id)) return failure('NOT_FOUND', '学校不存在');
    const { value, errors } = validateSchoolInput(input);
    if (errors.length) return failure('VALIDATION_ERROR', '学校资料未通过校验', { fields: errors });
    const similar = checkSimilar(value, id);
    if (similar) return similar;
    try { return success(runInTransaction(db, () => repository.update(id, value, clock()))); }
    catch (error) {
      if (String(error.code).includes('CONSTRAINT_UNIQUE')) return failure('DUPLICATE_SCHOOL', '学校名称已经存在');
      throw error;
    }
  }
  function setActive(id, active) {
    const school = runInTransaction(db, () => repository.setActive(id, Boolean(active), clock()));
    return school ? success(school) : failure('NOT_FOUND', '学校不存在');
  }
  function remove(id) {
    const result = runInTransaction(db, () => repository.removeIfUnused(id));
    if (!result.removed && result.references) return failure('SCHOOL_IN_USE', `学校已被 ${result.references} 个项目引用，不能删除，请改为停用`, { references: result.references });
    return result.removed ? success({ id, removed: true }) : failure('NOT_FOUND', '学校不存在');
  }
  function projectDefaults(id) {
    const school = repository.getById(id);
    if (!school) return failure('NOT_FOUND', '学校不存在');
    const contact = school.contacts.find((item) => item.isDefault) || null;
    return success({ schoolId: school.id, schoolName: school.name, schoolLeadName: contact?.name || '', schoolLeadPhone: contact?.phone || '' });
  }
  return { list, get, create, update, setActive, remove, projectDefaults };
}
