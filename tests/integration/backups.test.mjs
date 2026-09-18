import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createOperationLogRepository } from '../../src/db/repositories/operation-logs.mjs';
import { createAuditService } from '../../src/services/audit.mjs';
import { createBackupService } from '../../src/services/backups.mjs';

function setup(context, { start = '2026-09-13T08:00:00.000Z', removeBackup } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'study-tour-backup-'));
  const databasePath = join(root, 'data', 'workbench.sqlite');
  const certificatesPath = join(root, 'certificates');
  const backupsPath = join(root, 'backups');
  mkdirSync(certificatesPath, { recursive: true });
  let now = start;
  let db;
  let logs;
  let audit;
  const reopenDatabase = () => {
    db = openDatabase(databasePath);
    migrate(db);
    logs = createOperationLogRepository(db);
    audit = createAuditService(logs, () => now);
  };
  const closeDatabase = () => { if (db?.open) db.close(); };
  reopenDatabase();
  const service = createBackupService({
    databasePath, certificatesPath, backupsPath,
    getDatabase: () => db,
    closeDatabase,
    reopenDatabase,
    recordAudit: (entry) => audit.record(entry),
    listAudit: (filters) => logs.list(filters),
    clock: () => now,
    removeBackup
  });
  context.after(() => {
    closeDatabase();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, databasePath, certificatesPath, backupsPath, service, get db() { return db; }, get logs() { return logs; }, setNow(value) { now = value; } };
}

test('写入、备份、修改、恢复后数据库和证件内容一致', async (context) => {
  const fixture = setup(context);
  const now = '2026-09-13T08:00:00.000Z';
  fixture.db.prepare('INSERT INTO schools(id,name,created_at,updated_at) VALUES (?,?,?,?)').run('school-before', '恢复前学校', now, now);
  writeFileSync(join(fixture.certificatesPath, 'guide-a.txt'), '脱敏证件版本一', 'utf8');

  const created = await fixture.service.createBackup({ note: '恢复链路样本' });
  assert.equal(created.ok, true);
  assert.equal((await fixture.service.verify(created.data.backup.id)).ok, true);

  fixture.db.prepare('INSERT INTO schools(id,name,created_at,updated_at) VALUES (?,?,?,?)').run('school-after', '备份后新增学校', now, now);
  writeFileSync(join(fixture.certificatesPath, 'guide-a.txt'), '脱敏证件版本二', 'utf8');
  const restored = await fixture.service.restore(created.data.backup.id, { confirmation: created.data.backup.id, backupCurrent: true });

  assert.equal(restored.ok, true);
  assert.deepEqual(fixture.db.prepare('SELECT id FROM schools ORDER BY id').all().map((row) => row.id), ['school-before']);
  assert.equal(readFileSync(join(fixture.certificatesPath, 'guide-a.txt'), 'utf8'), '脱敏证件版本一');
  const restoreLogs = fixture.logs.list({ operationType: '恢复' });
  assert.ok(restoreLogs.some((entry) => entry.result === '成功' && entry.objectId === created.data.backup.id), JSON.stringify(restoreLogs));
  const listing = await fixture.service.list();
  assert.ok(listing.data.backups.some((backup) => backup.kind === 'pre_restore' && backup.protected));
});

test('损坏备份被拒绝且当前数据库与证件不变', async (context) => {
  const fixture = setup(context);
  const now = '2026-09-13T08:00:00.000Z';
  fixture.db.prepare('INSERT INTO schools(id,name,created_at,updated_at) VALUES (?,?,?,?)').run('stable', '当前学校', now, now);
  writeFileSync(join(fixture.certificatesPath, 'guide.txt'), '当前证件', 'utf8');
  const created = await fixture.service.createBackup();
  writeFileSync(join(fixture.backupsPath, created.data.backup.id, 'database.sqlite'), 'not-a-database', 'utf8');

  const result = await fixture.service.restore(created.data.backup.id, { confirmation: created.data.backup.id, backupCurrent: true });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'BACKUP_HASH_MISMATCH');
  assert.equal(fixture.db.prepare('SELECT name FROM schools WHERE id=?').get('stable').name, '当前学校');
  assert.equal(readFileSync(join(fixture.certificatesPath, 'guide.txt'), 'utf8'), '当前证件');
  assert.ok(fixture.logs.list({ operationType: '恢复' }).some((entry) => entry.result === '失败'));
});

test('退出提醒三个动作均可验证且直接退出需要二次确认', async (context) => {
  const fixture = setup(context);
  assert.equal(await fixture.service.requiresExitReminder(), true);
  assert.deepEqual((await fixture.service.exitDecision({ action: 'stay' })).data, { canExit: false, action: 'stay' });
  assert.equal(await fixture.service.requiresExitReminder(), true);
  assert.equal((await fixture.service.exitDecision({ action: 'exit_without_backup' })).error.code, 'EXIT_CONFIRMATION_REQUIRED');
  assert.equal((await fixture.service.exitDecision({ action: 'exit_without_backup', confirmed: true })).data.canExit, true);
  assert.equal(await fixture.service.requiresExitReminder(), false);

  fixture.setNow('2026-09-14T08:00:00.000Z');
  const backedUp = await fixture.service.exitDecision({ action: 'backup_and_exit' });
  assert.equal(backedUp.ok, true);
  assert.equal(backedUp.data.canExit, true);
  assert.equal(await fixture.service.requiresExitReminder(), false);
});

test('轮转保留 30 个日代表和 12 个按月代表，归档副本不删除', async (context) => {
  const fixture = setup(context, { start: '2025-01-01T08:00:00.000Z' });
  let protectedId = '';
  for (let index = 0; index < 50; index += 1) {
    const date = new Date(Date.UTC(2025, 0, 1 + index * 11, 8));
    fixture.setNow(date.toISOString());
    const result = await fixture.service.createBackup({ includeDatabase: false, includeCertificates: true, protected: index === 0 });
    assert.equal(result.ok, true);
    if (index === 0) protectedId = result.data.backup.id;
  }
  const listing = await fixture.service.list();
  assert.ok(listing.data.backups.length > 30 && listing.data.backups.length <= 43);
  assert.ok(listing.data.backups.some((backup) => backup.id === protectedId && backup.protected));
  assert.equal(listing.data.invalid.length, 0);
});

test('旧备份清理失败时新备份仍然存在且可校验', async (context) => {
  const fixture = setup(context, { removeBackup: async () => { throw new Error('simulated cleanup denial'); } });
  const first = await fixture.service.createBackup({ includeDatabase: false, includeCertificates: true });
  fixture.setNow('2026-09-13T09:00:00.000Z');
  const second = await fixture.service.createBackup({ includeDatabase: false, includeCertificates: true });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.data.cleanup.status, '部分失败');
  assert.equal((await fixture.service.verify(second.data.backup.id)).ok, true);
});
