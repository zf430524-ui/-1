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

test('CR01 班级尾数组不可拆，按 10 人优先且共享桌最多两个班', () => {
  const tailClasses = [['a','甲',46],['b','乙',27],['c','丙',4],['d','丁',3]].map(([id,name,student_total]) => ({ id, name, student_total }));
  const result = buildMealSuggestion({ classes: tailClasses, staff: [], sessions: [sessions[0]], includeStaff: true }).sessions[0];
  const shared = result.tables.filter((table) => table.allocations.filter((row) => row.role === '学生').length > 1);
  assert.deepEqual(shared.map((table) => table.allocations.map((row) => row.peopleCount).sort((a,b) => a-b)), [[4,6],[3,7]]);
  assert.ok(shared.every((table) => table.allocations.length === 2 && table.allocations.reduce((sum, row) => sum + row.peopleCount, 0) === 10));
});

test('CR01 尾数组组合按 10、9、8 人优先，不拆分原尾数组', () => {
  const tailClasses = [['a','甲',16],['b','乙',13],['c','丙',15],['d','丁',3]].map(([id,name,student_total]) => ({ id, name, student_total }));
  const result = buildMealSuggestion({ classes: tailClasses, staff: [], sessions: [sessions[0]], includeStaff: true }).sessions[0];
  const partial = result.tables.filter((table) => table.allocations.some((row) => row.peopleCount < 10)).map((table) => table.allocations.reduce((sum, row) => sum + row.peopleCount, 0));
  assert.deepEqual(partial, [9, 8]);
});

test('CR01 导游固定桌号使用结构化要求，容量不合法时返回阻断', () => {
  const oneGuide = [{ source_type: 'project_guide', source_id: 'guide-fixed', role: '导游', default_meal_count: 1 }];
  const legal = buildMealSuggestion({ classes: [{ id: 'a', name: '甲', student_total: 10 }], staff: oneGuide,
    sessions: [{ ...sessions[0], specialRequirements: JSON.stringify({ role: '导游', type: 'fixed_table', value: 'A02' }) }], includeStaff: true }).sessions[0];
  assert.ok(legal.tables.find((table) => table.tableNumber === 'A02').allocations.some((row) => row.role === '导游'));
  const blocked = buildMealSuggestion({ classes: [{ id: 'a', name: '甲', student_total: 10 }], staff: oneGuide,
    sessions: [{ ...sessions[0], specialRequirements: JSON.stringify({ role: '导游', type: 'fixed_table', value: 'A01' }) }], includeStaff: true }).sessions[0];
  assert.equal(blocked.specialRequirementBlockers.length, 1);
});

test('CR01 导游固定桌号范围按结构化字段生效，普通备注不改变算法', () => {
  const twoGuides = [1, 2].map((number) => ({ source_type: 'project_guide', source_id: `guide-range-${number}`, role: '导游', default_meal_count: 1 }));
  const ranged = buildMealSuggestion({ classes: [{ id: 'a', name: '甲', student_total: 10 }], staff: twoGuides,
    sessions: [{ ...sessions[0], notes: '导游尽量靠窗，此备注不参与算法', specialRequirements: JSON.stringify({ role: '导游', type: 'fixed_table_range', value: 'A02-A03' }) }], includeStaff: true }).sessions[0];
  const guideTables = ranged.tables.filter((table) => table.allocations.some((row) => row.role === '导游')).map((table) => table.tableNumber);
  assert.ok(guideTables.every((number) => ['A02', 'A03'].includes(number)));
  assert.equal(ranged.specialRequirementBlockers.length, 0);
});
