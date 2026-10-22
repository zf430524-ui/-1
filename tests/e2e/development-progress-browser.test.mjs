import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findEdge, openHeadlessEdge } from '../helpers/cdp-browser.mjs';

process.argv.push('--allow-dev-unlock');
process.env.WORKBENCH_TEST_MODE = '1';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('本地开发进度页面在 1366×768 显示汇总、缺口并可筛选', async (context) => {
  const edgePath = findEdge(); if (!edgePath) return context.skip('本机未安装 Edge');
  const server = createWorkbenchServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await openHeadlessEdge(edgePath);
  context.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const { client } = browser; const base = `http://127.0.0.1:${server.address().port}`;
  const consoleErrors = [];
  client.socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.text || 'browser error');
  });
  await client.command('Page.navigate', { url: `${base}/dev-progress` });
  await client.waitFor(`document.querySelectorAll('#task-rows tr').length===30`);
  const initial = await client.evaluate(`({title:document.querySelector('h1')?.textContent,cards:[...document.querySelectorAll('.summary-card strong')].map((node)=>node.textContent),t20:[...document.querySelectorAll('#task-rows tr')].find((row)=>row.querySelector('.task-id')?.textContent==='T20')?.textContent||'',overflow:document.documentElement.scrollWidth>innerWidth})`);
  assert.equal(initial.title, '工作台开发进度');
  assert.deepEqual(initial.cards, ['30', '24', '1', '0', '5']);
  assert.match(initial.t20, /P09 已接入/);
  assert.equal(initial.overflow, false);
  await client.evaluate(`(()=>{const filter=document.querySelector('#status-filter');filter.value='TODO';filter.dispatchEvent(new Event('change'));return true})()`);
  await client.waitFor(`document.querySelectorAll('#task-rows tr').length===5`);
  assert.match(await client.evaluate(`document.querySelector('#task-rows').textContent`), /T25/);
  const t25FollowUps = await client.evaluate(`[...document.querySelectorAll('#task-rows tr')].find((row)=>row.querySelector('.task-id')?.textContent==='T25') ? [...[...document.querySelectorAll('#task-rows tr')].find((row)=>row.querySelector('.task-id')?.textContent==='T25').querySelectorAll('.follow-up-tag')].map((node)=>({text:node.textContent,color:getComputedStyle(node).backgroundColor})) : []`);
  assert.deepEqual(t25FollowUps.map((item) => item.text), ['保险名单 · 待修改', '乘车安排表 · 待修改', '住宿安排表 · 待修改', '用餐安排表 · 待修改']);
  assert.equal(new Set(t25FollowUps.map((item) => item.color)).size, 4);
  assert.deepEqual(consoleErrors, []);
  await client.evaluate(`[...document.querySelectorAll('#task-rows tr')].find((row)=>row.querySelector('.task-id')?.textContent==='T25')?.scrollIntoView({block:'center'})`);
  const screenshot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  mkdirSync(resolve('test-results'), { recursive: true });
  writeFileSync(resolve('test-results', 'dp01-development-progress-1366x768.png'), Buffer.from(screenshot.data, 'base64'));
});
