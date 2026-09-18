import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findEdge, openHeadlessEdge } from '../helpers/cdp-browser.mjs';

process.argv.push('--allow-dev-unlock');
process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_SENSITIVE_KEY = 'dashboard-browser-sensitive-key';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P01/P04 浏览器显示真实空态、聚合指标、人员来源和下一步', async (context) => {
  const edgePath = findEdge(); if (!edgePath) return context.skip('本机未安装 Edge');
  const server = createWorkbenchServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const browser = await openHeadlessEdge(edgePath);
  context.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const { client } = browser; const base = `http://127.0.0.1:${server.address().port}`;
  await client.command('Page.navigate', { url: `${base}/__dev/unlock?to=/` });
  await client.waitFor(`document.querySelector('#dashboard-root .dashboard-empty')`);
  assert.deepEqual(await client.evaluate(`({metrics:[...document.querySelectorAll('[data-dashboard-metric] strong')].map(node=>Number(node.textContent)),empty:document.querySelector('.dashboard-empty h3').textContent})`), {
    metrics: [0, 0, 0, 0], empty: '未来 7 天没有出团项目'
  });

  const fixture = await client.evaluate(`(async()=>{const headers={'Content-Type':'application/json'};const post=async(path,body)=>{const response=await fetch(path,{method:'POST',headers,body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(JSON.stringify(data));return data};const dashboard=await (await fetch('/api/dashboard')).json();const date=new Date(dashboard.asOf+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+2);const startsOn=date.toISOString().slice(0,10);const school=await post('/api/schools',{name:'T23 浏览器脱敏学校',contacts:[{name:'联系人',phone:'13800002320',isDefault:true}]});const project=await post('/api/projects',{id:'t23-browser',schoolId:school.id,grade:'八年级',destination:'脱敏基地',startsOn,endsOn:startsOn,meetingPlace:'学校门口',meetingAt:startsOn+'T07:00',itinerary:'脱敏行程'});const people=await post('/api/projects/'+project.id+'/people',{classes:[{id:'t23-browser-c1',name:'801',studentTotal:40,boys:20,girls:20,guideRequired:1,teachers:[{name:'浏览器老师',phone:'13800002321',gender:'女',ridesVehicle:true}]}],manualStaff:[]});const guide=await post('/api/guides',{name:'浏览器导游',workPhone:'13900002321',gender:'女',documents:[{documentType:'导游证',expiresOn:dashboard.through}]});const batch=await post('/api/projects/'+project.id+'/recruitment',{rawText:'T23 浏览器接龙',entries:[{order:1,name:guide.name,phone:'13900002321'}]});await post('/api/project-guides/'+batch.rows[0].id+'/assign',{classIds:[people.classes[0].id]});return {projectId:project.id,guideId:guide.id,projectGuideId:batch.rows[0].id}})()`);
  await client.evaluate(`location.hash='/projects'`); await client.waitFor(`document.querySelector('[data-project-id="${fixture.projectId}"]')`);
  await client.evaluate(`location.hash='/'`); await client.waitFor(`document.querySelector('[data-dashboard-project="${fixture.projectId}"]')`);
  const dashboardState = await client.evaluate(`({metrics:Object.fromEntries([...document.querySelectorAll('[data-dashboard-metric]')].map(node=>[node.dataset.dashboardMetric,Number(node.querySelector('strong').textContent)])),rows:document.querySelectorAll('.dashboard-project-row').length,projectText:document.querySelector('[data-dashboard-project="${fixture.projectId}"]').textContent,overflow:document.documentElement.scrollWidth>innerWidth})`);
  assert.equal(dashboardState.metrics.upcoming, 1);
  assert.ok(dashboardState.metrics.blockers > 0);
  assert.equal(dashboardState.metrics.guides, 0);
  assert.equal(dashboardState.metrics.documents, 1);
  assert.equal(dashboardState.rows, 1);
  assert.match(dashboardState.projectText, /继续处理/);
  assert.equal(dashboardState.overflow, false);
  mkdirSync(resolve('test-results'), { recursive: true });
  let shot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve('test-results', 't23-p01-dashboard-1366x768.png'), Buffer.from(shot.data, 'base64'));

  await client.evaluate(`document.querySelector('[data-dashboard-project="${fixture.projectId}"] a').click()`);
  await client.waitFor(`document.querySelector('.overview-workspace[data-project-id="${fixture.projectId}"]')`);
  const overviewState = await client.evaluate(`({next:document.querySelector('.overview-next h2').textContent,lodging:document.querySelector('[data-stage="lodging"] .stage-status').textContent,meals:document.querySelector('[data-stage="meals"] .stage-status').textContent,staff:[...document.querySelectorAll('[data-staff-source]')].map(node=>node.dataset.staffSource).sort(),guideArchive:document.querySelector('[data-staff-source="project_guide"] a[href*="/guides/detail"]')?.getAttribute('href')||'',guideEdit:document.querySelector('[data-staff-source="project_guide"] a').getAttribute('href'),completeDisabled:document.querySelector('#complete-overview').disabled,overflow:document.documentElement.scrollWidth>innerWidth})`);
  assert.deepEqual(overviewState, { next: '乘车安排', lodging: '不适用', meals: '不适用', staff: ['project_guide', 'teacher'],
    guideArchive: `#/guides/detail?id=${fixture.guideId}`, guideEdit: `#/projects/guides?project=${fixture.projectId}&focus=${fixture.projectGuideId}`, completeDisabled: true, overflow: false });
  await client.evaluate(`document.querySelector('#recalculate-overview').click()`);
  await client.waitFor(`document.querySelector('.overview-message')?.textContent.includes('重新校验完成')`);
  shot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve('test-results', 't23-p04-overview-1366x768.png'), Buffer.from(shot.data, 'base64'));
});
