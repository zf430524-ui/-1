import { createId } from '../id.mjs';

export function createSchoolRepository(db) {
  const selectBase = `SELECT s.id, s.name, s.cooperation_notes AS cooperationNotes, s.active,
    s.created_at AS createdAt, s.updated_at AS updatedAt, s.last_used_at AS lastUsedAt,
    COUNT(DISTINCT p.id) AS projectCount, COUNT(DISTINCT sc.id) AS contactCount
    FROM schools s LEFT JOIN projects p ON p.school_id = s.id
    LEFT JOIN school_contacts sc ON sc.school_id = s.id`;

  function list({ query = '', active = 'all', limit = 50, offset = 0 } = {}) {
    const filters = [];
    const params = {};
    if (query.trim()) { filters.push('s.name LIKE @query ESCAPE \'\\\''); params.query = `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`; }
    if (active !== 'all') { filters.push('s.active = @active'); params.active = active ? 1 : 0; }
    params.limit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    params.offset = Math.max(Number(offset) || 0, 0);
    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
    return db.prepare(`${selectBase}${where} GROUP BY s.id ORDER BY s.active DESC, COALESCE(s.last_used_at, s.created_at) DESC, s.name LIMIT @limit OFFSET @offset`).all(params);
  }

  function getById(id) {
    const school = db.prepare(`${selectBase} WHERE s.id = ? GROUP BY s.id`).get(id);
    if (!school) return null;
    school.contacts = db.prepare(`SELECT id, name, phone, notes, is_default AS isDefault, created_at AS createdAt, updated_at AS updatedAt FROM school_contacts WHERE school_id = ? ORDER BY is_default DESC, created_at`).all(id);
    return school;
  }

  function findSimilar(name, excludeId = '') {
    const normalized = name.trim().replace(/\s+/g, '');
    return db.prepare(`SELECT id, name, active FROM schools WHERE id <> ? AND (replace(name, ' ', '') = ? OR name LIKE ?) ORDER BY active DESC LIMIT 5`).all(excludeId, normalized, `%${name.trim()}%`);
  }

  function findExact(name) {
    const normalized = String(name || '').trim().replace(/\s+/g, '');
    const row = db.prepare("SELECT id FROM schools WHERE replace(name, ' ', '') = ? COLLATE NOCASE LIMIT 1").get(normalized);
    return row ? getById(row.id) : null;
  }

  function create({ name, cooperationNotes = '', contacts = [] }, now) {
    const schoolId = createId('school');
    db.prepare('INSERT INTO schools(id,name,cooperation_notes,created_at,updated_at) VALUES (?,?,?,?,?)').run(schoolId, name.trim(), cooperationNotes.trim(), now, now);
    const insertContact = db.prepare('INSERT INTO school_contacts(id,school_id,name,phone,notes,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)');
    contacts.forEach((contact) => insertContact.run(createId('contact'), schoolId, contact.name.trim(), contact.phone.trim(), String(contact.notes || '').trim(), contact.isDefault ? 1 : 0, now, now));
    return getById(schoolId);
  }

  function update(id, { name, cooperationNotes = '', contacts = [] }, now) {
    const changed = db.prepare('UPDATE schools SET name=?, cooperation_notes=?, updated_at=? WHERE id=?').run(name.trim(), cooperationNotes.trim(), now, id);
    if (!changed.changes) return null;
    db.prepare('DELETE FROM school_contacts WHERE school_id=?').run(id);
    const insertContact = db.prepare('INSERT INTO school_contacts(id,school_id,name,phone,notes,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)');
    contacts.forEach((contact) => insertContact.run(contact.id || createId('contact'), id, contact.name.trim(), contact.phone.trim(), String(contact.notes || '').trim(), contact.isDefault ? 1 : 0, now, now));
    return getById(id);
  }

  function setActive(id, active, now) {
    const result = db.prepare('UPDATE schools SET active=?, updated_at=? WHERE id=?').run(active ? 1 : 0, now, id);
    return result.changes ? getById(id) : null;
  }

  function removeIfUnused(id) {
    const references = db.prepare('SELECT COUNT(*) AS count FROM projects WHERE school_id=?').get(id).count;
    if (references) return { removed: false, references };
    return { removed: Boolean(db.prepare('DELETE FROM schools WHERE id=?').run(id).changes), references: 0 };
  }

  return { list, getById, findExact, findSimilar, create, update, setActive, removeIfUnused };
}
