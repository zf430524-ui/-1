import { createId } from '../id.mjs';

export function createOperationLogRepository(db) {
  const insert = db.prepare(`INSERT INTO operation_logs(
    id, project_id, occurred_at, operation_type, object_type, object_id,
    change_summary, result, failure_reason, actor_label
  ) VALUES (@id,@projectId,@occurredAt,@operationType,@objectType,@objectId,@changeSummary,@result,@failureReason,@actorLabel)`);

  function append(entry) {
    const id = entry.id || createId('log');
    insert.run({ id, projectId: entry.projectId || null, occurredAt: entry.occurredAt, operationType: entry.operationType, objectType: entry.objectType, objectId: entry.objectId, changeSummary: entry.changeSummary, result: entry.result, failureReason: entry.failureReason || '', actorLabel: entry.actorLabel || '本机负责人' });
    return getById(id);
  }

  function getById(id) {
    return db.prepare(`SELECT id, project_id AS projectId, occurred_at AS occurredAt, operation_type AS operationType,
      object_type AS objectType, object_id AS objectId, change_summary AS changeSummary,
      result, failure_reason AS failureReason, actor_label AS actorLabel FROM operation_logs WHERE id=?`).get(id) || null;
  }

  function list({ projectId = '', operationType = '', result = '', limit = 100, offset = 0 } = {}) {
    const filters = [];
    const params = { limit: Math.min(Math.max(Number(limit) || 100, 1), 200), offset: Math.max(Number(offset) || 0, 0) };
    if (projectId) { filters.push('project_id=@projectId'); params.projectId = projectId; }
    if (operationType) { filters.push('operation_type=@operationType'); params.operationType = operationType; }
    if (result) { filters.push('result=@result'); params.result = result; }
    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
    return db.prepare(`SELECT id, project_id AS projectId, occurred_at AS occurredAt, operation_type AS operationType,
      object_type AS objectType, object_id AS objectId, change_summary AS changeSummary,
      result, failure_reason AS failureReason, actor_label AS actorLabel
      FROM operation_logs${where} ORDER BY occurred_at DESC, id DESC LIMIT @limit OFFSET @offset`).all(params);
  }

  return Object.freeze({ append, getById, list });
}
