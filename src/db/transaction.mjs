export function runInTransaction(db, operation) {
  return db.transaction(operation)();
}
