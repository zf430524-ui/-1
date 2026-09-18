import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'meals-e2e-password';
process.env.WORKBENCH_SENSITIVE_KEY = 'meals-e2e-sensitive-key';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P10 API：基础建议、工作人员追加、多餐厅隔离、重复桌号和来源联动', async (context) => {
  const server = createWorkbenchServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`; const baseHeaders = { Host: `127.0.0.1:${server.address().port}`, Origin: base, 'Content-Type': 'application/json' };
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ password: 'meals-e2e-password' }) }); const headers = { ...baseHeaders, Cookie: login.headers.get('set-cookie').split(';')[0] };
  const request = async (method, path, body) => { const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); return { response, data: await response.json() }; }; const post = (path, body) => request('POST', path, body);
  const school = (await post('/api/schools', { name: 'P10 API 脱敏学校', contacts: [{ name: '联系人', phone: '13800010200', isDefault: true }] })).data;
  const project = (await post('/api/projects', { id: 'p10-api-main', schoolId: school.id, grade: '八年级', destination: '脱敏基地', startsOn: '2026-10-10', endsOn: '2026-10-11', includesMeals: true, mealCount: 2 })).data;
  const specs = [['mc801','801',42,22,20,2],['mc802','802',43,21,22,2],['mc803','803',40,20,20,1]];
  const peoplePayload = { classes: specs.map(([id,name,studentTotal,boys,girls,count], ci) => ({ id,name,studentTotal,boys,girls,guideRequired:1,teachers:Array.from({ length: count },(_,i)=>({ role:i?'配班老师':'班主任',name:`${name}老师${i+1}`,phone:`138000102${ci}${i}1`,gender:i?'女':'男',ridesVehicle:true,needsLodging:false,joinsDefaultMeals:true })) })), manualStaff: [] };
  const people = (await post(`/api/projects/${project.id}/people`, peoplePayload)).data;
  const guideSpecs = [['API导游甲','13900010201','男'],['API导游乙','13900010202','女'],['API导游丙','13900010203','女']]; for (const [name,workPhone,gender] of guideSpecs) await post('/api/guides',{name,workPhone,gender});
  const batch = (await post(`/api/projects/${project.id}/recruitment`, { rawText:'P10 API 接龙',entries:guideSpecs.map(([name,phone],index)=>({order:index+1,name,phone})) })).data; for (let index=0;index<3;index+=1) await post(`/api/project-guides/${batch.rows[index].id}/assign`,{classIds:[people.classes[index].id],needsLodging:false,joinsDefaultMeals:true});
  const vehicles=[1,2,3].map((number)=>({vehicleLabel:`${number}车`,fleetName:'脱敏车队',vehicleModel:'49座大巴',capacity:49,plateNumber:`湘A1020${number}`,driverName:`司机${number}`,driverPhone:`1370001020${number}`,driverGender:'男',driverJoinsDefaultMeals:true})); const transport=(await post(`/api/projects/${project.id}/transport/suggest`,{vehicles})).data; await post(`/api/projects/${project.id}/transport`,{vehicles:transport.vehicles});
  const drafts=[{name:'第一餐',restaurantName:'验收餐厅 A',mealAt:'2026-10-10T12:00',seatsPerTable:10,tablePrefix:'A',tables:[]},{name:'第二餐',restaurantName:'验收餐厅 B',mealAt:'2026-10-10T18:00',seatsPerTable:10,tablePrefix:'B',tables:[]}];
  const baseSuggestion=await post(`/api/projects/${project.id}/meals/suggest`,{sessions:drafts}); assert.equal(baseSuggestion.response.status,200); assert.ok(baseSuggestion.data.sessions.every((row)=>row.tables.length===13&&row.suggestion.unassigned===8)); assert.equal((await request('GET',`/api/projects/${project.id}`)).data.meals.length,0);
  let saved=await post(`/api/projects/${project.id}/meals`,{sessions:baseSuggestion.data.sessions}); assert.ok(saved.data.exceptions.some((row)=>row.code==='MEAL_CAPACITY_SHORTAGE'&&row.status==='待处理'));
  const finalSuggestion=await post(`/api/projects/${project.id}/meals/suggest`,{sessions:drafts,includeStaff:true}); assert.ok(finalSuggestion.data.sessions.every((row)=>row.tables.length===14&&row.suggestion.allocated===136));
  saved=await post(`/api/projects/${project.id}/meals`,{sessions:finalSuggestion.data.sessions}); assert.equal(saved.response.status,200); assert.deepEqual(saved.data.meals.map((row)=>[row.restaurant_name,row.actual_tables,row.allocated,row.tables[0].table_number,row.tables.at(-1).table_number]),[['验收餐厅 A',14,136,'A01','A14'],['验收餐厅 B',14,136,'B01','B14']]);
  const duplicate=structuredClone(finalSuggestion.data.sessions); duplicate[0].tables[1].tableNumber='A01'; const rejected=await post(`/api/projects/${project.id}/meals`,{sessions:duplicate}); assert.equal(rejected.response.status,400); assert.equal(rejected.data.code,'DUPLICATE_MEAL_TABLE_NUMBER');
  const changed=structuredClone(peoplePayload); changed.classes[0].teachers.push({role:'配班老师',name:'新增老师',phone:'13800010299',gender:'女',ridesVehicle:true,needsLodging:false,joinsDefaultMeals:true}); saved=await post(`/api/projects/${project.id}/people`,changed); assert.ok(saved.data.exceptions.some((row)=>row.code==='MEAL_PEOPLE_MISMATCH'&&row.status==='待处理'));
});
