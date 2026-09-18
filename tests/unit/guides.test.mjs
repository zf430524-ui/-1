import test from 'node:test';
import assert from 'node:assert/strict';
import { documentExpiryStatus } from '../../src/services/guides.mjs';
import { createSensitiveValueProtector, maskDocumentNumber } from '../../src/services/sensitive-values.mjs';

test('证件状态以当天和 30 天阈值计算边界', () => {
  const today = '2026-09-15';
  assert.equal(documentExpiryStatus(null, today), '缺失');
  assert.equal(documentExpiryStatus({ expiresOn: '' }, today), '缺失');
  assert.equal(documentExpiryStatus({ expiresOn: '2026-09-14' }, today), '过期');
  assert.equal(documentExpiryStatus({ expiresOn: '2026-09-15' }, today), '临期');
  assert.equal(documentExpiryStatus({ expiresOn: '2026-10-15' }, today), '临期');
  assert.equal(documentExpiryStatus({ expiresOn: '2026-10-16' }, today), '有效');
});

test('完整证件值使用认证加密保存并只生成末四位脱敏值', () => {
  const protector = createSensitiveValueProtector('unit-test-secret');
  const protectedValue = protector.protect('430102199001011234');
  assert.notEqual(protectedValue, '430102199001011234');
  assert.equal(protector.reveal(protectedValue), '430102199001011234');
  assert.equal(maskDocumentNumber('430102199001011234', '身份证'), '**************1234');
  assert.equal(maskDocumentNumber('D-TEST-1824', '导游证').endsWith('1824'), true);
});
