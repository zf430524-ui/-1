import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findEdge, openHeadlessEdge } from '../helpers/cdp-browser.mjs';

process.argv.push('--allow-dev-unlock');
process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_SENSITIVE_KEY = 'guides-browser-sensitive-key';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P14/P15 浏览器流程在 1366×768 可新增、查看、编辑和停用导游', async (context) => {
  const edgePath = findEdge(); if (!edgePath) return context.skip('本机未安装 Edge');
  const server = createWorkbenchServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await openHeadlessEdge(edgePath);
  context.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const { client } = browser; const base = `http://127.0.0.1:${server.address().port}`;
  await client.command('Page.navigate', { url: `${base}/__dev/unlock?to=/guides` });
  await client.waitFor(`document.querySelector('#guide-result-count')?.textContent === '0 名导游'`);
  assert.deepEqual(await client.evaluate(`({title:document.querySelector('h1')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth})`), { title: '导游库', overflow: false });

  await client.evaluate(`location.hash='/guides/detail?mode=new'`);
  await client.waitFor(`document.querySelector('#guide-form')`);
  await client.evaluate(`(()=>{const f=document.querySelector('#guide-form');f.elements.name.value='浏览器导游';f.elements.workPhone.value='13800000008';f.elements.gender.value='女';f.elements.residenceArea.value='长沙';f.elements.idNumber.value='430102199001011234';f.elements.licenseNumber.value='D-BROWSER-1008';f.elements.idExpiresOn.value='2027-12-31';f.elements.licenseExpiresOn.value='2026-10-15';f.requestSubmit();return true})()`);
  await client.waitFor(`document.querySelector('#guide-form')?.dataset.guideId && document.body.textContent.includes('浏览器导游')`);
  assert.equal(await client.evaluate(`document.documentElement.scrollWidth>innerWidth`), false);
  assert.equal(await client.evaluate(`document.documentElement.innerHTML.includes('430102199001011234')`), false);
  assert.equal(await client.evaluate(`document.body.textContent.includes('临期')`), true);

  await client.evaluate(`document.querySelector('#open-sensitive').click()`);
  await client.waitFor(`document.querySelector('#sensitive-dialog')?.open`);
  await client.evaluate(`(()=>{const f=document.querySelector('#sensitive-form');f.elements.purpose.value='浏览器验收核对';f.elements.confirmed.checked=true;f.requestSubmit();return true})()`);
  await client.waitFor(`document.querySelector('[data-sensitive-id]')?.textContent==='430102199001011234' && document.querySelector('[data-sensitive-log]')?.textContent.includes('操作日志')`);
  await client.evaluate(`document.querySelector('#close-sensitive').click()`);
  await client.waitFor(`!document.querySelector('#sensitive-dialog')?.open`);
  assert.equal(await client.evaluate(`document.documentElement.innerHTML.includes('430102199001011234')`), false);
  const detailScreenshot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  mkdirSync(resolve('test-results'), { recursive: true });
  writeFileSync(resolve('test-results', 't13-p15-guide-detail-1366x768.png'), Buffer.from(detailScreenshot.data, 'base64'));

  await client.evaluate(`(()=>{const f=document.querySelector('#guide-form');f.elements.residenceArea.value='长沙县';f.requestSubmit();return true})()`);
  await client.waitFor(`document.querySelector('#guide-form') && document.querySelector('#guide-form').elements.residenceArea.value==='长沙县'`);
  await client.evaluate(`location.hash='/guides'`); await client.waitFor(`document.querySelector('#guide-list')?.textContent.includes('浏览器导游')`);
  await client.evaluate(`(()=>{window.confirm=()=>true;document.querySelector('[data-guide-status]').click();return true})()`);
  await client.waitFor(`document.querySelector('.guide-row .status-tag')?.textContent==='停用'`);
  const finalState = await client.evaluate(`({count:document.querySelector('#guide-count')?.textContent,status:document.querySelector('.guide-row .status-tag')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth})`);
  assert.deepEqual(finalState, { count: '1', status: '停用', overflow: false });
  const screenshot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve('test-results', 't13-p14-p15-browser-flow-1366x768.png'), Buffer.from(screenshot.data, 'base64'));
});
