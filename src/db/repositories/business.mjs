import { createId } from '../id.mjs';

const nowFields = (now) => ({ createdAt: now, updatedAt: now });

export function createBusinessRepository(db) {
  function project(id) {
    return db.prepare(`SELECT p.*, s.name AS school_name FROM projects p JOIN schools s ON s.id=p.school_id WHERE p.id=?`).get(id) || null;
  }

  function projects({ query = '', startsFrom = '', startsTo = '', statuses = [], includeEnded = false, limit = 100, offset = 0 } = {}) {
    const filters = [];
    const params = {
      limit: Math.min(Math.max(Number(limit) || 100, 1), 200),
      offset: Math.max(Number(offset) || 0, 0)
    };
    if (query.trim()) {
      filters.push(`(p.id LIKE @query ESCAPE '\\' OR s.name LIKE @query ESCAPE '\\' OR p.grade LIKE @query ESCAPE '\\' OR p.destination LIKE @query ESCAPE '\\')`);
      params.query = `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`;
    }
    if (startsFrom) { filters.push('p.starts_on >= @startsFrom'); params.startsFrom = startsFrom; }
    if (startsTo) { filters.push('p.starts_on <= @startsTo'); params.startsTo = startsTo; }
    if (statuses.length) {
      const placeholders = statuses.map((status, index) => { params[`status${index}`] = status; return `@status${index}`; });
      filters.push(`p.status IN (${placeholders.join(',')})`);
    } else if (!includeEnded) filters.push("p.status <> '已结束'");
    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
    return db.prepare(`SELECT p.*, s.name AS school_name,
      (SELECT COUNT(*) FROM exceptions e WHERE e.project_id=p.id AND e.severity='阻断' AND e.status='待处理') AS blocker_count
      FROM projects p JOIN schools s ON s.id=p.school_id${where}
      ORDER BY p.starts_on,p.updated_at DESC,p.id LIMIT @limit OFFSET @offset`).all(params);
  }

  function insertProject(input, now) {
    const id = input.id || createId('project');
    db.prepare(`INSERT INTO projects(id,school_id,grade,destination,starts_on,ends_on,meeting_place,meeting_at,itinerary,
      school_lead_name,school_lead_phone,needs_lodging,includes_meals,meal_count,special_notes,status,created_at,updated_at)
      VALUES (@id,@schoolId,@grade,@destination,@startsOn,@endsOn,@meetingPlace,@meetingAt,@itinerary,
      @schoolLeadName,@schoolLeadPhone,@needsLodging,@includesMeals,@mealCount,@specialNotes,@status,@createdAt,@updatedAt)`).run({
      ...input, id, needsLodging: input.needsLodging ? 1 : 0, includesMeals: input.includesMeals ? 1 : 0,
      meetingAt: input.meetingAt || null, status: input.status || '资料待补充', ...nowFields(now)
    });
    return project(id);
  }

  function updateProject(id, input, now) {
    db.prepare(`UPDATE projects SET school_id=@schoolId,grade=@grade,destination=@destination,starts_on=@startsOn,ends_on=@endsOn,
      meeting_place=@meetingPlace,meeting_at=@meetingAt,itinerary=@itinerary,school_lead_name=@schoolLeadName,
      school_lead_phone=@schoolLeadPhone,needs_lodging=@needsLodging,includes_meals=@includesMeals,meal_count=@mealCount,
      special_notes=@specialNotes,status=@status,updated_at=@updatedAt WHERE id=@id`).run({ id, ...input,
      needsLodging: input.needsLodging ? 1 : 0, includesMeals: input.includesMeals ? 1 : 0,
      meetingAt: input.meetingAt || null, updatedAt: now });
    return project(id);
  }

  function touchProject(id, now) {
    db.prepare(`UPDATE projects SET data_version=data_version+1,updated_at=?,status=CASE WHEN status='已完成安排' THEN '待检查' ELSE status END WHERE id=?`).run(now, id);
    db.prepare(`UPDATE export_records SET status='已过期' WHERE project_id=? AND status='成功'`).run(id);
    return project(id);
  }

  function setProjectStatus(id, status, now) {
    db.prepare('UPDATE projects SET status=?,updated_at=? WHERE id=?').run(status, now, id);
    return project(id);
  }
  function projectReferences(id) {
    const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id=?`).get(id).n;
    return {
      classes: count('classes'), guides: count('project_guides'), recruitment: count('recruitment_batches'),
      vehicles: count('transport_sheet_rows'), rooms: count('lodging_sheet_rows'), meals: count('meal_sessions'),
      imports: count('import_batches'), exports: count('export_records')
    };
  }
  function removeProject(id) {
    db.prepare('DELETE FROM exceptions WHERE project_id=?').run(id);
    db.prepare('UPDATE operation_logs SET project_id=NULL WHERE project_id=?').run(id);
    return Boolean(db.prepare('DELETE FROM projects WHERE id=?').run(id).changes);
  }
  function touchSchool(id, now) { db.prepare('UPDATE schools SET last_used_at=?,updated_at=? WHERE id=?').run(now, now, id); }

  function counts(projectId) {
    const count = (table, extra = '') => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id=?${extra}`).get(projectId).n;
    return {
      classes: count('classes'), guides: count('project_guides', " AND handling_status='保留'"),
      vehicles: count('transport_sheet_rows'), rooms: count('lodging_sheet_rows'), meals: count('meal_sessions')
    };
  }

  function replacePeople(projectId, classes, manualStaff, now) {
    const insertClass = db.prepare(`INSERT INTO classes(id,project_id,name,student_total,boys,girls,guide_required,teachers_on_vehicle,vehicle_difference_reason,special_notes,created_at,updated_at)
      VALUES (@id,@projectId,@name,@studentTotal,@boys,@girls,@guideRequired,@teachersOnVehicle,@vehicleDifferenceReason,@specialNotes,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,student_total=excluded.student_total,boys=excluded.boys,girls=excluded.girls,
      guide_required=excluded.guide_required,teachers_on_vehicle=excluded.teachers_on_vehicle,vehicle_difference_reason=excluded.vehicle_difference_reason,
      special_notes=excluded.special_notes,updated_at=excluded.updated_at`);
    const insertTeacher = db.prepare(`INSERT INTO teachers(id,class_id,role,name,phone,gender,rides_vehicle,needs_lodging,joins_default_meals,created_at,updated_at)
      VALUES (@id,@classId,@role,@name,@phone,@gender,@ridesVehicle,@needsLodging,@joinsDefaultMeals,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET role=excluded.role,name=excluded.name,phone=excluded.phone,gender=excluded.gender,
      rides_vehicle=excluded.rides_vehicle,needs_lodging=excluded.needs_lodging,joins_default_meals=excluded.joins_default_meals,updated_at=excluded.updated_at`);
    const existingClassIds = db.prepare('SELECT id FROM classes WHERE project_id=?').all(projectId).map((row) => row.id);
    const keptClassIds = new Set();
    for (const item of classes) {
      const classId = item.id || createId('class');
      keptClassIds.add(classId);
      insertClass.run({ id: classId, projectId, name: item.name, studentTotal: item.studentTotal, boys: item.boys, girls: item.girls,
        guideRequired: item.guideRequired, teachersOnVehicle: (item.teachers || []).filter((x) => x.ridesVehicle).length,
        vehicleDifferenceReason: item.vehicleDifferenceReason || '', specialNotes: item.specialNotes || '', ...nowFields(now) });
      const existingTeacherIds = new Set(db.prepare('SELECT id FROM teachers WHERE class_id=?').all(classId).map((row) => row.id));
      const keptTeacherIds = new Set();
      for (const teacher of item.teachers || []) {
        const teacherId = teacher.id || createId('teacher');
        keptTeacherIds.add(teacherId);
        insertTeacher.run({ id: teacherId, classId, role: teacher.role,
        name: teacher.name, phone: teacher.phone, gender: teacher.gender || '未填写', ridesVehicle: teacher.ridesVehicle === false ? 0 : 1,
        needsLodging: teacher.needsLodging ? 1 : 0, joinsDefaultMeals: teacher.joinsDefaultMeals ? 1 : 0, ...nowFields(now) });
      }
      for (const teacherId of existingTeacherIds) if (!keptTeacherIds.has(teacherId)) {
        db.prepare("DELETE FROM staff_meal_overrides WHERE source_type='teacher' AND source_id=?").run(teacherId);
        db.prepare('DELETE FROM teachers WHERE id=?').run(teacherId);
      }
    }
    const insertStaff = db.prepare(`INSERT INTO manual_project_staff(id,project_id,role,gender,people_count,lodging_count,default_meal_count,notes,created_at,updated_at)
      VALUES (@id,@projectId,@role,@gender,@peopleCount,@lodgingCount,@defaultMealCount,@notes,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET role=excluded.role,gender=excluded.gender,people_count=excluded.people_count,
      lodging_count=excluded.lodging_count,default_meal_count=excluded.default_meal_count,notes=excluded.notes,updated_at=excluded.updated_at`);
    const existingStaffIds = new Set(db.prepare('SELECT id FROM manual_project_staff WHERE project_id=?').all(projectId).map((row) => row.id));
    const keptStaffIds = new Set();
    for (const item of manualStaff) {
      const staffId = item.id || createId('staff');
      keptStaffIds.add(staffId);
      insertStaff.run({ id: staffId, projectId, role: item.role, gender: item.gender || '未填写',
        peopleCount: item.peopleCount, lodgingCount: item.lodgingCount || 0, defaultMealCount: item.defaultMealCount || 0, notes: item.notes || '', ...nowFields(now) });
    }
    for (const staffId of existingStaffIds) if (!keptStaffIds.has(staffId)) {
      db.prepare("DELETE FROM staff_meal_overrides WHERE source_type='manual_role' AND source_id=?").run(staffId);
      db.prepare('DELETE FROM manual_project_staff WHERE id=?').run(staffId);
    }
    for (const classId of existingClassIds) if (!keptClassIds.has(classId)) {
      db.prepare("DELETE FROM staff_meal_overrides WHERE source_type='teacher' AND source_id IN (SELECT id FROM teachers WHERE class_id=?)").run(classId);
      db.prepare('DELETE FROM teachers WHERE class_id=?').run(classId);
      db.prepare('DELETE FROM classes WHERE id=?').run(classId);
    }
  }

  function classRemovalImpacts(projectId, keepIds = []) {
    const keep = new Set(keepIds);
    const rows = db.prepare('SELECT id,name FROM classes WHERE project_id=? ORDER BY name').all(projectId);
    const count = (sql, id) => db.prepare(sql).get(id).n;
    return rows.filter((row) => !keep.has(row.id)).map((row) => ({ id: row.id, name: row.name,
      guideAssignments: count('SELECT COUNT(*) AS n FROM guide_class_assignments WHERE class_id=?', row.id),
      projectGuides: count('SELECT COUNT(*) AS n FROM project_guides WHERE assigned_class_id=?', row.id),
      transportAllocations: count('SELECT COUNT(*) AS n FROM transport_allocations WHERE class_id=?', row.id),
      lodgingAllocations: count('SELECT COUNT(*) AS n FROM lodging_allocations WHERE class_id=?', row.id),
      mealAllocations: count('SELECT COUNT(*) AS n FROM meal_allocations WHERE class_id=?', row.id)
    })).map((row) => ({ ...row, total: row.guideAssignments + row.projectGuides + row.transportAllocations + row.lodgingAllocations + row.mealAllocations })).filter((row) => row.total > 0);
  }

  function createGuide(input, now) {
    const id = input.id || createId('guide');
    db.prepare(`INSERT INTO guides(id,name,work_phone,gender,emergency_contact_name,emergency_contact_phone,id_number_encrypted,guide_license_encrypted,cooperation_status,notes,active,created_at,updated_at)
      VALUES (@id,@name,@workPhone,@gender,@emergencyName,@emergencyPhone,@idNumber,@licenseNumber,@status,@notes,@active,@createdAt,@updatedAt)`).run({
      id, name: input.name, workPhone: input.workPhone, gender: input.gender || '未填写', emergencyName: input.emergencyContactName || '', emergencyPhone: input.emergencyContactPhone || '',
      idNumber: input.idNumberEncrypted || null, licenseNumber: input.guideLicenseEncrypted || null, status: input.cooperationStatus || '可合作', notes: input.notes || '', active: input.active === false ? 0 : 1, ...nowFields(now)
    });
    return db.prepare('SELECT * FROM guides WHERE id=?').get(id);
  }

  function upsertGuideDocument(guideId, input, now) {
    db.prepare(`INSERT INTO guide_documents(id,guide_id,document_type,masked_number,controlled_file_ref,expires_on,created_at,updated_at)
      VALUES (@id,@guideId,@type,@masked,@fileRef,@expiresOn,@createdAt,@updatedAt)
      ON CONFLICT(guide_id,document_type) DO UPDATE SET masked_number=excluded.masked_number,controlled_file_ref=excluded.controlled_file_ref,expires_on=excluded.expires_on,updated_at=excluded.updated_at`).run({
      id: input.id || createId('document'), guideId, type: input.documentType, masked: input.maskedNumber || '', fileRef: input.controlledFileRef || null, expiresOn: input.expiresOn || null, ...nowFields(now)
    });
  }

  function guideCandidates(name, phone = '') {
    const filters = []; const params = {};
    if (name) { filters.push('name=?'); params.name = name; }
    if (phone) { filters.push('work_phone=?'); params.phone = phone; }
    if (!filters.length) return [];
    const values = [params.name, params.phone].filter((value) => value !== undefined);
    return db.prepare(`SELECT id,name,work_phone AS workPhone,gender,cooperation_status AS cooperationStatus,active FROM guides WHERE ${filters.join(' OR ')} ORDER BY active DESC,name,work_phone`).all(...values);
  }

  function matchRecruitmentEntry(entry) {
    const name = String(entry.name || '').trim(); const phone = String(entry.phone || '').trim();
    const candidates = guideCandidates(name, phone);
    const exact = phone ? candidates.filter((guide) => guide.name === name && guide.workPhone === phone) : [];
    if (exact.length === 1) return { guideId: exact[0].id, matchStatus: '已匹配', candidates: exact };
    if (exact.length > 1) return { guideId: null, matchStatus: '待确认', candidates: exact };
    if (!phone) return { guideId: null, matchStatus: '待确认', candidates: candidates.filter((guide) => guide.name === name) };
    if (candidates.length) return { guideId: null, matchStatus: '资料不一致', candidates };
    return { guideId: null, matchStatus: '未建档', candidates: [] };
  }

  function createRecruitment(projectId, rawText, entries, now, notes = '') {
    const batchId = createId('recruitment');
    db.prepare('INSERT INTO recruitment_batches(id,project_id,raw_text,notes,created_at) VALUES (?,?,?,?,?)').run(batchId, projectId, rawText, notes, now);
    const nextOrder = db.prepare('SELECT COALESCE(MAX(source_order),0) AS n FROM project_guides WHERE project_id=?').get(projectId).n;
    const insert = db.prepare(`INSERT INTO project_guides(id,project_id,guide_id,recruitment_batch_id,source_order,batch_source_order,source_sequence,source_name,source_phone,match_status,created_at,updated_at)
      VALUES (@id,@projectId,@guideId,@batchId,@sourceOrder,@batchOrder,@sourceSequence,@name,@phone,@matchStatus,@createdAt,@updatedAt)`);
    const rows = [];
    for (const [index, entry] of entries.entries()) {
      const automatic = matchRecruitmentEntry(entry);
      const row = { id: createId('project_guide'), projectId, guideId: entry.guideId === undefined ? automatic.guideId : entry.guideId || null, batchId,
        sourceOrder: nextOrder + index + 1, batchOrder: index + 1, sourceSequence: Number(entry.sourceSequence ?? entry.order ?? index + 1), name: entry.name, phone: entry.phone || '',
        matchStatus: entry.matchStatus || automatic.matchStatus, ...nowFields(now) };
      insert.run(row); rows.push(row);
    }
    return { id: batchId, projectId, notes, rawText, createdAt: now, rows };
  }

  function recruitmentBatches(projectId) {
    const batches = db.prepare(`SELECT rb.id,rb.project_id AS projectId,rb.raw_text AS rawText,rb.notes,rb.created_at AS createdAt,
      COUNT(pg.id) AS rowCount,SUM(CASE WHEN pg.match_status='已匹配' THEN 1 ELSE 0 END) AS matchedCount
      FROM recruitment_batches rb LEFT JOIN project_guides pg ON pg.recruitment_batch_id=rb.id WHERE rb.project_id=?
      GROUP BY rb.id ORDER BY rb.created_at DESC,rb.id DESC`).all(projectId);
    const rows = db.prepare(`SELECT pg.id,pg.recruitment_batch_id AS batchId,pg.batch_source_order AS batchOrder,pg.source_sequence AS sourceSequence,
      pg.source_name AS name,pg.source_phone AS phone,pg.match_status AS matchStatus,pg.guide_id AS guideId,g.name AS guideName,g.work_phone AS guidePhone
      FROM project_guides pg LEFT JOIN guides g ON g.id=pg.guide_id WHERE pg.recruitment_batch_id=? ORDER BY pg.batch_source_order`);
    return batches.map((batch) => ({ ...batch, rows: rows.all(batch.id) }));
  }

  function assignGuide(projectGuideId, classIds, reason, flags, now) {
    const pg = db.prepare(`SELECT pg.*,p.starts_on,p.ends_on,g.active,g.cooperation_status FROM project_guides pg JOIN projects p ON p.id=pg.project_id JOIN guides g ON g.id=pg.guide_id WHERE pg.id=?`).get(projectGuideId);
    if (!pg) return null;
    db.prepare('DELETE FROM guide_class_assignments WHERE project_guide_id=?').run(projectGuideId);
    const insert = db.prepare(`INSERT INTO guide_class_assignments(id,project_guide_id,class_id,is_primary,exception_reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`);
    classIds.forEach((classId, index) => insert.run(createId('guide_assignment'), projectGuideId, classId, index === 0 ? 1 : 0, index ? reason : '', now, now));
    db.prepare(`UPDATE project_guides SET handling_status='保留',assigned_class_id=?,dual_class_reason=?,needs_lodging=?,joins_default_meals=?,updated_at=? WHERE id=?`)
      .run(classIds[0] || null, reason || '', flags.needsLodging ? 1 : 0, flags.joinsDefaultMeals ? 1 : 0, now, projectGuideId);
    return pg;
  }

  function guideConflicts(projectGuideId) {
    return db.prepare(`SELECT other.id AS projectGuideId,op.id AS projectId,s.name AS schoolName,op.grade,op.destination,
      op.starts_on AS startsOn,op.ends_on AS endsOn,MAX(cp.starts_on,op.starts_on) AS overlapStartsOn,MIN(cp.ends_on,op.ends_on) AS overlapEndsOn
      FROM project_guides current
      JOIN projects cp ON cp.id=current.project_id JOIN project_guides other ON other.guide_id=current.guide_id AND other.id<>current.id AND other.handling_status='保留'
      JOIN projects op ON op.id=other.project_id JOIN schools s ON s.id=op.school_id
      WHERE current.id=? AND cp.starts_on<=op.ends_on AND cp.ends_on>=op.starts_on
      ORDER BY op.starts_on,op.id`).all(projectGuideId);
  }

  function guideConflict(projectGuideId) {
    return guideConflicts(projectGuideId)[0] || null;
  }

  function guideDocumentState(projectGuideId) {
    const row = db.prepare(`SELECT COUNT(d.id) AS documentCount,
      COALESCE(SUM(CASE WHEN d.expires_on IS NOT NULL AND d.expires_on<p.ends_on THEN 1 ELSE 0 END),0) AS expiredCount,
      COALESCE(SUM(CASE WHEN d.expires_on IS NOT NULL AND d.expires_on>=p.ends_on AND d.expires_on<=date(p.ends_on,'+30 days') THEN 1 ELSE 0 END),0) AS expiringCount,
      COALESCE(SUM(CASE WHEN d.id IS NOT NULL AND d.expires_on IS NULL THEN 1 ELSE 0 END),0) AS missingCount,
      MIN(d.expires_on) AS nearestExpiry
      FROM project_guides pg JOIN projects p ON p.id=pg.project_id LEFT JOIN guide_documents d ON d.guide_id=pg.guide_id WHERE pg.id=?`).get(projectGuideId);
    if (!row || !row.documentCount) return { status: '资料缺失', documentCount: 0, expiredCount: 0, expiringCount: 0, missingCount: 0, nearestExpiry: null };
    return { ...row, status: row.expiredCount ? '过期' : row.missingCount ? '资料缺失' : row.expiringCount ? '临期' : '有效' };
  }

  function guideExpired(projectGuideId) {
    const state = guideDocumentState(projectGuideId);
    return state.expiredCount ? state : null;
  }
  function assignmentRows(projectGuideId) {
    return db.prepare(`SELECT gca.id,gca.class_id AS classId,c.name AS className,c.guide_required AS guideRequired,
      gca.is_primary AS isPrimary,gca.exception_reason AS exceptionReason
      FROM guide_class_assignments gca JOIN classes c ON c.id=gca.class_id
      WHERE gca.project_guide_id=? ORDER BY gca.is_primary DESC,c.name`).all(projectGuideId);
  }

  function classGuideCoverage(projectId) {
    return db.prepare(`SELECT c.id,c.name,c.guide_required AS guideRequired,
      COUNT(CASE WHEN pg.handling_status='保留' THEN gca.id END) AS assignedCount
      FROM classes c LEFT JOIN guide_class_assignments gca ON gca.class_id=c.id
      LEFT JOIN project_guides pg ON pg.id=gca.project_guide_id
      WHERE c.project_id=? GROUP BY c.id ORDER BY c.name`).all(projectId);
  }

  function classAssignmentCount(classId, excludeProjectGuideId = '') {
    return db.prepare(`SELECT COUNT(*) AS n FROM guide_class_assignments gca JOIN project_guides pg ON pg.id=gca.project_guide_id
      WHERE gca.class_id=? AND pg.handling_status='保留' AND pg.id<>?`).get(classId, excludeProjectGuideId).n;
  }

  function setGuideHandling(projectGuideId, status, now) {
    db.prepare('UPDATE project_guides SET handling_status=?,updated_at=? WHERE id=?').run(status, now, projectGuideId);
    return projectGuide(projectGuideId);
  }

  function withdrawGuide(projectGuideId, reason, replacementProjectGuideId, now, finalStatus = '已退团') {
    const row = projectGuide(projectGuideId);
    if (!row) return null;
    db.prepare('DELETE FROM guide_class_assignments WHERE project_guide_id=?').run(projectGuideId);
    db.prepare(`UPDATE project_guides SET handling_status=?,assigned_class_id=NULL,dual_class_reason='',replaced_by_project_guide_id=?,updated_at=? WHERE id=?`).run(finalStatus, replacementProjectGuideId || null, now, projectGuideId);
    db.prepare(`INSERT INTO guide_withdrawal_facts(id,guide_id,project_guide_id,reason,recorded_at,days_before_departure,replacement_project_guide_id) VALUES (?,?,?,?,?,?,?)`)
      .run(createId('withdrawal'), row.guide_id, projectGuideId, reason, now, Math.ceil((new Date(`${row.starts_on}T00:00:00Z`) - new Date(now)) / 86400000), replacementProjectGuideId || null);
    return row;
  }

  function replaceTransport(projectId, vehicles, now) {
    db.prepare('DELETE FROM transport_sheet_rows WHERE project_id=?').run(projectId);
    const rowInsert = db.prepare(`INSERT INTO transport_sheet_rows(id,project_id,vehicle_label,plate_number,capacity,safety_reserve,driver_name,driver_phone,driver_gender,driver_needs_lodging,driver_joins_default_meals,notes,fleet_name,vehicle_model,arrangement_state,special_requirements,arrangement_summary,created_at,updated_at)
      VALUES (@id,@projectId,@label,@plate,@capacity,@reserve,@driverName,@driverPhone,@driverGender,@driverLodging,@driverMeals,@notes,@fleetName,@vehicleModel,@arrangementState,@specialRequirements,@arrangementSummary,@createdAt,@updatedAt)`);
    const allocationInsert = db.prepare(`INSERT INTO transport_allocations(id,transport_row_id,class_id,role,people_count,notes,boys_count,girls_count,project_guide_id,created_at,updated_at)
      VALUES (@id,@rowId,@classId,@role,@peopleCount,@notes,@boysCount,@girlsCount,@projectGuideId,@createdAt,@updatedAt)`);
    for (const vehicle of vehicles) {
      const rowId = vehicle.id || createId('vehicle');
      rowInsert.run({ id: rowId, projectId, label: vehicle.vehicleLabel, plate: vehicle.plateNumber || '', capacity: vehicle.capacity, reserve: vehicle.safetyReserve || 0,
        driverName: vehicle.driverName, driverPhone: vehicle.driverPhone, driverGender: vehicle.driverGender || '未填写', driverLodging: vehicle.driverNeedsLodging ? 1 : 0,
        driverMeals: vehicle.driverJoinsDefaultMeals ? 1 : 0, notes: vehicle.notes || '', fleetName: vehicle.fleetName || '', vehicleModel: vehicle.vehicleModel || '',
        arrangementState: vehicle.arrangementState || '自动安排', specialRequirements: vehicle.specialRequirements || '', arrangementSummary: vehicle.arrangementSummary || '', ...nowFields(now) });
      for (const item of vehicle.allocations || []) allocationInsert.run({ id: item.id || createId('transport_allocation'), rowId, classId: item.classId || null,
        role: item.role, peopleCount: item.peopleCount, notes: item.notes || '', boysCount: item.boysCount || 0, girlsCount: item.girlsCount || 0,
        projectGuideId: item.projectGuideId || null, ...nowFields(now) });
    }
  }

  function replaceLodging(projectId, rooms, now) {
    db.prepare('DELETE FROM lodging_sheet_rows WHERE project_id=?').run(projectId);
    const rowInsert = db.prepare(`INSERT INTO lodging_sheet_rows(id,project_id,lodging_name,lodging_address,check_in_on,building,floor_label,room_number,room_type,capacity,gender_rule,notes,arrangement_state,special_requirements,arrangement_summary,created_at,updated_at)
      VALUES (@id,@projectId,@name,@address,@date,@building,@floor,@room,@type,@capacity,@gender,@notes,@arrangementState,@specialRequirements,@arrangementSummary,@createdAt,@updatedAt)`);
    const allocationInsert = db.prepare(`INSERT INTO lodging_allocations(id,lodging_row_id,class_id,role,gender,people_count,cross_class_reason,created_at,updated_at)
      VALUES (@id,@rowId,@classId,@role,@gender,@peopleCount,@reason,@createdAt,@updatedAt)`);
    for (const room of rooms) {
      const rowId = room.id || createId('room');
      rowInsert.run({ id: rowId, projectId, name: room.lodgingName, address: room.lodgingAddress || '', date: room.checkInOn, building: room.building || '', floor: room.floorLabel || '', room: room.roomNumber,
        type: room.roomType, capacity: room.capacity, gender: room.genderRule, notes: room.notes || '', arrangementState: room.arrangementState || '自动安排',
        specialRequirements: room.specialRequirements || '', arrangementSummary: room.arrangementSummary || '', ...nowFields(now) });
      for (const item of room.allocations || []) allocationInsert.run({ id: item.id || createId('lodging_allocation'), rowId, classId: item.classId || null, role: item.role,
        gender: item.gender, peopleCount: item.peopleCount, reason: item.crossClassReason || '', ...nowFields(now) });
    }
  }

  function replaceMeals(projectId, sessions, now) {
    db.prepare('DELETE FROM meal_sessions WHERE project_id=?').run(projectId);
    const sessionInsert = db.prepare(`INSERT INTO meal_sessions(id,project_id,name,restaurant_name,meal_at,seats_per_table,booked_tables,notes,special_requirements,created_at,updated_at)
      VALUES (@id,@projectId,@name,@restaurant,@mealAt,@seats,@tables,@notes,@specialRequirements,@createdAt,@updatedAt)`);
    const tableInsert = db.prepare('INSERT INTO meal_sheet_rows(id,meal_session_id,table_number,notes,arrangement_state,special_requirements,arrangement_summary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
    const allocationInsert = db.prepare(`INSERT INTO meal_allocations(id,meal_row_id,class_id,role,people_count,shared_table_reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
    const overrideInsert = db.prepare(`INSERT INTO staff_meal_overrides(id,meal_session_id,source_type,source_id,difference_count,reason,created_at) VALUES (?,?,?,?,?,?,?)`);
    for (const session of sessions) {
      const sessionId = session.id || createId('meal');
      sessionInsert.run({ id: sessionId, projectId, name: session.name, restaurant: session.restaurantName, mealAt: session.mealAt, seats: session.seatsPerTable || 10,
        tables: session.tables.length, notes: session.notes || '', specialRequirements: session.specialRequirements || '', ...nowFields(now) });
      for (const item of session.overrides || []) overrideInsert.run(item.id || createId('meal_override'), sessionId, item.sourceType, item.sourceId, item.differenceCount, item.reason, now);
      for (const table of session.tables) {
        const rowId = table.id || createId('meal_table');
        tableInsert.run(rowId, sessionId, table.tableNumber, table.notes || '', table.arrangementState || '自动安排', table.specialRequirements || '', table.arrangementSummary || '', now, now);
        for (const item of table.allocations || []) allocationInsert.run(item.id || createId('meal_allocation'), rowId, item.classId || null, item.role, item.peopleCount, item.sharedTableReason || '', now, now);
      }
    }
  }

  function staffSources(projectId) { return db.prepare(`SELECT pss.*,pg.guide_id,
    CASE pss.source_type WHEN 'teacher' THEN t.name WHEN 'project_guide' THEN COALESCE(g.name,pg.source_name)
      WHEN 'transport_driver' THEN tr.driver_name ELSE '' END AS source_name,
    CASE pss.source_type WHEN 'teacher' THEN c.name WHEN 'project_guide' THEN 'P07 导游安排'
      WHEN 'transport_driver' THEN tr.vehicle_label ELSE 'P05 手工汇总' END AS source_context,
    CASE pss.source_type WHEN 'teacher' THEN t.rides_vehicle WHEN 'transport_driver' THEN 1 ELSE 0 END AS rides_vehicle_count
    FROM project_staff_sources pss
    LEFT JOIN teachers t ON pss.source_type='teacher' AND t.id=pss.source_id
    LEFT JOIN classes c ON c.id=t.class_id
    LEFT JOIN project_guides pg ON pss.source_type='project_guide' AND pg.id=pss.source_id
    LEFT JOIN guides g ON g.id=pg.guide_id
    LEFT JOIN transport_sheet_rows tr ON pss.source_type='transport_driver' AND tr.id=pss.source_id
    WHERE pss.project_id=? AND (pss.source_type<>'project_guide' OR EXISTS (
      SELECT 1 FROM guide_class_assignments gca WHERE gca.project_guide_id=pss.source_id
    )) ORDER BY pss.source_type,pss.source_id`).all(projectId); }
  function classes(projectId) { return db.prepare('SELECT * FROM classes WHERE project_id=? ORDER BY name').all(projectId); }
  function classesWithTeachers(projectId) {
    const rows = classes(projectId);
    const teacherQuery = db.prepare('SELECT * FROM teachers WHERE class_id=? ORDER BY CASE role WHEN \'班主任\' THEN 0 ELSE 1 END,created_at,id');
    return rows.map((row) => ({ ...row, teachers: teacherQuery.all(row.id) }));
  }
  function manualStaff(projectId) { return db.prepare('SELECT * FROM manual_project_staff WHERE project_id=? ORDER BY created_at,id').all(projectId); }
  function teacherOwner(id) { return db.prepare('SELECT c.project_id,c.id AS class_id FROM teachers t JOIN classes c ON c.id=t.class_id WHERE t.id=?').get(id) || null; }
  function manualStaffProject(id) { return db.prepare('SELECT project_id FROM manual_project_staff WHERE id=?').get(id)?.project_id || null; }
  function guideAssignments(projectId) {
    const rows = db.prepare(`SELECT pg.*,g.gender,g.name AS guide_name,g.work_phone AS guide_phone,g.cooperation_status,g.active,
      replacement.source_name AS replacement_source_name,replacement.guide_id AS replacement_guide_id,rg.name AS replacement_guide_name
      FROM project_guides pg LEFT JOIN guides g ON g.id=pg.guide_id
      LEFT JOIN project_guides replacement ON replacement.id=pg.replaced_by_project_guide_id
      LEFT JOIN guides rg ON rg.id=replacement.guide_id
      WHERE pg.project_id=? ORDER BY pg.source_order`).all(projectId);
    const withdrawal = db.prepare(`SELECT id,reason,recorded_at AS recordedAt,days_before_departure AS daysBeforeDeparture,
      replacement_project_guide_id AS replacementProjectGuideId FROM guide_withdrawal_facts
      WHERE project_guide_id=? ORDER BY recorded_at DESC,id DESC LIMIT 1`);
    return rows.map((row) => {
      const assignments = assignmentRows(row.id);
      return { ...row, assignment_count: assignments.length, assignments, conflicts: row.guide_id ? guideConflicts(row.id) : [],
        documentState: row.guide_id ? guideDocumentState(row.id) : { status: '资料缺失', documentCount: 0, expiredCount: 0, expiringCount: 0, missingCount: 0, nearestExpiry: null },
        withdrawal: withdrawal.get(row.id) || null };
    });
  }
  function projectGuide(id) { return db.prepare(`SELECT pg.*,p.starts_on,p.ends_on,g.active,g.cooperation_status FROM project_guides pg JOIN projects p ON p.id=pg.project_id LEFT JOIN guides g ON g.id=pg.guide_id WHERE pg.id=?`).get(id) || null; }
  function classProject(id) { return db.prepare('SELECT project_id FROM classes WHERE id=?').get(id)?.project_id || null; }
  function transport(projectId) {
    const rows = db.prepare(`SELECT tr.*,COALESCE(SUM(ta.people_count),0) AS allocated FROM transport_sheet_rows tr LEFT JOIN transport_allocations ta ON ta.transport_row_id=tr.id WHERE tr.project_id=? GROUP BY tr.id ORDER BY tr.vehicle_label`).all(projectId);
    const allocations = db.prepare(`SELECT ta.*,c.name AS class_name,pg.source_name AS guide_name,pg.source_phone AS guide_phone
      FROM transport_allocations ta LEFT JOIN classes c ON c.id=ta.class_id LEFT JOIN project_guides pg ON pg.id=ta.project_guide_id
      WHERE ta.transport_row_id=? ORDER BY c.name,CASE ta.role WHEN '学生' THEN 0 WHEN '老师' THEN 1 WHEN '导游' THEN 2 ELSE 3 END,ta.id`);
    return rows.map((row) => ({ ...row, allocations: allocations.all(row.id) }));
  }
  function transportRowProject(id) { return db.prepare('SELECT project_id FROM transport_sheet_rows WHERE id=?').get(id)?.project_id || null; }
  function transportTotals(projectId) { return db.prepare(`SELECT ta.role,SUM(ta.people_count) AS count FROM transport_allocations ta JOIN transport_sheet_rows tr ON tr.id=ta.transport_row_id WHERE tr.project_id=? GROUP BY ta.role`).all(projectId); }
  function lodging(projectId) {
    const rows = db.prepare(`SELECT lr.*,COALESCE(SUM(la.people_count),0) AS allocated,COUNT(DISTINCT la.gender) AS genders,
      COALESCE(SUM(CASE WHEN lr.gender_rule<>'不限' AND la.gender<>lr.gender_rule THEN la.people_count ELSE 0 END),0) AS gender_mismatch
      FROM lodging_sheet_rows lr LEFT JOIN lodging_allocations la ON la.lodging_row_id=lr.id WHERE lr.project_id=? GROUP BY lr.id
      ORDER BY lr.check_in_on,lr.lodging_name,lr.building,lr.floor_label,lr.room_number`).all(projectId);
    const allocations = db.prepare(`SELECT la.*,c.name AS class_name FROM lodging_allocations la LEFT JOIN classes c ON c.id=la.class_id
      WHERE la.lodging_row_id=? ORDER BY CASE la.role WHEN '学生' THEN 0 WHEN '老师' THEN 1 WHEN '导游' THEN 2 WHEN '司机' THEN 3 ELSE 4 END,c.name,la.id`);
    return rows.map((row) => ({ ...row, allocations: allocations.all(row.id) }));
  }
  function lodgingRowProject(id) { return db.prepare('SELECT project_id FROM lodging_sheet_rows WHERE id=?').get(id)?.project_id || null; }
  function lodgingTotals(projectId) { return db.prepare(`SELECT la.gender,SUM(la.people_count) AS count FROM lodging_allocations la JOIN lodging_sheet_rows lr ON lr.id=la.lodging_row_id WHERE lr.project_id=? GROUP BY la.gender`).all(projectId); }
  function lodgingTotalsByDate(projectId) { return db.prepare(`SELECT lr.check_in_on AS checkInOn,la.role,la.gender,la.class_id AS classId,SUM(la.people_count) AS count
    FROM lodging_allocations la JOIN lodging_sheet_rows lr ON lr.id=la.lodging_row_id WHERE lr.project_id=?
    GROUP BY lr.check_in_on,la.role,la.gender,la.class_id ORDER BY lr.check_in_on,la.role,la.gender,la.class_id`).all(projectId); }
  function meals(projectId) {
    const rows = db.prepare(`SELECT ms.*,COUNT(DISTINCT mr.id) AS actual_tables,COALESCE(SUM(ma.people_count),0) AS allocated FROM meal_sessions ms LEFT JOIN meal_sheet_rows mr ON mr.meal_session_id=ms.id LEFT JOIN meal_allocations ma ON ma.meal_row_id=mr.id WHERE ms.project_id=? GROUP BY ms.id ORDER BY ms.meal_at`).all(projectId);
    const tableQuery = db.prepare(`SELECT mr.*,COALESCE(SUM(ma.people_count),0) AS allocated FROM meal_sheet_rows mr LEFT JOIN meal_allocations ma ON ma.meal_row_id=mr.id WHERE mr.meal_session_id=? GROUP BY mr.id ORDER BY mr.table_number`);
    const allocationQuery = db.prepare(`SELECT ma.*,c.name AS class_name FROM meal_allocations ma LEFT JOIN classes c ON c.id=ma.class_id WHERE ma.meal_row_id=? ORDER BY CASE ma.role WHEN '学生' THEN 0 WHEN '导游' THEN 1 WHEN '老师' THEN 2 WHEN '司机' THEN 3 ELSE 4 END,c.name,ma.id`);
    const overrideQuery = db.prepare('SELECT * FROM staff_meal_overrides WHERE meal_session_id=? ORDER BY source_type,source_id');
    return rows.map((row) => ({ ...row, tables: tableQuery.all(row.id).map((table) => ({ ...table, allocations: allocationQuery.all(table.id) })), overrides: overrideQuery.all(row.id) }));
  }
  function mealSessionProject(id) { return db.prepare('SELECT project_id FROM meal_sessions WHERE id=?').get(id)?.project_id || null; }
  function mealRowProject(id) { return db.prepare('SELECT ms.project_id FROM meal_sheet_rows mr JOIN meal_sessions ms ON ms.id=mr.meal_session_id WHERE mr.id=?').get(id)?.project_id || null; }
  function mealTables(projectId) { return db.prepare(`SELECT mr.*,ms.seats_per_table,COALESCE(SUM(ma.people_count),0) AS allocated FROM meal_sheet_rows mr JOIN meal_sessions ms ON ms.id=mr.meal_session_id LEFT JOIN meal_allocations ma ON ma.meal_row_id=mr.id WHERE ms.project_id=? GROUP BY mr.id ORDER BY ms.meal_at,mr.table_number`).all(projectId); }

  function unlockArrangement(projectId, module, rowId, summary, now) {
    if (module === 'transport') return db.prepare(`UPDATE transport_sheet_rows SET arrangement_state='调整中',arrangement_summary=?,updated_at=?
      WHERE id=? AND project_id=? AND arrangement_state='人工确认'`).run(summary, now, rowId, projectId).changes;
    if (module === 'lodging') return db.prepare(`UPDATE lodging_sheet_rows SET arrangement_state='调整中',arrangement_summary=?,updated_at=?
      WHERE id=? AND project_id=? AND arrangement_state='人工确认'`).run(summary, now, rowId, projectId).changes;
    if (module === 'meals') return db.prepare(`UPDATE meal_sheet_rows SET arrangement_state='调整中',arrangement_summary=?,updated_at=?
      WHERE id=? AND arrangement_state='人工确认' AND meal_session_id IN (SELECT id FROM meal_sessions WHERE project_id=?)`).run(summary, now, rowId, projectId).changes;
    return 0;
  }

  function markConfirmedArrangementsStale(projectId, modules = ['transport','lodging','meals']) {
    const changed = {};
    if (modules.includes('transport')) changed.transport = db.prepare("UPDATE transport_sheet_rows SET arrangement_state='待重新确认' WHERE project_id=? AND arrangement_state='人工确认'").run(projectId).changes;
    if (modules.includes('lodging')) changed.lodging = db.prepare("UPDATE lodging_sheet_rows SET arrangement_state='待重新确认' WHERE project_id=? AND arrangement_state='人工确认'").run(projectId).changes;
    if (modules.includes('meals')) changed.meals = db.prepare("UPDATE meal_sheet_rows SET arrangement_state='待重新确认' WHERE arrangement_state='人工确认' AND meal_session_id IN (SELECT id FROM meal_sessions WHERE project_id=?)").run(projectId).changes;
    return changed;
  }

  function syncExceptions(projectId, issues, now) {
    const active = new Set(issues.map((x) => x.fingerprint));
    const prior = db.prepare("SELECT fingerprint FROM exceptions WHERE project_id=? AND status IN ('待处理','已确认例外')").all(projectId);
    const upsert = db.prepare(`INSERT INTO exceptions(id,project_id,module,severity,code,source_type,source_id,message,status,fingerprint,created_at,updated_at)
      VALUES (@id,@projectId,@module,@severity,@code,@sourceType,@sourceId,@message,'待处理',@fingerprint,@createdAt,@updatedAt)
      ON CONFLICT(fingerprint) DO UPDATE SET module=excluded.module,severity=excluded.severity,code=excluded.code,source_type=excluded.source_type,source_id=excluded.source_id,message=excluded.message,
        status=CASE WHEN exceptions.status='已确认例外' AND excluded.severity<>'阻断' THEN '已确认例外' ELSE '待处理' END,
        exception_reason=CASE WHEN exceptions.status='已确认例外' AND excluded.severity<>'阻断' THEN exceptions.exception_reason ELSE '' END,
        resolved_at=NULL,updated_at=excluded.updated_at`);
    for (const issue of issues) upsert.run({ id: createId('exception'), projectId, ...issue, createdAt: now, updatedAt: now });
    const resolve = db.prepare("UPDATE exceptions SET status='已解决',resolved_at=?,updated_at=? WHERE project_id=? AND fingerprint=?");
    for (const item of prior) if (!active.has(item.fingerprint)) resolve.run(now, now, projectId, item.fingerprint);
  }

  function exceptions(projectId) { return db.prepare('SELECT * FROM exceptions WHERE project_id=? ORDER BY created_at,id').all(projectId); }
  function exceptionById(id) { return db.prepare('SELECT * FROM exceptions WHERE id=?').get(id) || null; }
  function listExceptions({ projectId = '', module = '', severity = '', status = '', limit = 200, offset = 0 } = {}) {
    const filters = []; const params = { limit: Math.min(Math.max(Number(limit) || 200, 1), 500), offset: Math.max(Number(offset) || 0, 0) };
    for (const [column, key, value] of [['e.project_id','projectId',projectId],['e.module','module',module],['e.severity','severity',severity],['e.status','status',status]]) {
      if (value) { filters.push(`${column}=@${key}`); params[key] = value; }
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return db.prepare(`SELECT e.*,p.status AS project_status,p.grade,p.destination,s.name AS school_name
      FROM exceptions e JOIN projects p ON p.id=e.project_id JOIN schools s ON s.id=p.school_id ${where}
      ORDER BY CASE e.status WHEN '待处理' THEN 0 WHEN '已确认例外' THEN 1 ELSE 2 END,
        CASE e.severity WHEN '阻断' THEN 0 WHEN '警告' THEN 1 ELSE 2 END,e.updated_at DESC,e.id DESC LIMIT @limit OFFSET @offset`).all(params);
  }
  function exceptionStats(projectId = '') {
    const params = {}; const where = projectId ? 'WHERE project_id=@projectId' : '';
    if (projectId) params.projectId = projectId;
    return db.prepare(`SELECT status,severity,COUNT(*) AS count FROM exceptions ${where} GROUP BY status,severity`).all(params);
  }
  function certificateReminders(throughDate) {
    return db.prepare(`SELECT d.id,d.guide_id AS guideId,g.name AS guideName,d.document_type AS documentType,d.expires_on AS expiresOn
      FROM guide_documents d JOIN guides g ON g.id=d.guide_id
      WHERE g.active=1 AND d.expires_on IS NOT NULL AND d.expires_on<=?
      ORDER BY d.expires_on,g.name,d.document_type`).all(throughDate);
  }
  function confirmException(id, reason, now) {
    db.prepare(`UPDATE exceptions SET status='已确认例外',exception_reason=?,updated_at=?
      WHERE id=? AND status='待处理' AND severity IN ('警告','提醒')`).run(reason, now, id);
    return exceptionById(id);
  }
  function activeBlockers(projectId) { return db.prepare("SELECT COUNT(*) AS n FROM exceptions WHERE project_id=? AND severity='阻断' AND status='待处理'").get(projectId).n; }
  function addExport(input) { db.prepare(`INSERT INTO export_records(id,project_id,table_type,filename,controlled_file_ref,data_version,purpose,status,error_summary,created_at) VALUES (@id,@projectId,@tableType,@filename,@fileRef,@version,@purpose,@status,@error,@createdAt)`).run(input); }
  function exports(projectId) { return db.prepare('SELECT * FROM export_records WHERE project_id=? ORDER BY created_at').all(projectId); }
  function exportById(id) { return db.prepare('SELECT * FROM export_records WHERE id=?').get(id) || null; }
  function insuranceRows(projectId) { return db.prepare(`SELECT pg.id,pg.source_name AS guide_name,pg.source_phone AS phone,
      g.id_number_encrypted AS id_number,g.guide_license_encrypted AS license_number,
      COALESCE(identity_doc.masked_number,'') AS id_number_masked,COALESCE(license_doc.masked_number,'') AS license_number_masked
    FROM project_guides pg JOIN guides g ON g.id=pg.guide_id
    LEFT JOIN guide_documents identity_doc ON identity_doc.guide_id=g.id AND identity_doc.document_type='身份证'
    LEFT JOIN guide_documents license_doc ON license_doc.guide_id=g.id AND license_doc.document_type='导游证'
    WHERE pg.project_id=? AND pg.handling_status='保留' AND EXISTS (
      SELECT 1 FROM guide_class_assignments assignment WHERE assignment.project_guide_id=pg.id
    ) ORDER BY pg.source_order`).all(projectId); }
  function transportDetails(projectId) { return db.prepare(`SELECT tr.vehicle_label,tr.fleet_name,tr.vehicle_model,tr.plate_number,tr.capacity,tr.safety_reserve,tr.driver_name,tr.driver_phone,tr.arrangement_state,tr.special_requirements,tr.arrangement_summary,
      ta.role,ta.people_count,ta.boys_count,ta.girls_count,c.name AS class_name,COALESCE(pg.source_name,'') AS guide_name,COALESCE(pg.source_phone,'') AS guide_phone,ta.notes
    FROM transport_sheet_rows tr LEFT JOIN transport_allocations ta ON ta.transport_row_id=tr.id LEFT JOIN classes c ON c.id=ta.class_id
    LEFT JOIN project_guides pg ON pg.id=ta.project_guide_id WHERE tr.project_id=? ORDER BY tr.vehicle_label,c.name,ta.role`).all(projectId); }
  function lodgingDetails(projectId) { return db.prepare(`SELECT lr.id,lr.lodging_name,lr.lodging_address,lr.check_in_on,lr.building,lr.floor_label,lr.room_number,lr.room_type,lr.capacity,lr.gender_rule,lr.notes,lr.arrangement_state,lr.special_requirements,lr.arrangement_summary,la.role,la.gender,la.people_count,c.name AS class_name,la.cross_class_reason
    FROM lodging_sheet_rows lr LEFT JOIN lodging_allocations la ON la.lodging_row_id=lr.id LEFT JOIN classes c ON c.id=la.class_id WHERE lr.project_id=? ORDER BY lr.check_in_on,lr.room_number,c.name`).all(projectId); }
  function mealDetails(projectId) { return db.prepare(`SELECT mr.id,ms.name AS session_name,ms.restaurant_name,ms.meal_at,ms.seats_per_table,ms.notes AS session_notes,mr.table_number,mr.notes AS table_notes,mr.arrangement_state,mr.special_requirements,mr.arrangement_summary,ma.role,ma.people_count,c.name AS class_name,ma.shared_table_reason
    FROM meal_sessions ms JOIN meal_sheet_rows mr ON mr.meal_session_id=ms.id LEFT JOIN meal_allocations ma ON ma.meal_row_id=mr.id LEFT JOIN classes c ON c.id=ma.class_id WHERE ms.project_id=? ORDER BY ms.meal_at,mr.table_number,c.name`).all(projectId); }

  return Object.freeze({ project, projects, insertProject, updateProject, touchProject, setProjectStatus, projectReferences, removeProject, touchSchool, counts, replacePeople, classRemovalImpacts, createGuide, upsertGuideDocument,
    guideCandidates, matchRecruitmentEntry, createRecruitment, recruitmentBatches, assignGuide, guideConflict, guideConflicts, guideDocumentState, guideExpired,
    assignmentRows, classGuideCoverage, classAssignmentCount, setGuideHandling, withdrawGuide, replaceTransport, replaceLodging, replaceMeals,
    staffSources, classes, classesWithTeachers, manualStaff, teacherOwner, manualStaffProject, guideAssignments, projectGuide, classProject, transportRowProject, lodgingRowProject, mealSessionProject, mealRowProject,
    transport, transportTotals, lodging, lodgingTotals, lodgingTotalsByDate, meals, mealTables, unlockArrangement, markConfirmedArrangementsStale, syncExceptions, exceptions, exceptionById, listExceptions, exceptionStats, certificateReminders, confirmException, activeBlockers, addExport, exports, exportById,
    insuranceRows, transportDetails, lodgingDetails, mealDetails });
}
