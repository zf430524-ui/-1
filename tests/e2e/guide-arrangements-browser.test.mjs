import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findEdge, openHeadlessEdge } from '../helpers/cdp-browser.mjs';

process.argv.push('--allow-dev-unlock');
process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_SENSITIVE_KEY = 'guide-arrangements-browser-sensitive-key';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P07 浏览器在 1366×768 完成冲突识别、顺序建议、移出、替换与退团', async (context) => {
  const edgePath = findEdge(); if (!edgePath) return context.skip('本机未安装 Edge');
  const server = createWorkbenchServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await openHeadlessEdge(edgePath);
  context.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const { client } = browser; const base = `http://127.0.0.1:${server.address().port}`;
  await client.command('Page.navigate', { url: `${base}/__dev/unlock?to=/projects/guides` });
  await client.waitFor(`document.querySelector('#project-guides-root')`);
  const seeded = await client.evaluate(`(async()=>{const headers={'Content-Type':'application/json'};const request=async(method,path,body)=>{const response=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(method+' '+path+' '+JSON.stringify(data));return data};const post=(path,body)=>request('POST',path,body);const school=await post('/api/schools',{name:'P07 浏览器学校',contacts:[{name:'校方联系人',phone:'13800000900',isDefault:true}]});const makeProject=async(id,startsOn,endsOn,names)=>{const project=await post('/api/projects',{id,schoolId:school.id,grade:'八年级',destination:'脱敏研学地',startsOn,endsOn,needsLodging:startsOn!==endsOn,includesMeals:true,mealCount:1});const people=await post('/api/projects/'+project.id+'/people',{classes:names.map((name,index)=>({id:id+'-c'+(index+1),name,studentTotal:40+index,boys:20,girls:20+index,guideRequired:1,teachers:[{role:'班主任',name:name+'老师',phone:'1380000090'+(index+1),gender:'女',ridesVehicle:true,needsLodging:startsOn!==endsOn,joinsDefaultMeals:true}]})),manualStaff:[]});return {project,classes:people.classes}};const specs=[['王晨','13800000001','男','2027-12-31'],['李敏','13800000002','女','2027-12-31'],['周妍','13800000003','女','2027-12-31'],['陈浩','13800000004','男','2026-10-15'],['刘芳','13800000005','女','2027-12-31'],['赵琳','13800000006','男','2027-12-31']];for(const [name,workPhone,gender,expiresOn] of specs)await post('/api/guides',{name,workPhone,gender,documents:[{documentType:'导游证',expiresOn}]});const occupied=await makeProject('p07-browser-conflict','2026-10-16','2026-10-16',['参照班']);const occupiedBatch=await post('/api/projects/'+occupied.project.id+'/recruitment',{rawText:'1. 李敏 13800000002',entries:[{order:1,name:'李敏',phone:'13800000002'}]});await post('/api/project-guides/'+occupiedBatch.rows[0].id+'/assign',{classIds:[occupied.classes[0].id],needsLodging:false,joinsDefaultMeals:true});const main=await makeProject('p07-browser-main','2026-10-16','2026-10-17',['801','802','803']);const batch=await post('/api/projects/'+main.project.id+'/recruitment',{rawText:specs.map((row,index)=>(index+1)+'. '+row[0]+' '+row[1]).join('\\n'),entries:specs.map((row,index)=>({order:index+1,name:row[0],phone:row[1]}))});return {projectId:main.project.id,rows:Object.fromEntries(batch.rows.map(row=>[row.name,row.id]))}})()`);
  await client.evaluate(`location.hash='/projects/guides?project=${seeded.projectId}'`);
  await client.waitFor(`document.querySelectorAll('[data-project-guide]').length===6`);
  const initial = await client.evaluate(`(()=>{const card=id=>document.querySelector('[data-project-guide="'+id+'"]');return {title:document.querySelector('h1')?.textContent,conflict:card('${seeded.rows.李敏}').textContent.includes('p07-browser-conflict')||card('${seeded.rows.李敏}').textContent.includes('P07 浏览器学校'),conflictLabel:card('${seeded.rows.李敏}').textContent.includes('日期冲突'),expired:card('${seeded.rows.陈浩}').textContent.includes('证件过期'),blockedButtons:[card('${seeded.rows.李敏}').querySelector('[type=submit]').disabled,card('${seeded.rows.陈浩}').querySelector('[type=submit]').disabled],overflow:document.documentElement.scrollWidth>innerWidth}})()`);
  assert.equal(initial.title, '导游安排'); assert.equal(initial.conflict, true); assert.equal(initial.conflictLabel, true); assert.equal(initial.expired, true); assert.deepEqual(initial.blockedButtons, [true, true]); assert.equal(initial.overflow, false);
  await client.evaluate(`document.querySelector('[data-project-guide="${seeded.rows.李敏}"]').scrollIntoView({block:'center'})`);
  const initialShot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  mkdirSync(resolve('test-results'), { recursive: true }); writeFileSync(resolve('test-results', 't18-p07-guide-conflicts-1366x768.png'), Buffer.from(initialShot.data, 'base64'));

  await client.evaluate(`document.querySelector('#suggest-guides').click()`);
  await client.waitFor(`document.querySelectorAll('.guide-assignment-form[data-suggested="true"]').length===3 && !document.querySelector('#save-guide-suggestions').classList.contains('hidden')`);
  await client.evaluate(`(()=>{document.querySelectorAll('.guide-assignment-form[data-suggested="true"]').forEach(form=>{form.elements.needsLodging.checked=true;form.elements.joinsDefaultMeals.checked=true});document.querySelector('#save-guide-suggestions').click();return true})()`);
  await client.waitFor(`document.querySelector('[data-guide-metric="arranged"]')?.textContent==='3' && document.querySelector('[data-guide-metric="gap"]')?.textContent==='0'`);
  const assigned = await client.evaluate(`(async()=>{const staff=(await (await fetch('/api/projects/${seeded.projectId}')).json()).staff.filter(row=>row.source_type==='project_guide');return {names:[...document.querySelectorAll('.project-guide-card')].filter(card=>card.querySelector('input[name=classId]:checked')).map(card=>card.querySelector('.guide-identity h3').textContent),staff:{count:staff.length,male:staff.filter(row=>row.gender==='男').length,female:staff.filter(row=>row.gender==='女').length,lodging:staff.reduce((sum,row)=>sum+row.lodging_count,0),meals:staff.reduce((sum,row)=>sum+row.default_meal_count,0)},overflow:document.documentElement.scrollWidth>innerWidth}})()`);
  assert.deepEqual(assigned.names, ['王晨', '周妍', '刘芳']); assert.deepEqual(assigned.staff, { count: 3, male: 1, female: 2, lodging: 3, meals: 3 }); assert.equal(assigned.overflow, false);

  await client.evaluate(`document.querySelector('[data-project-guide="${seeded.rows.赵琳}"] [data-guide-status="移出"]').click()`);
  await client.waitFor(`document.querySelector('[data-project-guide="${seeded.rows.赵琳}"]')?.dataset.handlingStatus==='移出'`);
  await client.evaluate(`document.querySelector('[data-project-guide="${seeded.rows.王晨}"] [data-replace-guide]').click()`);
  await client.waitFor(`document.querySelector('#guide-action-dialog').open`);
  await client.evaluate(`(()=>{const form=document.querySelector('#guide-action-form');form.elements.reason.value='浏览器脱敏替换原因';form.elements.replacementProjectGuideId.value='${seeded.rows.赵琳}';form.requestSubmit();return true})()`);
  await client.waitFor(`Boolean(document.querySelector('[data-project-guide="${seeded.rows.王晨}"]')?.dataset.handlingStatus==='已替换' || document.querySelector('#guide-action-error')?.textContent)`);
  assert.equal(await client.evaluate(`document.querySelector('#guide-action-error')?.textContent || ''`), '');
  await client.waitFor(`Boolean(document.querySelector('[data-project-guide="${seeded.rows.赵琳}"] input[name=classId]:checked'))`);
  const replacement = await client.evaluate(`(()=>{const oldCard=document.querySelector('[data-project-guide="${seeded.rows.王晨}"]');const nextCard=document.querySelector('[data-project-guide="${seeded.rows.赵琳}"]');return {history:oldCard.textContent.includes('浏览器脱敏替换原因')&&oldCard.textContent.includes('替换为 赵琳'),className:nextCard.querySelector('input[name=classId]:checked')?.closest('label').querySelector('b').textContent,arranged:document.querySelector('[data-guide-metric="arranged"]').textContent,gap:document.querySelector('[data-guide-metric="gap"]').textContent}})()`);
  assert.deepEqual(replacement, { history: true, className: '801', arranged: '3', gap: '0' });
  await client.evaluate(`document.querySelector('[data-project-guide="${seeded.rows.周妍}"] [data-withdraw-guide]').click()`);
  await client.waitFor(`document.querySelector('#guide-action-dialog').open`);
  await client.evaluate(`(()=>{const form=document.querySelector('#guide-action-form');form.elements.reason.value='浏览器脱敏退团原因';form.requestSubmit();return true})()`);
  await client.waitFor(`document.querySelector('[data-guide-metric="gap"]')?.textContent==='1' && document.querySelector('[data-project-guide="${seeded.rows.周妍}"]')?.dataset.handlingStatus==='已退团'`);
  const finalState = await client.evaluate(`(async()=>{const summary=await (await fetch('/api/projects/${seeded.projectId}')).json();return {arranged:summary.arrangedGuides,gaps:summary.guideCoverage.map(row=>row.assignedCount),guideStaff:summary.staff.filter(row=>row.source_type==='project_guide').length,withdrawal:summary.guides.find(row=>row.id==='${seeded.rows.周妍}').withdrawal.reason,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
  assert.deepEqual(finalState, { arranged: 2, gaps: [1, 0, 1], guideStaff: 2, withdrawal: '浏览器脱敏退团原因', overflow: false });
  await client.evaluate(`document.querySelector('[data-project-guide="${seeded.rows.周妍}"]').scrollIntoView({block:'center'})`);
  const screenshot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve('test-results', 't18-p07-guide-withdrawal-1366x768.png'), Buffer.from(screenshot.data, 'base64'));
});
