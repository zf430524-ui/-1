import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const TASK_STATUS = new Set(['TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE']);
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.json', '.md', '.html', '.css']);
const SOURCE_EXCLUDES = new Set(['.git', '.runtime', 'node_modules', 'test-results']);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function clean(value = '') {
  return value.replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

function field(block, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return clean(block.match(new RegExp(`^- ${escaped}(?:（[^\\n]+）)?：(.+)$`, 'm'))?.[1] || '');
}

function fields(block, labels) {
  const wanted = new Set(labels);
  return block.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^- ([^：]+?)(?:（[^\n]+）)?：(.+)$/);
    return match && wanted.has(match[1]) ? [clean(match[2])] : [];
  });
}

function missingFrom(text, status, outcome) {
  if (status === 'DONE') return '';
  const missing = text
    .split(/[。；]/)
    .map(clean)
    .filter((sentence) => /尚未|仍未|未完成|未执行|等待|待复核|待确认|缺少|没有|保持\s*REVIEW|门禁继续关闭|不得录入/.test(sentence));
  if (missing.length) return unique(missing).join('；');
  if (status === 'REVIEW') return '实现已形成，仍需完成人工或真实资料复核';
  if (status === 'BLOCKED') return '任务存在明确阻塞，查看风险与负责人';
  return outcome ? `目标尚未完整验收：${outcome}` : '任务尚未完整实施与验收';
}

function taskStage(number) {
  if (number <= 2) return '产品冻结';
  if (number <= 9) return '数据基础';
  if (number <= 22) return '核心业务';
  return '交付检查';
}

function headingPages(title) {
  return unique(title.match(/P\d{2}/g) || []);
}

function listField(block, label) {
  return unique(field(block, label).split(/[、，,]/).map(clean));
}

export function parseTasksMarkdown(markdown) {
  const headingPattern = /^### (T(\d{2})) · (.+)$/gm;
  const headings = [...markdown.matchAll(headingPattern)];
  const tasks = headings.map((heading, index) => {
    const start = heading.index;
    const end = headings[index + 1]?.index ?? markdown.length;
    const block = markdown.slice(start, end);
    const status = field(block, '状态');
    if (!TASK_STATUS.has(status)) throw new Error(`INVALID_TASK_STATUS:${heading[1]}`);
    const outcome = field(block, '结果');
    const actualEvidence = fields(block, ['完成证据', '当前证据', '当前实现进度', '进度补充', '验收证据补充']);
    const actual = (status === 'DONE' ? field(block, '完成证据') : field(block, '当前实现进度'))
      || field(block, '当前证据') || field(block, '完成证据') || field(block, '进度补充')
      || (status === 'DONE' ? '任务标记为已完成，详见任务验收证据' : '尚无已验证实现记录');
    const number = Number(heading[2]);
    return {
      id: heading[1],
      number,
      title: clean(heading[3]),
      stage: taskStage(number),
      pages: headingPages(heading[3]),
      status,
      followUps: listField(block, '待修改项'),
      outcome,
      actual,
      missing: missingFrom(actualEvidence.join('。'), status, outcome),
      dependencies: field(block, '依赖/输入'),
      verificationRequired: field(block, '验收证据'),
      riskOwner: field(block, '风险/负责人'),
      nonGoals: field(block, '不做')
    };
  });

  const ids = tasks.map((task) => task.id);
  if (new Set(ids).size !== ids.length) throw new Error('DUPLICATE_TASK_ID');

  const counts = Object.fromEntries([...TASK_STATUS].map((status) => [status, tasks.filter((task) => task.status === status).length]));
  const gates = [
    { id: 'A', name: '产品冻结', range: [1, 2] },
    { id: 'B', name: '数据基础', range: [3, 9] },
    { id: 'C', name: '核心业务', range: [10, 22] },
    { id: 'D', name: '交付检查', range: [23, 30] }
  ].map((gate) => {
    const members = tasks.filter((task) => task.number >= gate.range[0] && task.number <= gate.range[1]);
    const done = members.filter((task) => task.status === 'DONE').length;
    return { ...gate, done, total: members.length, passed: members.length > 0 && done === members.length };
  });
  const next = clean(markdown.match(/^- 当前下一项：(.+)$/m)?.[1] || '');

  return {
    summary: { total: tasks.length, ...counts },
    gates,
    next,
    tasks
  };
}

async function latestModifiedAt(path) {
  let entry;
  try { entry = await stat(path); } catch { return 0; }
  if (entry.isFile()) return SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf('.'))) ? entry.mtimeMs : 0;
  if (!entry.isDirectory()) return 0;
  const children = await readdir(path, { withFileTypes: true });
  let latest = 0;
  for (const child of children) {
    if (SOURCE_EXCLUDES.has(child.name)) continue;
    latest = Math.max(latest, await latestModifiedAt(join(path, child.name)));
  }
  return latest;
}

async function readCheckResult(checkResultPath, sourceRoots) {
  let result;
  try { result = JSON.parse(await readFile(checkResultPath, 'utf8')); } catch { return { state: 'not_run', label: '尚未记录检查结果' }; }
  const latestSource = Math.max(...await Promise.all(sourceRoots.map(latestModifiedAt)), 0);
  const finishedAt = Date.parse(result.finishedAt || '');
  if (result.state === 'running') {
    const age = Date.now() - Date.parse(result.startedAt || '');
    return age > 20 * 60 * 1000
      ? { ...result, state: 'interrupted', label: '检查已中断或超时，结果无效' }
      : { ...result, label: '检查正在运行' };
  }
  if (result.state === 'passed' && latestSource > finishedAt) return { ...result, state: 'outdated', label: '源码已更新，最近通过结果已过期' };
  const labels = { passed: '最近检查通过', failed: '最近检查失败', timed_out: '最近检查超时' };
  return { ...result, label: labels[result.state] || '检查结果不可识别' };
}

export async function loadDevelopmentProgress({ tasksPath, checkResultPath, sourceRoots }) {
  const taskFile = await readFile(tasksPath, 'utf8');
  const progress = parseTasksMarkdown(taskFile);
  const taskStat = await stat(tasksPath);
  return {
    generatedAt: new Date().toISOString(),
    tasksUpdatedAt: taskStat.mtime.toISOString(),
    ...progress,
    check: await readCheckResult(checkResultPath, sourceRoots)
  };
}
