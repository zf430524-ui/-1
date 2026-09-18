import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findEdge, openHeadlessEdge } from '../helpers/cdp-browser.mjs';

process.argv.push('--allow-dev-unlock');
process.env.WORKBENCH_TEST_MODE = '1';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P02/P03 浏览器在 1366×768 完成空列表、新建、筛选、编辑和状态展示', async (context) => {
  const edgePath = findEdge();
  if (!edgePath) return context.skip('本机未安装 Edge');
  const server = createWorkbenchServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await openHeadlessEdge(edgePath);
  context.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const { client } = browser;
  const base = `http://127.0.0.1:${server.address().port}`;

  await client.command('Page.navigate', { url: `${base}/__dev/unlock?to=/projects` });
  await client.waitFor(`document.querySelector('#project-result-count')?.textContent === '0 个项目'`);
  assert.deepEqual(await client.evaluate(`({title:document.querySelector('h1')?.textContent,empty:document.querySelector('#project-list')?.textContent.includes('没有符合条件的项目'),overflow:document.documentElement.scrollWidth>innerWidth})`), { title: '研学项目列表', empty: true, overflow: false });

  await client.command('Page.navigate', { url: `${base}/#/schools` });
  await client.waitFor(`document.querySelector('#school-result-count')?.textContent === '0 所学校'`);
  await client.evaluate(`document.querySelector('#new-school').click()`);
  await client.waitFor(`document.querySelector('#school-dialog')?.open && document.querySelector('#school-form')`);
  await client.evaluate(`(() => { const form=document.querySelector('#school-form'); form.elements.name.value='浏览器项目学校'; form.querySelector('[name=contactName]').value='周老师'; form.querySelector('[name=contactPhone]').value='13800000001'; form.requestSubmit(); return true; })()`);
  await client.waitFor(`document.querySelector('#school-list')?.textContent.includes('浏览器项目学校')`);

  await client.command('Page.navigate', { url: `${base}/#/projects/new` });
  await client.waitFor(`document.querySelector('#project-form')?.elements.schoolId.options.length > 1`);
  await client.evaluate(`(() => { const form=document.querySelector('#project-form'); form.elements.schoolId.selectedIndex=1; form.elements.schoolId.dispatchEvent(new Event('change')); form.elements.grade.value='六年级'; form.elements.destination.value='浏览器脱敏营地'; form.elements.startsOn.value='2026-10-20'; form.elements.startsOn.dispatchEvent(new Event('change')); form.elements.endsOn.value='2026-10-21'; form.elements.endsOn.dispatchEvent(new Event('input')); form.elements.needsLodging.checked=true; form.elements.includesMeals.checked=true; form.elements.includesMeals.dispatchEvent(new Event('input')); form.elements.mealCount.value='2'; form.querySelector('[data-save-mode=draft]').click(); return true; })()`);
  await client.waitFor(`location.hash.startsWith('#/projects?query=') && document.querySelector('.project-row')?.textContent.includes('浏览器项目学校')`);
  const created = await client.evaluate(`({id:document.querySelector('.project-row')?.dataset.projectId,status:document.querySelector('.project-row .status-tag')?.textContent,trip:document.querySelector('.project-row')?.textContent.includes('多日游'),lodging:document.querySelector('.project-row')?.textContent.includes('需住宿'),meals:document.querySelector('.project-row')?.textContent.includes('含餐 2 次'),overflow:document.documentElement.scrollWidth>innerWidth})`);
  assert.equal(created.status, '资料待补充'); assert.equal(created.trip, true); assert.equal(created.lodging, true); assert.equal(created.meals, true); assert.equal(created.overflow, false);

  await client.evaluate(`document.querySelector('.project-row a[href*="/projects/new?id="]').click()`);
  await client.waitFor(`document.querySelector('#project-form')?.dataset.projectId === '${created.id}'`);
  assert.equal(await client.evaluate(`document.documentElement.scrollWidth>innerWidth`), false);
  const formScreenshot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const outputDir = resolve('test-results'); mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 't11-p03-edit-form-1366x768.png'), Buffer.from(formScreenshot.data, 'base64'));
  await client.evaluate(`(() => { const form=document.querySelector('#project-form'); form.elements.meetingPlace.value='学校东门'; form.elements.meetingAt.value='2026-10-20T07:30'; form.elements.itinerary.value='浏览器脱敏行程'; form.elements.schoolLeadName.value='项目联系人'; form.elements.schoolLeadPhone.value='13800000002'; form.querySelector('[data-save-mode=draft]').click(); return true; })()`);
  await client.waitFor(`location.hash.startsWith('#/projects?query=') && document.querySelector('.project-row')`);
  await client.evaluate(`(() => { const form=document.querySelector('#project-filter'); form.elements.query.value='浏览器脱敏营地'; form.elements.startsFrom.value='2026-10-01'; form.elements.startsTo.value='2026-10-31'; [...form.querySelectorAll('[name=status]')].find(input=>input.value==='资料待补充').checked=true; form.requestSubmit(); return true; })()`);
  await client.waitFor(`document.querySelector('#project-result-count')?.textContent === '1 个项目' && document.querySelector('#project-filter').elements.query.value === '浏览器脱敏营地'`);
  const filtered = await client.evaluate(`({count:document.querySelector('#project-result-count')?.textContent,query:document.querySelector('#project-filter').elements.query.value,status:document.querySelector('.project-row .status-tag')?.textContent,notFaked:!document.querySelector('.project-row')?.textContent.includes('无阻断'),overflow:document.documentElement.scrollWidth>innerWidth})`);
  assert.deepEqual(filtered, { count: '1 个项目', query: '浏览器脱敏营地', status: '资料待补充', notFaked: true, overflow: false });

  const screenshot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve(outputDir, 't11-p02-p03-browser-flow-1366x768.png'), Buffer.from(screenshot.data, 'base64'));
});
