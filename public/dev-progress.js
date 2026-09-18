const elements = {
  summary: document.querySelector('#summary'), updated: document.querySelector('#updated'), next: document.querySelector('#next-task'),
  checkStatus: document.querySelector('#check-status'), checkDetail: document.querySelector('#check-detail'), gates: document.querySelector('#gates'),
  rows: document.querySelector('#task-rows'), filter: document.querySelector('#status-filter'), empty: document.querySelector('#empty'), error: document.querySelector('#error'),
  refresh: document.querySelector('#refresh')
};
let progress = null;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatDate(value) {
  if (!value) return '无';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function renderRows() {
  const status = elements.filter.value;
  const tasks = progress.tasks.filter((task) => !status || task.status === status);
  elements.rows.innerHTML = tasks.map((task) => `<tr>
    <td class="task-cell"><span class="task-id">${task.id}</span><span class="task-title">${escapeHtml(task.title)}</span><span class="task-meta">${escapeHtml(task.stage)}${task.pages.length ? ` · ${task.pages.join('、')}` : ''}</span>${task.followUps?.length ? `<div class="follow-up-list" aria-label="待修改项">${task.followUps.map((item) => `<span class="follow-up-tag">${escapeHtml(item)} · 待修改</span>`).join('')}</div>` : ''}</td>
    <td><span class="status ${task.status}">${task.status}</span></td>
    <td>${escapeHtml(task.actual)}</td>
    <td class="missing">${escapeHtml(task.missing || '无')}</td>
    <td>${escapeHtml(task.verificationRequired || '查看任务说明')}</td>
  </tr>`).join('');
  elements.empty.hidden = tasks.length > 0;
}

function render(data) {
  progress = data;
  const cards = [
    ['任务总数', data.summary.total, ''], ['已验收完成', data.summary.DONE, 'done'], ['待复核', data.summary.REVIEW, 'review'],
    ['正在进行', data.summary.IN_PROGRESS, 'in_progress'], ['未完成／阻塞', data.summary.TODO + data.summary.BLOCKED, data.summary.BLOCKED ? 'blocked' : '']
  ];
  elements.summary.innerHTML = cards.map(([label, value, className]) => `<div class="summary-card ${className}"><span>${label}</span><strong>${value}</strong></div>`).join('');
  elements.updated.textContent = `任务文件更新：${formatDate(data.tasksUpdatedAt)} · 页面读取：${formatDate(data.generatedAt)}`;
  elements.next.textContent = data.next || 'tasks.md 未填写当前下一项';
  elements.checkStatus.textContent = data.check.label;
  elements.checkStatus.dataset.state = data.check.state;
  elements.checkDetail.textContent = data.check.finishedAt
    ? `${formatDate(data.check.finishedAt)} · ${data.check.passed ?? 0}/${data.check.tests ?? 0} 通过 · 退出码 ${data.check.exitCode}`
    : data.check.startedAt ? `开始于 ${formatDate(data.check.startedAt)}` : '运行 npm.cmd run check 后自动记录';
  elements.gates.innerHTML = data.gates.map((gate) => `<span class="gate ${gate.passed ? 'passed' : ''}">Gate ${gate.id} ${escapeHtml(gate.name)} · ${gate.done}/${gate.total}</span>`).join('');
  renderRows();
}

async function load() {
  elements.refresh.disabled = true;
  elements.error.hidden = true;
  try {
    const response = await fetch('/api/dev-progress', { cache: 'no-store' });
    if (!response.ok) throw new Error((await response.json()).error || '无法读取开发进度');
    render(await response.json());
  } catch (error) {
    elements.error.textContent = error.message;
    elements.error.hidden = false;
  } finally { elements.refresh.disabled = false; }
}

elements.filter.addEventListener('change', renderRows);
elements.refresh.addEventListener('click', load);
load();
