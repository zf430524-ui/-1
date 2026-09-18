import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findEdge, openHeadlessEdge } from '../helpers/cdp-browser.mjs';

process.argv.push('--allow-dev-unlock');
process.env.WORKBENCH_TEST_MODE = '1';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P11/P12 浏览器在 1366×768 完成粘贴、预览、确认并写入学校库', async (context) => {
  const edgePath = findEdge();
  if (!edgePath) return context.skip('本机未安装 Edge');
  const runtimeRoot = mkdtempSync(join(tmpdir(), 'study-import-browser-'));
  process.env.WORKBENCH_RUNTIME_ROOT = runtimeRoot;
  const server = createWorkbenchServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await openHeadlessEdge(edgePath);
  context.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); rmSync(runtimeRoot, { recursive: true, force: true }); });
  const { client } = browser;
  const base = `http://127.0.0.1:${server.address().port}`;

  await client.command('Page.navigate', { url: `${base}/__dev/unlock?to=/imports` });
  await client.waitFor(`document.querySelector('#import-form') && document.querySelector('#import-form').elements.targetType.options.length > 1`);
  const initial = await client.evaluate(`({title:document.querySelector('h1')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth})`);
  assert.deepEqual(initial, { title: '资料导入', overflow: false });

  await client.evaluate(`(() => { const form=document.querySelector('#import-form'); form.elements.targetType.value='schools'; form.elements.targetType.dispatchEvent(new Event('change')); form.elements.importMethod.value='粘贴文字'; form.elements.importMethod.dispatchEvent(new Event('change')); form.elements.text.value='学校名称,联系人姓名,联系人电话\\n浏览器导入学校,周老师,13800000001'; form.requestSubmit(); return true; })()`);
  await client.waitFor(`location.hash.includes('/imports/mapping?batch=') && document.querySelector('#import-preview-list')?.textContent.includes('浏览器导入学校')`);
  const preview = await client.evaluate(`({valid:document.querySelectorAll('.import-preview-row.row-valid').length,confirmDisabled:document.querySelector('#confirm-import')?.disabled,overflow:document.documentElement.scrollWidth>innerWidth})`);
  assert.deepEqual(preview, { valid: 1, confirmDisabled: false, overflow: false });

  const previewScreenshot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const outputDir = resolve('test-results');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 't14-t16-p12-preview-1366x768.png'), Buffer.from(previewScreenshot.data, 'base64'));

  await client.evaluate(`(() => { window.confirm=()=>true; document.querySelector('#confirm-import').click(); return true; })()`);
  await client.waitFor(`document.querySelector('.mapping-summary .status-tag')?.textContent === '成功'`);
  await client.command('Page.navigate', { url: `${base}/#/schools` });
  await client.waitFor(`document.querySelector('#school-list')?.textContent.includes('浏览器导入学校')`);
  const finalState = await client.evaluate(`({school:document.querySelector('#school-list')?.textContent.includes('浏览器导入学校'),overflow:document.documentElement.scrollWidth>innerWidth})`);
  assert.deepEqual(finalState, { school: true, overflow: false });

  await client.command('Page.navigate', { url: `${base}/#/imports` });
  await client.waitFor(`document.querySelector('#import-batch-list')?.textContent.includes('成功')`);
  const screenshot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve(outputDir, 't14-t16-p11-import-1366x768.png'), Buffer.from(screenshot.data, 'base64'));
});
