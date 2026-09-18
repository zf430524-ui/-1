export function createProjectRepository(db) {
  function countBySchool(schoolId) {
    return db.prepare('SELECT COUNT(*) AS count FROM projects WHERE school_id=?').get(schoolId).count;
  }

  function touchSchool(schoolId, now) {
    db.prepare('UPDATE schools SET last_used_at=?, updated_at=? WHERE id=?').run(now, now, schoolId);
  }

  return { countBySchool, touchSchool };
}
