import { createId } from '../id.mjs';

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function hydrateBatch(row) {
  if (!row) return null;
  return {
    ...row,
    sourceHeaders: parseJson(row.sourceHeadersJson, []),
    mapping: parseJson(row.mappingJson, {}),
    sourceHeadersJson: undefined,
    mappingJson: undefined
  };
}

function hydrateRow(row) {
  return {
    ...row,
    raw: parseJson(row.rawJson, {}),
    mapped: parseJson(row.mappedJson, {}),
    overrides: parseJson(row.overrideJson, {}),
    errors: parseJson(row.errorJson, []),
    rawJson: undefined,
    mappedJson: undefined,
    overrideJson: undefined,
    errorJson: undefined
  };
}

export function createImportRepository(db) {
  const batchSelect = `SELECT id, project_id AS projectId, target_type AS targetType, import_method AS importMethod,
    original_filename AS originalFilename, status, success_count AS successCount, skipped_count AS skippedCount,
    failed_count AS failedCount, error_summary AS errorSummary, notes, template_version AS templateVersion,
    source_headers_json AS sourceHeadersJson, mapping_json AS mappingJson, fingerprint,
    stored_file_ref AS storedFileRef, created_at AS createdAt, updated_at AS updatedAt, confirmed_at AS confirmedAt
    FROM import_batches`;

  function createBatch(input) {
    const id = input.id || createId('import');
    db.prepare(`INSERT INTO import_batches(
      id, project_id, target_type, import_method, original_filename, status, notes, template_version,
      fingerprint, stored_file_ref, created_at, updated_at
    ) VALUES (@id,@projectId,@targetType,@importMethod,@originalFilename,'待解析',@notes,@templateVersion,@fingerprint,@storedFileRef,@createdAt,@updatedAt)`).run({
      id, projectId: input.projectId || null, targetType: input.targetType, importMethod: input.importMethod,
      originalFilename: input.originalFilename || '', notes: input.notes || '', templateVersion: input.templateVersion || '',
      fingerprint: input.fingerprint || '', storedFileRef: input.storedFileRef || '', createdAt: input.now, updatedAt: input.now
    });
    return getBatch(id);
  }

  function findDuplicate({ projectId = null, targetType, fingerprint }) {
    return hydrateBatch(db.prepare(`${batchSelect} WHERE target_type=@targetType AND fingerprint=@fingerprint
      AND COALESCE(project_id,'')=COALESCE(@projectId,'') AND status NOT IN ('失败','已取消')
      ORDER BY created_at DESC LIMIT 1`).get({ projectId, targetType, fingerprint }));
  }

  function getBatch(id, { includeRows = true } = {}) {
    const batch = hydrateBatch(db.prepare(`${batchSelect} WHERE id=?`).get(id));
    if (!batch || !includeRows) return batch;
    batch.rows = db.prepare(`SELECT id, batch_id AS batchId, source_row_number AS sourceRowNumber,
      raw_json AS rawJson, mapped_json AS mappedJson, override_json AS overrideJson, status,
      error_json AS errorJson, raw_fingerprint AS rawFingerprint
      FROM import_rows WHERE batch_id=? ORDER BY source_row_number,id`).all(id).map(hydrateRow);
    return batch;
  }

  function list({ status = '', targetType = '', projectId = '', limit = 30 } = {}) {
    const filters = [];
    const params = { limit: Math.min(Math.max(Number(limit) || 30, 1), 100) };
    if (status) { filters.push('status=@status'); params.status = status; }
    if (targetType) { filters.push('target_type=@targetType'); params.targetType = targetType; }
    if (projectId) { filters.push('project_id=@projectId'); params.projectId = projectId; }
    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
    return db.prepare(`${batchSelect}${where} ORDER BY created_at DESC,id DESC LIMIT @limit`).all(params).map(hydrateBatch);
  }

  function setParsed(id, { headers, mapping, rows, now }) {
    db.prepare(`UPDATE import_batches SET status='待确认', source_headers_json=?, mapping_json=?, error_summary='', updated_at=? WHERE id=?`)
      .run(JSON.stringify(headers), JSON.stringify(mapping), now, id);
    db.prepare('DELETE FROM import_rows WHERE batch_id=?').run(id);
    const insert = db.prepare(`INSERT INTO import_rows(id,batch_id,source_row_number,raw_json,mapped_json,override_json,status,error_json,raw_fingerprint)
      VALUES (?,?,?,?,?,'{}',?,?,?)`);
    rows.forEach((row) => insert.run(createId('import_row'), id, row.sourceRowNumber, JSON.stringify(row.raw), JSON.stringify(row.mapped || {}), row.status || '待确认', JSON.stringify(row.errors || []), row.rawFingerprint || ''));
    return getBatch(id);
  }

  function setFailed(id, message, now) {
    db.prepare("UPDATE import_batches SET status='失败', error_summary=?, failed_count=1, stored_file_ref='', updated_at=? WHERE id=?").run(message, now, id);
    return getBatch(id);
  }

  function setMapping(id, mapping, evaluations, now) {
    db.prepare("UPDATE import_batches SET mapping_json=?, status='待确认', error_summary='', updated_at=? WHERE id=?").run(JSON.stringify(mapping), now, id);
    const update = db.prepare(`UPDATE import_rows SET mapped_json=@mappedJson,status=@status,error_json=@errorJson,raw_fingerprint=@rawFingerprint WHERE id=@id AND batch_id=@batchId`);
    evaluations.forEach((row) => update.run({ id: row.id, batchId: id, mappedJson: JSON.stringify(row.mapped), status: row.status, errorJson: JSON.stringify(row.errors), rawFingerprint: row.rawFingerprint }));
    return getBatch(id);
  }

  function setRowOverrides(batchId, rowId, overrides, now) {
    const result = db.prepare(`UPDATE import_rows SET override_json=? WHERE id=? AND batch_id=?`).run(JSON.stringify(overrides), rowId, batchId);
    if (result.changes) db.prepare('UPDATE import_batches SET updated_at=? WHERE id=?').run(now, batchId);
    return Boolean(result.changes);
  }

  function setRowSkipped(batchId, rowId, skipped, now) {
    const result = db.prepare(`UPDATE import_rows SET status=?, error_json=? WHERE id=? AND batch_id=?`)
      .run(skipped ? '跳过' : '待确认', skipped ? JSON.stringify([{ code: 'MANUAL_SKIP', message: '负责人选择跳过本行' }]) : '[]', rowId, batchId);
    if (result.changes) db.prepare('UPDATE import_batches SET updated_at=? WHERE id=?').run(now, batchId);
    return Boolean(result.changes);
  }

  function finalize(id, { status, successCount, skippedCount, failedCount, errorSummary = '', now }) {
    db.prepare(`UPDATE import_batches SET status=@status,success_count=@successCount,skipped_count=@skippedCount,
      failed_count=@failedCount,error_summary=@errorSummary,confirmed_at=@now,updated_at=@now WHERE id=@id`).run({ id, status, successCount, skippedCount, failedCount, errorSummary, now });
    return getBatch(id);
  }

  function markRowsWritten(batchId, rowIds) {
    const update = db.prepare("UPDATE import_rows SET status='已写入' WHERE id=? AND batch_id=?");
    rowIds.forEach((id) => update.run(id, batchId));
  }

  function cancel(id, now) {
    db.prepare('DELETE FROM import_rows WHERE batch_id=?').run(id);
    const result = db.prepare("UPDATE import_batches SET status='已取消',stored_file_ref='',updated_at=? WHERE id=? AND status IN ('待解析','待映射','待确认','失败')").run(now, id);
    return result.changes ? getBatch(id) : null;
  }

  return { createBatch, findDuplicate, getBatch, list, setParsed, setFailed, setMapping, setRowOverrides, setRowSkipped, finalize, markRowsWritten, cancel };
}
