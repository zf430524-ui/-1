import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporary = await mkdtemp(join(tmpdir(), 'workbench-progress-'));
const tasksPath = join(temporary, 'tasks.md');
const resultPath = join(temporary, 'latest-check.json');
await writeFile(tasksPath, await readFile('tasks.md', 'utf8'));
await writeFile(resultPath, JSON.stringify({ state: 'passed', startedAt: '2026-09-16T00:00:00.000Z', finishedAt: '2099-09-16T00:01:00.000Z', exitCode: 0, tests: 76, passed: 76, failed: 0 }));

process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'progress-test-password';
process.env.WORKBENCH_TASKS_PATH = tasksPath;
process.env.WORKBENCH_PROGRESS_RESULT_PATH = resultPath;
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('开发进度接口读取 tasks.md 并在文件变化后同步', async (context) => {
  const server = createWorkbenchServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(temporary, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Host: `127.0.0.1:${server.address().port}` };

  const page = await fetch(`${base}/dev-progress`, { headers });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /工作台开发进度/);

  const first = await (await fetch(`${base}/api/dev-progress`, { headers })).json();
  assert.deepEqual({ total: first.summary.total, done: first.summary.DONE, review: first.summary.REVIEW, progress: first.summary.IN_PROGRESS, todo: first.summary.TODO }, { total: 30, done: 24, review: 1, progress: 0, todo: 5 });
  assert.equal(first.check.state, 'passed');
  assert.equal(first.tasks.find((task) => task.id === 'T19').missing, '');

  const changed = (await readFile(tasksPath, 'utf8')).replace('### T25 · 实现真实 Excel 生成和文件级验证\n\n- 状态：`TODO`', '### T25 · 实现真实 Excel 生成和文件级验证\n\n- 状态：`IN_PROGRESS`');
  await writeFile(tasksPath, changed);
  const second = await (await fetch(`${base}/api/dev-progress`, { headers })).json();
  assert.equal(second.summary.TODO, 4);
  assert.equal(second.summary.REVIEW, 1);
  assert.equal(second.summary.IN_PROGRESS, 1);
  assert.equal(second.tasks.find((task) => task.id === 'T25').status, 'IN_PROGRESS');
});
