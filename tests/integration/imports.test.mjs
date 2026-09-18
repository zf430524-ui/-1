import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createImportRepository } from '../../src/db/repositories/imports.mjs';
import { createOperationLogRepository } from '../../src/db/repositories/operation-logs.mjs';
import { createSchoolRepository } from '../../src/db/repositories/schools.mjs';
import { createAuditService } from '../../src/services/audit.mjs';
import { createImportService } from '../../src/services/imports.mjs';
import { createSchoolService } from '../../src/services/schools.mjs';
import { buildDocxTableBuffer, buildExcelBuffer } from '../fixtures/import-files.mjs';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'study-imports-'));
  const db = openDatabase(':memory:');
  migrate(db);
  const schoolRepository = createSchoolRepository(db);
  const schools = createSchoolService({ db, repository: schoolRepository, clock: () => '2026-09-13T11:00:00.000Z' });
  const auditRepository = createOperationLogRepository(db);
  const imports = createImportService({ db, repository: createImportRepository(db), schoolRepository, schools, audit: createAuditService(auditRepository, () => '2026-09-13T11:00:00.000Z'), importsPath: join(root, 'imports'), clock: () => '2026-09-13T11:00:00.000Z' });
  return { root, db, schools, auditRepository, imports, close() { db.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('解析失败不污染正式表，取消清理临时行与文件并留下审计', async () => {
  const fixture = setup();
  try {
    const failed = await fixture.imports.create({ targetType: 'schools', importMethod: '粘贴文字', text: '无法识别的一行' });
    assert.equal(failed.ok, false);
    assert.equal(fixture.schools.list().data.length, 0);

    const created = await fixture.imports.create({ targetType: 'schools', importMethod: '粘贴文字', text: '学校名称,联系人姓名,联系人电话\n取消测试学校,周老师,13800000001' });
    assert.equal(created.ok, true);
    assert.equal(created.data.status, '待确认');
    assert.equal(existsSync(join(fixture.root, 'imports', created.data.id)), true);
    const canceled = await fixture.imports.cancel(created.data.id);
    assert.equal(canceled.data.status, '已取消');
    assert.equal(canceled.data.rows.length, 0);
    assert.equal(existsSync(join(fixture.root, 'imports', created.data.id)), false);
    assert.ok(fixture.auditRepository.list({ operationType: '导入' }).some((entry) => entry.changeSummary.includes('取消导入')));
  } finally { fixture.close(); }
});

test('相同来源重复提交被识别并返回原批次', async () => {
  const fixture = setup();
  try {
    const input = { targetType: 'schools', importMethod: '粘贴文字', text: '学校名称,合作备注\n重复测试学校,第一次' };
    const first = await fixture.imports.create(input);
    const duplicate = await fixture.imports.create(input);
    assert.equal(first.ok, true);
    assert.equal(duplicate.error.code, 'DUPLICATE_IMPORT');
    assert.equal(duplicate.error.details.batchId, first.data.id);
  } finally { fixture.close(); }
});

test('学校导入覆盖成功、部分成功、失败和人工字段映射', async () => {
  const fixture = setup();
  try {
    const successBatch = await fixture.imports.create({ targetType: 'schools', importMethod: '粘贴文字', text: '学校名称,联系人姓名,联系人电话\n成功学校,周老师,13800000001' });
    const succeeded = fixture.imports.confirm(successBatch.data.id, { strategy: 'all_or_nothing' });
    assert.equal(succeeded.data.status, '成功');
    assert.equal(succeeded.data.successCount, 1);
    assert.equal(fixture.imports.confirm(successBatch.data.id, {}).error.code, 'IMPORT_ALREADY_FINAL');

    const partialBatch = await fixture.imports.create({ targetType: 'schools', importMethod: '粘贴文字', text: '学校名称,联系人姓名,联系人电话\n部分成功学校,陈老师,13800000002\n,缺姓名,13800000003' });
    assert.deepEqual(partialBatch.data.counts, { total: 2, valid: 1, skipped: 0, failed: 1, warnings: 0 });
    const partial = fixture.imports.confirm(partialBatch.data.id, { strategy: 'valid_only' });
    assert.equal(partial.data.status, '部分成功');
    assert.equal(partial.data.successCount, 1);
    assert.equal(partial.data.failedCount, 1);

    const failureBatch = await fixture.imports.create({ targetType: 'schools', importMethod: '粘贴文字', text: '学校名称,联系人电话\n,123' });
    const failed = fixture.imports.confirm(failureBatch.data.id, { strategy: 'valid_only' });
    assert.equal(failed.data.status, '失败');
    assert.equal(failed.data.successCount, 0);

    const mappingBatch = await fixture.imports.create({ targetType: 'schools', importMethod: '粘贴文字', text: '单位名称,说明\n人工映射学校,需核对' });
    assert.equal(mappingBatch.data.counts.failed, 1);
    const remapped = fixture.imports.updateMapping(mappingBatch.data.id, { mapping: { 单位名称: 'name', 说明: 'cooperationNotes' } });
    assert.equal(remapped.data.counts.valid, 1);
    assert.equal(fixture.imports.confirm(mappingBatch.data.id, {}).data.status, '成功');
    assert.equal(fixture.schools.list().data.length, 3);
  } finally { fixture.close(); }
});

test('预览行可人工修正或跳过，更新既有学校时空值不覆盖', async () => {
  const fixture = setup();
  try {
    fixture.schools.create({ name: '保留资料学校', cooperationNotes: '原合作备注', contacts: [{ name: '原联系人', phone: '13800000009', notes: '原备注', isDefault: true }] });
    const updateBatch = await fixture.imports.create({ targetType: 'schools', importMethod: '粘贴文字', text: '学校名称,合作备注\n保留资料学校,' });
    assert.equal(updateBatch.data.rows[0].action, 'update');
    fixture.imports.confirm(updateBatch.data.id, {});
    const preserved = fixture.schools.list({ query: '保留资料' }).data[0];
    const detail = fixture.schools.get(preserved.id).data;
    assert.equal(detail.cooperationNotes, '原合作备注');
    assert.equal(detail.contacts[0].name, '原联系人');

    const editBatch = await fixture.imports.create({ targetType: 'schools', importMethod: '粘贴文字', text: '学校名称,合作备注\n,人工补录' });
    const rowId = editBatch.data.rows[0].id;
    const repaired = fixture.imports.updateRow(editBatch.data.id, rowId, { values: { name: '人工修正学校' } });
    assert.equal(repaired.data.counts.valid, 1);
    const skipped = fixture.imports.updateRow(editBatch.data.id, rowId, { skipped: true });
    assert.equal(skipped.data.counts.skipped, 1);
    const restored = fixture.imports.updateRow(editBatch.data.id, rowId, { skipped: false });
    assert.equal(restored.data.counts.valid, 1);
  } finally { fixture.close(); }
});

test('仅导入有效行与全部成功策略边界清楚，事务失败不留下半写入', async () => {
  const fixture = setup();
  try {
    const mixed = await fixture.imports.create({ targetType: 'schools', importMethod: '粘贴文字', text: '学校名称,联系人电话\n不可半写学校,13800000001\n,13800000002' });
    const blocked = fixture.imports.confirm(mixed.data.id, { strategy: 'all_or_nothing' });
    assert.equal(blocked.error.code, 'IMPORT_HAS_INVALID_ROWS');
    assert.equal(fixture.schools.list().data.length, 0);

    fixture.db.exec("CREATE TRIGGER fail_second_school BEFORE INSERT ON schools WHEN NEW.name='触发失败学校' BEGIN SELECT RAISE(ABORT,'forced import failure'); END;");
    const transactionBatch = await fixture.imports.create({ targetType: 'schools', importMethod: '粘贴文字', text: '学校名称,合作备注\n事务第一学校,正常\n触发失败学校,失败' });
    const result = fixture.imports.confirm(transactionBatch.data.id, { strategy: 'all_or_nothing' });
    assert.equal(result.error.code, 'SQLITE_CONSTRAINT_TRIGGER');
    assert.equal(fixture.schools.list().data.length, 0);
    assert.equal(fixture.imports.get(transactionBatch.data.id).data.status, '失败');
  } finally { fixture.close(); }
});

test('固定 Excel、Word、缺列、坏格式和重复行均产生可审查结果', async () => {
  const fixture = setup();
  try {
    const source = [['学校名称', '联系人姓名', '联系人电话'], ['Excel学校', '周老师', '13800000001'], ['Excel学校', '周老师', '13800000001']];
    const excel = await fixture.imports.create({ targetType: 'schools', importMethod: 'Excel', originalFilename: 'schools.xlsx', fileBase64: (await buildExcelBuffer(source)).toString('base64') });
    assert.equal(excel.data.counts.valid, 1);
    assert.equal(excel.data.counts.skipped, 1);
    assert.equal(excel.data.rows[1].displayStatus, '重复');

    const word = await fixture.imports.create({ targetType: 'schools', importMethod: 'Word', originalFilename: 'schools.docx', fileBase64: (await buildDocxTableBuffer([source[0], ['Word学校', '陈老师', '13800000002']])).toString('base64') });
    assert.equal(word.data.counts.valid, 1);

    const wordDuplicate = await fixture.imports.create({ targetType: 'schools', importMethod: 'Word', originalFilename: 'duplicate.docx', fileBase64: (await buildDocxTableBuffer([source[0], ['Word重复学校', '陈老师', '13800000002'], ['Word重复学校', '陈老师', '13800000002']])).toString('base64') });
    assert.equal(wordDuplicate.data.counts.skipped, 1);

    const wordMissing = await fixture.imports.create({ targetType: 'schools', importMethod: 'Word', originalFilename: 'missing.docx', fileBase64: (await buildDocxTableBuffer([['备注'], ['缺少学校名称']])).toString('base64') });
    assert.equal(wordMissing.data.counts.failed, 1);

    const missing = await fixture.imports.create({ targetType: 'schools', importMethod: 'Excel', originalFilename: 'missing.xlsx', fileBase64: (await buildExcelBuffer([['备注'], ['缺少学校名称']])).toString('base64') });
    assert.equal(missing.data.counts.failed, 1);

    const bad = await fixture.imports.create({ targetType: 'schools', importMethod: 'Word', originalFilename: 'bad.docx', fileBase64: Buffer.from('not-docx').toString('base64') });
    assert.equal(bad.ok, false);
    assert.equal(fixture.schools.list().data.length, 0);
  } finally { fixture.close(); }
});

test('未注册正式写入目标被拒绝，模板能够生成并重新解析', async () => {
  const fixture = setup();
  try {
    const school = fixture.schools.create({ name: '项目关联学校' }).data;
    fixture.db.prepare(`INSERT INTO projects(id,school_id,grade,destination,starts_on,ends_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run('project-import', school.id, '八年级', '韶山', '2026-10-01', '2026-10-01', '2026-09-13', '2026-09-13');
    const signup = await fixture.imports.create({ projectId: 'project-import', targetType: 'guide_recruitment', importMethod: '粘贴文字', text: '1. 王晨 13800000001\n2. 周妍 13800000002' });
    assert.equal(signup.data.rows[0].mapped.sequence, 1);
    assert.equal(fixture.imports.confirm(signup.data.id, {}).error.code, 'TARGET_NOT_WRITABLE');

    const signupMissing = await fixture.imports.create({ projectId: 'project-import', targetType: 'guide_recruitment', importMethod: '粘贴文字', text: '3. 刘芳' });
    assert.equal(signupMissing.data.rows[0].displayStatus, '警告');
    assert.equal(signupMissing.data.rows[0].errors[0].code, 'PHONE_MISSING');

    const signupDuplicate = await fixture.imports.create({ projectId: 'project-import', targetType: 'guide_recruitment', importMethod: '粘贴文字', text: '4. 赵琳 13800000004\n4. 赵琳 13800000004' });
    assert.equal(signupDuplicate.data.counts.skipped, 1);

    const signupBad = await fixture.imports.create({ projectId: 'project-import', targetType: 'guide_recruitment', importMethod: '粘贴文字', text: '没有序号也没有结构' });
    assert.equal(signupBad.error.code, 'UNRECOGNIZED_SIGNUP');

    const template = await fixture.imports.template('schools');
    assert.equal(template.ok, true);
    const parsed = await fixture.imports.create({ targetType: 'schools', importMethod: 'Excel', originalFilename: template.data.filename, fileBase64: template.data.buffer.toString('base64') });
    assert.equal(parsed.error.code, 'EMPTY_DATA_ROWS');
  } finally { fixture.close(); }
});
