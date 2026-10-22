import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createOperationLogRepository } from '../../src/db/repositories/operation-logs.mjs';
import { createAuditService } from '../../src/services/audit.mjs';

test('备份和业务对象 ID 的随机段以 D 开头时不会被误判为导游证号', () => {
  const values = ['backup-20260913T080000000Z-D4693058-b7eb-4e3e-9c60-2096dabced81', 'vehicle_d0e8d0a2-5fb6-4d46-8957-4c7acb05061d'];
  const db = openDatabase(':memory:');
  try {
    migrate(db); const repository = createOperationLogRepository(db); const audit = createAuditService(repository, () => '2026-09-13T02:00:00.000Z');
    values.forEach((value) => audit.record({ operationType: '恢复', objectType: '本地备份', objectId: value, summary: '恢复完成', result: '成功' }));
    assert.deepEqual(new Set(repository.list().map((row) => row.objectId)), new Set(values));
  } finally { db.close(); }
});

test('六类关键操作及失败结果均可追查且敏感值被清除', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db);
    const repository = createOperationLogRepository(db);
    const audit = createAuditService(repository, () => '2026-09-13T02:00:00.000Z');
    const sensitiveId = '430102199001011234';
    const sensitiveLicense = 'D-4301-SECRET-1824';
    const sensitivePath = 'C:\\Users\\负责人\\certificates\\guide.png';
    const operations = ['导入', '查看敏感资料', '修改安排', '导出', '备份', '恢复'];
    operations.forEach((operationType, index) => audit.record({
      projectId: null, operationType, objectType: '测试对象', objectId: `object-${index}`,
      summary: `处理 ${sensitiveId} ${sensitiveLicense} ${sensitivePath}`,
      result: index === 5 ? '失败' : '成功', failureReason: index === 5 ? `无法读取 ${sensitivePath}` : ''
    }));
    const records = repository.list();
    assert.equal(records.length, 6);
    assert.equal(new Set(records.map((row) => row.operationType)).size, 6);
    assert.ok(records.some((row) => row.result === '失败' && row.failureReason));
    const serialized = JSON.stringify(records);
    for (const forbidden of [sensitiveId, sensitiveLicense, sensitivePath, 'guide.png']) assert.equal(serialized.includes(forbidden), false, `日志泄露 ${forbidden}`);
  } finally { db.close(); }
});

test('日志仓储不暴露编辑或删除方法', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db);
    const repository = createOperationLogRepository(db);
    assert.deepEqual(Object.keys(repository).sort(), ['append', 'getById', 'list']);
  } finally { db.close(); }
});
