import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { findEdge, openHeadlessEdge } from '../helpers/cdp-browser.mjs';

const runtimeRoot = mkdtempSync(join(tmpdir(), 'study-tour-backup-browser-'));
process.argv.push('--allow-dev-unlock');
process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_RUNTIME_ROOT = runtimeRoot;
process.env.WORKBENCH_DB_PATH = join(runtimeRoot, 'data', 'workbench.sqlite');
process.env.WORKBENCH_CERTIFICATES_PATH = join(runtimeRoot, 'certificates');
process.env.WORKBENCH_BACKUPS_PATH = join(runtimeRoot, 'backups');
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P20 浏览器可处理退出提醒并完成备份校验', async (context) => {
  const edgePath = findEdge();
  if (!edgePath) {
    rmSync(runtimeRoot, { recursive: true, force: true });
    return context.skip('本机未安装 Edge');
  }
  const server = createWorkbenchServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await openHeadlessEdge(edgePath);
  context.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    rmSync(runtimeRoot, { recursive: true, force: true });
  });
  const { client } = browser;
  const base = `http://127.0.0.1:${server.address().port}`;
  await client.command('Page.navigate', { url: `${base}/__dev/unlock?to=/backup` });
  await client.waitFor(`document.querySelector('#backup-count')?.textContent === '0 个可用备份'`);

  await client.evaluate(`document.querySelector('#logout').click()`);
  await client.waitFor(`document.querySelector('#exit-dialog')?.open === true`);
  await client.evaluate(`document.querySelector('[data-exit-action="stay"]').click()`);
  await client.waitFor(`document.querySelector('#exit-dialog')?.open === false`);

  await client.evaluate(`document.querySelector('#backup-form').requestSubmit()`);
  await client.waitFor(`document.querySelector('#backup-count')?.textContent === '1 个可用备份'`);
  const state = await client.evaluate(`({title:document.querySelector('h1')?.textContent, today:document.querySelector('#backup-today-verified')?.textContent, backupRows:document.querySelectorAll('.backup-row').length, overflow:document.documentElement.scrollWidth > innerWidth})`);
  assert.deepEqual(state, { title: '数据备份与恢复', today: '是', backupRows: 1, overflow: false });

  const screenshot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const outputDir = resolve('test-results');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 't09-p20-backup-1366x768.png'), Buffer.from(screenshot.data, 'base64'));

  await client.evaluate(`document.querySelector('#logout').click()`);
  await client.waitFor(`!!document.querySelector('#unlock-form')`);
});
