import assert from 'node:assert/strict';
import { seedState, dateOverlaps, validateClassCounts, vehicleAssignments, validateRooms, confirmGuide, toCsv } from '../domain.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const tests=[];
const test=(name,fn)=>tests.push([name,fn]);

test('班级总人数等于男生与女生人数之和',()=>assert.equal(validateClassCounts(seedState.classes).every(item=>item.valid),true));
test('日期冲突覆盖同日、交叉和包含，相邻日期不冲突',()=>{
  assert.equal(dateOverlaps('2026-09-23','2026-09-23','2026-09-23','2026-09-23'),true);
  assert.equal(dateOverlaps('2026-09-22','2026-09-24','2026-09-23','2026-09-25'),true);
  assert.equal(dateOverlaps('2026-09-20','2026-09-30','2026-09-23','2026-09-24'),true);
  assert.equal(dateOverlaps('2026-09-22','2026-09-22','2026-09-23','2026-09-24'),false);
});
test('有冲突的导游不能确认且无冲突导游可以锁档',()=>{
  const state=clone(seedState);
  assert.equal(confirmGuide(state,'g4').ok,false);
  assert.equal(confirmGuide(state,'g3').ok,true);
  assert.equal(state.applicants.find(item=>item.id==='g3').status,'已确认');
  assert.equal(state.classes.find(item=>item.guideId==='g3').guideStatus,'已确认');
  assert.equal(state.classes.filter(item=>item.guide==='周昕').length,1);
  assert.equal(state.confirmedAssignments.some(item=>item.guideId==='g3'&&item.projectId===state.project.id),true);
  assert.equal(state.requests.some(item=>item.guide==='周昕'&&item.type.includes('确认')),false);
});
test('人员齐备后未入选人员进入候补且不再计为待确认',()=>{
  const state=clone(seedState);
  confirmGuide(state,'g3');
  confirmGuide(state,'g2');
  assert.equal(state.applicants.filter(item=>item.status==='已确认').length,3);
  assert.equal(state.applicants.find(item=>item.id==='g4').status,'候补');
});
test('车辆人数包含学生、老师和已确认导游且建议不超载',()=>{
  const rows=vehicleAssignments(seedState.classes,seedState.vehicles,0);
  assert.equal(rows[0].people,45);
  assert.equal(rows.every(item=>item.valid),true);
});
test('人工改为小车后立即识别超载及缺少座位数',()=>{
  const state=clone(seedState);state.classes[0].vehicle='湘A·B0231';
  const row=vehicleAssignments(state.classes,state.vehicles,0)[0];
  assert.equal(row.valid,false);assert.equal(row.spare,-16);
});
test('住宿建议不超容量并识别跨班拼房',()=>{
  const rooms=validateRooms(seedState.rooms);
  assert.equal(rooms.every(room=>room.valid),true);
  assert.equal(rooms.filter(room=>room.mixedClass).length,4);
  assert.equal(rooms.some(room=>room.gender==='男生'),true);
  assert.equal(rooms.some(room=>room.gender==='女生'),true);
});
test('乘车表 CSV 带 UTF-8 BOM、约定字段和合计数据',()=>{
  const csv=toCsv(seedState);
  assert.equal(csv.charCodeAt(0),0xFEFF);
  for(const field of ['项目','班级','学生人数','导游','车牌','空余座位'])assert.equal(csv.includes(field),true);
  assert.equal(csv.split('\r\n').length,4);
});
test('模拟数据不包含身份证号或导游证图片字段',()=>{
  const text=JSON.stringify(seedState);
  assert.equal(/身份证|导游证照片|idCard/i.test(text),false);
});

let failed=0;
for(const [name,fn] of tests){try{fn();console.log(`PASS ${name}`)}catch(error){failed++;console.error(`FAIL ${name}`);console.error(error.message)}}
console.log(`\n${tests.length-failed}/${tests.length} tests passed`);
if(failed)process.exitCode=1;
