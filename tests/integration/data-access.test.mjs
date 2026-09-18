import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createSchoolRepository } from '../../src/db/repositories/schools.mjs';
import { runInTransaction } from '../../src/db/transaction.mjs';

const now = '2026-09-13T01:00:00.000Z';

test('事务内故意失败后不留下半写入', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db);
    const schools = createSchoolRepository(db);
    assert.throws(() => runInTransaction(db, () => {
      schools.create({ name: '事务学校一' }, now);
      schools.create({ name: '事务学校二' }, now);
      throw new Error('sentinel failure');
    }), /sentinel failure/);
    assert.equal(schools.list().length, 0);
  } finally { db.close(); }
});

test('仓储查询使用参数绑定，输入不改变 SQL 结构', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db);
    const schools = createSchoolRepository(db);
    runInTransaction(db, () => schools.create({ name: "测试学校'); DROP TABLE schools;--" }, now));
    assert.equal(schools.list({ query: 'DROP TABLE' }).length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='schools'").get().count, 1);
  } finally { db.close(); }
});

test('统一结果结构明确区分成功、部分成功和失败', async () => {
  const { success, partial, failure } = await import('../../src/services/result.mjs');
  assert.deepEqual(success({ id: '1' }).status, 'success');
  assert.deepEqual(partial([{ id: '1' }], [{ row: 2 }]).status, 'partial');
  assert.deepEqual(failure('INVALID', '输入错误').status, 'failure');
});
