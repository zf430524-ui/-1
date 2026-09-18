import { findPage, navigationGroups, pages } from './pages.js';

const root = document.querySelector('#app');
const state = { authenticated: false, development: false, loading: true, navExpanded: false };

function routePath() {
  const value = location.hash.replace(/^#/, '') || '/';
  const pathname = value.split('?')[0];
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

function routeParams() {
  const value = location.hash.replace(/^#/, '') || '/';
  const query = value.includes('?') ? value.slice(value.indexOf('?') + 1) : '';
  return new URLSearchParams(query);
}

function focusExceptionSource(fallbackSelector = '') {
  const focus = routeParams().get('focus'); const exceptionId = routeParams().get('exception');
  if (!exceptionId) return;
  const selectors = focus ? [`[data-source-id="${CSS.escape(focus)}"]`, `[data-project-guide="${CSS.escape(focus)}"]`] : [];
  if (fallbackSelector) selectors.push(fallbackSelector);
  const target = selectors.map((selector) => root.querySelector(selector)).find(Boolean);
  if (!target) return;
  target.classList.add('exception-source-focus');
  target.style.outline = '3px solid rgba(11,146,127,.35)'; target.style.outlineOffset = '3px';
  requestAnimationFrame(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.message || body.error || '请求失败'), { status: response.status, code: body.code, details: body.details || {} });
  return body;
}

function renderLoading() {
  root.innerHTML = `<main class="center-stage"><section class="unlock-card" aria-busy="true"><div class="brand-mark">研学派团</div><div class="skeleton title-skeleton"></div><div class="skeleton line-skeleton"></div><div class="skeleton button-skeleton"></div></section></main>`;
}

function renderUnlock(message = '') {
  root.innerHTML = `
    <main class="center-stage">
      <section class="unlock-card">
        <div class="brand-mark">研学派团 <span>负责人工作台</span></div>
        <p class="eyebrow">本机受保护应用</p>
        <h1>解锁后继续安排研学项目</h1>
        <p class="muted">业务数据只通过本机服务访问。关闭或退出后，本次会话立即失效。</p>
        ${state.development ? '<div class="notice warning"><strong>开发环境</strong><span>仅可使用模拟或脱敏数据，口令为 local-dev。</span></div>' : ''}
        <form id="unlock-form" class="unlock-form">
          <label for="password">解锁口令</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
          <p class="form-error" id="unlock-error" role="alert">${escapeHtml(message)}</p>
          <button class="button primary" type="submit">解锁工作台</button>
        </form>
      </section>
    </main>`;

  root.querySelector('#unlock-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    const password = new FormData(event.currentTarget).get('password');
    button.disabled = true;
    button.textContent = '正在解锁…';
    try {
      const session = await api('/api/session', { method: 'POST', body: JSON.stringify({ password }) });
      state.authenticated = session.authenticated;
      state.development = session.development;
      renderApp();
    } catch (error) {
      renderUnlock(error.message);
    }
  });
}

function navMarkup(activePage) {
  return navigationGroups.map((group) => {
    const primary = group.pages[0];
    const active = group.pages.some((page) => page.id === activePage.id);
    return `<a class="nav-item ${active ? 'active' : ''}" href="#${primary.path}" data-label="${escapeHtml(group.label)}"><span>${escapeHtml(group.label)}</span>${group.pages.length > 1 ? `<small>${group.pages[0].id}–${group.pages.at(-1).id}</small>` : `<small>${primary.id}</small>`}</a>`;
  }).join('');
}

function pageDirectory(activePage) {
  const group = navigationGroups.find((candidate) => candidate.pages.some((page) => page.id === activePage.id));
  if (!group || group.pages.length === 1) return '';
  return `<nav class="subnav" aria-label="${escapeHtml(group.label)}子页面">${group.pages.map((page) => `<a href="#${page.path}" class="${page.id === activePage.id ? 'active' : ''}">${page.id} ${escapeHtml(page.title)}${page.conditional ? '<span>条件</span>' : ''}</a>`).join('')}</nav>`;
}

function dashboardContent() {
  return '<section id="dashboard-root" class="dashboard-root"><article class="panel"><div class="list-loading"><div class="skeleton title-skeleton"></div><div class="skeleton line-skeleton"></div></div></article></section>';
}

function dashboardProjectMarkup(row) {
  const statusClass = row.blockers ? 'warning' : projectStatusClass(row.status);
  const date = row.startsOn === row.endsOn ? formatProjectDate(row.startsOn) : `${formatProjectDate(row.startsOn)}—${formatProjectDate(row.endsOn)}`;
  return `<article class="dashboard-project-row" data-dashboard-project="${escapeHtml(row.id)}"><div class="dashboard-project-main"><div><h3>${escapeHtml(row.schoolName)} · ${escapeHtml(row.grade)}</h3><span class="status-tag ${statusClass}">${row.blockers ? `${row.blockers} 个阻断` : escapeHtml(row.status)}</span></div><p>${escapeHtml(row.destination)} · ${date}</p><small>${row.students} 名学生 · ${row.vehicles} 辆车 · ${row.arrangedGuides} 名导游${row.guideGap ? ` · 缺 ${row.guideGap} 名导游` : ''}</small></div><div class="dashboard-progress"><div><span>执行完成 ${row.progress.completed}/${row.progress.total}</span><b>${row.progress.percent}%</b></div><progress max="100" value="${row.progress.percent}"></progress></div><a class="text-link inline" href="#/projects/overview?project=${encodeURIComponent(row.id)}">${row.next ? '继续处理' : '查看项目'} →</a></article>`;
}

function dashboardExceptionMarkup(row) {
  return `<a class="dashboard-task ${exceptionSeverityClass(row.severity)}" href="#${escapeHtml(row.action_path)}"><span>${escapeHtml(row.severity)}</span><strong>${escapeHtml(row.school_name)} · ${escapeHtml(row.message)}</strong><small>${escapeHtml(row.module)} · ${escapeHtml(row.code)}</small></a>`;
}

async function bindDashboardPage() {
  const host = root.querySelector('#dashboard-root');
  try {
    const data = await api('/api/dashboard');
    host.innerHTML = `<section class="metric-grid dashboard-metrics" aria-label="今日指标">${[
      ['upcoming','近期出团',data.stats.upcomingProjects,'未来 7 天','#/projects'],
      ['blockers','阻断异常',data.stats.blockers,'需优先处理','#/exceptions?severity=阻断&status=待处理'],
      ['guides','待安排导游',data.stats.pendingGuides,`涉及 ${data.stats.pendingGuideProjects} 个项目`,'#/projects'],
      ['documents','临期证件',data.stats.expiringDocuments,'30 天内到期或已过期','#/guides']
    ].map(([id,label,value,note,href]) => `<a class="metric" data-dashboard-metric="${id}" href="${href}"><span>${label}</span><strong>${value}</strong><small>${note}</small></a>`).join('')}</section>
      <section class="dashboard-layout"><article class="panel dashboard-projects"><div class="section-heading"><div><p class="eyebrow">未来 7 天项目</p><h2>按出团日期排序</h2></div><a class="text-link inline" href="#/projects">查看全部项目</a></div>${data.upcoming.length ? `<div class="dashboard-project-list">${data.upcoming.map(dashboardProjectMarkup).join('')}</div>` : '<div class="dashboard-empty"><h3>未来 7 天没有出团项目</h3><p>新建项目后，这里会显示真实进度和下一步。</p><a class="button primary" href="#/projects/new">新建项目</a></div>'}</article>
      <aside class="dashboard-side"><section class="panel"><div class="section-heading"><div><p class="eyebrow">待办与异常</p><h2>优先处理阻断</h2></div><a class="text-link inline" href="#/exceptions?status=待处理">查看全部</a></div><div class="dashboard-task-list">${data.pendingExceptions.length ? data.pendingExceptions.slice(0,4).map(dashboardExceptionMarkup).join('') : '<p class="dashboard-none">当前没有待处理异常</p>'}</div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">证件提醒</p><h2>临期与过期</h2></div><a class="text-link inline" href="#/guides">查看导游库</a></div><div class="certificate-reminder-list">${data.certificateReminders.length ? data.certificateReminders.slice(0,4).map((row) => `<a href="#${escapeHtml(row.actionPath)}"><span class="${row.daysRemaining < 0 ? 'expired' : ''}">${row.daysRemaining < 0 ? `过期 ${Math.abs(row.daysRemaining)} 天` : `${row.daysRemaining} 天`}</span><strong>${escapeHtml(row.guideName)} · ${escapeHtml(row.documentType)}</strong><small>${escapeHtml(row.expiresOn)}</small></a>`).join('') : '<p class="dashboard-none">30 天内没有证件到期</p>'}</div></section></aside></section>`;
  } catch (error) { host.innerHTML = `<article class="panel empty-list error-state"><h3>工作台读取失败</h3><p>${escapeHtml(error.message)}</p><button class="button secondary" id="retry-dashboard">重新读取</button></article>`; host.querySelector('#retry-dashboard')?.addEventListener('click', bindDashboardPage); }
}

function overviewContent() {
  return '<section id="overview-root" class="overview-root"><article class="panel"><div class="list-loading"><div class="skeleton title-skeleton"></div><div class="skeleton line-skeleton"></div></div></article></section>';
}

function overviewStageMarkup(stage) {
  const statusLabels = { complete: '已完成', blocked: '阻断', pending: '待处理', not_applicable: '不适用' };
  return `<article class="overview-stage ${stage.status}" data-stage="${escapeHtml(stage.id)}"><span class="stage-number">${String(stage.order).padStart(2,'0')}</span><div><h3>${escapeHtml(stage.label)}</h3><p>${escapeHtml(stage.detail)}</p></div><span class="stage-status">${statusLabels[stage.status]}</span>${stage.status === 'not_applicable' ? '' : `<a class="text-link inline" href="#${escapeHtml(stage.path)}">${stage.status === 'complete' ? '打开' : stage.status === 'blocked' ? '立即处理' : '继续'} →</a>`}</article>`;
}

function overviewStaffMarkup(row, projectId) {
  const source = row.source_type === 'teacher' ? 'P05' : row.source_type === 'project_guide' ? 'P07' : row.source_type === 'transport_driver' ? 'P08' : 'P05';
  const path = row.source_type === 'project_guide' ? `/projects/guides?project=${projectId}&focus=${row.source_id}` : row.source_type === 'transport_driver' ? `/projects/transport?project=${projectId}&focus=${row.source_id}` : `/projects/people?project=${projectId}&focus=${row.source_id}`;
  return `<tr data-staff-source="${escapeHtml(row.source_type)}" data-source-id="${escapeHtml(row.source_id)}"><td>${escapeHtml(row.role)}</td><td>${escapeHtml(row.source_name || row.source_context || '汇总记录')}</td><td>${row.people_count}</td><td>${escapeHtml(row.gender)}</td><td>${source}</td><td><a class="text-link inline" href="#${path}">回改</a>${row.source_type === 'project_guide' && row.guide_id ? ` <a class="text-link inline" href="#/guides/detail?id=${encodeURIComponent(row.guide_id)}">档案</a>` : ''}</td></tr>`;
}

function overviewMarkup(data, message = '') {
  const tripType = data.project.starts_on === data.project.ends_on ? '一日游' : '多日游'; const next = data.next;
  return `<div class="overview-workspace" data-project-id="${escapeHtml(data.project.id)}"><article class="panel overview-banner"><div><p class="eyebrow">当前项目</p><h2>${escapeHtml(data.project.school_name)} · ${escapeHtml(data.project.grade)}</h2><p>${escapeHtml(data.project.destination)} · ${formatProjectDate(data.project.starts_on)}${data.project.ends_on !== data.project.starts_on ? `—${formatProjectDate(data.project.ends_on)}` : ''} · ${tripType}</p></div><div class="overview-banner-actions"><span class="status-tag ${projectStatusClass(data.project.status)}">${escapeHtml(data.project.status)}</span><a class="button secondary" href="#/projects/new?id=${encodeURIComponent(data.project.id)}">编辑资料</a><a class="button primary" href="#/imports?project=${encodeURIComponent(data.project.id)}">导入资料</a></div></article>
  <section class="metric-grid overview-metrics">${[['班级',data.counts.classes,'已录入'],['学生',data.students,`男 ${data.boys} / 女 ${data.girls}`],['随团人员',data.totals.staff,'老师、导游、司机等'],['导游',`${data.arrangedGuides}/${data.requiredGuides}`,data.guideGap ? `仍缺 ${data.guideGap}` : '班级已覆盖'],['车辆',data.counts.vehicles,`${data.totals.transportAssigned}/${data.totals.transportCapacity} 人/座位`]].map(([label,value,note]) => `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('')}</section>
  ${message ? `<div class="overview-message" role="status">${escapeHtml(message)}</div>` : ''}
  <section class="overview-layout"><article class="panel overview-stages"><div class="section-heading"><div><p class="eyebrow">执行阶段</p><h2>按顺序处理适用模块</h2></div><span>${data.progress.completed}/${data.progress.total} 项检查通过</span></div><div class="overview-stage-list">${data.stages.map(overviewStageMarkup).join('')}</div></article>
  <aside class="overview-side"><section class="overview-next ${next?.status === 'blocked' ? 'blocked' : ''}"><div><p class="eyebrow">下一步</p><h2>${next ? escapeHtml(next.label) : '当前阶段已完成'}</h2><p>${next ? escapeHtml(next.detail) : '没有未完成的适用阶段。'}</p></div>${next ? `<a class="button ${next.status === 'blocked' ? 'danger-button' : 'primary'}" href="#${escapeHtml(next.path)}">${next.status === 'blocked' ? '立即处理' : '继续下一步'}</a>` : ''}</section>
  <section class="panel overview-exceptions"><div class="section-heading"><div><p class="eyebrow">异常摘要</p><h2>${data.exceptionStats.blockers} 阻断 · ${data.exceptionStats.warnings} 警告 · ${data.exceptionStats.reminders} 提醒</h2></div></div><a class="button secondary" href="#/exceptions?project=${encodeURIComponent(data.project.id)}&status=待处理">查看项目异常</a></section>
  <section class="panel overview-completeness"><div class="section-heading"><div><p class="eyebrow">资料完整度</p><h2>${data.progress.percent}%</h2></div><span>${data.missingFields.length} 个资料字段缺失</span></div><progress max="100" value="${data.progress.percent}"></progress>${data.missingFields.length ? `<div>${data.missingFields.map((row) => `<a href="#${escapeHtml(row.path)}">${escapeHtml(row.label)} →</a>`).join('')}</div>` : '<p>项目资料字段已补齐</p>'}</section>
  <section class="panel overview-gate"><p class="eyebrow">项目状态</p><h2>${escapeHtml(data.project.status)}</h2><p id="overview-gate-message">${data.canComplete ? '当前适用安排无阻断，可推进完成。' : '需先完成适用安排并清除阻断。'}</p><div><button class="button secondary" id="recalculate-overview" type="button">重新校验全部</button><button class="button primary" id="complete-overview" type="button" ${data.canComplete ? '' : 'disabled'}>标记已完成安排</button></div></section></aside></section>
  <article class="panel overview-staff"><div class="section-heading"><div><p class="eyebrow">项目随团人员来源</p><h2>老师、导游、司机与其他角色</h2></div><a class="text-link inline" href="#/projects/people?project=${encodeURIComponent(data.project.id)}">打开 P05 汇总</a></div><div class="staff-table-wrap"><table><thead><tr><th>角色</th><th>来源对象</th><th>人数</th><th>性别</th><th>来源模块</th><th>回改</th></tr></thead><tbody>${data.staff.length ? data.staff.map((row) => overviewStaffMarkup(row, data.project.id)).join('') : '<tr><td colspan="6">尚无工作人员来源</td></tr>'}</tbody></table></div></article></div>`;
}

async function bindOverviewPage() {
  const host = root.querySelector('#overview-root'); const projectId = routeParams().get('project');
  try {
    if (!projectId) { const projects = await api('/api/projects'); host.innerHTML = `<article class="panel overview-picker"><h2>选择要查看的项目</h2>${projects.length ? `<form id="overview-picker"><label class="field"><span>项目</span><select name="project">${projects.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.school_name)} · ${escapeHtml(row.grade)} · ${escapeHtml(row.starts_on)}</option>`).join('')}</select></label><button class="button primary">进入总览</button></form>` : '<div class="dashboard-empty"><p>还没有项目。</p><a class="button primary" href="#/projects/new">新建项目</a></div>'}</article>`; host.querySelector('#overview-picker')?.addEventListener('submit', (event) => { event.preventDefault(); location.hash = `/projects/overview?project=${encodeURIComponent(new FormData(event.currentTarget).get('project'))}`; }); return; }
    let data = await api(`/api/projects/${encodeURIComponent(projectId)}/overview`);
    const render = (message = '') => { host.innerHTML = overviewMarkup(data, message); bindActions(); };
    const bindActions = () => {
      host.querySelector('#recalculate-overview').addEventListener('click', async (event) => { const button = event.currentTarget; button.disabled = true; try { await api(`/api/projects/${encodeURIComponent(projectId)}/recalculate`, { method: 'POST', body: '{}' }); data = await api(`/api/projects/${encodeURIComponent(projectId)}/overview`); render(`重新校验完成：${data.exceptionStats.blockers} 个阻断。`); } catch (error) { host.querySelector('#overview-gate-message').textContent = error.message; button.disabled = false; } });
      host.querySelector('#complete-overview').addEventListener('click', async (event) => { if (!confirm('系统将再次执行统一门禁。确认标记为已完成安排？')) return; const button = event.currentTarget; button.disabled = true; try { await api(`/api/projects/${encodeURIComponent(projectId)}/complete`, { method: 'POST', body: '{}' }); data = await api(`/api/projects/${encodeURIComponent(projectId)}/overview`); render('项目已通过统一门禁并标记为已完成安排。'); } catch (error) { host.querySelector('#overview-gate-message').textContent = error.message; button.disabled = false; } });
    };
    render();
  } catch (error) { host.innerHTML = `<article class="panel empty-list error-state"><h3>项目总览读取失败</h3><p>${escapeHtml(error.message)}</p><a class="button secondary" href="#/projects">返回项目列表</a></article>`; }
}

const projectStatusOptions = ['资料待补充','人员安排中','车辆安排中','住宿安排中','用餐安排中','待检查','已完成安排','已出团','已结束'];

function projectStatusClass(status) {
  if (status === '已完成安排') return 'success';
  if (status === '已结束') return 'muted-tag';
  if (status === '待检查') return 'warning';
  return 'planned';
}

function formatProjectDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatProjectTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function projectsContent() {
  return `
    <section class="metric-grid" aria-label="项目指标">
      ${[['筛选结果', 'project-count', '当前列表'], ['进行中', 'active-project-count', '不含已结束'], ['阻断异常', 'project-blocker-count', '未解决'], ['最近出团', 'project-nearest-date', '按出团日期']].map(([label, id, note]) => `<article class="metric"><span>${label}</span><strong id="${id}">—</strong><small>${note}</small></article>`).join('')}
    </section>
    <section class="panel filter-panel project-filter-panel">
      <form id="project-filter" class="project-filter-grid">
        <label class="field"><span>关键词</span><input name="query" placeholder="学校 / 年级 / 目的地 / 项目编号"><small>支持模糊搜索</small></label>
        <label class="field"><span>出团日期从</span><input name="startsFrom" type="date"></label>
        <label class="field"><span>出团日期至</span><input name="startsTo" type="date"></label>
        <fieldset class="status-filter"><legend>项目状态（可多选）</legend><div>${projectStatusOptions.map((status) => `<label><input type="checkbox" name="status" value="${status}"><span>${status}</span></label>`).join('')}</div></fieldset>
        <div class="filter-actions"><button type="reset" class="button secondary">重置</button><button type="submit" class="button primary">筛选</button></div>
      </form>
    </section>
    <section class="panel project-list-panel">
      <div class="section-heading"><div><p class="eyebrow">项目档案</p><h2>按出团日期排序</h2></div><span id="project-result-count">正在读取…</span></div>
      <div id="project-list" class="project-list"><div class="list-loading"><div class="skeleton line-skeleton"></div><div class="skeleton line-skeleton"></div></div></div>
    </section>`;
}

function projectRowMarkup(project) {
  const tripType = project.starts_on === project.ends_on ? '一日游' : '多日游';
  const blockers = Number(project.blocker_count || 0);
  const blockerLabel = blockers ? `${blockers} 个阻断` : project.status === '资料待补充' ? '未完成全项目校验' : '无阻断';
  return `<article class="project-row" data-project-id="${escapeHtml(project.id)}">
    <div class="project-main"><div class="project-title-line"><h3>${escapeHtml(project.school_name)} · ${escapeHtml(project.grade)}</h3><span class="status-tag ${projectStatusClass(project.status)}">${escapeHtml(project.status)}</span></div><p>${escapeHtml(project.destination)} · ${tripType} · ${formatProjectDate(project.starts_on)}${project.ends_on !== project.starts_on ? ` 至 ${formatProjectDate(project.ends_on)}` : ''}</p><small>编号 ${escapeHtml(project.id)} · 更新 ${escapeHtml(formatProjectTime(project.updated_at))}</small></div>
    <div class="project-condition-tags"><span>${project.needs_lodging ? '需住宿' : '不住宿'}</span><span>${project.includes_meals ? `含餐 ${project.meal_count} 次` : '不含餐'}</span><span class="${blockers ? 'blocker-text' : project.status === '资料待补充' ? 'pending-text' : 'clear-text'}">${blockerLabel}</span></div>
    <div class="row-actions"><a class="button secondary compact" href="#/projects/overview?project=${encodeURIComponent(project.id)}">进入项目</a><a class="text-link inline" href="#/projects/new?id=${encodeURIComponent(project.id)}">编辑</a>${project.status !== '已结束' ? `<button class="text-button danger-text" data-end-project="${escapeHtml(project.id)}">结束项目</button>` : ''}<button class="text-button" data-delete-project="${escapeHtml(project.id)}">删除误建</button></div>
  </article>`;
}

async function loadProjects() {
  const form = root.querySelector('#project-filter');
  if (!form) return;
  const params = new URLSearchParams();
  const formData = new FormData(form);
  for (const key of ['query','startsFrom','startsTo']) if (formData.get(key)) params.set(key, formData.get(key));
  for (const status of formData.getAll('status')) params.append('status', status);
  const list = root.querySelector('#project-list');
  try {
    const projects = await api(`/api/projects?${params}`);
    const active = projects.filter((project) => project.status !== '已结束');
    root.querySelector('#project-count').textContent = projects.length;
    root.querySelector('#active-project-count').textContent = active.length;
    root.querySelector('#project-blocker-count').textContent = projects.reduce((sum, project) => sum + Number(project.blocker_count || 0), 0);
    root.querySelector('#project-nearest-date').textContent = active[0]?.starts_on ? formatProjectDate(active[0].starts_on).replace(/\//g, '-') : '—';
    root.querySelector('#project-result-count').textContent = `${projects.length} 个项目`;
    list.innerHTML = projects.length ? projects.map(projectRowMarkup).join('') : `<div class="empty-list"><h3>没有符合条件的项目</h3><p>默认不显示已结束项目；可调整筛选，或新建第一个项目。</p><a class="button primary" href="#/projects/new">新建项目</a></div>`;
  } catch (error) { list.innerHTML = `<div class="empty-list error-state"><h3>项目读取失败</h3><p>${escapeHtml(error.message)}</p><button class="button secondary" data-retry-projects>重新读取</button></div>`; }
}

function bindProjectsPage() {
  const filter = root.querySelector('#project-filter');
  const routeQuery = routeParams();
  filter.elements.query.value = routeQuery.get('query') || '';
  filter.elements.startsFrom.value = routeQuery.get('startsFrom') || '';
  filter.elements.startsTo.value = routeQuery.get('startsTo') || '';
  for (const status of routeQuery.getAll('status')) {
    const option = [...filter.querySelectorAll('[name=status]')].find((input) => input.value === status);
    if (option) option.checked = true;
  }
  filter.addEventListener('submit', (event) => { event.preventDefault(); loadProjects(); });
  filter.addEventListener('reset', () => queueMicrotask(loadProjects));
  root.querySelector('#project-list').addEventListener('click', async (event) => {
    if (event.target.closest('[data-retry-projects]')) return loadProjects();
    const end = event.target.closest('[data-end-project]');
    const remove = event.target.closest('[data-delete-project]');
    if (end) {
      if (!confirm('结束后项目会保留全部历史安排和记录。确认结束这个项目？')) return;
      try { await api(`/api/projects/${encodeURIComponent(end.dataset.endProject)}/status`, { method: 'PATCH', body: JSON.stringify({ confirmed: true }) }); await loadProjects(); }
      catch (error) { alert(error.message); }
    }
    if (remove) {
      if (!confirm('只有没有任何业务、导入或导出记录的误建项目才能永久删除。确认继续？')) return;
      try { await api(`/api/projects/${encodeURIComponent(remove.dataset.deleteProject)}`, { method: 'DELETE', body: JSON.stringify({ confirmed: true }) }); await loadProjects(); }
      catch (error) { alert(error.message); }
    }
  });
  loadProjects();
}

function projectFormContent() {
  return `<section id="project-form-root" class="project-form-root"><article class="panel"><div class="list-loading"><div class="skeleton title-skeleton"></div><div class="skeleton line-skeleton"></div><div class="skeleton line-skeleton"></div></div></article></section>`;
}

function projectFormMarkup(project, schools) {
  const selectedSchool = project?.school_id || routeParams().get('school') || '';
  const startsOn = project?.starts_on || '';
  const endsOn = project?.ends_on || startsOn;
  return `<form id="project-form" class="panel project-form" data-project-id="${escapeHtml(project?.id || '')}">
    <div class="project-form-heading"><div><p class="eyebrow">${project ? '编辑项目' : '创建项目'}</p><h2>${project ? `${escapeHtml(project.school_name)} · ${escapeHtml(project.grade)}` : '先建立最少项目资料'}</h2><p>创建只要求学校、年级、目的地和起止日期；其余资料可后续补齐。</p></div>${project ? `<span class="status-tag ${projectStatusClass(project.status)}">${escapeHtml(project.status)}</span>` : '<span class="status-tag planned">资料待补充</span>'}</div>
    <section class="form-section"><div class="section-heading"><div><span class="field-title">基本信息</span><small>带 * 为创建必填</small></div></div><div class="project-form-grid">
      <label class="field"><span>学校名称 <b>*</b></span><select name="schoolId" required><option value="">请选择学校</option>${schools.map((school) => `<option value="${escapeHtml(school.id)}" ${school.id === selectedSchool ? 'selected' : ''} ${!school.active && school.id !== selectedSchool ? 'disabled' : ''}>${escapeHtml(school.name)}${school.active ? '' : '（已停用）'}</option>`).join('')}</select><small><a class="text-link inline" href="#/schools">学校不在列表？先建立学校资料</a></small></label>
      <label class="field"><span>年级 <b>*</b></span><input name="grade" required maxlength="50" value="${escapeHtml(project?.grade || '')}" placeholder="例如：八年级"></label>
      <label class="field"><span>研学目的地 <b>*</b></span><input name="destination" required maxlength="100" value="${escapeHtml(project?.destination || '')}" placeholder="用于区分项目"></label>
      <label class="field"><span>项目编号</span><input value="${escapeHtml(project?.id || '保存后自动生成')}" readonly></label>
    </div></section>
    <section class="form-section"><span class="field-title">日期与集合</span><div class="project-form-grid">
      <label class="field"><span>出团日期 <b>*</b></span><input name="startsOn" type="date" required value="${escapeHtml(startsOn)}"></label>
      <label class="field"><span>结束日期 <b>*</b></span><input name="endsOn" type="date" required value="${escapeHtml(endsOn)}"></label>
      <label class="field"><span>行程类型</span><input name="tripType" value="${startsOn && endsOn ? (startsOn === endsOn ? '一日游' : '多日游') : '由日期自动计算'}" readonly></label>
      <label class="field"><span>集合时间</span><input name="meetingAt" type="datetime-local" value="${escapeHtml(project?.meeting_at ? String(project.meeting_at).slice(0, 16) : '')}"></label>
      <label class="field project-span-2"><span>集合地点</span><input name="meetingPlace" maxlength="200" value="${escapeHtml(project?.meeting_place || '')}" placeholder="后续招募通知和执行资料使用"></label>
    </div></section>
    <section class="form-section"><span class="field-title">行程与联系人</span><div class="project-form-grid">
      <label class="field project-span-2"><span>行程内容</span><textarea name="itinerary" rows="4" maxlength="4000" placeholder="按现有资料原样记录，不自动拆路线">${escapeHtml(project?.itinerary || '')}</textarea></label>
      <label class="field"><span>学校总负责人</span><input name="schoolLeadName" maxlength="100" value="${escapeHtml(project?.school_lead_name || '')}"></label>
      <label class="field"><span>负责人电话</span><input name="schoolLeadPhone" maxlength="24" value="${escapeHtml(project?.school_lead_phone || '')}"></label>
    </div></section>
    <section class="form-section condition-section"><span class="field-title">条件模块</span><div class="condition-grid">
      <label class="switch-line"><input name="needsLodging" type="checkbox" ${project?.needs_lodging ? 'checked' : ''}><span><b>需要住宿</b><small>仅多日游可开启；关闭已有安排时会显示影响并再次确认</small></span></label>
      <label class="switch-line"><input name="includesMeals" type="checkbox" ${project?.includes_meals ? 'checked' : ''}><span><b>项目含餐</b><small>开启后必须填写正整数餐次数</small></span></label>
      <label class="field meal-count-field"><span>用餐次数</span><input name="mealCount" type="number" min="1" step="1" value="${project?.includes_meals ? project.meal_count : ''}"></label>
    </div></section>
    <label class="field"><span>特殊注意事项</span><textarea name="specialNotes" rows="3" maxlength="2000">${escapeHtml(project?.special_notes || '')}</textarea></label>
    <p class="form-error form-message" id="project-form-error" role="alert"></p>
    <div class="project-form-actions">${project ? '<button class="button danger-button" type="button" id="delete-project">删除误建项目</button><button class="button secondary" type="button" id="end-project">结束项目</button>' : '<span></span>'}<button class="button secondary" type="button" id="cancel-project">取消</button><button class="button secondary" type="submit" data-save-mode="draft">保存草稿</button><button class="button primary" type="submit" data-save-mode="people">保存并补充班级</button></div>
  </form>`;
}

function serializeProjectForm(form, confirmConditionalClear = false) {
  return { schoolId: form.elements.schoolId.value, grade: form.elements.grade.value, destination: form.elements.destination.value, startsOn: form.elements.startsOn.value, endsOn: form.elements.endsOn.value, meetingPlace: form.elements.meetingPlace.value, meetingAt: form.elements.meetingAt.value || null, itinerary: form.elements.itinerary.value, schoolLeadName: form.elements.schoolLeadName.value, schoolLeadPhone: form.elements.schoolLeadPhone.value, needsLodging: form.elements.needsLodging.checked, includesMeals: form.elements.includesMeals.checked, mealCount: form.elements.includesMeals.checked ? Number(form.elements.mealCount.value) : 0, specialNotes: form.elements.specialNotes.value, confirmConditionalClear };
}

function updateProjectConditions(form) {
  const sameDay = form.elements.startsOn.value && form.elements.startsOn.value === form.elements.endsOn.value;
  if (sameDay) form.elements.needsLodging.checked = false;
  form.elements.needsLodging.disabled = Boolean(sameDay);
  form.elements.tripType.value = form.elements.startsOn.value && form.elements.endsOn.value ? (sameDay ? '一日游' : '多日游') : '由日期自动计算';
  form.elements.mealCount.disabled = !form.elements.includesMeals.checked;
  form.elements.mealCount.required = form.elements.includesMeals.checked;
}

async function saveProjectForm(form, mode, confirmConditionalClear = false) {
  const id = form.dataset.projectId;
  const errorBox = root.querySelector('#project-form-error');
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach((button) => { button.disabled = true; }); errorBox.textContent = '';
  try {
    const project = await api(id ? `/api/projects/${encodeURIComponent(id)}` : '/api/projects', { method: id ? 'PUT' : 'POST', body: JSON.stringify(serializeProjectForm(form, confirmConditionalClear)) });
    location.hash = mode === 'people' ? `/projects/people?project=${encodeURIComponent(project.id)}` : `/projects?query=${encodeURIComponent(project.id)}`;
  } catch (error) {
    if (error.code === 'CONDITIONAL_CLEAR_CONFIRMATION_REQUIRED' && confirm(`${error.message}。确认清理这些条件模块记录并保存？`)) return saveProjectForm(form, mode, true);
    if (error.details?.fields?.length) errorBox.innerHTML = error.details.fields.map((item) => `<div>${escapeHtml(item.message)}</div>`).join('');
    else errorBox.textContent = error.message;
  } finally { buttons.forEach((button) => { button.disabled = false; }); }
}

async function bindProjectFormPage() {
  const host = root.querySelector('#project-form-root');
  const id = routeParams().get('id') || '';
  try {
    const [schools, detail] = await Promise.all([api('/api/schools?active=all'), id ? api(`/api/projects/${encodeURIComponent(id)}`) : Promise.resolve(null)]);
    host.innerHTML = projectFormMarkup(detail?.project || null, schools);
    const form = root.querySelector('#project-form');
    let dirty = false; let saveMode = 'draft';
    updateProjectConditions(form);
    form.elements.startsOn.addEventListener('change', () => { if (!form.elements.endsOn.value) form.elements.endsOn.value = form.elements.startsOn.value; updateProjectConditions(form); });
    form.addEventListener('input', () => { dirty = true; updateProjectConditions(form); });
    form.elements.schoolId.addEventListener('change', async () => {
      if (!form.elements.schoolId.value || id) return;
      try { const defaults = await api(`/api/schools/${encodeURIComponent(form.elements.schoolId.value)}/project-defaults`); form.elements.schoolLeadName.value = defaults.schoolLeadName; form.elements.schoolLeadPhone.value = defaults.schoolLeadPhone; dirty = true; }
      catch { /* 保存时服务端仍会带入默认联系人 */ }
    });
    form.querySelectorAll('[data-save-mode]').forEach((button) => button.addEventListener('click', () => { saveMode = button.dataset.saveMode; }));
    form.addEventListener('submit', (event) => { event.preventDefault(); saveProjectForm(form, saveMode); });
    root.querySelector('#cancel-project').addEventListener('click', () => { if (!dirty || confirm('当前修改尚未保存，确认放弃并返回项目列表？')) location.hash = '/projects'; });
    root.querySelector('#end-project')?.addEventListener('click', async () => { if (!confirm('结束后项目会保留全部历史安排和记录。确认结束这个项目？')) return; try { await api(`/api/projects/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ confirmed: true }) }); location.hash = `/projects?status=${encodeURIComponent('已结束')}`; } catch (error) { root.querySelector('#project-form-error').textContent = error.message; } });
    root.querySelector('#delete-project')?.addEventListener('click', async () => { if (!confirm('只有没有任何业务、导入或导出记录的误建项目才能永久删除。确认继续？')) return; try { await api(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ confirmed: true }) }); location.hash = '/projects'; } catch (error) { root.querySelector('#project-form-error').textContent = error.message; } });
    focusExceptionSource('#project-form');
  } catch (error) { host.innerHTML = `<article class="panel empty-list error-state"><h3>项目表单加载失败</h3><p>${escapeHtml(error.message)}</p><a class="button secondary" href="#/projects">返回项目列表</a></article>`; }
}

function peopleContent() {
  return `<section id="people-page-root" class="people-page-root"><article class="panel"><div class="list-loading"><div class="skeleton title-skeleton"></div><div class="skeleton line-skeleton"></div><div class="skeleton line-skeleton"></div></div></article></section>`;
}

function teacherEditorMarkup(teacher = {}, project = {}) {
  return `<div class="teacher-editor" data-teacher-editor><input type="hidden" data-field="id" value="${escapeHtml(teacher.id || '')}">
    <label class="field"><span>角色 <b>*</b></span><select data-field="role"><option value="班主任" ${teacher.role === '班主任' ? 'selected' : ''}>班主任</option><option value="配班老师" ${teacher.role !== '班主任' ? 'selected' : ''}>配班老师</option></select></label>
    <label class="field"><span>姓名 <b>*</b></span><input data-field="name" required maxlength="100" value="${escapeHtml(teacher.name || '')}"></label>
    <label class="field"><span>电话 <b>*</b></span><input data-field="phone" required maxlength="24" value="${escapeHtml(teacher.phone || '')}"></label>
    <label class="field"><span>性别 <b>*</b></span><select data-field="gender"><option value="">请选择</option><option value="男" ${teacher.gender === '男' ? 'selected' : ''}>男</option><option value="女" ${teacher.gender === '女' ? 'selected' : ''}>女</option></select></label>
    <div class="teacher-flags"><label><input type="checkbox" data-field="ridesVehicle" ${teacher.rides_vehicle !== 0 && teacher.ridesVehicle !== false ? 'checked' : ''}>随车</label><label><input type="checkbox" data-field="needsLodging" ${teacher.needs_lodging || teacher.needsLodging ? 'checked' : ''} ${project.needs_lodging ? '' : 'disabled'}>住宿</label><label><input type="checkbox" data-field="joinsDefaultMeals" ${teacher.joins_default_meals || teacher.joinsDefaultMeals ? 'checked' : ''} ${project.includes_meals ? '' : 'disabled'}>默认就餐</label></div>
    <button type="button" class="text-button danger-text" data-remove-teacher>移除</button>
  </div>`;
}

function classEditorMarkup(item = {}, index = 0, project = {}) {
  const teachers = item.teachers?.length ? item.teachers : [{ role: '班主任', ridesVehicle: true, needsLodging: false, joinsDefaultMeals: false }];
  return `<article class="class-editor" data-class-editor data-source-id="${escapeHtml(item.id || '')}"><input type="hidden" data-field="id" value="${escapeHtml(item.id || '')}">
    <div class="class-editor-heading"><div><span class="class-order">班级 ${index + 1}</span><strong>${escapeHtml(item.name || '待填写班级')}</strong></div><button type="button" class="text-button danger-text" data-remove-class>删除班级</button></div>
    <div class="class-fields">
      <label class="field"><span>班级名称/编号 <b>*</b></span><input data-field="name" required maxlength="80" value="${escapeHtml(item.name || '')}" placeholder="例如：801"></label>
      <label class="field"><span>学生总数 <b>*</b></span><input data-field="studentTotal" type="number" required min="0" step="1" value="${item.student_total ?? item.studentTotal ?? 0}"></label>
      <label class="field"><span>男生 <b>*</b></span><input data-field="boys" type="number" required min="0" step="1" value="${item.boys ?? 0}"></label>
      <label class="field"><span>女生 <b>*</b></span><input data-field="girls" type="number" required min="0" step="1" value="${item.girls ?? 0}"></label>
      <label class="field"><span>需要导游人数 <b>*</b></span><input data-field="guideRequired" type="number" required min="1" step="1" value="${item.guide_required ?? item.guideRequired ?? 1}"></label>
      <label class="field"><span>特殊事项</span><input data-field="specialNotes" maxlength="500" value="${escapeHtml(item.special_notes || item.specialNotes || '')}"></label>
    </div>
    <div class="teachers-section"><div class="section-heading"><div><span class="field-title">老师明细</span><small>每班必须且只能有一名班主任</small></div><button type="button" class="button secondary compact" data-add-teacher>新增配班老师</button></div><div data-teacher-list>${teachers.map((teacher) => teacherEditorMarkup(teacher, project)).join('')}</div></div>
    <label class="field vehicle-reason"><span>老师不全部随车的差异原因</span><input data-field="vehicleDifferenceReason" maxlength="300" value="${escapeHtml(item.vehicle_difference_reason || item.vehicleDifferenceReason || '')}" placeholder="有老师不随车时必填"></label>
  </article>`;
}

function manualStaffRowMarkup(item = {}, project = {}) {
  return `<div class="manual-staff-row" data-manual-staff><input type="hidden" data-field="id" value="${escapeHtml(item.id || '')}">
    <label class="field"><span>角色 <b>*</b></span><select data-field="role"><option value="摄影师" ${item.role === '摄影师' ? 'selected' : ''}>摄影师</option><option value="其他" ${item.role === '其他' ? 'selected' : ''}>其他</option></select></label>
    <label class="field"><span>性别 <b>*</b></span><select data-field="gender"><option value="">请选择</option><option value="男" ${item.gender === '男' ? 'selected' : ''}>男</option><option value="女" ${item.gender === '女' ? 'selected' : ''}>女</option></select></label>
    <label class="field"><span>人数 <b>*</b></span><input data-field="peopleCount" type="number" min="1" step="1" value="${item.people_count ?? item.peopleCount ?? 1}"></label>
    <label class="field"><span>住宿人数</span><input data-field="lodgingCount" type="number" min="0" step="1" value="${item.lodging_count ?? item.lodgingCount ?? 0}" ${project.needs_lodging ? '' : 'disabled'}></label>
    <label class="field"><span>默认就餐人数</span><input data-field="defaultMealCount" type="number" min="0" step="1" value="${item.default_meal_count ?? item.defaultMealCount ?? 0}" ${project.includes_meals ? '' : 'disabled'}></label>
    <label class="field"><span>备注</span><input data-field="notes" maxlength="300" value="${escapeHtml(item.notes || '')}"></label>
    <button type="button" class="text-button danger-text" data-remove-manual>移除</button>
  </div>`;
}

function sourceName(source) {
  if (source.source_type === 'manual_role') return 'P05 手工汇总（不记录姓名）';
  return `${source.source_context || '来源记录'} · ${source.source_name || source.source_id}`;
}

function staffSummaryMarkup(summary) {
  const rows = [
    { role: '学生', gender: '男', people_count: summary.boys, lodging_count: summary.project.needs_lodging ? summary.boys : 0, default_meal_count: summary.project.includes_meals ? summary.boys : 0, source: 'P05 班级人数合计' },
    { role: '学生', gender: '女', people_count: summary.girls, lodging_count: summary.project.needs_lodging ? summary.girls : 0, default_meal_count: summary.project.includes_meals ? summary.girls : 0, source: 'P05 班级人数合计' },
    ...summary.staff.map((item) => ({ ...item, source: sourceName(item) }))
  ];
  return rows.length ? rows.map((item) => `<tr><td>${escapeHtml(item.role)}</td><td>${escapeHtml(item.gender)}</td><td>${item.people_count}</td><td>${item.role === '学生' ? '随项目' : item.source_type === 'teacher' || item.source_type === 'transport_driver' ? item.rides_vehicle_count : '—'}</td><td>${item.lodging_count}</td><td>${item.default_meal_count}</td><td>${escapeHtml(item.source)}</td></tr>`).join('') : '<tr><td colspan="7">暂无人员来源</td></tr>';
}

function renderPeoplePage(summary, message = '') {
  const host = root.querySelector('#people-page-root'); const project = summary.project;
  host.innerHTML = `<section class="people-project-banner panel"><div><p class="eyebrow">当前项目</p><h2>${escapeHtml(project.school_name)} · ${escapeHtml(project.grade)}</h2><p>${escapeHtml(project.destination)} · ${formatProjectDate(project.starts_on)} 至 ${formatProjectDate(project.ends_on)}</p></div><div class="people-banner-actions"><a class="button secondary" href="#/projects/new?id=${encodeURIComponent(project.id)}">编辑项目条件</a><a class="button secondary" href="#/imports?target=classes_teachers&project=${encodeURIComponent(project.id)}">批量导入</a></div></section>
    <section class="metric-grid" aria-label="班级与人员指标">${[['班级', summary.counts.classes, '项目唯一基线'], ['学生', summary.students, `男 ${summary.boys} / 女 ${summary.girls}`], ['老师', summary.teachers, `随车 ${summary.teachersRiding}`], ['所需导游', summary.requiredGuides, '供 P06/P07 使用']].map(([label, value, note]) => `<article class="metric"><span>${label}</span><strong data-people-metric="${label}">${value}</strong><small>${note}</small></article>`).join('')}</section>
    <form id="people-form" class="people-form" data-project-id="${escapeHtml(project.id)}">
      <section class="panel class-list-panel"><div class="section-heading"><div><p class="eyebrow">班级与老师</p><h2>人数和来源明细</h2></div><div class="section-actions"><button type="button" class="button secondary compact" id="copy-class">复制上一班结构</button><button type="button" class="button primary compact" id="add-class">新增班级</button></div></div><div id="class-editor-list">${summary.classes.map((item, index) => classEditorMarkup(item, index, project)).join('')}</div><div id="class-empty" class="inline-empty" ${summary.classes.length ? 'hidden' : ''}>尚未建立班级，请新增班级或批量导入。</div></section>
      <section class="panel manual-staff-panel"><div class="section-heading"><div><p class="eyebrow">其他随团人员</p><h2>只记录角色、性别和人数</h2><small>摄影师和其他人员不采集姓名。</small></div><button type="button" class="button secondary compact" id="add-manual-staff">新增汇总行</button></div><div id="manual-staff-list">${summary.manualStaff.map((item) => manualStaffRowMarkup(item, project)).join('')}</div></section>
      <section class="panel staff-summary-panel"><div class="section-heading"><div><p class="eyebrow">项目随团人员汇总</p><h2>下游模块只读使用此基线</h2></div><span>${summary.staff.length} 条工作人员来源</span></div><div class="staff-table-wrap"><table><thead><tr><th>角色</th><th>性别</th><th>人数</th><th>随车</th><th>住宿</th><th>默认就餐</th><th>来源</th></tr></thead><tbody>${staffSummaryMarkup(summary)}</tbody></table></div></section>
      <div class="people-save-bar"><div><p id="people-validation" class="form-message ${message ? 'success-message' : ''}" role="status">${escapeHtml(message)}</p><p class="people-save-note">保存会重新计算项目人数、异常和下游数据版本。</p></div><button type="button" class="button secondary" id="validate-people">校验人数</button><button type="submit" class="button primary">保存班级与人员基线</button></div>
    </form>`;
}

function serializeTeacher(row) {
  return { id: row.querySelector('[data-field=id]').value || undefined, role: row.querySelector('[data-field=role]').value, name: row.querySelector('[data-field=name]').value, phone: row.querySelector('[data-field=phone]').value, gender: row.querySelector('[data-field=gender]').value, ridesVehicle: row.querySelector('[data-field=ridesVehicle]').checked, needsLodging: row.querySelector('[data-field=needsLodging]').checked, joinsDefaultMeals: row.querySelector('[data-field=joinsDefaultMeals]').checked };
}

function serializePeopleForm(form) {
  const classes = [...form.querySelectorAll('[data-class-editor]')].map((row) => ({ id: row.querySelector(':scope>[data-field=id]').value || undefined, name: row.querySelector(':scope .class-fields [data-field=name]').value, studentTotal: Number(row.querySelector('[data-field=studentTotal]').value), boys: Number(row.querySelector('[data-field=boys]').value), girls: Number(row.querySelector('[data-field=girls]').value), guideRequired: Number(row.querySelector('[data-field=guideRequired]').value), specialNotes: row.querySelector('[data-field=specialNotes]').value, vehicleDifferenceReason: row.querySelector('[data-field=vehicleDifferenceReason]').value, teachers: [...row.querySelectorAll('[data-teacher-editor]')].map(serializeTeacher) }));
  const manualStaff = [...form.querySelectorAll('[data-manual-staff]')].map((row) => ({ id: row.querySelector('[data-field=id]').value || undefined, role: row.querySelector('[data-field=role]').value, gender: row.querySelector('[data-field=gender]').value, peopleCount: Number(row.querySelector('[data-field=peopleCount]').value), lodgingCount: Number(row.querySelector('[data-field=lodgingCount]').value || 0), defaultMealCount: Number(row.querySelector('[data-field=defaultMealCount]').value || 0), notes: row.querySelector('[data-field=notes]').value }));
  return { classes, manualStaff };
}

function localPeopleErrors(form) {
  const errors = [];
  [...form.querySelectorAll('[data-class-editor]')].forEach((row, index) => { const value = serializePeopleForm({ querySelectorAll: (selector) => selector === '[data-class-editor]' ? [row] : [] }).classes[0]; if (value.studentTotal !== value.boys + value.girls) errors.push(`班级 ${value.name || index + 1}：学生总数 ${value.studentTotal} ≠ 男生 ${value.boys} + 女生 ${value.girls}`); });
  return errors;
}

function bindPeopleEditor(summary) {
  const form = root.querySelector('#people-form'); const project = summary.project; const classList = root.querySelector('#class-editor-list'); const manualList = root.querySelector('#manual-staff-list');
  const refreshOrders = () => { [...classList.querySelectorAll('[data-class-editor]')].forEach((row, index) => { row.querySelector('.class-order').textContent = `班级 ${index + 1}`; row.querySelector('.class-editor-heading strong').textContent = row.querySelector('.class-fields [data-field=name]').value || '待填写班级'; }); root.querySelector('#class-empty').hidden = classList.children.length > 0; };
  root.querySelector('#add-class').addEventListener('click', () => { classList.insertAdjacentHTML('beforeend', classEditorMarkup({}, classList.children.length, project)); refreshOrders(); });
  root.querySelector('#copy-class').addEventListener('click', () => { const last = classList.querySelector('[data-class-editor]:last-child'); if (!last) return classList.insertAdjacentHTML('beforeend', classEditorMarkup({}, 0, project)); const source = serializePeopleForm({ querySelectorAll: (selector) => selector === '[data-class-editor]' ? [last] : [] }).classes[0]; classList.insertAdjacentHTML('beforeend', classEditorMarkup({ ...source, id: '', name: '', studentTotal: 0, boys: 0, girls: 0, teachers: source.teachers.map((teacher) => ({ ...teacher, id: '' })) }, classList.children.length, project)); refreshOrders(); });
  classList.addEventListener('input', refreshOrders);
  classList.addEventListener('click', (event) => { const add = event.target.closest('[data-add-teacher]'); const removeTeacher = event.target.closest('[data-remove-teacher]'); const removeClass = event.target.closest('[data-remove-class]'); if (add) add.closest('[data-class-editor]').querySelector('[data-teacher-list]').insertAdjacentHTML('beforeend', teacherEditorMarkup({ role: '配班老师', ridesVehicle: true }, project)); if (removeTeacher) removeTeacher.closest('[data-teacher-editor]').remove(); if (removeClass && confirm('删除后保存时会检查该班级是否已被下游安排引用。确认从本次编辑中移除？')) { removeClass.closest('[data-class-editor]').remove(); refreshOrders(); } });
  root.querySelector('#add-manual-staff').addEventListener('click', () => manualList.insertAdjacentHTML('beforeend', manualStaffRowMarkup({}, project)));
  manualList.addEventListener('click', (event) => event.target.closest('[data-remove-manual]')?.closest('[data-manual-staff]').remove());
  root.querySelector('#validate-people').addEventListener('click', () => { const box = root.querySelector('#people-validation'); const errors = localPeopleErrors(form); box.className = `form-message ${errors.length ? '' : 'success-message'}`; box.innerHTML = errors.length ? errors.map(escapeHtml).join('<br>') : '当前班级人数等式通过；保存时还会校验老师和随团人员字段。'; });
  form.addEventListener('submit', async (event) => { event.preventDefault(); const submit = form.querySelector('[type=submit]'); const box = root.querySelector('#people-validation'); submit.disabled = true; submit.textContent = '正在保存…'; box.className = 'form-message'; box.textContent = ''; form.querySelectorAll('.field-invalid').forEach((node) => node.classList.remove('field-invalid')); try { const saved = await api(`/api/projects/${encodeURIComponent(form.dataset.projectId)}/people`, { method: 'POST', body: JSON.stringify(serializePeopleForm(form)) }); renderPeoplePage(saved, '班级、老师和随团人员基线已保存并重新计算。'); bindPeopleEditor(saved); } catch (error) { if (error.code === 'CLASS_IN_USE') box.innerHTML = `${escapeHtml(error.message)}：${(error.details.classes || []).map((item) => `${escapeHtml(item.name)}（${item.total} 项引用）`).join('、')}`; else if (error.details?.fields?.length) { box.innerHTML = error.details.fields.map((item) => escapeHtml(item.message)).join('<br>'); for (const item of error.details.fields) { const match = item.field.match(/^classes\.(\d+)/); if (match) form.querySelectorAll('[data-class-editor]')[Number(match[1])]?.classList.add('field-invalid'); } } else box.textContent = error.message; } finally { if (document.contains(submit)) { submit.disabled = false; submit.textContent = '保存班级与人员基线'; } } });
}

async function bindPeoplePage() {
  const host = root.querySelector('#people-page-root'); const projectId = routeParams().get('project') || '';
  try {
    if (!projectId) {
      const projects = await api('/api/projects?includeEnded=true');
      host.innerHTML = `<article class="panel people-picker"><p class="eyebrow">选择项目</p><h2>先选择要维护的项目</h2><p>班级和老师只属于一个具体项目，不写入学校库。</p>${projects.length ? `<form id="people-project-picker"><select name="project">${projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.school_name)} · ${escapeHtml(project.grade)} · ${escapeHtml(project.destination)}</option>`).join('')}</select><button class="button primary">进入班级与人员</button></form>` : '<a class="button primary" href="#/projects/new">先新建项目</a>'}</article>`;
      host.querySelector('#people-project-picker')?.addEventListener('submit', (event) => { event.preventDefault(); location.hash = `/projects/people?project=${encodeURIComponent(new FormData(event.currentTarget).get('project'))}`; });
      return;
    }
    const summary = await api(`/api/projects/${encodeURIComponent(projectId)}`); renderPeoplePage(summary); bindPeopleEditor(summary); focusExceptionSource('.people-project-banner');
  } catch (error) { host.innerHTML = `<article class="panel empty-list error-state"><h3>班级与人员资料加载失败</h3><p>${escapeHtml(error.message)}</p><a class="button secondary" href="#/projects">返回项目列表</a></article>`; }
}

function recruitmentContent() {
  return `<section id="recruitment-page-root"><article class="panel"><div class="list-loading"><div class="skeleton title-skeleton"></div><div class="skeleton line-skeleton"></div></div></article></section>`;
}

function recruitmentPickerMarkup(projects) {
  return `<article class="panel empty-list recruitment-picker"><h2>选择要招募导游的项目</h2><p>日期、学校、年级和所需导游数都从所选项目读取。</p><form id="recruitment-project-picker"><label class="field"><span>项目</span><select name="project" required><option value="">请选择</option>${projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.school_name)} · ${escapeHtml(project.grade)} · ${escapeHtml(project.starts_on)}</option>`).join('')}</select></label><button class="button primary" type="submit">进入 P06</button></form></article>`;
}

function recruitmentBatchMarkup(batch) {
  return `<details class="recruitment-batch"><summary><span><strong>${escapeHtml(batch.notes || '未填写批次备注')}</strong><small>${escapeHtml(new Date(batch.createdAt).toLocaleString('zh-CN'))}</small></span><span>${batch.matchedCount}/${batch.rowCount} 已匹配</span></summary><div class="batch-rows">${batch.rows.map((row) => `<div><b>${row.sourceSequence ?? row.batchOrder}. ${escapeHtml(row.name)}</b><span>${escapeHtml(row.phone || '缺手机号')}</span><span class="status-tag ${row.matchStatus === '已匹配' ? 'success' : 'warning'}">${escapeHtml(row.matchStatus)}</span></div>`).join('')}</div></details>`;
}

function recruitmentPageMarkup(context) {
  const { project } = context; const dateText = project.starts_on === project.ends_on ? formatProjectDate(project.starts_on) : `${formatProjectDate(project.starts_on)} 至 ${formatProjectDate(project.ends_on)}`;
  return `<section class="recruitment-summary panel"><div><p class="eyebrow">当前项目</p><h2>${escapeHtml(project.school_name)} · ${escapeHtml(project.grade)}</h2><p>${dateText} · ${escapeHtml(project.destination)}</p></div><div class="recruitment-summary-metrics"><span><b>${context.requiredGuides}</b> 所需导游</span><span><b>${context.classCount}</b> 个班级</span><span><b>${context.batches.length}</b> 个接龙批次</span></div></section>
    <section class="recruitment-workspace">
      <article class="panel notice-builder"><div class="section-heading"><div><p class="eyebrow">招募通知</p><h2>生成后人工复制到微信群</h2></div><span class="boundary-chip">仅复制文本</span></div>
        <form id="notice-form"><div class="notice-settings"><label class="field"><span>出团日期</span><input value="${escapeHtml(dateText)}" readonly></label><label class="field"><span>所需导游人数</span><input name="guideCount" type="number" min="1" step="1" required value="${context.requiredGuides || ''}"></label><label class="check-line"><input name="showSchool" type="checkbox"><span>通知中显示学校</span></label><label class="check-line"><input name="showGrade" type="checkbox"><span>通知中显示年级</span></label></div><label class="field"><span>补充说明</span><input name="extraNotes" maxlength="200" placeholder="例如：请确认可全程带团"></label><label class="field"><span>生成的通知</span><textarea id="notice-output" rows="10" readonly></textarea></label><p class="form-error" id="notice-error"></p><div class="notice-actions"><span id="copy-status" role="status"></span><button class="button secondary" type="button" id="refresh-notice">生成/刷新通知</button><button class="button primary" type="button" id="copy-notice">复制通知</button></div></form>
      </article>
      <article class="panel signup-import"><div class="section-heading"><div><p class="eyebrow">最终接龙</p><h2>粘贴、预览，再确认写入</h2></div><a class="text-link inline" href="#/imports?target=guide_recruitment">其他文件格式</a></div>
        <form id="signup-form"><label class="field"><span>解析模板</span><select name="template"><option value="common">常见：序号＋姓名＋手机号</option></select></label><label class="field"><span>导入批次备注</span><input name="notes" maxlength="100" placeholder="例如：第一轮接龙 / 补充接龙"></label><label class="field"><span>原始接龙文本 <b>*</b></span><textarea name="rawText" rows="12" required placeholder="1. 王晨 13800000001&#10;2. 周妍 13800000002"></textarea><small>原文、批次、批次内位置和接龙序号都会保留。</small></label><p class="form-error" id="signup-error"></p><div class="signup-actions"><button class="button secondary" type="button" id="clear-signup">清空本次粘贴</button><button class="button primary" type="submit">解析接龙</button></div></form>
      </article>
    </section>
    <section id="recruitment-preview" class="panel recruitment-preview hidden"></section>
    <section class="panel recruitment-history"><div class="section-heading"><div><p class="eyebrow">已确认批次</p><h2>按确认时间倒序</h2></div><span>${context.batches.length} 个批次</span></div><div>${context.batches.length ? context.batches.map(recruitmentBatchMarkup).join('') : '<div class="empty-compact"><p>还没有已确认的接龙批次。</p></div>'}</div></section>`;
}

function recruitmentCandidateMarkup(entry) {
  if (entry.matchStatus === '已匹配') return `<span class="matched-guide">${escapeHtml(entry.candidates[0]?.name || entry.name)} · ${escapeHtml(entry.candidates[0]?.workPhone || entry.phone)}</span>`;
  const options = entry.candidates.map((guide) => `<option value="${escapeHtml(guide.id)}">${escapeHtml(guide.name)} · ${escapeHtml(guide.workPhone)} · ${escapeHtml(guideStatusLabel(guide.cooperationStatus))}</option>`).join('');
  return `<div class="resolution-controls">${options ? `<select data-resolution-guide><option value="">选择候选档案</option>${options}</select>` : `<a class="text-link inline" href="#/guides/detail?mode=new&name=${encodeURIComponent(entry.name)}&phone=${encodeURIComponent(entry.phone)}">前往 P15 建档</a>`}<label class="check-line"><input type="checkbox" data-acknowledge-unresolved><span>明确保留为${entry.matchStatus}</span></label></div>`;
}

function renderRecruitmentPreview(preview) {
  const host = root.querySelector('#recruitment-preview');
  host.classList.remove('hidden');
  host.innerHTML = `<div class="section-heading"><div><p class="eyebrow">匹配预览</p><h2>保持接龙原顺序</h2></div><div class="preview-counts"><span>${preview.counts.total} 行</span><span class="success-text">${preview.counts.matched} 自动匹配</span><span class="warning-text">${preview.counts.unresolved} 待人工处理</span></div></div>
    <div class="recruitment-table recruitment-table-head"><span>原序号 / 来源行</span><span>姓名与手机号</span><span>匹配状态</span><span>人工处理</span></div>
    <div id="recruitment-preview-rows">${preview.entries.map((entry) => `<article class="recruitment-preview-row" data-preview-order="${entry.batchOrder}"><div><b>${entry.sourceSequence}</b><small>原文第 ${entry.sourceRowNumber} 行</small></div><div><strong>${escapeHtml(entry.name)}</strong><span>${escapeHtml(entry.phone || '缺手机号')}</span></div><span class="status-tag ${entry.matchStatus === '已匹配' ? 'success' : entry.matchStatus === '未建档' ? 'muted-tag' : 'warning'}">${escapeHtml(entry.matchStatus)}</span>${recruitmentCandidateMarkup(entry)}</article>`).join('')}</div>
    <div class="confirm-recruitment"><p>自动匹配只认“姓名＋手机号”同时一致。其他行必须明确选择候选档案，或确认保留待处理。</p><p class="form-error" id="confirm-recruitment-error"></p><button class="button primary" id="confirm-recruitment" type="button">确认写入本批次</button></div>`;
}

async function copyPlainText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const helper = document.createElement('textarea'); helper.value = text; helper.setAttribute('readonly', ''); helper.style.position = 'fixed'; helper.style.opacity = '0'; document.body.append(helper); helper.select();
  const copied = document.execCommand('copy'); helper.remove(); if (!copied) throw new Error('浏览器未允许写入剪贴板');
}

function bindRecruitmentWorkspace(context) {
  const projectId = context.project.id; const noticeForm = root.querySelector('#notice-form'); const signupForm = root.querySelector('#signup-form'); let currentPreview = null; let noticeTimer = null;
  const generateNotice = async () => {
    const data = new FormData(noticeForm); const errorBox = root.querySelector('#notice-error');
    try { const notice = await api(`/api/projects/${encodeURIComponent(projectId)}/recruitment/notice`, { method: 'POST', body: JSON.stringify({ guideCount: Number(data.get('guideCount')), showSchool: data.get('showSchool') === 'on', showGrade: data.get('showGrade') === 'on', extraNotes: data.get('extraNotes') }) }); root.querySelector('#notice-output').value = notice.text; errorBox.textContent = ''; return notice.text; }
    catch (error) { errorBox.textContent = error.message; return ''; }
  };
  noticeForm.addEventListener('input', () => { clearTimeout(noticeTimer); noticeTimer = setTimeout(generateNotice, 120); });
  root.querySelector('#refresh-notice').addEventListener('click', generateNotice);
  root.querySelector('#copy-notice').addEventListener('click', async () => {
    const status = root.querySelector('#copy-status'); const text = root.querySelector('#notice-output').value || await generateNotice();
    try { await copyPlainText(text); status.textContent = '已复制到剪贴板'; }
    catch (error) { status.textContent = error.message; }
  });
  root.querySelector('#clear-signup').addEventListener('click', () => { signupForm.reset(); currentPreview = null; root.querySelector('#recruitment-preview').classList.add('hidden'); root.querySelector('#recruitment-preview').innerHTML = ''; root.querySelector('#signup-error').textContent = ''; });
  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(signupForm); const errorBox = root.querySelector('#signup-error');
    try { currentPreview = await api(`/api/projects/${encodeURIComponent(projectId)}/recruitment/preview`, { method: 'POST', body: JSON.stringify({ rawText: data.get('rawText'), notes: data.get('notes') }) }); renderRecruitmentPreview(currentPreview); bindRecruitmentPreview(); errorBox.textContent = ''; }
    catch (error) { errorBox.textContent = error.message; }
  });
  const bindRecruitmentPreview = () => {
    const rows = root.querySelector('#recruitment-preview-rows');
    rows.addEventListener('change', (event) => { const row = event.target.closest('[data-preview-order]'); if (!row) return; if (event.target.matches('[data-resolution-guide]') && event.target.value) row.querySelector('[data-acknowledge-unresolved]').checked = false; if (event.target.matches('[data-acknowledge-unresolved]') && event.target.checked) { const select = row.querySelector('[data-resolution-guide]'); if (select) select.value = ''; } });
    root.querySelector('#confirm-recruitment').addEventListener('click', async (event) => {
      const errorBox = root.querySelector('#confirm-recruitment-error'); const source = new FormData(signupForm);
      const decisions = [...rows.querySelectorAll('[data-preview-order]')].map((row) => ({ batchOrder: Number(row.dataset.previewOrder), guideId: row.querySelector('[data-resolution-guide]')?.value || '', acknowledgeUnresolved: Boolean(row.querySelector('[data-acknowledge-unresolved]')?.checked) }));
      event.currentTarget.disabled = true; event.currentTarget.textContent = '正在确认…';
      try { await api(`/api/projects/${encodeURIComponent(projectId)}/recruitment/confirm`, { method: 'POST', body: JSON.stringify({ rawText: source.get('rawText'), notes: source.get('notes'), decisions }) }); await bindRecruitmentPage(); }
      catch (error) { errorBox.textContent = error.message; event.currentTarget.disabled = false; event.currentTarget.textContent = '确认写入本批次'; }
    });
  };
  generateNotice();
}

async function bindRecruitmentPage() {
  const host = root.querySelector('#recruitment-page-root'); const projectId = routeParams().get('project') || '';
  try {
    if (!projectId) {
      const projects = await api('/api/projects'); host.innerHTML = recruitmentPickerMarkup(projects);
      host.querySelector('#recruitment-project-picker').addEventListener('submit', (event) => { event.preventDefault(); location.hash = `/projects/recruitment?project=${encodeURIComponent(new FormData(event.currentTarget).get('project'))}`; }); return;
    }
    const context = await api(`/api/projects/${encodeURIComponent(projectId)}/recruitment`); host.innerHTML = recruitmentPageMarkup(context); bindRecruitmentWorkspace(context);
  } catch (error) { host.innerHTML = `<article class="panel empty-list error-state"><h3>招募与接龙页面加载失败</h3><p>${escapeHtml(error.message)}</p><a class="button secondary" href="#/projects">返回项目列表</a></article>`; }
}

function projectGuidesContent() {
  return `<section id="project-guides-root" class="project-guides-root"><article class="panel"><div class="list-loading"><div class="skeleton title-skeleton"></div><div class="skeleton line-skeleton"></div><div class="skeleton line-skeleton"></div></div></article></section>`;
}

function guideProjectPickerMarkup(projects) {
  return `<article class="panel empty-list guide-project-picker"><h2>选择要安排导游的项目</h2><p>P07 会读取该项目的接龙名单、班级和完整日期。</p><form id="guide-project-picker"><label class="field"><span>项目</span><select name="project" required><option value="">请选择</option>${projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.school_name)} · ${escapeHtml(project.grade)} · ${escapeHtml(project.starts_on)}</option>`).join('')}</select></label><button class="button primary" type="submit">进入 P07</button></form></article>`;
}

function guideEligibility(row) {
  if (row.match_status !== '已匹配') return { blocked: true, label: row.match_status };
  if (!row.active || row.cooperation_status !== '可合作') return { blocked: true, label: '合作停用' };
  if (row.documentState?.status === '过期') return { blocked: true, label: '证件过期' };
  if (row.conflicts?.length) return { blocked: true, label: '日期冲突' };
  return { blocked: false, label: row.documentState?.status === '临期' ? '证件临期' : row.documentState?.status || '可安排' };
}

function projectGuideCardMarkup(row, summary) {
  const eligibility = guideEligibility(row); const assignedIds = new Set(row.assignments.map((item) => item.classId));
  const isFinal = ['已退团', '已替换'].includes(row.handling_status); const isAssigned = row.assignment_count > 0 && row.handling_status === '保留';
  const classes = summary.classes.map((item) => {
    const coverage = summary.guideCoverage.find((entry) => entry.id === item.id); const checked = assignedIds.has(item.id);
    const full = !checked && Number(coverage?.assignedCount || 0) >= Number(coverage?.guideRequired || 1);
    return `<label class="guide-class-option ${full ? 'option-full' : ''}"><input type="checkbox" name="classId" value="${escapeHtml(item.id)}" ${checked ? 'checked' : ''} ${full || isFinal ? 'disabled' : ''}><span><b>${escapeHtml(item.name)}</b><small>${coverage?.assignedCount || 0}/${coverage?.guideRequired || 1} 已覆盖 · ${item.student_total} 名学生</small></span></label>`;
  }).join('');
  const conflicts = row.conflicts?.length ? `<div class="guide-conflict-list">${row.conflicts.map((item) => `<p><b>日期冲突</b><span>项目 ${escapeHtml(item.projectId)} · ${escapeHtml(item.schoolName)} · ${escapeHtml(item.grade)} · ${escapeHtml(item.destination)} · ${escapeHtml(item.overlapStartsOn)} 至 ${escapeHtml(item.overlapEndsOn)}</span></p>`).join('')}</div>` : '';
  const history = row.withdrawal ? `<div class="guide-history"><strong>${escapeHtml(row.handling_status)}</strong><span>${escapeHtml(row.withdrawal.reason)} · 记录于 ${escapeHtml(formatProjectTime(row.withdrawal.recordedAt))} · 距出团 ${row.withdrawal.daysBeforeDeparture} 天</span>${row.withdrawal.replacementProjectGuideId ? `<span>替换为 ${escapeHtml(row.replacement_guide_name || row.replacement_source_name || row.withdrawal.replacementProjectGuideId)}</span>` : ''}</div>` : '';
  return `<article class="panel project-guide-card" data-project-guide="${escapeHtml(row.id)}" data-handling-status="${escapeHtml(row.handling_status)}">
    <header class="project-guide-heading"><div class="guide-order">${row.source_sequence ?? row.source_order}</div><div class="guide-identity"><h3>${escapeHtml(row.guide_name || row.source_name)}</h3><p>${escapeHtml(row.guide_phone || row.source_phone || '缺手机号')} · ${escapeHtml(row.gender || '未填写')}</p></div><div class="guide-state-tags"><span class="status-tag ${row.match_status === '已匹配' ? 'success' : 'warning'}">${escapeHtml(row.match_status)}</span><span class="status-tag ${eligibility.blocked ? 'warning' : eligibility.label === '证件临期' ? 'warning' : 'success'}">${escapeHtml(eligibility.label)}</span><span class="status-tag ${isFinal ? 'muted-tag' : row.handling_status === '移出' ? 'warning' : 'planned'}">${escapeHtml(row.handling_status)}</span></div>${row.guide_id ? `<a class="text-link inline" href="#/guides/detail?id=${encodeURIComponent(row.guide_id)}">P15 档案</a>` : '<span class="warning-text">未建档</span>'}</header>
    ${conflicts}${history}
    <form class="guide-assignment-form" data-guide-id="${escapeHtml(row.id)}">
      <fieldset class="guide-class-fieldset" ${isFinal ? 'disabled' : ''}><legend>负责班级</legend><div>${classes || '<p class="empty-compact">请先在 P05 建立班级。</p>'}</div></fieldset>
      <label class="field dual-class-field"><span>特殊双班原因</span><input name="dualClassReason" maxlength="300" value="${escapeHtml(row.dual_class_reason || '')}" placeholder="勾选两个班时必填"></label>
      <div class="guide-participation"><label class="check-line"><input type="checkbox" name="needsLodging" ${row.needs_lodging ? 'checked' : ''} ${summary.project.needs_lodging ? '' : 'disabled'}><span>本项目住宿</span></label><label class="check-line"><input type="checkbox" name="joinsDefaultMeals" ${row.joins_default_meals ? 'checked' : ''} ${summary.project.includes_meals ? '' : 'disabled'}><span>参加默认餐次</span></label></div>
      <p class="form-error guide-row-message" role="status"></p>
      <div class="guide-row-actions">${!isFinal ? `<button type="button" class="button secondary compact" data-guide-status="保留">保留</button><button type="button" class="button secondary compact" data-guide-status="移出" ${isAssigned ? 'disabled title="已分班请使用退团"' : ''}>移出</button><button type="submit" class="button primary compact" ${eligibility.blocked ? 'disabled' : ''}>保存分配</button>` : ''}${isAssigned ? `<button type="button" class="button secondary compact" data-withdraw-guide>记录退团</button><button type="button" class="button primary compact" data-replace-guide>更换导游</button>` : ''}</div>
    </form>
  </article>`;
}

function guideArrangementPageMarkup(summary, message = '') {
  const { project } = summary; const gap = summary.guideCoverage.reduce((sum, row) => sum + Math.max(0, row.guideRequired - row.assignedCount), 0);
  const retained = summary.guides.filter((row) => row.handling_status === '保留').length;
  const conflicts = summary.guides.filter((row) => row.conflicts?.length && row.handling_status !== '已退团' && row.handling_status !== '已替换').length;
  return `<section class="guide-project-summary panel"><div><p class="eyebrow">当前项目</p><h2>${escapeHtml(project.school_name)} · ${escapeHtml(project.grade)}</h2><p>${formatProjectDate(project.starts_on)} 至 ${formatProjectDate(project.ends_on)} · ${escapeHtml(project.destination)}</p></div><div class="guide-summary-metrics"><span><b>${summary.requiredGuides}</b> 所需</span><span><b data-guide-metric="arranged">${summary.arrangedGuides}</b> 已安排</span><span><b data-guide-metric="gap">${gap}</b> 班级缺口</span><span><b>${conflicts}</b> 冲突</span></div></section>
    <section class="panel guide-toolbar"><div><p class="eyebrow">安排控制</p><h2>建议只填入表单，保存后才成为正式安排</h2><p id="guide-page-message" class="form-message ${message ? 'success-message' : ''}" role="status">${escapeHtml(message)}</p></div><div><a class="button secondary" href="#/projects/recruitment?project=${encodeURIComponent(project.id)}">返回接龙</a><button class="button secondary" id="suggest-guides" type="button">按顺序生成建议</button><button class="button primary hidden" id="save-guide-suggestions" type="button">确认保存当前建议</button><button class="button primary" id="recalculate-guides" type="button">重新校验</button></div></section>
    <section class="guide-coverage-grid">${summary.guideCoverage.map((row) => `<article class="coverage-card ${row.assignedCount >= row.guideRequired ? 'coverage-complete' : ''}" data-coverage-class="${escapeHtml(row.id)}"><span>${escapeHtml(row.name)}</span><b>${row.assignedCount}/${row.guideRequired}</b><small>${row.assignedCount >= row.guideRequired ? '已覆盖' : `还缺 ${row.guideRequired - row.assignedCount} 名`}</small></article>`).join('')}</section>
    <section class="project-guide-list"><div class="guide-list-heading"><div><p class="eyebrow">最终接龙名单</p><h2>按原始接龙顺序</h2></div><span>${summary.guides.length} 人 · ${retained} 人保留</span></div>${summary.guides.length ? summary.guides.map((row) => projectGuideCardMarkup(row, summary)).join('') : `<article class="panel empty-list"><h3>还没有接龙名单</h3><p>先到 P06 导入并确认最终接龙，再回来安排班级。</p><a class="button primary" href="#/projects/recruitment?project=${encodeURIComponent(project.id)}">前往 P06</a></article>`}</section>
    <dialog id="guide-action-dialog" class="form-dialog guide-action-dialog"><form id="guide-action-form" class="entity-form"><input type="hidden" name="guideId"><input type="hidden" name="action"><div class="dialog-heading"><p class="eyebrow">导游安排变更</p><h2 id="guide-action-title">记录退团</h2><p id="guide-action-description"></p></div><label class="field"><span>原因 <b>*</b></span><textarea name="reason" rows="4" required maxlength="500"></textarea></label><label class="field hidden" id="replacement-field"><span>替换导游 <b>*</b></span><select name="replacementProjectGuideId"></select></label><p class="form-error" id="guide-action-error" role="alert"></p><div class="dialog-actions"><span></span><button class="button secondary" id="cancel-guide-action" type="button">取消</button><button class="button danger-button" type="submit">确认变更</button></div></form></dialog>`;
}

function bindGuideArrangementWorkspace(summary) {
  const projectId = summary.project.id; const message = root.querySelector('#guide-page-message'); const dialog = root.querySelector('#guide-action-dialog'); const actionForm = root.querySelector('#guide-action-form');
  const refresh = async (successMessage = '') => { const next = await api(`/api/projects/${encodeURIComponent(projectId)}`); const host = root.querySelector('#project-guides-root'); host.innerHTML = guideArrangementPageMarkup(next, successMessage); bindGuideArrangementWorkspace(next); };
  root.querySelector('#recalculate-guides').addEventListener('click', async (event) => { event.currentTarget.disabled = true; try { await api(`/api/projects/${encodeURIComponent(projectId)}/recalculate`, { method: 'POST', body: '{}' }); await refresh('日期、证件、合作状态和班级覆盖已重新校验。'); } catch (error) { message.textContent = error.message; event.currentTarget.disabled = false; } });
  root.querySelector('#suggest-guides').addEventListener('click', () => {
    const needs = new Map(summary.guideCoverage.map((row) => [row.id, Math.max(0, row.guideRequired - row.assignedCount)])); let proposed = 0;
    for (const row of summary.guides) {
      if (row.assignment_count || guideEligibility(row).blocked || ['移出', '已退团', '已替换'].includes(row.handling_status)) continue;
      const classId = [...needs].find(([, count]) => count > 0)?.[0]; if (!classId) break;
      const checkbox = root.querySelector(`[data-project-guide="${CSS.escape(row.id)}"] input[name=classId][value="${CSS.escape(classId)}"]`);
      if (checkbox && !checkbox.disabled) { checkbox.checked = true; checkbox.closest('form').dataset.suggested = 'true'; needs.set(classId, needs.get(classId) - 1); proposed += 1; }
    }
    root.querySelector('#save-guide-suggestions').classList.toggle('hidden', !proposed); message.className = 'form-message success-message'; message.textContent = proposed ? `已按接龙顺序填入 ${proposed} 条建议；请逐条核对参与标记，再统一确认保存。` : '没有可生成的建议，请检查匹配、冲突和班级缺口。';
  });
  root.querySelector('#save-guide-suggestions').addEventListener('click', async (event) => {
    const forms = [...root.querySelectorAll('.guide-assignment-form[data-suggested="true"]')]; event.currentTarget.disabled = true;
    try { for (const form of forms) { const data = new FormData(form); await api(`/api/project-guides/${encodeURIComponent(form.dataset.guideId)}/assign`, { method: 'POST', body: JSON.stringify({ classIds: data.getAll('classId'), dualClassReason: data.get('dualClassReason'), needsLodging: data.get('needsLodging') === 'on', joinsDefaultMeals: data.get('joinsDefaultMeals') === 'on' }) }); } await refresh(`已确认保存 ${forms.length} 条顺序建议，P05 汇总已同步。`); }
    catch (error) { message.className = 'form-message'; message.textContent = error.message; event.currentTarget.disabled = false; }
  });
  root.querySelectorAll('.guide-assignment-form').forEach((form) => {
    const rowMessage = form.querySelector('.guide-row-message');
    form.addEventListener('submit', async (event) => { event.preventDefault(); const data = new FormData(form); const classIds = data.getAll('classId'); if (classIds.length > 1 && !String(data.get('dualClassReason') || '').trim()) { rowMessage.textContent = '勾选两个班时必须填写特殊双班原因。'; return; } const button = form.querySelector('[type=submit]'); button.disabled = true; try { await api(`/api/project-guides/${encodeURIComponent(form.dataset.guideId)}/assign`, { method: 'POST', body: JSON.stringify({ classIds, dualClassReason: data.get('dualClassReason'), needsLodging: data.get('needsLodging') === 'on', joinsDefaultMeals: data.get('joinsDefaultMeals') === 'on' }) }); await refresh('班级分配与 P05 随团人员汇总已同步。'); } catch (error) { rowMessage.textContent = error.message; button.disabled = false; } });
    form.addEventListener('click', async (event) => { const statusButton = event.target.closest('[data-guide-status]'); if (statusButton) { statusButton.disabled = true; try { await api(`/api/project-guides/${encodeURIComponent(form.dataset.guideId)}/status`, { method: 'PATCH', body: JSON.stringify({ status: statusButton.dataset.guideStatus }) }); await refresh(`名单状态已改为“${statusButton.dataset.guideStatus}”。`); } catch (error) { rowMessage.textContent = error.message; statusButton.disabled = false; } return; }
      const withdraw = event.target.closest('[data-withdraw-guide]'); const replace = event.target.closest('[data-replace-guide]'); if (!withdraw && !replace) return; const action = replace ? 'replace' : 'withdraw'; actionForm.elements.guideId.value = form.dataset.guideId; actionForm.elements.action.value = action; actionForm.elements.reason.value = ''; root.querySelector('#guide-action-error').textContent = ''; root.querySelector('#guide-action-title').textContent = replace ? '更换导游' : '记录退团'; root.querySelector('#guide-action-description').textContent = replace ? '原班级将原子转移给替换人选，并保留前后关系和退团事实。' : '保存后立即释放班级并产生缺口。'; const field = root.querySelector('#replacement-field'); field.classList.toggle('hidden', !replace); field.querySelector('select').required = Boolean(replace); if (replace) { const choices = summary.guides.filter((row) => row.id !== form.dataset.guideId && !row.assignment_count && !guideEligibility(row).blocked && !['已退团', '已替换'].includes(row.handling_status)); field.querySelector('select').innerHTML = `<option value="">请选择无冲突人选</option>${choices.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.guide_name || row.source_name)} · 序号 ${row.source_sequence ?? row.source_order}</option>`).join('')}`; } dialog.showModal(); });
  });
  root.querySelector('#cancel-guide-action').addEventListener('click', () => dialog.close());
  actionForm.addEventListener('submit', async (event) => { event.preventDefault(); const data = new FormData(actionForm); const action = data.get('action'); const button = actionForm.querySelector('[type=submit]'); button.disabled = true; try { await api(`/api/project-guides/${encodeURIComponent(data.get('guideId'))}/${action}`, { method: 'POST', body: JSON.stringify({ reason: data.get('reason'), replacementProjectGuideId: data.get('replacementProjectGuideId') || undefined }) }); dialog.close(); await refresh(action === 'replace' ? '替换关系、班级分配和 P05 汇总已同步。' : '退团事实已记录，原班级现在显示缺口。'); } catch (error) { root.querySelector('#guide-action-error').textContent = error.message; button.disabled = false; } });
}

async function bindGuideArrangementPage() {
  const host = root.querySelector('#project-guides-root'); const projectId = routeParams().get('project') || '';
  try {
    if (!projectId) { const projects = await api('/api/projects'); host.innerHTML = guideProjectPickerMarkup(projects); host.querySelector('#guide-project-picker').addEventListener('submit', (event) => { event.preventDefault(); location.hash = `/projects/guides?project=${encodeURIComponent(new FormData(event.currentTarget).get('project'))}`; }); return; }
    const summary = await api(`/api/projects/${encodeURIComponent(projectId)}`); host.innerHTML = guideArrangementPageMarkup(summary); bindGuideArrangementWorkspace(summary); focusExceptionSource('.guide-project-banner');
  } catch (error) { host.innerHTML = `<article class="panel empty-list error-state"><h3>导游安排页面加载失败</h3><p>${escapeHtml(error.message)}</p><a class="button secondary" href="#/projects">返回项目列表</a></article>`; }
}

function schoolsContent() {
  return `
    <section class="metric-grid" aria-label="学校库指标">
      ${[['学校', 'school-count', '本机资料库'], ['合作中', 'active-school-count', '当前可选择'], ['资料待补充', 'incomplete-school-count', '联系人或电话'], ['最近更新', 'school-last-updated', '本机时间']].map(([label, id, note]) => `<article class="metric"><span>${label}</span><strong id="${id}">—</strong><small>${note}</small></article>`).join('')}
    </section>
    <section class="panel filter-panel">
      <form id="school-filter" class="filter-grid">
        <label><span>关键词</span><input name="query" placeholder="学校名称 / 联系人"><small>支持模糊搜索</small></label>
        <label><span>合作状态</span><select name="active"><option value="all">全部</option><option value="true">合作中</option><option value="false">已停用</option></select><small>合作 / 历史合作</small></label>
        <div class="filter-actions"><button type="reset" class="button secondary">重置</button><button type="submit" class="button primary">筛选</button></div>
      </form>
    </section>
    <section class="school-layout">
      <article class="panel school-list-panel">
        <div class="section-heading"><div><p class="eyebrow">学校资料</p><h2>按最近使用时间排序</h2></div><span id="school-result-count">正在读取…</span></div>
        <div id="school-list" class="school-list"><div class="list-loading"><div class="skeleton line-skeleton"></div><div class="skeleton line-skeleton"></div><div class="skeleton line-skeleton"></div></div></div>
      </article>
      <aside class="panel boundary-panel"><p class="eyebrow">资料边界</p><h2>学校库只保存通用信息</h2><dl><div><dt>保存</dt><dd>学校与联系人</dd></div><div><dt>不保存</dt><dd>年级 / 班级</dd></div><div><dt>项目人数</dt><dd>回到项目维护</dd></div><div><dt>敏感信息</dt><dd>默认脱敏</dd></div></dl></aside>
    </section>
    <dialog id="school-dialog" class="form-dialog"><form method="dialog"><button class="dialog-close" aria-label="关闭">×</button></form><div id="school-dialog-body"></div></dialog>`;
}

function backupContent() {
  return `
    <section class="metric-grid" aria-label="备份状态">
      ${[['最近备份', 'backup-latest-time', '尚未备份'], ['最近结果', 'backup-latest-result', '—'], ['今日已校验', 'backup-today-verified', '否'], ['无效备份', 'backup-invalid-count', '0']].map(([label, id, value]) => `<article class="metric"><span>${label}</span><strong id="${id}">${value}</strong><small>${label === '今日已校验' ? '首次退出前检查' : '本机受限目录'}</small></article>`).join('')}
    </section>
    <section class="backup-grid">
      <article class="panel backup-create-panel">
        <div class="section-heading"><div><p class="eyebrow">立即备份</p><h2>生成并校验本机副本</h2></div><span>默认包含全部内容</span></div>
        <form id="backup-form" class="backup-form">
          <fieldset><legend>备份内容</legend><label><input type="checkbox" name="includeDatabase" checked> SQLite 数据库</label><label><input type="checkbox" name="includeCertificates" checked> 证件图片目录</label></fieldset>
          <label class="field"><span>备份备注</span><input name="note" maxlength="200" placeholder="选填，例如：项目调整前"></label>
          <p id="backup-action-message" class="form-message" role="status"></p>
          <div class="backup-actions"><button class="button secondary" type="button" id="open-backup-location">打开备份位置</button><button class="button primary" type="submit">立即备份</button></div>
        </form>
      </article>
      <aside class="panel boundary-panel backup-boundary"><p class="eyebrow">存储边界</p><h2>不与普通导出混放</h2><dl><div><dt>数据库</dt><dd id="backup-db-location">—</dd></div><div><dt>证件目录</dt><dd id="backup-cert-location">—</dd></div><div><dt>备份目录</dt><dd id="backup-location">—</dd></div><div><dt>轮转</dt><dd id="backup-retention">30 日 / 12 月</dd></div></dl></aside>
    </section>
    <section class="panel backup-list-panel">
      <div class="section-heading"><div><p class="eyebrow">可恢复备份</p><h2>已通过完整性校验的副本</h2></div><span id="backup-count">正在读取…</span></div>
      <div id="backup-list" class="backup-list"><div class="list-loading"><div class="skeleton line-skeleton"></div><div class="skeleton line-skeleton"></div></div></div>
    </section>
    <dialog id="restore-dialog" class="form-dialog backup-dialog">
      <form id="restore-form" class="entity-form">
        <div class="dialog-heading"><p class="eyebrow">高风险操作</p><h2>从备份恢复</h2><p id="restore-impact"></p></div>
        <input type="hidden" name="backupId">
        <label class="field"><span>输入备份编号进行二次确认</span><input name="confirmation" required autocomplete="off"></label>
        <label class="check-line"><input type="checkbox" name="backupCurrent" checked><span>恢复前先备份当前数据库和证件目录（推荐）</span></label>
        <p class="form-error" id="restore-error" role="alert"></p>
        <div class="dialog-actions"><span></span><button class="button secondary" id="cancel-restore" type="button">取消</button><button class="button danger-button" type="submit">确认恢复</button></div>
      </form>
    </dialog>`;
}

function importsContent() {
  return `
    <section class="metric-grid" aria-label="导入批次指标">
      ${[['待确认', 'import-pending-count', '临时区批次'], ['本次可导入', 'import-valid-count', '当前预览'], ['本次错误', 'import-failed-count', '需人工修正'], ['文件上限', 'import-file-limit', '单个文件']].map(([label, id, note]) => `<article class="metric"><span>${label}</span><strong id="${id}">—</strong><small>${note}</small></article>`).join('')}
    </section>
    <section class="import-layout">
      <article class="panel import-create-panel">
        <div class="section-heading"><div><p class="eyebrow">读取并预览</p><h2>资料先进入隔离临时区</h2></div><span>确认前不写正式数据</span></div>
        <form id="import-form" class="entity-form import-form">
          <div class="import-form-grid">
            <label class="field"><span>资料类型 <b>*</b></span><select name="targetType" required><option value="">正在读取…</option></select><small id="import-target-help">根据资料类型提供字段建议</small></label>
            <label class="field" id="import-project-field"><span>目标项目 <b>*</b></span><select name="projectId"><option value="">请选择项目</option></select><small>学校资料不绑定项目</small></label>
            <label class="field"><span>导入方式 <b>*</b></span><select name="importMethod" required><option value="Excel">Excel（.xlsx）</option><option value="CSV">CSV（.csv）</option><option value="Word">Word（.docx）</option><option value="粘贴文字">粘贴文字</option></select><small>不执行公式或宏</small></label>
            <label class="field"><span>模板版本</span><input name="templateVersion" maxlength="50" placeholder="例如 v1"></label>
          </div>
          <label class="field" id="import-file-field"><span>选择文件 <b>*</b></span><input name="file" type="file" accept=".xlsx"><small id="import-file-help">仅支持 .xlsx，最大 5 MB</small></label>
          <label class="field hidden" id="import-text-field"><span>粘贴内容 <b>*</b></span><textarea name="text" rows="8" placeholder="首行填写表头，使用制表符或逗号分隔；导游接龙可直接粘贴序号、姓名、手机号。"></textarea><small>保留原始行号和接龙顺序</small></label>
          <label class="field"><span>导入备注</span><input name="notes" maxlength="500" placeholder="选填，例如：学校发来的第一版资料"></label>
          <p class="form-error form-message" id="import-form-error" role="alert"></p>
          <div class="import-actions"><button class="button secondary" type="button" id="download-import-template">下载标准模板</button><button class="button primary" type="submit">读取并预览</button></div>
        </form>
      </article>
      <aside class="panel boundary-panel import-boundary"><p class="eyebrow">导入边界</p><h2>机器建议，负责人确认</h2><dl><div><dt>自动处理</dt><dd>固定模板与常见接龙</dd></div><div><dt>人工处理</dt><dd>非标准列名与错误行</dd></div><div><dt>禁止</dt><dd>上传后直接写库</dd></div><div><dt>不支持</dt><dd>OCR / 宏 / 任意格式</dd></div></dl></aside>
    </section>
    <section class="panel import-list-panel">
      <div class="section-heading"><div><p class="eyebrow">导入记录</p><h2>最近批次</h2></div><span id="import-batch-count">正在读取…</span></div>
      <div id="import-batch-list" class="import-batch-list"><div class="list-loading"><div class="skeleton line-skeleton"></div><div class="skeleton line-skeleton"></div></div></div>
    </section>`;
}

function importMappingContent() {
  return `<section id="import-mapping-root" class="mapping-root"><article class="panel"><div class="list-loading"><div class="skeleton title-skeleton"></div><div class="skeleton line-skeleton"></div><div class="skeleton line-skeleton"></div></div></article></section>`;
}

function contactRowMarkup(contact = {}, index = 0) {
  return `<div class="contact-row" data-contact-row><input type="hidden" name="contactId" value="${escapeHtml(contact.id || '')}"><label><span>姓名</span><input name="contactName" value="${escapeHtml(contact.name || '')}" placeholder="联系人姓名"></label><label><span>联系电话</span><input name="contactPhone" value="${escapeHtml(contact.phone || '')}" placeholder="手机或座机"></label><label><span>备注</span><input name="contactNotes" value="${escapeHtml(contact.notes || '')}" placeholder="职务等"></label><label class="default-contact"><input type="radio" name="defaultContact" value="${index}" ${contact.isDefault ? 'checked' : ''}><span>默认</span></label><button type="button" class="remove-contact" aria-label="删除联系人">移除</button></div>`;
}

function schoolFormMarkup(school = null) {
  const contacts = school?.contacts?.length ? school.contacts : [{ name: '', phone: '', notes: '', isDefault: true }];
  return `<form id="school-form" class="entity-form" data-school-id="${escapeHtml(school?.id || '')}">
    <div class="dialog-heading"><p class="eyebrow">${school ? '编辑学校' : '新增学校'}</p><h2>${school ? escapeHtml(school.name) : '建立学校基础资料'}</h2><p>只保存跨项目复用的信息，不在这里维护年级、班级、老师或学生人数。</p></div>
    <label class="field"><span>学校名称 <b>*</b></span><input name="name" required maxlength="100" value="${escapeHtml(school?.name || '')}"><small>疑似重名会要求再次确认，不自动合并。</small></label>
    <label class="field"><span>合作备注</span><textarea name="cooperationNotes" rows="3">${escapeHtml(school?.cooperationNotes || '')}</textarea></label>
    <div class="form-section"><div class="section-heading"><div><span class="field-title">常用联系人</span><small>同一学校最多一个默认联系人</small></div><button type="button" class="button secondary compact" id="add-contact">新增联系人</button></div><div id="contact-rows">${contacts.map(contactRowMarkup).join('')}</div></div>
    <div class="form-error form-message" id="school-form-error" role="alert"></div>
    <div class="dialog-actions">${school ? '<button type="button" class="button danger-button" id="delete-school">删除误建资料</button>' : '<span></span>'}<button type="button" class="button secondary" id="cancel-school">取消</button><button type="submit" class="button primary">保存学校</button></div>
  </form>`;
}

function serializeSchoolForm(form, confirmSimilar = false) {
  const rows = [...form.querySelectorAll('[data-contact-row]')];
  const defaultIndex = new FormData(form).get('defaultContact');
  return { name: form.elements.name.value, cooperationNotes: form.elements.cooperationNotes.value, confirmSimilar, contacts: rows.map((row, index) => ({ id: row.querySelector('[name=contactId]').value || undefined, name: row.querySelector('[name=contactName]').value, phone: row.querySelector('[name=contactPhone]').value, notes: row.querySelector('[name=contactNotes]').value, isDefault: String(index) === String(defaultIndex) })) };
}

async function loadSchools() {
  const form = root.querySelector('#school-filter');
  if (!form) return;
  const list = root.querySelector('#school-list');
  try {
    const schools = await api(`/api/schools?${new URLSearchParams(new FormData(form))}`);
    root.querySelector('#school-count').textContent = schools.length;
    root.querySelector('#active-school-count').textContent = schools.filter((school) => school.active).length;
    root.querySelector('#incomplete-school-count').textContent = schools.filter((school) => Number(school.contactCount) === 0).length;
    root.querySelector('#school-last-updated').textContent = schools[0]?.updatedAt ? new Date(schools[0].updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '—';
    root.querySelector('#school-result-count').textContent = `${schools.length} 所学校`;
    list.innerHTML = schools.length ? schools.map((school) => `<article class="school-row"><div><h3>${escapeHtml(school.name)}</h3><p>${school.active ? '合作中' : '已停用'} · ${school.projectCount ? `${school.projectCount} 个历史项目` : '暂无项目引用'}${school.lastUsedAt ? ` · 最近使用 ${escapeHtml(new Date(school.lastUsedAt).toLocaleDateString('zh-CN'))}` : ''}</p></div><div class="row-actions"><span class="status-tag ${school.active ? 'success' : 'muted-tag'}">${school.active ? '合作中' : '已停用'}</span><button class="text-button" data-edit-school="${escapeHtml(school.id)}">查看与编辑</button><button class="text-button" data-toggle-school="${escapeHtml(school.id)}" data-active="${school.active ? 'false' : 'true'}">${school.active ? '停用' : '恢复合作'}</button><a class="text-link inline" href="#/projects/new?school=${encodeURIComponent(school.id)}">新建项目</a></div></article>`).join('') : `<div class="empty-list"><h3>没有符合条件的学校</h3><p>调整筛选条件，或新增第一所学校。</p><button class="button primary" data-new-school>新增学校</button></div>`;
  } catch (error) { list.innerHTML = `<div class="empty-list error-state"><h3>学校资料读取失败</h3><p>${escapeHtml(error.message)}</p><button class="button secondary" data-retry-schools>重新读取</button></div>`; }
}

async function openSchoolDialog(id = '') {
  const dialog = root.querySelector('#school-dialog');
  const body = root.querySelector('#school-dialog-body');
  body.innerHTML = '<div class="dialog-loading"><div class="skeleton title-skeleton"></div><div class="skeleton line-skeleton"></div></div>';
  dialog.showModal();
  try { body.innerHTML = schoolFormMarkup(id ? await api(`/api/schools/${encodeURIComponent(id)}`) : null); bindSchoolForm(); }
  catch (error) { body.innerHTML = `<div class="dialog-heading"><h2>无法打开学校资料</h2><p>${escapeHtml(error.message)}</p></div>`; }
}

function bindSchoolForm() {
  const dialog = root.querySelector('#school-dialog');
  const form = root.querySelector('#school-form');
  const rows = root.querySelector('#contact-rows');
  const reindex = () => [...rows.querySelectorAll('[data-contact-row]')].forEach((row, index) => { row.querySelector('[name=defaultContact]').value = index; });
  root.querySelector('#add-contact').addEventListener('click', () => { rows.insertAdjacentHTML('beforeend', contactRowMarkup({}, rows.children.length)); reindex(); });
  rows.addEventListener('click', (event) => { const button = event.target.closest('.remove-contact'); if (button) { button.closest('[data-contact-row]').remove(); reindex(); } });
  root.querySelector('#cancel-school').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', (event) => { event.preventDefault(); saveSchool(form, false); });
  root.querySelector('#delete-school')?.addEventListener('click', async () => {
    if (!confirm('仅无项目引用的误建学校可以删除。确认删除这所学校？')) return;
    try { await api(`/api/schools/${encodeURIComponent(form.dataset.schoolId)}`, { method: 'DELETE' }); dialog.close(); await loadSchools(); }
    catch (error) { root.querySelector('#school-form-error').textContent = error.message; }
  });
}

async function saveSchool(form, confirmSimilar) {
  const submit = form.querySelector('[type=submit]');
  const errorBox = root.querySelector('#school-form-error');
  submit.disabled = true; submit.textContent = '正在保存…'; errorBox.innerHTML = '';
  const id = form.dataset.schoolId;
  try {
    await api(id ? `/api/schools/${encodeURIComponent(id)}` : '/api/schools', { method: id ? 'PUT' : 'POST', body: JSON.stringify(serializeSchoolForm(form, confirmSimilar)) });
    root.querySelector('#school-dialog').close(); await loadSchools();
  } catch (error) {
    if (error.code === 'SIMILAR_SCHOOL') {
      const names = (error.details.candidates || []).map((item) => item.name).join('、');
      errorBox.innerHTML = `发现相近学校：${escapeHtml(names)}。请核对后决定。 <button type="button" class="text-button" id="confirm-similar">确认仍然保存</button>`;
      root.querySelector('#confirm-similar').addEventListener('click', () => saveSchool(form, true), { once: true });
    } else if (error.details?.fields?.length) errorBox.innerHTML = error.details.fields.map((item) => `<div>${escapeHtml(item.message)}</div>`).join('');
    else errorBox.textContent = error.message;
  } finally { submit.disabled = false; submit.textContent = '保存学校'; }
}

function bindSchoolsPage() {
  const filter = root.querySelector('#school-filter');
  filter.addEventListener('submit', (event) => { event.preventDefault(); loadSchools(); });
  filter.addEventListener('reset', () => queueMicrotask(loadSchools));
  root.querySelector('#new-school')?.addEventListener('click', () => openSchoolDialog());
  root.querySelector('#school-list').addEventListener('click', async (event) => {
    const newButton = event.target.closest('[data-new-school]'); const retry = event.target.closest('[data-retry-schools]'); const edit = event.target.closest('[data-edit-school]'); const toggle = event.target.closest('[data-toggle-school]');
    if (newButton) openSchoolDialog(); if (retry) loadSchools(); if (edit) openSchoolDialog(edit.dataset.editSchool);
    if (toggle) { try { await api(`/api/schools/${encodeURIComponent(toggle.dataset.toggleSchool)}/status`, { method: 'PATCH', body: JSON.stringify({ active: toggle.dataset.active === 'true' }) }); await loadSchools(); } catch (error) { alert(error.message); } }
  });
  loadSchools();
}

function guideStatusLabel(status) {
  return ({ 可合作: '合作中', 暂停合作: '暂停', 停止合作: '停用' })[status] || status;
}

function guideDocument(guide, type) {
  return guide?.documents?.find((item) => item.documentType === type) || { documentType: type, maskedNumber: '', expiresOn: '', status: '缺失', hasControlledFile: false, hasControlledFileBack: false };
}

function guideStatusClass(status) {
  if (status === '有效' || status === '可合作') return 'success';
  if (status === '临期' || status === '暂停合作') return 'warning';
  if (status === '过期' || status === '停止合作') return 'danger';
  return 'muted-tag';
}

function guidesContent() {
  return `
    <section class="metric-grid" aria-label="导游库指标">
      ${[['导游', 'guide-count', '当前筛选'], ['合作中', 'guide-active-count', '可进入新安排'], ['证件提醒', 'guide-alert-count', '临期 / 过期 / 缺失'], ['已停用', 'guide-disabled-count', '保留历史事实']].map(([label, id, note]) => `<article class="metric"><span>${label}</span><strong id="${id}">—</strong><small>${note}</small></article>`).join('')}
    </section>
    <section class="panel filter-panel">
      <form id="guide-filter" class="guide-filter-grid">
        <label><span>姓名或手机号</span><input name="query" placeholder="支持模糊搜索"></label>
        <label><span>合作状态</span><select name="cooperationStatus"><option value="">全部</option><option value="可合作">合作中</option><option value="暂停合作">暂停</option><option value="停止合作">停用</option></select></label>
        <label><span>证件状态</span><select name="documentStatus"><option value="">全部</option><option>有效</option><option>临期</option><option>过期</option><option>缺失</option></select></label>
        <label><span>常住区域</span><input name="residenceArea" placeholder="例如：长沙"></label>
        <div class="filter-actions"><button type="reset" class="button secondary">重置</button><button type="submit" class="button primary">筛选</button></div>
      </form>
    </section>
    <section class="panel guide-list-panel">
      <div class="section-heading"><div><p class="eyebrow">长期导游档案</p><h2>证件状态与事实记录</h2></div><span id="guide-result-count">正在读取…</span></div>
      <div class="guide-table guide-table-head" aria-hidden="true"><span>导游</span><span>合作 / 证件</span><span>事实汇总</span><span>操作</span></div>
      <div id="guide-list" class="guide-list"><div class="list-loading"><div class="skeleton line-skeleton"></div><div class="skeleton line-skeleton"></div></div></div>
    </section>`;
}

function guideRowMarkup(guide) {
  const idDocument = guideDocument(guide, '身份证'); const license = guideDocument(guide, '导游证');
  return `<article class="guide-row" data-guide-id="${escapeHtml(guide.id)}">
    <div class="guide-identity"><h3>${escapeHtml(guide.name)}</h3><p>${escapeHtml(guide.workPhone)} · ${escapeHtml(guide.gender)} · ${escapeHtml(guide.residenceArea || '常住区域未填')}</p></div>
    <div class="guide-statuses"><span class="status-tag ${guideStatusClass(guide.cooperationStatus)}">${escapeHtml(guideStatusLabel(guide.cooperationStatus))}</span><span class="document-state ${guideStatusClass(license.status)}">导游证 ${escapeHtml(license.status)}</span><span class="document-state ${guideStatusClass(idDocument.status)}">身份证 ${escapeHtml(idDocument.status)}</span></div>
    <div class="guide-facts"><strong>${guide.tourCount} 次带团</strong><span>好评 ${guide.positiveCount} · 退团 ${guide.withdrawalCount} · 临近 ${guide.nearWithdrawalCount}</span><small>最近 ${escapeHtml(formatProjectDate(guide.lastTourOn))}</small></div>
    <div class="row-actions"><a class="button secondary compact" href="#/guides/detail?id=${encodeURIComponent(guide.id)}">查看档案</a>${guide.cooperationStatus === '停止合作' ? `<button class="text-button" data-guide-status="${escapeHtml(guide.id)}" data-status="可合作">恢复合作</button>` : `<button class="text-button danger-text" data-guide-status="${escapeHtml(guide.id)}" data-status="停止合作">停用</button>`}</div>
  </article>`;
}

async function loadGuides() {
  const form = root.querySelector('#guide-filter'); if (!form) return;
  const list = root.querySelector('#guide-list');
  try {
    const guides = await api(`/api/guides?${new URLSearchParams(new FormData(form))}`);
    const alerts = guides.filter((guide) => Object.values(guide.documentStatuses).some((status) => status !== '有效'));
    root.querySelector('#guide-count').textContent = guides.length;
    root.querySelector('#guide-active-count').textContent = guides.filter((guide) => guide.cooperationStatus === '可合作').length;
    root.querySelector('#guide-alert-count').textContent = alerts.length;
    root.querySelector('#guide-disabled-count').textContent = guides.filter((guide) => guide.cooperationStatus === '停止合作').length;
    root.querySelector('#guide-result-count').textContent = `${guides.length} 名导游`;
    list.innerHTML = guides.length ? guides.map(guideRowMarkup).join('') : '<div class="empty-list"><h3>没有符合条件的导游</h3><p>调整筛选条件，或新增第一份导游档案。</p><a class="button primary" href="#/guides/detail?mode=new">新增导游</a></div>';
  } catch (error) { list.innerHTML = `<div class="empty-list error-state"><h3>导游资料读取失败</h3><p>${escapeHtml(error.message)}</p><button class="button secondary" data-retry-guides>重新读取</button></div>`; }
}

function bindGuidesPage() {
  const form = root.querySelector('#guide-filter');
  form.addEventListener('submit', (event) => { event.preventDefault(); loadGuides(); });
  form.addEventListener('reset', () => queueMicrotask(loadGuides));
  root.querySelector('#guide-list').addEventListener('click', async (event) => {
    if (event.target.closest('[data-retry-guides]')) return loadGuides();
    const button = event.target.closest('[data-guide-status]'); if (!button) return;
    const status = button.dataset.status;
    if (status === '停止合作' && !confirm('停用后不能进入新的导游安排，历史项目和事实记录仍保留。确认继续？')) return;
    try { await api(`/api/guides/${encodeURIComponent(button.dataset.guideStatus)}/status`, { method: 'PATCH', body: JSON.stringify({ cooperationStatus: status }) }); await loadGuides(); }
    catch (error) { alert(error.code === 'GUIDE_FUTURE_ASSIGNMENTS' ? `${error.message}\n${(error.details.assignments || []).map((item) => `${item.projectName}（${item.startsOn}）`).join('\n')}` : error.message); }
  });
  loadGuides();
}

function guideDetailContent() {
  return `<section id="guide-detail-root"><article class="panel"><div class="list-loading"><div class="skeleton title-skeleton"></div><div class="skeleton line-skeleton"></div></div></article></section>`;
}

function guideDocumentFields(guide, type) {
  const document = guideDocument(guide, type); const key = type === '身份证' ? 'id' : 'license';
  return `<section class="guide-form-section"><div class="section-heading"><div><p class="eyebrow">${type}</p><h3>${type}资料</h3></div><span class="status-tag ${guideStatusClass(document.status)}">${document.status}</span></div>
    <div class="guide-form-grid"><label class="field"><span>${type}号码</span><input name="${key}Number" autocomplete="off" placeholder="${escapeHtml(document.maskedNumber || '保存后默认脱敏')}"><small>${document.maskedNumber ? `当前 ${escapeHtml(document.maskedNumber)}；留空不修改` : '完整值不会进入普通详情响应'}</small></label>
    <label class="field"><span>有效期</span><input name="${key}ExpiresOn" type="date" value="${escapeHtml(document.expiresOn || '')}"><small>到期前 30 天标为临期</small></label>
    <label class="field"><span>${type === '身份证' ? '正面照片' : '证件照片'}</span><input name="${key}Image" type="file" accept="image/png,image/jpeg,image/webp"><small>${document.hasControlledFile ? '已上传；重新选择会更换受控引用' : '选填，最大 5 MB'}</small></label>
    ${type === '身份证' ? `<label class="field"><span>反面照片</span><input name="idImageBack" type="file" accept="image/png,image/jpeg,image/webp"><small>${document.hasControlledFileBack ? '已上传；重新选择会更换受控引用' : '选填，最大 5 MB'}</small></label>` : ''}</div></section>`;
}

function factMarkup(item) {
  return `<article class="guide-history-row"><div><h4>${escapeHtml(item.projectName || item.projectId || '历史项目')}</h4><p>${escapeHtml(item.endedOn)} · ${escapeHtml(item.responsibleClass || '负责班级未记录')}</p></div><div><span class="status-tag ${item.isCompleted ? 'success' : 'muted-tag'}">${item.isCompleted ? '已完成带团' : '未完成'}</span>${item.isPositive ? '<span class="status-tag success">可核实好评</span>' : ''}<small>${escapeHtml(item.feedbackFact || item.factNotes || '无补充事实')}</small></div><details class="fact-correction"><summary>纠正反馈事实</summary><form data-correct-fact="${escapeHtml(item.id)}"><label class="check-line"><input name="isPositive" type="checkbox" ${item.isPositive ? 'checked' : ''}><span>计为可核实好评</span></label><label class="field"><span>反馈事实</span><textarea name="feedbackFact" rows="2">${escapeHtml(item.feedbackFact || '')}</textarea></label><label class="field"><span>事实备注</span><textarea name="factNotes" rows="2">${escapeHtml(item.factNotes || '')}</textarea></label><label class="field"><span>纠正说明 <b>*</b></span><input name="correctionNote" required placeholder="说明纠正原因和依据"></label><p class="form-error" data-correction-error></p><button class="button secondary compact" type="submit">保存纠正</button></form></details></article>`;
}

function withdrawalMarkup(item) {
  return `<article class="guide-history-row withdrawal"><div><h4>${escapeHtml(item.projectName)}</h4><p>${escapeHtml(item.recordedAt)} · 距出团 ${item.daysBeforeDeparture} 天</p></div><div><span class="status-tag warning">退团事实</span><small>${escapeHtml(item.reason)}</small></div></article>`;
}

function guideFormMarkup(guide = null) {
  const isNew = !guide;
  const initialName = guide?.name || (isNew ? routeParams().get('name') || '' : '');
  const initialPhone = guide?.workPhone || (isNew ? routeParams().get('phone') || '' : '');
  return `<div class="guide-detail-layout">
    <form id="guide-form" class="panel guide-profile-form" data-guide-id="${escapeHtml(guide?.id || '')}">
      <div class="section-heading"><div><p class="eyebrow">${isNew ? 'P15 · 新增模式' : 'P15 · 导游档案详情'}</p><h2>${isNew ? '建立可复用导游档案' : escapeHtml(guide.name)}</h2><p>普通页面只读取脱敏号码和证件状态；完整值与图片需要再次确认用途。</p></div>${isNew ? '' : `<span class="status-tag ${guideStatusClass(guide.cooperationStatus)}">${escapeHtml(guideStatusLabel(guide.cooperationStatus))}</span>`}</div>
      <section class="guide-form-section"><h3>基础与紧急联系</h3><div class="guide-form-grid">
        <label class="field"><span>姓名 <b>*</b></span><input name="name" required maxlength="50" value="${escapeHtml(initialName)}"></label>
        <label class="field"><span>工作手机号 <b>*</b></span><input name="workPhone" required value="${escapeHtml(initialPhone)}"></label>
        <label class="field"><span>性别</span><select name="gender"><option${guide?.gender === '未填写' || !guide ? ' selected' : ''}>未填写</option><option${guide?.gender === '男' ? ' selected' : ''}>男</option><option${guide?.gender === '女' ? ' selected' : ''}>女</option></select></label>
        <label class="field"><span>出生日期</span><input name="birthDate" type="date" value="${escapeHtml(guide?.birthDate || '')}"></label>
        <label class="field"><span>常住区域</span><input name="residenceArea" value="${escapeHtml(guide?.residenceArea || '')}"></label>
        <label class="field"><span>合作状态 <b>*</b></span><select name="cooperationStatus"><option value="可合作"${guide?.cooperationStatus === '可合作' || !guide ? ' selected' : ''}>合作中</option><option value="暂停合作"${guide?.cooperationStatus === '暂停合作' ? ' selected' : ''}>暂停</option><option value="停止合作"${guide?.cooperationStatus === '停止合作' ? ' selected' : ''}>停用</option></select></label>
        <label class="field"><span>紧急联系人</span><input name="emergencyContactName" value="${escapeHtml(guide?.emergencyContactName || '')}"></label>
        <label class="field"><span>紧急联系电话</span><input name="emergencyContactPhone" value="${escapeHtml(guide?.emergencyContactPhone || '')}"></label>
      </div><label class="field"><span>事实备注</span><textarea name="notes" rows="3">${escapeHtml(guide?.notes || '')}</textarea></label></section>
      ${guideDocumentFields(guide, '身份证')}${guideDocumentFields(guide, '导游证')}
      <p class="form-error form-message" id="guide-form-error" role="alert"></p>
      <div class="guide-form-actions">${isNew ? '<span></span>' : '<button type="button" class="button danger-button" id="delete-guide">删除误建档案</button>'}<a class="button secondary" href="#/guides">取消</a><button type="submit" class="button primary">保存档案</button></div>
    </form>
    <aside class="guide-detail-aside">
      <section class="panel guide-fact-summary"><p class="eyebrow">只读事实汇总</p><div class="fact-metrics">${[['带团', guide?.tourCount || 0], ['好评', guide?.positiveCount || 0], ['退团', guide?.withdrawalCount || 0], ['临近退团', guide?.nearWithdrawalCount || 0]].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('')}</div>${isNew ? '<p>保存后可查看历史与完整证件。</p>' : `<button type="button" class="button secondary" id="open-sensitive">查看完整敏感信息</button>`}</section>
      ${isNew ? '' : `<section class="panel history-panel"><div class="section-heading"><div><p class="eyebrow">带团记录</p><h3>来自已结束项目</h3></div></div><div id="tour-facts">${guide.tourFacts.length ? guide.tourFacts.map(factMarkup).join('') : '<p class="muted">还没有带团事实。</p>'}</div>${guide.endedProjects.length ? `<form id="tour-fact-form" class="fact-form"><label class="field"><span>关联已结束项目</span><select name="projectId" required><option value="">请选择</option>${guide.endedProjects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)} · ${escapeHtml(project.endedOn)}</option>`).join('')}</select></label><label class="field"><span>负责班级</span><input name="responsibleClass"></label><label class="check-line"><input name="isCompleted" type="checkbox" checked><span>已完成带团</span></label><label class="check-line"><input name="isPositive" type="checkbox"><span>计为可核实好评</span></label><label class="field"><span>反馈事实</span><textarea name="feedbackFact" rows="2"></textarea></label><label class="field"><span>事实备注</span><textarea name="factNotes" rows="2"></textarea></label><p class="form-error" id="fact-error"></p><button class="button secondary" type="submit">补充带团事实</button></form>` : '<p class="muted">没有可补充的已结束项目。</p>'}</section>
      <section class="panel history-panel"><p class="eyebrow">退团记录</p>${guide.withdrawalFacts.length ? guide.withdrawalFacts.map(withdrawalMarkup).join('') : '<p class="muted">没有退团事实。</p>'}</section>`}
    </aside>
    ${isNew ? '' : `<dialog id="sensitive-dialog" class="form-dialog sensitive-dialog"><form id="sensitive-form" class="entity-form"><div class="dialog-heading"><p class="eyebrow">受控查看</p><h2>查看完整证件资料</h2><p>必须填写本次用途并再次确认；成功和失败都会留下不含完整证件值的日志。</p></div><label class="field"><span>查看用途 <b>*</b></span><input name="purpose" required placeholder="例如：保险资料人工核对"></label><label class="check-line"><input name="confirmed" type="checkbox" required><span>我确认只按上述用途查看，不复制到无关位置</span></label><p class="form-error" id="sensitive-error"></p><div id="sensitive-result" class="sensitive-result hidden"><dl><div><dt>身份证号码</dt><dd data-sensitive-id></dd></div><div><dt>导游证号码</dt><dd data-sensitive-license></dd></div></dl><div class="sensitive-image-actions">${guideDocument(guide, '身份证').hasControlledFile ? '<button class="button secondary compact" type="button" data-view-document="身份证正面">查看身份证正面</button>' : ''}${guideDocument(guide, '身份证').hasControlledFileBack ? '<button class="button secondary compact" type="button" data-view-document="身份证反面">查看身份证反面</button>' : ''}${guideDocument(guide, '导游证').hasControlledFile ? '<button class="button secondary compact" type="button" data-view-document="导游证">查看导游证图片</button>' : ''}</div><img class="controlled-document hidden" alt="经确认查看的证件测试图片"><small data-sensitive-log></small></div><div class="dialog-actions"><span></span><button class="button secondary" type="button" id="close-sensitive">关闭并清空</button><button class="button primary" type="submit">确认查看</button></div></form></dialog>`}
  </div>`;
}

async function inputFilePayload(input) {
  const file = input?.files?.[0];
  return file ? { mimeType: file.type, base64: await fileToBase64(file) } : null;
}

async function serializeGuideForm(form) {
  return { name: form.elements.name.value, workPhone: form.elements.workPhone.value, gender: form.elements.gender.value,
    birthDate: form.elements.birthDate.value, residenceArea: form.elements.residenceArea.value, cooperationStatus: form.elements.cooperationStatus.value,
    emergencyContactName: form.elements.emergencyContactName.value, emergencyContactPhone: form.elements.emergencyContactPhone.value,
    notes: form.elements.notes.value, idNumber: form.elements.idNumber.value, guideLicenseNumber: form.elements.licenseNumber.value,
    documents: [
      { documentType: '身份证', expiresOn: form.elements.idExpiresOn.value, image: await inputFilePayload(form.elements.idImage), imageBack: await inputFilePayload(form.elements.idImageBack) },
      { documentType: '导游证', expiresOn: form.elements.licenseExpiresOn.value, image: await inputFilePayload(form.elements.licenseImage) }
    ] };
}

function bindGuideForm(guide = null) {
  const form = root.querySelector('#guide-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (guide && guide.cooperationStatus !== '停止合作' && form.elements.cooperationStatus.value === '停止合作' && !confirm('停用后不能进入新的导游安排，历史项目和事实记录仍保留。确认继续？')) return;
    const button = form.querySelector('[type=submit]'); const errorBox = root.querySelector('#guide-form-error');
    button.disabled = true; button.textContent = '正在保存…'; errorBox.innerHTML = '';
    try {
      const payload = await serializeGuideForm(form); const id = form.dataset.guideId;
      const saved = await api(id ? `/api/guides/${encodeURIComponent(id)}` : '/api/guides', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      if (id) await bindGuideDetailPage(); else location.hash = `/guides/detail?id=${encodeURIComponent(saved.id)}`;
    } catch (error) { errorBox.innerHTML = error.details?.fields?.length ? error.details.fields.map((item) => `<div>${escapeHtml(item.message)}</div>`).join('') : escapeHtml(error.message); button.disabled = false; button.textContent = '保存档案'; }
  });
  root.querySelector('#delete-guide')?.addEventListener('click', async () => {
    if (!confirm('仅无项目、带团或退团事实引用的误建档案可以永久删除。确认继续？')) return;
    try { await api(`/api/guides/${encodeURIComponent(guide.id)}`, { method: 'DELETE' }); location.hash = '/guides'; }
    catch (error) { root.querySelector('#guide-form-error').textContent = error.message; }
  });
  root.querySelector('#tour-fact-form')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const factForm = event.currentTarget; const data = new FormData(factForm); const errorBox = root.querySelector('#fact-error');
    try { await api(`/api/guides/${encodeURIComponent(guide.id)}/facts`, { method: 'POST', body: JSON.stringify({ projectId: data.get('projectId'), responsibleClass: data.get('responsibleClass'), isCompleted: data.get('isCompleted') === 'on', isPositive: data.get('isPositive') === 'on', feedbackFact: data.get('feedbackFact'), factNotes: data.get('factNotes') }) }); await bindGuideDetailPage(); }
    catch (error) { errorBox.textContent = error.message; }
  });
  root.querySelector('#tour-facts')?.addEventListener('submit', async (event) => {
    const correctionForm = event.target.closest('[data-correct-fact]'); if (!correctionForm) return;
    event.preventDefault(); const data = new FormData(correctionForm); const errorBox = correctionForm.querySelector('[data-correction-error]');
    try { await api(`/api/guides/${encodeURIComponent(guide.id)}/facts/${encodeURIComponent(correctionForm.dataset.correctFact)}`, { method: 'PUT', body: JSON.stringify({ isPositive: data.get('isPositive') === 'on', feedbackFact: data.get('feedbackFact'), factNotes: data.get('factNotes'), correctionNote: data.get('correctionNote') }) }); await bindGuideDetailPage(); }
    catch (error) { errorBox.textContent = error.message; }
  });
  bindSensitiveDialog(guide);
}

function bindSensitiveDialog(guide) {
  const dialog = root.querySelector('#sensitive-dialog'); if (!dialog) return;
  const form = root.querySelector('#sensitive-form'); const result = root.querySelector('#sensitive-result');
  root.querySelector('#open-sensitive').addEventListener('click', () => dialog.showModal());
  root.querySelector('#close-sensitive').addEventListener('click', () => { form.reset(); result.classList.add('hidden'); result.querySelector('[data-sensitive-id]').textContent = ''; result.querySelector('[data-sensitive-license]').textContent = ''; const image = result.querySelector('img'); image.src = ''; image.classList.add('hidden'); dialog.close(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(form); const errorBox = root.querySelector('#sensitive-error'); errorBox.textContent = '';
    try { const revealed = await api(`/api/guides/${encodeURIComponent(guide.id)}/sensitive`, { method: 'POST', body: JSON.stringify({ purpose: data.get('purpose'), confirmed: data.get('confirmed') === 'on' }) }); result.querySelector('[data-sensitive-id]').textContent = revealed.idNumber || '未保存'; result.querySelector('[data-sensitive-license]').textContent = revealed.guideLicenseNumber || '未保存'; result.querySelector('[data-sensitive-log]').textContent = `操作日志 ${revealed.logId}`; result.classList.remove('hidden'); }
    catch (error) { errorBox.textContent = error.message; }
  });
  result.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-view-document]'); if (!button) return; const data = new FormData(form);
    try { const loaded = await api(`/api/guides/${encodeURIComponent(guide.id)}/documents/${encodeURIComponent(button.dataset.viewDocument)}/view`, { method: 'POST', body: JSON.stringify({ purpose: data.get('purpose'), confirmed: data.get('confirmed') === 'on' }) }); const image = result.querySelector('img'); image.src = `data:${loaded.mimeType};base64,${loaded.base64}`; image.classList.remove('hidden'); result.querySelector('[data-sensitive-log]').textContent = `操作日志 ${loaded.logId}`; }
    catch (error) { root.querySelector('#sensitive-error').textContent = error.message; }
  });
}

async function bindGuideDetailPage() {
  const host = root.querySelector('#guide-detail-root'); const id = routeParams().get('id') || '';
  try { const guide = id ? await api(`/api/guides/${encodeURIComponent(id)}`) : null; host.innerHTML = guideFormMarkup(guide); bindGuideForm(guide); }
  catch (error) { host.innerHTML = `<article class="panel empty-list error-state"><h3>无法打开导游档案</h3><p>${escapeHtml(error.message)}</p><a class="button secondary" href="#/guides">返回导游库</a></article>`; }
}

function backupRowMarkup(backup) {
  const contents = [backup.contents.database ? '数据库' : '', backup.contents.certificates ? '证件目录' : ''].filter(Boolean).join('＋');
  const protectedLabel = backup.protected ? '<span class="status-tag warning">恢复保护副本</span>' : '<span class="status-tag success">校验通过</span>';
  return `<article class="backup-row" data-backup-id="${escapeHtml(backup.id)}"><div><h3>${escapeHtml(new Date(backup.createdAt).toLocaleString('zh-CN'))}</h3><p>${escapeHtml(contents)} · ${backup.fileCount} 个文件 · ${escapeHtml(backup.note || '无备注')}</p><small>${escapeHtml(backup.id)}</small></div><div class="row-actions">${protectedLabel}<button class="text-button" data-verify-backup="${escapeHtml(backup.id)}">重新校验</button><button class="text-button" data-restore-backup="${escapeHtml(backup.id)}">恢复</button></div></article>`;
}

async function loadBackups() {
  const listElement = root.querySelector('#backup-list');
  if (!listElement) return;
  try {
    const [status, listing] = await Promise.all([api('/api/backups/status'), api('/api/backups')]);
    root.querySelector('#backup-latest-time').textContent = status.latest ? new Date(status.latest.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '尚未备份';
    root.querySelector('#backup-latest-result').textContent = status.latestResult || '—';
    root.querySelector('#backup-today-verified').textContent = status.todayVerifiedAt ? '是' : '否';
    root.querySelector('#backup-invalid-count').textContent = status.invalidCount;
    root.querySelector('#backup-db-location').textContent = status.databaseLocation;
    root.querySelector('#backup-cert-location').textContent = status.certificatesLocation;
    root.querySelector('#backup-location').textContent = status.backupLocation;
    root.querySelector('#backup-retention').textContent = `${status.retention.daily} 日 / ${status.retention.monthly} 月`;
    root.querySelector('#backup-count').textContent = `${listing.backups.length} 个可用备份`;
    listElement.innerHTML = listing.backups.length ? listing.backups.map(backupRowMarkup).join('') : '<div class="empty-list"><h3>尚未创建备份</h3><p>首次备份会同时生成文件清单并执行完整性校验。</p></div>';
  } catch (error) {
    listElement.innerHTML = `<div class="empty-list error-state"><h3>备份状态读取失败</h3><p>${escapeHtml(error.message)}</p><button class="button secondary" data-retry-backups>重新读取</button></div>`;
  }
}

function bindBackupPage() {
  const form = root.querySelector('#backup-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    const message = root.querySelector('#backup-action-message');
    button.disabled = true; button.textContent = '正在备份并校验…'; message.textContent = '';
    try {
      const data = new FormData(form);
      const result = await api('/api/backups', { method: 'POST', body: JSON.stringify({ includeDatabase: data.has('includeDatabase'), includeCertificates: data.has('includeCertificates'), note: data.get('note') }) });
      message.textContent = result.cleanup.status === '成功' ? '备份与校验完成。' : '备份已完成，但部分旧备份清理失败。';
      form.elements.note.value = '';
      await loadBackups();
    } catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; button.textContent = '立即备份'; }
  });
  root.querySelector('#open-backup-location').addEventListener('click', async () => {
    try { await api('/api/backups/open-location', { method: 'POST', body: '{}' }); }
    catch (error) { root.querySelector('#backup-action-message').textContent = error.message; }
  });
  root.querySelector('#backup-list').addEventListener('click', async (event) => {
    if (event.target.closest('[data-retry-backups]')) return loadBackups();
    const verifyButton = event.target.closest('[data-verify-backup]');
    if (verifyButton) {
      const original = verifyButton.textContent; verifyButton.disabled = true; verifyButton.textContent = '校验中…';
      try { await api(`/api/backups/${encodeURIComponent(verifyButton.dataset.verifyBackup)}/verify`, { method: 'POST', body: '{}' }); verifyButton.textContent = '校验通过'; }
      catch (error) { verifyButton.textContent = error.message; }
      setTimeout(() => { if (verifyButton.isConnected) { verifyButton.disabled = false; verifyButton.textContent = original; } }, 1500);
    }
    const restoreButton = event.target.closest('[data-restore-backup]');
    if (restoreButton) {
      const row = restoreButton.closest('[data-backup-id]');
      const dialog = root.querySelector('#restore-dialog');
      const restoreForm = root.querySelector('#restore-form');
      restoreForm.reset();
      restoreForm.elements.backupId.value = restoreButton.dataset.restoreBackup;
      restoreForm.elements.confirmation.placeholder = restoreButton.dataset.restoreBackup;
      root.querySelector('#restore-impact').textContent = `${row.querySelector('h3').textContent} 的备份将覆盖当前对应数据。恢复前保护副本默认开启。`;
      dialog.showModal();
    }
  });
  root.querySelector('#cancel-restore').addEventListener('click', () => root.querySelector('#restore-dialog').close());
  root.querySelector('#restore-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const restoreForm = event.currentTarget;
    const backupId = restoreForm.elements.backupId.value;
    const backupCurrent = restoreForm.elements.backupCurrent.checked;
    if (!backupCurrent && !confirm('不创建恢复前保护副本会增加数据丢失风险。确定继续？')) return;
    const submit = restoreForm.querySelector('[type=submit]');
    submit.disabled = true; submit.textContent = '正在校验并恢复…'; root.querySelector('#restore-error').textContent = '';
    try {
      await api(`/api/backups/${encodeURIComponent(backupId)}/restore`, { method: 'POST', body: JSON.stringify({ confirmation: restoreForm.elements.confirmation.value, backupCurrent, acknowledgeOverwriteWithoutBackup: !backupCurrent }) });
      root.querySelector('#restore-dialog').close();
      root.querySelector('#backup-action-message').textContent = '恢复完成，当前数据已切换到所选备份。';
      await loadBackups();
    } catch (error) { root.querySelector('#restore-error').textContent = error.message; }
    finally { submit.disabled = false; submit.textContent = '确认恢复'; }
  });
  loadBackups();
}

function statusClass(status) {
  if (status === '成功' || status === '有效' || status === '已写入') return 'success';
  if (status === '失败' || status === '错误') return 'danger';
  if (status === '部分成功' || status === '警告' || status === '重复') return 'warning';
  return 'planned';
}

function fileToBase64(file) {
  return file.arrayBuffer().then((arrayBuffer) => {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(binary);
  });
}

function importBatchRowMarkup(batch) {
  const canCancel = ['待解析', '待映射', '待确认', '失败'].includes(batch.status);
  return `<article class="import-batch-row" data-import-batch="${escapeHtml(batch.id)}"><div><div class="batch-title"><h3>${escapeHtml(batch.targetLabel || batch.targetType)}</h3><span class="status-tag ${statusClass(batch.status)}">${escapeHtml(batch.status)}</span></div><p>${escapeHtml(batch.originalFilename || '粘贴文字')} · ${escapeHtml(new Date(batch.createdAt).toLocaleString('zh-CN'))}</p><small>成功 ${batch.successCount} · 跳过 ${batch.skippedCount} · 失败 ${batch.failedCount}${batch.errorSummary ? ` · ${escapeHtml(batch.errorSummary)}` : ''}</small></div><div class="row-actions"><a class="text-link inline" href="#/imports/mapping?batch=${encodeURIComponent(batch.id)}">${['成功', '部分成功', '已取消'].includes(batch.status) ? '查看结果' : '继续处理'}</a>${canCancel ? `<button class="text-button" data-cancel-import="${escapeHtml(batch.id)}">取消批次</button>` : ''}</div></article>`;
}

async function loadImportBatches() {
  const list = root.querySelector('#import-batch-list');
  if (!list) return;
  try {
    const batches = await api('/api/imports');
    root.querySelector('#import-pending-count').textContent = batches.filter((batch) => batch.status === '待确认').length;
    root.querySelector('#import-valid-count').textContent = '—';
    root.querySelector('#import-failed-count').textContent = batches.filter((batch) => batch.status === '失败').length;
    root.querySelector('#import-batch-count').textContent = `${batches.length} 个批次`;
    list.innerHTML = batches.length ? batches.map(importBatchRowMarkup).join('') : '<div class="empty-list"><h3>还没有导入批次</h3><p>下载标准模板，或选择文件进入临时预览。</p></div>';
  } catch (error) { list.innerHTML = `<div class="empty-list error-state"><h3>导入记录读取失败</h3><p>${escapeHtml(error.message)}</p></div>`; }
}

function bindImportsPage() {
  const form = root.querySelector('#import-form');
  const targetSelect = form.elements.targetType;
  const projectSelect = form.elements.projectId;
  const methodSelect = form.elements.importMethod;
  let context = null;

  function updateMethod() {
    const method = methodSelect.value;
    const textMode = method === '粘贴文字';
    root.querySelector('#import-file-field').classList.toggle('hidden', textMode);
    root.querySelector('#import-text-field').classList.toggle('hidden', !textMode);
    form.elements.file.required = !textMode;
    form.elements.text.required = textMode;
    const settings = method === 'Word' ? ['.docx', '仅支持 .docx，永不执行宏'] : method === 'CSV' ? ['.csv', '仅支持 .csv，最大 5 MB'] : ['.xlsx', '仅支持 .xlsx，最大 5 MB'];
    form.elements.file.accept = settings[0]; root.querySelector('#import-file-help').textContent = settings[1];
  }

  function updateTarget() {
    const target = context?.targets.find((item) => item.key === targetSelect.value);
    const projectField = root.querySelector('#import-project-field');
    projectField.classList.toggle('hidden', !target?.requiresProject);
    projectSelect.required = Boolean(target?.requiresProject);
    root.querySelector('#import-target-help').textContent = target ? `${target.writable ? '可在预览确认后写入' : '本阶段支持解析预览，正式写入后续启用'} · ${target.fields.length} 个目标字段` : '根据资料类型提供字段建议';
  }

  Promise.all([api('/api/imports/context'), api('/api/imports')]).then(([loadedContext, batches]) => {
    context = loadedContext;
    targetSelect.innerHTML = context.targets.map((target) => `<option value="${escapeHtml(target.key)}">${escapeHtml(target.label)}${target.writable ? '' : '（仅预览）'}</option>`).join('');
    const requestedTarget = routeParams().get('target');
    if (requestedTarget && context.targets.some((item) => item.key === requestedTarget)) targetSelect.value = requestedTarget;
    projectSelect.innerHTML = '<option value="">请选择项目</option>' + context.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.schoolName)} · ${escapeHtml(project.grade)} · ${escapeHtml(project.startsOn)}</option>`).join('');
    root.querySelector('#import-file-limit').textContent = `${Math.round(context.limits.maxFileBytes / 1024 / 1024)} MB`;
    root.querySelector('#import-pending-count').textContent = batches.filter((batch) => batch.status === '待确认').length;
    updateTarget(); updateMethod();
  }).catch((error) => { root.querySelector('#import-form-error').textContent = error.message; });
  targetSelect.addEventListener('change', updateTarget);
  methodSelect.addEventListener('change', updateMethod);
  root.querySelector('#download-import-template').addEventListener('click', () => {
    if (!targetSelect.value) return;
    const link = document.createElement('a');
    link.href = `/api/imports/templates/${encodeURIComponent(targetSelect.value)}`;
    link.download = '';
    document.body.append(link); link.click(); link.remove();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    const message = root.querySelector('#import-form-error');
    button.disabled = true; button.textContent = '正在解析…'; message.textContent = '';
    try {
      const data = new FormData(form);
      const method = data.get('importMethod');
      const file = data.get('file');
      const payload = { targetType: data.get('targetType'), projectId: data.get('projectId'), importMethod: method, templateVersion: data.get('templateVersion'), notes: data.get('notes'), text: method === '粘贴文字' ? data.get('text') : '', originalFilename: method === '粘贴文字' ? '' : file?.name || '' };
      if (method !== '粘贴文字') payload.fileBase64 = await fileToBase64(file);
      const batch = await api('/api/imports', { method: 'POST', body: JSON.stringify(payload) });
      location.hash = `#/imports/mapping?batch=${encodeURIComponent(batch.id)}`;
    } catch (error) {
      message.innerHTML = error.code === 'DUPLICATE_IMPORT' && error.details.batchId ? `${escapeHtml(error.message)} <a class="text-link inline" href="#/imports/mapping?batch=${encodeURIComponent(error.details.batchId)}">打开原批次</a>` : escapeHtml(error.message);
    } finally { button.disabled = false; button.textContent = '读取并预览'; }
  });
  root.querySelector('#import-batch-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-cancel-import]');
    if (!button || !confirm('取消后会删除该批次的临时行和临时文件，保留取消记录。确认继续？')) return;
    button.disabled = true;
    try { await api(`/api/imports/${encodeURIComponent(button.dataset.cancelImport)}`, { method: 'DELETE' }); await loadImportBatches(); }
    catch (error) { alert(error.message); button.disabled = false; }
  });
  loadImportBatches();
}

function mappingSelectMarkup(batch, sourceHeader) {
  const selected = batch.mapping[sourceHeader] || '';
  return `<select data-mapping-source="${escapeHtml(sourceHeader)}"><option value="">不使用</option>${batch.target.fields.map((field) => `<option value="${escapeHtml(field.key)}" ${selected === field.key ? 'selected' : ''}>${escapeHtml(field.label)}${field.required ? ' *' : ''}</option>`).join('')}</select>`;
}

function previewValue(value) {
  if (value === true) return '是';
  if (value === false) return '否';
  return String(value ?? '');
}

function importPreviewRowMarkup(row, batch) {
  const editable = !['成功', '部分成功', '已取消'].includes(batch.status);
  const raw = Object.entries(row.raw).filter(([, value]) => previewValue(value)).map(([key, value]) => `<span><b>${escapeHtml(key)}</b>${escapeHtml(previewValue(value))}</span>`).join('');
  const mapped = batch.target.fields.filter((field) => previewValue(row.mapped[field.key])).map((field) => `<span><b>${escapeHtml(field.label)}</b>${escapeHtml(previewValue(row.mapped[field.key]))}</span>`).join('');
  const issues = row.errors.length ? row.errors.map((issue) => `<li>${escapeHtml(issue.sourceColumn || issue.field ? `${issue.sourceColumn || issue.field}：${issue.message}` : issue.message)}</li>`).join('') : '<li>无</li>';
  const editFields = batch.target.fields.map((field) => `<label><span>${escapeHtml(field.label)}${field.required ? ' *' : ''}</span><input data-preview-field="${escapeHtml(field.key)}" value="${escapeHtml(previewValue(row.mapped[field.key]))}"></label>`).join('');
  return `<article class="import-preview-row ${row.status === '有效' ? 'row-valid' : 'row-problem'}" data-preview-row="${escapeHtml(row.id)}"><div class="preview-row-main"><span class="source-line">第 ${row.sourceRowNumber} 行</span><div class="preview-values">${mapped || '<em>尚未识别目标字段</em>'}</div><span class="status-tag ${statusClass(row.displayStatus)}">${escapeHtml(row.displayStatus)}</span></div><details><summary>查看来源、错误和修改预览值</summary><div class="preview-detail-grid"><section><h4>来源内容</h4><div class="key-value-list">${raw || '<em>空行</em>'}</div></section><section><h4>检查结果</h4><ul class="issue-list">${issues}</ul>${row.action === 'update' ? `<p class="match-note">匹配依据：${escapeHtml(row.matchBasis)}${row.overwriteFields.length ? `；将更新 ${escapeHtml(row.overwriteFields.join('、'))}` : '；没有非空字段需要覆盖'}</p>` : row.action === 'create' ? '<p class="match-note">将新增正式记录</p>' : ''}</section></div>${editable ? `<div class="preview-edit-grid">${editFields}</div><div class="preview-row-actions"><button class="button secondary compact" data-save-preview-row>保存本行修改</button><button class="text-button" data-toggle-preview-skip data-skipped="${row.status === '跳过'}">${row.status === '跳过' ? '恢复本行' : '跳过本行'}</button></div>` : ''}</details></article>`;
}

function renderImportMapping(batch) {
  const container = root.querySelector('#import-mapping-root');
  const final = ['成功', '部分成功', '已取消', '失败'].includes(batch.status) && Boolean(batch.confirmedAt || batch.status === '已取消');
  container.innerHTML = `
    <section class="metric-grid" aria-label="导入预览指标">${[['总行数', batch.counts.total, '来源数据'], ['可导入', batch.counts.valid, '通过校验'], ['跳过', batch.counts.skipped, '重复或人工跳过'], ['错误', batch.counts.failed, '阻断写入']].map(([label, value, note]) => `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('')}</section>
    <section class="panel mapping-summary"><div><p class="eyebrow">${escapeHtml(batch.target.label)} · ${escapeHtml(batch.originalFilename)}</p><h2>字段映射与导入预览</h2><p>批次 ${escapeHtml(batch.id)} · ${escapeHtml(new Date(batch.createdAt).toLocaleString('zh-CN'))}</p></div><span class="status-tag ${statusClass(batch.status)}">${escapeHtml(batch.status)}</span></section>
    ${!batch.target.writable ? `<div class="notice warning"><strong>当前只支持解析预览</strong><span>${escapeHtml(batch.target.label)}的正式写入适配器将在对应业务模块完成后启用。</span></div>` : ''}
    <section class="panel mapping-panel">
      <div class="section-heading"><div><p class="eyebrow">字段对应</p><h2>来源列与正式字段</h2></div>${final ? '' : '<div class="mapping-actions"><button class="text-button" id="auto-import-mapping">补全未映射字段</button><button class="text-button" id="reset-import-mapping">重置建议</button></div>'}</div>
      <form id="import-mapping-form"><div class="mapping-table"><div class="mapping-row mapping-head"><span>原始列</span><span>样例值</span><span>目标字段</span><span>状态</span></div>${batch.sourceHeaders.map((header) => { const samples = batch.rows.map((row) => previewValue(row.raw[header])).filter(Boolean).slice(0, 3).join('、'); const selected = batch.mapping[header]; return `<div class="mapping-row"><strong>${escapeHtml(header)}</strong><span>${escapeHtml(samples || '—')}</span><span>${mappingSelectMarkup(batch, header)}</span><em>${selected ? '已匹配' : '不使用 / 待选择'}</em></div>`; }).join('')}</div>${final ? '' : '<div class="mapping-footer"><span>修改映射会重新检查全部预览行</span><button class="button primary" type="submit">保存映射并重新检查</button></div>'}</form>
    </section>
    <section class="panel preview-panel" id="preview-panel"><div class="section-heading"><div><p class="eyebrow">行级预览</p><h2>定位、修正或跳过错误</h2></div><button class="button secondary compact" id="toggle-import-errors">只看错误</button></div><div id="import-preview-list" class="import-preview-list">${batch.rows.map((row) => importPreviewRowMarkup(row, batch)).join('')}</div></section>
    <section class="panel confirm-import-panel"><div><p class="eyebrow">确认写入</p><h2>${batch.target.writable ? '负责人确认后才写入正式数据' : '正式写入尚未启用'}</h2><p>${final ? `批次结果：成功 ${batch.successCount}、跳过 ${batch.skippedCount}、失败 ${batch.failedCount}。` : `预计可写入 ${batch.counts.valid} 行，跳过 ${batch.counts.skipped} 行，失败 ${batch.counts.failed} 行。`}</p></div><div class="confirm-import-actions"><a class="button secondary" href="#/imports">返回导入页</a>${final ? '' : `<button class="button secondary" id="cancel-import-batch">取消批次</button><select id="import-strategy"><option value="valid_only">仅导入有效行</option><option value="all_or_nothing">全部正确才导入</option></select><button class="button primary" id="confirm-import" ${batch.target.writable && batch.counts.valid ? '' : 'disabled'}>确认导入</button>`}</div><p class="form-error form-message" id="mapping-error" role="alert"></p></section>`;
  if (!final) bindImportMappingActions(batch);
  root.querySelector('#toggle-import-errors')?.addEventListener('click', (event) => { const active = container.classList.toggle('show-errors-only'); event.currentTarget.textContent = active ? '显示全部' : '只看错误'; });
}

function collectMapping() {
  return Object.fromEntries([...root.querySelectorAll('[data-mapping-source]')].map((select) => [select.dataset.mappingSource, select.value]));
}

function bindImportMappingActions(batch) {
  const errorBox = root.querySelector('#mapping-error');
  async function saveMapping(mapping) {
    try { renderImportMapping(await api(`/api/imports/${encodeURIComponent(batch.id)}/mapping`, { method: 'PUT', body: JSON.stringify({ mapping }) })); }
    catch (error) { errorBox.textContent = error.message; }
  }
  root.querySelector('#import-mapping-form').addEventListener('submit', (event) => { event.preventDefault(); saveMapping(collectMapping()); });
  root.querySelector('#auto-import-mapping').addEventListener('click', () => { const mapping = collectMapping(); for (const [header, value] of Object.entries(batch.suggestedMapping)) if (!mapping[header]) mapping[header] = value; saveMapping(mapping); });
  root.querySelector('#reset-import-mapping').addEventListener('click', () => saveMapping(batch.suggestedMapping));
  root.querySelector('#import-preview-list').addEventListener('click', async (event) => {
    const rowElement = event.target.closest('[data-preview-row]');
    if (!rowElement) return;
    const rowId = rowElement.dataset.previewRow;
    try {
      if (event.target.closest('[data-save-preview-row]')) {
        const values = Object.fromEntries([...rowElement.querySelectorAll('[data-preview-field]')].map((input) => [input.dataset.previewField, input.value]));
        return renderImportMapping(await api(`/api/imports/${encodeURIComponent(batch.id)}/rows/${encodeURIComponent(rowId)}`, { method: 'PATCH', body: JSON.stringify({ values }) }));
      }
      const skip = event.target.closest('[data-toggle-preview-skip]');
      if (skip) return renderImportMapping(await api(`/api/imports/${encodeURIComponent(batch.id)}/rows/${encodeURIComponent(rowId)}`, { method: 'PATCH', body: JSON.stringify({ skipped: skip.dataset.skipped !== 'true' }) }));
    } catch (error) { errorBox.textContent = error.message; }
  });
  root.querySelector('#cancel-import-batch').addEventListener('click', async () => {
    if (!confirm('取消后会删除临时行和临时文件。确认继续？')) return;
    try { await api(`/api/imports/${encodeURIComponent(batch.id)}`, { method: 'DELETE' }); location.hash = '#/imports'; }
    catch (error) { errorBox.textContent = error.message; }
  });
  root.querySelector('#confirm-import').addEventListener('click', async (event) => {
    const strategy = root.querySelector('#import-strategy').value;
    if (!confirm(`即将写入 ${batch.counts.valid} 行正式数据。确认后不能再次提交本批次，是否继续？`)) return;
    event.currentTarget.disabled = true; event.currentTarget.textContent = '正在写入…';
    try { renderImportMapping(await api(`/api/imports/${encodeURIComponent(batch.id)}/confirm`, { method: 'POST', body: JSON.stringify({ strategy }) })); }
    catch (error) { errorBox.textContent = error.message; event.currentTarget.disabled = false; event.currentTarget.textContent = '确认导入'; }
  });
}

async function bindImportMappingPage() {
  const id = routeParams().get('batch');
  if (!id) {
    root.querySelector('#import-mapping-root').innerHTML = '<article class="panel empty-list"><h3>没有选择导入批次</h3><p>请先从资料导入页读取文件或粘贴文字。</p><a class="button primary" href="#/imports">返回资料导入</a></article>';
    return;
  }
  try { renderImportMapping(await api(`/api/imports/${encodeURIComponent(id)}`)); }
  catch (error) { root.querySelector('#import-mapping-root').innerHTML = `<article class="panel empty-list error-state"><h3>无法打开导入批次</h3><p>${escapeHtml(error.message)}</p><a class="button secondary" href="#/imports">返回资料导入</a></article>`; }
}

function exitDialogMarkup() {
  return `<dialog id="exit-dialog" class="form-dialog exit-dialog"><div class="dialog-heading"><p class="eyebrow">退出前备份提醒</p><h2>今天还没有已校验备份</h2><p>可以先完成备份再退出；直接退出不会伪造成已备份，并会留下操作记录。</p></div><p class="form-error" id="exit-error" role="alert"></p><div class="exit-actions"><button class="button primary" data-exit-action="backup_and_exit">立即备份并退出</button><button class="button secondary" data-exit-action="stay">暂不退出</button><button class="button danger-button" data-exit-action="exit_without_backup">仍然退出</button></div></dialog>`;
}

function finishLogout() {
  state.authenticated = false;
  location.hash = '';
  renderUnlock();
}

async function requestLogout() {
  try { await api('/api/session', { method: 'DELETE' }); finishLogout(); }
  catch (error) {
    if (error.code !== 'BACKUP_REMINDER_REQUIRED') return alert(error.message);
    root.querySelector('#exit-dialog').showModal();
  }
}

function bindExitDialog() {
  root.querySelector('#exit-dialog').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-exit-action]');
    if (!button) return;
    const action = button.dataset.exitAction;
    if (action === 'stay') return root.querySelector('#exit-dialog').close();
    const confirmed = action !== 'exit_without_backup' || confirm('今天没有已校验备份。确认仍然退出并记录此事实？');
    if (!confirmed) return;
    button.disabled = true;
    try {
      const result = await api('/api/backups/exit', { method: 'POST', body: JSON.stringify({ action, confirmed }) });
      if (result.canExit) finishLogout();
    } catch (error) { root.querySelector('#exit-error').textContent = error.message; button.disabled = false; }
  });
}

let transportWorkspace = null;

function transportContent() {
  return '<section id="transport-root" class="transport-page-root"><article class="panel"><p class="muted">正在读取项目车辆与乘员安排…</p></article></section>';
}

function transportPickerMarkup(projects) {
  return `<article class="panel empty-list transport-project-picker"><h2>选择要安排乘车的项目</h2><p>P08 会读取班级、随车老师和已分班导游，并按当前项目车辆生成建议。</p><form id="transport-project-picker"><label class="field"><span>项目</span><select name="project" required><option value="">请选择</option>${projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.school_name)} · ${escapeHtml(project.grade)} · ${escapeHtml(project.starts_on)}</option>`).join('')}</select></label><button class="button primary" type="submit">进入 P08</button></form></article>`;
}

function toTransportVehicle(row) {
  return {
    id: row.id, vehicleLabel: row.vehicle_label || '', fleetName: row.fleet_name || '', vehicleModel: row.vehicle_model || '', plateNumber: row.plate_number || '',
    capacity: Number(row.capacity || 0), safetyReserve: Number(row.safety_reserve || 0), driverName: row.driver_name || '', driverPhone: row.driver_phone || '',
    driverGender: row.driver_gender || '未填写', driverNeedsLodging: Boolean(row.driver_needs_lodging), driverJoinsDefaultMeals: Boolean(row.driver_joins_default_meals), notes: row.notes || '',
    allocations: (row.allocations || []).map((allocation) => ({ id: allocation.id, classId: allocation.class_id, role: allocation.role,
      peopleCount: Number(allocation.people_count || 0), boysCount: Number(allocation.boys_count || 0), girlsCount: Number(allocation.girls_count || 0),
      projectGuideId: allocation.project_guide_id || '', notes: allocation.notes || '' }))
  };
}

function transportClassOptions(summary, selected) {
  return summary.classes.map((row) => `<option value="${escapeHtml(row.id)}" ${row.id === selected ? 'selected' : ''}>${escapeHtml(row.name)}（学生 ${row.student_total} / 随车老师 ${row.teachers_on_vehicle}）</option>`).join('');
}

function transportGuideOptions(summary, classId, selected) {
  const guides = summary.guides.filter((guide) => guide.handling_status === '保留' && guide.assignments?.some((assignment) => assignment.classId === classId));
  return `<option value="">请选择负责本班的导游</option>${guides.map((guide) => `<option value="${escapeHtml(guide.id)}" ${guide.id === selected ? 'selected' : ''}>${escapeHtml(guide.guide_name || guide.source_name)} · ${escapeHtml(guide.guide_phone || guide.source_phone || '无电话')}</option>`).join('')}`;
}

function transportAllocationMarkup(allocation, vehicleIndex, allocationIndex, summary, vehicles) {
  const isStudent = allocation.role === '学生'; const isGuide = allocation.role === '导游';
  return `<div class="transport-allocation-row" data-allocation-index="${allocationIndex}">
    <label class="field"><span>班级</span><select data-allocation-field="classId">${transportClassOptions(summary, allocation.classId)}</select></label>
    <label class="field"><span>角色</span><select data-allocation-field="role">${['学生','老师','导游'].map((role) => `<option ${role === allocation.role ? 'selected' : ''}>${role}</option>`).join('')}</select></label>
    <label class="field"><span>人数</span><input data-allocation-field="peopleCount" type="number" min="1" step="1" value="${Number(allocation.peopleCount || 0)}"></label>
    ${isStudent ? `<label class="field"><span>男生</span><input data-allocation-field="boysCount" type="number" min="0" step="1" value="${Number(allocation.boysCount || 0)}"></label><label class="field"><span>女生</span><input data-allocation-field="girlsCount" type="number" min="0" step="1" value="${Number(allocation.girlsCount || 0)}"></label>` : '<span class="allocation-spacer"></span><span class="allocation-spacer"></span>'}
    ${isGuide ? `<label class="field guide-field"><span>具体导游</span><select data-allocation-field="projectGuideId">${transportGuideOptions(summary, allocation.classId, allocation.projectGuideId)}</select></label>` : '<span class="allocation-spacer guide-field"></span>'}
    <label class="field move-field"><span>移动到</span><select data-move-allocation><option value="">当前车辆</option>${vehicles.map((vehicle, index) => index === vehicleIndex ? '' : `<option value="${index}">${escapeHtml(vehicle.vehicleLabel || `${index + 1}车`)}</option>`).join('')}</select></label>
    <button class="text-button danger" type="button" data-remove-allocation>删除</button>
  </div>`;
}

function transportVehicleMarkup(vehicle, index, summary, vehicles) {
  const allocated = vehicle.allocations.reduce((sum, row) => sum + Number(row.peopleCount || 0), 0);
  const usable = Number(vehicle.capacity || 0) - Number(vehicle.safetyReserve || 0); const empty = usable - allocated;
  return `<article class="panel transport-vehicle" data-vehicle-index="${index}" data-source-id="${escapeHtml(vehicle.id || '')}">
    <div class="transport-vehicle-heading"><div><span class="vehicle-order">车辆 ${index + 1}</span><h3>${escapeHtml(vehicle.vehicleLabel || '未命名车辆')}</h3></div><div class="vehicle-capacity ${empty < 0 ? 'overload' : ''}"><span>乘员 <b data-vehicle-allocated>${allocated}</b> / 可用座位 <b data-vehicle-usable>${usable}</b></span><strong data-vehicle-empty>${empty < 0 ? `超载 ${Math.abs(empty)}` : `空位 ${empty}`}</strong></div><button class="text-button danger" type="button" data-remove-vehicle>删除车辆</button></div>
    <div class="transport-vehicle-fields">
      <label class="field"><span>车号 <b>*</b></span><input data-vehicle-field="vehicleLabel" value="${escapeHtml(vehicle.vehicleLabel)}"></label>
      <label class="field"><span>车队名称</span><input data-vehicle-field="fleetName" value="${escapeHtml(vehicle.fleetName)}"></label>
      <label class="field"><span>车型</span><input data-vehicle-field="vehicleModel" value="${escapeHtml(vehicle.vehicleModel)}"></label>
      <label class="field"><span>车牌号</span><input data-vehicle-field="plateNumber" value="${escapeHtml(vehicle.plateNumber)}"></label>
      <label class="field"><span>座位数 <b>*</b></span><input data-vehicle-field="capacity" type="number" min="1" step="1" value="${Number(vehicle.capacity || 0)}"></label>
      <label class="field"><span>预留座位</span><input data-vehicle-field="safetyReserve" type="number" min="0" step="1" value="${Number(vehicle.safetyReserve || 0)}"></label>
      <label class="field"><span>司机姓名</span><input data-vehicle-field="driverName" value="${escapeHtml(vehicle.driverName)}"></label>
      <label class="field"><span>司机电话</span><input data-vehicle-field="driverPhone" value="${escapeHtml(vehicle.driverPhone)}"></label>
      <label class="field"><span>司机性别</span><select data-vehicle-field="driverGender">${['未填写','男','女'].map((gender) => `<option ${gender === vehicle.driverGender ? 'selected' : ''}>${gender}</option>`).join('')}</select></label>
      <label class="transport-check"><input data-vehicle-field="driverNeedsLodging" type="checkbox" ${vehicle.driverNeedsLodging ? 'checked' : ''} ${summary.project.needs_lodging ? '' : 'disabled'}><span>司机住宿</span></label>
      <label class="transport-check"><input data-vehicle-field="driverJoinsDefaultMeals" type="checkbox" ${vehicle.driverJoinsDefaultMeals ? 'checked' : ''} ${summary.project.includes_meals ? '' : 'disabled'}><span>司机参加默认餐次</span></label>
    </div>
    <div class="transport-allocations"><div class="section-heading"><div><p class="eyebrow">乘员明细</p><small>学生、老师、导游都计入车辆容量；可以修改人数或移动到其他车辆。</small></div><button class="button secondary compact" type="button" data-add-allocation>新增乘员行</button></div>
      <div class="transport-allocation-list">${vehicle.allocations.length ? vehicle.allocations.map((row, allocationIndex) => transportAllocationMarkup(row, index, allocationIndex, summary, vehicles)).join('') : '<div class="inline-empty">当前车辆还没有乘员安排</div>'}</div>
    </div>
  </article>`;
}

function transportLocalState(summary, vehicles) {
  const classTotals = new Map(summary.classes.map((row) => [row.id, { name: row.name, students: 0, boys: 0, girls: 0, teachers: 0, guides: 0, expectedStudents: Number(row.student_total), expectedBoys: Number(row.boys), expectedGirls: Number(row.girls), expectedTeachers: Number(row.teachers_on_vehicle) }]));
  let capacity = 0; let assigned = 0; const errors = []; const guideIds = new Set();
  vehicles.forEach((vehicle, index) => {
    const usable = Number(vehicle.capacity || 0) - Number(vehicle.safetyReserve || 0); const used = vehicle.allocations.reduce((sum, row) => sum + Number(row.peopleCount || 0), 0);
    capacity += usable; assigned += used;
    if (!String(vehicle.vehicleLabel || '').trim()) errors.push(`第 ${index + 1} 辆车缺少车号`);
    if (!Number.isInteger(Number(vehicle.capacity)) || Number(vehicle.capacity) <= 0) errors.push(`${vehicle.vehicleLabel || `第 ${index + 1} 辆车`}座位数无效`);
    if (used > usable) errors.push(`${vehicle.vehicleLabel || `第 ${index + 1} 辆车`}超载 ${used - usable} 人`);
    if (summary.project.needs_lodging && vehicle.driverNeedsLodging && vehicle.driverGender === '未填写') errors.push(`${vehicle.vehicleLabel || `第 ${index + 1} 辆车`}住宿司机未填写性别`);
    vehicle.allocations.forEach((row) => {
      const target = classTotals.get(row.classId); if (!target) { errors.push('存在不属于本项目的班级'); return; }
      const count = Number(row.peopleCount || 0); if (row.role === '学生') { target.students += count; target.boys += Number(row.boysCount || 0); target.girls += Number(row.girlsCount || 0); if (Number(row.boysCount || 0) + Number(row.girlsCount || 0) !== count) errors.push(`${target.name} 学生行男女生之和不等于人数`); }
      if (row.role === '老师') target.teachers += count;
      if (row.role === '导游') { target.guides += count; if (!row.projectGuideId) errors.push(`${target.name} 导游行未选择具体导游`); else if (guideIds.has(row.projectGuideId)) errors.push('同一导游被重复安排上车'); else guideIds.add(row.projectGuideId); }
    });
  });
  for (const row of classTotals.values()) {
    if (row.students !== row.expectedStudents || row.boys !== row.expectedBoys || row.girls !== row.expectedGirls) errors.push(`${row.name} 学生应为 ${row.expectedStudents} 人（男 ${row.expectedBoys} / 女 ${row.expectedGirls}），当前为 ${row.students} 人（男 ${row.boys} / 女 ${row.girls}）`);
    if (row.teachers !== row.expectedTeachers) errors.push(`${row.name} 随车老师应为 ${row.expectedTeachers} 人，当前为 ${row.teachers} 人`);
  }
  const expectedGuides = summary.guides.filter((guide) => guide.handling_status === '保留' && guide.assignment_count > 0).length;
  if (guideIds.size !== expectedGuides) errors.push(`已分班导游应上车 ${expectedGuides} 人，当前 ${guideIds.size} 人`);
  return { capacity, assigned, empty: capacity - assigned, errors };
}

function transportPageMarkup(summary, vehicles, message = '', suggestionNote = '') {
  const totals = transportLocalState(summary, vehicles); const blockers = summary.exceptions.filter((row) => row.module === '乘车' && row.status === '待处理');
  return `<div class="transport-workspace" data-project-id="${escapeHtml(summary.project.id)}">
    <article class="panel transport-project-banner"><div><p class="eyebrow">当前项目</p><h2>${escapeHtml(summary.project.school_name)} · ${escapeHtml(summary.project.grade)} · ${escapeHtml(summary.project.destination)}</h2><p>${formatProjectDate(summary.project.starts_on)}—${formatProjectDate(summary.project.ends_on)}；班级 ${summary.classes.length} 个，学生 ${summary.students} 人，随车老师 ${summary.teachersRiding} 人，已分班导游 ${summary.arrangedGuides} 人。</p></div><div class="transport-banner-actions"><a class="button secondary compact" href="#/imports?target=transport&project=${encodeURIComponent(summary.project.id)}">导入车辆</a><a class="button secondary compact" href="#/projects/people?project=${encodeURIComponent(summary.project.id)}">核对 P05</a></div></article>
    <section class="metric-grid transport-metrics" aria-label="乘车指标">${[['车辆', vehicles.length, '当前项目'], ['可用座位', totals.capacity, '已扣预留'], ['已安排乘员', totals.assigned, `目标 ${summary.students + summary.teachersRiding + summary.arrangedGuides}`], [totals.empty < 0 ? '超载' : '空位', Math.abs(totals.empty), totals.empty < 0 ? '必须修正' : '不得为负']].map(([label,value,note], index) => `<article class="metric ${index === 3 && totals.empty < 0 ? 'danger-metric' : ''}"><span>${label}</span><strong data-transport-metric="${index}">${value}</strong><small data-transport-note="${index}">${note}</small></article>`).join('')}</section>
    <article class="panel transport-toolbar"><div><p class="eyebrow">安排工具</p><h2>先维护车辆，再生成建议</h2><p>建议优先整班上车、按班级顺序安排并减少空位；已有手工安排时会先显示影响，不会静默覆盖。</p></div><div class="transport-toolbar-actions"><button class="button secondary" id="add-transport-vehicle" type="button">新增车辆</button><button class="button primary" id="suggest-transport" type="button">生成分车建议</button></div></article>
    ${suggestionNote ? `<div class="transport-suggestion-note" role="status">${escapeHtml(suggestionNote)}</div>` : ''}
    <form id="transport-form"><div class="transport-vehicle-list">${vehicles.length ? vehicles.map((vehicle, index) => transportVehicleMarkup(vehicle, index, summary, vehicles)).join('') : '<article class="panel inline-empty transport-empty">还没有车辆。可先新增车辆，或从资料导入页导入车辆资料。</article>'}</div>
      <div class="people-save-bar transport-save-bar"><div><p id="transport-message" class="form-message ${message ? 'success-message' : ''}">${escapeHtml(message)}</p><p class="people-save-note">保存后会同步 P05 司机汇总，并重新计算乘车异常；只有写入数据库后才算正式安排。</p></div><button class="button secondary" id="validate-transport" type="button">校验当前编辑</button><button class="button primary" type="submit">保存乘车安排</button></div>
    </form>
    ${blockers.length ? `<article class="panel transport-blockers"><div class="section-heading"><div><p class="eyebrow">数据库中的待处理异常</p><h2>${blockers.length} 项乘车阻断</h2></div></div>${blockers.map((row) => `<p><strong>${escapeHtml(row.code)}</strong>${escapeHtml(row.message)}</p>`).join('')}</article>` : ''}
  </div>`;
}

function updateTransportLiveSummary() {
  if (!transportWorkspace) return;
  const totals = transportLocalState(transportWorkspace.summary, transportWorkspace.vehicles);
  const metrics = root.querySelectorAll('[data-transport-metric]'); const notes = root.querySelectorAll('[data-transport-note]');
  if (metrics.length === 4) { metrics[0].textContent = transportWorkspace.vehicles.length; metrics[1].textContent = totals.capacity; metrics[2].textContent = totals.assigned; metrics[3].textContent = Math.abs(totals.empty); notes[3].textContent = totals.empty < 0 ? '必须修正' : '不得为负'; metrics[3].closest('.metric').classList.toggle('danger-metric', totals.empty < 0); }
  root.querySelectorAll('[data-vehicle-index]').forEach((card) => { const vehicle = transportWorkspace.vehicles[Number(card.dataset.vehicleIndex)]; const allocated = vehicle.allocations.reduce((sum, row) => sum + Number(row.peopleCount || 0), 0); const usable = Number(vehicle.capacity || 0) - Number(vehicle.safetyReserve || 0); const empty = usable - allocated; card.querySelector('[data-vehicle-allocated]').textContent = allocated; card.querySelector('[data-vehicle-usable]').textContent = usable; card.querySelector('[data-vehicle-empty]').textContent = empty < 0 ? `超载 ${Math.abs(empty)}` : `空位 ${empty}`; card.querySelector('.vehicle-capacity').classList.toggle('overload', empty < 0); });
}

function bindTransportWorkspace() {
  const form = root.querySelector('#transport-form'); if (!form || !transportWorkspace) return;
  const render = (message = '', suggestionNote = '') => { root.querySelector('#transport-root').innerHTML = transportPageMarkup(transportWorkspace.summary, transportWorkspace.vehicles, message, suggestionNote); bindTransportWorkspace(); };
  form.addEventListener('input', (event) => {
    const vehicleCard = event.target.closest('[data-vehicle-index]'); if (!vehicleCard) return; const vehicle = transportWorkspace.vehicles[Number(vehicleCard.dataset.vehicleIndex)];
    if (event.target.dataset.vehicleField) { const field = event.target.dataset.vehicleField; vehicle[field] = event.target.type === 'checkbox' ? event.target.checked : event.target.type === 'number' ? Number(event.target.value) : event.target.value; }
    const allocationRow = event.target.closest('[data-allocation-index]'); if (allocationRow && event.target.dataset.allocationField) { const row = vehicle.allocations[Number(allocationRow.dataset.allocationIndex)]; const field = event.target.dataset.allocationField; row[field] = event.target.type === 'number' ? Number(event.target.value) : event.target.value; }
    updateTransportLiveSummary();
  });
  form.addEventListener('change', (event) => {
    const vehicleCard = event.target.closest('[data-vehicle-index]'); if (!vehicleCard) return; const vehicleIndex = Number(vehicleCard.dataset.vehicleIndex); const vehicle = transportWorkspace.vehicles[vehicleIndex]; const allocationRow = event.target.closest('[data-allocation-index]');
    if (allocationRow && event.target.dataset.allocationField) { const row = vehicle.allocations[Number(allocationRow.dataset.allocationIndex)]; const field = event.target.dataset.allocationField; row[field] = event.target.type === 'number' ? Number(event.target.value) : event.target.value; if (field === 'role') { row.boysCount = 0; row.girlsCount = 0; row.projectGuideId = ''; if (row.role === '导游') row.peopleCount = 1; render(); return; } if (field === 'classId' && row.role === '导游') { row.projectGuideId = ''; render(); return; } }
    if (allocationRow && event.target.matches('[data-move-allocation]') && event.target.value !== '') { const allocationIndex = Number(allocationRow.dataset.allocationIndex); const [row] = vehicle.allocations.splice(allocationIndex, 1); transportWorkspace.vehicles[Number(event.target.value)].allocations.push(row); render('', '乘员行已移动；尚未保存到数据库。'); }
  });
  form.addEventListener('click', (event) => {
    const card = event.target.closest('[data-vehicle-index]'); if (!card) return; const vehicleIndex = Number(card.dataset.vehicleIndex); const vehicle = transportWorkspace.vehicles[vehicleIndex];
    if (event.target.closest('[data-remove-vehicle]')) { if (vehicle.allocations.length) { root.querySelector('#transport-message').textContent = '这辆车已有乘员，请先移动或删除乘员行，再删除车辆。'; return; } transportWorkspace.vehicles.splice(vehicleIndex, 1); render(); }
    if (event.target.closest('[data-add-allocation]')) { const firstClass = transportWorkspace.summary.classes[0]; if (!firstClass) { root.querySelector('#transport-message').textContent = '请先在 P05 建立班级与人员基线。'; return; } vehicle.allocations.push({ classId: firstClass.id, role: '老师', peopleCount: 1, boysCount: 0, girlsCount: 0, projectGuideId: '' }); render('', '已新增乘员行；可修改角色、班级和人数。'); }
    const allocation = event.target.closest('[data-allocation-index]'); if (allocation && event.target.closest('[data-remove-allocation]')) { vehicle.allocations.splice(Number(allocation.dataset.allocationIndex), 1); render(); }
  });
  root.querySelector('#add-transport-vehicle').addEventListener('click', () => { const index = transportWorkspace.vehicles.length; transportWorkspace.vehicles.push({ vehicleLabel: `${index + 1}车`, fleetName: '', vehicleModel: '', plateNumber: '', capacity: 49, safetyReserve: 0, driverName: '', driverPhone: '', driverGender: '未填写', driverNeedsLodging: false, driverJoinsDefaultMeals: false, notes: '', allocations: [] }); render('', '已新增车辆；补全资料后可生成建议。'); });
  root.querySelector('#validate-transport').addEventListener('click', () => { const totals = transportLocalState(transportWorkspace.summary, transportWorkspace.vehicles); const message = root.querySelector('#transport-message'); message.className = `form-message ${totals.errors.length ? '' : 'success-message'}`; message.innerHTML = totals.errors.length ? totals.errors.slice(0, 8).map(escapeHtml).join('<br>') : `当前编辑校验通过：${totals.assigned} 人，可用座位 ${totals.capacity}，空位 ${totals.empty}。`; });
  root.querySelector('#suggest-transport').addEventListener('click', async (event) => { const button = event.currentTarget; button.disabled = true; try { const result = await api(`/api/projects/${encodeURIComponent(transportWorkspace.summary.project.id)}/transport/suggest`, { method: 'POST', body: JSON.stringify({ vehicles: transportWorkspace.vehicles }) }); const currentRows = transportWorkspace.vehicles.reduce((sum, vehicle) => sum + vehicle.allocations.length, 0); const proposedRows = result.vehicles.reduce((sum, vehicle) => sum + vehicle.allocations.length, 0); if (currentRows && !confirm(`当前编辑有 ${currentRows} 条乘员明细，建议将替换为 ${proposedRows} 条。数据库不会在确认前改变。是否把建议加载到编辑区？`)) return; transportWorkspace.vehicles = result.vehicles; const note = result.unassigned.length ? `建议已加载，但仍有 ${result.unassigned.map((row) => `${row.className} 班缺 ${row.missingSeats} 个座位`).join('、')}。请补车或调整后再保存。` : `建议已加载：乘员 ${result.totals.assigned} 人，空位 ${result.totals.emptySeats}；${result.splitClasses.length ? `拆分班级 ${result.splitClasses.map((row) => row.className).join('、')}` : '未拆班'}。尚未保存到数据库。`; render('', note); } catch (error) { const message = root.querySelector('#transport-message'); message.textContent = error.details?.fields?.map((row) => row.message).join('；') || error.message; button.disabled = false; } });
  form.addEventListener('submit', async (event) => { event.preventDefault(); const button = form.querySelector('[type="submit"]'); button.disabled = true; button.textContent = '正在保存…'; try { const saved = await api(`/api/projects/${encodeURIComponent(transportWorkspace.summary.project.id)}/transport`, { method: 'POST', body: JSON.stringify({ vehicles: transportWorkspace.vehicles }) }); transportWorkspace = { summary: saved, vehicles: saved.transport.map(toTransportVehicle) }; render('车辆、乘员、司机汇总和容量异常已保存并重新计算。'); } catch (error) { const message = root.querySelector('#transport-message'); message.className = 'form-message'; message.innerHTML = error.details?.fields?.map((row) => escapeHtml(row.message)).join('<br>') || escapeHtml(error.message); button.disabled = false; button.textContent = '保存乘车安排'; } });
}

async function bindTransportPage() {
  const host = root.querySelector('#transport-root'); const projectId = routeParams().get('project');
  try {
    if (!projectId) { const projects = await api('/api/projects'); host.innerHTML = transportPickerMarkup(projects); host.querySelector('#transport-project-picker').addEventListener('submit', (event) => { event.preventDefault(); location.hash = `/projects/transport?project=${encodeURIComponent(new FormData(event.currentTarget).get('project'))}`; }); return; }
    const summary = await api(`/api/projects/${encodeURIComponent(projectId)}`); transportWorkspace = { summary, vehicles: summary.transport.map(toTransportVehicle) }; host.innerHTML = transportPageMarkup(summary, transportWorkspace.vehicles); bindTransportWorkspace(); focusExceptionSource('.transport-project-banner');
  } catch (error) { host.innerHTML = `<article class="panel"><p class="form-error">${escapeHtml(error.message)}</p></article>`; }
}

let lodgingWorkspace = null;

function lodgingContent() {
  return '<section id="lodging-root" class="lodging-page-root"><article class="panel"><p class="muted">正在读取住宿条件、房源与统一人员汇总…</p></article></section>';
}

function lodgingPickerMarkup(projects) {
  const applicable = projects.filter((project) => project.needs_lodging);
  return `<article class="panel lodging-project-picker"><h2>选择需要住宿的项目</h2><p>P09 只显示跨日且已启用住宿的项目；人员人数从 P05、P07、P08 只读汇总。</p>${applicable.length ? `<form id="lodging-project-picker"><label class="field"><span>住宿项目</span><select name="project" required><option value="">请选择</option>${applicable.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.school_name)} · ${escapeHtml(project.grade)} · ${escapeHtml(project.starts_on)}</option>`).join('')}</select></label><button class="button primary" type="submit">进入 P09</button></form>` : '<div class="inline-empty">当前没有需要住宿的进行中项目</div>'}</article>`;
}

function lodgingNightsClient(project) {
  const rows = []; const date = new Date(`${project.starts_on}T00:00:00Z`); const end = new Date(`${project.ends_on}T00:00:00Z`);
  while (date < end) { rows.push(date.toISOString().slice(0, 10)); date.setUTCDate(date.getUTCDate() + 1); }
  return rows;
}

function lodgingSources(summary) {
  const rows = [];
  summary.classes.forEach((row) => { if (row.boys) rows.push({ classId: row.id, className: row.name, role: '学生', gender: '男', peopleCount: Number(row.boys), source: 'P05 班级人数', href: `/projects/people?project=${summary.project.id}` }); if (row.girls) rows.push({ classId: row.id, className: row.name, role: '学生', gender: '女', peopleCount: Number(row.girls), source: 'P05 班级人数', href: `/projects/people?project=${summary.project.id}` }); });
  const grouped = new Map();
  summary.staff.filter((row) => Number(row.lodging_count || 0) > 0).forEach((row) => { const key = `${row.role}|${row.gender}`; const item = grouped.get(key) || { role: row.role, gender: row.gender, peopleCount: 0 }; item.peopleCount += Number(row.lodging_count); grouped.set(key, item); });
  grouped.forEach((row) => { const href = row.role === '导游' ? `/projects/guides?project=${summary.project.id}` : row.role === '司机' ? `/projects/transport?project=${summary.project.id}` : `/projects/people?project=${summary.project.id}`; rows.push({ ...row, source: row.role === '导游' ? 'P07 导游安排' : row.role === '司机' ? 'P08 车辆司机' : 'P05 人员汇总', href }); });
  return rows;
}

function toLodgingRoom(row) {
  return { id: row.id, lodgingName: row.lodging_name || '', checkInOn: row.check_in_on || '', building: row.building || '', floorLabel: row.floor_label || '', roomNumber: row.room_number || '', roomType: row.room_type || '', capacity: Number(row.capacity || 0), genderRule: row.gender_rule || '不限', notes: row.notes || '',
    allocations: (row.allocations || []).map((allocation) => ({ id: allocation.id, classId: allocation.class_id || '', role: allocation.role, gender: allocation.gender, peopleCount: Number(allocation.people_count || 0), crossClassReason: allocation.cross_class_reason || '' })) };
}

function lodgingClassOptions(summary, selected) {
  return `<option value="">请选择班级</option>${summary.classes.map((row) => `<option value="${escapeHtml(row.id)}" ${row.id === selected ? 'selected' : ''}>${escapeHtml(row.name)}（男 ${row.boys} / 女 ${row.girls}）</option>`).join('')}`;
}

function lodgingAllocationMarkup(row, roomIndex, allocationIndex, summary, rooms) {
  return `<div class="lodging-allocation-row" data-lodging-allocation-index="${allocationIndex}">
    <label class="field"><span>角色</span><select data-lodging-allocation-field="role">${['学生','老师','导游','司机','摄影师','其他'].map((role) => `<option ${role === row.role ? 'selected' : ''}>${role}</option>`).join('')}</select></label>
    ${row.role === '学生' ? `<label class="field lodging-class-field"><span>班级</span><select data-lodging-allocation-field="classId">${lodgingClassOptions(summary, row.classId)}</select></label>` : '<span class="lodging-class-field allocation-spacer"></span>'}
    <label class="field"><span>性别</span><select data-lodging-allocation-field="gender">${['男','女'].map((gender) => `<option ${gender === row.gender ? 'selected' : ''}>${gender}</option>`).join('')}</select></label>
    <label class="field"><span>人数</span><input data-lodging-allocation-field="peopleCount" type="number" min="1" step="1" value="${Number(row.peopleCount || 0)}"></label>
    <label class="field lodging-move-field"><span>移动到</span><select data-move-lodging-allocation><option value="">当前房间</option>${rooms.map((room, index) => index === roomIndex ? '' : `<option value="${index}">${escapeHtml(room.roomNumber || `房间 ${index + 1}`)}</option>`).join('')}</select></label>
    <button class="text-button danger" type="button" data-remove-lodging-allocation>删除</button>
    ${row.role === '学生' ? `<label class="field lodging-reason-field"><span>跨班拼房原因（同房多班时必填）</span><input data-lodging-allocation-field="crossClassReason" value="${escapeHtml(row.crossClassReason || '')}"></label>` : ''}
  </div>`;
}

function lodgingRoomMarkup(room, index, summary, rooms) {
  const allocated = room.allocations.reduce((sum, row) => sum + Number(row.peopleCount || 0), 0); const genders = new Set(room.allocations.map((row) => row.gender));
  const classes = [...new Set(room.allocations.filter((row) => row.role === '学生' && row.classId).map((row) => summary.classes.find((item) => item.id === row.classId)?.name || row.classId))];
  const invalidGender = genders.size > 1 || [...genders].some((gender) => room.genderRule !== '不限' && room.genderRule !== gender);
  return `<article class="panel lodging-room" data-lodging-room-index="${index}"><div class="lodging-room-heading"><div><span class="room-order">房间 ${index + 1}</span><h3>${escapeHtml(room.roomNumber || '未命名房间')}</h3>${classes.length > 1 ? `<small class="cross-class-tag">跨班：主班 ${escapeHtml(classes[0])} / 拼入 ${escapeHtml(classes.slice(1).join('、'))}</small>` : ''}</div><div class="room-capacity ${allocated > room.capacity || invalidGender ? 'invalid' : ''}"><span>已安排 ${allocated} / 床位 ${room.capacity}</span><strong>${allocated > room.capacity ? `超员 ${allocated - room.capacity}` : invalidGender ? '性别冲突' : `空床 ${room.capacity - allocated}`}</strong></div><button class="text-button danger" type="button" data-remove-lodging-room>删除房间</button></div>
    <div class="lodging-room-fields">
      <label class="field"><span>酒店名称 <b>*</b></span><input data-lodging-room-field="lodgingName" value="${escapeHtml(room.lodgingName)}"></label>
      <label class="field"><span>入住日期 <b>*</b></span><input data-lodging-room-field="checkInOn" type="date" value="${escapeHtml(room.checkInOn)}"></label>
      <label class="field"><span>楼栋</span><input data-lodging-room-field="building" value="${escapeHtml(room.building)}"></label>
      <label class="field"><span>楼层 <b>*</b></span><input data-lodging-room-field="floorLabel" value="${escapeHtml(room.floorLabel)}"></label>
      <label class="field"><span>房间号 <b>*</b></span><input data-lodging-room-field="roomNumber" value="${escapeHtml(room.roomNumber)}"></label>
      <label class="field"><span>房型</span><input data-lodging-room-field="roomType" value="${escapeHtml(room.roomType)}"></label>
      <label class="field"><span>可住人数 <b>*</b></span><input data-lodging-room-field="capacity" type="number" min="1" step="1" value="${room.capacity}"></label>
      <label class="field"><span>性别规则 <b>*</b></span><select data-lodging-room-field="genderRule">${['男','女','不限'].map((gender) => `<option ${gender === room.genderRule ? 'selected' : ''}>${gender}</option>`).join('')}</select></label>
    </div>
    <div class="lodging-room-allocations"><div class="section-heading"><div><p class="eyebrow">分房明细</p><small>只记录班级、角色、性别和人数，不记录姓名。</small></div><button class="button secondary compact" type="button" data-add-lodging-allocation>新增分房行</button></div><div class="lodging-allocation-list">${room.allocations.length ? room.allocations.map((allocation, allocationIndex) => lodgingAllocationMarkup(allocation, index, allocationIndex, summary, rooms)).join('') : '<div class="inline-empty">当前房间尚未安排人员</div>'}</div></div>
  </article>`;
}

function lodgingLocalState(summary, rooms) {
  const sources = lodgingSources(summary); const dates = lodgingNightsClient(summary.project); const expectedPerNight = sources.reduce((sum, row) => sum + row.peopleCount, 0); const errors = []; const warnings = [];
  const roomKeys = new Set(); let capacity = 0; let assigned = 0;
  rooms.forEach((room, index) => {
    capacity += Number(room.capacity || 0); const used = room.allocations.reduce((sum, row) => sum + Number(row.peopleCount || 0), 0); assigned += used;
    const label = room.roomNumber || `第 ${index + 1} 间房`; const key = `${room.checkInOn}|${room.lodgingName}|${room.roomNumber}`;
    if (!room.lodgingName || !room.checkInOn || !room.floorLabel || !room.roomNumber) errors.push(`${label} 缺少酒店、日期、楼层或房号`);
    if (roomKeys.has(key)) errors.push(`${label} 在同一酒店和日期重复`); roomKeys.add(key);
    if (!Number.isInteger(Number(room.capacity)) || Number(room.capacity) <= 0) errors.push(`${label}床位数无效`); if (used > room.capacity) errors.push(`${label}超员 ${used - room.capacity} 人`);
    const genders = new Set(room.allocations.map((row) => row.gender)); if (genders.size > 1 || [...genders].some((gender) => room.genderRule !== '不限' && room.genderRule !== gender)) errors.push(`${label}存在性别冲突`);
    const studentRows = room.allocations.filter((row) => row.role === '学生' && row.classId); if (new Set(studentRows.map((row) => row.classId)).size > 1) { if (studentRows.some((row) => !String(row.crossClassReason || '').trim())) errors.push(`${label}跨班拼房必须填写原因`); else warnings.push(`${label}为同性交叉班级合住`); }
  });
  dates.forEach((date) => {
    const dateRooms = rooms.filter((room) => room.checkInOn === date); if (!dateRooms.length) errors.push(`${date} 缺少房间资料`);
    const dateCapacity = dateRooms.reduce((sum, room) => sum + Number(room.capacity || 0), 0); if (dateCapacity < expectedPerNight) errors.push(`${date} 房间总容量不足，缺 ${expectedPerNight - dateCapacity} 个床位`);
    sources.forEach((source) => { const actual = dateRooms.flatMap((room) => room.allocations).filter((row) => row.role === source.role && row.gender === source.gender && (source.role !== '学生' || row.classId === source.classId)).reduce((sum, row) => sum + Number(row.peopleCount || 0), 0); if (actual !== source.peopleCount) errors.push(`${date} ${source.className ? `${source.className}班` : ''}${source.gender}${source.role}应安排 ${source.peopleCount} 人，当前 ${actual} 人`); });
  });
  return { sources, dates, expectedPerNight, expected: expectedPerNight * dates.length, rooms: rooms.length, capacity, assigned, emptyBeds: capacity - assigned, missing: Math.max(0, expectedPerNight * dates.length - assigned), errors, warnings };
}

function lodgingSourceMarkup(summary) {
  const sources = lodgingSources(summary); const grouped = new Map(); sources.forEach((row) => { const key = `${row.role}|${row.gender}|${row.source}|${row.href}`; const item = grouped.get(key) || { ...row, peopleCount: 0 }; item.peopleCount += row.peopleCount; grouped.set(key, item); });
  return [...grouped.values()].map((row) => `<tr><td>${escapeHtml(row.role)}</td><td>${escapeHtml(row.gender)}</td><td>${row.peopleCount}</td><td>${escapeHtml(row.source)}</td><td><a class="text-link compact-link" href="#${row.href}">去修改来源</a></td></tr>`).join('');
}

function lodgingNotApplicableMarkup(summary) {
  return `<article class="panel lodging-not-applicable"><span class="status-tag planned">不适用</span><h2>这个项目不需要住宿</h2><p>只有跨日并开启“需要住宿”的项目才显示分房编辑。当前没有创建住宿记录，也不会生成空住宿表。</p><a class="button secondary" href="#/projects/new?id=${encodeURIComponent(summary.project.id)}">返回项目资料</a></article>`;
}

function lodgingPageMarkup(summary, rooms, message = '', suggestionNote = '') {
  const totals = lodgingLocalState(summary, rooms); const exceptions = summary.exceptions.filter((row) => row.module === '住宿' && row.status === '待处理');
  return `<div class="lodging-workspace" data-project-id="${escapeHtml(summary.project.id)}"><article class="panel lodging-project-banner"><div><p class="eyebrow">当前住宿项目</p><h2>${escapeHtml(summary.project.school_name)} · ${escapeHtml(summary.project.grade)} · ${escapeHtml(summary.project.destination)}</h2><p>${formatProjectDate(summary.project.starts_on)}—${formatProjectDate(summary.project.ends_on)}；每晚应住宿 ${totals.expectedPerNight} 人，男 ${totals.sources.filter((row) => row.gender === '男').reduce((sum, row) => sum + row.peopleCount, 0)} / 女 ${totals.sources.filter((row) => row.gender === '女').reduce((sum, row) => sum + row.peopleCount, 0)}。</p></div><div class="lodging-banner-actions"><a class="button secondary compact" href="#/imports?target=lodging&project=${encodeURIComponent(summary.project.id)}">导入房间表</a><a class="button secondary compact" href="#/projects/people?project=${encodeURIComponent(summary.project.id)}">核对 P05</a></div></article>
    <section class="metric-grid lodging-metrics">${[['房间', totals.rooms, `${totals.dates.length} 晚`], ['总容量', totals.capacity, `应安排 ${totals.expected}`], ['已安排', totals.assigned, totals.missing ? `仍缺 ${totals.missing}` : '人数已覆盖'], ['空床', Math.max(0, totals.emptyBeds), totals.emptyBeds < 0 ? `超出 ${Math.abs(totals.emptyBeds)}` : '允许大于 0']].map(([label,value,note], index) => `<article class="metric ${totals.missing && index === 2 ? 'danger-metric' : ''}"><span>${label}</span><strong data-lodging-metric="${index}">${value}</strong><small data-lodging-note="${index}">${note}</small></article>`).join('')}</section>
    <article class="panel lodging-source-panel"><div class="section-heading"><div><p class="eyebrow">只读人数来源</p><h2>P05 / P07 / P08 统一住宿基线</h2><small>P09 不能修改这些人数，也不保存人员姓名。</small></div><span>每晚 ${totals.expectedPerNight} 人</span></div><div class="staff-table-wrap"><table><thead><tr><th>角色</th><th>性别</th><th>人数</th><th>来源</th><th>回改</th></tr></thead><tbody>${lodgingSourceMarkup(summary)}</tbody></table></div></article>
    <article class="panel lodging-toolbar"><div><p class="eyebrow">分房工具</p><h2>先维护房源，再生成建议</h2><p>建议按性别、班级和房号顺序安排；跨班房会保留双方人数和原因，建议只加载到编辑区。</p></div><div class="lodging-toolbar-actions"><button class="button secondary" id="add-lodging-room" type="button">新增房间</button><button class="button secondary" id="clear-lodging-suggestion" type="button" ${lodgingWorkspace?.suggestionLoaded ? '' : 'disabled'}>清空未保存建议</button><button class="button primary" id="suggest-lodging" type="button">生成分房建议</button></div></article>
    ${suggestionNote ? `<div class="lodging-suggestion-note" role="status">${escapeHtml(suggestionNote)}</div>` : ''}
    <form id="lodging-form"><div class="lodging-room-list">${rooms.length ? rooms.map((room, index) => lodgingRoomMarkup(room, index, summary, rooms)).join('') : '<article class="panel inline-empty lodging-empty">还没有房间。可先导入房间表，或手工新增房间。</article>'}</div><div class="people-save-bar lodging-save-bar"><div><p id="lodging-message" class="form-message ${message ? 'success-message' : ''}">${escapeHtml(message)}</p><p class="people-save-note">正式保存后才写入数据库并重算住宿异常；来源人数只能回到 P05、P07、P08 修改。</p></div><button class="button secondary" id="validate-lodging" type="button">校验当前编辑</button><button class="button primary" type="submit">保存住宿安排</button></div></form>
    ${exceptions.length ? `<article class="panel lodging-exceptions"><div class="section-heading"><div><p class="eyebrow">数据库中的住宿异常</p><h2>${exceptions.length} 项待核对</h2></div></div>${exceptions.map((row) => `<p class="${row.severity === '警告' ? 'warning-row' : ''}"><strong>${escapeHtml(row.severity)} · ${escapeHtml(row.code)}</strong>${escapeHtml(row.message)}</p>`).join('')}</article>` : ''}
  </div>`;
}

function updateLodgingLiveSummary() {
  if (!lodgingWorkspace) return; const totals = lodgingLocalState(lodgingWorkspace.summary, lodgingWorkspace.rooms); const metrics = root.querySelectorAll('[data-lodging-metric]'); const notes = root.querySelectorAll('[data-lodging-note]');
  if (metrics.length === 4) { [totals.rooms, totals.capacity, totals.assigned, Math.max(0, totals.emptyBeds)].forEach((value, index) => { metrics[index].textContent = value; }); notes[1].textContent = `应安排 ${totals.expected}`; notes[2].textContent = totals.missing ? `仍缺 ${totals.missing}` : '人数已覆盖'; notes[3].textContent = totals.emptyBeds < 0 ? `超出 ${Math.abs(totals.emptyBeds)}` : '允许大于 0'; metrics[2].closest('.metric').classList.toggle('danger-metric', Boolean(totals.missing)); }
}

function bindLodgingWorkspace() {
  const form = root.querySelector('#lodging-form'); if (!form || !lodgingWorkspace) return;
  root.querySelectorAll('[data-lodging-room-index]').forEach((node) => { node.dataset.sourceId = lodgingWorkspace.rooms[Number(node.dataset.lodgingRoomIndex)]?.id || ''; });
  focusExceptionSource('.lodging-project-banner');
  const render = (message = '', note = '') => { root.querySelector('#lodging-root').innerHTML = lodgingPageMarkup(lodgingWorkspace.summary, lodgingWorkspace.rooms, message, note); bindLodgingWorkspace(); };
  form.addEventListener('input', (event) => { const card = event.target.closest('[data-lodging-room-index]'); if (!card) return; const room = lodgingWorkspace.rooms[Number(card.dataset.lodgingRoomIndex)]; if (event.target.dataset.lodgingRoomField) { const field = event.target.dataset.lodgingRoomField; room[field] = event.target.type === 'number' ? Number(event.target.value) : event.target.value; } const rowNode = event.target.closest('[data-lodging-allocation-index]'); if (rowNode && event.target.dataset.lodgingAllocationField) { const row = room.allocations[Number(rowNode.dataset.lodgingAllocationIndex)]; const field = event.target.dataset.lodgingAllocationField; row[field] = event.target.type === 'number' ? Number(event.target.value) : event.target.value; } lodgingWorkspace.suggestionLoaded = false; updateLodgingLiveSummary(); });
  form.addEventListener('change', (event) => { const card = event.target.closest('[data-lodging-room-index]'); if (!card) return; const roomIndex = Number(card.dataset.lodgingRoomIndex); const room = lodgingWorkspace.rooms[roomIndex]; const rowNode = event.target.closest('[data-lodging-allocation-index]'); if (rowNode && event.target.dataset.lodgingAllocationField) { const row = room.allocations[Number(rowNode.dataset.lodgingAllocationIndex)]; const field = event.target.dataset.lodgingAllocationField; row[field] = event.target.type === 'number' ? Number(event.target.value) : event.target.value; if (field === 'role') { row.classId = row.role === '学生' ? lodgingWorkspace.summary.classes[0]?.id || '' : ''; row.crossClassReason = ''; render('', '分房行角色已修改；请重新校验。'); return; } } if (rowNode && event.target.matches('[data-move-lodging-allocation]') && event.target.value !== '') { const [row] = room.allocations.splice(Number(rowNode.dataset.lodgingAllocationIndex), 1); lodgingWorkspace.rooms[Number(event.target.value)].allocations.push(row); lodgingWorkspace.suggestionLoaded = false; render('', '分房行已移动；尚未保存到数据库。'); } });
  form.addEventListener('click', (event) => { const card = event.target.closest('[data-lodging-room-index]'); if (!card) return; const roomIndex = Number(card.dataset.lodgingRoomIndex); const room = lodgingWorkspace.rooms[roomIndex]; if (event.target.closest('[data-remove-lodging-room]')) { if (room.allocations.length) { root.querySelector('#lodging-message').textContent = '房间已有人员，请先移动或删除分房行。'; return; } lodgingWorkspace.rooms.splice(roomIndex, 1); render(); } if (event.target.closest('[data-add-lodging-allocation]')) { room.allocations.push({ classId: lodgingWorkspace.summary.classes[0]?.id || '', role: '学生', gender: room.genderRule === '女' ? '女' : '男', peopleCount: 1, crossClassReason: '' }); lodgingWorkspace.suggestionLoaded = false; render('', '已新增分房行；请核对班级、性别和人数。'); } const rowNode = event.target.closest('[data-lodging-allocation-index]'); if (rowNode && event.target.closest('[data-remove-lodging-allocation]')) { room.allocations.splice(Number(rowNode.dataset.lodgingAllocationIndex), 1); lodgingWorkspace.suggestionLoaded = false; render(); } });
  root.querySelector('#add-lodging-room').addEventListener('click', () => { const index = lodgingWorkspace.rooms.length; lodgingWorkspace.rooms.push({ lodgingName: lodgingWorkspace.rooms[0]?.lodgingName || '', checkInOn: lodgingNightsClient(lodgingWorkspace.summary.project)[0] || '', building: '', floorLabel: '1层', roomNumber: `${index + 1}`, roomType: '四人间', capacity: 4, genderRule: '不限', notes: '', allocations: [] }); lodgingWorkspace.suggestionLoaded = false; render('', '已新增房间；补全资料后可生成建议。'); });
  root.querySelector('#clear-lodging-suggestion').addEventListener('click', () => { lodgingWorkspace.rooms = structuredClone(lodgingWorkspace.savedRooms); lodgingWorkspace.suggestionLoaded = false; render('', '未保存的系统建议已清空，数据库中的原安排未改变。'); });
  root.querySelector('#validate-lodging').addEventListener('click', () => { const totals = lodgingLocalState(lodgingWorkspace.summary, lodgingWorkspace.rooms); const box = root.querySelector('#lodging-message'); box.className = `form-message ${totals.errors.length ? '' : 'success-message'}`; box.innerHTML = totals.errors.length ? totals.errors.slice(0, 10).map(escapeHtml).join('<br>') : `当前编辑校验通过：安排 ${totals.assigned}/${totals.expected} 人，空床 ${totals.emptyBeds}；${totals.warnings.length} 间跨班房需人工核对。`; });
  root.querySelector('#suggest-lodging').addEventListener('click', async (event) => { const button = event.currentTarget; button.disabled = true; try { const result = await api(`/api/projects/${encodeURIComponent(lodgingWorkspace.summary.project.id)}/lodging/suggest`, { method: 'POST', body: JSON.stringify({ rooms: lodgingWorkspace.rooms }) }); const currentRows = lodgingWorkspace.rooms.reduce((sum, room) => sum + room.allocations.length, 0); const proposedRows = result.rooms.reduce((sum, room) => sum + room.allocations.length, 0); if (currentRows && !confirm(`当前编辑有 ${currentRows} 条分房明细，建议将替换为 ${proposedRows} 条。数据库不会在确认前改变。是否加载建议？`)) return; lodgingWorkspace.rooms = result.rooms; lodgingWorkspace.suggestionLoaded = true; const note = result.unassigned.length ? `建议已加载，但仍有 ${result.totals.missingPeople} 人未安排，请补充对应性别房间。尚未保存。` : `建议已加载：${result.totals.assigned} 人、容量 ${result.totals.capacity}、空床 ${result.totals.emptyBeds}，跨班房 ${result.crossClassRooms.length} 间。尚未保存。`; render('', note); } catch (error) { root.querySelector('#lodging-message').textContent = error.details?.fields?.map((row) => row.message).join('；') || error.message; button.disabled = false; } });
  form.addEventListener('submit', async (event) => { event.preventDefault(); const button = form.querySelector('[type="submit"]'); button.disabled = true; button.textContent = '正在保存…'; try { const saved = await api(`/api/projects/${encodeURIComponent(lodgingWorkspace.summary.project.id)}/lodging`, { method: 'POST', body: JSON.stringify({ rooms: lodgingWorkspace.rooms }) }); lodgingWorkspace = { summary: saved, rooms: saved.lodging.map(toLodgingRoom), savedRooms: saved.lodging.map(toLodgingRoom), suggestionLoaded: false }; render('房间、分房明细和住宿异常已保存并重新计算。'); } catch (error) { const box = root.querySelector('#lodging-message'); box.className = 'form-message'; box.innerHTML = error.details?.fields?.map((row) => escapeHtml(row.message)).join('<br>') || escapeHtml(error.message); button.disabled = false; button.textContent = '保存住宿安排'; } });
}

async function bindLodgingPage() {
  const host = root.querySelector('#lodging-root'); const projectId = routeParams().get('project');
  try { if (!projectId) { const projects = await api('/api/projects'); host.innerHTML = lodgingPickerMarkup(projects); host.querySelector('#lodging-project-picker')?.addEventListener('submit', (event) => { event.preventDefault(); location.hash = `/projects/lodging?project=${encodeURIComponent(new FormData(event.currentTarget).get('project'))}`; }); return; } const summary = await api(`/api/projects/${encodeURIComponent(projectId)}`); if (!summary.project.needs_lodging || summary.project.starts_on === summary.project.ends_on) { host.innerHTML = lodgingNotApplicableMarkup(summary); return; } const rooms = summary.lodging.map(toLodgingRoom); lodgingWorkspace = { summary, rooms, savedRooms: structuredClone(rooms), suggestionLoaded: false }; host.innerHTML = lodgingPageMarkup(summary, rooms); bindLodgingWorkspace(); } catch (error) { host.innerHTML = `<article class="panel"><p class="form-error">${escapeHtml(error.message)}</p></article>`; }
}

let mealWorkspace = null;

function mealsContent() {
  return '<section id="meals-root" class="meals-page-root"><article class="panel"><p class="muted">正在读取餐次、餐桌与统一就餐人员来源…</p></article></section>';
}

function mealPickerMarkup(projects) {
  const applicable = projects.filter((project) => project.includes_meals);
  return `<article class="panel meal-project-picker"><h2>选择含餐项目</h2>${applicable.length ? `<form id="meal-project-picker"><label class="field"><span>含餐项目</span><select name="project" required><option value="">请选择</option>${applicable.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.school_name)} · ${escapeHtml(project.grade)} · ${project.meal_count} 餐</option>`).join('')}</select></label><button class="button primary" type="submit">进入 P10</button></form>` : '<div class="inline-empty">当前没有含餐的进行中项目</div>'}</article>`;
}

function mealNotApplicableMarkup(summary) {
  return `<article class="panel meal-not-applicable"><span class="status-tag planned">不适用</span><h2>这个项目不含餐</h2><p>当前没有创建用餐记录，也不会生成空用餐表。</p><a class="button secondary" href="#/projects/new?id=${encodeURIComponent(summary.project.id)}">返回项目资料</a></article>`;
}

function toMealSession(row, index) {
  return { id: row.id, name: row.name || '', restaurantName: row.restaurant_name || '', mealAt: String(row.meal_at || '').slice(0, 16), seatsPerTable: Number(row.seats_per_table || 10), tablePrefix: row.tables?.[0]?.table_number?.match(/^[^0-9]+/)?.[0] || String.fromCharCode(65 + index), notes: row.notes || '',
    overrides: (row.overrides || []).map((item) => ({ id: item.id, sourceType: item.source_type, sourceId: item.source_id, differenceCount: Number(item.difference_count), reason: item.reason || '' })),
    tables: (row.tables || []).map((table) => ({ id: table.id, tableNumber: table.table_number || '', notes: table.notes || '', allocations: (table.allocations || []).map((item) => ({ id: item.id, classId: item.class_id || '', role: item.role, peopleCount: Number(item.people_count), sharedTableReason: item.shared_table_reason || '' })) })) };
}

function mealSources(summary, session) {
  const overrides = new Map((session.overrides || []).map((row) => [`${row.sourceType}|${row.sourceId}`, row]));
  const rows = summary.classes.map((row) => ({ sourceType: 'class', sourceId: row.id, classId: row.id, label: `${row.name}班`, role: '学生', defaultCount: Number(row.student_total), source: 'P05 班级人数', href: `/projects/people?project=${summary.project.id}` }));
  summary.staff.forEach((row) => rows.push({ sourceType: row.source_type, sourceId: row.source_id, label: row.source_name || row.source_context || row.role, role: row.role, defaultCount: Number(row.default_meal_count || 0), source: row.role === '导游' ? 'P07 导游安排' : row.role === '司机' ? 'P08 车辆司机' : 'P05 人员汇总', href: row.role === '导游' ? `/projects/guides?project=${summary.project.id}` : row.role === '司机' ? `/projects/transport?project=${summary.project.id}` : `/projects/people?project=${summary.project.id}` }));
  return rows.map((row) => { const override = overrides.get(`${row.sourceType}|${row.sourceId}`); const differenceCount = Number(override?.differenceCount || 0); return { ...row, differenceCount, reason: override?.reason || '', peopleCount: row.defaultCount + differenceCount }; });
}

function mealClassOptions(summary, selected) {
  return `<option value="">请选择班级</option>${summary.classes.map((row) => `<option value="${escapeHtml(row.id)}" ${row.id === selected ? 'selected' : ''}>${escapeHtml(row.name)}班</option>`).join('')}`;
}

function mealAllocationMarkup(row, sessionIndex, tableIndex, allocationIndex, summary) {
  return `<div class="meal-allocation-row" data-meal-allocation-index="${allocationIndex}"><label class="field"><span>角色</span><select data-meal-allocation-field="role">${['学生','导游','老师','司机','摄影师','其他'].map((role) => `<option ${role === row.role ? 'selected' : ''}>${role}</option>`).join('')}</select></label>${row.role === '学生' ? `<label class="field"><span>班级</span><select data-meal-allocation-field="classId">${mealClassOptions(summary, row.classId)}</select></label>` : '<span class="allocation-spacer"></span>'}<label class="field"><span>人数</span><input data-meal-allocation-field="peopleCount" type="number" min="1" step="1" value="${Number(row.peopleCount || 0)}"></label><label class="field meal-sharing-field"><span>拼桌说明</span><input data-meal-allocation-field="sharedTableReason" value="${escapeHtml(row.sharedTableReason || '')}" placeholder="跨班拼桌时必填"></label><button class="text-button danger" type="button" data-remove-meal-allocation>删除</button></div>`;
}

function mealTableMarkup(table, sessionIndex, tableIndex, session, summary) {
  const allocated = table.allocations.reduce((sum, row) => sum + Number(row.peopleCount || 0), 0);
  return `<section class="meal-table" data-meal-table-index="${tableIndex}"><div class="meal-table-heading"><label class="field"><span>桌号</span><input data-meal-table-field="tableNumber" value="${escapeHtml(table.tableNumber)}"></label><div class="meal-table-capacity ${allocated > session.seatsPerTable ? 'invalid' : ''}"><strong>${allocated} / ${session.seatsPerTable}</strong><span>${allocated > session.seatsPerTable ? `超员 ${allocated - session.seatsPerTable}` : `余位 ${session.seatsPerTable - allocated}`}</span></div><button class="text-button danger" type="button" data-remove-meal-table>删除桌</button></div><div class="meal-allocation-list">${table.allocations.length ? table.allocations.map((row, allocationIndex) => mealAllocationMarkup(row, sessionIndex, tableIndex, allocationIndex, summary)).join('') : '<div class="inline-empty">本桌尚未安排人员</div>'}</div><button class="button secondary compact" type="button" data-add-meal-allocation>新增就座行</button></section>`;
}

function mealOverrideMarkup(session, sessionIndex, summary) {
  return mealSources(summary, session).map((row) => `<tr data-meal-source-type="${escapeHtml(row.sourceType)}" data-meal-source-id="${escapeHtml(row.sourceId)}"><td>${escapeHtml(row.role)}</td><td>${escapeHtml(row.label)}</td><td>${row.defaultCount}</td><td><input data-meal-override-difference type="number" step="1" min="${-row.defaultCount}" value="${row.differenceCount || 0}"></td><td><strong>${row.peopleCount}</strong></td><td><input data-meal-override-reason value="${escapeHtml(row.reason)}" placeholder="人数变化时必填"></td><td><a class="text-link compact-link" href="#${row.href}">${escapeHtml(row.source)}</a></td></tr>`).join('');
}

function mealSessionMarkup(session, sessionIndex, summary) {
  const sources = mealSources(summary, session); const basePeople = sources.filter((row) => ['学生','导游'].includes(row.role)).reduce((sum, row) => sum + row.peopleCount, 0); const totalPeople = sources.reduce((sum, row) => sum + row.peopleCount, 0); const allocated = session.tables.reduce((sum, table) => sum + table.allocations.reduce((n, row) => n + Number(row.peopleCount || 0), 0), 0); const capacity = session.tables.length * Number(session.seatsPerTable || 0);
  return `<article class="panel meal-session" data-meal-session-index="${sessionIndex}"><div class="meal-session-heading"><div><p class="eyebrow">餐次 ${sessionIndex + 1}</p><h2>${escapeHtml(session.name || '未命名餐次')}</h2></div><div class="meal-session-summary"><span>基础建议 <b>${Math.ceil(basePeople / Math.max(1, session.seatsPerTable))} 桌</b></span><span>已订 <b>${session.tables.length} 桌</b></span><span class="${allocated !== totalPeople || capacity < totalPeople ? 'invalid-text' : ''}">就座 <b>${allocated}/${totalPeople}</b></span></div><button class="text-button danger" type="button" data-remove-meal-session>删除餐次</button></div><div class="meal-session-fields"><label class="field"><span>餐次名称 <b>*</b></span><input data-meal-session-field="name" value="${escapeHtml(session.name)}"></label><label class="field"><span>餐厅名称 <b>*</b></span><input data-meal-session-field="restaurantName" value="${escapeHtml(session.restaurantName)}"></label><label class="field"><span>用餐时间 <b>*</b></span><input data-meal-session-field="mealAt" type="datetime-local" value="${escapeHtml(session.mealAt)}"></label><label class="field"><span>每桌人数 <b>*</b></span><input data-meal-session-field="seatsPerTable" type="number" min="1" step="1" value="${session.seatsPerTable}"></label><label class="field"><span>桌号前缀</span><input data-meal-session-field="tablePrefix" value="${escapeHtml(session.tablePrefix)}"></label></div><details class="meal-overrides"><summary>本餐参与差异 <span>${session.overrides.length ? `${session.overrides.length} 项` : '使用默认人数'}</span></summary><div class="staff-table-wrap"><table><thead><tr><th>角色</th><th>来源对象</th><th>默认</th><th>差异</th><th>本餐</th><th>原因</th><th>来源</th></tr></thead><tbody>${mealOverrideMarkup(session, sessionIndex, summary)}</tbody></table></div></details><div class="section-heading meal-tables-heading"><div><p class="eyebrow">桌号与就座</p><h3>${escapeHtml(session.restaurantName || '待填写餐厅')} · 容量 ${capacity} · 余位 ${capacity - allocated}</h3></div><button class="button secondary compact" type="button" data-add-meal-table>新增餐桌</button></div><div class="meal-table-grid">${session.tables.length ? session.tables.map((table, tableIndex) => mealTableMarkup(table, sessionIndex, tableIndex, session, summary)).join('') : '<div class="inline-empty meal-table-empty">尚未建立餐桌，可生成基础建议或手工新增。</div>'}</div></article>`;
}

function mealLocalState(summary, sessions) {
  const errors = []; const names = new Set(); let baseTables = 0; let bookedTables = 0; let allocated = 0; let expected = 0;
  if (sessions.length !== Number(summary.project.meal_count)) errors.push(`项目应有 ${summary.project.meal_count} 个餐次，当前 ${sessions.length} 个`);
  sessions.forEach((session, sessionIndex) => { const label = session.name || `第 ${sessionIndex + 1} 餐`; const sources = mealSources(summary, session); const total = sources.reduce((sum, row) => sum + row.peopleCount, 0); const base = sources.filter((row) => ['学生','导游'].includes(row.role)).reduce((sum, row) => sum + row.peopleCount, 0); const roleExpected = new Map(); sources.forEach((row) => roleExpected.set(row.role, (roleExpected.get(row.role) || 0) + row.peopleCount));
    if (!session.name || !session.restaurantName || !session.mealAt) errors.push(`${label}缺少名称、餐厅或用餐时间`); if (names.has(session.name)) errors.push(`餐次名称“${session.name}”重复`); names.add(session.name); const date = session.mealAt.slice(0, 10); if (date < summary.project.starts_on || date > summary.project.ends_on) errors.push(`${label}用餐时间不在项目日期范围内`); if (!Number.isInteger(Number(session.seatsPerTable)) || Number(session.seatsPerTable) <= 0) errors.push(`${label}每桌人数无效`);
    session.overrides.forEach((row) => { if (!row.reason.trim()) errors.push(`${label}的单餐人数差异必须填写原因`); }); const numbers = new Set(); const roleActual = new Map(); let sessionAllocated = 0;
    session.tables.forEach((table) => { if (!table.tableNumber) errors.push(`${label}存在空桌号`); if (numbers.has(table.tableNumber)) errors.push(`${label}桌号“${table.tableNumber}”重复`); numbers.add(table.tableNumber); const used = table.allocations.reduce((sum, row) => sum + Number(row.peopleCount || 0), 0); sessionAllocated += used; if (used > session.seatsPerTable) errors.push(`${label}${table.tableNumber}桌超员 ${used - session.seatsPerTable} 人`); const studentRows = table.allocations.filter((row) => row.role === '学生'); if (new Set(studentRows.map((row) => row.classId)).size > 1 && studentRows.some((row) => !row.sharedTableReason.trim())) errors.push(`${label}${table.tableNumber}桌跨班拼桌必须填写说明`); table.allocations.forEach((row) => roleActual.set(row.role, (roleActual.get(row.role) || 0) + Number(row.peopleCount || 0))); });
    roleExpected.forEach((count, role) => { if ((roleActual.get(role) || 0) !== count) errors.push(`${label}${role}应安排 ${count} 人，当前 ${roleActual.get(role) || 0} 人`); }); const capacity = session.tables.length * session.seatsPerTable; if (capacity < total) errors.push(`${label}容量不足 ${total - capacity} 人`); baseTables += Math.ceil(base / Math.max(1, session.seatsPerTable)); bookedTables += session.tables.length; allocated += sessionAllocated; expected += total;
  });
  return { errors: [...new Set(errors)], baseTables, bookedTables, allocated, expected };
}

function mealSourceSummaryMarkup(summary) {
  const grouped = new Map(); const session = { overrides: [] }; mealSources(summary, session).forEach((row) => { const item = grouped.get(row.role) || { role: row.role, count: 0, source: row.source, href: row.href }; item.count += row.defaultCount; grouped.set(row.role, item); });
  return [...grouped.values()].map((row) => `<tr><td>${escapeHtml(row.role)}</td><td>${row.count}</td><td>${escapeHtml(row.source)}</td><td><a class="text-link compact-link" href="#${row.href}">去修改来源</a></td></tr>`).join('');
}

function mealPageMarkup(summary, sessions, message = '', suggestionNote = '') {
  const totals = mealLocalState(summary, sessions); const exceptions = summary.exceptions.filter((row) => row.module === '用餐' && row.status === '待处理');
  return `<div class="meal-workspace" data-project-id="${escapeHtml(summary.project.id)}"><article class="panel meal-project-banner"><div><p class="eyebrow">当前含餐项目</p><h2>${escapeHtml(summary.project.school_name)} · ${escapeHtml(summary.project.grade)} · ${escapeHtml(summary.project.destination)}</h2><p>${formatProjectDate(summary.project.starts_on)}—${formatProjectDate(summary.project.ends_on)}；计划 ${summary.project.meal_count} 餐，默认每餐 ${mealSources(summary, { overrides: [] }).reduce((sum, row) => sum + row.defaultCount, 0)} 人。</p></div><div class="meal-banner-actions"><a class="button secondary compact" href="#/imports?target=meals&project=${encodeURIComponent(summary.project.id)}">导入用餐表</a><a class="button secondary compact" href="#/projects/people?project=${encodeURIComponent(summary.project.id)}">核对 P05</a></div></article><section class="metric-grid meal-metrics">${[['餐次',sessions.length,`计划 ${summary.project.meal_count}`],['基础建议桌数',totals.baseTables,'学生 + 导游'],['实际预订桌数',totals.bookedTables,totals.bookedTables < totals.baseTables ? '桌数不足' : '按餐厅独立'],['已就座',totals.allocated,`本餐口径合计 ${totals.expected}`]].map(([label,value,note], index) => `<article class="metric ${index === 3 && totals.allocated !== totals.expected ? 'danger-metric' : ''}"><span>${label}</span><strong data-meal-metric="${index}">${value}</strong><small data-meal-note="${index}">${note}</small></article>`).join('')}</section><article class="panel meal-source-panel"><div class="section-heading"><div><p class="eyebrow">默认就餐来源</p><h2>P05 / P07 / P08 统一基线</h2></div><span>单餐差异在对应餐次留原因</span></div><div class="staff-table-wrap"><table><thead><tr><th>角色</th><th>默认人数</th><th>来源</th><th>回改</th></tr></thead><tbody>${mealSourceSummaryMarkup(summary)}</tbody></table></div></article><article class="panel meal-toolbar"><div><p class="eyebrow">桌数建议</p><h2>基础桌与工作人员追加桌分开确认</h2></div><div class="meal-toolbar-actions"><button class="button secondary" id="add-meal-session" type="button">新增餐次</button><button class="button secondary" id="suggest-base-meals" type="button">生成基础建议</button><button class="button primary" id="suggest-final-meals" type="button">追加工作人员桌</button></div></article>${suggestionNote ? `<div class="meal-suggestion-note" role="status">${escapeHtml(suggestionNote)}</div>` : ''}<form id="meal-form"><div class="meal-session-list">${sessions.length ? sessions.map((session,index) => mealSessionMarkup(session,index,summary)).join('') : '<article class="panel inline-empty">尚未建立餐次。</article>'}</div><div class="people-save-bar meal-save-bar"><div><p id="meal-message" class="form-message ${message ? 'success-message' : ''}">${escapeHtml(message)}</p><p class="people-save-note">保存后写入数据库并重新计算桌数、角色人数与来源差异。</p></div><button class="button secondary" id="validate-meals" type="button">校验当前编辑</button><button class="button primary" type="submit">保存用餐安排</button></div></form>${exceptions.length ? `<article class="panel meal-exceptions"><div class="section-heading"><div><p class="eyebrow">数据库中的用餐异常</p><h2>${exceptions.length} 项待处理</h2></div></div>${exceptions.map((row) => `<p><strong>${escapeHtml(row.severity)} · ${escapeHtml(row.code)}</strong>${escapeHtml(row.message)}</p>`).join('')}</article>` : ''}</div>`;
}

function bindMealWorkspace() {
  const form = root.querySelector('#meal-form'); if (!form || !mealWorkspace) return;
  root.querySelectorAll('[data-meal-session-index]').forEach((node) => { node.dataset.sourceId = mealWorkspace.sessions[Number(node.dataset.mealSessionIndex)]?.id || ''; });
  focusExceptionSource('.meal-project-banner');
  const render = (message = '', note = '') => { root.querySelector('#meals-root').innerHTML = mealPageMarkup(mealWorkspace.summary, mealWorkspace.sessions, message, note); bindMealWorkspace(); };
  form.addEventListener('input', (event) => { const sessionNode = event.target.closest('[data-meal-session-index]'); if (!sessionNode) return; const session = mealWorkspace.sessions[Number(sessionNode.dataset.mealSessionIndex)]; if (event.target.dataset.mealSessionField) { const field = event.target.dataset.mealSessionField; session[field] = event.target.type === 'number' ? Number(event.target.value) : event.target.value; } const tableNode = event.target.closest('[data-meal-table-index]'); const table = tableNode ? session.tables[Number(tableNode.dataset.mealTableIndex)] : null; if (table && event.target.dataset.mealTableField) table[event.target.dataset.mealTableField] = event.target.value; const allocationNode = event.target.closest('[data-meal-allocation-index]'); if (table && allocationNode && event.target.dataset.mealAllocationField) { const row = table.allocations[Number(allocationNode.dataset.mealAllocationIndex)]; const field = event.target.dataset.mealAllocationField; row[field] = event.target.type === 'number' ? Number(event.target.value) : event.target.value; } const sourceNode = event.target.closest('[data-meal-source-type]'); if (sourceNode && (event.target.matches('[data-meal-override-difference]') || event.target.matches('[data-meal-override-reason]'))) { const sourceType = sourceNode.dataset.mealSourceType; const sourceId = sourceNode.dataset.mealSourceId; let row = session.overrides.find((item) => item.sourceType === sourceType && item.sourceId === sourceId); const difference = Number(sourceNode.querySelector('[data-meal-override-difference]').value || 0); const reason = sourceNode.querySelector('[data-meal-override-reason]').value; if (!difference) session.overrides = session.overrides.filter((item) => item !== row); else { if (!row) { row = { sourceType, sourceId, differenceCount: difference, reason }; session.overrides.push(row); } row.differenceCount = difference; row.reason = reason; } } mealWorkspace.suggestionLoaded = false; });
  form.addEventListener('change', (event) => { if (!event.target.matches('[data-meal-allocation-field="role"]')) return; const sessionNode = event.target.closest('[data-meal-session-index]'); const tableNode = event.target.closest('[data-meal-table-index]'); const allocationNode = event.target.closest('[data-meal-allocation-index]'); const row = mealWorkspace.sessions[Number(sessionNode.dataset.mealSessionIndex)].tables[Number(tableNode.dataset.mealTableIndex)].allocations[Number(allocationNode.dataset.mealAllocationIndex)]; row.classId = row.role === '学生' ? mealWorkspace.summary.classes[0]?.id || '' : ''; row.sharedTableReason = ''; render('', '就座角色已修改，请重新校验。'); });
  form.addEventListener('click', (event) => { const sessionNode = event.target.closest('[data-meal-session-index]'); if (!sessionNode) return; const sessionIndex = Number(sessionNode.dataset.mealSessionIndex); const session = mealWorkspace.sessions[sessionIndex]; if (event.target.closest('[data-remove-meal-session]')) { mealWorkspace.sessions.splice(sessionIndex,1); render(); return; } if (event.target.closest('[data-add-meal-table]')) { const number = session.tables.length + 1; session.tables.push({ tableNumber: `${session.tablePrefix || String.fromCharCode(65 + sessionIndex)}${String(number).padStart(2,'0')}`, notes: '', allocations: [] }); render('', '已新增餐桌，尚未保存。'); return; } const tableNode = event.target.closest('[data-meal-table-index]'); if (!tableNode) return; const tableIndex = Number(tableNode.dataset.mealTableIndex); const table = session.tables[tableIndex]; if (event.target.closest('[data-remove-meal-table]')) { if (table.allocations.length) { root.querySelector('#meal-message').textContent = '餐桌已有就座行，请先删除或调整人员。'; return; } session.tables.splice(tableIndex,1); render(); return; } if (event.target.closest('[data-add-meal-allocation]')) { table.allocations.push({ classId: mealWorkspace.summary.classes[0]?.id || '', role: '学生', peopleCount: 1, sharedTableReason: '' }); render('', '已新增就座行，请核对角色、班级和人数。'); return; } const allocationNode = event.target.closest('[data-meal-allocation-index]'); if (allocationNode && event.target.closest('[data-remove-meal-allocation]')) { table.allocations.splice(Number(allocationNode.dataset.mealAllocationIndex),1); render(); } });
  root.querySelector('#add-meal-session').addEventListener('click', () => { const index = mealWorkspace.sessions.length; const date = mealWorkspace.summary.project.starts_on; mealWorkspace.sessions.push({ name: `第 ${index + 1} 餐`, restaurantName: '', mealAt: `${date}T12:00`, seatsPerTable: 10, tablePrefix: String.fromCharCode(65 + index), notes: '', overrides: [], tables: [] }); render('', '已新增餐次，请补全餐厅和时间。'); });
  const loadSuggestion = async (includeStaff) => { const result = await api(`/api/projects/${encodeURIComponent(mealWorkspace.summary.project.id)}/meals/suggest`, { method: 'POST', body: JSON.stringify({ sessions: mealWorkspace.sessions, includeStaff }) }); const currentRows = mealWorkspace.sessions.reduce((sum, session) => sum + session.tables.reduce((n, table) => n + table.allocations.length, 0), 0); if (currentRows && !confirm(`当前编辑有 ${currentRows} 条就座明细，建议会替换这些明细，但不会立即写数据库。是否继续？`)) return; mealWorkspace.sessions = result.sessions; mealWorkspace.suggestionLoaded = true; const first = result.sessions[0]?.suggestion; render('', includeStaff ? `已显式追加工作人员桌：每餐最终需要 ${first?.finalRequiredTables || 0} 桌，已安排 ${first?.allocated || 0} 人。尚未保存。` : `基础建议已加载：学生与导游 ${first?.basePeople || 0} 人，共 ${first?.baseSuggestedTables || 0} 桌；工作人员 ${first?.staffPeople || 0} 人尚待追加。`); };
  root.querySelector('#suggest-base-meals').addEventListener('click', async () => { try { await loadSuggestion(false); } catch (error) { root.querySelector('#meal-message').innerHTML = error.details?.fields?.map((row) => escapeHtml(row.message)).join('<br>') || escapeHtml(error.message); } });
  root.querySelector('#suggest-final-meals').addEventListener('click', async () => { try { await loadSuggestion(true); } catch (error) { root.querySelector('#meal-message').innerHTML = error.details?.fields?.map((row) => escapeHtml(row.message)).join('<br>') || escapeHtml(error.message); } });
  root.querySelector('#validate-meals').addEventListener('click', () => { const result = mealLocalState(mealWorkspace.summary, mealWorkspace.sessions); const box = root.querySelector('#meal-message'); box.className = `form-message ${result.errors.length ? '' : 'success-message'}`; box.innerHTML = result.errors.length ? result.errors.slice(0,12).map(escapeHtml).join('<br>') : `当前编辑校验通过：${mealWorkspace.sessions.length} 餐，${result.bookedTables} 桌，安排 ${result.allocated}/${result.expected} 人。`; });
  form.addEventListener('submit', async (event) => { event.preventDefault(); const button = form.querySelector('[type="submit"]'); button.disabled = true; button.textContent = '正在保存…'; try { const saved = await api(`/api/projects/${encodeURIComponent(mealWorkspace.summary.project.id)}/meals`, { method: 'POST', body: JSON.stringify({ sessions: mealWorkspace.sessions }) }); const sessions = saved.meals.map(toMealSession); mealWorkspace = { summary: saved, sessions, savedSessions: structuredClone(sessions), suggestionLoaded: false }; render('餐次、桌号、就座明细与单餐差异已保存并重新计算。'); } catch (error) { const box = root.querySelector('#meal-message'); box.innerHTML = error.details?.fields?.map((row) => escapeHtml(row.message)).join('<br>') || escapeHtml(error.message); button.disabled = false; button.textContent = '保存用餐安排'; } });
}

async function bindMealsPage() {
  const host = root.querySelector('#meals-root'); const projectId = routeParams().get('project');
  try { if (!projectId) { const projects = await api('/api/projects'); host.innerHTML = mealPickerMarkup(projects); host.querySelector('#meal-project-picker')?.addEventListener('submit', (event) => { event.preventDefault(); location.hash = `/projects/meals?project=${encodeURIComponent(new FormData(event.currentTarget).get('project'))}`; }); return; } const summary = await api(`/api/projects/${encodeURIComponent(projectId)}`); if (!summary.project.includes_meals) { host.innerHTML = mealNotApplicableMarkup(summary); return; } const sessions = summary.meals.map(toMealSession); mealWorkspace = { summary, sessions, savedSessions: structuredClone(sessions), suggestionLoaded: false }; host.innerHTML = mealPageMarkup(summary, sessions); bindMealWorkspace(); } catch (error) { host.innerHTML = `<article class="panel"><p class="form-error">${escapeHtml(error.message)}</p></article>`; }
}

function exceptionsContent() {
  return `<section id="exceptions-root" class="exceptions-page-root">
    <section class="metric-grid exception-metrics" aria-label="异常指标">
      ${[['待处理阻断','exception-blockers','必须修正源数据'],['待处理警告','exception-warnings','可确认例外'],['待处理提醒','exception-reminders','可确认例外'],['已解决','exception-resolved','保留追查记录']].map(([label,id,note]) => `<article class="metric"><span>${label}</span><strong id="${id}">—</strong><small>${note}</small></article>`).join('')}
    </section>
    <section class="panel exception-controls">
      <form id="exception-filter" class="exception-filter-grid">
        <label class="field"><span>项目</span><select name="projectId"><option value="">全部项目</option></select></label>
        <label class="field"><span>模块</span><select name="module"><option value="">全部模块</option>${['项目','人员','导游','乘车','住宿','用餐','导出','证件'].map((value) => `<option>${value}</option>`).join('')}</select></label>
        <label class="field"><span>等级</span><select name="severity"><option value="">全部等级</option>${['阻断','警告','提醒'].map((value) => `<option>${value}</option>`).join('')}</select></label>
        <label class="field"><span>状态</span><select name="status"><option value="">全部状态</option>${['待处理','已确认例外','已解决'].map((value) => `<option>${value}</option>`).join('')}</select></label>
        <div class="filter-actions"><button class="button secondary" type="reset">重置</button><button class="button primary" type="submit">筛选</button></div>
      </form>
      <div class="exception-project-actions">
        <p id="exception-action-message" class="form-message" role="status"></p>
        <button class="button secondary" id="recalculate-project" type="button" disabled>重新校验项目</button>
        <button class="button primary" id="complete-project" type="button" disabled>推进为已完成安排</button>
      </div>
    </section>
    <section class="panel exception-list-panel">
      <div class="section-heading"><div><p class="eyebrow">统一校验结果</p><h2>异常记录</h2></div><span id="exception-result-count">正在读取…</span></div>
      <div id="exception-list" class="exception-list"><div class="list-loading"><div class="skeleton line-skeleton"></div><div class="skeleton line-skeleton"></div></div></div>
    </section>
    <dialog id="exception-confirm-dialog" class="exception-dialog">
      <form id="exception-confirm-form" method="dialog">
        <p class="eyebrow">确认非阻断例外</p><h2>填写处理原因</h2>
        <p id="exception-confirm-summary" class="muted"></p>
        <label class="field"><span>处理原因 <b>*</b></span><textarea name="reason" rows="4" maxlength="300" required></textarea></label>
        <p id="exception-confirm-error" class="form-error" role="alert"></p>
        <div class="dialog-actions"><button class="button secondary" value="cancel" type="button" data-close-exception-dialog>取消</button><button class="button primary" type="submit">确认例外</button></div>
      </form>
    </dialog>
  </section>`;
}

function exceptionSeverityClass(value) {
  return value === '阻断' ? 'blocker' : value === '警告' ? 'warning' : 'reminder';
}

function exceptionRowsMarkup(items) {
  if (!items.length) return '<div class="empty-list"><h3>没有符合条件的异常</h3><p>调整筛选条件，或选择项目重新校验。</p></div>';
  return `<div class="exception-table-wrap"><table class="exception-table"><thead><tr><th>项目 / 模块</th><th>等级与状态</th><th>异常说明</th><th>校验时间</th><th>操作</th></tr></thead><tbody>${items.map((row) => `<tr data-exception-id="${escapeHtml(row.id)}">
    <td><strong>${escapeHtml(row.school_name)} · ${escapeHtml(row.grade)}</strong><small>${escapeHtml(row.module)} · ${escapeHtml(row.source_type)} · ${escapeHtml(row.source_id)}</small></td>
    <td><span class="exception-level ${exceptionSeverityClass(row.severity)}">${escapeHtml(row.severity)}</span><span class="exception-status">${escapeHtml(row.status)}</span></td>
    <td><strong>${escapeHtml(row.code)}</strong><p>${escapeHtml(row.message)}</p>${row.exception_reason ? `<small class="exception-reason">例外原因：${escapeHtml(row.exception_reason)}</small>` : ''}${row.resolved_at ? `<small>解决于 ${escapeHtml(formatProjectTime(row.resolved_at))}</small>` : ''}</td>
    <td><span>${escapeHtml(formatProjectTime(row.created_at))}</span><small>最近 ${escapeHtml(formatProjectTime(row.updated_at))}</small></td>
    <td><div class="exception-row-actions"><a class="button secondary compact" href="#${escapeHtml(row.action_path)}">去处理</a>${row.status === '待处理' && row.severity !== '阻断' ? `<button class="text-button" type="button" data-confirm-exception="${escapeHtml(row.id)}" data-exception-message="${escapeHtml(row.message)}">确认例外</button>` : ''}</div></td>
  </tr>`).join('')}</tbody></table></div>`;
}

async function bindExceptionsPage() {
  const host = root.querySelector('#exceptions-root'); const form = host.querySelector('#exception-filter'); const message = host.querySelector('#exception-action-message');
  const projectSelect = form.elements.projectId; const query = routeParams();
  const setMessage = (value, success = false) => { message.textContent = value; message.className = `form-message ${success ? 'success-message' : ''}`; };
  const updateProjectActions = () => { const disabled = !projectSelect.value; host.querySelector('#recalculate-project').disabled = disabled; host.querySelector('#complete-project').disabled = disabled; };
  const load = async () => {
    const params = new URLSearchParams(); const data = new FormData(form);
    for (const key of ['projectId','module','severity','status']) if (data.get(key)) params.set(key, data.get(key));
    const list = host.querySelector('#exception-list'); list.setAttribute('aria-busy', 'true');
    try {
      const result = await api(`/api/exceptions?${params}`);
      host.querySelector('#exception-blockers').textContent = result.stats.blockers;
      host.querySelector('#exception-warnings').textContent = result.stats.warnings;
      host.querySelector('#exception-reminders').textContent = result.stats.reminders;
      host.querySelector('#exception-resolved').textContent = result.stats.resolved;
      host.querySelector('#exception-result-count').textContent = `${result.items.length} 条记录`;
      list.innerHTML = exceptionRowsMarkup(result.items); list.removeAttribute('aria-busy');
    } catch (error) { list.innerHTML = `<div class="empty-list error-state"><h3>异常读取失败</h3><p>${escapeHtml(error.message)}</p></div>`; list.removeAttribute('aria-busy'); }
  };
  try {
    const projects = await api('/api/projects?includeEnded=true');
    projectSelect.insertAdjacentHTML('beforeend', projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.school_name)} · ${escapeHtml(project.grade)} · ${escapeHtml(project.starts_on)}</option>`).join(''));
    projectSelect.value = query.get('project') || '';
    form.elements.module.value = query.get('module') || '';
    form.elements.severity.value = query.get('severity') || '';
    form.elements.status.value = query.has('status') ? query.get('status') : '待处理';
  } catch (error) { setMessage(error.message); }
  updateProjectActions(); await load();
  form.addEventListener('submit', (event) => { event.preventDefault(); setMessage(''); load(); });
  form.addEventListener('reset', () => queueMicrotask(() => { updateProjectActions(); setMessage(''); load(); }));
  projectSelect.addEventListener('change', updateProjectActions);
  host.querySelector('#recalculate-project').addEventListener('click', async (event) => { const button = event.currentTarget; button.disabled = true; setMessage('正在重新校验…'); try { const summary = await api(`/api/projects/${encodeURIComponent(projectSelect.value)}/recalculate`, { method: 'POST', body: '{}' }); setMessage(`重新校验完成：${summary.exceptions.filter((row) => row.status === '待处理' && row.severity === '阻断').length} 个阻断。`, true); await load(); } catch (error) { setMessage(error.message); } finally { button.disabled = false; } });
  host.querySelector('#complete-project').addEventListener('click', async (event) => { if (!confirm('系统将先执行全项目重算；只有没有阻断异常时才会推进。确认继续？')) return; const button = event.currentTarget; button.disabled = true; setMessage('正在执行完成门禁…'); try { const summary = await api(`/api/projects/${encodeURIComponent(projectSelect.value)}/complete`, { method: 'POST', body: '{}' }); setMessage(`项目已推进为“${summary.project.status}”。`, true); await load(); } catch (error) { setMessage(error.message); await load(); } finally { button.disabled = false; } });
  const dialog = host.querySelector('#exception-confirm-dialog'); const confirmForm = host.querySelector('#exception-confirm-form');
  host.querySelector('#exception-list').addEventListener('click', (event) => { const button = event.target.closest('[data-confirm-exception]'); if (!button) return; confirmForm.dataset.exceptionId = button.dataset.confirmException; confirmForm.elements.reason.value = ''; host.querySelector('#exception-confirm-summary').textContent = button.dataset.exceptionMessage; host.querySelector('#exception-confirm-error').textContent = ''; dialog.showModal(); });
  host.querySelector('[data-close-exception-dialog]').addEventListener('click', () => dialog.close());
  confirmForm.addEventListener('submit', async (event) => { event.preventDefault(); const button = confirmForm.querySelector('[type=submit]'); button.disabled = true; try { await api(`/api/exceptions/${encodeURIComponent(confirmForm.dataset.exceptionId)}/confirm`, { method: 'POST', body: JSON.stringify({ reason: confirmForm.elements.reason.value }) }); dialog.close(); setMessage('例外已确认并保留原因记录。', true); await load(); } catch (error) { host.querySelector('#exception-confirm-error').textContent = error.message; } finally { button.disabled = false; } });
}

function tablesContent() {
  return '<section id="table-center-root" class="table-center-root"><article class="panel"><div class="list-loading"><div class="skeleton title-skeleton"></div><div class="skeleton line-skeleton"></div></div></article></section>';
}

const tableStatusLabel = { ready: '可预览', blocked: '被阻断' };

function tableIssueMarkup(issue) {
  return `<a class="table-issue" href="#${escapeHtml(issue.actionPath)}"><span>${escapeHtml(issue.module)}</span><strong>${escapeHtml(issue.message)}</strong><small>${escapeHtml(issue.code)} · 去处理 →</small></a>`;
}

function tableCenterRowMarkup(row, projectId) {
  const latest = row.latestExport ? `${row.latestExport.status} · ${formatProjectTime(row.latestExport.createdAt)}` : '尚无导出记录';
  return `<article class="table-center-row ${row.status}" data-table-type="${escapeHtml(row.type)}"><div class="table-row-main"><div><h3>${escapeHtml(row.label)}</h3><p>数据版本 ${row.dataVersion} · ${row.rowCount} 行预览数据</p></div><span class="table-state">${tableStatusLabel[row.status]}</span></div><div class="table-row-meta"><span>源数据更新 ${formatProjectTime(row.sourceUpdatedAt)}</span><span>最近导出 ${escapeHtml(latest)}</span></div>${row.issues.length ? `<div class="table-issue-list">${row.issues.slice(0, 3).map(tableIssueMarkup).join('')}${row.issues.length > 3 ? `<a class="text-link inline" href="#/exceptions?project=${encodeURIComponent(projectId)}&status=待处理">另有 ${row.issues.length - 3} 项问题</a>` : ''}</div>` : '<p class="table-ready-note">字段、业务数据与统一阻断检查均已通过。</p>'}<div class="table-row-actions">${row.canPreview ? `<a class="button primary compact" href="#/tables/preview?project=${encodeURIComponent(projectId)}&type=${encodeURIComponent(row.type)}">预览</a>` : `<a class="button secondary compact" href="#${escapeHtml(row.issues[0]?.actionPath || `/exceptions?project=${encodeURIComponent(projectId)}`)}">查看问题</a>`}<a class="text-link inline" href="#/records?project=${encodeURIComponent(projectId)}&type=${encodeURIComponent(row.type)}">历史导出</a></div></article>`;
}

function tableCenterMarkup(data, projects, message = '') {
  return `<div class="table-center-workspace" data-project-id="${escapeHtml(data.project.id)}"><article class="panel table-project-bar"><div><p class="eyebrow">当前项目</p><h2>${escapeHtml(data.project.school_name)} · ${escapeHtml(data.project.grade)}</h2><p>${escapeHtml(data.project.destination)} · ${formatProjectDate(data.project.starts_on)}${data.project.ends_on !== data.project.starts_on ? `—${formatProjectDate(data.project.ends_on)}` : ''} · 数据版本 ${data.dataVersion}</p></div><form id="table-project-switch"><label><span>切换项目</span><select name="project">${projects.map((row) => `<option value="${escapeHtml(row.id)}" ${row.id === data.project.id ? 'selected' : ''}>${escapeHtml(row.school_name)} · ${escapeHtml(row.grade)} · ${escapeHtml(row.starts_on)}</option>`).join('')}</select></label><button class="button secondary compact">打开</button></form></article>
  ${message ? `<div class="table-check-message" role="status">${escapeHtml(message)}</div>` : ''}
  <section class="metric-grid table-center-metrics">${[['ready','可预览',data.stats.ready,'检查通过'],['blocked','被阻断',data.stats.blocked,'需修改源数据'],['stale','过期导出',data.stats.staleExports,'旧版本记录'],['current','当前导出',data.stats.currentExports,'与数据版本一致']].map(([id,label,value,note]) => `<article class="metric" data-table-metric="${id}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('')}</section>
  <section class="table-center-layout"><article class="panel table-list-panel"><div class="section-heading"><div><p class="eyebrow">项目输出表</p><h2>按项目条件显示适用表格</h2></div><span>${data.tables.length} 类</span></div><div class="table-center-list">${data.tables.map((row) => tableCenterRowMarkup(row, data.project.id)).join('')}</div></article><aside class="panel table-check-panel"><p class="eyebrow">导出前检查</p><h2>${data.stats.blocked ? `${data.stats.blocked} 类表格被阻断` : '当前适用表格可预览'}</h2><p>统一检查项目字段、人员覆盖、乘车、条件住宿和用餐数据。检查只更新异常状态，不创建文件。</p><button class="button primary" id="run-table-check" type="button">运行导出前检查</button><a class="button secondary" href="#/exceptions?project=${encodeURIComponent(data.project.id)}&status=待处理">查看项目异常</a></aside></section></div>`;
}

async function bindTableCenterPage() {
  const host = root.querySelector('#table-center-root'); const projectId = routeParams().get('project');
  try {
    const projects = await api('/api/projects');
    if (!projectId) {
      host.innerHTML = `<article class="panel table-project-picker"><h2>选择要检查的项目</h2>${projects.length ? `<form id="table-project-picker"><label class="field"><span>项目</span><select name="project">${projects.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.school_name)} · ${escapeHtml(row.grade)} · ${escapeHtml(row.starts_on)}</option>`).join('')}</select></label><button class="button primary">进入表格中心</button></form>` : '<div class="dashboard-empty"><p>还没有项目。</p><a class="button primary" href="#/projects/new">新建项目</a></div>'}</article>`;
      host.querySelector('#table-project-picker')?.addEventListener('submit', (event) => { event.preventDefault(); location.hash = `/tables?project=${encodeURIComponent(new FormData(event.currentTarget).get('project'))}`; }); return;
    }
    let data = await api(`/api/projects/${encodeURIComponent(projectId)}/tables`);
    const render = (message = '') => {
      host.innerHTML = tableCenterMarkup(data, projects, message);
      host.querySelector('#table-project-switch').addEventListener('submit', (event) => { event.preventDefault(); location.hash = `/tables?project=${encodeURIComponent(new FormData(event.currentTarget).get('project'))}`; });
      host.querySelector('#run-table-check').addEventListener('click', async (event) => { const button = event.currentTarget; button.disabled = true; try { data = await api(`/api/projects/${encodeURIComponent(projectId)}/tables/check`, { method: 'POST', body: '{}' }); render(`检查完成：${data.stats.ready} 类可预览，${data.stats.blocked} 类被阻断。`); } catch (error) { render(error.message); } });
    };
    render();
  } catch (error) { host.innerHTML = `<article class="panel empty-list error-state"><h3>表格中心读取失败</h3><p>${escapeHtml(error.message)}</p><a class="button secondary" href="#/projects">返回项目列表</a></article>`; }
}

function tablePreviewContent() {
  return '<section id="table-preview-root" class="table-preview-root"><article class="panel"><div class="list-loading"><div class="skeleton title-skeleton"></div><div class="skeleton line-skeleton"></div></div></article></section>';
}

function recordsContent() {
  return '<section id="records-root"><article class="panel"><div class="list-loading"><div class="skeleton title-skeleton"></div><div class="skeleton line-skeleton"></div><div class="skeleton line-skeleton"></div></div></article></section>';
}

const recordCategoryLabels = { import: '导入批次', export: '导出记录', operation: '操作记录' };
const recordResultClasses = { 成功: 'success', 部分成功: 'warning', 失败: 'danger', 已过期: 'warning', 已取消: 'muted-tag' };

function recordRowMarkup(row) {
  const details = [row.projectLabel, row.actorLabel].filter(Boolean).map(escapeHtml).join(' · ');
  const extra = row.category === 'export' && row.purpose ? `<span>用途：${escapeHtml(row.purpose)}</span>` : '';
  const failure = row.failureReason ? `<details class="record-failure"><summary>查看失败原因</summary><p>${escapeHtml(row.failureReason)}</p></details>` : '';
  return `<article class="record-row" data-record-id="${escapeHtml(row.id)}" data-record-category="${escapeHtml(row.category)}">
    <div class="record-row-main"><div class="record-kind"><span class="record-category ${escapeHtml(row.category)}">${escapeHtml(recordCategoryLabels[row.category])}</span><div><h3>${escapeHtml(row.operationType)} · ${escapeHtml(row.objectType)}</h3><p>${escapeHtml(row.summary || '未记录摘要')}</p></div></div><span class="status-tag ${recordResultClasses[row.result] || 'planned'}">${escapeHtml(row.result)}</span></div>
    <div class="record-row-meta"><span>${escapeHtml(formatProjectTime(row.occurredAt))}</span><span>${details}</span>${extra}<code>${escapeHtml(row.id)}</code></div>
    <div class="record-row-actions">${failure}<a class="text-link inline" href="${escapeHtml(row.sourcePath)}">查看源操作 →</a></div>
  </article>`;
}

function recordsWorkspaceMarkup(data, filters) {
  const option = (value, label = value, selected = '') => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  const projectOptions = data.options.projects.map((row) => option(row.id, row.label, filters.projectId)).join('');
  const page = data.pagination.page; const pages = data.pagination.totalPages;
  const rows = data.items.length ? data.items.map(recordRowMarkup).join('') : '<div class="empty-list"><h3>没有符合条件的记录</h3><p>可调整日期、项目、类型或结果筛选。</p></div>';
  return `<div class="records-workspace">
    <section class="metric-grid records-metrics">${[
      ['全部记录',data.summary.total,'当前日期与项目范围'],['导入批次',data.summary.imports,'逐批次追查'],['导出文件',data.summary.exports,'成功、失败与过期'],['失败',data.summary.failed,'可展开查看原因']
    ].map(([label,value,note], index) => `<article class="metric ${index === 3 && value ? 'danger-metric' : ''}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('')}</section>
    <section class="panel record-filter-panel"><div class="record-tabs" role="tablist" aria-label="记录分类">${[['','全部'],['operation','操作记录'],['import','导入批次'],['export','导出记录']].map(([value,label]) => `<button type="button" class="record-tab ${filters.category === value ? 'active' : ''}" data-record-category-filter="${value}">${label}</button>`).join('')}</div>
      <form id="record-filter" class="record-filter-grid">
        <label class="field"><span>开始日期</span><input type="date" name="from" value="${escapeHtml(filters.from)}"></label>
        <label class="field"><span>结束日期</span><input type="date" name="to" value="${escapeHtml(filters.to)}"></label>
        <label class="field"><span>项目</span><select name="projectId"><option value="">全部项目</option>${projectOptions}</select></label>
        <label class="field"><span>操作类型</span><select name="operationType"><option value="">全部操作</option>${data.options.operationTypes.map((value) => option(value,value,filters.operationType)).join('')}</select></label>
        <label class="field"><span>资料 / 对象类型</span><select name="objectType"><option value="">全部类型</option>${data.options.objectTypes.map((value) => option(value,value,filters.objectType)).join('')}</select></label>
        <label class="field"><span>结果</span><select name="result"><option value="">全部结果</option>${data.options.results.map((value) => option(value,value,filters.result)).join('')}</select></label>
        <input type="hidden" name="category" value="${escapeHtml(filters.category)}"><div class="record-filter-actions"><button class="button secondary" type="reset">重置</button><button class="button primary" type="submit">筛选</button></div>
      </form><p class="form-error" id="record-filter-error" role="alert"></p>
    </section>
    <section class="records-layout"><article class="panel record-list-panel"><div class="section-heading"><div><p class="eyebrow">只读追查</p><h2>记录明细</h2></div><span>${data.pagination.total} 条 · 第 ${page}/${pages} 页</span></div><div id="record-list" class="record-list">${rows}</div>
      <nav class="record-pagination" aria-label="记录分页"><button class="button secondary compact" type="button" data-record-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>每页 ${data.pagination.pageSize} 条</span><button class="button secondary compact" type="button" data-record-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>下一页</button></nav></article>
      <aside class="panel record-boundary"><p class="eyebrow">记录边界</p><h2>用于追溯操作事实</h2><dl><div><dt>记录操作者</dt><dd>本机负责人</dd></div><div><dt>完整证件值</dt><dd>不记录、不返回</dd></div><div><dt>本机文件路径</dt><dd>不展示</dd></div><div><dt>编辑与删除</dt><dd>普通页面不提供</dd></div></dl></aside>
    </section>
  </div>`;
}

function recordRouteFilters() {
  const query = routeParams(); const tableTypes = { insurance: '保险名单', transport: '乘车表', lodging: '住宿表', meals: '用餐表' };
  const linkedTable = tableTypes[query.get('type')] || '';
  return { category: query.get('category') || (linkedTable ? 'export' : ''), projectId: query.get('project') || query.get('projectId') || '',
    operationType: query.get('operationType') || '', objectType: query.get('objectType') || linkedTable, result: query.get('result') || '',
    from: query.get('from') || '', to: query.get('to') || '', page: Math.max(Number(query.get('page')) || 1, 1) };
}

function navigateRecords(filters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value && !(key === 'page' && Number(value) === 1)) query.set(key === 'projectId' ? 'project' : key, value);
  location.hash = `/records${query.size ? `?${query}` : ''}`;
}

async function bindRecordsPage() {
  const host = root.querySelector('#records-root'); const filters = recordRouteFilters();
  const query = new URLSearchParams({ ...filters, pageSize: 20 });
  try {
    const data = await api(`/api/records?${query}`); host.innerHTML = recordsWorkspaceMarkup(data, filters);
    const form = host.querySelector('#record-filter');
    form.addEventListener('submit', (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(form)); navigateRecords({ ...values, page: 1 }); });
    form.addEventListener('reset', (event) => { event.preventDefault(); location.hash = '/records'; });
    host.querySelectorAll('[data-record-category-filter]').forEach((button) => button.addEventListener('click', () => navigateRecords({ ...filters, category: button.dataset.recordCategoryFilter, objectType: '', page: 1 })));
    host.querySelectorAll('[data-record-page]').forEach((button) => button.addEventListener('click', () => navigateRecords({ ...filters, page: Number(button.dataset.recordPage) })));
    const refresh = root.querySelector('#refresh-records'); if (refresh) refresh.onclick = bindRecordsPage;
  } catch (error) { host.innerHTML = `<article class="panel empty-list error-state"><h3>记录读取失败</h3><p>${escapeHtml(error.message)}</p><button class="button secondary" id="retry-records">重新读取</button></article>`; host.querySelector('#retry-records')?.addEventListener('click', bindRecordsPage); }
}

function previewTotalsMarkup(snapshot) {
  if (snapshot.type === 'meals') return `<div class="preview-session-totals">${snapshot.totals.sessions.map((row, index) => `<article data-preview-session="${index}"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.restaurantName)}</span><small>人数 ${row.people} · 建议 ${row.suggestedTables} 桌 · 已订 ${row.bookedTables} 桌 · 容量 ${row.capacity} · 余位 ${row.remaining}</small></article>`).join('')}</div>`;
  const labels = snapshot.type === 'insurance' ? { guides: '最终导游' } : snapshot.type === 'transport' ? { vehicles: '车辆', students: '学生', teachers: '随车老师', guides: '导游', people: '总乘车', seats: '可用座位', emptySeats: '空车位' } : { people: '住宿人数', rooms: '房间', capacity: '总容量', remaining: '剩余容量' };
  return `<div class="preview-total-grid">${Object.entries(snapshot.totals).map(([key, value]) => `<article data-preview-total="${escapeHtml(key)}"><span>${escapeHtml(labels[key] || key)}</span><strong>${value}</strong></article>`).join('')}</div>`;
}

function previewTableMarkup(snapshot) {
  return `<div class="preview-data-wrap"><table class="preview-data-table"><thead><tr>${snapshot.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${snapshot.rows.map((row) => `<tr>${snapshot.columns.map((column) => `<td>${escapeHtml(row[column.key] === '' || row[column.key] === null || row[column.key] === undefined ? '—' : row[column.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function previewExportMarkup(snapshot) {
  const insuranceFields = snapshot.type === 'insurance' ? `<label class="field preview-purpose"><span>导出用途</span><input name="purpose" autocomplete="off" placeholder="例如：提交本项目保险投保" required minlength="2"></label><label class="preview-confirm"><input type="checkbox" name="confirmed" required><span>我确认本次文件将包含完整身份证号和导游证号，并按上述用途使用。</span></label>` : '';
  return `<article class="panel preview-export-panel"><div><p class="eyebrow">真实 Excel</p><h2>确认当前版本后生成文件</h2><p>系统会先写入临时文件，完成字段、合计和可读性回查后才登记成功。生成文件保存在受控导出目录，并通过本页面下载。</p></div><form id="table-export-form">${insuranceFields}<button class="button primary" type="submit">确认导出 Excel</button></form><div class="preview-export-result" id="preview-export-result" role="status" aria-live="polite"></div></article>`;
}

function tablePreviewMarkup(snapshot) {
  return `<div class="table-preview-workspace" data-project-id="${escapeHtml(snapshot.project.id)}" data-preview-type="${escapeHtml(snapshot.type)}" data-preview-version="${snapshot.dataVersion}"><div class="preview-stale-banner" id="preview-stale-banner" hidden><div><strong>预览已过期</strong><span>项目源数据已经变化，请刷新后再继续。</span></div><button class="button secondary compact" id="refresh-stale-preview" type="button">重新生成</button></div><article class="panel preview-project-bar"><div><p class="eyebrow">${escapeHtml(snapshot.label)}</p><h2>${escapeHtml(snapshot.project.school_name)} · ${escapeHtml(snapshot.project.grade)}</h2><p>预览版本 ${snapshot.dataVersion} · 生成于 ${formatProjectTime(snapshot.generatedAt)} · <span id="preview-version-state">当前版本</span></p></div><div><a class="button secondary" href="#/tables?project=${encodeURIComponent(snapshot.project.id)}">返回表格中心</a><button class="button primary" id="refresh-table-preview" type="button">刷新预览</button></div></article>
  <section class="panel preview-summary"><div class="section-heading"><div><p class="eyebrow">关键合计</p><h2>与业务来源实时投影</h2></div><span>${snapshot.rows.length} 行</span></div>${previewTotalsMarkup(snapshot)}</section>
  ${snapshot.type === 'insurance' ? '<div class="notice warning preview-sensitive-note"><strong>保险预览已脱敏</strong><span>当前页面不返回完整身份证号和导游证号；导出时必须二次确认用途。</span></div>' : ''}
  <article class="panel preview-table-panel"><div class="section-heading"><div><p class="eyebrow">字段预览</p><h2>${escapeHtml(snapshot.label)}</h2></div><span>只读</span></div>${previewTableMarkup(snapshot)}</article>${previewExportMarkup(snapshot)}</div>`;
}

function blockedPreviewMarkup(error, projectId) {
  const issues = error.details?.issues || [];
  return `<article class="panel preview-blocked"><span class="status-tag warning">被阻断</span><h2>${escapeHtml(error.message)}</h2><p>请先修改源数据并重新运行导出前检查。</p>${issues.length ? `<div class="table-issue-list">${issues.slice(0, 6).map(tableIssueMarkup).join('')}</div>` : ''}<a class="button secondary" href="#/tables?project=${encodeURIComponent(projectId)}">返回表格中心</a></article>`;
}

async function bindTablePreviewPage() {
  const host = root.querySelector('#table-preview-root'); const projectId = routeParams().get('project'); const type = routeParams().get('type'); let timer;
  if (!projectId || !['insurance','transport','lodging','meals'].includes(type)) { host.innerHTML = '<article class="panel empty-list"><h3>缺少项目或表格类型</h3><a class="button secondary" href="#/tables">返回表格中心</a></article>'; return; }
  const load = async () => {
    if (timer) clearInterval(timer);
    try {
      const snapshot = await api(`/api/projects/${encodeURIComponent(projectId)}/table-previews/${encodeURIComponent(type)}`, { method: 'POST', body: '{}' });
      host.innerHTML = tablePreviewMarkup(snapshot);
      const markStale = () => { const banner = host.querySelector('#preview-stale-banner'); if (!banner) return; banner.hidden = false; host.querySelector('#preview-version-state').textContent = '已过期'; host.querySelector('.table-preview-workspace').classList.add('is-stale'); const button = host.querySelector('#table-export-form button'); if (button) button.disabled = true; };
      const checkVersion = async () => { if (!host.isConnected || routePath() !== '/tables/preview') { clearInterval(timer); return; } try { const status = await api(`/api/projects/${encodeURIComponent(projectId)}/table-previews/${encodeURIComponent(type)}/status?version=${snapshot.dataVersion}`); if (status.stale) { markStale(); clearInterval(timer); } } catch { clearInterval(timer); } };
      host.querySelector('#refresh-table-preview').addEventListener('click', load); host.querySelector('#refresh-stale-preview').addEventListener('click', load);
      host.querySelector('#table-export-form').addEventListener('submit', async (event) => {
        event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); const resultHost = host.querySelector('#preview-export-result');
        const values = new FormData(form); button.disabled = true; resultHost.className = 'preview-export-result pending'; resultHost.textContent = '正在生成并回读验证 Excel…';
        try {
          const result = await api(`/api/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(type)}`, { method: 'POST', body: JSON.stringify({ previewVersion: snapshot.dataVersion, purpose: values.get('purpose') || '', confirmed: values.get('confirmed') === 'on' }) });
          resultHost.className = 'preview-export-result success'; resultHost.innerHTML = `<div><strong>Excel 已生成并验证</strong><span>${escapeHtml(result.filename)} · ${Math.max(1, Math.ceil(result.sizeBytes / 1024))} KB · SHA-256 ${escapeHtml(result.sha256.slice(0, 12))}…</span></div><a class="button secondary compact" href="${escapeHtml(result.downloadUrl)}" download>下载文件</a>`;
        } catch (error) {
          resultHost.className = 'preview-export-result error'; resultHost.textContent = error.message; button.disabled = false;
        }
      });
      timer = setInterval(checkVersion, 1000);
    } catch (error) { host.innerHTML = blockedPreviewMarkup(error, projectId); }
  };
  await load();
}

function scaffoldContent(page) {
  return `
    <section class="panel stage-panel">
      <div class="stage-copy">
        <span class="status-tag planned">待接入业务数据</span>
        <h2>${escapeHtml(page.title)}的页面结构已经就位</h2>
        <p>${escapeHtml(page.description)}。当前阶段只完成负责人端骨架、路由和访问控制；该页的字段、保存、校验与跨模块联动将在对应任务验收后启用。</p>
      </div>
      <div class="rule-box"><strong>本页完成判定</strong><span>不是“能打开”就算完成；必须接入正式 API、保存成功、异常可定位，并通过对应端到端检查。</span></div>
    </section>
    <section class="panel directory-panel"><div class="section-heading"><div><p class="eyebrow">P01—P20 页面目录</p><h2>负责人单端功能范围</h2></div><span>${pages.length} 个页面</span></div><div class="page-list">${pages.map((item) => `<a href="#${item.path}" class="page-row ${item.id === page.id ? 'current' : ''}"><b>${item.id}</b><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description)}</small></span><em>${item.conditional ? '条件入口' : '进入'}</em></a>`).join('')}</div></section>`;
}

function renderApp() {
  const path = routePath();
  const page = findPage(path) || pages[0];
  root.innerHTML = `
    <div class="app-shell ${state.navExpanded ? 'nav-expanded' : ''}">
      <aside class="sidebar">
        <div class="logo"><strong>研学派团</strong><span>负责人工作台</span></div>
        <nav class="main-nav" aria-label="主要导航">${navMarkup(page)}</nav>
        <div class="sidebar-footer"><span>本机负责人</span><button id="logout" type="button">安全退出</button></div>
      </aside>
      <main class="workspace">
        ${state.development ? '<div class="dev-banner">开发环境：只允许模拟或脱敏数据</div>' : ''}
        <header class="page-header">
          <div><p class="breadcrumb">${page.id} / ${escapeHtml(navigationGroups.find((group) => group.pages.includes(page))?.label || '')}</p><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.description)}</p></div>
          <div class="header-actions">${page.id === 'P01' ? '<a class="button secondary" href="#/imports">导入资料</a><a class="button primary" href="#/projects/new">新建项目</a>' : page.id === 'P02' ? '<a class="button primary" href="#/projects/new">新建项目</a>' : page.id === 'P03' ? '<a class="button secondary" href="#/projects">返回项目列表</a>' : ['P06', 'P07', 'P08', 'P09', 'P10'].includes(page.id) ? '<a class="button secondary" href="#/projects">返回项目列表</a>' : page.id === 'P13' ? '<a class="button secondary" href="#/imports?target=schools">导入学校资料</a><button class="button primary" id="new-school">新增学校</button>' : page.id === 'P14' ? '<a class="button primary" href="#/guides/detail?mode=new">新增导游</a>' : page.id === 'P15' ? '<a class="button secondary" href="#/guides">返回导游库</a>' : page.id === 'P11' ? '<a class="button secondary" href="#/imports/mapping">字段映射与预览</a>' : page.id === 'P12' ? '<a class="button secondary" href="#/imports">返回资料导入</a>' : page.id === 'P16' ? '<a class="button secondary" href="#/records?category=export">查看导出记录</a>' : page.id === 'P17' ? `<a class="button secondary" href="#/tables${routeParams().get('project') ? `?project=${encodeURIComponent(routeParams().get('project'))}` : ''}">返回表格中心</a>` : page.id === 'P19' ? '<button class="button secondary" id="refresh-records" type="button">刷新记录</button>' : '<a class="button secondary" href="#/">返回工作台</a>'}</div>
        </header>
        ${pageDirectory(page)}
        <div class="page-content">${page.id === 'P01' ? dashboardContent() : page.id === 'P02' ? projectsContent() : page.id === 'P03' ? projectFormContent() : page.id === 'P04' ? overviewContent() : page.id === 'P05' ? peopleContent() : page.id === 'P06' ? recruitmentContent() : page.id === 'P07' ? projectGuidesContent() : page.id === 'P08' ? transportContent() : page.id === 'P09' ? lodgingContent() : page.id === 'P10' ? mealsContent() : page.id === 'P11' ? importsContent() : page.id === 'P12' ? importMappingContent() : page.id === 'P13' ? schoolsContent() : page.id === 'P14' ? guidesContent() : page.id === 'P15' ? guideDetailContent() : page.id === 'P16' ? tablesContent() : page.id === 'P17' ? tablePreviewContent() : page.id === 'P18' ? exceptionsContent() : page.id === 'P19' ? recordsContent() : page.id === 'P20' ? backupContent() : scaffoldContent(page)}</div>
      </main>
      ${exitDialogMarkup()}
    </div>`;
  root.querySelector('#logout').addEventListener('click', requestLogout);
  bindExitDialog();
  if (page.id === 'P01') bindDashboardPage();
  if (page.id === 'P02') bindProjectsPage();
  if (page.id === 'P03') bindProjectFormPage();
  if (page.id === 'P04') bindOverviewPage();
  if (page.id === 'P05') bindPeoplePage();
  if (page.id === 'P06') bindRecruitmentPage();
  if (page.id === 'P07') bindGuideArrangementPage();
  if (page.id === 'P08') bindTransportPage();
  if (page.id === 'P09') bindLodgingPage();
  if (page.id === 'P10') bindMealsPage();
  if (page.id === 'P13') bindSchoolsPage();
  if (page.id === 'P14') bindGuidesPage();
  if (page.id === 'P15') bindGuideDetailPage();
  if (page.id === 'P16') bindTableCenterPage();
  if (page.id === 'P17') bindTablePreviewPage();
  if (page.id === 'P18') bindExceptionsPage();
  if (page.id === 'P19') bindRecordsPage();
  if (page.id === 'P20') bindBackupPage();
  if (page.id === 'P11') bindImportsPage();
  if (page.id === 'P12') bindImportMappingPage();
  document.title = `${page.id} ${page.title}｜研学派团工作台`;
}

async function boot() {
  renderLoading();
  try {
    const session = await api('/api/session');
    state.authenticated = session.authenticated;
    state.development = session.development;
    state.loading = false;
    state.authenticated ? renderApp() : renderUnlock();
  } catch (error) {
    root.innerHTML = `<main class="center-stage"><section class="unlock-card"><p class="eyebrow">本地服务不可用</p><h1>无法打开工作台</h1><p class="muted">${escapeHtml(error.message)}。请确认本地服务已启动后重试。</p><button class="button primary" id="retry">重新连接</button></section></main>`;
    root.querySelector('#retry').addEventListener('click', boot);
  }
}

window.addEventListener('hashchange', () => state.authenticated && renderApp());
boot();
