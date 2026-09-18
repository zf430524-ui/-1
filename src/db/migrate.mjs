import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { migration001 } from './migrations/001-initial.mjs';
import { migration002 } from './migrations/002-import-workflow.mjs';
import { migration003 } from './migrations/003-business-workflow.mjs';
import { migration004 } from './migrations/004-guide-library.mjs';
import { migration005 } from './migrations/005-recruitment-batches.mjs';
import { migration006 } from './migrations/006-transport-planning.mjs';
import { migration007 } from './migrations/007-meal-participation-overrides.mjs';

export const migrations = [migration001, migration002, migration003, migration004, migration005, migration006, migration007];

export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function migrate(db, selectedMigrations = migrations) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version));
  const apply = db.transaction((migration) => {
    migration.up(db);
    db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(migration.version, migration.name, new Date().toISOString());
  });
  for (const migration of selectedMigrations) if (!applied.has(migration.version)) apply(migration);
  return db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version').all();
}
