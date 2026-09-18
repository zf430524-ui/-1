export const migration003 = {
  version: 3,
  name: 'business_workflow_and_versions',
  up(db) {
    db.exec(`
      ALTER TABLE projects ADD COLUMN data_version INTEGER NOT NULL DEFAULT 1 CHECK (data_version > 0);

      CREATE TABLE guide_class_assignments (
        id TEXT PRIMARY KEY,
        project_guide_id TEXT NOT NULL REFERENCES project_guides(id) ON DELETE CASCADE,
        class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
        is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0, 1)),
        exception_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_guide_id, class_id)
      ) STRICT;
      CREATE UNIQUE INDEX guide_assignment_one_primary
        ON guide_class_assignments(project_guide_id) WHERE is_primary = 1;
      CREATE INDEX guide_assignments_class ON guide_class_assignments(class_id);
      CREATE INDEX exports_project_version ON export_records(project_id, data_version, status);
    `);
  }
};
