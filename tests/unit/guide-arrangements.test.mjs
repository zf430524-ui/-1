import test from 'node:test';
import assert from 'node:assert/strict';
import { closedDateRangesOverlap } from '../../src/services/business.mjs';

test('导游项目日期使用完整闭区间，同日、交叉和包含冲突，相邻日期不冲突', () => {
  assert.equal(closedDateRangesOverlap('2026-10-10', '2026-10-10', '2026-10-10', '2026-10-10'), true);
  assert.equal(closedDateRangesOverlap('2026-10-10', '2026-10-12', '2026-10-12', '2026-10-14'), true);
  assert.equal(closedDateRangesOverlap('2026-10-10', '2026-10-15', '2026-10-11', '2026-10-12'), true);
  assert.equal(closedDateRangesOverlap('2026-10-11', '2026-10-12', '2026-10-10', '2026-10-15'), true);
  assert.equal(closedDateRangesOverlap('2026-10-10', '2026-10-12', '2026-10-13', '2026-10-14'), false);
});
