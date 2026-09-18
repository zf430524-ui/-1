export const migration002 = {
  version: 2,
  name: 'import_workflow',
  up(db) {
    db.exec(`
      ALTER TABLE import_batches ADD COLUMN notes TEXT NOT NULL DEFAULT '';
      ALTER TABLE import_batches ADD COLUMN template_version TEXT NOT NULL DEFAULT '';
      ALTER TABLE import_batches ADD COLUMN source_headers_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE import_batches ADD COLUMN mapping_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE import_batches ADD COLUMN fingerprint TEXT NOT NULL DEFAULT '';
      ALTER TABLE import_batches ADD COLUMN stored_file_ref TEXT NOT NULL DEFAULT '';
      ALTER TABLE import_batches ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

      ALTER TABLE import_rows ADD COLUMN override_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE import_rows ADD COLUMN raw_fingerprint TEXT NOT NULL DEFAULT '';

      CREATE INDEX import_batches_created_at ON import_batches(created_at DESC);
      CREATE INDEX import_batches_fingerprint ON import_batches(fingerprint, target_type, project_id);
      CREATE INDEX import_rows_batch_status ON import_rows(batch_id, status, source_row_number);
    `);
  }
};
