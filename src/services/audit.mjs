const allowedOperations = new Set(['导入', '查看敏感资料', '修改敏感资料', '修改安排', '导出', '备份', '恢复']);
const allowedResults = new Set(['成功', '部分成功', '失败']);

export function redactAuditText(value) {
  return String(value ?? '')
    .replace(/\b\d{17}[\dXx]\b/g, '[身份证号已脱敏]')
    .replace(/(?<![-A-Za-z0-9])D[-A-Za-z0-9]{7,24}\b|导游证[:：]?[-A-Za-z0-9]{7,24}\b/gi, '[导游证号已脱敏]')
    .replace(/[A-Za-z]:\\[^\s,，;；]+/g, '[本地路径已隐藏]')
    .replace(/\/(?:Users|home|var|tmp)\/[^\s,，;；]+/g, '[本地路径已隐藏]')
    .slice(0, 1000);
}

export function createAuditService(repository, clock = () => new Date().toISOString()) {
  function record({ projectId = null, operationType, objectType, objectId, summary, result, failureReason = '' }) {
    if (!allowedOperations.has(operationType)) throw new Error('UNSUPPORTED_AUDIT_OPERATION');
    if (!allowedResults.has(result)) throw new Error('UNSUPPORTED_AUDIT_RESULT');
    if (!objectType || !objectId) throw new Error('AUDIT_OBJECT_REQUIRED');
    return repository.append({
      projectId,
      occurredAt: clock(),
      operationType,
      objectType: redactAuditText(objectType),
      objectId: redactAuditText(objectId),
      changeSummary: redactAuditText(summary),
      result,
      failureReason: redactAuditText(failureReason),
      actorLabel: '本机负责人'
    });
  }

  return Object.freeze({ record });
}
