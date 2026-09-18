import { basename } from 'node:path';
import { redactAuditText } from './audit.mjs';
import { failure, success } from './result.mjs';

const categories = new Set(['', 'import', 'export', 'operation']);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const tableRouteTypes = new Map([['保险名单','insurance'],['乘车表','transport'],['住宿表','lodging'],['用餐表','meals']]);

function clean(value) {
  return redactAuditText(value ?? '');
}

function safeFilename(value, fallback = '') {
  const normalized = String(value || '').replaceAll('\\', '/');
  return clean(basename(normalized) || fallback);
}

function sourcePath(row) {
  const project = row.projectId ? encodeURIComponent(row.projectId) : '';
  const object = encodeURIComponent(row.objectId || '');
  if (row.category === 'import') return `#/imports/mapping?batch=${object}`;
  if (row.category === 'export') return `#/tables/preview?project=${project}&type=${tableRouteTypes.get(row.tableType) || ''}`;
  if (['备份','恢复'].includes(row.operationType)) return '#/backup';
  if (row.operationType === '导入' || row.objectType === '导入批次') return `#/imports/mapping?batch=${object}`;
  if (row.operationType === '导出') return `#/tables?project=${project}`;
  if (row.objectType === '导游档案') return `#/guides/detail?id=${object}`;
  if (row.objectType === '班级与人员') return `#/projects/people?project=${project}`;
  if (row.objectType === '导游接龙') return `#/projects/recruitment?project=${project}`;
  if (['导游安排','导游名单','导游退团','导游替换'].includes(row.objectType)) return `#/projects/guides?project=${project}`;
  if (row.objectType === '乘车安排') return `#/projects/transport?project=${project}`;
  if (row.objectType === '住宿安排') return `#/projects/lodging?project=${project}`;
  if (row.objectType === '用餐安排') return `#/projects/meals?project=${project}`;
  if (['异常校验','异常确认'].includes(row.objectType)) return `#/exceptions?project=${project}`;
  if (project) return `#/projects/overview?project=${project}`;
  return '#/records';
}

function decorate(row) {
  const filename = safeFilename(row.filename, row.importMethod === '粘贴文字' ? '粘贴文字' : '');
  let summary = clean(row.changeSummary);
  if (row.category === 'import') summary = `${clean(row.importMethod)} · ${filename || '未命名资料'} · 成功 ${row.successCount} / 跳过 ${row.skippedCount} / 失败 ${row.failedCount}`;
  if (row.category === 'export') summary = `${filename || clean(row.tableType)} · 数据版本 ${clean(row.dataVersion)}`;
  return {
    id: clean(row.id), category: row.category, occurredAt: clean(row.occurredAt),
    projectId: clean(row.projectId), projectLabel: clean(row.projectLabel) || '不属于具体项目',
    operationType: clean(row.operationType), objectType: clean(row.objectType), objectId: clean(row.objectId),
    result: clean(row.result), failureReason: clean(row.failureReason), actorLabel: clean(row.actorLabel) || '本机负责人',
    summary, filename, importMethod: clean(row.importMethod), successCount: row.successCount,
    failedCount: row.failedCount, skippedCount: row.skippedCount, dataVersion: clean(row.dataVersion),
    purpose: clean(row.purpose), tableType: clean(row.tableType), sourcePath: sourcePath(row)
  };
}

function validate(input) {
  const category = String(input.category || '');
  if (!categories.has(category)) return failure('INVALID_RECORD_CATEGORY', '记录分类无效');
  for (const key of ['from','to']) if (input[key] && !datePattern.test(String(input[key]))) return failure('INVALID_RECORD_DATE', '日期筛选格式无效');
  if (input.from && input.to && input.from > input.to) return failure('INVALID_RECORD_DATE_RANGE', '开始日期不能晚于结束日期');
  return success({
    category, projectId: String(input.projectId || ''), operationType: String(input.operationType || ''),
    objectType: String(input.objectType || ''), result: String(input.result || ''),
    from: String(input.from || ''), to: String(input.to || ''), page: input.page, pageSize: input.pageSize
  });
}

export function createRecordService(repository) {
  function list(input = {}) {
    const checked = validate(input);
    if (!checked.ok) return checked;
    const listed = repository.list(checked.data);
    const counts = repository.summary(checked.data).reduce((result, row) => {
      result.total += row.count;
      if (row.category === 'import') result.imports += row.count;
      if (row.category === 'export') result.exports += row.count;
      if (row.result === '失败') result.failed += row.count;
      return result;
    }, { total: 0, imports: 0, exports: 0, failed: 0 });
    const options = repository.options();
    return success({
      items: listed.items.map(decorate), summary: counts,
      pagination: { page: listed.page, pageSize: listed.pageSize, total: listed.total, totalPages: Math.max(1, Math.ceil(listed.total / listed.pageSize)) },
      options: {
        projects: options.projects.map((row) => ({ id: clean(row.id), label: clean(row.label) })),
        operationTypes: options.operationTypes.map(clean), objectTypes: options.objectTypes.map(clean), results: options.results.map(clean)
      }
    });
  }
  return Object.freeze({ list });
}
