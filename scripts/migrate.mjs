import { resolve } from 'node:path';
import { migrate, openDatabase } from '../src/db/migrate.mjs';

const filename = resolve(process.env.WORKBENCH_DB_PATH || '.runtime/data/workbench.sqlite');
const db = openDatabase(filename);
try {
  const applied = migrate(db);
  console.log(`数据库已迁移到版本 ${applied.at(-1)?.version ?? 0}（开发路径：${filename}）`);
} finally {
  db.close();
}
