import { runInTransaction } from '../db/transaction.mjs';
import { failure, success } from './result.mjs';
import { parseGuideSignupText } from '../imports/parsers.mjs';

const requiredText = (value) => String(value || '').trim();
const projectStatuses = new Set(['资料待补充','人员安排中','车辆安排中','住宿安排中','用餐安排中','待检查','已完成安排','已出团','已结束']);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const phonePattern = /^[0-9+()\-\s]{6,24}$/;
const issue = (projectId, module, code, sourceType, sourceId, message) => ({
  module, severity: '阻断', code, sourceType, sourceId, message,
  fingerprint: `${projectId}:${module}:${code}:${sourceType}:${sourceId}`
});
const warningIssue = (projectId, module, code, sourceType, sourceId, message) => ({
  module, severity: '警告', code, sourceType, sourceId, message,
  fingerprint: `${projectId}:${module}:${code}:${sourceType}:${sourceId}`
});
const reminderIssue = (projectId, module, code, sourceType, sourceId, message) => ({
  module, severity: '提醒', code, sourceType, sourceId, message,
  fingerprint: `${projectId}:${module}:${code}:${sourceType}:${sourceId}`
});

function shanghaiDate(value) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(value)).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addCalendarDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function exceptionActionPath(row) {
  const paths = { 项目: '/projects/new', 人员: '/projects/people', 导游: '/projects/guides', 乘车: '/projects/transport', 住宿: '/projects/lodging', 用餐: '/projects/meals' };
  const path = paths[row.module] || '/projects/overview';
  const params = new URLSearchParams(path === '/projects/new' ? { id: row.project_id } : { project: row.project_id });
  if (row.source_id && row.source_id !== row.project_id) params.set('focus', row.source_id);
  params.set('exception', row.id);
  return `${path}?${params}`;
}

const stageDefinition = [
  ['people','班级、老师与随团汇总','/projects/people'],
  ['recruitment','招募通知与接龙导入','/projects/recruitment'],
  ['guides','导游安排','/projects/guides'],
  ['transport','乘车安排','/projects/transport'],
  ['lodging','住宿安排','/projects/lodging'],
  ['meals','用餐安排','/projects/meals'],
  ['tables','表格检查与导出','/tables']
];

export function buildProjectOverview(summary) {
  const active = summary.exceptions.filter((row) => row.status === '待处理');
  const blockers = active.filter((row) => row.severity === '阻断');
  const warnings = active.filter((row) => row.severity === '警告');
  const reminders = active.filter((row) => row.severity === '提醒');
  const moduleBlocked = (module) => blockers.some((row) => row.module === module);
  const missingFields = [
    ['meeting_place','集合地点'],['meeting_at','集合时间'],['itinerary','行程内容'],['school_lead_name','学校总负责人'],['school_lead_phone','负责人电话']
  ].filter(([key]) => !summary.project[key]).map(([key, label]) => ({ key, label, path: `/projects/new?id=${encodeURIComponent(summary.project.id)}` }));
  const guideGap = summary.guideCoverage.reduce((sum, row) => sum + Math.max(0, Number(row.guideRequired) - Number(row.assignedCount)), 0);
  const recruitmentComplete = summary.recruitmentBatches.length > 0 || (summary.requiredGuides > 0 && guideGap === 0);
  const peopleComplete = summary.counts.classes > 0;
  const guidesComplete = peopleComplete && summary.requiredGuides > 0 && guideGap === 0 && !moduleBlocked('导游');
  const transportComplete = summary.counts.vehicles > 0 && !moduleBlocked('乘车');
  const lodgingApplicable = Boolean(summary.project.needs_lodging);
  const lodgingComplete = lodgingApplicable && summary.counts.rooms > 0 && !moduleBlocked('住宿');
  const mealsApplicable = Boolean(summary.project.includes_meals);
  const mealsComplete = mealsApplicable && summary.counts.meals === summary.project.meal_count && !moduleBlocked('用餐');
  const currentExports = summary.exports.filter((row) => row.status === '成功' && String(row.data_version) === String(summary.project.data_version));
  const tableComplete = new Set(currentExports.map((row) => row.table_type)).size >= 4;
  const values = {
    people: { applicable: true, complete: peopleComplete, blocked: moduleBlocked('人员'), detail: peopleComplete ? `${summary.counts.classes} 个班级，${summary.students} 名学生` : '尚未建立班级与人员基线' },
    recruitment: { applicable: true, complete: recruitmentComplete, blocked: false, detail: summary.recruitmentBatches.length ? `${summary.recruitmentBatches.length} 个接龙批次` : '尚未导入最终接龙' },
    guides: { applicable: true, complete: guidesComplete, blocked: moduleBlocked('导游'), detail: `所需 ${summary.requiredGuides} 名，已安排 ${summary.arrangedGuides} 名` },
    transport: { applicable: true, complete: transportComplete, blocked: moduleBlocked('乘车'), detail: summary.counts.vehicles ? `${summary.counts.vehicles} 辆车，已安排 ${summary.transport.reduce((sum, row) => sum + Number(row.allocated || 0), 0)} 人` : '尚未建立乘车安排' },
    lodging: { applicable: lodgingApplicable, complete: lodgingComplete, blocked: moduleBlocked('住宿'), detail: lodgingApplicable ? (summary.counts.rooms ? `${summary.counts.rooms} 间房` : '尚未建立住宿安排') : '本项目不需要住宿' },
    meals: { applicable: mealsApplicable, complete: mealsComplete, blocked: moduleBlocked('用餐'), detail: mealsApplicable ? `计划 ${summary.project.meal_count} 餐，已配置 ${summary.counts.meals} 餐` : '本项目不含餐' },
    tables: { applicable: true, complete: tableComplete, blocked: blockers.length > 0, detail: tableComplete ? `${currentExports.length} 份当前版本表格` : blockers.length ? `仍有 ${blockers.length} 个阻断，暂不可导出` : '尚未生成当前版本的四类表格' }
  };
  const stages = stageDefinition.map(([id, label, path], index) => {
    const value = values[id];
    const status = !value.applicable ? 'not_applicable' : value.blocked ? 'blocked' : value.complete ? 'complete' : 'pending';
    return { id, order: index + 1, label, path: `${path}?project=${encodeURIComponent(summary.project.id)}`, status, detail: value.detail };
  });
  const next = stages.find((stage) => stage.status === 'blocked' || stage.status === 'pending') || null;
  const checkComplete = blockers.length === 0 && peopleComplete && guidesComplete && transportComplete && (!lodgingApplicable || lodgingComplete) && (!mealsApplicable || mealsComplete);
  const progressChecks = [
    { complete: missingFields.length === 0 }, { complete: peopleComplete }, { complete: guidesComplete }, { complete: transportComplete },
    ...(lodgingApplicable ? [{ complete: lodgingComplete }] : []), ...(mealsApplicable ? [{ complete: mealsComplete }] : []), { complete: checkComplete }
  ];
  const lodgingExpected = lodgingApplicable ? summary.students + summary.staff.reduce((sum, row) => sum + Number(row.lodging_count || 0), 0) : 0;
  const lodgingDates = new Map();
  for (const room of summary.lodging) lodgingDates.set(room.check_in_on, (lodgingDates.get(room.check_in_on) || 0) + Number(room.allocated || 0));
  const staffTotal = summary.staff.reduce((sum, row) => sum + Number(row.people_count || 0), 0);
  const transportCapacity = summary.transport.reduce((sum, row) => sum + Number(row.capacity || 0) - Number(row.safety_reserve || 0), 0);
  const transportAssigned = summary.transport.reduce((sum, row) => sum + Number(row.allocated || 0), 0);
  return {
    ...summary, missingFields, guideGap, stages, next,
    exceptionStats: { blockers: blockers.length, warnings: warnings.length, reminders: reminders.length },
    progress: { completed: progressChecks.filter((row) => row.complete).length, total: progressChecks.length, percent: Math.round(progressChecks.filter((row) => row.complete).length * 100 / progressChecks.length) },
    canComplete: checkComplete,
    totals: { staff: staffTotal, transportCapacity, transportAssigned, lodgingExpected, lodgingAssigned: lodgingDates.size ? Math.min(...lodgingDates.values()) : 0, mealsPlanned: summary.project.meal_count, mealsConfigured: summary.counts.meals }
  };
}

export function closedDateRangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return Boolean(leftStart && leftEnd && rightStart && rightEnd && leftStart <= rightEnd && leftEnd >= rightStart);
}

function splitStudents(count, boys, girls) {
  if (count >= boys + girls) return { boys, girls };
  const proposedBoys = Math.min(boys, Math.floor(count * boys / Math.max(1, boys + girls)));
  const proposedGirls = Math.min(girls, count - proposedBoys);
  const short = count - proposedBoys - proposedGirls;
  return { boys: proposedBoys + Math.min(short, boys - proposedBoys), girls: proposedGirls + Math.max(0, short - (boys - proposedBoys)) };
}

export function buildTransportSuggestion({ classes = [], guides = [], vehicles = [] } = {}) {
  const prepared = vehicles.map((vehicle, index) => ({ ...vehicle, allocations: [], _index: index,
    _remaining: Math.max(0, Number(vehicle.capacity || 0) - Number(vehicle.safetyReserve || 0)) }));
  const guidesByClass = new Map();
  for (const guide of guides.filter((item) => item.handling_status === '保留' && item.assignment_count > 0)) {
    for (const assignment of guide.assignments || []) {
      const rows = guidesByClass.get(assignment.classId) || [];
      rows.push({ id: guide.id, name: guide.guide_name || guide.source_name, phone: guide.guide_phone || guide.source_phone || '' });
      guidesByClass.set(assignment.classId, rows);
    }
  }
  const usedGuides = new Set(); const unassigned = []; const splitClasses = [];

  function addClassPart(vehicle, classRow, studentCount, boys, girls, teachers, classGuides) {
    if (studentCount > 0) vehicle.allocations.push({ classId: classRow.id, role: '学生', peopleCount: studentCount, boysCount: boys, girlsCount: girls });
    if (teachers > 0) vehicle.allocations.push({ classId: classRow.id, role: '老师', peopleCount: teachers });
    for (const guide of classGuides) vehicle.allocations.push({ classId: classRow.id, role: '导游', peopleCount: 1, projectGuideId: guide.id });
    vehicle._remaining -= studentCount + teachers + classGuides.length;
  }

  for (const classRow of classes) {
    const classGuides = (guidesByClass.get(classRow.id) || []).filter((guide) => !usedGuides.has(guide.id));
    const teachers = Number(classRow.teachers_on_vehicle ?? classRow.teachersOnVehicle ?? 0);
    const students = Number(classRow.student_total ?? classRow.studentTotal ?? 0);
    const boys = Number(classRow.boys || 0); const girls = Number(classRow.girls || 0);
    const required = students + teachers + classGuides.length;
    const fullFit = prepared.filter((vehicle) => vehicle._remaining >= required)
      .sort((left, right) => (left._remaining - required) - (right._remaining - required) || left._index - right._index)[0];
    if (fullFit) {
      addClassPart(fullFit, classRow, students, boys, girls, teachers, classGuides);
      classGuides.forEach((guide) => usedGuides.add(guide.id));
      continue;
    }
    const totalRemaining = prepared.reduce((sum, vehicle) => sum + vehicle._remaining, 0);
    if (totalRemaining < required) {
      unassigned.push({ classId: classRow.id, className: classRow.name, peopleCount: required, missingSeats: required - totalRemaining });
      continue;
    }
    const candidates = prepared.filter((vehicle) => vehicle._remaining > 0).sort((left, right) => right._remaining - left._remaining || left._index - right._index);
    const first = candidates.find((vehicle) => vehicle._remaining >= teachers + classGuides.length);
    if (!first) {
      unassigned.push({ classId: classRow.id, className: classRow.name, peopleCount: required, missingSeats: required });
      continue;
    }
    const ordered = [first, ...candidates.filter((vehicle) => vehicle !== first)];
    let remainingStudents = students; let remainingBoys = boys; let remainingGirls = girls; let parts = 0;
    for (const vehicle of ordered) {
      const fixed = parts === 0 ? teachers + classGuides.length : 0;
      const studentCount = Math.min(remainingStudents, Math.max(0, vehicle._remaining - fixed));
      if (!studentCount && !fixed) continue;
      const genders = splitStudents(studentCount, remainingBoys, remainingGirls);
      addClassPart(vehicle, classRow, studentCount, genders.boys, genders.girls, parts === 0 ? teachers : 0, parts === 0 ? classGuides : []);
      remainingStudents -= studentCount; remainingBoys -= genders.boys; remainingGirls -= genders.girls; parts += 1;
      if (!remainingStudents) break;
    }
    classGuides.forEach((guide) => usedGuides.add(guide.id));
    if (parts > 1) splitClasses.push({ classId: classRow.id, className: classRow.name, vehicles: parts });
  }

  const resultVehicles = prepared.map(({ _index, _remaining, ...vehicle }) => vehicle);
  const assigned = resultVehicles.reduce((sum, vehicle) => sum + vehicle.allocations.reduce((n, row) => n + row.peopleCount, 0), 0);
  const capacity = resultVehicles.reduce((sum, vehicle) => sum + Number(vehicle.capacity || 0) - Number(vehicle.safetyReserve || 0), 0);
  return { vehicles: resultVehicles, unassigned, splitClasses, totals: { capacity, assigned, emptySeats: capacity - assigned, missingSeats: unassigned.reduce((sum, item) => sum + item.missingSeats, 0) } };
}

function floorOrder(value) {
  const match = String(value || '').match(/-?\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function lodgingNights(startsOn, endsOn) {
  const dates = []; const current = new Date(`${startsOn}T00:00:00.000Z`); const end = new Date(`${endsOn}T00:00:00.000Z`);
  while (current < end) { dates.push(current.toISOString().slice(0, 10)); current.setUTCDate(current.getUTCDate() + 1); }
  return dates;
}

export function lodgingSourceRows({ classes = [], staff = [] } = {}) {
  const rows = [];
  for (const classRow of classes) {
    if (Number(classRow.boys || 0) > 0) rows.push({ classId: classRow.id, className: classRow.name, role: '学生', gender: '男', peopleCount: Number(classRow.boys), source: 'P05 班级人数' });
    if (Number(classRow.girls || 0) > 0) rows.push({ classId: classRow.id, className: classRow.name, role: '学生', gender: '女', peopleCount: Number(classRow.girls), source: 'P05 班级人数' });
  }
  const grouped = new Map();
  for (const item of staff.filter((row) => Number(row.lodging_count || 0) > 0)) {
    const key = `${item.role}|${item.gender}`; const current = grouped.get(key) || { role: item.role, gender: item.gender, peopleCount: 0, sourceTypes: new Set() };
    current.peopleCount += Number(item.lodging_count); current.sourceTypes.add(item.source_type); grouped.set(key, current);
  }
  for (const item of grouped.values()) rows.push({ role: item.role, gender: item.gender, peopleCount: item.peopleCount, sourceTypes: [...item.sourceTypes], source: item.role === '老师' ? 'P05 老师' : item.role === '导游' ? 'P07 导游安排' : item.role === '司机' ? 'P08 车辆司机' : 'P05 手工汇总' });
  return rows;
}

export function buildLodgingSuggestion({ classes = [], staff = [], rooms = [] } = {}) {
  const sources = lodgingSourceRows({ classes, staff });
  const prepared = rooms.map((room, index) => ({ ...room, allocations: [], _index: index, _remaining: Number(room.capacity || 0), _roomGender: '' }));
  const dates = [...new Set(prepared.map((room) => room.checkInOn).filter(Boolean))].sort();
  const unassigned = []; const crossClassRooms = [];
  const roomSort = (left, right) => left.checkInOn.localeCompare(right.checkInOn) || floorOrder(left.floorLabel) - floorOrder(right.floorLabel) || String(left.building || '').localeCompare(String(right.building || ''), 'zh-CN', { numeric: true }) || String(left.roomNumber || '').localeCompare(String(right.roomNumber || ''), 'zh-CN', { numeric: true }) || left._index - right._index;

  for (const date of dates) {
    for (const gender of ['男', '女']) {
      const groups = sources.filter((source) => source.gender === gender).sort((left, right) => (left.role === '学生' ? 0 : 1) - (right.role === '学生' ? 0 : 1) || String(left.className || left.role).localeCompare(String(right.className || right.role), 'zh-CN', { numeric: true }));
      for (const source of groups) {
        let remaining = source.peopleCount;
        while (remaining > 0) {
          const room = prepared.filter((candidate) => candidate.checkInOn === date && candidate._remaining > 0 && (candidate.genderRule === gender || candidate.genderRule === '不限') && (!candidate._roomGender || candidate._roomGender === gender)).sort(roomSort)[0];
          if (!room) { unassigned.push({ date, classId: source.classId || '', className: source.className || '', role: source.role, gender, peopleCount: remaining }); break; }
          const peopleCount = Math.min(remaining, room._remaining); room.allocations.push({ classId: source.classId || undefined, role: source.role, gender, peopleCount, crossClassReason: '' });
          room._remaining -= peopleCount; room._roomGender = gender; remaining -= peopleCount;
        }
      }
    }
  }

  for (const room of prepared) {
    const studentRows = room.allocations.filter((row) => row.role === '学生' && row.classId); const classIds = [...new Set(studentRows.map((row) => row.classId))];
    if (classIds.length > 1) {
      const reason = '同性交叉班级合住，减少空床并保持房号连续'; studentRows.forEach((row) => { row.crossClassReason = reason; });
      crossClassRooms.push({ checkInOn: room.checkInOn, roomNumber: room.roomNumber, classIds, parts: studentRows.map((row) => ({ classId: row.classId, peopleCount: row.peopleCount })), reason });
    }
  }
  const resultRooms = prepared.map(({ _index, _remaining, _roomGender, ...room }) => room);
  const capacity = resultRooms.reduce((sum, room) => sum + Number(room.capacity || 0), 0); const assigned = resultRooms.reduce((sum, room) => sum + room.allocations.reduce((total, row) => total + row.peopleCount, 0), 0);
  const expectedPerNight = sources.reduce((sum, row) => sum + row.peopleCount, 0); const expected = expectedPerNight * dates.length;
  return { rooms: resultRooms, sources, dates, crossClassRooms, unassigned, totals: { rooms: resultRooms.length, nights: dates.length, capacity, expected, assigned, emptyBeds: capacity - assigned, missingPeople: unassigned.reduce((sum, row) => sum + row.peopleCount, 0), expectedPerNight } };
}

export function mealSourceRows({ classes = [], staff = [], overrides = [] } = {}) {
  const overrideMap = new Map(overrides.map((row) => [`${row.sourceType ?? row.source_type}|${row.sourceId ?? row.source_id}`, row]));
  const rows = classes.map((row) => ({ sourceType: 'class', sourceId: row.id, classId: row.id, className: row.name, role: '学生', defaultCount: Number(row.student_total ?? row.studentTotal ?? 0), source: 'P05 班级人数' }));
  for (const row of staff) rows.push({ sourceType: row.source_type, sourceId: row.source_id, role: row.role, defaultCount: Number(row.default_meal_count || 0), source: row.role === '导游' ? 'P07 导游安排' : row.role === '司机' ? 'P08 车辆司机' : 'P05 人员汇总' });
  return rows.map((row) => {
    const override = overrideMap.get(`${row.sourceType}|${row.sourceId}`); const differenceCount = Number(override?.differenceCount ?? override?.difference_count ?? 0);
    return { ...row, differenceCount, reason: requiredText(override?.reason), peopleCount: row.defaultCount + differenceCount };
  });
}

export function buildMealSuggestion({ classes = [], staff = [], sessions = [], includeStaff = false } = {}) {
  const suggestedSessions = sessions.map((session, sessionIndex) => {
    const sources = mealSourceRows({ classes, staff, overrides: session.overrides || [] });
    const baseSources = sources.filter((row) => row.role === '学生' || row.role === '导游');
    const staffSources = sources.filter((row) => row.role !== '学生' && row.role !== '导游');
    const seats = Number(session.seatsPerTable || 10); const basePeople = baseSources.reduce((sum, row) => sum + row.peopleCount, 0);
    const staffPeople = staffSources.reduce((sum, row) => sum + row.peopleCount, 0); const totalPeople = basePeople + staffPeople;
    const baseSuggestedTables = Math.ceil(basePeople / seats); const finalRequiredTables = Math.ceil(totalPeople / seats);
    const prefix = requiredText(session.tablePrefix) || String.fromCharCode(65 + sessionIndex);
    const tableCount = includeStaff ? finalRequiredTables : baseSuggestedTables;
    const tables = Array.from({ length: tableCount }, (_, index) => ({ tableNumber: `${prefix}${String(index + 1).padStart(2, '0')}`, notes: '', allocations: [] }));
    let tableIndex = 0;
    for (const source of includeStaff ? sources : baseSources) {
      let remaining = source.peopleCount;
      while (remaining > 0 && tableIndex < tables.length) {
        const table = tables[tableIndex]; const used = table.allocations.reduce((sum, row) => sum + row.peopleCount, 0); const count = Math.min(remaining, seats - used);
        if (count > 0) table.allocations.push({ classId: source.classId || undefined, role: source.role, peopleCount: count, sharedTableReason: '' });
        remaining -= count; if (used + count >= seats) tableIndex += 1;
      }
    }
    for (const table of tables) {
      const studentRows = table.allocations.filter((row) => row.role === '学生' && row.classId); const classIds = new Set(studentRows.map((row) => row.classId));
      if (classIds.size > 1) studentRows.forEach((row) => { row.sharedTableReason = '相邻班级拼桌，保持班级顺序并补足本桌'; });
    }
    const allocated = tables.reduce((sum, table) => sum + table.allocations.reduce((n, row) => n + row.peopleCount, 0), 0);
    return { ...session, tables, sources, suggestion: { basePeople, staffPeople, totalPeople, baseSuggestedTables, staffAdditionalTables: Math.max(0, finalRequiredTables - baseSuggestedTables), finalRequiredTables, allocated, unassigned: totalPeople - allocated } };
  });
  return { sessions: suggestedSessions, totals: { sessions: suggestedSessions.length, baseSuggestedTables: suggestedSessions.reduce((sum, row) => sum + row.suggestion.baseSuggestedTables, 0), finalRequiredTables: suggestedSessions.reduce((sum, row) => sum + row.suggestion.finalRequiredTables, 0), allocated: suggestedSessions.reduce((sum, row) => sum + row.suggestion.allocated, 0), unassigned: suggestedSessions.reduce((sum, row) => sum + row.suggestion.unassigned, 0) } };
}

function caught(error) {
  return failure(error.code || 'DATABASE_WRITE_FAILED', error.publicMessage || error.message || '数据库写入失败');
}

export function createBusinessService({ db, repository, schoolRepository, audit, clock = () => new Date().toISOString() }) {
  const log = (projectId, objectType, objectId, summary, result = '成功', failureReason = '') => audit?.record({
    projectId, operationType: '修改安排', objectType, objectId, summary, result, failureReason
  });
  const getProject = (id) => repository.project(id);

  function validatePeopleInput(project, input = {}) {
    const errors = [];
    const fieldError = (field, message, code = 'PEOPLE_VALIDATION_FAILED') => errors.push({ field, message, code });
    const sourceClasses = Array.isArray(input.classes) ? input.classes : [];
    if (!sourceClasses.length) fieldError('classes', '请至少建立一个班级', 'CLASSES_REQUIRED');
    const classNames = new Set(); const classIds = new Set(); const teacherIds = new Set();
    const classes = sourceClasses.map((item, classIndex) => {
      const prefix = `classes.${classIndex}`;
      const id = requiredText(item.id) || undefined;
      const name = requiredText(item.name);
      const studentTotal = Number(item.studentTotal); const boys = Number(item.boys); const girls = Number(item.girls);
      const guideRequired = Number(item.guideRequired ?? 1);
      if (id && classIds.has(id)) fieldError(`${prefix}.id`, '班级记录编号重复', 'DUPLICATE_CLASS_ID');
      if (id) classIds.add(id);
      if (!name) fieldError(`${prefix}.name`, `第 ${classIndex + 1} 个班级缺少名称`, 'CLASS_NAME_REQUIRED');
      if (name && classNames.has(name)) fieldError(`${prefix}.name`, `班级“${name}”重复`, 'DUPLICATE_CLASS_NAME');
      classNames.add(name);
      for (const [key, value, label] of [['studentTotal', studentTotal, '学生总数'], ['boys', boys, '男生人数'], ['girls', girls, '女生人数']]) if (!Number.isInteger(value) || value < 0) fieldError(`${prefix}.${key}`, `班级“${name || classIndex + 1}”的${label}必须是非负整数`, 'INVALID_STUDENT_COUNT');
      if (Number.isInteger(studentTotal) && Number.isInteger(boys) && Number.isInteger(girls) && studentTotal !== boys + girls) fieldError(`${prefix}.studentTotal`, `班级“${name || classIndex + 1}”：学生总数 ${studentTotal} ≠ 男生 ${boys} + 女生 ${girls}`, 'STUDENT_TOTAL_MISMATCH');
      if (!Number.isInteger(guideRequired) || guideRequired <= 0) fieldError(`${prefix}.guideRequired`, `班级“${name || classIndex + 1}”需要导游人数必须是正整数`, 'GUIDE_REQUIRED_INVALID');
      const sourceTeachers = Array.isArray(item.teachers) ? item.teachers : [];
      const teachers = sourceTeachers.map((teacher, teacherIndex) => {
        const teacherPrefix = `${prefix}.teachers.${teacherIndex}`;
        const teacherId = requiredText(teacher.id) || undefined;
        const role = ['班主任', '配班老师'].includes(teacher.role) ? teacher.role : teacherIndex === 0 ? '班主任' : '配班老师';
        const value = { id: teacherId, role, name: requiredText(teacher.name), phone: requiredText(teacher.phone), gender: teacher.gender,
          ridesVehicle: teacher.ridesVehicle !== false, needsLodging: project.needs_lodging ? Boolean(teacher.needsLodging) : false,
          joinsDefaultMeals: project.includes_meals ? Boolean(teacher.joinsDefaultMeals) : false };
        if (teacherId && teacherIds.has(teacherId)) fieldError(`${teacherPrefix}.id`, '老师记录编号重复', 'DUPLICATE_TEACHER_ID');
        if (teacherId) teacherIds.add(teacherId);
        if (!value.name) fieldError(`${teacherPrefix}.name`, `班级“${name || classIndex + 1}”的老师姓名不能为空`, 'TEACHER_FIELDS_REQUIRED');
        if (!value.phone) fieldError(`${teacherPrefix}.phone`, `班级“${name || classIndex + 1}”的老师电话不能为空`, 'TEACHER_FIELDS_REQUIRED');
        else if (!phonePattern.test(value.phone)) fieldError(`${teacherPrefix}.phone`, `老师“${value.name || teacherIndex + 1}”电话格式不正确`, 'TEACHER_PHONE_INVALID');
        if (!['男', '女'].includes(value.gender)) fieldError(`${teacherPrefix}.gender`, `老师“${value.name || teacherIndex + 1}”必须填写性别`, 'TEACHER_GENDER_REQUIRED');
        if (project.needs_lodging && typeof teacher.needsLodging !== 'boolean') fieldError(`${teacherPrefix}.needsLodging`, `老师“${value.name || teacherIndex + 1}”必须明确是否住宿`, 'TEACHER_LODGING_REQUIRED');
        if (project.includes_meals && typeof teacher.joinsDefaultMeals !== 'boolean') fieldError(`${teacherPrefix}.joinsDefaultMeals`, `老师“${value.name || teacherIndex + 1}”必须明确是否参加默认餐次`, 'TEACHER_MEALS_REQUIRED');
        return value;
      });
      if (teachers.filter((teacher) => teacher.role === '班主任').length !== 1) fieldError(`${prefix}.teachers`, `班级“${name || classIndex + 1}”必须且只能有一名班主任`, 'HEAD_TEACHER_REQUIRED');
      const ridingTeachers = teachers.filter((teacher) => teacher.ridesVehicle).length;
      const vehicleDifferenceReason = requiredText(item.vehicleDifferenceReason);
      if (ridingTeachers !== teachers.length && !vehicleDifferenceReason) fieldError(`${prefix}.vehicleDifferenceReason`, `班级“${name || classIndex + 1}”有老师不随车，必须填写差异原因`, 'TEACHER_VEHICLE_REASON_REQUIRED');
      return { id, name, studentTotal, boys, girls, guideRequired, teachers, vehicleDifferenceReason, specialNotes: requiredText(item.specialNotes) };
    });
    const staffIds = new Set();
    const manualStaff = (Array.isArray(input.manualStaff) ? input.manualStaff : []).map((item, index) => {
      const prefix = `manualStaff.${index}`; const id = requiredText(item.id) || undefined;
      const peopleCount = Number(item.peopleCount); const lodgingCount = project.needs_lodging ? Number(item.lodgingCount ?? 0) : 0;
      const defaultMealCount = project.includes_meals ? Number(item.defaultMealCount ?? 0) : 0;
      if (id && staffIds.has(id)) fieldError(`${prefix}.id`, '手工人员汇总编号重复', 'DUPLICATE_STAFF_ID');
      if (id) staffIds.add(id);
      if (!['摄影师', '其他'].includes(item.role)) fieldError(`${prefix}.role`, '手工随团人员角色只能是摄影师或其他', 'MANUAL_STAFF_ROLE_INVALID');
      if (!['男', '女'].includes(item.gender)) fieldError(`${prefix}.gender`, '手工随团人员必须填写性别', 'MANUAL_STAFF_GENDER_REQUIRED');
      if (!Number.isInteger(peopleCount) || peopleCount <= 0) fieldError(`${prefix}.peopleCount`, '手工随团人员总数必须是正整数', 'MANUAL_STAFF_COUNT_INVALID');
      if (!Number.isInteger(lodgingCount) || lodgingCount < 0 || lodgingCount > peopleCount) fieldError(`${prefix}.lodgingCount`, '住宿人数必须在 0 到人员总数之间', 'MANUAL_STAFF_LODGING_INVALID');
      if (!Number.isInteger(defaultMealCount) || defaultMealCount < 0 || defaultMealCount > peopleCount) fieldError(`${prefix}.defaultMealCount`, '默认就餐人数必须在 0 到人员总数之间', 'MANUAL_STAFF_MEALS_INVALID');
      return { id, role: item.role, gender: item.gender, peopleCount, lodgingCount, defaultMealCount, notes: requiredText(item.notes) };
    });
    return { value: { classes, manualStaff }, errors };
  }

  function validateTransportInput(projectId, project, sourceVehicles) {
    const errors = []; const fieldError = (field, message, code = 'TRANSPORT_VALIDATION_FAILED') => errors.push({ field, message, code });
    const classes = repository.classes(projectId); const classMap = new Map(classes.map((item) => [item.id, item]));
    const guides = repository.guideAssignments(projectId); const guideMap = new Map(guides.map((item) => [item.id, item]));
    const labels = new Set(); const plates = new Set(); const guideIds = new Set(); const vehicleIds = new Set();
    const vehicles = (Array.isArray(sourceVehicles) ? sourceVehicles : []).map((item, vehicleIndex) => {
      const prefix = `vehicles.${vehicleIndex}`; const id = requiredText(item.id) || undefined;
      const vehicleLabel = requiredText(item.vehicleLabel ?? item.vehicle_label); const plateNumber = requiredText(item.plateNumber ?? item.plate_number);
      const capacity = Number(item.capacity); const safetyReserve = Number(item.safetyReserve ?? item.safety_reserve ?? 0);
      if (id && vehicleIds.has(id)) fieldError(`${prefix}.id`, '车辆记录编号重复', 'DUPLICATE_VEHICLE_ID');
      if (id) { vehicleIds.add(id); const owner = repository.transportRowProject(id); if (owner && owner !== projectId) fieldError(`${prefix}.id`, '车辆记录不属于当前项目', 'VEHICLE_NOT_IN_PROJECT'); }
      if (!vehicleLabel) fieldError(`${prefix}.vehicleLabel`, `第 ${vehicleIndex + 1} 辆车缺少车号`, 'VEHICLE_LABEL_REQUIRED');
      if (vehicleLabel && labels.has(vehicleLabel)) fieldError(`${prefix}.vehicleLabel`, `车号“${vehicleLabel}”重复`, 'DUPLICATE_VEHICLE_LABEL');
      labels.add(vehicleLabel);
      if (plateNumber && plates.has(plateNumber)) fieldError(`${prefix}.plateNumber`, `车牌号“${plateNumber}”重复`, 'DUPLICATE_PLATE_NUMBER');
      if (plateNumber) plates.add(plateNumber);
      if (!Number.isInteger(capacity) || capacity <= 0) fieldError(`${prefix}.capacity`, `${vehicleLabel || `第 ${vehicleIndex + 1} 辆车`}的可用座位数必须是正整数`, 'VEHICLE_CAPACITY_INVALID');
      if (!Number.isInteger(safetyReserve) || safetyReserve < 0 || safetyReserve >= capacity) fieldError(`${prefix}.safetyReserve`, '预留座位必须是小于容量的非负整数', 'VEHICLE_RESERVE_INVALID');
      const driverPhone = requiredText(item.driverPhone ?? item.driver_phone);
      if (driverPhone && !phonePattern.test(driverPhone)) fieldError(`${prefix}.driverPhone`, '司机电话格式不正确', 'DRIVER_PHONE_INVALID');
      const driverGender = ['男', '女', '未填写'].includes(item.driverGender ?? item.driver_gender) ? (item.driverGender ?? item.driver_gender) : '未填写';
      const driverNeedsLodging = project.needs_lodging ? Boolean(item.driverNeedsLodging ?? item.driver_needs_lodging) : false;
      if (project.needs_lodging && driverNeedsLodging && driverGender === '未填写') fieldError(`${prefix}.driverGender`, '住宿司机必须填写性别', 'DRIVER_GENDER_REQUIRED');
      const allocations = (Array.isArray(item.allocations) ? item.allocations : []).map((row, allocationIndex) => {
        const allocationPrefix = `${prefix}.allocations.${allocationIndex}`; const classId = requiredText(row.classId ?? row.class_id);
        const role = requiredText(row.role); const peopleCount = Number(row.peopleCount ?? row.people_count);
        const boysCount = Number(row.boysCount ?? row.boys_count ?? 0); const girlsCount = Number(row.girlsCount ?? row.girls_count ?? 0);
        const projectGuideId = requiredText(row.projectGuideId ?? row.project_guide_id) || undefined;
        if (!classMap.has(classId)) fieldError(`${allocationPrefix}.classId`, '乘员分配班级不属于当前项目', 'CLASS_NOT_IN_PROJECT');
        if (!['学生', '老师', '导游'].includes(role)) fieldError(`${allocationPrefix}.role`, '乘车分配角色只能是学生、老师或导游', 'TRANSPORT_ROLE_INVALID');
        if (!Number.isInteger(peopleCount) || peopleCount <= 0) fieldError(`${allocationPrefix}.peopleCount`, '乘车人数必须是正整数', 'TRANSPORT_COUNT_INVALID');
        if (role === '学生') {
          if (!Number.isInteger(boysCount) || boysCount < 0 || !Number.isInteger(girlsCount) || girlsCount < 0 || boysCount + girlsCount !== peopleCount) fieldError(`${allocationPrefix}.boysCount`, '学生分配的男生加女生必须等于本车学生人数', 'TRANSPORT_GENDER_COUNT_MISMATCH');
        } else if (boysCount || girlsCount) fieldError(`${allocationPrefix}.boysCount`, '老师和导游分配不能填写学生男女生人数', 'TRANSPORT_GENDER_ROLE_INVALID');
        if (role === '导游') {
          const guide = guideMap.get(projectGuideId);
          if (!guide || guide.handling_status !== '保留' || !guide.assignment_count) fieldError(`${allocationPrefix}.projectGuideId`, '所选导游不是当前项目已分班的保留导游', 'TRANSPORT_GUIDE_INVALID');
          else if (!guide.assignments.some((assignment) => assignment.classId === classId)) fieldError(`${allocationPrefix}.projectGuideId`, '导游没有负责该班级，不能放入本班乘车行', 'TRANSPORT_GUIDE_CLASS_MISMATCH');
          if (peopleCount !== 1) fieldError(`${allocationPrefix}.peopleCount`, '每条导游分配人数必须为 1', 'TRANSPORT_GUIDE_COUNT_INVALID');
          if (guideIds.has(projectGuideId)) fieldError(`${allocationPrefix}.projectGuideId`, '同一导游只能计入一辆车', 'TRANSPORT_GUIDE_DUPLICATE');
          if (projectGuideId) guideIds.add(projectGuideId);
        } else if (projectGuideId) fieldError(`${allocationPrefix}.projectGuideId`, '只有导游分配可以关联项目导游', 'TRANSPORT_GUIDE_ROLE_INVALID');
        return { classId, role, peopleCount, boysCount, girlsCount, projectGuideId, notes: requiredText(row.notes) };
      });
      return { id, vehicleLabel, fleetName: requiredText(item.fleetName ?? item.fleet_name), vehicleModel: requiredText(item.vehicleModel ?? item.vehicle_model), plateNumber,
        capacity, safetyReserve, driverName: requiredText(item.driverName ?? item.driver_name), driverPhone, driverGender, driverNeedsLodging,
        driverJoinsDefaultMeals: project.includes_meals ? Boolean(item.driverJoinsDefaultMeals ?? item.driver_joins_default_meals) : false,
        notes: requiredText(item.notes), allocations };
    });
    return { value: vehicles, errors };
  }

  function validateLodgingInput(projectId, project, sourceRooms) {
    const errors = []; const fieldError = (field, message, code = 'LODGING_VALIDATION_FAILED') => errors.push({ field, message, code });
    const classIds = new Set(repository.classes(projectId).map((item) => item.id)); const roomIds = new Set(); const roomKeys = new Set();
    const rooms = (Array.isArray(sourceRooms) ? sourceRooms : []).map((item, roomIndex) => {
      const prefix = `rooms.${roomIndex}`; const id = requiredText(item.id) || undefined; const lodgingName = requiredText(item.lodgingName ?? item.lodging_name);
      const checkInOn = requiredText(item.checkInOn ?? item.check_in_on); const building = requiredText(item.building); const floorLabel = requiredText(item.floorLabel ?? item.floor_label);
      const roomNumber = requiredText(item.roomNumber ?? item.room_number); const roomType = requiredText(item.roomType ?? item.room_type); const capacity = Number(item.capacity);
      const genderRule = ['男', '女', '不限'].includes(item.genderRule ?? item.gender_rule) ? (item.genderRule ?? item.gender_rule) : '';
      if (id && roomIds.has(id)) fieldError(`${prefix}.id`, '房间记录编号重复', 'DUPLICATE_LODGING_ROW_ID');
      if (id) { roomIds.add(id); const owner = repository.lodgingRowProject(id); if (owner && owner !== projectId) fieldError(`${prefix}.id`, '房间不属于当前项目', 'LODGING_ROW_NOT_IN_PROJECT'); }
      if (!lodgingName) fieldError(`${prefix}.lodgingName`, `第 ${roomIndex + 1} 间房缺少酒店名称`, 'LODGING_NAME_REQUIRED');
      if (!datePattern.test(checkInOn) || checkInOn < project.starts_on || checkInOn >= project.ends_on) fieldError(`${prefix}.checkInOn`, `${roomNumber || `第 ${roomIndex + 1} 间房`}入住日期必须落在出团日至返程日前一天`, 'LODGING_DATE_INVALID');
      if (!floorLabel) fieldError(`${prefix}.floorLabel`, `${roomNumber || `第 ${roomIndex + 1} 间房`}缺少楼层`, 'LODGING_FLOOR_REQUIRED');
      if (!roomNumber) fieldError(`${prefix}.roomNumber`, `第 ${roomIndex + 1} 间房缺少房号`, 'LODGING_ROOM_NUMBER_REQUIRED');
      if (!Number.isInteger(capacity) || capacity <= 0) fieldError(`${prefix}.capacity`, `${roomNumber || `第 ${roomIndex + 1} 间房`}可住人数必须是正整数`, 'LODGING_CAPACITY_INVALID');
      if (!genderRule) fieldError(`${prefix}.genderRule`, `${roomNumber || `第 ${roomIndex + 1} 间房`}性别规则必须为男、女或不限`, 'LODGING_GENDER_RULE_INVALID');
      const roomKey = `${checkInOn}|${lodgingName}|${roomNumber}`; if (roomKeys.has(roomKey)) fieldError(`${prefix}.roomNumber`, `同一入住日期和酒店的房号“${roomNumber}”重复`, 'DUPLICATE_LODGING_ROOM'); roomKeys.add(roomKey);
      const allocations = (Array.isArray(item.allocations) ? item.allocations : []).map((row, allocationIndex) => {
        const allocationPrefix = `${prefix}.allocations.${allocationIndex}`; const classId = requiredText(row.classId ?? row.class_id) || undefined; const role = requiredText(row.role);
        const gender = requiredText(row.gender); const peopleCount = Number(row.peopleCount ?? row.people_count);
        if (!['学生', '老师', '导游', '司机', '摄影师', '其他'].includes(role)) fieldError(`${allocationPrefix}.role`, '住宿角色无效', 'LODGING_ROLE_INVALID');
        if (!['男', '女'].includes(gender)) fieldError(`${allocationPrefix}.gender`, '住宿分配必须明确男或女', 'LODGING_GENDER_INVALID');
        if (!Number.isInteger(peopleCount) || peopleCount <= 0) fieldError(`${allocationPrefix}.peopleCount`, '住宿人数必须是正整数', 'LODGING_COUNT_INVALID');
        if (role === '学生' && (!classId || !classIds.has(classId))) fieldError(`${allocationPrefix}.classId`, '学生住宿必须选择当前项目班级', 'LODGING_CLASS_REQUIRED');
        if (role !== '学生' && classId) fieldError(`${allocationPrefix}.classId`, '工作人员住宿按角色和性别汇总，不关联班级', 'LODGING_STAFF_CLASS_INVALID');
        return { id: requiredText(row.id) || undefined, classId, role, gender, peopleCount, crossClassReason: requiredText(row.crossClassReason ?? row.cross_class_reason) };
      });
      return { id, lodgingName, checkInOn, building, floorLabel, roomNumber, roomType, capacity, genderRule, notes: requiredText(item.notes), allocations };
    });
    return { value: rooms, errors };
  }

  function validateMealInput(projectId, project, sourceSessions, { allowEmptyTables = false } = {}) {
    const errors = []; const fieldError = (field, message, code = 'MEAL_VALIDATION_FAILED') => errors.push({ field, message, code });
    const classes = repository.classes(projectId); const classIds = new Set(classes.map((row) => row.id)); const staff = repository.staffSources(projectId);
    const sourceKeys = new Set([...classes.map((row) => `class|${row.id}`), ...staff.map((row) => `${row.source_type}|${row.source_id}`)]);
    const sessionNames = new Set(); const sessionIds = new Set(); const tableIds = new Set();
    const sessions = (Array.isArray(sourceSessions) ? sourceSessions : []).map((item, sessionIndex) => {
      const prefix = `sessions.${sessionIndex}`; const id = requiredText(item.id) || undefined; const name = requiredText(item.name); const restaurantName = requiredText(item.restaurantName ?? item.restaurant_name);
      const mealAt = requiredText(item.mealAt ?? item.meal_at); const seatsPerTable = Number(item.seatsPerTable ?? item.seats_per_table ?? 10); const tablePrefix = requiredText(item.tablePrefix) || String.fromCharCode(65 + sessionIndex);
      if (id && sessionIds.has(id)) fieldError(`${prefix}.id`, '餐次记录编号重复', 'DUPLICATE_MEAL_SESSION_ID');
      if (id) { sessionIds.add(id); const owner = repository.mealSessionProject(id); if (owner && owner !== projectId) fieldError(`${prefix}.id`, '餐次不属于当前项目', 'MEAL_SESSION_NOT_IN_PROJECT'); }
      if (!name) fieldError(`${prefix}.name`, `第 ${sessionIndex + 1} 个餐次缺少名称`, 'MEAL_NAME_REQUIRED');
      if (name && sessionNames.has(name)) fieldError(`${prefix}.name`, `餐次“${name}”重复`, 'DUPLICATE_MEAL_NAME'); sessionNames.add(name);
      if (!restaurantName) fieldError(`${prefix}.restaurantName`, `${name || `第 ${sessionIndex + 1} 餐`}缺少餐厅名称`, 'MEAL_RESTAURANT_REQUIRED');
      const mealDate = /^\d{4}-\d{2}-\d{2}/.test(mealAt) ? mealAt.slice(0, 10) : '';
      if (!mealDate || mealDate < project.starts_on || mealDate > project.ends_on || Number.isNaN(Date.parse(mealAt))) fieldError(`${prefix}.mealAt`, `${name || `第 ${sessionIndex + 1} 餐`}用餐时间必须落在项目日期范围内`, 'MEAL_DATE_INVALID');
      if (!Number.isInteger(seatsPerTable) || seatsPerTable <= 0) fieldError(`${prefix}.seatsPerTable`, '每桌标准人数必须是正整数', 'MEAL_SEATS_INVALID');
      const overrides = (Array.isArray(item.overrides) ? item.overrides : []).map((row, overrideIndex) => {
        const overridePrefix = `${prefix}.overrides.${overrideIndex}`; const sourceType = requiredText(row.sourceType ?? row.source_type); const sourceId = requiredText(row.sourceId ?? row.source_id); const differenceCount = Number(row.differenceCount ?? row.difference_count); const reason = requiredText(row.reason);
        const source = mealSourceRows({ classes, staff }).find((candidate) => candidate.sourceType === sourceType && candidate.sourceId === sourceId);
        if (!source || !sourceKeys.has(`${sourceType}|${sourceId}`)) fieldError(`${overridePrefix}.sourceId`, '单餐差异来源不属于当前项目', 'MEAL_OVERRIDE_SOURCE_INVALID');
        if (!Number.isInteger(differenceCount) || differenceCount === 0 || source && source.defaultCount + differenceCount < 0) fieldError(`${overridePrefix}.differenceCount`, '单餐差异必须是非零整数，且调整后人数不能小于 0', 'MEAL_OVERRIDE_COUNT_INVALID');
        if (!reason) fieldError(`${overridePrefix}.reason`, '单餐参加人数变化必须填写原因', 'MEAL_OVERRIDE_REASON_REQUIRED');
        return { sourceType, sourceId, differenceCount, reason };
      });
      const tableNumbers = new Set();
      const tables = (Array.isArray(item.tables) ? item.tables : []).map((table, tableIndex) => {
        const tableField = `${prefix}.tables.${tableIndex}`; const tableId = requiredText(table.id) || undefined; const tableNumber = requiredText(table.tableNumber ?? table.table_number);
        if (tableId && tableIds.has(tableId)) fieldError(`${tableField}.id`, '餐桌记录编号重复', 'DUPLICATE_MEAL_ROW_ID');
        if (tableId) { tableIds.add(tableId); const owner = repository.mealRowProject(tableId); if (owner && owner !== projectId) fieldError(`${tableField}.id`, '餐桌不属于当前项目', 'MEAL_ROW_NOT_IN_PROJECT'); }
        if (!tableNumber) fieldError(`${tableField}.tableNumber`, `${name || `第 ${sessionIndex + 1} 餐`}存在空桌号`, 'MEAL_TABLE_NUMBER_REQUIRED');
        if (tableNumber && tableNumbers.has(tableNumber)) fieldError(`${tableField}.tableNumber`, `${name || `第 ${sessionIndex + 1} 餐`}桌号“${tableNumber}”重复`, 'DUPLICATE_MEAL_TABLE_NUMBER'); tableNumbers.add(tableNumber);
        const allocations = (Array.isArray(table.allocations) ? table.allocations : []).map((row, allocationIndex) => {
          const allocationPrefix = `${tableField}.allocations.${allocationIndex}`; const classId = requiredText(row.classId ?? row.class_id) || undefined; const role = requiredText(row.role); const peopleCount = Number(row.peopleCount ?? row.people_count); const sharedTableReason = requiredText(row.sharedTableReason ?? row.shared_table_reason);
          if (!['学生','老师','导游','司机','摄影师','其他'].includes(role)) fieldError(`${allocationPrefix}.role`, '就座角色无效', 'MEAL_ROLE_INVALID');
          if (!Number.isInteger(peopleCount) || peopleCount <= 0) fieldError(`${allocationPrefix}.peopleCount`, '就座人数必须是正整数', 'MEAL_COUNT_INVALID');
          if (role === '学生' && (!classId || !classIds.has(classId))) fieldError(`${allocationPrefix}.classId`, '学生就座必须选择当前项目班级', 'MEAL_CLASS_REQUIRED');
          if (role !== '学生' && classId) fieldError(`${allocationPrefix}.classId`, '工作人员就座按角色汇总，不关联班级', 'MEAL_STAFF_CLASS_INVALID');
          return { id: requiredText(row.id) || undefined, classId, role, peopleCount, sharedTableReason };
        });
        const studentRows = allocations.filter((row) => row.role === '学生');
        if (new Set(studentRows.map((row) => row.classId)).size > 1 && studentRows.some((row) => !row.sharedTableReason)) fieldError(`${tableField}.allocations`, `${tableNumber || '餐桌'}存在跨班拼桌，必须填写说明`, 'SHARED_MEAL_REASON_REQUIRED');
        return { id: tableId, tableNumber, notes: requiredText(table.notes), allocations };
      });
      if (!allowEmptyTables && !tables.length) fieldError(`${prefix}.tables`, `${name || `第 ${sessionIndex + 1} 餐`}至少需要一张餐桌`, 'MEAL_TABLES_REQUIRED');
      return { id, name, restaurantName, mealAt, seatsPerTable, tablePrefix, notes: requiredText(item.notes), overrides, tables };
    });
    return { value: sessions, errors };
  }

  function normalizeProject(input, previous = null) {
    const schoolId = requiredText(input.schoolId ?? previous?.school_id);
    const school = schoolRepository.getById(schoolId);
    if (!school) throw Object.assign(new Error('学校不存在'), { code: 'SCHOOL_NOT_FOUND' });
    const startsOn = requiredText(input.startsOn ?? previous?.starts_on);
    const endsOn = requiredText(input.endsOn ?? previous?.ends_on);
    const grade = requiredText(input.grade ?? previous?.grade);
    const destination = requiredText(input.destination ?? previous?.destination);
    if (!grade || !destination || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) throw Object.assign(new Error('学校、年级、目的地和起止日期为必填项'), { code: 'PROJECT_FIELDS_REQUIRED' });
    if (endsOn < startsOn) throw Object.assign(new Error('结束日期不能早于开始日期'), { code: 'PROJECT_DATE_INVALID' });
    const needsLodging = Boolean(input.needsLodging ?? previous?.needs_lodging);
    if (needsLodging && startsOn === endsOn) throw Object.assign(new Error('一日游不能启用住宿'), { code: 'DAY_TRIP_LODGING_NOT_ALLOWED' });
    const includesMeals = Boolean(input.includesMeals ?? previous?.includes_meals);
    const mealCount = includesMeals ? Number(input.mealCount ?? previous?.meal_count ?? 0) : 0;
    if (includesMeals && (!Number.isInteger(mealCount) || mealCount <= 0)) throw Object.assign(new Error('含餐项目必须填写正整数餐次数'), { code: 'MEAL_COUNT_REQUIRED' });
    const defaultContact = school.contacts?.find((x) => x.isDefault) || null;
    return {
      schoolId, grade, destination, startsOn, endsOn, meetingPlace: requiredText(input.meetingPlace ?? previous?.meeting_place),
      meetingAt: input.meetingAt ?? previous?.meeting_at ?? null, itinerary: requiredText(input.itinerary ?? previous?.itinerary),
      schoolLeadName: requiredText(input.schoolLeadName ?? previous?.school_lead_name ?? defaultContact?.name),
      schoolLeadPhone: requiredText(input.schoolLeadPhone ?? previous?.school_lead_phone ?? defaultContact?.phone),
      needsLodging, includesMeals, mealCount, specialNotes: requiredText(input.specialNotes ?? previous?.special_notes), status: previous?.status || '资料待补充'
    };
  }

  function createProject(input = {}) {
    try {
      const value = normalizeProject(input);
      const data = runInTransaction(db, () => {
        const created = repository.insertProject({ id: input.id, ...value }, clock());
        repository.touchSchool(value.schoolId, clock());
        log(created.id, '项目', created.id, '新建项目并带入学校默认联系人副本');
        return created;
      });
      return success(data);
    } catch (error) { return caught(error); }
  }

  function updateProject(id, input = {}) {
    const previous = getProject(id);
    if (!previous) return failure('NOT_FOUND', '项目不存在');
    try {
      const value = normalizeProject(input, previous);
      const referenceCounts = repository.counts(id);
      const hasLodging = referenceCounts.rooms > 0;
      const hasMeals = referenceCounts.meals > 0;
      const clearImpact = {
        lodgingRows: previous.needs_lodging && !value.needsLodging ? referenceCounts.rooms : 0,
        mealSessions: previous.includes_meals && !value.includesMeals ? referenceCounts.meals : 0
      };
      if ((clearImpact.lodgingRows || clearImpact.mealSessions) && input.confirmConditionalClear !== true) {
        const messages = [];
        if (clearImpact.lodgingRows) messages.push(`关闭住宿将清理 ${clearImpact.lodgingRows} 条住宿记录`);
        if (clearImpact.mealSessions) messages.push(`关闭用餐将清理 ${clearImpact.mealSessions} 个餐次`);
        return failure('CONDITIONAL_CLEAR_CONFIRMATION_REQUIRED', `${messages.join('；')}，需要二次确认`, clearImpact);
      }
      const data = runInTransaction(db, () => {
        if (!value.needsLodging && hasLodging) repository.replaceLodging(id, [], clock());
        if (!value.includesMeals && hasMeals) repository.replaceMeals(id, [], clock());
        repository.updateProject(id, value, clock());
        repository.touchProject(id, clock());
        calculate(id);
        log(id, '项目', id, '更新项目资料与条件模块');
        return getProject(id);
      });
      return success(data);
    } catch (error) { return caught(error); }
  }

  function listProjects(options = {}) {
    const statuses = Array.isArray(options.statuses) ? [...new Set(options.statuses.filter((status) => projectStatuses.has(status)))] : [];
    const startsFrom = requiredText(options.startsFrom);
    const startsTo = requiredText(options.startsTo);
    if ((startsFrom && !datePattern.test(startsFrom)) || (startsTo && !datePattern.test(startsTo)) || (startsFrom && startsTo && startsTo < startsFrom)) return failure('PROJECT_FILTER_INVALID', '出团日期筛选范围不正确');
    return success(repository.projects({ query: requiredText(options.query), startsFrom, startsTo, statuses, includeEnded: Boolean(options.includeEnded), limit: options.limit, offset: options.offset }));
  }

  function endProject(id, input = {}) {
    const previous = getProject(id);
    if (!previous) return failure('NOT_FOUND', '项目不存在');
    if (input.confirmed !== true) return failure('PROJECT_END_CONFIRMATION_REQUIRED', '结束项目需要负责人再次确认');
    if (previous.status === '已结束') return success(previous);
    try {
      return success(runInTransaction(db, () => {
        const ended = repository.setProjectStatus(id, '已结束', clock());
        log(id, '项目状态', id, `项目由“${previous.status}”变更为“已结束”`);
        return ended;
      }));
    } catch (error) { return caught(error); }
  }

  function removeProject(id, input = {}) {
    if (!getProject(id)) return failure('NOT_FOUND', '项目不存在');
    if (input.confirmed !== true) return failure('PROJECT_DELETE_CONFIRMATION_REQUIRED', '删除误建项目需要负责人再次确认');
    const references = repository.projectReferences(id);
    const total = Object.values(references).reduce((sum, count) => sum + count, 0);
    if (total) return failure('PROJECT_IN_USE', '项目已有业务、导入或导出记录，不能永久删除；请改为结束项目', { references });
    try {
      return success(runInTransaction(db, () => {
        repository.removeProject(id);
        log(null, '项目', id, '删除无业务引用的误建项目');
        return { id, removed: true };
      }));
    } catch (error) { return caught(error); }
  }

  function savePeople(projectId, input = {}) {
    const project = getProject(projectId);
    if (!project) return failure('NOT_FOUND', '项目不存在');
    const checked = validatePeopleInput(project, input);
    if (checked.errors.length) return failure(checked.errors[0].code, '班级与随团人员资料未通过校验', { fields: checked.errors });
    for (const [classIndex, item] of checked.value.classes.entries()) {
      if (item.id && repository.classProject(item.id) && repository.classProject(item.id) !== projectId) return failure('CLASS_NOT_IN_PROJECT', '班级记录不属于当前项目', { fields: [{ field: `classes.${classIndex}.id`, message: '班级记录不属于当前项目' }] });
      for (const [teacherIndex, teacher] of item.teachers.entries()) {
        const owner = teacher.id ? repository.teacherOwner(teacher.id) : null;
        if (owner && owner.class_id !== item.id) return failure('TEACHER_NOT_IN_CLASS', '老师记录不属于当前班级', { fields: [{ field: `classes.${classIndex}.teachers.${teacherIndex}.id`, message: '老师记录不属于当前班级' }] });
      }
    }
    for (const [index, item] of checked.value.manualStaff.entries()) if (item.id && repository.manualStaffProject(item.id) && repository.manualStaffProject(item.id) !== projectId) return failure('STAFF_NOT_IN_PROJECT', '随团人员汇总记录不属于当前项目', { fields: [{ field: `manualStaff.${index}.id`, message: '随团人员汇总记录不属于当前项目' }] });
    const removalImpacts = repository.classRemovalImpacts(projectId, checked.value.classes.map((item) => item.id).filter(Boolean));
    if (removalImpacts.length) return failure('CLASS_IN_USE', '有班级已被下游安排引用，不能直接删除', { classes: removalImpacts });
    try {
      const data = runInTransaction(db, () => {
        repository.replacePeople(projectId, checked.value.classes, checked.value.manualStaff, clock());
        repository.touchProject(projectId, clock()); calculate(projectId); log(projectId, '班级与人员', projectId, `保存 ${checked.value.classes.length} 个班级`);
        return summary(projectId);
      });
      return success(data);
    } catch (error) { return caught(error); }
  }

  function createGuide(input = {}) {
    if (!requiredText(input.name) || !requiredText(input.workPhone)) return failure('GUIDE_FIELDS_REQUIRED', '导游姓名和工作电话不能为空');
    try {
      return success(runInTransaction(db, () => {
        const guide = repository.createGuide(input, clock());
        for (const document of input.documents || []) repository.upsertGuideDocument(guide.id, document, clock());
        log(null, '导游档案', guide.id, '新增导游基础档案'); return guide;
      }));
    } catch (error) { return caught(error); }
  }

  function recruit(projectId, input = {}) {
    if (!getProject(projectId)) return failure('NOT_FOUND', '项目不存在');
    if (!requiredText(input.rawText) || !(input.entries || []).length) return failure('RECRUITMENT_REQUIRED', '接龙原文和条目不能为空');
    try { return success(runInTransaction(db, () => {
      const batch = repository.createRecruitment(projectId, input.rawText, input.entries, clock()); repository.touchProject(projectId, clock()); calculate(projectId);
      log(projectId, '导游接龙', batch.id, `保存 ${batch.rows.length} 条接龙并完成精确匹配`); return batch;
    })); } catch (error) { return caught(error); }
  }

  function recruitmentContext(projectId) {
    const project = getProject(projectId);
    if (!project) return failure('NOT_FOUND', '项目不存在');
    const classes = repository.classes(projectId);
    const requiredGuides = classes.reduce((sum, item) => sum + Number(item.guide_required || 0), 0);
    return success({ project, requiredGuides, classCount: classes.length, batches: repository.recruitmentBatches(projectId) });
  }

  function recruitmentNotice(projectId, input = {}) {
    const context = recruitmentContext(projectId);
    if (!context.ok) return context;
    const { project, requiredGuides } = context.data;
    const guideCount = Number(input.guideCount ?? requiredGuides);
    if (!Number.isInteger(guideCount) || guideCount <= 0) return failure('GUIDE_REQUIREMENT_MISSING', '请先在 P05 维护所需导游人数，或填写正整数');
    const dateText = project.starts_on === project.ends_on ? project.starts_on : `${project.starts_on} 至 ${project.ends_on}`;
    const lines = ['【研学导游招募】', `出团日期：${dateText}`, `需要导游：${guideCount} 名`];
    if (input.showSchool) lines.push(`学校：${project.school_name}`);
    if (input.showGrade) lines.push(`年级：${project.grade}`);
    lines.push('', '请按“序号 姓名 手机号”格式接龙：');
    for (let index = 1; index <= guideCount; index += 1) lines.push(`${index}. `);
    const extraNotes = requiredText(input.extraNotes);
    if (extraNotes) lines.push('', `补充说明：${extraNotes}`);
    return success({ text: lines.join('\n'), guideCount, startsOn: project.starts_on, endsOn: project.ends_on, schoolName: project.school_name, grade: project.grade });
  }

  function parseRecruitment(rawText) {
    try {
      const parsed = parseGuideSignupText(rawText);
      return parsed.rows.map((row, index) => ({ batchOrder: index + 1, sourceRowNumber: row.sourceRowNumber,
        sourceSequence: Number(row.raw.接龙序号), name: requiredText(row.raw.导游姓名), phone: requiredText(row.raw.导游手机号), rawLine: row.raw.原始接龙 }));
    } catch (error) { throw Object.assign(error, { publicMessage: error.message }); }
  }

  function previewRecruitment(projectId, input = {}) {
    if (!getProject(projectId)) return failure('NOT_FOUND', '项目不存在');
    if (!requiredText(input.rawText)) return failure('RECRUITMENT_REQUIRED', '请粘贴最终接龙文本');
    try {
      const entries = parseRecruitment(input.rawText).map((entry) => ({ ...entry, ...repository.matchRecruitmentEntry(entry) }));
      return success({ rawText: input.rawText, notes: requiredText(input.notes), entries,
        counts: { total: entries.length, matched: entries.filter((entry) => entry.matchStatus === '已匹配').length, unresolved: entries.filter((entry) => entry.matchStatus !== '已匹配').length } });
    } catch (error) { return caught(error); }
  }

  function confirmRecruitment(projectId, input = {}) {
    const preview = previewRecruitment(projectId, input);
    if (!preview.ok) return preview;
    const decisions = new Map((Array.isArray(input.decisions) ? input.decisions : []).map((item) => [Number(item.batchOrder), item]));
    const unresolved = [];
    const entries = preview.data.entries.map((entry) => {
      if (entry.matchStatus === '已匹配') return entry;
      const decision = decisions.get(entry.batchOrder);
      if (decision?.guideId) {
        const selected = entry.candidates.find((candidate) => candidate.id === decision.guideId);
        if (!selected) { unresolved.push({ batchOrder: entry.batchOrder, message: '所选导游不在本行候选范围内' }); return entry; }
        return { ...entry, guideId: selected.id, matchStatus: '已匹配', manuallyResolved: true };
      }
      if (decision?.acknowledgeUnresolved === true) return { ...entry, manuallyAcknowledged: true };
      unresolved.push({ batchOrder: entry.batchOrder, name: entry.name, matchStatus: entry.matchStatus }); return entry;
    });
    if (unresolved.length) return failure('RECRUITMENT_RESOLUTION_REQUIRED', '仍有接龙行需要负责人明确选择或确认保留待处理', { rows: unresolved });
    try {
      const data = runInTransaction(db, () => {
        const batch = repository.createRecruitment(projectId, input.rawText, entries, clock(), requiredText(input.notes));
        repository.touchProject(projectId, clock()); calculate(projectId);
        log(projectId, '导游接龙', batch.id, `确认 ${batch.rows.length} 条接龙；人工匹配 ${entries.filter((entry) => entry.manuallyResolved).length} 条`);
        return { ...batch, counts: { total: batch.rows.length, matched: batch.rows.filter((row) => row.matchStatus === '已匹配').length, unresolved: batch.rows.filter((row) => row.matchStatus !== '已匹配').length } };
      });
      return success(data);
    } catch (error) { return caught(error); }
  }

  function assignGuide(projectGuideId, input = {}) {
    const pg = repository.projectGuide(projectGuideId);
    if (!pg) return failure('NOT_FOUND', '项目导游不存在');
    if (['已退团', '已替换'].includes(pg.handling_status)) return failure('GUIDE_STATUS_FINAL', '已退团或已替换记录不能重新分班');
    if (!pg.guide_id || pg.match_status !== '已匹配') return failure('GUIDE_NOT_CONFIRMED', '只有已经精确匹配或人工确认的导游才能分班');
    if (!pg.active || pg.cooperation_status !== '可合作') return failure('GUIDE_NOT_COOPERATIVE', '停用或暂停合作导游不能进入新安排');
    const expired = repository.guideExpired(projectGuideId);
    if (expired) return failure('GUIDE_DOCUMENT_EXPIRED', '导游证件不能覆盖完整项目日期，不能安排', expired);
    const conflicts = repository.guideConflicts(projectGuideId);
    if (conflicts.length) return failure('GUIDE_DATE_CONFLICT', '导游在项目完整日期内已有保留安排', { conflicts });
    const classIds = [...new Set(input.classIds || [])];
    if (!classIds.length || classIds.some((id) => repository.classProject(id) !== pg.project_id)) return failure('CLASS_NOT_IN_PROJECT', '所选班级不属于当前项目');
    if (classIds.length > 1 && !requiredText(input.dualClassReason)) return failure('DUAL_CLASS_REASON_REQUIRED', '一个导游带多个班必须填写原因');
    const fullClasses = classIds.filter((id) => {
      const row = repository.classGuideCoverage(pg.project_id).find((item) => item.id === id);
      return row && repository.classAssignmentCount(id, projectGuideId) >= row.guideRequired;
    });
    if (fullClasses.length) return failure('CLASS_GUIDE_CAPACITY_REACHED', '所选班级的导游名额已经满足，请先调整现有分配', { classIds: fullClasses });
    const project = getProject(pg.project_id);
    if (project.needs_lodging && typeof input.needsLodging !== 'boolean') return failure('GUIDE_LODGING_REQUIRED', '住宿项目必须明确导游是否住宿');
    if (project.includes_meals && typeof input.joinsDefaultMeals !== 'boolean') return failure('GUIDE_MEALS_REQUIRED', '含餐项目必须明确导游是否参加默认餐次');
    try { return success(runInTransaction(db, () => {
      repository.assignGuide(projectGuideId, classIds, requiredText(input.dualClassReason), {
        needsLodging: project.needs_lodging ? input.needsLodging : false,
        joinsDefaultMeals: project.includes_meals ? input.joinsDefaultMeals : false
      }, clock()); repository.touchProject(pg.project_id, clock()); calculate(pg.project_id);
      log(pg.project_id, '导游安排', projectGuideId, `安排 ${classIds.length} 个班级`); return summary(pg.project_id);
    })); } catch (error) { return caught(error); }
  }

  function setGuideHandling(projectGuideId, input = {}) {
    const pg = repository.projectGuide(projectGuideId);
    if (!pg) return failure('NOT_FOUND', '项目导游不存在');
    const status = requiredText(input.status);
    if (!['保留', '移出'].includes(status)) return failure('GUIDE_HANDLING_INVALID', '名单处理状态只能改为保留或移出');
    if (['已退团', '已替换'].includes(pg.handling_status)) return failure('GUIDE_STATUS_FINAL', '已退团或已替换记录只能查看历史，不能改回名单');
    if (status === '保留' && (!pg.guide_id || pg.match_status !== '已匹配')) return failure('GUIDE_NOT_CONFIRMED', '未完成档案匹配的接龙行不能保留为正式人选');
    if (status === '移出' && repository.assignmentRows(projectGuideId).length) return failure('GUIDE_ASSIGNED_CANNOT_REMOVE', '已分班导游不能直接移出，请使用记录退团');
    try { return success(runInTransaction(db, () => {
      repository.setGuideHandling(projectGuideId, status, clock()); repository.touchProject(pg.project_id, clock()); calculate(pg.project_id);
      log(pg.project_id, '导游名单', projectGuideId, `名单状态改为“${status}”`); return summary(pg.project_id);
    })); } catch (error) { return caught(error); }
  }

  function withdrawGuide(projectGuideId, input = {}) {
    const pg = repository.projectGuide(projectGuideId);
    if (!pg) return failure('NOT_FOUND', '项目导游不存在');
    if (pg.handling_status !== '保留') return failure('GUIDE_NOT_RETAINED', '只有已保留或已分班导游可以记录退团');
    if (!requiredText(input.reason)) return failure('WITHDRAWAL_REASON_REQUIRED', '记录退团必须填写原因');
    const replacement = input.replacementProjectGuideId ? repository.projectGuide(input.replacementProjectGuideId) : null;
    if (input.replacementProjectGuideId && (!replacement || replacement.project_id !== pg.project_id || replacement.id === pg.id)) return failure('REPLACEMENT_NOT_IN_PROJECT', '替换人选必须来自当前项目的其他接龙记录');
    try { return success(runInTransaction(db, () => {
      repository.withdrawGuide(projectGuideId, requiredText(input.reason), input.replacementProjectGuideId || null, clock());
      repository.touchProject(pg.project_id, clock()); calculate(pg.project_id);
      log(pg.project_id, '导游退团', projectGuideId, '记录退团、释放班级并重新计算缺口'); return summary(pg.project_id);
    })); } catch (error) { return caught(error); }
  }

  function replaceGuide(projectGuideId, input = {}) {
    const original = repository.projectGuide(projectGuideId);
    const replacementId = requiredText(input.replacementProjectGuideId);
    const replacement = replacementId ? repository.projectGuide(replacementId) : null;
    const reason = requiredText(input.reason);
    if (!original) return failure('NOT_FOUND', '原项目导游不存在');
    if (original.handling_status !== '保留') return failure('GUIDE_NOT_RETAINED', '只有已分班导游可以执行替换');
    const assignments = repository.assignmentRows(projectGuideId);
    if (!assignments.length) return failure('GUIDE_NOT_ASSIGNED', '原导游尚未分班，请直接调整名单状态');
    if (!reason) return failure('WITHDRAWAL_REASON_REQUIRED', '更换导游必须填写退团或更换原因');
    if (!replacement || replacement.project_id !== original.project_id || replacement.id === original.id) return failure('REPLACEMENT_NOT_IN_PROJECT', '替换人选必须来自当前项目的其他接龙记录');
    if (['已退团', '已替换'].includes(replacement.handling_status) || !replacement.guide_id || replacement.match_status !== '已匹配') return failure('REPLACEMENT_NOT_ELIGIBLE', '替换人选必须已匹配且未退团');
    if (!replacement.active || replacement.cooperation_status !== '可合作') return failure('GUIDE_NOT_COOPERATIVE', '替换人选已停用或暂停合作');
    const expired = repository.guideExpired(replacementId);
    if (expired) return failure('GUIDE_DOCUMENT_EXPIRED', '替换人选的证件不能覆盖完整项目日期', expired);
    const conflicts = repository.guideConflicts(replacementId);
    if (conflicts.length) return failure('GUIDE_DATE_CONFLICT', '替换人选在项目完整日期内已有保留安排', { conflicts });
    if (repository.assignmentRows(replacementId).length) return failure('REPLACEMENT_ALREADY_ASSIGNED', '替换人选已经分班，请选择尚未分班的人选');
    try { return success(runInTransaction(db, () => {
      repository.withdrawGuide(projectGuideId, reason, replacementId, clock(), '已替换');
      repository.assignGuide(replacementId, assignments.map((item) => item.classId), original.dual_class_reason, {
        needsLodging: Boolean(original.needs_lodging), joinsDefaultMeals: Boolean(original.joins_default_meals)
      }, clock());
      repository.touchProject(original.project_id, clock()); calculate(original.project_id);
      log(original.project_id, '导游替换', projectGuideId, `替换关系已建立，班级分配转移到 ${replacementId}`); return summary(original.project_id);
    })); } catch (error) { return caught(error); }
  }

  function suggestTransport(projectId, input = {}) {
    const project = getProject(projectId);
    if (!project) return failure('NOT_FOUND', '项目不存在');
    const sourceVehicles = Array.isArray(input.vehicles) ? input.vehicles : [];
    if (!sourceVehicles.length) return failure('VEHICLES_REQUIRED', '请先新增或导入车辆，再生成安排建议');
    const checked = validateTransportInput(projectId, project, sourceVehicles.map((vehicle) => ({ ...vehicle, allocations: [] })));
    if (checked.errors.length) return failure(checked.errors[0].code, '车辆资料未通过校验，暂不能生成建议', { fields: checked.errors });
    const current = repository.transport(projectId);
    const suggestion = buildTransportSuggestion({ classes: repository.classes(projectId), guides: repository.guideAssignments(projectId), vehicles: checked.value });
    return success({ ...suggestion, replacesExisting: current.some((vehicle) => vehicle.allocations.length), impact: {
      currentVehicles: current.length, currentAllocationRows: current.reduce((sum, vehicle) => sum + vehicle.allocations.length, 0), proposedAllocationRows: suggestion.vehicles.reduce((sum, vehicle) => sum + vehicle.allocations.length, 0)
    } });
  }

  function saveTransport(projectId, vehicles = []) {
    const project = getProject(projectId);
    if (!project) return failure('NOT_FOUND', '项目不存在');
    const checked = validateTransportInput(projectId, project, vehicles);
    if (checked.errors.length) return failure(checked.errors[0].code, '乘车安排未通过校验', { fields: checked.errors });
    try { return success(runInTransaction(db, () => {
      repository.replaceTransport(projectId, checked.value, clock()); repository.touchProject(projectId, clock()); calculate(projectId);
      log(projectId, '乘车安排', projectId, `保存 ${checked.value.length} 辆项目车辆并重新校验容量`); return summary(projectId);
    })); } catch (error) { return caught(error); }
  }

  function suggestLodging(projectId, input = {}) {
    const project = getProject(projectId);
    if (!project) return failure('NOT_FOUND', '项目不存在');
    if (!project.needs_lodging || project.starts_on === project.ends_on) return failure('LODGING_NOT_APPLICABLE', '该项目不需要住宿，不能生成分房建议');
    const sourceRooms = Array.isArray(input.rooms) ? input.rooms : [];
    if (!sourceRooms.length) return failure('ROOMS_REQUIRED', '请先新增或导入房间，再生成分房建议');
    const checked = validateLodgingInput(projectId, project, sourceRooms.map((room) => ({ ...room, allocations: [] })));
    if (checked.errors.length) return failure(checked.errors[0].code, '房间资料未通过校验，暂不能生成建议', { fields: checked.errors });
    const nights = lodgingNights(project.starts_on, project.ends_on); const roomDates = new Set(checked.value.map((room) => room.checkInOn)); const missingNights = nights.filter((date) => !roomDates.has(date));
    if (missingNights.length) return failure('LODGING_NIGHTS_MISSING', `缺少 ${missingNights.join('、')} 的房间资料`, { missingNights });
    const sources = lodgingSourceRows({ classes: repository.classes(projectId), staff: repository.staffSources(projectId) });
    const invalidSources = sources.filter((row) => row.peopleCount > 0 && !['男', '女'].includes(row.gender));
    if (invalidSources.length) return failure('LODGING_SOURCE_GENDER_MISSING', '住宿人员来源存在未填写性别，必须回到 P05、P07 或 P08 修正', { sources: invalidSources });
    const current = repository.lodging(projectId); const suggestion = buildLodgingSuggestion({ classes: repository.classes(projectId), staff: repository.staffSources(projectId), rooms: checked.value });
    return success({ ...suggestion, replacesExisting: current.some((room) => room.allocations.length), impact: { currentRooms: current.length,
      currentAllocationRows: current.reduce((sum, room) => sum + room.allocations.length, 0), proposedAllocationRows: suggestion.rooms.reduce((sum, room) => sum + room.allocations.length, 0) } });
  }

  function saveLodging(projectId, rooms = []) {
    const project = getProject(projectId);
    if (!project) return failure('NOT_FOUND', '项目不存在');
    if (!project.needs_lodging && rooms.length) return failure('LODGING_NOT_APPLICABLE', '该项目不需要住宿，不能创建住宿记录');
    const checked = validateLodgingInput(projectId, project, rooms);
    if (checked.errors.length) return failure(checked.errors[0].code, '住宿安排未通过字段校验', { fields: checked.errors });
    try { return success(runInTransaction(db, () => {
      repository.replaceLodging(projectId, checked.value, clock()); repository.touchProject(projectId, clock()); calculate(projectId);
      log(projectId, '住宿安排', projectId, `保存 ${checked.value.length} 间房`); return summary(projectId);
    })); } catch (error) { return caught(error); }
  }

  function suggestMeals(projectId, input = {}) {
    const project = getProject(projectId);
    if (!project) return failure('NOT_FOUND', '项目不存在');
    if (!project.includes_meals) return failure('MEALS_NOT_APPLICABLE', '该项目不含餐，不能生成用餐建议');
    const checked = validateMealInput(projectId, project, input.sessions || [], { allowEmptyTables: true });
    if (checked.errors.length) return failure(checked.errors[0].code, '餐次资料未通过校验，暂不能生成建议', { fields: checked.errors });
    if (checked.value.length !== project.meal_count) return failure('MEAL_SESSION_MISMATCH', `项目应建立 ${project.meal_count} 个餐次，当前 ${checked.value.length} 个`);
    const suggestion = buildMealSuggestion({ classes: repository.classes(projectId), staff: repository.staffSources(projectId), sessions: checked.value, includeStaff: input.includeStaff === true });
    const current = repository.meals(projectId);
    return success({ ...suggestion, includeStaff: input.includeStaff === true, replacesExisting: current.some((session) => session.tables?.some((table) => table.allocations.length)), impact: { currentSessions: current.length, currentAllocationRows: current.reduce((sum, session) => sum + session.tables.reduce((n, table) => n + table.allocations.length, 0), 0), proposedAllocationRows: suggestion.sessions.reduce((sum, session) => sum + session.tables.reduce((n, table) => n + table.allocations.length, 0), 0) } });
  }

  function saveMeals(projectId, sessions = []) {
    const project = getProject(projectId);
    if (!project) return failure('NOT_FOUND', '项目不存在');
    if (!project.includes_meals && sessions.length) return failure('MEALS_NOT_APPLICABLE', '该项目不含餐，不能创建用餐记录');
    const checked = validateMealInput(projectId, project, sessions);
    if (checked.errors.length) return failure(checked.errors[0].code, '用餐安排未通过字段校验', { fields: checked.errors });
    try { return success(runInTransaction(db, () => {
      repository.replaceMeals(projectId, checked.value, clock()); repository.touchProject(projectId, clock()); calculate(projectId);
      log(projectId, '用餐安排', projectId, `保存 ${checked.value.length} 个餐次并重新校验就座人数`); return summary(projectId);
    })); } catch (error) { return caught(error); }
  }

  function calculate(projectId) {
    const project = getProject(projectId);
    if (!project) throw Object.assign(new Error('项目不存在'), { code: 'NOT_FOUND' });
    const classes = repository.classes(projectId);
    const staff = repository.staffSources(projectId);
    const guides = repository.guideAssignments(projectId);
    const issues = [];
    const students = classes.reduce((n, x) => n + x.student_total, 0);
    const arrangedGuides = guides.filter((x) => x.handling_status === '保留' && x.assignment_count > 0).length;
    if (!requiredText(project.meeting_place)) issues.push(reminderIssue(projectId, '项目', 'MEETING_PLACE_MISSING', 'project', projectId, '集合地点尚未填写'));
    if (!classes.length) issues.push(issue(projectId, '人员', 'CLASSES_MISSING', 'project', projectId, '项目尚未建立班级资料'));
    for (const row of repository.classGuideCoverage(projectId)) if (row.assignedCount < row.guideRequired) {
      issues.push(issue(projectId, '导游', 'GUIDE_GAP', 'class', row.id, `${row.name} 还缺 ${row.guideRequired - row.assignedCount} 名导游`));
    }
    for (const row of guides.filter((item) => item.handling_status === '保留' && item.assignment_count > 0)) {
      const conflict = row.conflicts[0];
      if (conflict) issues.push(issue(projectId, '导游', 'GUIDE_DATE_CONFLICT', 'project_guide', row.id, `${row.guide_name || row.source_name} 与 ${conflict.schoolName} ${conflict.grade} 项目在 ${conflict.overlapStartsOn} 至 ${conflict.overlapEndsOn} 冲突`));
      if (!row.active || row.cooperation_status !== '可合作') issues.push(issue(projectId, '导游', 'GUIDE_NOT_COOPERATIVE', 'project_guide', row.id, `${row.guide_name || row.source_name} 当前不可合作`));
      if (row.documentState.expiredCount) issues.push(issue(projectId, '导游', 'GUIDE_DOCUMENT_EXPIRED', 'project_guide', row.id, `${row.guide_name || row.source_name} 的证件不能覆盖完整项目日期`));
    }

    const vehicles = repository.transport(projectId);
    const transportByRole = Object.fromEntries(repository.transportTotals(projectId).map((x) => [x.role, x.count]));
    const expectedTransport = students + classes.reduce((n, x) => n + x.teachers_on_vehicle, 0) + arrangedGuides;
    if (!vehicles.length) issues.push(issue(projectId, '乘车', 'VEHICLES_MISSING', 'project', projectId, '项目尚未建立排车表'));
    for (const row of vehicles) {
      if (row.allocated > row.capacity - row.safety_reserve) issues.push(issue(projectId, '乘车', 'VEHICLE_OVERLOAD', 'transport_row', row.id, `${row.vehicle_label} 超载 ${row.allocated - (row.capacity - row.safety_reserve)} 人`));
      const missingFields = [['fleet_name', '车队名称'], ['vehicle_model', '车辆型号'], ['plate_number', '车牌号'], ['driver_name', '司机姓名'], ['driver_phone', '司机电话']].filter(([key]) => !requiredText(row[key])).map(([, label]) => label);
      if (missingFields.length) issues.push(issue(projectId, '乘车', 'TRANSPORT_EXPORT_FIELDS_MISSING', 'transport_row', row.id, `${row.vehicle_label} 缺少导出必填字段：${missingFields.join('、')}`));
      if (project.needs_lodging && row.driver_needs_lodging && row.driver_gender === '未填写') issues.push(issue(projectId, '乘车', 'DRIVER_GENDER_REQUIRED', 'transport_row', row.id, `${row.vehicle_label} 的住宿司机必须填写性别`));
    }
    for (const classRow of classes) {
      const allocations = vehicles.flatMap((vehicle) => vehicle.allocations).filter((row) => row.class_id === classRow.id);
      const studentRows = allocations.filter((row) => row.role === '学生');
      const studentCount = studentRows.reduce((sum, row) => sum + row.people_count, 0);
      const boysCount = studentRows.reduce((sum, row) => sum + row.boys_count, 0); const girlsCount = studentRows.reduce((sum, row) => sum + row.girls_count, 0);
      const teacherCount = allocations.filter((row) => row.role === '老师').reduce((sum, row) => sum + row.people_count, 0);
      if (studentCount !== classRow.student_total) issues.push(issue(projectId, '乘车', 'TRANSPORT_CLASS_STUDENTS_MISMATCH', 'class', classRow.id, `${classRow.name} 学生应安排 ${classRow.student_total} 人，当前 ${studentCount} 人`));
      if (boysCount !== classRow.boys || girlsCount !== classRow.girls) issues.push(issue(projectId, '乘车', 'TRANSPORT_CLASS_GENDER_MISMATCH', 'class', classRow.id, `${classRow.name} 男女生应为 ${classRow.boys}/${classRow.girls}，当前 ${boysCount}/${girlsCount}`));
      if (teacherCount !== classRow.teachers_on_vehicle) issues.push(issue(projectId, '乘车', 'TRANSPORT_CLASS_TEACHERS_MISMATCH', 'class', classRow.id, `${classRow.name} 随车老师应为 ${classRow.teachers_on_vehicle} 人，当前 ${teacherCount} 人`));
    }
    const allocatedGuideIds = new Set(vehicles.flatMap((vehicle) => vehicle.allocations).filter((row) => row.role === '导游' && row.project_guide_id).map((row) => row.project_guide_id));
    if (allocatedGuideIds.size !== arrangedGuides) issues.push(issue(projectId, '乘车', 'TRANSPORT_GUIDES_MISMATCH', 'project', projectId, `已安排导游 ${arrangedGuides} 人，实际乘车 ${allocatedGuideIds.size} 人`));
    const actualTransport = Object.values(transportByRole).reduce((n, value) => n + value, 0);
    if (vehicles.length && actualTransport !== expectedTransport) issues.push(issue(projectId, '乘车', 'TRANSPORT_PEOPLE_MISMATCH', 'project', projectId, `乘车应为 ${expectedTransport} 人，当前安排 ${actualTransport} 人`));

    const lodgingRows = repository.lodging(projectId);
    if (!project.needs_lodging && lodgingRows.length) issues.push(issue(projectId, '住宿', 'LODGING_NOT_APPLICABLE', 'project', projectId, '不住宿项目存在住宿记录'));
    if (project.needs_lodging) {
      const sources = lodgingSourceRows({ classes, staff }); const expected = sources.reduce((n, x) => n + x.peopleCount, 0); const nights = lodgingNights(project.starts_on, project.ends_on);
      const totalsByDate = repository.lodgingTotalsByDate(projectId);
      for (const source of sources.filter((row) => row.peopleCount > 0 && !['男', '女'].includes(row.gender))) issues.push(issue(projectId, '住宿', 'LODGING_SOURCE_GENDER_MISSING', 'project', projectId, `${source.role}住宿人员存在未填写性别，需回到来源页修正`));
      if (!lodgingRows.length) issues.push(issue(projectId, '住宿', 'ROOMS_MISSING', 'project', projectId, '住宿项目尚未建立房间'));
      for (const date of nights) {
        const dateRooms = lodgingRows.filter((room) => room.check_in_on === date); const dateActual = totalsByDate.filter((row) => row.checkInOn === date).reduce((sum, row) => sum + row.count, 0);
        const dateCapacity = dateRooms.reduce((sum, room) => sum + room.capacity, 0);
        if (!dateRooms.length) issues.push(issue(projectId, '住宿', 'LODGING_NIGHT_MISSING', 'lodging_date', date, `${date} 尚未建立住宿房间`));
        if (dateRooms.length && dateCapacity < expected) issues.push(issue(projectId, '住宿', 'LODGING_CAPACITY_SHORTAGE', 'lodging_date', date, `${date} 需要住宿 ${expected} 人，房间总容量仅 ${dateCapacity}，缺 ${expected - dateCapacity} 个床位`));
        if (dateRooms.length && dateActual !== expected) issues.push(issue(projectId, '住宿', 'LODGING_PEOPLE_MISMATCH', 'lodging_date', date, `${date} 住宿应安排 ${expected} 人，当前 ${dateActual} 人`));
        for (const source of sources.filter((row) => ['男', '女'].includes(row.gender))) {
          const actual = totalsByDate.filter((row) => row.checkInOn === date && row.role === source.role && row.gender === source.gender && (source.role !== '学生' || row.classId === source.classId)).reduce((sum, row) => sum + row.count, 0);
          if (actual !== source.peopleCount) {
            const sourceId = source.role === '学生' ? `${date}-${source.classId}-${source.gender}` : `${date}-${source.role}-${source.gender}`;
            issues.push(issue(projectId, '住宿', source.role === '学生' ? 'LODGING_CLASS_MISMATCH' : 'LODGING_STAFF_MISMATCH', 'lodging_source', sourceId, `${date} ${source.className ? `${source.className}班` : ''}${source.gender}${source.role}应安排 ${source.peopleCount} 人，当前 ${actual} 人`));
          }
        }
      }
      for (const row of lodgingRows) {
        if (row.allocated > row.capacity) issues.push(issue(projectId, '住宿', 'ROOM_OVERLOAD', 'lodging_row', row.id, `${row.room_number} 房超员`));
        if (row.genders > 1 || row.gender_mismatch > 0) issues.push(issue(projectId, '住宿', 'ROOM_GENDER_MISMATCH', 'lodging_row', row.id, `${row.room_number} 房存在性别规则冲突`));
        const missingFields = [['lodging_name', '酒店名称'], ['building', '楼栋'], ['floor_label', '楼层'], ['room_number', '房号']].filter(([key]) => !requiredText(row[key])).map(([, label]) => label);
        if (missingFields.length) issues.push(issue(projectId, '住宿', 'LODGING_EXPORT_FIELDS_MISSING', 'lodging_row', row.id, `${row.room_number || '未命名房间'} 缺少字段：${missingFields.join('、')}`));
        const studentRows = row.allocations.filter((allocation) => allocation.role === '学生' && allocation.class_id); const classIds = new Set(studentRows.map((allocation) => allocation.class_id));
        if (classIds.size > 1) {
          if (studentRows.some((allocation) => !requiredText(allocation.cross_class_reason))) issues.push(issue(projectId, '住宿', 'CROSS_CLASS_REASON_REQUIRED', 'lodging_row', row.id, `${row.room_number} 房跨班合住但未填写原因`));
          else issues.push(warningIssue(projectId, '住宿', 'CROSS_CLASS_ROOM', 'lodging_row', row.id, `${row.room_number} 房为同性交叉班级合住，请核对双方人数和原因`));
        }
      }
    }

    const sessions = repository.meals(projectId);
    if (!project.includes_meals && sessions.length) issues.push(issue(projectId, '用餐', 'MEALS_NOT_APPLICABLE', 'project', projectId, '不含餐项目存在用餐记录'));
    if (project.includes_meals) {
      if (sessions.length !== project.meal_count) issues.push(issue(projectId, '用餐', 'MEAL_SESSION_MISMATCH', 'project', projectId, `应有 ${project.meal_count} 个餐次，当前 ${sessions.length} 个`));
      for (const row of sessions) {
        const mealDate = row.meal_at?.slice(0, 10); const sources = mealSourceRows({ classes, staff, overrides: row.overrides }); const expected = sources.reduce((n, source) => n + source.peopleCount, 0); const capacity = row.actual_tables * row.seats_per_table;
        if (!mealDate || mealDate < project.starts_on || mealDate > project.ends_on) issues.push(issue(projectId, '用餐', 'MEAL_DATE_INVALID', 'meal_session', row.id, `${row.name}用餐时间不在项目日期范围内`));
        if (capacity < expected) issues.push(issue(projectId, '用餐', 'MEAL_CAPACITY_SHORTAGE', 'meal_session', row.id, `${row.name}需要 ${expected} 个座位，当前 ${row.actual_tables} 桌仅 ${capacity} 个座位`));
        if (row.allocated !== expected) issues.push(issue(projectId, '用餐', 'MEAL_PEOPLE_MISMATCH', 'meal_session', row.id, `${row.name} 应安排 ${expected} 人，当前 ${row.allocated} 人`));
        for (const role of ['学生','导游','老师','司机','摄影师','其他']) {
          const roleExpected = sources.filter((source) => source.role === role).reduce((sum, source) => sum + source.peopleCount, 0); const roleActual = row.tables.flatMap((table) => table.allocations).filter((allocation) => allocation.role === role).reduce((sum, allocation) => sum + allocation.people_count, 0);
          if (roleActual !== roleExpected) issues.push(issue(projectId, '用餐', 'MEAL_ROLE_MISMATCH', 'meal_source', `${row.id}-${role}`, `${row.name}${role}应安排 ${roleExpected} 人，当前 ${roleActual} 人`));
        }
      }
      for (const row of repository.mealTables(projectId)) if (row.allocated > row.seats_per_table) issues.push(issue(projectId, '用餐', 'MEAL_TABLE_OVERLOAD', 'meal_row', row.id, `${row.table_number} 桌超员`));
    }
    repository.syncExceptions(projectId, issues, clock());
    return issues;
  }

  function recalculate(projectId) {
    try { return success(runInTransaction(db, () => {
      calculate(projectId); log(projectId, '异常校验', projectId, '执行全项目重新校验'); return summary(projectId);
    })); } catch (error) { return caught(error); }
  }

  function complete(projectId) {
    try { return runInTransaction(db, () => {
      calculate(projectId);
      const blockers = repository.activeBlockers(projectId);
      if (blockers) {
        log(projectId, '项目状态', projectId, '统一门禁拒绝进入已完成安排', '失败', `仍有 ${blockers} 个阻断异常`);
        return failure('PROJECT_BLOCKED', `项目仍有 ${blockers} 个阻断异常`);
      }
      repository.setProjectStatus(projectId, '已完成安排', clock()); log(projectId, '项目状态', projectId, '通过统一门禁进入已完成安排');
      return success(summary(projectId));
    }); } catch (error) { return caught(error); }
  }

  function listExceptions(filters = {}) {
    const allowedModules = new Set(['项目','人员','导游','乘车','住宿','用餐','导出','证件']);
    const allowedSeverities = new Set(['阻断','警告','提醒']);
    const allowedStatuses = new Set(['待处理','已确认例外','已解决']);
    const normalized = {
      projectId: requiredText(filters.projectId), module: requiredText(filters.module), severity: requiredText(filters.severity), status: requiredText(filters.status),
      limit: filters.limit, offset: filters.offset
    };
    if ((normalized.module && !allowedModules.has(normalized.module)) || (normalized.severity && !allowedSeverities.has(normalized.severity)) || (normalized.status && !allowedStatuses.has(normalized.status))) {
      return failure('EXCEPTION_FILTER_INVALID', '异常筛选条件不正确');
    }
    if (normalized.projectId && !getProject(normalized.projectId)) return failure('NOT_FOUND', '项目不存在');
    const rows = repository.listExceptions(normalized).map((row) => ({ ...row, action_path: exceptionActionPath(row) }));
    const stats = { total: 0, pending: 0, blockers: 0, warnings: 0, reminders: 0, confirmed: 0, resolved: 0 };
    for (const row of repository.exceptionStats(normalized.projectId)) {
      stats.total += row.count;
      if (row.status === '待处理') stats.pending += row.count;
      if (row.status === '待处理' && row.severity === '阻断') stats.blockers += row.count;
      if (row.status === '待处理' && row.severity === '警告') stats.warnings += row.count;
      if (row.status === '待处理' && row.severity === '提醒') stats.reminders += row.count;
      if (row.status === '已确认例外') stats.confirmed += row.count;
      if (row.status === '已解决') stats.resolved += row.count;
    }
    return success({ items: rows, stats });
  }

  function confirmException(exceptionId, input = {}) {
    const reason = requiredText(input.reason);
    if (!reason) return failure('EXCEPTION_REASON_REQUIRED', '确认例外必须填写处理原因');
    if (reason.length > 300) return failure('EXCEPTION_REASON_TOO_LONG', '处理原因不能超过 300 个字');
    try { return runInTransaction(db, () => {
      const existing = repository.exceptionById(exceptionId);
      if (!existing) return failure('NOT_FOUND', '异常记录不存在');
      calculate(existing.project_id);
      const current = repository.exceptionById(exceptionId);
      if (current.severity === '阻断') return failure('BLOCKER_CANNOT_BE_IGNORED', '阻断异常不能确认例外，必须修改源数据');
      if (current.status !== '待处理') return failure('EXCEPTION_NOT_ACTIVE', '该异常当前不是待处理状态');
      const confirmed = repository.confirmException(exceptionId, reason, clock());
      log(current.project_id, '异常确认', exceptionId, `确认${current.severity}例外：${reason}`);
      return success({ ...confirmed, action_path: exceptionActionPath(confirmed) });
    }); } catch (error) { return caught(error); }
  }

  function summary(projectId) {
    const project = getProject(projectId);
    if (!project) return null;
    const classes = repository.classesWithTeachers(projectId); const staff = repository.staffSources(projectId); const guides = repository.guideAssignments(projectId);
    return { project, classes, counts: repository.counts(projectId), students: classes.reduce((n, x) => n + x.student_total, 0),
      boys: classes.reduce((n, x) => n + x.boys, 0), girls: classes.reduce((n, x) => n + x.girls, 0),
      teachers: classes.reduce((n, x) => n + x.teachers.length, 0), requiredGuides: classes.reduce((n, x) => n + x.guide_required, 0),
      teachersRiding: classes.reduce((n, x) => n + x.teachers_on_vehicle, 0), manualStaff: repository.manualStaff(projectId),
      staff, guides, guideCoverage: repository.classGuideCoverage(projectId), arrangedGuides: guides.filter((x) => x.handling_status === '保留' && x.assignment_count > 0).length,
      recruitmentBatches: repository.recruitmentBatches(projectId), transport: repository.transport(projectId), lodging: repository.lodging(projectId), meals: repository.meals(projectId),
      exceptions: repository.exceptions(projectId), exports: repository.exports(projectId) };
  }

  function overview(projectId) {
    const data = summary(projectId);
    return data ? success(buildProjectOverview(data)) : failure('NOT_FOUND', '项目不存在');
  }

  function dashboard() {
    const today = shanghaiDate(clock()); const throughDate = addCalendarDays(today, 7);
    const projectRows = repository.projects({ includeEnded: false, limit: 200 });
    const activeRows = projectRows.filter((row) => row.status !== '已结束' && row.ends_on >= today);
    const overviews = activeRows.map((row) => buildProjectOverview(summary(row.id)));
    const upcomingOverviews = overviews.filter((row) => row.project.starts_on >= today && row.project.starts_on <= throughDate);
    const upcoming = upcomingOverviews.slice(0, 6).map((row) => ({
      id: row.project.id, schoolName: row.project.school_name, grade: row.project.grade, destination: row.project.destination,
      startsOn: row.project.starts_on, endsOn: row.project.ends_on, status: row.project.status, students: row.students,
      vehicles: row.counts.vehicles, arrangedGuides: row.arrangedGuides, guideGap: row.guideGap, progress: row.progress,
      blockers: row.exceptionStats.blockers, next: row.next
    }));
    const allPendingExceptions = repository.listExceptions({ status: '待处理', limit: 500 }).filter((row) => row.project_status !== '已结束');
    const pendingExceptions = allPendingExceptions.slice(0, 8).map((row) => ({ ...row, action_path: exceptionActionPath(row) }));
    const guideGapProjects = overviews.filter((row) => row.guideGap > 0);
    const certificateReminders = repository.certificateReminders(throughDate).map((row) => ({
      ...row, daysRemaining: Math.ceil((new Date(`${row.expiresOn}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000),
      actionPath: `/guides/detail?id=${encodeURIComponent(row.guideId)}`
    }));
    return success({
      asOf: today, through: throughDate, upcoming, pendingExceptions, certificateReminders,
      stats: {
        upcomingProjects: upcomingOverviews.length,
        blockers: allPendingExceptions.filter((row) => row.severity === '阻断').length,
        pendingGuides: guideGapProjects.reduce((sum, row) => sum + row.guideGap, 0),
        pendingGuideProjects: guideGapProjects.length,
        expiringDocuments: certificateReminders.length
      }
    });
  }

  function importBatch(targetType, { projectId, batchId, rows }) {
    const mapped = rows.map((x) => x.mapped);
    if (targetType === 'classes_teachers') {
      const grouped = new Map();
      for (const row of mapped) {
        const item = grouped.get(row.className) || { name: row.className, studentTotal: row.studentTotal, boys: row.boys, girls: row.girls, guideRequired: row.guideRequired || 1, teachers: [] };
        if (row.studentTotal !== item.studentTotal || row.boys !== item.boys || row.girls !== item.girls) throw Object.assign(new Error('同一班级人数不一致'), { code: 'CLASS_IMPORT_CONFLICT' });
        if (row.teacherName) item.teachers.push({ role: row.teacherRole === '班主任' ? '班主任' : '配班老师', name: row.teacherName, phone: row.teacherPhone, gender: ['男', '女'].includes(row.teacherGender) ? row.teacherGender : '未填写', ridesVehicle: row.ridesVehicle !== false, needsLodging: Boolean(row.needsLodging), joinsDefaultMeals: Boolean(row.joinsMeals) });
        grouped.set(row.className, item);
      }
      repository.replacePeople(projectId, [...grouped.values()], [], clock());
    } else if (targetType === 'guide_recruitment') {
      repository.createRecruitment(projectId, `导入批次 ${batchId}`, mapped.map((x) => ({ order: x.sequence, name: x.name, phone: x.phone || '' })), clock());
    } else if (targetType === 'transport') {
      repository.replaceTransport(projectId, mapped.map((x) => ({ vehicleLabel: x.vehicleLabel, fleetName: x.fleetName || '', vehicleModel: x.vehicleModel || '', plateNumber: x.plateNumber || '', capacity: x.capacity, driverName: x.driverName, driverPhone: x.driverPhone, driverGender: ['男', '女'].includes(x.driverGender) ? x.driverGender : '未填写', driverNeedsLodging: Boolean(x.driverNeedsLodging), driverJoinsDefaultMeals: Boolean(x.driverJoinsMeals), notes: x.notes || '', allocations: [] })), clock());
    } else if (targetType === 'lodging') {
      const project = getProject(projectId);
      if (!project.needs_lodging) throw Object.assign(new Error('该项目不需要住宿'), { code: 'LODGING_NOT_APPLICABLE' });
      const rooms = mapped.map((x) => ({ lodgingName: x.lodgingName, checkInOn: x.checkInOn, building: x.building || '', floorLabel: x.floorLabel || '', roomNumber: x.roomNumber, roomType: x.roomType, capacity: x.capacity, genderRule: ['男', '女', '不限'].includes(x.genderRule) ? x.genderRule : '不限', notes: x.notes || '', allocations: [] }));
      const checked = validateLodgingInput(projectId, project, rooms);
      if (checked.errors.length) throw Object.assign(new Error(checked.errors[0].message), { code: checked.errors[0].code });
      repository.replaceLodging(projectId, checked.value, clock()); repository.touchProject(projectId, clock()); calculate(projectId);
    } else if (targetType === 'meals') {
      if (!getProject(projectId).includes_meals) throw Object.assign(new Error('该项目不含餐'), { code: 'MEALS_NOT_APPLICABLE' });
      repository.replaceMeals(projectId, mapped.map((x) => ({ name: x.sessionName, restaurantName: x.restaurantName, mealAt: x.mealAt, seatsPerTable: x.seatsPerTable, notes: x.notes || '', tables: Array.from({ length: x.bookedTables }, (_, index) => ({ tableNumber: String(index + 1), allocations: [] })) })), clock());
    } else throw Object.assign(new Error('未注册正式写入目标'), { code: 'TARGET_NOT_WRITABLE' });
    repository.touchProject(projectId, clock()); calculate(projectId);
  }

  function importWriters() {
    return Object.fromEntries(['classes_teachers', 'guide_recruitment', 'transport', 'lodging', 'meals'].map((key) => [key, (context) => importBatch(key, context)]));
  }

  return Object.freeze({ createProject, updateProject, listProjects, endProject, removeProject, savePeople, createGuide, recruit, recruitmentContext, recruitmentNotice, previewRecruitment, confirmRecruitment,
    assignGuide, setGuideHandling, withdrawGuide, replaceGuide, suggestTransport, saveTransport, suggestLodging, saveLodging, suggestMeals, saveMeals, recalculate, complete, listExceptions, confirmException, dashboard, overview, summary, importWriters });
}
