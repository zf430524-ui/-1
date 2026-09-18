import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createSchoolRepository } from '../../src/db/repositories/schools.mjs';
import { createSchoolService } from '../../src/services/schools.mjs';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  return { db, schools: createSchoolService({ db, repository: createSchoolRepository(db), clock: () => '2026-09-13T03:00:00.000Z' }) };
}

test('学校可新增、筛选、编辑、停用并维护唯一默认联系人', () => {
  const { db, schools } = setup();
  try {
    const created = schools.create({ name: '湘江实验学校', cooperationNotes: '长期合作', contacts: [{ name: '周老师', phone: '13800000001', isDefault: true }] });
    assert.equal(created.ok, true);
    assert.equal(schools.list({ query: '湘江' }).data.length, 1);
    const updated = schools.update(created.data.id, { name: '湘江实验学校', cooperationNotes: '已更新', contacts: [{ name: '陈老师', phone: '13800000002', isDefault: true }] });
    assert.equal(updated.data.contacts[0].name, '陈老师');
    assert.equal(schools.setActive(created.data.id, false).data.active, 0);
    assert.equal(schools.list({ active: false }).data.length, 1);
  } finally { db.close(); }
});

test('疑似重名要求确认，确认后仍不自动合并', () => {
  const { db, schools } = setup();
  try {
    schools.create({ name: '湘江实验学校' });
    const warning = schools.create({ name: '湘江 实验学校' });
    assert.equal(warning.error.code, 'SIMILAR_SCHOOL');
    const confirmed = schools.create({ name: '湘江 实验学校', confirmSimilar: true });
    assert.equal(confirmed.ok, true);
    assert.equal(schools.list().data.length, 2);
  } finally { db.close(); }
});

test('历史引用阻止学校硬删除，停用仍保留项目关系', () => {
  const { db, schools } = setup();
  try {
    const school = schools.create({ name: '历史学校' }).data;
    db.prepare(`INSERT INTO projects(id,school_id,grade,destination,starts_on,ends_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run('p1', school.id, '六年级', '韶山', '2026-09-20', '2026-09-20', '2026-09-13', '2026-09-13');
    const removed = schools.remove(school.id);
    assert.equal(removed.error.code, 'SCHOOL_IN_USE');
    assert.equal(schools.setActive(school.id, false).ok, true);
    assert.equal(db.prepare('SELECT school_id FROM projects WHERE id=?').get('p1').school_id, school.id);
  } finally { db.close(); }
});

test('新建项目带入的是默认联系人副本，后续修改不反写学校库', () => {
  const { db, schools } = setup();
  try {
    const school = schools.create({ name: '带入学校', contacts: [{ name: '周老师', phone: '13800000001', isDefault: true }] }).data;
    const defaults = schools.projectDefaults(school.id).data;
    defaults.schoolLeadName = '项目专属联系人';
    assert.equal(schools.get(school.id).data.contacts[0].name, '周老师');
  } finally { db.close(); }
});
