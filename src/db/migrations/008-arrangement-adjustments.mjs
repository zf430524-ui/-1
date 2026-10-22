export const migration008 = {
  version: 8,
  name: 'arrangement_adjustment_states_and_requirements',
  up(db) {
    db.exec(`
      ALTER TABLE transport_sheet_rows ADD COLUMN arrangement_state TEXT NOT NULL DEFAULT '自动安排'
        CHECK (arrangement_state IN ('自动安排','调整中','人工确认','待重新确认'));
      ALTER TABLE transport_sheet_rows ADD COLUMN special_requirements TEXT NOT NULL DEFAULT '';
      ALTER TABLE transport_sheet_rows ADD COLUMN arrangement_summary TEXT NOT NULL DEFAULT '';

      ALTER TABLE lodging_sheet_rows ADD COLUMN lodging_address TEXT NOT NULL DEFAULT '';
      ALTER TABLE lodging_sheet_rows ADD COLUMN arrangement_state TEXT NOT NULL DEFAULT '自动安排'
        CHECK (arrangement_state IN ('自动安排','调整中','人工确认','待重新确认'));
      ALTER TABLE lodging_sheet_rows ADD COLUMN special_requirements TEXT NOT NULL DEFAULT '';
      ALTER TABLE lodging_sheet_rows ADD COLUMN arrangement_summary TEXT NOT NULL DEFAULT '';

      ALTER TABLE meal_sessions ADD COLUMN special_requirements TEXT NOT NULL DEFAULT '';
      ALTER TABLE meal_sheet_rows ADD COLUMN arrangement_state TEXT NOT NULL DEFAULT '自动安排'
        CHECK (arrangement_state IN ('自动安排','调整中','人工确认','待重新确认'));
      ALTER TABLE meal_sheet_rows ADD COLUMN special_requirements TEXT NOT NULL DEFAULT '';
      ALTER TABLE meal_sheet_rows ADD COLUMN arrangement_summary TEXT NOT NULL DEFAULT '';

      CREATE INDEX transport_arrangement_state ON transport_sheet_rows(project_id, arrangement_state);
      CREATE INDEX lodging_arrangement_state ON lodging_sheet_rows(project_id, arrangement_state);
      CREATE INDEX meal_arrangement_state ON meal_sheet_rows(meal_session_id, arrangement_state);
    `);
  }
};
