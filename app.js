import { seedState, validateClassCounts, vehicleAssignments, validateRooms, confirmGuide, toCsv } from './domain.mjs';

const STORAGE_KEY = 'study-tour-dispatch-demo-v3';
const deepClone = value => JSON.parse(JSON.stringify(value));
const saved = localStorage.getItem(STORAGE_KEY);
let state = saved ? JSON.parse(saved) : deepClone(seedState);
state.draftProjects ||= [];
state.activities ||= [
  { type: '车辆已确认', detail: '初一（1）班 · 湘A·K2198', actor: '张磊', time: '09-07 08:42' },
  { type: '导游已确认', detail: '向晴已确认接团', actor: '田主管', time: '09-07 08:31' }
];
let currentView = 'dashboard';
let toastTimer;

const navItems = [
  ['dashboard', '工作台'], ['project', '研学项目'], ['recruitment', '导游招募'], ['vehicles', '车辆调度'],
  ['rooms', '住宿分房'], ['exports', '表格中心'], ['exceptions', '异常中心']
];

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const persist = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
const formatDate = value => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date(`${value}T00:00:00`));

function notify(message, error = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3200);
}

function statusTag(status) {
  const kind = ['已确认', '已安排', '已就绪', '通过'].includes(status) ? 'ok' : ['待确认', '待审核', '编排中', '需确认'].includes(status) ? 'warn' : status === '冲突' ? 'danger' : 'blue';
  return `<span class="tag ${kind}">${escapeHtml(status)}</span>`;
}

function renderNav() {
  $('#nav').innerHTML = navItems.map(([key, label]) => `<button class="nav-item ${currentView === key ? 'active' : ''}" data-view="${key}">${label}</button>`).join('');
}

function metrics() {
  const confirmed = state.applicants.filter(item => item.status === '已确认').length;
  const pending = state.applicants.filter(item => ['待确认', '待审核'].includes(item.status)).length;
  const vehicleErrors = vehicleAssignments(state.classes, state.vehicles, state.project.safetySeats).filter(item => !item.valid).length;
  return [
    ['项目', 1 + state.draftProjects.length, '近期研学项目', `${state.draftProjects.length} 个新草稿`, ''],
    ['导游', pending, '待处理导游', `已确认 ${confirmed}/${state.project.guideNeed}`, pending ? 'warn' : ''],
    ['车辆', vehicleErrors, '车辆缺口', vehicleErrors ? '存在容量异常' : '当前编排无超载', vehicleErrors ? 'danger' : ''],
    ['资料', 2, '资料待补齐', '司机电话、保险字段', 'warn']
  ];
}

function dashboardView() {
  const vehicleRows = vehicleAssignments(state.classes, state.vehicles, state.project.safetySeats);
  return `
    <div class="metric-grid">${metrics().map(([icon, value, label, note, kind]) => `<div class="metric ${kind}"><span class="metric-icon">${icon}</span><div><span>${label}</span><strong>${value}</strong><small>${note}</small></div></div>`).join('')}</div>
    <div class="columns">
      <div class="stack">
        <article class="card"><div class="card-head"><h2>未来 7 天项目</h2><button class="subtle" data-view="project">进入项目编排</button></div><div class="table-wrap"><table><thead><tr><th>出团日期</th><th>学校 / 年级</th><th>导游进度</th><th>车辆进度</th><th>状态</th><th>下一步</th></tr></thead><tbody>
          <tr class="row-highlight"><td><strong>${formatDate(state.project.startDate)}</strong><small class="hint">两日团</small></td><td><strong>${state.project.school}</strong><small class="hint">${state.project.grade} · ${state.classes.length} 个班</small></td><td>${state.applicants.filter(item => item.status === '已确认').length} / ${state.project.guideNeed}</td><td>${vehicleRows.filter(item => item.valid).length} / ${state.classes.length}</td><td>${statusTag(state.project.status)}</td><td><button class="subtle" data-view="recruitment">确认导游</button></td></tr>
          ${state.draftProjects.map(item => `<tr><td>${formatDate(item.startDate)}</td><td><strong>${escapeHtml(item.school)}</strong><small class="hint">${item.classCount} 个班待录入</small></td><td>0 / —</td><td>0 / ${item.classCount}</td><td>${statusTag('草稿')}</td><td>补齐资料</td></tr>`).join('')}
        </tbody></table></div></article>
        <article class="card"><div class="card-head"><h2>最新动态</h2><span class="hint">关键变更保留操作痕迹</span></div><div class="card-body">${state.activities.slice(0, 5).map(item => `<div class="kpi-line"><div><strong>${item.type}</strong><span class="hint">${item.detail}</span></div><span>${item.actor}<small class="hint">${item.time}</small></span></div>`).join('')}</div></article>
      </div>
      <aside class="card"><div class="card-head"><h2>需要你处理</h2><span class="tag warn">${state.requests.length} 项</span></div><div class="card-body request-list">${state.requests.map(request => `<div class="todo"><div class="todo-top"><strong>${request.type}</strong>${statusTag(request.level)}</div><p>${request.detail}</p><button class="subtle" data-view="${request.type.includes('车辆') ? 'vehicles' : 'recruitment'}">去处理</button></div>`).join('')}</div></aside>
    </div>`;
}

function projectView() {
  const counts = validateClassCounts(state.classes);
  const cars = vehicleAssignments(state.classes, state.vehicles, state.project.safetySeats);
  return `<div class="toolbar"><div><p class="eyebrow">${state.project.status} · ${state.project.id}</p><h2>${state.project.name}</h2></div><button class="ghost" data-action="validate-project">重新校验</button></div>
    <div class="stepper">${['基本信息','导游招募','班级编排','车辆安排','住宿分房','表格发布'].map((step,index)=>`<div class="step ${index < 3 ? 'done' : index === 3 ? 'active' : ''}"><b>${index + 1}</b>${step}</div>`).join('')}</div>
    <div class="section-note">${state.project.startDate} 至 ${state.project.endDate} · ${state.project.meeting} · 项目负责人 ${state.project.manager}。当前为模拟项目，不含真实师生及证件资料。</div>
    <article class="card"><div class="card-head"><h2>班级—导游—车辆安排</h2><span>${counts.filter(item => item.valid).length}/${counts.length} 班人数校验通过</span></div><div class="table-wrap"><table><thead><tr><th>班级</th><th>学生</th><th>男 / 女</th><th>老师</th><th>导游</th><th>车辆</th><th>乘车人数</th><th>空余</th><th>校验</th></tr></thead><tbody>${state.classes.map((item,index)=>`<tr><td><strong>${item.name}</strong></td><td>${item.students}</td><td>${item.male} / ${item.female}</td><td>${item.teachers}</td><td>${item.guide}<small class="hint">${item.guideStatus}</small></td><td>${item.vehicle}</td><td>${cars[index].people}</td><td>${cars[index].spare}</td><td>${statusTag(counts[index].valid && cars[index].valid ? '通过' : '冲突')}</td></tr>`).join('')}</tbody></table></div></article>`;
}

function recruitmentView() {
  return `<div class="toolbar"><div><p class="eyebrow">${state.project.name}</p><h2>导游招募与锁档</h2></div><button class="ghost" data-action="copy-recruitment">复制招募文案</button></div>
    <div class="section-note">锁档规则：报名 → 工作人员录取 → 导游确认。仅“已确认”占用完整项目日期；确认前必须再次检查日期冲突。</div>
    <div class="split"><article class="card"><div class="card-head"><h2>报名名单</h2><span>${state.applicants.filter(item=>item.status==='已确认').length}/${state.project.guideNeed} 已确认</span></div><div class="table-wrap"><table><thead><tr><th>导游</th><th>联系方式</th><th>资料</th><th>状态</th><th>说明</th><th>操作</th></tr></thead><tbody>${state.applicants.map(item=>`<tr><td><strong>${item.name}</strong></td><td>${item.phone}</td><td>${item.complete ? '完整' : '待补'}</td><td>${statusTag(item.status)}</td><td>${item.note}</td><td>${item.status === '待审核' ? `<button class="subtle" data-action="approve-guide" data-id="${item.id}">录取</button>` : item.status === '待确认' ? `<button class="primary" data-action="confirm-guide" data-id="${item.id}">模拟确认</button>` : item.status === '已确认' ? '已锁档' : item.status === '候补' ? '候补中' : '—'}</td></tr>`).join('')}</tbody></table></div></article>
    <aside class="card"><div class="card-head"><h2>状态规则</h2></div><div class="card-body stack"><div class="kpi-line"><span>已报名 / 待审核</span><small>不占档期</small></div><div class="kpi-line"><span>待确认</span><small>等待导游本人</small></div><div class="kpi-line"><span>已确认</span><small>正式锁定日期</small></div><div class="kpi-line"><span>候补</span><small>释放名额后补位</small></div></div></aside></div>`;
}

function vehiclesView() {
  const rows = vehicleAssignments(state.classes, state.vehicles, state.project.safetySeats);
  return `<div class="toolbar"><div><p class="eyebrow">系统建议＋人工调整＋持续校验</p><h2>车辆调度</h2></div><div><button class="ghost" data-action="restore-vehicles">恢复建议</button> <button class="primary" data-action="simulate-overload">模拟容量冲突</button></div></div>
    <div class="section-note ${rows.some(item => !item.valid) ? 'warn' : ''}">${rows.some(item => !item.valid) ? `当前有 ${rows.filter(item=>!item.valid).length} 个班级超过车辆可用座位，不能发布。` : '当前安排未超载。安全余座默认为 0；车辆坐满仅提示，不判定为错误。'}</div>
    <article class="card"><div class="table-wrap"><table><thead><tr><th>班级</th><th>车辆</th><th>车型</th><th>乘车人数</th><th>可用座位</th><th>空余</th><th>结果</th></tr></thead><tbody>${rows.map(item=>{const car=state.vehicles.find(v=>v.plate===item.vehicle);return `<tr><td>${item.className}</td><td><strong>${item.vehicle}</strong></td><td>${car?.model || '—'}</td><td>${item.people}</td><td>${item.available}</td><td>${item.spare}</td><td>${statusTag(item.valid?'通过':'冲突')}</td></tr>`}).join('')}</tbody></table></div></article>`;
}

function roomsView() {
  const rooms = validateRooms(state.rooms);
  return `<div class="toolbar"><div><p class="eyebrow">两日及以上项目启用</p><h2>住宿分房建议</h2></div><button class="ghost" data-action="validate-rooms">重新校验</button></div>
    <div class="section-note">按性别分区、不得超容量、优先同班。橙色房间表示跨班拼房，需要工作人员人工确认。</div>
    <div class="split"><article class="card"><div class="card-head"><h2>房间安排</h2><span>${rooms.filter(room=>room.valid).length}/${rooms.length} 容量通过</span></div><div class="card-body room-grid">${rooms.map(room=>`<div class="room ${room.mixedClass?'mixed':''}"><strong>${room.no} · ${room.gender} ${room.mixedClass?'<span class="tag warn">跨班</span>':''}</strong><small>${room.classes}<br/>入住 ${room.occupants}/${room.capacity} 人</small></div>`).join('')}</div></article>
    <aside class="card"><div class="card-head"><h2>校验摘要</h2></div><div class="card-body stack"><div class="kpi-line"><span>房间超员</span><strong>${rooms.filter(room=>!room.valid).length}</strong></div><div class="kpi-line"><span>男女混住</span><strong>0</strong></div><div class="kpi-line"><span>跨班拼房</span><strong>${rooms.filter(room=>room.mixedClass).length}</strong></div><div class="kpi-line"><span>未分配学生</span><strong>0</strong></div></div></aside></div>`;
}

function exportsView() {
  const rows = vehicleAssignments(state.classes,state.vehicles,state.project.safetySeats);
  const blockers = rows.filter(item=>!item.valid).length + state.classes.filter(item=>item.guideStatus!=='已确认').length;
  return `<div class="toolbar"><div><p class="eyebrow">统一数据源生成执行资料</p><h2>表格中心</h2></div><button class="primary" data-action="download-csv" ${blockers?'disabled':''}>导出乘车安排 CSV</button></div>
    <div class="section-note ${blockers?'warn':''}">${blockers ? `检测到 ${blockers} 项阻断问题：请先完成导游确认并处理车辆容量后再导出。` : '发布校验已通过。CSV 使用 UTF-8 BOM，可由 Excel 正常打开。'}</div>${projectView().split('<article class="card">')[1] ? `<article class="card">${projectView().split('<article class="card">')[1]}` : ''}`;
}

function exceptionsView() {
  const carErrors=vehicleAssignments(state.classes,state.vehicles,state.project.safetySeats).filter(item=>!item.valid);
  const waiting=state.applicants.filter(item=>item.status==='待确认');
  const items=[...carErrors.map(item=>({title:`${item.className} 车辆超载`,detail:`${item.people} 人 / ${item.available} 座，缺少 ${Math.abs(item.spare)} 个座位`,level:'冲突',view:'vehicles'})),...waiting.map(item=>({title:`${item.name} 等待确认`,detail:`${state.project.startDate} 出团，确认后才锁定档期`,level:'待确认',view:'recruitment'})),...state.requests.map(item=>({title:item.type,detail:item.detail,level:item.level,view:item.type.includes('车辆')?'vehicles':'recruitment'}))];
  return `<div class="toolbar"><div><p class="eyebrow">阻断发布 / 需确认 / 提示</p><h2>异常中心</h2></div><span class="tag ${items.length?'warn':'ok'}">${items.length} 项</span></div><div class="card"><div class="card-body request-list">${items.length?items.map(item=>`<div class="todo"><div class="todo-top"><strong>${item.title}</strong>${statusTag(item.level)}</div><p>${item.detail}</p><button class="subtle" data-view="${item.view}">定位处理</button></div>`).join(''):'<div class="empty">当前没有待处理异常</div>'}</div></div>`;
}

function guideView() {
  const guide = state.applicants.find(item=>item.id==='g3');
  return `<div class="guide-shell"><div class="guide-top"><p>研学派团 · 导游端</p><h1>你好，${guide.name}</h1><p>你有 1 个待处理任务</p></div><div class="guide-body"><div class="guide-card"><div class="todo-top"><span class="tag warn">${guide.status}</span><small>${formatDate(state.project.startDate)} 出团</small></div><h2>${state.project.name}</h2><p>请确认日期、集合地点和岗位信息。确认后将锁定完整项目日期。</p><div class="detail-list"><div><span>项目日期</span><strong>${state.project.startDate}—${state.project.endDate}</strong></div><div><span>集合信息</span><strong>${state.project.meeting}</strong></div><div><span>负责班级</span><strong>初一（2）班</strong></div><div><span>车辆</span><strong>湘A·R5682 · 49座</strong></div><div><span>公司联系人</span><strong>田主管 139****0821</strong></div></div>${guide.status==='待确认'?'<button class="primary full" data-action="guide-confirm" data-id="g3">确认接团并锁定档期</button>':'<button class="ghost full" data-action="submit-exit">提交退出申请</button>'}</div><div class="guide-card"><h2>行前资料</h2><p>行程安排、学生年龄段、带队老师和紧急联系人已汇总。演示版不包含真实证件或学生个人信息。</p><button class="subtle full" data-action="view-itinerary">查看行程摘要</button></div><button class="ghost full" data-action="toggle-guide">返回公司工作台</button></div></div>`;
}

const viewMap={dashboard:dashboardView,project:projectView,recruitment:recruitmentView,vehicles:vehiclesView,rooms:roomsView,exports:exportsView,exceptions:exceptionsView,guide:guideView};

function render() {
  const guideMode=currentView==='guide';
  document.body.classList.toggle('guide-mode',guideMode);
  $('.sidebar').hidden=guideMode;
  $('.topbar').hidden=guideMode;
  renderNav();
  $('#page-title').textContent=currentView==='dashboard'?'早上好，田主管':navItems.find(([key])=>key===currentView)?.[1]||'导游端';
  $('#app').innerHTML=(viewMap[currentView]||dashboardView)();
}

function addActivity(type,detail,actor='田主管') {
  state.activities.unshift({type,detail,actor,time:'09-07 现在'});
}

document.addEventListener('click', event => {
  const viewButton=event.target.closest('[data-view]');
  if(viewButton){currentView=viewButton.dataset.view;render();return;}
  const button=event.target.closest('[data-action]');
  if(!button)return;
  const action=button.dataset.action;
  if(action==='toggle-guide'){currentView=currentView==='guide'?'dashboard':'guide';render();return;}
  if(action==='create-project'){ $('#project-dialog').showModal(); return; }
  if(action==='approve-guide'){const guide=state.applicants.find(item=>item.id===button.dataset.id);guide.status='待确认';guide.note='已录取，等待本人确认';addActivity('导游已录取',`${guide.name}进入待确认`);persist();render();notify(`${guide.name} 已录取，等待本人确认。`);return;}
  if(action==='confirm-guide'||action==='guide-confirm'){const result=confirmGuide(state,button.dataset.id);if(result.ok)addActivity('导游已确认',result.reason,action==='guide-confirm'?'周昕':'田主管');persist();render();notify(result.reason,!result.ok);return;}
  if(action==='simulate-overload'){state.classes[0].vehicle='湘A·B0231';addActivity('车辆调整产生冲突','初一（1）班改用29座小巴');persist();render();notify('已检测到容量冲突，方案不可发布。',true);return;}
  if(action==='restore-vehicles'){state.classes[0].vehicle='湘A·K2198';addActivity('车辆方案已恢复','初一（1）班恢复49座大巴');persist();render();notify('车辆建议已恢复并重新校验。');return;}
  if(action==='validate-project'){const invalid=validateClassCounts(state.classes).filter(item=>!item.valid).length;const cars=vehicleAssignments(state.classes,state.vehicles,state.project.safetySeats).filter(item=>!item.valid).length;notify(invalid||cars?`校验发现 ${invalid+cars} 项问题。`:'班级人数与车辆容量校验通过。',Boolean(invalid||cars));return;}
  if(action==='validate-rooms'){const invalid=validateRooms(state.rooms).filter(room=>!room.valid).length;notify(invalid?`发现 ${invalid} 个房间超员。`:'住宿容量、性别与未分配人数校验通过。',Boolean(invalid));return;}
  if(action==='copy-recruitment'){const text=`${state.project.startDate} 至 ${state.project.endDate}，${state.project.school}${state.project.grade}研学团，需要${state.project.guideNeed}名研学导师。${state.project.meeting}。`;navigator.clipboard?.writeText(text);notify('招募文案已复制（模拟分享，不连接微信）。');return;}
  if(action==='download-csv'){const blob=new Blob([toCsv(state)],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='湘江实验学校-乘车安排.csv';link.click();URL.revokeObjectURL(url);addActivity('执行表已导出','乘车安排 CSV');persist();notify('CSV 已导出。');return;}
  if(action==='submit-exit'){if(!state.requests.some(item=>item.type==='退出申请'))state.requests.unshift({id:`r${Date.now()}`,type:'退出申请',guide:'周昕',detail:'周昕申请退出，等待负责人审批；档期暂不释放',level:'待处理'});addActivity('导游提交退出申请','周昕 · 档期暂未释放','周昕');persist();render();notify('退出申请已提交，负责人批准前档期保持锁定。');return;}
  if(action==='view-itinerary'){notify('行程摘要：长沙规划馆 → 铜官窑研学基地 → 酒店。');return;}
});

$('#project-form').addEventListener('submit', event => {
  const submitter=event.submitter;
  if(submitter?.value==='cancel')return;
  event.preventDefault();
  const data=Object.fromEntries(new FormData(event.currentTarget));
  if(data.endDate<data.startDate){notify('结束日期不能早于开始日期。',true);return;}
  state.draftProjects.push({...data,classCount:Number(data.classCount),status:'草稿'});
  addActivity('创建项目草稿',`${data.school} · ${data.classCount} 个班`);
  persist();
  $('#project-dialog').close();
  currentView='dashboard';render();notify('项目草稿已创建，请继续补齐班级人数。');
});

window.__DEMO__={getState:()=>deepClone(state),reset:()=>{state=deepClone(seedState);state.draftProjects=[];localStorage.removeItem(STORAGE_KEY);render();}};
render();
