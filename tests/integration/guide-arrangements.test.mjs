import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createBusinessRepository } from '../../src/db/repositories/business.mjs';
import { createSchoolRepository } from '../../src/db/repositories/schools.mjs';
import { createBusinessService } from '../../src/services/business.mjs';

function setup(now = '2026-10-07T08:00:00.000Z') {
  const db = openDatabase(':memory:'); migrate(db);
  const schoolRepository = createSchoolRepository(db);
  const school = schoolRepository.create({ name: '脱敏测试学校', contacts: [] }, now);
  const repository = createBusinessRepository(db);
  const business = createBusinessService({ db, repository, schoolRepository, clock: () => now });
  return { db, repository, business, schoolId: school.id };
}

function createProject(fixture, id, startsOn, endsOn, classNames = ['801']) {
  const project = fixture.business.createProject({ id, schoolId: fixture.schoolId, grade: '八年级', destination: '脱敏研学地', startsOn, endsOn,
    needsLodging: startsOn !== endsOn, includesMeals: true, mealCount: 1 }).data;
  const classes = classNames.map((name, index) => ({ id: `${id}-c${index + 1}`, name, studentTotal: 20, boys: 10, girls: 10, guideRequired: 1,
    teachers: [{ role: '班主任', name: `${name}老师`, phone: `13800000${String(index + 1).padStart(3, '0')}`, gender: '女', ridesVehicle: true, needsLodging: startsOn !== endsOn, joinsDefaultMeals: true }] }));
  assert.equal(fixture.business.savePeople(project.id, { classes, manualStaff: [] }).ok, true);
  return { project, classes };
}

function createGuide(fixture, id, name, phone, gender = '女', expiresOn = '2027-12-31') {
  return fixture.business.createGuide({ id, name, workPhone: phone, gender, cooperationStatus: '可合作',
    documents: [{ documentType: '导游证', maskedNumber: '****', expiresOn }] }).data;
}

function addGuideToProject(fixture, projectId, guide, order = 1) {
  return fixture.business.recruit(projectId, { rawText: `${order}. ${guide.name} ${guide.work_phone}`,
    entries: [{ order, name: guide.name, phone: guide.work_phone }] }).data.rows[0];
}

test('数据库日期冲突返回项目与重叠日期，相邻项目可以分配', () => {
  const cases = [
    ['同日', ['2026-10-10', '2026-10-10'], ['2026-10-10', '2026-10-10'], true],
    ['交叉', ['2026-10-10', '2026-10-12'], ['2026-10-12', '2026-10-14'], true],
    ['包含', ['2026-10-10', '2026-10-15'], ['2026-10-11', '2026-10-12'], true],
    ['相邻', ['2026-10-10', '2026-10-12'], ['2026-10-13', '2026-10-14'], false]
  ];
  for (const [label, occupied, target, conflicts] of cases) {
    const f = setup();
    try {
      const guide = createGuide(f, `g-${label}`, `导游${label}`, `1390000${occupied[0].slice(-4)}`);
      const first = createProject(f, `occupied-${label}`, ...occupied);
      const firstRow = addGuideToProject(f, first.project.id, guide);
      assert.equal(f.business.assignGuide(firstRow.id, { classIds: [first.classes[0].id], needsLodging: occupied[0] !== occupied[1], joinsDefaultMeals: true }).ok, true);
      const second = createProject(f, `target-${label}`, ...target);
      const secondRow = addGuideToProject(f, second.project.id, guide);
      const result = f.business.assignGuide(secondRow.id, { classIds: [second.classes[0].id], needsLodging: target[0] !== target[1], joinsDefaultMeals: true });
      assert.equal(result.ok, !conflicts, label);
      if (conflicts) {
        assert.equal(result.error.code, 'GUIDE_DATE_CONFLICT');
        assert.equal(result.error.details.conflicts[0].projectId, first.project.id);
        assert.ok(result.error.details.conflicts[0].overlapStartsOn <= result.error.details.conflicts[0].overlapEndsOn);
      }
    } finally { f.db.close(); }
  }
});

test('双班必须显式留原因，超员名单可移出且未分班保留人选不进入 P05 汇总', () => {
  const f = setup();
  try {
    const { project, classes } = createProject(f, 'dual-project', '2026-10-10', '2026-10-11', ['801', '802']);
    const guide = createGuide(f, 'g-dual', '双班导游', '13900000001', '男');
    const reserve = createGuide(f, 'g-reserve', '候选导游', '13900000002', '女');
    const rows = [guide, reserve].map((item, index) => addGuideToProject(f, project.id, item, index + 1));
    assert.equal(f.business.assignGuide(rows[0].id, { classIds: classes.map((item) => item.id), needsLodging: true, joinsDefaultMeals: true }).error.code, 'DUAL_CLASS_REASON_REQUIRED');
    assert.equal(f.business.assignGuide(rows[0].id, { classIds: classes.map((item) => item.id), dualClassReason: '两个班合计人数较少，负责人确认共用', needsLodging: true, joinsDefaultMeals: true }).ok, true);
    assert.equal(f.business.setGuideHandling(rows[1].id, { status: '保留' }).ok, true);
    let summary = f.business.summary(project.id);
    assert.equal(summary.staff.filter((item) => item.source_type === 'project_guide').length, 1);
    assert.deepEqual(summary.guideCoverage.map((item) => item.assignedCount), [1, 1]);
    assert.equal(f.business.setGuideHandling(rows[1].id, { status: '移出' }).ok, true);
    summary = f.business.summary(project.id);
    assert.equal(summary.guides.find((item) => item.id === rows[1].id).handling_status, '移出');
  } finally { f.db.close(); }
});

test('证件不能覆盖完整项目日期时阻断分班', () => {
  const f = setup();
  try {
    const { project, classes } = createProject(f, 'expiry-project', '2026-10-10', '2026-10-12');
    const guide = createGuide(f, 'g-expiry', '到期导游', '13900000003', '女', '2026-10-11');
    const row = addGuideToProject(f, project.id, guide);
    const result = f.business.assignGuide(row.id, { classIds: [classes[0].id], needsLodging: true, joinsDefaultMeals: true });
    assert.equal(result.error.code, 'GUIDE_DOCUMENT_EXPIRED');
    assert.equal(f.business.summary(project.id).guides[0].assignment_count, 0);
  } finally { f.db.close(); }
});

test('退团释放班级形成缺口；替换原子转移班级并同步 P05 性别和参与标记', () => {
  const f = setup();
  try {
    const { project, classes } = createProject(f, 'replacement-project', '2026-10-10', '2026-10-11');
    const original = createGuide(f, 'g-original', '原导游', '13900000004', '男');
    const replacement = createGuide(f, 'g-replacement', '替换导游', '13900000005', '女');
    const third = createGuide(f, 'g-third', '退团导游', '13900000006', '男');
    const rows = [original, replacement, third].map((item, index) => addGuideToProject(f, project.id, item, index + 1));
    assert.equal(f.business.assignGuide(rows[0].id, { classIds: [classes[0].id], needsLodging: true, joinsDefaultMeals: true }).ok, true);
    const replaced = f.business.replaceGuide(rows[0].id, { replacementProjectGuideId: rows[1].id, reason: '负责人记录的脱敏临时调整' });
    assert.equal(replaced.ok, true);
    const oldRow = replaced.data.guides.find((item) => item.id === rows[0].id);
    const newRow = replaced.data.guides.find((item) => item.id === rows[1].id);
    assert.equal(oldRow.handling_status, '已替换');
    assert.equal(oldRow.withdrawal.daysBeforeDeparture, 3);
    assert.equal(oldRow.withdrawal.replacementProjectGuideId, rows[1].id);
    assert.deepEqual(newRow.assignments.map((item) => item.classId), [classes[0].id]);
    assert.deepEqual(replaced.data.staff.filter((item) => item.source_type === 'project_guide').map((item) => [item.gender, item.lodging_count, item.default_meal_count]), [['女', 1, 1]]);

    const secondProject = createProject(f, 'withdraw-project', '2026-10-20', '2026-10-21');
    const thirdRow = addGuideToProject(f, secondProject.project.id, third);
    assert.equal(f.business.assignGuide(thirdRow.id, { classIds: [secondProject.classes[0].id], needsLodging: true, joinsDefaultMeals: true }).ok, true);
    const withdrawn = f.business.withdrawGuide(thirdRow.id, { reason: '负责人记录的脱敏退团原因' });
    assert.equal(withdrawn.data.guides[0].handling_status, '已退团');
    assert.equal(withdrawn.data.guides[0].assignment_count, 0);
    assert.ok(withdrawn.data.exceptions.some((item) => item.code === 'GUIDE_GAP' && item.status === '待处理'));
  } finally { f.db.close(); }
});
