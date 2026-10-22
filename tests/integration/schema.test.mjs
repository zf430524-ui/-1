import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate, migrations, openDatabase } from '../../src/db/migrate.mjs';

const now = '2026-09-13T00:00:00.000Z';

test('全新数据库可迁移且重复迁移幂等', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'study-tour-schema-'));
  const db = openDatabase(join(directory, 'workbench.sqlite'));
  context.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  assert.equal(migrate(db).length, 8);
  assert.equal(migrate(db).length, 8);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  for (const name of ['schools','school_contacts','guides','guide_documents','projects','classes','teachers','project_guides','transport_sheet_rows','manual_project_staff','lodging_sheet_rows','meal_sessions','staff_meal_overrides','import_batches','export_records','exceptions','operation_logs']) assert.ok(tables.includes(name), `缺少 ${name}`);
});

test('失败迁移整体回滚且不写入版本记录', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db);
    const failed = { version: 999, name: 'forced_failure', up(database) { database.exec('CREATE TABLE migration_should_rollback(id TEXT); INSERT INTO table_that_does_not_exist VALUES (1);'); } };
    assert.throws(() => migrate(db, [...migrations, failed]));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='migration_should_rollback'").get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version=999').get().n, 0);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }
});

test('外键启用且历史引用学校和导游不能被硬删除', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db);
    db.prepare('INSERT INTO schools(id,name,created_at,updated_at) VALUES (?,?,?,?)').run('school-1','湘江实验学校',now,now);
    db.prepare(`INSERT INTO projects(id,school_id,grade,destination,starts_on,ends_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run('project-1','school-1','六年级','韶山','2026-09-20','2026-09-21',now,now);
    assert.throws(() => db.prepare('DELETE FROM schools WHERE id=?').run('school-1'), /FOREIGN KEY/);

    db.prepare(`INSERT INTO guides(id,name,work_phone,gender,created_at,updated_at) VALUES (?,?,?,?,?,?)`).run('guide-1','李晨','13800000001','男',now,now);
    db.prepare(`INSERT INTO project_guides(id,project_id,guide_id,source_order,source_name,source_phone,match_status,handling_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('pg-1','project-1','guide-1',1,'李晨','13800000001','已匹配','保留',now,now);
    assert.throws(() => db.prepare('DELETE FROM guides WHERE id=?').run('guide-1'), /FOREIGN KEY/);
  } finally { db.close(); }
});

test('项目随团人员视图保留老师、导游、司机和手工角色来源', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db);
    db.prepare('INSERT INTO schools(id,name,created_at,updated_at) VALUES (?,?,?,?)').run('s','测试学校',now,now);
    db.prepare(`INSERT INTO projects(id,school_id,grade,destination,starts_on,ends_on,needs_lodging,includes_meals,meal_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('p','s','五年级','长沙','2026-09-20','2026-09-21',1,1,2,now,now);
    db.prepare(`INSERT INTO classes(id,project_id,name,student_total,boys,girls,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run('c','p','五年级1班',40,20,20,now,now);
    db.prepare(`INSERT INTO teachers(id,class_id,role,name,phone,gender,needs_lodging,joins_default_meals,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('t','c','班主任','周老师','13800000002','女',1,1,now,now);
    db.prepare(`INSERT INTO guides(id,name,work_phone,gender,created_at,updated_at) VALUES (?,?,?,?,?,?)`).run('g','李晨','13800000003','男',now,now);
    db.prepare(`INSERT INTO project_guides(id,project_id,guide_id,source_order,source_name,source_phone,match_status,handling_status,needs_lodging,joins_default_meals,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('pg','p','g',1,'李晨','13800000003','已匹配','保留',1,1,now,now);
    db.prepare(`INSERT INTO transport_sheet_rows(id,project_id,vehicle_label,capacity,driver_name,driver_phone,driver_gender,driver_needs_lodging,driver_joins_default_meals,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('tr','p','车辆1',49,'陈师傅','13800000004','男',1,1,now,now);
    db.prepare(`INSERT INTO manual_project_staff(id,project_id,role,gender,people_count,lodging_count,default_meal_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run('m','p','摄影师','男',2,2,2,now,now);
    assert.deepEqual(db.prepare('SELECT source_type FROM project_staff_sources WHERE project_id=? ORDER BY source_type').all('p').map((row) => row.source_type), ['manual_role','project_guide','teacher','transport_driver']);
  } finally { db.close(); }
});

test('schema 不含银行卡或学生个人名单字段', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db);
    const sql = db.prepare("SELECT group_concat(sql, ' ') AS sql FROM sqlite_master").get().sql.toLowerCase();
    for (const forbidden of ['bank_card','bank account','student_name','student_id_number']) assert.equal(sql.includes(forbidden), false, `发现禁止字段 ${forbidden}`);
  } finally { db.close(); }
});
