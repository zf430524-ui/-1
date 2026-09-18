import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  access, copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { failure, success } from './result.mjs';

const FORMAT_VERSION = 1;
const BACKUP_ID = /^backup-\d{8}T\d{9}Z-[a-f0-9]{8}$/;
const DAY_LIMIT = 30;
const MONTH_LIMIT = 12;

function publicError(code, message, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function localDay(value) {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localMonth(value) {
  return localDay(value).slice(0, 7);
}

function backupId(createdAt) {
  const stamp = new Date(createdAt).toISOString().replace(/[-:.]/g, '');
  return `backup-${stamp}-${randomBytes(4).toString('hex')}`;
}

function safeChild(root, child) {
  const target = resolve(root, child);
  const prefix = `${resolve(root)}${sep}`;
  if (!target.startsWith(prefix)) throw publicError('INVALID_BACKUP_PATH', '备份清单包含无效路径');
  return target;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function listFiles(root, prefix = '') {
  if (!await exists(root)) return [];
  const rows = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const source = join(root, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw publicError('UNSAFE_CERTIFICATE_ENTRY', '证件目录不能包含符号链接');
    if (entry.isDirectory()) rows.push(...await listFiles(source, relativePath));
    else if (entry.isFile()) rows.push({ source, relativePath });
  }
  return rows.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'));
}

async function describeFile(path, manifestPath) {
  const info = await stat(path);
  return { path: manifestPath, size: info.size, sha256: await sha256(path) };
}

function validateManifestShape(manifest, expectedId) {
  if (!manifest || manifest.formatVersion !== FORMAT_VERSION || manifest.id !== expectedId || !BACKUP_ID.test(manifest.id)) {
    throw publicError('INVALID_BACKUP_MANIFEST', '备份清单格式无效');
  }
  if (!Array.isArray(manifest.files) || !manifest.contents || typeof manifest.createdAt !== 'string') {
    throw publicError('INVALID_BACKUP_MANIFEST', '备份清单缺少必要字段');
  }
  const paths = new Set();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw publicError('INVALID_BACKUP_MANIFEST', '备份文件清单格式无效');
    }
    if (paths.has(file.path)) throw publicError('INVALID_BACKUP_MANIFEST', '备份清单包含重复文件');
    paths.add(file.path);
  }
  if (manifest.contents.database !== paths.has('database.sqlite')) throw publicError('INCOMPLETE_BACKUP', '数据库备份清单不完整');
  const certificateFiles = [...paths].filter((path) => path.startsWith('certificates/'));
  if (!manifest.contents.certificates && certificateFiles.length) throw publicError('INCOMPLETE_BACKUP', '证件备份清单不一致');
  return manifest;
}

function verifySqlite(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('quick_check', { simple: true });
    if (integrity !== 'ok') throw publicError('CORRUPT_BACKUP_DATABASE', '备份数据库完整性校验失败');
    const migrations = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    if (!migrations) throw publicError('INVALID_BACKUP_DATABASE', '备份数据库缺少版本信息');
    const required = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    for (const table of ['schools', 'projects', 'operation_logs']) {
      if (!required.has(table)) throw publicError('INVALID_BACKUP_DATABASE', `备份数据库缺少 ${table} 表`);
    }
  } finally { db.close(); }
}

function normalizeBackupSqlite(path) {
  const db = new Database(path, { fileMustExist: true });
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('journal_mode = DELETE');
    const integrity = db.pragma('quick_check', { simple: true });
    if (integrity !== 'ok') throw publicError('CORRUPT_BACKUP_DATABASE', '备份数据库完整性校验失败');
  } finally { db.close(); }
}

async function readManifest(directory, expectedId) {
  let manifest;
  try { manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')); }
  catch (error) { throw publicError('INVALID_BACKUP_MANIFEST', '无法读取备份清单', error); }
  return validateManifestShape(manifest, expectedId);
}

async function verifyDirectory(directory, expectedId) {
  const manifest = await readManifest(directory, expectedId);
  const expectedPaths = new Set(manifest.files.map((file) => file.path));
  const actualPaths = new Set((await listFiles(directory)).map((file) => file.relativePath).filter((path) => path !== 'manifest.json'));
  if (actualPaths.size !== expectedPaths.size || [...actualPaths].some((path) => !expectedPaths.has(path))) {
    throw publicError('INCOMPLETE_BACKUP', '备份目录与清单不一致');
  }
  for (const item of manifest.files) {
    const path = safeChild(directory, item.path);
    const info = await lstat(path).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink() || info.size !== item.size || await sha256(path) !== item.sha256) {
      throw publicError('BACKUP_HASH_MISMATCH', `备份文件校验失败：${item.path}`);
    }
  }
  if (manifest.contents.database) verifySqlite(join(directory, 'database.sqlite'));
  return manifest;
}

function summary(manifest) {
  return {
    id: manifest.id,
    createdAt: manifest.createdAt,
    kind: manifest.kind,
    protected: Boolean(manifest.protected),
    note: manifest.note || '',
    contents: manifest.contents,
    fileCount: manifest.files.length,
    totalBytes: manifest.files.reduce((total, file) => total + file.size, 0),
    verifiedAt: manifest.verifiedAt
  };
}

export function createBackupService({
  databasePath,
  certificatesPath,
  backupsPath,
  getDatabase,
  closeDatabase,
  reopenDatabase,
  recordAudit,
  listAudit,
  clock = () => new Date().toISOString(),
  openBackupLocation = null,
  removeBackup = (path) => rm(path, { recursive: true })
}) {
  if (databasePath === ':memory:') throw publicError('BACKUP_REQUIRES_FILE_DATABASE', '内存数据库不能执行备份');
  let maintenance = Promise.resolve();

  function serialize(operation) {
    const current = maintenance.then(operation, operation);
    maintenance = current.catch(() => undefined);
    return current;
  }

  async function validatedBackups() {
    await mkdir(backupsPath, { recursive: true });
    const entries = await readdir(backupsPath, { withFileTypes: true });
    const valid = [];
    const invalid = [];
    for (const entry of entries.filter((item) => item.isDirectory() && BACKUP_ID.test(item.name))) {
      try { valid.push(await verifyDirectory(join(backupsPath, entry.name), entry.name)); }
      catch (error) { invalid.push({ id: entry.name, code: error.code || 'BACKUP_INVALID', message: error.message }); }
    }
    valid.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { valid, invalid };
  }

  async function rotate(extraKeep = []) {
    const { valid, invalid } = await validatedBackups();
    const keep = new Set(valid.filter((item) => item.protected).map((item) => item.id));
    extraKeep.forEach((id) => keep.add(id));
    if (valid[0]) keep.add(valid[0].id);
    const daily = new Map();
    const monthly = new Map();
    for (const item of valid) {
      if (!daily.has(localDay(item.createdAt))) daily.set(localDay(item.createdAt), item.id);
      if (!monthly.has(localMonth(item.createdAt))) monthly.set(localMonth(item.createdAt), item.id);
    }
    [...daily.values()].slice(0, DAY_LIMIT).forEach((id) => keep.add(id));
    [...monthly.values()].slice(0, MONTH_LIMIT).forEach((id) => keep.add(id));
    const removable = valid.filter((item) => !keep.has(item.id));
    const failures = [];
    let removed = 0;
    for (const item of removable) {
      try { await removeBackup(join(backupsPath, item.id)); removed += 1; }
      catch { failures.push(item.id); }
    }
    return {
      status: failures.length ? '部分失败' : '成功',
      retained: valid.length - removed,
      removed,
      failed: failures.length,
      invalidSkipped: invalid.length
    };
  }

  async function createBackupInternal({ includeDatabase = true, includeCertificates = true, note = '', kind = 'manual', protected: protectedCopy = false, preserveIds = [] } = {}) {
    if (!includeDatabase && !includeCertificates) return failure('BACKUP_CONTENT_REQUIRED', '请至少选择数据库或证件目录');
    if (String(note).length > 200) return failure('BACKUP_NOTE_TOO_LONG', '备份备注不能超过 200 个字符');
    const createdAt = clock();
    const id = backupId(createdAt);
    const temporary = join(backupsPath, `.${id}.tmp`);
    const destination = join(backupsPath, id);
    await mkdir(backupsPath, { recursive: true });
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { recursive: true });
    try {
      const files = [];
      if (includeDatabase) {
        const target = join(temporary, 'database.sqlite');
        await getDatabase().backup(target);
        normalizeBackupSqlite(target);
        files.push(await describeFile(target, 'database.sqlite'));
      }
      if (includeCertificates) {
        const certificateFiles = await listFiles(certificatesPath);
        for (const file of certificateFiles) {
          const manifestPath = `certificates/${file.relativePath}`;
          const target = safeChild(temporary, manifestPath);
          await mkdir(dirname(target), { recursive: true });
          await copyFile(file.source, target);
          files.push(await describeFile(target, manifestPath));
        }
      }
      const manifest = {
        formatVersion: FORMAT_VERSION,
        id,
        createdAt,
        verifiedAt: clock(),
        kind,
        protected: Boolean(protectedCopy),
        note: String(note).trim(),
        contents: { database: Boolean(includeDatabase), certificates: Boolean(includeCertificates) },
        files
      };
      await writeFile(join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await verifyDirectory(temporary, id);
      await rename(temporary, destination);
      const cleanup = await rotate(preserveIds);
      recordAudit({
        operationType: '备份', objectType: '本地备份', objectId: id,
        summary: `已生成并校验备份；数据库=${includeDatabase ? '是' : '否'}；证件=${includeCertificates ? '是' : '否'}；清理=${cleanup.status}`,
        result: cleanup.status === '成功' ? '成功' : '部分成功',
        failureReason: cleanup.status === '成功' ? '' : `有 ${cleanup.failed} 个旧备份清理失败`
      });
      return success({ backup: summary(manifest), cleanup });
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      recordAudit({ operationType: '备份', objectType: '本地备份', objectId: id, summary: '备份创建或校验失败', result: '失败', failureReason: error.message });
      return failure(error.code || 'BACKUP_FAILED', error.message || '备份失败');
    }
  }

  function createBackup(options) {
    return serialize(() => createBackupInternal(options));
  }

  async function verify(id) {
    if (!BACKUP_ID.test(String(id))) return failure('BACKUP_NOT_FOUND', '备份不存在');
    try {
      const manifest = await verifyDirectory(join(backupsPath, id), id);
      return success(summary(manifest));
    } catch (error) {
      return failure(error.code || 'BACKUP_INVALID', error.message || '备份校验失败');
    }
  }

  async function list() {
    const { valid, invalid } = await validatedBackups();
    return success({ backups: valid.map(summary), invalid });
  }

  async function status() {
    const { valid, invalid } = await validatedBackups();
    const today = localDay(clock());
    const latestLog = listAudit({ operationType: '备份', limit: 200 }).find((entry) => entry.objectType === '本地备份');
    return success({
      databaseLocation: '.runtime/data/workbench.sqlite',
      certificatesLocation: '.runtime/certificates',
      backupLocation: '.runtime/backups',
      latest: valid[0] ? summary(valid[0]) : null,
      latestResult: latestLog?.result || null,
      todayVerifiedAt: valid.find((item) => localDay(item.createdAt) === today)?.verifiedAt || null,
      retention: { daily: DAY_LIMIT, monthly: MONTH_LIMIT },
      invalidCount: invalid.length
    });
  }

  async function requiresExitReminder() {
    const current = await status();
    if (current.data.todayVerifiedAt) return false;
    const today = localDay(clock());
    return !listAudit({ operationType: '备份', limit: 200 }).some((entry) => entry.objectType === '退出备份提醒' && localDay(entry.occurredAt) === today && entry.objectId === '仍然退出');
  }

  async function exitDecision({ action, confirmed = false } = {}) {
    if (action === 'stay') return success({ canExit: false, action });
    if (action === 'backup_and_exit') {
      const result = await createBackupInternal({ includeDatabase: true, includeCertificates: true, note: '退出应用前自动备份' });
      if (!result.ok) return result;
      return success({ canExit: true, action, backup: result.data.backup, cleanup: result.data.cleanup });
    }
    if (action === 'exit_without_backup') {
      if (!confirmed) return failure('EXIT_CONFIRMATION_REQUIRED', '仍然退出需要再次确认');
      recordAudit({ operationType: '备份', objectType: '退出备份提醒', objectId: '仍然退出', summary: '负责人确认当天无已校验备份仍然退出', result: '部分成功', failureReason: '当天没有成功且已校验的备份' });
      return success({ canExit: true, action, warningRecorded: true });
    }
    return failure('INVALID_EXIT_ACTION', '退出操作无效');
  }

  async function restoreInternal(id, { confirmation = '', backupCurrent = true, acknowledgeOverwriteWithoutBackup = false } = {}) {
    if (!BACKUP_ID.test(String(id))) return failure('BACKUP_NOT_FOUND', '备份不存在');
    if (confirmation !== id) return failure('RESTORE_CONFIRMATION_REQUIRED', '恢复前必须再次确认所选备份');
    if (!backupCurrent && !acknowledgeOverwriteWithoutBackup) return failure('RESTORE_BACKUP_ACK_REQUIRED', '取消恢复前备份时必须确认覆盖风险');
    const directory = join(backupsPath, id);
    let manifest;
    try { manifest = await verifyDirectory(directory, id); }
    catch (error) {
      recordAudit({ operationType: '恢复', objectType: '本地备份', objectId: id, summary: '恢复前校验失败，当前数据未改变', result: '失败', failureReason: error.message });
      return failure(error.code || 'BACKUP_INVALID', error.message || '备份校验失败');
    }
    if (backupCurrent) {
      const safety = await createBackupInternal({ includeDatabase: true, includeCertificates: true, note: `恢复 ${id} 前的自动保护副本`, kind: 'pre_restore', protected: true, preserveIds: [id] });
      if (!safety.ok) return failure('PRE_RESTORE_BACKUP_FAILED', '恢复前保护备份失败，已取消恢复', { cause: safety.error.code });
    }

    const suffix = `${Date.now()}-${randomBytes(3).toString('hex')}`;
    const stagedDb = `${databasePath}.restore-${suffix}`;
    const previousDb = `${databasePath}.rollback-${suffix}`;
    const stagedCertificates = `${certificatesPath}.restore-${suffix}`;
    const previousCertificates = `${certificatesPath}.rollback-${suffix}`;
    let databaseMoved = false;
    let certificatesMoved = false;
    try {
      if (manifest.contents.database) await copyFile(join(directory, 'database.sqlite'), stagedDb);
      if (manifest.contents.certificates) {
        await mkdir(stagedCertificates, { recursive: true });
        for (const item of manifest.files.filter((file) => file.path.startsWith('certificates/'))) {
          const relativePath = item.path.slice('certificates/'.length);
          const target = safeChild(stagedCertificates, relativePath);
          await mkdir(dirname(target), { recursive: true });
          await copyFile(safeChild(directory, item.path), target);
        }
      }
      await verifyDirectory(directory, id);
      closeDatabase();
      try {
        if (manifest.contents.database) {
          await rename(databasePath, previousDb);
          databaseMoved = true;
          await rename(stagedDb, databasePath);
        }
        if (manifest.contents.certificates) {
          if (await exists(certificatesPath)) {
            await rename(certificatesPath, previousCertificates);
            certificatesMoved = true;
          }
          await rename(stagedCertificates, certificatesPath);
        }
        reopenDatabase();
      } catch (error) {
        if (manifest.contents.database) await rm(databasePath, { force: true }).catch(() => undefined);
        if (manifest.contents.certificates) await rm(certificatesPath, { recursive: true, force: true }).catch(() => undefined);
        if (databaseMoved) await rename(previousDb, databasePath);
        if (certificatesMoved) await rename(previousCertificates, certificatesPath);
        else await mkdir(certificatesPath, { recursive: true });
        reopenDatabase();
        throw error;
      }
      await rm(previousDb, { force: true }).catch(() => undefined);
      await rm(previousCertificates, { recursive: true, force: true }).catch(() => undefined);
      recordAudit({ operationType: '恢复', objectType: '本地备份', objectId: id, summary: '备份已校验并完成恢复', result: '成功' });
      return success({ restored: true, backup: summary(manifest) });
    } catch (error) {
      await rm(stagedDb, { force: true }).catch(() => undefined);
      await rm(stagedCertificates, { recursive: true, force: true }).catch(() => undefined);
      recordAudit({ operationType: '恢复', objectType: '本地备份', objectId: id, summary: '恢复失败，已保留或回滚当前数据', result: '失败', failureReason: error.message });
      return failure(error.code || 'RESTORE_FAILED', '恢复失败，当前数据未被半覆盖');
    }
  }

  function restore(id, options) {
    return serialize(() => restoreInternal(id, options));
  }

  async function openLocation() {
    if (!openBackupLocation) return failure('OPEN_LOCATION_UNAVAILABLE', '当前环境不能直接打开备份目录');
    await mkdir(backupsPath, { recursive: true });
    await openBackupLocation(backupsPath);
    return success({ opened: true });
  }

  return Object.freeze({ createBackup, verify, list, status, rotate, restore, requiresExitReminder, exitDecision, openLocation });
}
