export const migration004 = {
  version: 4,
  name: 'guide_library_profile_and_facts',
  up(db) {
    db.exec(`
      ALTER TABLE guides ADD COLUMN birth_date TEXT;
      ALTER TABLE guides ADD COLUMN residence_area TEXT NOT NULL DEFAULT '';
      ALTER TABLE guide_documents ADD COLUMN controlled_file_ref_back TEXT;

      ALTER TABLE guide_tour_facts ADD COLUMN responsible_class_snapshot TEXT NOT NULL DEFAULT '';
      ALTER TABLE guide_tour_facts ADD COLUMN is_completed INTEGER NOT NULL DEFAULT 1 CHECK (is_completed IN (0, 1));
      ALTER TABLE guide_tour_facts ADD COLUMN is_positive INTEGER NOT NULL DEFAULT 0 CHECK (is_positive IN (0, 1));
      ALTER TABLE guide_tour_facts ADD COLUMN fact_notes TEXT NOT NULL DEFAULT '';

      CREATE UNIQUE INDEX guide_tour_fact_project_once
        ON guide_tour_facts(guide_id, project_id) WHERE project_id IS NOT NULL;
      CREATE INDEX guide_documents_expiry ON guide_documents(document_type, expires_on);
      CREATE INDEX guide_tour_facts_guide_date ON guide_tour_facts(guide_id, ended_on);
      CREATE INDEX guide_withdrawals_guide_days ON guide_withdrawal_facts(guide_id, days_before_departure);
    `);
  }
};
