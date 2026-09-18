import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectOverview } from '../../src/services/business.mjs';

function summary(overrides = {}) {
  return {
    project: {
      id: 'overview-unit', school_name: '脱敏学校', grade: '八年级', destination: '脱敏基地',
      starts_on: '2026-09-18', ends_on: '2026-09-18', meeting_place: '学校门口',
      meeting_at: '2026-09-18T07:00', itinerary: '脱敏行程', school_lead_name: '周老师',
      school_lead_phone: '13800000001', needs_lodging: 0, includes_meals: 0, meal_count: 0, data_version: 3
    },
    classes: [{ id: 'c1' }], counts: { classes: 1, vehicles: 0, rooms: 0, meals: 0 },
    students: 40, boys: 20, girls: 20, teachers: 1, requiredGuides: 1, teachersRiding: 1,
    manualStaff: [], staff: [{ source_type: 'teacher', source_id: 't1', people_count: 1 }],
    guides: [{ id: 'pg1', handling_status: '保留', assignment_count: 1 }],
    guideCoverage: [{ guideRequired: 1, assignedCount: 1 }], arrangedGuides: 1,
    recruitmentBatches: [{ id: 'batch1' }], transport: [], lodging: [], meals: [], exceptions: [], exports: [],
    ...overrides
  };
}

test('P04 跳过不适用的住宿和用餐，并把第一个未完成环节定位到乘车', () => {
  const overview = buildProjectOverview(summary());
  assert.equal(overview.stages.find((row) => row.id === 'lodging').status, 'not_applicable');
  assert.equal(overview.stages.find((row) => row.id === 'meals').status, 'not_applicable');
  assert.equal(overview.next.id, 'transport');
  assert.deepEqual(overview.progress, { completed: 3, total: 5, percent: 60 });
});

test('P04 优先显示阻断环节，人员总数与车辆汇总只取真实来源', () => {
  const overview = buildProjectOverview(summary({
    counts: { classes: 1, vehicles: 1, rooms: 0, meals: 0 },
    staff: [{ source_type: 'teacher', people_count: 1 }, { source_type: 'project_guide', people_count: 1 }, { source_type: 'transport_driver', people_count: 1 }],
    transport: [{ capacity: 49, safety_reserve: 2, allocated: 42 }],
    exceptions: [{ status: '待处理', severity: '阻断', module: '乘车' }]
  }));
  assert.equal(overview.next.id, 'transport');
  assert.equal(overview.next.status, 'blocked');
  assert.deepEqual(overview.totals, { staff: 3, transportCapacity: 47, transportAssigned: 42, lodgingExpected: 0, lodgingAssigned: 0, mealsPlanned: 0, mealsConfigured: 0 });
});
