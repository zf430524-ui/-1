import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSchoolInput } from '../../src/services/schools.mjs';

test('学校名称必填且联系人姓名与电话成组校验', () => {
  const missing = validateSchoolInput({ contacts: [{ name: '周老师' }] });
  assert.deepEqual(missing.errors.map((item) => item.field), ['name', 'contacts.0.phone']);
});

test('同一学校最多一个默认联系人', () => {
  const result = validateSchoolInput({ name: '测试学校', contacts: [
    { name: '周老师', phone: '13800000001', isDefault: true },
    { name: '陈老师', phone: '13800000002', isDefault: true }
  ] });
  assert.ok(result.errors.some((item) => item.field === 'contacts'));
});
