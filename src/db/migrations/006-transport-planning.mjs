export const migration006 = {
  version: 6,
  name: 'transport_planning_fields_and_guide_links',
  up(db) {
    db.exec(`
      ALTER TABLE transport_sheet_rows ADD COLUMN fleet_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE transport_sheet_rows ADD COLUMN vehicle_model TEXT NOT NULL DEFAULT '';
      ALTER TABLE transport_allocations ADD COLUMN boys_count INTEGER NOT NULL DEFAULT 0 CHECK (boys_count >= 0);
      ALTER TABLE transport_allocations ADD COLUMN girls_count INTEGER NOT NULL DEFAULT 0 CHECK (girls_count >= 0);
      ALTER TABLE transport_allocations ADD COLUMN project_guide_id TEXT REFERENCES project_guides(id) ON DELETE RESTRICT;
      CREATE UNIQUE INDEX transport_guide_one_vehicle ON transport_allocations(project_guide_id) WHERE project_guide_id IS NOT NULL;
      CREATE INDEX transport_allocations_class_role ON transport_allocations(class_id,role);
    `);
  }
};
