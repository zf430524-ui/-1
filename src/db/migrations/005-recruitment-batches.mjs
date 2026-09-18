export const migration005 = {
  version: 5,
  name: 'recruitment_batch_order_and_source_sequence',
  up(db) {
    db.exec(`
      ALTER TABLE project_guides ADD COLUMN batch_source_order INTEGER NOT NULL DEFAULT 0 CHECK (batch_source_order >= 0);
      ALTER TABLE project_guides ADD COLUMN source_sequence INTEGER;
      UPDATE project_guides SET batch_source_order=source_order,source_sequence=source_order WHERE batch_source_order=0;
      CREATE UNIQUE INDEX project_guides_batch_order ON project_guides(recruitment_batch_id,batch_source_order) WHERE recruitment_batch_id IS NOT NULL;
      CREATE INDEX recruitment_batches_project_date ON recruitment_batches(project_id,created_at);
    `);
  }
};
