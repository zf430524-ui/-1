import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLodgingSuggestion, lodgingSourceRows } from '../../src/services/business.mjs';

const classes = [
  { id: 'c801', name: '801', boys: 22, girls: 20 },
  { id: 'c802', name: '802', boys: 21, girls: 22 },
  { id: 'c803', name: '803', boys: 20, girls: 20 }
];
const staff = [
  ...Array.from({ length: 2 }, (_, index) => ({ source_type: 'teacher', role: '老师', gender: '男', lodging_count: 1, source_id: `tm${index}` })),
  ...Array.from({ length: 3 }, (_, index) => ({ source_type: 'teacher', role: '老师', gender: '女', lodging_count: 1, source_id: `tf${index}` })),
  { source_type: 'project_guide', role: '导游', gender: '男', lodging_count: 1 },
  ...Array.from({ length: 2 }, () => ({ source_type: 'project_guide', role: '导游', gender: '女', lodging_count: 1 })),
  ...Array.from({ length: 3 }, () => ({ source_type: 'transport_driver', role: '司机', gender: '男', lodging_count: 1 }))
];

function rooms(male = 18, female = 17) {
  return [
    ...Array.from({ length: male }, (_, index) => ({ lodgingName: '脱敏住宿点', checkInOn: '2026-10-10', building: 'A栋', floorLabel: `${Math.floor(index / 10) + 1}层`, roomNumber: `M${String(index + 1).padStart(2, '0')}`, roomType: '四人间', capacity: 4, genderRule: '男' })),
    ...Array.from({ length: female }, (_, index) => ({ lodgingName: '脱敏住宿点', checkInOn: '2026-10-10', building: 'B栋', floorLabel: `${Math.floor(index / 10) + 1}层`, roomNumber: `F${String(index + 1).padStart(2, '0')}`, roomType: '四人间', capacity: 4, genderRule: '女' }))
  ];
}

test('35 间四人房建议安排 136 人、空床 4，并形成可解释的同性交叉班级房', () => {
  const result = buildLodgingSuggestion({ classes, staff, rooms: rooms() });
  assert.deepEqual(result.totals, { rooms: 35, nights: 1, capacity: 140, expected: 136, assigned: 136, emptyBeds: 4, missingPeople: 0, expectedPerNight: 136 });
  assert.equal(result.unassigned.length, 0); assert.ok(result.crossClassRooms.length > 0);
  assert.ok(result.crossClassRooms.every((room) => room.parts.reduce((sum, part) => sum + part.peopleCount, 0) <= 4 && room.reason));
  assert.ok(result.rooms.every((room) => new Set(room.allocations.map((row) => row.gender)).size <= 1));
  const studentTotals = Object.fromEntries(classes.map((row) => [row.id, { 男: 0, 女: 0 }]));
  result.rooms.flatMap((room) => room.allocations).filter((row) => row.role === '学生').forEach((row) => { studentTotals[row.classId][row.gender] += row.peopleCount; });
  assert.deepEqual(studentTotals, { c801: { 男: 22, 女: 20 }, c802: { 男: 21, 女: 22 }, c803: { 男: 20, 女: 20 } });
});

test('女性房少一间时保留 3 名未安排人员，不能借用男性空床绕过性别规则', () => {
  const result = buildLodgingSuggestion({ classes, staff, rooms: rooms(18, 16) });
  assert.equal(result.totals.capacity, 136); assert.equal(result.totals.assigned, 133); assert.equal(result.totals.missingPeople, 3);
  assert.equal(result.unassigned.reduce((sum, row) => sum + row.peopleCount, 0), 3);
  assert.ok(result.unassigned.every((row) => row.gender === '女'));
});

test('住宿来源按 P05、P07、P08 角色和性别汇总，不产生姓名级住宿记录', () => {
  const rows = lodgingSourceRows({ classes, staff });
  assert.equal(rows.reduce((sum, row) => sum + row.peopleCount, 0), 136);
  assert.deepEqual(rows.filter((row) => row.role !== '学生').map((row) => [row.role, row.gender, row.peopleCount, row.source]), [
    ['老师', '男', 2, 'P05 老师'], ['老师', '女', 3, 'P05 老师'], ['导游', '男', 1, 'P07 导游安排'], ['导游', '女', 2, 'P07 导游安排'], ['司机', '男', 3, 'P08 车辆司机']
  ]);
  assert.equal(rows.some((row) => 'name' in row), false);
});
