export const migration007 = {
  version: 7,
  name: 'meal_participation_overrides_include_classes',
  up(db) {
    db.exec(`
      ALTER TABLE staff_meal_overrides RENAME TO staff_meal_overrides_legacy;
      CREATE TABLE staff_meal_overrides (
        id TEXT PRIMARY KEY,
        meal_session_id TEXT NOT NULL REFERENCES meal_sessions(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL CHECK (source_type IN ('class','teacher','project_guide','transport_driver','manual_role')),
        source_id TEXT NOT NULL,
        difference_count INTEGER NOT NULL CHECK (difference_count <> 0),
        reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
        created_at TEXT NOT NULL,
        UNIQUE (meal_session_id, source_type, source_id)
      ) STRICT;
      INSERT INTO staff_meal_overrides(id,meal_session_id,source_type,source_id,difference_count,reason,created_at)
        SELECT id,meal_session_id,source_type,source_id,difference_count,reason,created_at FROM staff_meal_overrides_legacy;
      DROP TABLE staff_meal_overrides_legacy;
    `);
  }
};
