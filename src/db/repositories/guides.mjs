import { createId } from '../id.mjs';

const baseSelect = `SELECT g.id,g.name,g.work_phone AS workPhone,g.gender,g.birth_date AS birthDate,g.residence_area AS residenceArea,
  g.emergency_contact_name AS emergencyContactName,g.emergency_contact_phone AS emergencyContactPhone,
  g.cooperation_status AS cooperationStatus,g.notes,g.active,g.created_at AS createdAt,g.updated_at AS updatedAt,
  (SELECT COUNT(*) FROM guide_tour_facts tf WHERE tf.guide_id=g.id AND tf.is_completed=1) AS tourCount,
  (SELECT COUNT(*) FROM guide_tour_facts tf WHERE tf.guide_id=g.id AND tf.is_completed=1 AND tf.is_positive=1) AS positiveCount,
  (SELECT COUNT(*) FROM guide_withdrawal_facts wf WHERE wf.guide_id=g.id) AS withdrawalCount,
  (SELECT COUNT(*) FROM guide_withdrawal_facts wf WHERE wf.guide_id=g.id AND wf.days_before_departure BETWEEN 0 AND 3) AS nearWithdrawalCount,
  (SELECT MAX(tf.ended_on) FROM guide_tour_facts tf WHERE tf.guide_id=g.id AND tf.is_completed=1) AS lastTourOn
  FROM guides g`;

export function createGuideRepository(db) {
  function documents(guideId, { includeFileRef = false } = {}) {
    const fields = `id,document_type AS documentType,masked_number AS maskedNumber,expires_on AS expiresOn,
      CASE WHEN controlled_file_ref IS NULL THEN 0 ELSE 1 END AS hasControlledFile,
      CASE WHEN controlled_file_ref_back IS NULL THEN 0 ELSE 1 END AS hasControlledFileBack,created_at AS createdAt,updated_at AS updatedAt${includeFileRef ? ',controlled_file_ref AS controlledFileRef,controlled_file_ref_back AS controlledFileRefBack' : ''}`;
    return db.prepare(`SELECT ${fields} FROM guide_documents WHERE guide_id=? ORDER BY CASE document_type WHEN '身份证' THEN 0 WHEN '导游证' THEN 1 ELSE 2 END`).all(guideId);
  }

  function facts(guideId) {
    return db.prepare(`SELECT tf.id,tf.project_id AS projectId,tf.ended_on AS endedOn,tf.responsible_class_snapshot AS responsibleClass,
      tf.is_completed AS isCompleted,tf.is_positive AS isPositive,tf.feedback_fact AS feedbackFact,tf.correction_note AS correctionNote,
      tf.fact_notes AS factNotes,tf.created_at AS createdAt,
      CASE WHEN p.id IS NULL THEN '' ELSE s.name || ' · ' || p.grade || ' · ' || p.destination END AS projectName
      FROM guide_tour_facts tf LEFT JOIN projects p ON p.id=tf.project_id LEFT JOIN schools s ON s.id=p.school_id
      WHERE tf.guide_id=? ORDER BY tf.ended_on DESC,tf.created_at DESC`).all(guideId);
  }

  function withdrawals(guideId) {
    return db.prepare(`SELECT wf.id,wf.reason,wf.recorded_at AS recordedAt,wf.days_before_departure AS daysBeforeDeparture,
      wf.replacement_project_guide_id AS replacementProjectGuideId,p.id AS projectId,s.name || ' · ' || p.grade || ' · ' || p.destination AS projectName,
      p.starts_on AS startsOn FROM guide_withdrawal_facts wf JOIN project_guides pg ON pg.id=wf.project_guide_id
      JOIN projects p ON p.id=pg.project_id JOIN schools s ON s.id=p.school_id WHERE wf.guide_id=? ORDER BY wf.recorded_at DESC`).all(guideId);
  }

  function getById(id, { includeSensitive = false, includeHistory = true } = {}) {
    const sensitive = includeSensitive ? ',g.id_number_encrypted AS idNumberProtected,g.guide_license_encrypted AS guideLicenseProtected' : '';
    const select = sensitive ? baseSelect.replace(' FROM guides g', `${sensitive} FROM guides g`) : baseSelect;
    const guide = db.prepare(`${select} WHERE g.id=?`).get(id);
    if (!guide) return null;
    guide.documents = documents(id);
    if (includeHistory) { guide.tourFacts = facts(id); guide.withdrawalFacts = withdrawals(id); }
    return guide;
  }

  function list({ query = '', cooperationStatus = '', documentStatus = '', residenceArea = '', limit = 100, offset = 0 } = {}) {
    const filters = [];
    const params = { limit: Math.min(Math.max(Number(limit) || 100, 1), 200), offset: Math.max(Number(offset) || 0, 0) };
    if (query.trim()) { filters.push('(g.name LIKE @query ESCAPE \'\\\' OR g.work_phone LIKE @query ESCAPE \'\\\')'); params.query = `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`; }
    if (cooperationStatus) { filters.push('g.cooperation_status=@cooperationStatus'); params.cooperationStatus = cooperationStatus; }
    if (residenceArea.trim()) { filters.push('g.residence_area LIKE @residenceArea ESCAPE \'\\\''); params.residenceArea = `%${residenceArea.trim().replace(/[\\%_]/g, '\\$&')}%`; }
    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
    const rows = db.prepare(`${baseSelect}${where} ORDER BY g.active DESC,g.updated_at DESC,g.name LIMIT @limit OFFSET @offset`).all(params);
    return rows.map((guide) => ({ ...guide, documents: documents(guide.id) }));
  }

  function findExact(name, workPhone, excludeId = '') {
    return db.prepare('SELECT id FROM guides WHERE name=? AND work_phone=? AND id<>? LIMIT 1').get(name, workPhone, excludeId) || null;
  }

  function create(input, now) {
    const id = input.id || createId('guide');
    db.prepare(`INSERT INTO guides(id,name,work_phone,gender,birth_date,residence_area,emergency_contact_name,emergency_contact_phone,
      id_number_encrypted,guide_license_encrypted,cooperation_status,notes,active,created_at,updated_at)
      VALUES (@id,@name,@workPhone,@gender,@birthDate,@residenceArea,@emergencyContactName,@emergencyContactPhone,
      @idNumberProtected,@guideLicenseProtected,@cooperationStatus,@notes,@active,@createdAt,@updatedAt)`).run({
      id, name: input.name, workPhone: input.workPhone, gender: input.gender, birthDate: input.birthDate, residenceArea: input.residenceArea,
      emergencyContactName: input.emergencyContactName, emergencyContactPhone: input.emergencyContactPhone,
      idNumberProtected: input.idNumberProtected, guideLicenseProtected: input.guideLicenseProtected,
      cooperationStatus: input.cooperationStatus, notes: input.notes, active: input.active ? 1 : 0, createdAt: now, updatedAt: now
    });
    return getById(id);
  }

  function update(id, input, now) {
    const result = db.prepare(`UPDATE guides SET name=@name,work_phone=@workPhone,gender=@gender,birth_date=@birthDate,residence_area=@residenceArea,
      emergency_contact_name=@emergencyContactName,emergency_contact_phone=@emergencyContactPhone,
      id_number_encrypted=COALESCE(@idNumberProtected,id_number_encrypted),guide_license_encrypted=COALESCE(@guideLicenseProtected,guide_license_encrypted),
      cooperation_status=@cooperationStatus,active=@active,notes=@notes,updated_at=@updatedAt WHERE id=@id`).run({
      id, name: input.name, workPhone: input.workPhone, gender: input.gender, birthDate: input.birthDate, residenceArea: input.residenceArea,
      emergencyContactName: input.emergencyContactName, emergencyContactPhone: input.emergencyContactPhone,
      idNumberProtected: input.idNumberProtected, guideLicenseProtected: input.guideLicenseProtected,
      cooperationStatus: input.cooperationStatus, notes: input.notes, active: input.active ? 1 : 0, updatedAt: now
    });
    return result.changes ? getById(id) : null;
  }

  function upsertDocument(guideId, input, now) {
    db.prepare(`INSERT INTO guide_documents(id,guide_id,document_type,masked_number,controlled_file_ref,controlled_file_ref_back,expires_on,created_at,updated_at)
      VALUES (@id,@guideId,@documentType,@maskedNumber,@controlledFileRef,@controlledFileRefBack,@expiresOn,@createdAt,@updatedAt)
      ON CONFLICT(guide_id,document_type) DO UPDATE SET
      masked_number=CASE WHEN excluded.masked_number='' THEN guide_documents.masked_number ELSE excluded.masked_number END,
      controlled_file_ref=COALESCE(excluded.controlled_file_ref,guide_documents.controlled_file_ref),
      controlled_file_ref_back=COALESCE(excluded.controlled_file_ref_back,guide_documents.controlled_file_ref_back),expires_on=excluded.expires_on,updated_at=excluded.updated_at`).run({
      id: input.id || createId('document'), guideId, documentType: input.documentType, maskedNumber: input.maskedNumber || '',
      controlledFileRef: input.controlledFileRef || null, controlledFileRefBack: input.controlledFileRefBack || null,
      expiresOn: input.expiresOn || null, createdAt: now, updatedAt: now
    });
    return documents(guideId).find((item) => item.documentType === input.documentType);
  }

  function setStatus(id, cooperationStatus, active, now) {
    const result = db.prepare('UPDATE guides SET cooperation_status=?,active=?,updated_at=? WHERE id=?').run(cooperationStatus, active ? 1 : 0, now, id);
    return result.changes ? getById(id) : null;
  }

  function references(id) {
    return {
      projectGuides: db.prepare('SELECT COUNT(*) AS n FROM project_guides WHERE guide_id=?').get(id).n,
      tourFacts: db.prepare('SELECT COUNT(*) AS n FROM guide_tour_facts WHERE guide_id=?').get(id).n,
      withdrawalFacts: db.prepare('SELECT COUNT(*) AS n FROM guide_withdrawal_facts WHERE guide_id=?').get(id).n
    };
  }

  function futureAssignments(id, today) {
    return db.prepare(`SELECT pg.id AS projectGuideId,p.id AS projectId,s.name || ' · ' || p.grade || ' · ' || p.destination AS projectName,
      p.starts_on AS startsOn,p.ends_on AS endsOn FROM project_guides pg JOIN projects p ON p.id=pg.project_id JOIN schools s ON s.id=p.school_id
      WHERE pg.guide_id=? AND pg.handling_status='保留' AND p.ends_on>=? AND p.status<>'已结束' ORDER BY p.starts_on`).all(id, today);
  }

  function remove(id) {
    db.prepare('DELETE FROM guide_documents WHERE guide_id=?').run(id);
    return Boolean(db.prepare('DELETE FROM guides WHERE id=?').run(id).changes);
  }

  function endedProjects() {
    return db.prepare(`SELECT p.id,s.name || ' · ' || p.grade || ' · ' || p.destination AS name,p.ends_on AS endedOn
      FROM projects p JOIN schools s ON s.id=p.school_id WHERE p.status='已结束' ORDER BY p.ends_on DESC LIMIT 100`).all();
  }

  function project(id) { return db.prepare('SELECT id,status,ends_on AS endsOn FROM projects WHERE id=?').get(id) || null; }

  function addTourFact(guideId, input, now) {
    const id = createId('tour_fact');
    db.prepare(`INSERT INTO guide_tour_facts(id,guide_id,project_id,ended_on,feedback_fact,correction_note,created_at,
      responsible_class_snapshot,is_completed,is_positive,fact_notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, guideId, input.projectId,
      input.endedOn, input.feedbackFact, input.correctionNote, now, input.responsibleClass, input.isCompleted ? 1 : 0, input.isPositive ? 1 : 0, input.factNotes);
    return facts(guideId).find((item) => item.id === id);
  }

  function tourFact(id) {
    return db.prepare('SELECT id,guide_id AS guideId,is_completed AS isCompleted,is_positive AS isPositive,feedback_fact AS feedbackFact,fact_notes AS factNotes FROM guide_tour_facts WHERE id=?').get(id) || null;
  }

  function correctTourFact(id, input) {
    db.prepare('UPDATE guide_tour_facts SET is_positive=?,feedback_fact=?,correction_note=?,fact_notes=? WHERE id=?')
      .run(input.isPositive ? 1 : 0, input.feedbackFact, input.correctionNote, input.factNotes, id);
    return tourFact(id);
  }

  function documentFile(guideId, requestedType) {
    const documentType = requestedType.startsWith('身份证') ? '身份证' : '导游证';
    const row = db.prepare('SELECT controlled_file_ref AS controlledFileRef,controlled_file_ref_back AS controlledFileRefBack FROM guide_documents WHERE guide_id=? AND document_type=?').get(guideId, documentType) || null;
    if (!row) return null;
    return { controlledFileRef: requestedType === '身份证反面' ? row.controlledFileRefBack : row.controlledFileRef };
  }

  return Object.freeze({ list, getById, findExact, create, update, upsertDocument, setStatus, references, futureAssignments, remove, endedProjects, project, addTourFact, tourFact, correctTourFact, documentFile });
}
