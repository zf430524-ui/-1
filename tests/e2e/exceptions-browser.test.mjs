import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findEdge, openHeadlessEdge } from '../helpers/cdp-browser.mjs';

process.argv.push('--allow-dev-unlock'); process.env.WORKBENCH_TEST_MODE = '1'; process.env.WORKBENCH_SENSITIVE_KEY = 'exceptions-browser-sensitive-key';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P18 浏览器：筛选、确认原因、项目重算、源定位与已解决追查', async (context) => {
  const edgePath = findEdge(); if (!edgePath) return context.skip('本机未安装 Edge');
  const server = createWorkbenchServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const browser = await openHeadlessEdge(edgePath); context.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const { client } = browser; const base = `http://127.0.0.1:${server.address().port}`; const consoleErrors = []; client.socket.addEventListener('message', (event) => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.text || 'browser error'); });
  await client.command('Page.navigate', { url: `${base}/__dev/unlock?to=/exceptions` }); await client.waitFor(`document.querySelector('#exceptions-root')`);
  const projectId = await client.evaluate(`(async()=>{const headers={'Content-Type':'application/json'};const request=async(method,path,body)=>{const response=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(JSON.stringify(data));return data};const school=await request('POST','/api/schools',{name:'P18 浏览器脱敏学校',contacts:[{name:'负责人',phone:'13800018200',isDefault:true}]});const project=await request('POST','/api/projects',{id:'p18-browser',schoolId:school.id,grade:'六年级',destination:'脱敏基地',startsOn:'2026-12-10',endsOn:'2026-12-10'});await request('POST','/api/projects/'+project.id+'/recalculate',{});return project.id})()`);
  await client.evaluate(`location.hash='/exceptions?project=${projectId}'`); await client.waitFor(`document.querySelectorAll('#exception-list [data-exception-id]').length>=3`);
  const initial = await client.evaluate(`({title:document.querySelector('h1').textContent,project:document.querySelector('#exception-filter [name=projectId]').value,blockers:document.querySelector('#exception-blockers').textContent,reminders:document.querySelector('#exception-reminders').textContent,rows:document.querySelectorAll('#exception-list [data-exception-id]').length,blockerConfirm:[...document.querySelectorAll('#exception-list [data-exception-id]')].filter(row=>row.textContent.includes('阻断')).some(row=>row.querySelector('[data-confirm-exception]')),overflow:document.documentElement.scrollWidth>innerWidth})`);
  assert.equal(initial.title, '异常中心'); assert.equal(initial.project, projectId); assert.ok(Number(initial.blockers) >= 2); assert.equal(initial.reminders, '1'); assert.equal(initial.blockerConfirm, false); assert.equal(initial.overflow, false);
  await client.evaluate(`document.querySelector('[data-confirm-exception][data-exception-message*="集合地点"]').click()`); await client.waitFor(`document.querySelector('#exception-confirm-dialog').open`);
  await client.evaluate(`(()=>{const form=document.querySelector('#exception-confirm-form');form.elements.reason.value='学校尚未最终通知，负责人已电话核对';form.requestSubmit()})()`); await client.waitFor(`document.querySelector('#exception-action-message').textContent.includes('例外已确认')`);
  await client.evaluate(`(()=>{const form=document.querySelector('#exception-filter');form.elements.status.value='已确认例外';form.requestSubmit()})()`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const filtered = await client.evaluate(`({count:document.querySelectorAll('#exception-list [data-exception-id]').length,result:document.querySelector('#exception-result-count').textContent,text:document.querySelector('#exception-list').textContent,status:document.querySelector('#exception-filter').elements.status.value,message:document.querySelector('#exception-action-message').textContent})`);
  assert.equal(filtered.count, 1, JSON.stringify(filtered)); assert.match(filtered.text, /负责人已电话核对/);
  await client.evaluate(`document.querySelector('#recalculate-project').click()`); await client.waitFor(`document.querySelector('#exception-action-message').textContent.includes('重新校验完成')`);
  assert.equal(await client.evaluate(`document.querySelectorAll('#exception-list [data-exception-id]').length`), 1, '重算后已确认例外保持单条');
  await client.evaluate(`document.querySelector('#exception-list [data-exception-id] a').click()`); await client.waitFor(`document.querySelector('#project-form-root form')`);
  assert.match(await client.evaluate(`location.hash`), /\/projects\/new\?id=p18-browser&exception=/);
  assert.match(await client.evaluate(`document.querySelector('#project-form').style.outline`), /solid/);
  await client.evaluate(`(async()=>{const response=await fetch('/api/projects/${projectId}',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({meetingPlace:'学校南门'})});if(!response.ok)throw new Error(await response.text());location.hash='/exceptions?project=${projectId}&status=已解决'})()`); await client.waitFor(`document.querySelector('#exception-list [data-exception-id]')?.textContent.includes('MEETING_PLACE_MISSING')`);
  const resolved = await client.evaluate(`({status:document.querySelector('#exception-list [data-exception-id]').textContent,overflow:document.documentElement.scrollWidth>innerWidth})`); assert.match(resolved.status,/已解决/); assert.equal(resolved.overflow,false);
  mkdirSync(resolve('test-results'), { recursive: true }); const shot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(resolve('test-results','t22-p18-exceptions-1366x768.png'), Buffer.from(shot.data, 'base64'));
  assert.deepEqual(consoleErrors, []);
});
