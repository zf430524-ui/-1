export const migration001 = {
  version: 1,
  name: 'initial_v1_schema',
  up(db) {
    db.exec(`
      CREATE TABLE schools (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        cooperation_notes TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT
      ) STRICT;

      CREATE TABLE school_contacts (
        id TEXT PRIMARY KEY,
        school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX school_one_default_contact ON school_contacts(school_id) WHERE is_default = 1;

      CREATE TABLE guides (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        work_phone TEXT NOT NULL,
        gender TEXT NOT NULL CHECK (gender IN ('男', '女', '未填写')),
        emergency_contact_name TEXT NOT NULL DEFAULT '',
        emergency_contact_phone TEXT NOT NULL DEFAULT '',
        id_number_encrypted TEXT,
        guide_license_encrypted TEXT,
        cooperation_status TEXT NOT NULL DEFAULT '可合作' CHECK (cooperation_status IN ('可合作', '暂停合作', '停止合作')),
        notes TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX guides_name_phone ON guides(name, work_phone);

      CREATE TABLE guide_documents (
        id TEXT PRIMARY KEY,
        guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE RESTRICT,
        document_type TEXT NOT NULL CHECK (document_type IN ('身份证', '导游证', '其他')),
        masked_number TEXT NOT NULL DEFAULT '',
        controlled_file_ref TEXT,
        expires_on TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (guide_id, document_type)
      ) STRICT;

      CREATE TABLE guide_tour_facts (
        id TEXT PRIMARY KEY,
        guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE RESTRICT,
        project_id TEXT,
        ended_on TEXT NOT NULL,
        feedback_fact TEXT NOT NULL DEFAULT '',
        correction_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
        grade TEXT NOT NULL,
        destination TEXT NOT NULL,
        starts_on TEXT NOT NULL,
        ends_on TEXT NOT NULL,
        meeting_place TEXT NOT NULL DEFAULT '',
        meeting_at TEXT,
        itinerary TEXT NOT NULL DEFAULT '',
        school_lead_name TEXT NOT NULL DEFAULT '',
        school_lead_phone TEXT NOT NULL DEFAULT '',
        needs_lodging INTEGER NOT NULL DEFAULT 0 CHECK (needs_lodging IN (0, 1)),
        includes_meals INTEGER NOT NULL DEFAULT 0 CHECK (includes_meals IN (0, 1)),
        meal_count INTEGER NOT NULL DEFAULT 0 CHECK (meal_count >= 0),
        special_notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '资料待补充' CHECK (status IN ('资料待补充','人员安排中','车辆安排中','住宿安排中','用餐安排中','待检查','已完成安排','已出团','已结束')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (ends_on >= starts_on),
        CHECK (needs_lodging = 0 OR ends_on > starts_on),
        CHECK ((includes_meals = 0 AND meal_count = 0) OR (includes_meals = 1 AND meal_count > 0))
      ) STRICT;
      CREATE INDEX projects_dates_status ON projects(starts_on, status);

      CREATE TABLE classes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        student_total INTEGER NOT NULL CHECK (student_total >= 0),
        boys INTEGER NOT NULL CHECK (boys >= 0),
        girls INTEGER NOT NULL CHECK (girls >= 0),
        guide_required INTEGER NOT NULL DEFAULT 1 CHECK (guide_required > 0),
        teachers_on_vehicle INTEGER NOT NULL DEFAULT 0 CHECK (teachers_on_vehicle >= 0),
        vehicle_difference_reason TEXT NOT NULL DEFAULT '',
        special_notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_id, name),
        CHECK (student_total = boys + girls)
      ) STRICT;

      CREATE TABLE teachers (
        id TEXT PRIMARY KEY,
        class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
        role TEXT NOT NULL CHECK (role IN ('班主任', '配班老师')),
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        gender TEXT NOT NULL CHECK (gender IN ('男', '女', '未填写')),
        rides_vehicle INTEGER NOT NULL DEFAULT 1 CHECK (rides_vehicle IN (0, 1)),
        needs_lodging INTEGER NOT NULL DEFAULT 0 CHECK (needs_lodging IN (0, 1)),
        joins_default_meals INTEGER NOT NULL DEFAULT 0 CHECK (joins_default_meals IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE recruitment_batches (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
        raw_text TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE project_guides (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
        guide_id TEXT REFERENCES guides(id) ON DELETE RESTRICT,
        recruitment_batch_id TEXT REFERENCES recruitment_batches(id) ON DELETE RESTRICT,
        source_order INTEGER NOT NULL CHECK (source_order > 0),
        source_name TEXT NOT NULL,
        source_phone TEXT NOT NULL DEFAULT '',
        match_status TEXT NOT NULL CHECK (match_status IN ('已匹配','待确认','未建档','资料不一致')),
        handling_status TEXT NOT NULL DEFAULT '待处理' CHECK (handling_status IN ('待处理','保留','移出','已退团','已替换')),
        assigned_class_id TEXT REFERENCES classes(id) ON DELETE RESTRICT,
        dual_class_reason TEXT NOT NULL DEFAULT '',
        needs_lodging INTEGER NOT NULL DEFAULT 0 CHECK (needs_lodging IN (0, 1)),
        joins_default_meals INTEGER NOT NULL DEFAULT 0 CHECK (joins_default_meals IN (0, 1)),
        replaced_by_project_guide_id TEXT REFERENCES project_guides(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_id, source_order)
      ) STRICT;

      CREATE TABLE guide_withdrawal_facts (
        id TEXT PRIMARY KEY,
        guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE RESTRICT,
        project_guide_id TEXT NOT NULL REFERENCES project_guides(id) ON DELETE RESTRICT,
        reason TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        days_before_departure INTEGER NOT NULL,
        replacement_project_guide_id TEXT REFERENCES project_guides(id) ON DELETE RESTRICT
      ) STRICT;

      CREATE TABLE transport_sheet_rows (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
        vehicle_label TEXT NOT NULL,
        plate_number TEXT NOT NULL DEFAULT '',
        capacity INTEGER NOT NULL CHECK (capacity > 0),
        safety_reserve INTEGER NOT NULL DEFAULT 0 CHECK (safety_reserve >= 0),
        driver_name TEXT NOT NULL,
        driver_phone TEXT NOT NULL,
        driver_gender TEXT NOT NULL CHECK (driver_gender IN ('男', '女', '未填写')),
        driver_needs_lodging INTEGER NOT NULL DEFAULT 0 CHECK (driver_needs_lodging IN (0, 1)),
        driver_joins_default_meals INTEGER NOT NULL DEFAULT 0 CHECK (driver_joins_default_meals IN (0, 1)),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_id, vehicle_label)
      ) STRICT;

      CREATE TABLE transport_allocations (
        id TEXT PRIMARY KEY,
        transport_row_id TEXT NOT NULL REFERENCES transport_sheet_rows(id) ON DELETE CASCADE,
        class_id TEXT REFERENCES classes(id) ON DELETE RESTRICT,
        role TEXT NOT NULL CHECK (role IN ('学生','老师','导游','司机','摄影师','其他')),
        people_count INTEGER NOT NULL CHECK (people_count > 0),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE manual_project_staff (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
        role TEXT NOT NULL CHECK (role IN ('摄影师', '其他')),
        gender TEXT NOT NULL CHECK (gender IN ('男', '女', '未填写')),
        people_count INTEGER NOT NULL CHECK (people_count > 0),
        lodging_count INTEGER NOT NULL DEFAULT 0 CHECK (lodging_count >= 0 AND lodging_count <= people_count),
        default_meal_count INTEGER NOT NULL DEFAULT 0 CHECK (default_meal_count >= 0 AND default_meal_count <= people_count),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE lodging_sheet_rows (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
        lodging_name TEXT NOT NULL,
        check_in_on TEXT NOT NULL,
        building TEXT NOT NULL DEFAULT '',
        floor_label TEXT NOT NULL DEFAULT '',
        room_number TEXT NOT NULL,
        room_type TEXT NOT NULL,
        capacity INTEGER NOT NULL CHECK (capacity > 0),
        gender_rule TEXT NOT NULL CHECK (gender_rule IN ('男', '女', '不限')),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_id, check_in_on, room_number)
      ) STRICT;

      CREATE TABLE lodging_allocations (
        id TEXT PRIMARY KEY,
        lodging_row_id TEXT NOT NULL REFERENCES lodging_sheet_rows(id) ON DELETE CASCADE,
        class_id TEXT REFERENCES classes(id) ON DELETE RESTRICT,
        role TEXT NOT NULL CHECK (role IN ('学生','老师','导游','司机','摄影师','其他')),
        gender TEXT NOT NULL CHECK (gender IN ('男', '女')),
        people_count INTEGER NOT NULL CHECK (people_count > 0),
        cross_class_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE meal_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        restaurant_name TEXT NOT NULL,
        meal_at TEXT NOT NULL,
        seats_per_table INTEGER NOT NULL DEFAULT 10 CHECK (seats_per_table > 0),
        booked_tables INTEGER NOT NULL CHECK (booked_tables > 0),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_id, name)
      ) STRICT;

      CREATE TABLE meal_sheet_rows (
        id TEXT PRIMARY KEY,
        meal_session_id TEXT NOT NULL REFERENCES meal_sessions(id) ON DELETE CASCADE,
        table_number TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (meal_session_id, table_number)
      ) STRICT;

      CREATE TABLE meal_allocations (
        id TEXT PRIMARY KEY,
        meal_row_id TEXT NOT NULL REFERENCES meal_sheet_rows(id) ON DELETE CASCADE,
        class_id TEXT REFERENCES classes(id) ON DELETE RESTRICT,
        role TEXT NOT NULL CHECK (role IN ('学生','老师','导游','司机','摄影师','其他')),
        people_count INTEGER NOT NULL CHECK (people_count > 0),
        shared_table_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE staff_meal_overrides (
        id TEXT PRIMARY KEY,
        meal_session_id TEXT NOT NULL REFERENCES meal_sessions(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL CHECK (source_type IN ('teacher','project_guide','transport_driver','manual_role')),
        source_id TEXT NOT NULL,
        difference_count INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (meal_session_id, source_type, source_id)
      ) STRICT;

      CREATE TABLE import_batches (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
        target_type TEXT NOT NULL,
        import_method TEXT NOT NULL CHECK (import_method IN ('Excel','CSV','Word','粘贴文字','手工录入')),
        original_filename TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('待解析','待映射','待确认','成功','部分成功','失败','已取消')),
        success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
        skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
        failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
        error_summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        confirmed_at TEXT
      ) STRICT;

      CREATE TABLE import_rows (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
        source_row_number INTEGER NOT NULL CHECK (source_row_number > 0),
        raw_json TEXT NOT NULL,
        mapped_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL CHECK (status IN ('待确认','有效','跳过','失败','已写入')),
        error_json TEXT NOT NULL DEFAULT '[]',
        UNIQUE (batch_id, source_row_number)
      ) STRICT;

      CREATE TABLE export_records (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
        table_type TEXT NOT NULL CHECK (table_type IN ('保险名单','乘车表','住宿表','用餐表')),
        filename TEXT NOT NULL,
        controlled_file_ref TEXT NOT NULL,
        data_version TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('成功','失败','已过期')),
        error_summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE exceptions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
        module TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('阻断','警告','提醒')),
        code TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT '待处理' CHECK (status IN ('待处理','已解决','已确认例外')),
        exception_reason TEXT NOT NULL DEFAULT '',
        fingerprint TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT
      ) STRICT;
      CREATE INDEX exceptions_project_status ON exceptions(project_id, status, severity);

      CREATE TABLE operation_logs (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
        occurred_at TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        change_summary TEXT NOT NULL,
        result TEXT NOT NULL CHECK (result IN ('成功','部分成功','失败')),
        failure_reason TEXT NOT NULL DEFAULT '',
        actor_label TEXT NOT NULL DEFAULT '本机负责人'
      ) STRICT;
      CREATE INDEX operation_logs_time ON operation_logs(occurred_at DESC);

      CREATE VIEW project_staff_sources AS
      SELECT t.id AS source_id, c.project_id, 'teacher' AS source_type, '老师' AS role, t.gender,
             1 AS people_count, t.needs_lodging AS lodging_count, t.joins_default_meals AS default_meal_count
      FROM teachers t JOIN classes c ON c.id = t.class_id
      UNION ALL
      SELECT pg.id, pg.project_id, 'project_guide', '导游', g.gender,
             1, pg.needs_lodging, pg.joins_default_meals
      FROM project_guides pg JOIN guides g ON g.id = pg.guide_id
      WHERE pg.handling_status = '保留'
      UNION ALL
      SELECT tr.id, tr.project_id, 'transport_driver', '司机', tr.driver_gender,
             1, tr.driver_needs_lodging, tr.driver_joins_default_meals
      FROM transport_sheet_rows tr
      UNION ALL
      SELECT ms.id, ms.project_id, 'manual_role', ms.role, ms.gender,
             ms.people_count, ms.lodging_count, ms.default_meal_count
      FROM manual_project_staff ms;
    `);
  }
};
