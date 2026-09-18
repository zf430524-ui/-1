import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findEdge, openHeadlessEdge } from '../helpers/cdp-browser.mjs';

process.argv.push('--allow-dev-unlock');
process.env.WORKBENCH_TEST_MODE = '1';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P05 浏览器在 1366×768 完成班级、老师、手工人员校验保存和改名', async (context) => {
  const edgePath = findEdge();
  if (!edgePath) return context.skip('本机未安装 Edge');
  const server = createWorkbenchServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await openHeadlessEdge(edgePath);
  context.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const { client } = browser; const base = `http://127.0.0.1:${server.address().port}`;

  await client.command('Page.navigate', { url: `${base}/__dev/unlock?to=/projects/people` });
  await client.waitFor(`document.querySelector('#people-page-root')`);
  const projectId = await client.evaluate(`(async()=>{const headers={'Content-Type':'application/json'};const school=await (await fetch('/api/schools',{method:'POST',headers,body:JSON.stringify({name:'P05 浏览器学校',contacts:[{name:'校方联系人',phone:'13800000000',isDefault:true}]})})).json();const project=await (await fetch('/api/projects',{method:'POST',headers,body:JSON.stringify({schoolId:school.id,grade:'八年级',destination:'浏览器脱敏基地',startsOn:'2026-11-01',endsOn:'2026-11-02',needsLodging:true,includesMeals:true,mealCount:3})})).json();return project.id})()`);
  await client.evaluate(`location.hash='/projects/people?project=${projectId}'`);
  await client.waitFor(`document.querySelector('#people-form')?.dataset.projectId === '${projectId}'`);
  assert.equal(await client.evaluate(`document.documentElement.scrollWidth>innerWidth`), false);

  await client.evaluate(`(()=>{for(let i=0;i<3;i++)document.querySelector('#add-class').click();const rows=[...document.querySelectorAll('[data-class-editor]')];const data=[['801',41,22,20],['802',43,21,22],['803',40,20,20]];rows.forEach((row,i)=>{const [name,total,boys,girls]=data[i];row.querySelector('[data-field=name]').value=name;row.querySelector('[data-field=studentTotal]').value=total;row.querySelector('[data-field=boys]').value=boys;row.querySelector('[data-field=girls]').value=girls;row.querySelector('[data-field=guideRequired]').value=1;const teacher=row.querySelector('[data-teacher-editor]');teacher.querySelector('[data-field=name]').value=['周老师','陈老师','王老师'][i];teacher.querySelector('[data-field=phone]').value='1380000000'+(i+1);teacher.querySelector('[data-field=gender]').value='女';teacher.querySelector('[data-field=needsLodging]').checked=true;teacher.querySelector('[data-field=joinsDefaultMeals]').checked=true});rows[0].querySelector('[data-add-teacher]').click();rows[1].querySelector('[data-add-teacher]').click();[rows[0],rows[1]].forEach((row,i)=>{const teacher=row.querySelectorAll('[data-teacher-editor]')[1];teacher.querySelector('[data-field=name]').value=['吴老师','李老师'][i];teacher.querySelector('[data-field=phone]').value='1380000000'+(i+4);teacher.querySelector('[data-field=gender]').value='男';teacher.querySelector('[data-field=needsLodging]').checked=true;teacher.querySelector('[data-field=joinsDefaultMeals]').checked=true});document.querySelector('#add-manual-staff').click();const manual=document.querySelector('[data-manual-staff]');manual.querySelector('[data-field=gender]').value='男';manual.querySelector('[data-field=peopleCount]').value=2;manual.querySelector('[data-field=lodgingCount]').value=2;manual.querySelector('[data-field=defaultMealCount]').value=2;manual.querySelector('[data-field=notes]').value='不采集姓名';document.querySelector('#validate-people').click();return true})()`);
  await client.waitFor(`document.querySelector('#people-validation')?.textContent.includes('学生总数 41 ≠ 男生 22 + 女生 20')`);

  await client.evaluate(`(()=>{const row=document.querySelector('[data-class-editor]');row.querySelector('[data-field=studentTotal]').value=42;document.querySelector('#people-form').requestSubmit();return true})()`);
  await client.waitFor(`document.querySelector('#people-validation')?.textContent.includes('基线已保存') && document.querySelector('[data-people-metric="学生"]')?.textContent === '125'`);
  const saved = await client.evaluate(`({classes:document.querySelector('[data-people-metric="班级"]')?.textContent,students:document.querySelector('[data-people-metric="学生"]')?.textContent,teachers:document.querySelector('[data-people-metric="老师"]')?.textContent,guides:document.querySelector('[data-people-metric="所需导游"]')?.textContent,staffRows:document.querySelectorAll('.staff-summary-panel tbody tr').length,noManualName:!document.querySelector('[data-manual-staff] [data-field=name]'),overflow:document.documentElement.scrollWidth>innerWidth})`);
  assert.deepEqual(saved, { classes: '3', students: '125', teachers: '5', guides: '3', staffRows: 8, noManualName: true, overflow: false });

  const identity = await client.evaluate(`(()=>{const row=document.querySelector('[data-class-editor]');const before=row.querySelector(':scope>[data-field=id]').value;row.querySelector('.class-fields [data-field=name]').value='801A';document.querySelector('#people-form').requestSubmit();return before})()`);
  await client.waitFor(`document.querySelector('.class-editor-heading strong')?.textContent === '801A' && document.querySelector('#people-validation')?.textContent.includes('基线已保存')`);
  assert.equal(await client.evaluate(`document.querySelector('[data-class-editor]>[data-field=id]').value`), identity);
  assert.equal(await client.evaluate(`document.documentElement.scrollWidth>innerWidth`), false);

  await client.evaluate(`scrollTo(0,0)`);
  const screenshot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const outputDir = resolve('test-results'); mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 't12-p05-people-browser-flow-1366x768.png'), Buffer.from(screenshot.data, 'base64'));
});
