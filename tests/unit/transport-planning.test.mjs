import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTransportSuggestion } from '../../src/services/business.mjs';

const classes = [
  { id: 'c801', name: '801', student_total: 42, boys: 22, girls: 20, teachers_on_vehicle: 2 },
  { id: 'c802', name: '802', student_total: 43, boys: 21, girls: 22, teachers_on_vehicle: 2 },
  { id: 'c803', name: '803', student_total: 40, boys: 20, girls: 20, teachers_on_vehicle: 1 }
];
const guides = classes.map((item, index) => ({ id: `pg${index + 1}`, handling_status: '保留', assignment_count: 1, assignments: [{ classId: item.id }] }));
const vehicles = (capacities) => capacities.map((capacity, index) => ({ vehicleLabel: `${index + 1}车`, capacity }));

test('排车建议优先一班一车并得到 133 人与 14 个空位', () => {
  const result = buildTransportSuggestion({ classes, guides, vehicles: vehicles([49, 49, 49]) });
  assert.deepEqual(result.totals, { capacity: 147, assigned: 133, emptySeats: 14, missingSeats: 0 });
  assert.equal(result.unassigned.length, 0);
  assert.equal(result.splitClasses.length, 0);
  assert.deepEqual(result.vehicles.map((vehicle) => vehicle.allocations.filter((row) => row.role === '学生').map((row) => row.classId)), [['c801'], ['c802'], ['c803']]);
});

test('单车放不下但总容量足够时守恒拆班且导游只进入一辆车', () => {
  const result = buildTransportSuggestion({ classes, guides, vehicles: vehicles([49, 49, 41]) });
  const c803 = result.vehicles.flatMap((vehicle) => vehicle.allocations).filter((row) => row.classId === 'c803');
  assert.equal(c803.filter((row) => row.role === '学生').reduce((sum, row) => sum + row.peopleCount, 0), 40);
  assert.equal(c803.filter((row) => row.role === '学生').reduce((sum, row) => sum + row.boysCount, 0), 20);
  assert.equal(c803.filter((row) => row.role === '学生').reduce((sum, row) => sum + row.girlsCount, 0), 20);
  assert.equal(c803.filter((row) => row.role === '导游').length, 1);
  assert.deepEqual(result.splitClasses, [{ classId: 'c803', className: '803', vehicles: 2 }]);
});

test('总座位不足时整班保留未安排并显示缺少座位', () => {
  const result = buildTransportSuggestion({ classes, guides, vehicles: vehicles([45, 46, 41]) });
  assert.deepEqual(result.unassigned, [{ classId: 'c803', className: '803', peopleCount: 42, missingSeats: 1 }]);
  assert.equal(result.totals.missingSeats, 1);
  assert.equal(result.vehicles.flatMap((vehicle) => vehicle.allocations).some((row) => row.classId === 'c803'), false);
});
