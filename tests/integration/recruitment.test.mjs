import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createBusinessRepository } from '../../src/db/repositories/business.mjs';
import { createSchoolRepository } from '../../src/db/repositories/schools.mjs';
import { createOperationLogRepository } from '../../src/db/repositories/operation-logs.mjs';
import { createAuditService } from '../../src/services/audit.mjs';
import { createBusinessService } from '../../src/services/business.mjs';

const now = '2026-09-15T09:00:00.000Z';

function setup() {
  const db = openDatabase(':memory:'); migrate(db);
  const repository = createBusinessRepository(db); const schools = createSchoolRepository(db);
  schools.create({ name: '湘江实验学校' }, now);
  const schoolId = schools.list()[0].id;
  repository.insertProject({ id: 'project-recruit', schoolId, grade: '六年级', destination: '韶山', startsOn: '2026-10-16', endsOn: '2026-10-17', meetingPlace: '', meetingAt: null, itinerary: '', schoolLeadName: '', schoolLeadPhone: '', needsLodging: true, includesMeals: false, mealCount: 0, specialNotes: '', status: '人员安排中' }, now);
  db.prepare(`INSERT INTO classes(id,project_id,name,student_total,boys,girls,guide_required,created_at,updated_at) VALUES
    ('c1','project-recruit','801班',42,22,20,1,?,?),('c2','project-recruit','802班',43,21,22,1,?,?),('c3','project-recruit','803班',40,20,20,1,?,?)`).run(now, now, now, now, now, now);
  const addGuide = db.prepare('INSERT INTO guides(id,name,work_phone,gender,created_at,updated_at) VALUES (?,?,?,?,?,?)');
  addGuide.run('g1', '王晨', '13800000001', '女', now, now);
  addGuide.run('g2', '李敏', '13800000002', '男', now, now);
  addGuide.run('g3', '周妍', '13800000003', '女', now, now);
  const audit = createAuditService(createOperationLogRepository(db), () => now);
  return { db, repository, business: createBusinessService({ db, repository, schoolRepository: schools, audit, clock: () => now }) };
}

test('P06 通知自动带入日期和所需人数，学校与年级由开关决定', () => {
  const f = setup();
  try {
    const minimal = f.business.recruitmentNotice('project-recruit').data;
    assert.match(minimal.text, /2026-10-16 至 2026-10-17/); assert.match(minimal.text, /需要导游：3 名/);
    assert.equal(minimal.text.includes('湘江实验学校'), false); assert.equal(minimal.text.includes('六年级'), false);
    const expanded = f.business.recruitmentNotice('project-recruit', { showSchool: true, showGrade: true, extraNotes: '请确认可全程带团' }).data;
    assert.match(expanded.text, /学校：湘江实验学校/); assert.match(expanded.text, /年级：六年级/); assert.match(expanded.text, /补充说明：请确认可全程带团/);
  } finally { f.db.close(); }
});

test('接龙按原文顺序预览，只有姓名和手机号同时一致才自动匹配', () => {
  const f = setup();
  try {
    const rawText = '1. 王晨 13800000001\n2. 李敏 13800000999\n3. 别名 13800000003\n4. 周妍\n5. 新导游 13800000005';
    const preview = f.business.previewRecruitment('project-recruit', { rawText }).data;
    assert.deepEqual(preview.entries.map((row) => row.sourceSequence), [1, 2, 3, 4, 5]);
    assert.deepEqual(preview.entries.map((row) => row.matchStatus), ['已匹配', '资料不一致', '资料不一致', '待确认', '未建档']);
    assert.equal(preview.entries[0].guideId, 'g1');
    for (const row of preview.entries.slice(1)) assert.equal(row.guideId, null);
    assert.deepEqual(preview.entries[3].candidates.map((guide) => guide.id), ['g3']);
  } finally { f.db.close(); }
});

test('未解决行不能直接确认，人工选择或明确保留待处理后写入批次', () => {
  const f = setup();
  try {
    const rawText = '1. 王晨 13800000001\n2. 李敏 13800000999\n3. 周妍\n4. 新导游 13800000004';
    const blocked = f.business.confirmRecruitment('project-recruit', { rawText });
    assert.equal(blocked.error.code, 'RECRUITMENT_RESOLUTION_REQUIRED');
    assert.equal(f.repository.recruitmentBatches('project-recruit').length, 0);
    const confirmed = f.business.confirmRecruitment('project-recruit', { rawText, notes: '第一轮接龙', decisions: [
      { batchOrder: 2, guideId: 'g2' }, { batchOrder: 3, guideId: 'g3' }, { batchOrder: 4, acknowledgeUnresolved: true }
    ] });
    assert.equal(confirmed.ok, true); assert.deepEqual(confirmed.data.rows.map((row) => row.sourceSequence), [1, 2, 3, 4]);
    assert.deepEqual(confirmed.data.rows.map((row) => row.matchStatus), ['已匹配', '已匹配', '已匹配', '未建档']);
    const second = f.business.confirmRecruitment('project-recruit', { rawText: '1. 王晨 13800000001', notes: '补充接龙' });
    assert.equal(second.ok, true);
    const batches = f.repository.recruitmentBatches('project-recruit');
    assert.equal(batches.length, 2); assert.equal(batches[0].rows[0].batchOrder, 1); assert.equal(batches[0].rows[0].sourceSequence, 1);
    assert.deepEqual(f.db.prepare('SELECT source_order AS sourceOrder FROM project_guides WHERE project_id=? ORDER BY source_order').all('project-recruit').map((row) => row.sourceOrder), [1, 2, 3, 4, 5]);
  } finally { f.db.close(); }
});
