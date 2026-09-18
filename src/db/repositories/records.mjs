const recordSelect = `
  SELECT 'import' AS category, ib.id, ib.project_id AS projectId, ib.created_at AS occurredAt,
    '导入' AS operationType, ib.target_type AS objectType, ib.id AS objectId,
    ib.status AS result, ib.error_summary AS failureReason, '本机负责人' AS actorLabel,
    '' AS changeSummary, ib.original_filename AS filename, ib.import_method AS importMethod,
    ib.success_count AS successCount, ib.failed_count AS failedCount, ib.skipped_count AS skippedCount,
    '' AS dataVersion, '' AS purpose, '' AS tableType,
    COALESCE(s.name || ' · ' || p.grade || ' · ' || p.starts_on, '') AS projectLabel
  FROM import_batches ib
  LEFT JOIN projects p ON p.id=ib.project_id
  LEFT JOIN schools s ON s.id=p.school_id
  UNION ALL
  SELECT 'export', er.id, er.project_id, er.created_at,
    '导出', er.table_type, er.id, er.status, er.error_summary, '本机负责人',
    '', er.filename, '', 0, 0, 0, er.data_version, er.purpose, er.table_type,
    COALESCE(s.name || ' · ' || p.grade || ' · ' || p.starts_on, '')
  FROM export_records er
  LEFT JOIN projects p ON p.id=er.project_id
  LEFT JOIN schools s ON s.id=p.school_id
  UNION ALL
  SELECT 'operation', ol.id, ol.project_id, ol.occurred_at,
    ol.operation_type, ol.object_type, ol.object_id, ol.result, ol.failure_reason,
    COALESCE(NULLIF(ol.actor_label,''),'本机负责人'), ol.change_summary, '', '', 0, 0, 0, '', '', '',
    COALESCE(s.name || ' · ' || p.grade || ' · ' || p.starts_on, '')
  FROM operation_logs ol
  LEFT JOIN projects p ON p.id=ol.project_id
  LEFT JOIN schools s ON s.id=p.school_id`;

function buildFilters(input = {}) {
  const filters = [];
  const params = {};
  if (input.category) { filters.push('category=@category'); params.category = input.category; }
  if (input.projectId) { filters.push('projectId=@projectId'); params.projectId = input.projectId; }
  if (input.operationType) { filters.push('operationType=@operationType'); params.operationType = input.operationType; }
  if (input.objectType) { filters.push('objectType=@objectType'); params.objectType = input.objectType; }
  if (input.result) { filters.push('result=@result'); params.result = input.result; }
  if (input.from) { filters.push("substr(occurredAt,1,10)>=@from"); params.from = input.from; }
  if (input.to) { filters.push("substr(occurredAt,1,10)<=@to"); params.to = input.to; }
  return { where: filters.length ? ` WHERE ${filters.join(' AND ')}` : '', params };
}

export function createRecordRepository(db) {
  function list(input = {}) {
    const page = Math.max(Number(input.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(input.pageSize) || 20, 1), 50);
    const { where, params } = buildFilters(input);
    const common = { ...params, limit: pageSize, offset: (page - 1) * pageSize };
    const total = db.prepare(`WITH records AS (${recordSelect}) SELECT COUNT(*) AS count FROM records${where}`).get(params).count;
    const items = db.prepare(`WITH records AS (${recordSelect}) SELECT * FROM records${where}
      ORDER BY occurredAt DESC,id DESC LIMIT @limit OFFSET @offset`).all(common);
    return { items, total, page, pageSize };
  }

  function summary(input = {}) {
    const { where, params } = buildFilters({ projectId: input.projectId, from: input.from, to: input.to });
    const rows = db.prepare(`WITH records AS (${recordSelect}) SELECT category,result,COUNT(*) AS count FROM records${where} GROUP BY category,result`).all(params);
    return rows;
  }

  function options() {
    const projects = db.prepare(`SELECT p.id, s.name || ' · ' || p.grade || ' · ' || p.starts_on AS label
      FROM projects p JOIN schools s ON s.id=p.school_id ORDER BY p.starts_on DESC,p.id DESC`).all();
    const operationTypes = db.prepare('SELECT DISTINCT operation_type AS value FROM operation_logs ORDER BY operation_type').all().map((row) => row.value);
    const objectTypes = db.prepare(`WITH records AS (${recordSelect}) SELECT DISTINCT objectType AS value FROM records WHERE objectType<>'' ORDER BY objectType`).all().map((row) => row.value);
    const results = db.prepare(`WITH records AS (${recordSelect}) SELECT DISTINCT result AS value FROM records WHERE result<>'' ORDER BY result`).all().map((row) => row.value);
    return { projects, operationTypes, objectTypes, results };
  }

  return Object.freeze({ list, summary, options });
}
