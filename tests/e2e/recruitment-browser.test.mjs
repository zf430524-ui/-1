import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findEdge, openHeadlessEdge } from '../helpers/cdp-browser.mjs';

process.argv.push('--allow-dev-unlock');
process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_SENSITIVE_KEY = 'recruitment-browser-sensitive-key';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P06 浏览器在 1366×768 完成通知复制、6 行预览和人工确认', async (context) => {
  const edgePath = findEdge(); if (!edgePath) return context.skip('本机未安装 Edge');
  const server = createWorkbenchServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await openHeadlessEdge(edgePath);
  context.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const { client } = browser; const base = `http://127.0.0.1:${server.address().port}`;
  await client.command('Page.navigate', { url: `${base}/__dev/unlock?to=/projects/recruitment` });
  await client.waitFor(`document.querySelector('#recruitment-page-root')`);
  const seeded = await client.evaluate(`(async()=>{const headers={'Content-Type':'application/json'};const post=async(path,body)=>{const response=await fetch(path,{method:'POST',headers,body:JSON.stringify(body)});if(!response.ok)throw new Error(await response.text());return response.json()};const school=await post('/api/schools',{name:'P06 浏览器学校',contacts:[{name:'校方联系人',phone:'13800000900',isDefault:true}]});const project=await post('/api/projects',{schoolId:school.id,grade:'六年级',destination:'韶山',startsOn:'2026-10-16',endsOn:'2026-10-17',needsLodging:true});const classes=['601','602','603'].map((name,index)=>({name,studentTotal:40,boys:20,girls:20,guideRequired:1,teachers:[{role:'班主任',name:name+'老师',phone:'1380000090'+(index+1),gender:'女',ridesVehicle:true,needsLodging:true,joinsDefaultMeals:false}]}));await post('/api/projects/'+project.id+'/people',{classes,manualStaff:[]});const guideInputs=[['王晨','13800000001'],['李敏','13800000002'],['周妍','13800000003'],['陈浩','13800000004'],['刘芳','13800000005'],['赵琳','13800000006']];let lastGuide=null;for(const [name,workPhone] of guideInputs)lastGuide=await post('/api/guides',{name,workPhone,gender:'未填写'});return {projectId:project.id,lastGuideId:lastGuide.id}})()`);
  await client.evaluate(`location.hash='/projects/recruitment?project=${seeded.projectId}'`);
  await client.waitFor(`document.querySelector('#notice-output')?.value.includes('需要导游：3 名')`);
  assert.deepEqual(await client.evaluate(`({title:document.querySelector('h1')?.textContent,guideCount:document.querySelector('[name=guideCount]')?.value,schoolHidden:!document.querySelector('#notice-output').value.includes('P06 浏览器学校'),overflow:document.documentElement.scrollWidth>innerWidth})`), { title: '招募通知与接龙导入', guideCount: '3', schoolHidden: true, overflow: false });

  await client.evaluate(`(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{window.__copiedNotice=text}}});const school=document.querySelector('[name=showSchool]');const grade=document.querySelector('[name=showGrade]');school.checked=true;grade.checked=true;school.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await client.waitFor(`document.querySelector('#notice-output')?.value.includes('学校：P06 浏览器学校') && document.querySelector('#notice-output')?.value.includes('年级：六年级')`);
  await client.evaluate(`document.querySelector('#copy-notice').click()`);
  await client.waitFor(`window.__copiedNotice?.includes('需要导游：3 名') && document.querySelector('#copy-status')?.textContent==='已复制到剪贴板'`);
  const noExternalAction = await client.evaluate(`![...document.querySelectorAll('button,a')].some((node)=>/发送到微信|自动发群|群二维码/.test(node.textContent))`);
  assert.equal(noExternalAction, true);

  await client.evaluate(`(()=>{const form=document.querySelector('#signup-form');form.elements.notes.value='第一轮接龙';form.elements.rawText.value='1. 王晨 13800000001\\n2. 李敏 13800000002\\n3. 周妍 13800000003\\n4. 陈浩 13800000004\\n5. 刘芳 13800000005\\n6. 赵琳';form.requestSubmit();return true})()`);
  await client.waitFor(`document.querySelectorAll('.recruitment-preview-row').length===6`);
  const preview = await client.evaluate(`({sequences:[...document.querySelectorAll('.recruitment-preview-row>div:first-child>b')].map((node)=>node.textContent),statuses:[...document.querySelectorAll('.recruitment-preview-row>.status-tag')].map((node)=>node.textContent),selectValue:document.querySelector('[data-preview-order="6"] [data-resolution-guide]')?.value||'',overflow:document.documentElement.scrollWidth>innerWidth})`);
  assert.deepEqual(preview.sequences, ['1', '2', '3', '4', '5', '6']); assert.deepEqual(preview.statuses, ['已匹配', '已匹配', '已匹配', '已匹配', '已匹配', '待确认']); assert.equal(preview.selectValue, ''); assert.equal(preview.overflow, false);
  await client.evaluate(`document.querySelector('#recruitment-preview').scrollIntoView({block:'start'})`);
  const screenshot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  mkdirSync(resolve('test-results'), { recursive: true });
  writeFileSync(resolve('test-results', 't17-p06-recruitment-preview-1366x768.png'), Buffer.from(screenshot.data, 'base64'));

  await client.evaluate(`(()=>{const select=document.querySelector('[data-preview-order="6"] [data-resolution-guide]');select.value='${seeded.lastGuideId}';select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#confirm-recruitment').click();return true})()`);
  await client.waitFor(`document.querySelector('.recruitment-batch')?.textContent.includes('第一轮接龙')`);
  const saved = await client.evaluate(`({batchCount:document.querySelectorAll('.recruitment-batch').length,summary:document.querySelector('.recruitment-batch summary')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth})`);
  assert.equal(saved.batchCount, 1); assert.match(saved.summary, /6\/6 已匹配/); assert.equal(saved.overflow, false);
});
