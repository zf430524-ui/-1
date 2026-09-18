import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../../src/db/migrate.mjs';
import { createRecordRepository } from '../../src/db/repositories/records.mjs';
import { createRecordService } from '../../src/services/records.mjs';

function setup() {
  const db = openDatabase(':memory:'); migrate(db);
  db.prepare("INSERT INTO schools(id,name,active,cooperation_notes,created_at,updated_at) VALUES ('school-records','脱敏实验学校',1,'','2026-09-17T07:00:00.000Z','2026-09-17T07:00:00.000Z')").run();
  db.prepare(`INSERT INTO projects(id,school_id,grade,destination,starts_on,ends_on,status,needs_lodging,includes_meals,meal_count,data_version,created_at,updated_at)
    VALUES ('project-records','school-records','八年级','脱敏基地','2026-10-01','2026-10-01','资料待补充',0,0,0,1,'2026-09-17T07:00:00.000Z','2026-09-17T07:00:00.000Z')`).run();
  const fullId = '430102199001011234'; const fullLicense = 'D-4301-SECRET-1824'; const localPath = 'C:\\Users\\负责人\\records\\guide.png';
  db.prepare(`INSERT INTO import_batches(id,project_id,target_type,import_method,original_filename,status,success_count,skipped_count,failed_count,error_summary,created_at,confirmed_at,updated_at)
    VALUES ('import-records','project-records','transport','Excel',@filename,'部分成功',8,1,1,@error,'2026-09-17T08:00:00.000Z','2026-09-17T08:10:00.000Z','2026-09-17T08:10:00.000Z')`)
    .run({ filename: `${localPath}\\车辆.xlsx`, error: `失败行包含 ${fullId}，来源 ${localPath}` });
  db.prepare(`INSERT INTO export_records(id,project_id,table_type,filename,controlled_file_ref,data_version,purpose,status,error_summary,created_at)
    VALUES ('export-records','project-records','保险名单',@filename,@ref,'1',@purpose,'失败',@error,'2026-09-17T09:00:00.000Z')`)
    .run({ filename: `${localPath}\\保险名单.xlsx`, ref: localPath, purpose: `核对 ${fullLicense}`, error: `无法写入 ${localPath}` });
  db.prepare(`INSERT INTO operation_logs(id,project_id,occurred_at,operation_type,object_type,object_id,change_summary,result,failure_reason,actor_label)
    VALUES ('log-records','project-records','2026-09-17T10:00:00.000Z','修改安排','乘车安排','project-records',@summary,'成功','','')`)
    .run({ summary: `调整 ${fullId} ${fullLicense} ${localPath}` });
  return { db, records: createRecordService(createRecordRepository(db)), fullId, fullLicense, localPath };
}

test('P19 联合三类记录并按时间、项目、类型、结果准确筛选和分页', () => {
  const f = setup();
  try {
    const first = f.records.list({ projectId: 'project-records', from: '2026-09-17', to: '2026-09-17', pageSize: 2 });
    assert.equal(first.ok, true); assert.deepEqual(first.data.summary, { total: 3, imports: 1, exports: 1, failed: 1 });
    assert.deepEqual(first.data.items.map((row) => row.id), ['log-records','export-records']);
    assert.deepEqual(first.data.pagination, { page: 1, pageSize: 2, total: 3, totalPages: 2 });
    const second = f.records.list({ projectId: 'project-records', page: 2, pageSize: 2 });
    assert.deepEqual(second.data.items.map((row) => row.id), ['import-records']);
    assert.equal(f.records.list({ category: 'import', result: '部分成功' }).data.items[0].sourcePath, '#/imports/mapping?batch=import-records');
    assert.equal(f.records.list({ category: 'export', objectType: '保险名单' }).data.items[0].sourcePath, '#/tables/preview?project=project-records&type=insurance');
    assert.equal(f.records.list({ category: 'operation', operationType: '修改安排' }).data.items[0].sourcePath, '#/projects/transport?project=project-records');
    assert.equal(f.records.list({ from: '2026-09-18' }).data.pagination.total, 0);
  } finally { f.db.close(); }
});

test('P19 响应再次脱敏且不返回受控文件路径或内部字段', () => {
  const f = setup();
  try {
    const response = f.records.list({ pageSize: 50 }); const serialized = JSON.stringify(response);
    for (const forbidden of [f.fullId, f.fullLicense, f.localPath, 'controlled_file_ref', 'stored_file_ref', 'guide.png']) assert.equal(serialized.includes(forbidden), false, `响应泄露 ${forbidden}`);
    const imported = response.data.items.find((row) => row.category === 'import');
    const exported = response.data.items.find((row) => row.category === 'export');
    assert.equal(imported.filename, '车辆.xlsx'); assert.equal(exported.filename, '保险名单.xlsx');
    assert.match(imported.failureReason, /\[身份证号已脱敏\]/); assert.match(exported.failureReason, /\[本地路径已隐藏\]/);
    assert.equal(response.data.items.find((row) => row.category === 'operation').actorLabel, '本机负责人');
  } finally { f.db.close(); }
});

test('P19 拒绝无效日期范围和未知分类', () => {
  const f = setup();
  try {
    assert.equal(f.records.list({ category: 'delete' }).error.code, 'INVALID_RECORD_CATEGORY');
    assert.equal(f.records.list({ from: '2026/09/17' }).error.code, 'INVALID_RECORD_DATE');
    assert.equal(f.records.list({ from: '2026-09-18', to: '2026-09-17' }).error.code, 'INVALID_RECORD_DATE_RANGE');
  } finally { f.db.close(); }
});

test('P19 大批量记录按稳定倒序分页且单页上限为 50', () => {
  const f = setup();
  try {
    const insert = f.db.prepare(`INSERT INTO operation_logs(id,project_id,occurred_at,operation_type,object_type,object_id,change_summary,result,failure_reason,actor_label)
      VALUES (@id,'project-records',@time,'修改安排','批量分页',@id,'分页验证','成功','','本机负责人')`);
    for (let index = 0; index < 57; index += 1) insert.run({ id: `bulk-${String(index).padStart(2,'0')}`, time: `2026-09-18T08:${String(index).padStart(2,'0')}:00.000Z` });
    const first = f.records.list({ category: 'operation', objectType: '批量分页', pageSize: 999 });
    const second = f.records.list({ category: 'operation', objectType: '批量分页', page: 2, pageSize: 999 });
    assert.equal(first.data.pagination.pageSize, 50); assert.equal(first.data.items.length, 50); assert.equal(second.data.items.length, 7);
    assert.equal(first.data.items[0].id, 'bulk-56'); assert.equal(second.data.items.at(-1).id, 'bulk-00');
    assert.equal(first.data.items.some((row) => second.data.items.some((other) => other.id === row.id)), false);
  } finally { f.db.close(); }
});
