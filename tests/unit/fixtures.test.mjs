import test from 'node:test';
import assert from 'node:assert/strict';
import { projectFixture } from '../fixtures/project-sample.mjs';

test('脱敏样本覆盖多班、多车、多房和多餐次', () => {
  assert.ok(projectFixture.classes.length >= 3);
  assert.ok(projectFixture.vehicles.length >= 2);
  assert.ok(projectFixture.rooms.length >= 2);
  assert.ok(projectFixture.meals.length >= 2);
  assert.equal(projectFixture.classes.reduce((sum, item) => sum + item.total, 0), 126);
});
