import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationGroups, pages, findPage } from '../../public/pages.js';

test('负责人端目录完整覆盖 P01—P20 且编号唯一', () => {
  assert.equal(pages.length, 20);
  assert.deepEqual(pages.map((page) => page.id), Array.from({ length: 20 }, (_, index) => `P${String(index + 1).padStart(2, '0')}`));
  assert.equal(new Set(pages.map((page) => page.path)).size, 20);
  assert.equal(navigationGroups.length, 8);
});

test('住宿和用餐入口被标记为条件页面', () => {
  assert.equal(findPage('/projects/lodging').conditional, 'lodging');
  assert.equal(findPage('/projects/meals').conditional, 'meals');
});
