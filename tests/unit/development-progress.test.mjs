import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTasksMarkdown } from '../../src/services/development-progress.mjs';

test('开发进度解析以 T01—T30 为边界并保留真实状态与缺口', async () => {
  const parsed = parseTasksMarkdown(await readFile('tasks.md', 'utf8'));
  assert.equal(parsed.summary.total, 30);
  assert.equal(parsed.summary.DONE, 24);
  assert.equal(parsed.summary.REVIEW, 2);
  assert.equal(parsed.summary.TODO, 4);
  assert.equal(parsed.summary.IN_PROGRESS, 0);
  assert.equal(parsed.summary.BLOCKED, 0);
  assert.deepEqual(parsed.gates.map((gate) => gate.passed), [true, true, false, false]);
  assert.match(parsed.next, /^负责人用 Microsoft Excel/);
  assert.match(parsed.tasks.find((task) => task.id === 'T16').missing, /样表/);
  assert.match(parsed.tasks.find((task) => task.id === 'T19').actual, /P08 已接入/);
  assert.match(parsed.tasks.find((task) => task.id === 'T25').missing, /Microsoft Excel/);
  assert.deepEqual(parsed.tasks.find((task) => task.id === 'T25').followUps, ['保险名单', '乘车安排表', '住宿安排表', '用餐安排表']);
  assert.deepEqual(parsed.tasks.find((task) => task.id === 'T24').followUps, []);
});

test('开发支撑任务不会污染产品任务总数', () => {
  const parsed = parseTasksMarkdown(`### T01 · 产品任务\n\n- 状态：\`DONE\`\n- 结果：完成。\n\n### DP01 · 开发工具\n\n- 状态：\`IN_PROGRESS\`\n`);
  assert.equal(parsed.summary.total, 1);
  assert.equal(parsed.tasks[0].id, 'T01');
});
