import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMealSuggestion, mealSourceRows } from '../../src/services/business.mjs';

const classes = [
  { id: 'c801', name: '801', student_total: 42 },
  { id: 'c802', name: '802', student_total: 43 },
  { id: 'c803', name: '803', student_total: 40 }
];
const staff = [
  ...Array.from({ length: 5 }, (_, index) => ({ source_type: 'teacher', source_id: `t${index + 1}`, role: '老师', default_meal_count: 1 })),
  ...Array.from({ length: 3 }, (_, index) => ({ source_type: 'project_guide', source_id: `g${index + 1}`, role: '导游', default_meal_count: 1 })),
  ...Array.from({ length: 3 }, (_, index) => ({ source_type: 'transport_driver', source_id: `d${index + 1}`, role: '司机', default_meal_count: 1 }))
];
const sessions = [
  { name: '第一餐', restaurantName: '验收餐厅 A', mealAt: '2026-10-10T12:00', seatsPerTable: 10, tablePrefix: 'A', tables: [] },
  { name: '第二餐', restaurantName: '验收餐厅 B', mealAt: '2026-10-10T18:00', seatsPerTable: 10, tablePrefix: 'B', tables: [] }
];

test('基础建议按学生和导游向上取整为 13 桌，并把 8 名工作人员明确留给人工追加', () => {
  const result = buildMealSuggestion({ classes, staff, sessions });
  assert.equal(result.sessions.length, 2);
  for (const session of result.sessions) {
    assert.deepEqual(session.suggestion, { basePeople: 128, staffPeople: 8, totalPeople: 136, baseSuggestedTables: 13, staffAdditionalTables: 1, finalRequiredTables: 14, allocated: 128, unassigned: 8 });
    assert.equal(session.tables.length, 13); assert.equal(session.tables[0].tableNumber.endsWith('01'), true);
  }
});

test('负责人显式追加工作人员桌后，每餐 14 桌覆盖 136 人且两家餐厅桌号互不串扰', () => {
  const result = buildMealSuggestion({ classes, staff, sessions, includeStaff: true });
  assert.deepEqual(result.sessions.map((session) => [session.restaurantName, session.tables.length, session.suggestion.allocated]), [
    ['验收餐厅 A', 14, 136], ['验收餐厅 B', 14, 136]
  ]);
  assert.deepEqual(result.sessions[0].tables.map((table) => table.tableNumber), Array.from({ length: 14 }, (_, index) => `A${String(index + 1).padStart(2, '0')}`));
  assert.deepEqual(result.sessions[1].tables.map((table) => table.tableNumber), Array.from({ length: 14 }, (_, index) => `B${String(index + 1).padStart(2, '0')}`));
  assert.ok(result.sessions.flatMap((session) => session.tables).every((table) => table.allocations.reduce((sum, row) => sum + row.peopleCount, 0) <= 10));
});

test('单餐来源差异改变本餐人数并保留原因，不修改其他餐次默认口径', () => {
  const first = { ...sessions[0], overrides: [{ sourceType: 'teacher', sourceId: 't1', differenceCount: -1, reason: '本餐提前离团' }] };
  const sources = mealSourceRows({ classes, staff, overrides: first.overrides });
  assert.equal(sources.reduce((sum, row) => sum + row.peopleCount, 0), 135);
  assert.equal(sources.find((row) => row.sourceId === 't1').reason, '本餐提前离团');
  const result = buildMealSuggestion({ classes, staff, sessions: [first, sessions[1]], includeStaff: true });
  assert.deepEqual(result.sessions.map((row) => row.suggestion.totalPeople), [135, 136]);
});
