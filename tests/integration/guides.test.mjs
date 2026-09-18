import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createGuideRepository } from '../../src/db/repositories/guides.mjs';
import { createOperationLogRepository } from '../../src/db/repositories/operation-logs.mjs';
import { createAuditService } from '../../src/services/audit.mjs';
import { createGuideFileService } from '../../src/services/guide-files.mjs';
import { createGuideService } from '../../src/services/guides.mjs';
import { createSensitiveValueProtector } from '../../src/services/sensitive-values.mjs';

function setup() {
  const db = openDatabase(':memory:'); migrate(db);
  const directory = mkdtempSync(join(tmpdir(), 'guide-service-'));
  let now = '2026-09-15T08:00:00.000Z';
  const clock = () => now;
  const logs = createOperationLogRepository(db);
  const guides = createGuideService({ db, repository: createGuideRepository(db), protector: createSensitiveValueProtector('integration-secret'),
    files: createGuideFileService(directory), audit: createAuditService(logs, clock), clock });
  return { db, directory, guides, logs, setNow(value) { now = value; } };
}

const guideInput = (name, phone, expiry = '2027-12-31') => ({ name, workPhone: phone, gender: '女', birthDate: '1990-01-02', residenceArea: '长沙',
  emergencyContactName: '测试联系人', emergencyContactPhone: '13900000000', idNumber: '430102199001011234', guideLicenseNumber: `D-TEST-${phone.slice(-4)}`,
  cooperationStatus: '可合作', notes: '仅脱敏测试资料', documents: [
    { documentType: '身份证', expiresOn: expiry }, { documentType: '导游证', expiresOn: expiry }
  ] });

test('导游库新增、筛选、编辑和普通响应脱敏', () => {
  const f = setup();
  try {
    const created = f.guides.create(guideInput('王晨', '13800000001'));
    assert.equal(created.ok, true);
    assert.equal(created.data.documentStatuses.身份证, '有效');
    assert.equal(created.data.documents[0].maskedNumber.endsWith('1234'), true);
    const ordinary = JSON.stringify([f.guides.list({ query: '1380000' }).data, f.guides.get(created.data.id).data]);
    for (const forbidden of ['430102199001011234', 'D-TEST-0001', 'idNumberProtected', 'controlledFileRef', 'id_number_encrypted']) assert.equal(ordinary.includes(forbidden), false, forbidden);
    const updated = f.guides.update(created.data.id, { ...guideInput('王晨', '13800000001'), residenceArea: '长沙县', idNumber: '', guideLicenseNumber: '', documents: [{ documentType: '身份证', expiresOn: '2026-10-15' }, { documentType: '导游证', expiresOn: '2026-09-14' }] });
    assert.equal(updated.data.residenceArea, '长沙县');
    assert.equal(updated.data.documentStatuses.身份证, '临期');
    assert.equal(updated.data.documentStatuses.导游证, '过期');
    assert.equal(f.guides.list({ documentStatus: '过期' }).data.length, 1);
    assert.equal(f.guides.create(guideInput('王晨', '13800000001')).error.code, 'DUPLICATE_GUIDE');
  } finally { f.db.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('完整证件和证件图片必须二次确认并产生脱敏日志', () => {
  const f = setup();
  try {
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0T8AAAAASUVORK5CYII=';
    const input = guideInput('周妍', '13800000002');
    input.documents[0].image = { mimeType: 'image/png', base64: pixel };
    const created = f.guides.create(input).data;
    assert.equal(created.documents.find((item) => item.documentType === '身份证').hasControlledFile, true);
    assert.equal(f.guides.reveal(created.id, { purpose: '', confirmed: false }).error.code, 'SENSITIVE_CONFIRMATION_REQUIRED');
    const revealed = f.guides.reveal(created.id, { purpose: '保险资料人工核对', confirmed: true });
    assert.equal(revealed.data.idNumber, '430102199001011234');
    assert.equal(revealed.data.guideLicenseNumber, 'D-TEST-0002');
    const image = f.guides.viewDocument(created.id, '身份证正面', { purpose: '证件图片人工核对', confirmed: true });
    assert.equal(image.data.mimeType, 'image/png');
    assert.equal(image.data.base64, pixel);
    const serializedLogs = JSON.stringify(f.logs.list({ operationType: '查看敏感资料' }));
    assert.equal(f.logs.list({ operationType: '查看敏感资料' }).length, 3);
    assert.equal(serializedLogs.includes('430102199001011234'), false);
    assert.equal(serializedLogs.includes(pixel), false);
  } finally { f.db.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('事实次数来自已结束项目，未来安排会阻止暂停或停用', () => {
  const f = setup();
  try {
    const guide = f.guides.create(guideInput('刘芳', '13800000003')).data;
    f.db.prepare("INSERT INTO schools(id,name,created_at,updated_at) VALUES ('s1','测试学校',?,?)").run('2026-09-15', '2026-09-15');
    f.db.prepare(`INSERT INTO projects(id,school_id,grade,destination,starts_on,ends_on,status,created_at,updated_at) VALUES
      ('ended','s1','六年级','韶山','2026-09-01','2026-09-02','已结束','2026-09-01','2026-09-02'),
      ('future','s1','六年级','长沙','2026-10-01','2026-10-02','人员安排中','2026-09-15','2026-09-15')`).run();
    assert.equal(f.guides.addTourFact(guide.id, { projectId: 'future', isCompleted: true }).error.code, 'PROJECT_NOT_ENDED');
    assert.equal(f.guides.addTourFact(guide.id, { projectId: 'ended', responsibleClass: '801班', isCompleted: true, isPositive: true, feedbackFact: '学校回访问卷记录为好评' }).ok, true);
    const refreshed = f.guides.get(guide.id).data;
    assert.equal(refreshed.tourCount, 1); assert.equal(refreshed.positiveCount, 1); assert.equal(refreshed.lastTourOn, '2026-09-02');
    assert.equal(f.guides.correctTourFact(guide.id, refreshed.tourFacts[0].id, { isPositive: false, feedbackFact: '', correctionNote: '' }).error.code, 'CORRECTION_NOTE_REQUIRED');
    assert.equal(f.guides.correctTourFact(guide.id, refreshed.tourFacts[0].id, { isPositive: false, feedbackFact: '', correctionNote: '负责人复核后撤销好评标记' }).ok, true);
    assert.equal(f.guides.get(guide.id).data.positiveCount, 0);
    f.db.prepare(`INSERT INTO project_guides(id,project_id,guide_id,source_order,source_name,source_phone,match_status,handling_status,created_at,updated_at)
      VALUES ('pg1','future',?,1,'刘芳','13800000003','已匹配','保留','2026-09-15','2026-09-15')`).run(guide.id);
    const blocked = f.guides.setStatus(guide.id, { cooperationStatus: '停止合作' });
    assert.equal(blocked.error.code, 'GUIDE_FUTURE_ASSIGNMENTS');
    assert.equal(f.guides.remove(guide.id).error.code, 'GUIDE_IN_USE');
  } finally { f.db.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('v4 schema 不包含银行卡或结算字段', () => {
  const f = setup();
  try {
    const columns = f.db.prepare("SELECT name FROM pragma_table_info('guides')").all().map((row) => row.name);
    assert.equal(columns.some((name) => /bank|card|account|银行卡|结算/i.test(name)), false);
  } finally { f.db.close(); rmSync(f.directory, { recursive: true, force: true }); }
});
