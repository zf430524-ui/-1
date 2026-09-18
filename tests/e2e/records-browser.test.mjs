import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findEdge, openHeadlessEdge } from '../helpers/cdp-browser.mjs';

process.argv.push('--allow-dev-unlock'); process.env.WORKBENCH_TEST_MODE = '1'; process.env.WORKBENCH_SENSITIVE_KEY = 'records-browser-sensitive-key';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P19 浏览器：筛选、分页、失败原因、源跳转和敏感响应扫描', async (context) => {
  const edgePath = findEdge(); if (!edgePath) return context.skip('本机未安装 Edge');
  const server = createWorkbenchServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const browser = await openHeadlessEdge(edgePath);
  context.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const { client } = browser; const base = `http://127.0.0.1:${server.address().port}`; const consoleErrors = [];
  client.socket.addEventListener('message', (event) => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.text || 'browser error'); });
  await client.command('Page.navigate', { url: `${base}/__dev/unlock?to=/records` }); await client.waitFor(`document.querySelector('#record-filter')`);
  const projectId = await client.evaluate(`(async()=>{const headers={'Content-Type':'application/json'};const request=async(method,path,body)=>{const response=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(JSON.stringify(data));return data};const school=await request('POST','/api/schools',{name:'P19 浏览器脱敏学校',contacts:[{name:'负责人',phone:'13800026002',isDefault:true}]});const project=await request('POST','/api/projects',{id:'p19-browser',schoolId:school.id,grade:'八年级',destination:'脱敏基地',startsOn:'2026-12-21',endsOn:'2026-12-21'});await request('POST','/api/imports',{targetType:'classes_teachers',projectId:project.id,importMethod:'粘贴文字',text:'班级,学生总数,男生,女生\\n801,20,10,10'});await fetch('/api/imports',{method:'POST',headers,body:JSON.stringify({targetType:'classes_teachers',projectId:project.id,importMethod:'粘贴文字',text:'无法识别的一行'})});return project.id})()`);
  await client.evaluate(`location.hash='/records?project=${projectId}'`); await client.waitFor(`document.querySelectorAll('#record-list [data-record-id]').length>=3`);
  const initial = await client.evaluate(`({title:document.querySelector('h1').textContent,project:document.querySelector('#record-filter [name=projectId]').value,total:document.querySelector('.records-metrics .metric strong').textContent,rows:document.querySelectorAll('#record-list [data-record-id]').length,overflow:document.documentElement.scrollWidth>innerWidth,boundary:document.querySelector('.record-boundary').textContent})`);
  assert.equal(initial.title, '操作与导入导出记录'); assert.equal(initial.project, projectId); assert.ok(Number(initial.total) >= 3); assert.equal(initial.overflow, false); assert.match(initial.boundary, /不记录、不返回/);
  await client.evaluate(`document.querySelector('[data-record-category-filter="import"]').click()`); await client.waitFor(`location.hash.includes('category=import') && document.querySelectorAll('#record-list [data-record-category="import"]').length===2`);
  const filtered = await client.evaluate(`({categories:[...document.querySelectorAll('#record-list [data-record-category]')].map(row=>row.dataset.recordCategory),text:document.querySelector('#record-list').textContent,hasDelete:!!document.querySelector('[data-delete-record]')})`);
  assert.deepEqual(filtered.categories, ['import','import']); assert.match(filtered.text, /待确认/); assert.match(filtered.text, /失败/); assert.equal(filtered.hasDelete, false);
  await client.evaluate(`(()=>{const form=document.querySelector('#record-filter');form.elements.result.value='失败';form.requestSubmit()})()`); await client.waitFor(`location.hash.includes('result=') && document.querySelectorAll('#record-list [data-record-category="import"]').length===1`);
  const failed = await client.evaluate(`({reason:document.querySelector('.record-failure')?.textContent,open:document.querySelector('.record-failure')?.open})`); assert.match(failed.reason, /无法识别|解析|列|表头/); assert.equal(failed.open, false);
  await client.evaluate(`document.querySelector('.record-failure summary').click()`); assert.equal(await client.evaluate(`document.querySelector('.record-failure').open`), true);
  mkdirSync(resolve('test-results'), { recursive: true }); const failureShot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(resolve('test-results','t26-p19-failed-record-1366x768.png'), Buffer.from(failureShot.data, 'base64'));
  await client.evaluate(`document.querySelector('#record-list a').click()`); await client.waitFor(`location.hash.includes('/imports/mapping?batch=') && document.querySelector('#import-mapping-root')`);
  await client.evaluate(`location.hash='/records?project=${projectId}&category=operation'`); await client.waitFor(`document.querySelector('#record-filter') && document.querySelectorAll('#record-list [data-record-category="operation"]').length>=2`);
  const responseScan = await client.evaluate(`fetch('/api/records?projectId=${projectId}').then(response=>response.text())`);
  for (const forbidden of ['430102199001011234','D-4301-SECRET-1824','C:\\\\Users\\\\负责人']) assert.equal(responseScan.includes(forbidden), false);
  const shot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(resolve('test-results','t26-p19-records-1366x768.png'), Buffer.from(shot.data, 'base64'));
  assert.deepEqual(consoleErrors, []);
});
