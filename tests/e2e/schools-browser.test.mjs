import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findEdge, openHeadlessEdge } from '../helpers/cdp-browser.mjs';

process.argv.push('--allow-dev-unlock');
process.env.WORKBENCH_TEST_MODE = '1';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P13 浏览器流程在 1366×768 可新增、编辑和停用学校', async (context) => {
  const edgePath = findEdge();
  if (!edgePath) return context.skip('本机未安装 Edge');
  const server = createWorkbenchServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const browser = await openHeadlessEdge(edgePath);
  context.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const { client } = browser;
  const base = `http://127.0.0.1:${address.port}`;
  await client.command('Page.navigate', { url: `${base}/__dev/unlock?to=/schools` });
  await client.waitFor(`document.querySelector('#school-list') && document.querySelector('#school-result-count')?.textContent === '0 所学校'`);

  const initial = await client.evaluate(`({title:document.querySelector('h1')?.textContent, navCount:document.querySelectorAll('.nav-item').length, overflow:document.documentElement.scrollWidth > innerWidth})`);
  assert.deepEqual(initial, { title: '学校库', navCount: 8, overflow: false });

  await client.evaluate(`document.querySelector('#new-school').click()`);
  await client.waitFor(`document.querySelector('#school-dialog')?.open === true && !!document.querySelector('#school-form')`);
  await client.evaluate(`(() => { const form=document.querySelector('#school-form'); form.elements.name.value='浏览器测试学校'; form.querySelector('[name=contactName]').value='周老师'; form.querySelector('[name=contactPhone]').value='13800000001'; form.requestSubmit(); return true; })()`);
  await client.waitFor(`!document.querySelector('#school-dialog')?.open && document.querySelector('#school-list')?.textContent.includes('浏览器测试学校')`);

  await client.evaluate(`(() => { const row=[...document.querySelectorAll('.school-row')].find(item=>item.textContent.includes('浏览器测试学校')); row.querySelector('[data-edit-school]').click(); return true; })()`);
  await client.waitFor(`document.querySelector('#school-dialog')?.open === true && document.querySelector('#school-form')?.elements.name?.value === '浏览器测试学校'`);
  await client.evaluate(`(() => { const form=document.querySelector('#school-form'); form.elements.cooperationNotes.value='浏览器已核对'; form.querySelector('[name=contactName]').value='陈老师'; form.requestSubmit(); return true; })()`);
  await client.waitFor(`!document.querySelector('#school-dialog')?.open && document.querySelector('#school-list')?.textContent.includes('浏览器测试学校')`);

  await client.evaluate(`(() => { const row=[...document.querySelectorAll('.school-row')].find(item=>item.textContent.includes('浏览器测试学校')); row.querySelector('[data-toggle-school]').click(); return true; })()`);
  await client.waitFor(`document.querySelector('#school-list')?.textContent.includes('已停用')`);
  const finalState = await client.evaluate(`({count:document.querySelector('#school-count')?.textContent, status:document.querySelector('.school-row .status-tag')?.textContent, overflow:document.documentElement.scrollWidth > innerWidth})`);
  assert.deepEqual(finalState, { count: '1', status: '已停用', overflow: false });

  const screenshot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const outputDir = resolve('test-results');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 't10-p13-browser-flow-1366x768.png'), Buffer.from(screenshot.data, 'base64'));
});
