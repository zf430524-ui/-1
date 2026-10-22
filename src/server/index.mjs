import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth, expiredSessionCookie, sessionCookie } from './auth.mjs';
import { migrate, openDatabase } from '../db/migrate.mjs';
import { createSchoolRepository } from '../db/repositories/schools.mjs';
import { createOperationLogRepository } from '../db/repositories/operation-logs.mjs';
import { createImportRepository } from '../db/repositories/imports.mjs';
import { createBusinessRepository } from '../db/repositories/business.mjs';
import { createGuideRepository } from '../db/repositories/guides.mjs';
import { createRecordRepository } from '../db/repositories/records.mjs';
import { createAuditService } from '../services/audit.mjs';
import { createBackupService } from '../services/backups.mjs';
import { createSchoolService } from '../services/schools.mjs';
import { createImportService } from '../services/imports.mjs';
import { createBusinessService } from '../services/business.mjs';
import { createExportService } from '../services/exports.mjs';
import { createGuideService } from '../services/guides.mjs';
import { createGuideFileService } from '../services/guide-files.mjs';
import { createSensitiveValueProtector } from '../services/sensitive-values.mjs';
import { createRecordService } from '../services/records.mjs';
import { loadDevelopmentProgress } from '../services/development-progress.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = normalize(join(here, '..', '..'));
const publicRoot = normalize(join(projectRoot, 'public'));
const allowDevUnlock = process.argv.includes('--allow-dev-unlock');
const progressEnabled = allowDevUnlock || process.env.WORKBENCH_TEST_MODE === '1';
const unlockPassword = process.env.WORKBENCH_UNLOCK_PASSWORD || (allowDevUnlock ? 'local-dev' : '');
const sensitiveKey = process.env.WORKBENCH_SENSITIVE_KEY || (allowDevUnlock ? 'local-dev-sensitive-only' : process.env.WORKBENCH_TEST_MODE === '1' ? 'test-mode-sensitive-only' : '');
const port = Number(process.env.PORT || 4173);
const host = '127.0.0.1';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

if (!unlockPassword || !sensitiveKey) {
  console.error('拒绝启动：请先设置 WORKBENCH_UNLOCK_PASSWORD 和独立的 WORKBENCH_SENSITIVE_KEY，或仅使用 npm.cmd run dev 处理脱敏测试数据。');
  process.exit(1);
}

const auth = await createAuth({ password: unlockPassword });

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
}

async function readJson(request, maxBytes = 16 * 1024) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw new Error('REQUEST_TOO_LARGE');
  }
  try { return JSON.parse(body || '{}'); } catch { throw new Error('INVALID_JSON'); }
}

function isLocalRequest(request) {
  const authority = String(request.headers.host || '');
  const hostHeader = authority.split(':')[0];
  const origin = request.headers.origin;
  const originAllowed = !origin || origin === `http://${authority}`;
  return (hostHeader === host || hostHeader === 'localhost') && originAllowed;
}

function openDirectory(path) {
  return new Promise((resolve, reject) => {
    const child = spawn('explorer.exe', [path], { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function resultStatus(result, successStatus = 200) {
  if (result.ok) return successStatus;
  if (['BACKUP_NOT_FOUND', 'NOT_FOUND', 'DOCUMENT_FILE_NOT_FOUND', 'EXPORT_NOT_FOUND', 'EXPORT_FILE_NOT_FOUND'].includes(result.error.code)) return 404;
  if (['RESTORE_CONFIRMATION_REQUIRED', 'RESTORE_BACKUP_ACK_REQUIRED', 'EXIT_CONFIRMATION_REQUIRED', 'PROJECT_END_CONFIRMATION_REQUIRED', 'PROJECT_DELETE_CONFIRMATION_REQUIRED', 'PROJECT_IN_USE', 'CONDITIONAL_CLEAR_CONFIRMATION_REQUIRED', 'DUPLICATE_GUIDE', 'GUIDE_IN_USE', 'GUIDE_FUTURE_ASSIGNMENTS', 'SENSITIVE_CONFIRMATION_REQUIRED', 'TOUR_FACT_EXISTS', 'RECRUITMENT_RESOLUTION_REQUIRED', 'BLOCKER_CANNOT_BE_IGNORED', 'EXCEPTION_NOT_ACTIVE', 'PROJECT_BLOCKED', 'TABLE_PREVIEW_BLOCKED', 'PREVIEW_VERSION_REQUIRED', 'PREVIEW_STALE', 'EXPORT_BLOCKED', 'EXPORT_NOT_CURRENT'].includes(result.error.code)) return 409;
  if (['BACKUP_FAILED', 'RESTORE_FAILED', 'PRE_RESTORE_BACKUP_FAILED', 'OPEN_LOCATION_UNAVAILABLE'].includes(result.error.code)) return 500;
  return 400;
}

function sendResult(response, result, successStatus = 200) {
  return sendJson(response, resultStatus(result, successStatus), result.ok ? result.data : result.error);
}

async function serveStatic(request, response, overridePath = '') {
  const requested = overridePath || decodeURIComponent(new URL(request.url || '/', `http://${host}:${port}`).pathname);
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const safe = normalize(relative);
  if (safe.startsWith('..') || safe.includes(':')) throw new Error('INVALID_PATH');
  const file = join(publicRoot, safe);
  if (!file.startsWith(publicRoot)) throw new Error('INVALID_PATH');
  const data = await readFile(file);
  response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
  response.end(data);
}

export function createWorkbenchServer() {
  const runtimeRoot = process.env.WORKBENCH_RUNTIME_ROOT || join(process.cwd(), '.runtime');
  const databasePath = process.env.WORKBENCH_DB_PATH || (process.env.WORKBENCH_TEST_MODE === '1' ? ':memory:' : join(runtimeRoot, 'data', 'workbench.sqlite'));
  const certificatesPath = process.env.WORKBENCH_CERTIFICATES_PATH || join(runtimeRoot, 'certificates');
  const backupsPath = process.env.WORKBENCH_BACKUPS_PATH || join(runtimeRoot, 'backups');
  const importsPath = process.env.WORKBENCH_IMPORTS_PATH || join(runtimeRoot, 'imports');
  const exportsPath = process.env.WORKBENCH_EXPORTS_PATH || join(runtimeRoot, 'exports');
  const tasksPath = process.env.WORKBENCH_TASKS_PATH || join(projectRoot, 'tasks.md');
  const progressResultPath = process.env.WORKBENCH_PROGRESS_RESULT_PATH || join(runtimeRoot, 'dev-progress', 'latest-check.json');
  const progressSourceRoots = [tasksPath, join(projectRoot, 'package.json'), join(projectRoot, 'public'), join(projectRoot, 'src'), join(projectRoot, 'scripts'), join(projectRoot, 'tests')];
  const guideFiles = createGuideFileService(certificatesPath);
  const protector = createSensitiveValueProtector(sensitiveKey);
  const runtime = { db: null, schools: null, guides: null, imports: null, business: null, exports: null, records: null, auditRepository: null, audit: null };
  function reopenDatabase() {
    runtime.db = openDatabase(databasePath);
    migrate(runtime.db);
    const schoolRepository = createSchoolRepository(runtime.db);
    runtime.schools = createSchoolService({ db: runtime.db, repository: schoolRepository });
    runtime.auditRepository = createOperationLogRepository(runtime.db);
    runtime.audit = createAuditService(runtime.auditRepository);
    runtime.guides = createGuideService({ db: runtime.db, repository: createGuideRepository(runtime.db), protector, files: guideFiles, audit: runtime.audit });
    const businessRepository = createBusinessRepository(runtime.db);
    runtime.business = createBusinessService({ db: runtime.db, repository: businessRepository, schoolRepository, audit: runtime.audit });
    runtime.exports = createExportService({ repository: businessRepository, business: runtime.business, exportsPath, audit: runtime.audit, revealSensitive: protector.reveal });
    runtime.imports = createImportService({ db: runtime.db, repository: createImportRepository(runtime.db), schoolRepository, schools: runtime.schools, audit: runtime.audit, importsPath, targetWriters: runtime.business.importWriters() });
    runtime.records = createRecordService(createRecordRepository(runtime.db));
  }
  function closeDatabase() {
    if (runtime.db?.open) runtime.db.close();
    runtime.db = null;
  }
  reopenDatabase();
  const backups = databasePath === ':memory:' ? null : createBackupService({
    databasePath,
    certificatesPath,
    backupsPath,
    getDatabase: () => runtime.db,
    closeDatabase,
    reopenDatabase,
    recordAudit: (entry) => runtime.audit.record(entry),
    listAudit: (filters) => runtime.auditRepository.list(filters),
    openBackupLocation: openDirectory
  });
  const server = createServer(async (request, response) => {
    try {
      if (!isLocalRequest(request)) return sendJson(response, 403, { error: '仅允许本机访问' });
      const url = new URL(request.url || '/', `http://${host}:${port}`);
      const pathname = url.pathname;

      if (pathname === '/api/health' && request.method === 'GET') {
        return sendJson(response, 200, { ok: true, mode: allowDevUnlock ? 'development' : 'protected', scope: 'manager-only-v1' });
      }
      if (pathname === '/api/dev-progress' && request.method === 'GET') {
        if (!progressEnabled) return sendJson(response, 404, { error: '开发进度页面仅在本地开发模式开放' });
        return sendJson(response, 200, await loadDevelopmentProgress({ tasksPath, checkResultPath: progressResultPath, sourceRoots: progressSourceRoots }));
      }
      if (pathname === '/dev-progress' && request.method === 'GET') {
        if (!progressEnabled) return sendJson(response, 404, { error: '开发进度页面仅在本地开发模式开放' });
        return serveStatic(request, response, '/dev-progress.html');
      }
      if (pathname.startsWith('/dev-progress') && !progressEnabled) return sendJson(response, 404, { error: '页面不存在' });
      if (pathname === '/__dev/unlock' && request.method === 'GET' && allowDevUnlock) {
        const token = auth.createSession();
        const requestedDestination = url.searchParams.get('to') || '/';
        const destination = /^\/[a-z/-]*$/.test(requestedDestination) ? requestedDestination : '/';
        response.writeHead(302, { Location: `/#${destination}`, 'Set-Cookie': sessionCookie(token), 'Cache-Control': 'no-store' });
        return response.end();
      }
      if (pathname === '/api/session' && request.method === 'GET') {
        return sendJson(response, 200, { authenticated: Boolean(auth.getSession(request)), development: allowDevUnlock });
      }
      if (pathname === '/api/session' && request.method === 'POST') {
        const { password } = await readJson(request);
        if (!await auth.verifyPassword(password)) return sendJson(response, 401, { error: '解锁口令不正确' });
        const token = auth.createSession();
        return sendJson(response, 200, { authenticated: true, development: allowDevUnlock }, { 'Set-Cookie': sessionCookie(token) });
      }
      if (pathname === '/api/session' && request.method === 'DELETE') {
        if (auth.getSession(request) && backups && await backups.requiresExitReminder()) {
          return sendJson(response, 409, { code: 'BACKUP_REMINDER_REQUIRED', message: '今天还没有成功且已校验的备份', details: { actions: ['backup_and_exit', 'stay', 'exit_without_backup'] } });
        }
        auth.destroySession(request);
        return sendJson(response, 200, { authenticated: false }, { 'Set-Cookie': expiredSessionCookie });
      }
      if (pathname.startsWith('/api/')) {
        if (!auth.getSession(request)) return sendJson(response, 401, { error: '请先解锁工作台' });
        const exportDownloadMatch = pathname.match(/^\/api\/exports\/([^/]+)\/download$/);
        if (exportDownloadMatch && request.method === 'GET') {
          const result = await runtime.exports.downloadFile(decodeURIComponent(exportDownloadMatch[1]));
          if (!result.ok) return sendResult(response, result);
          response.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.data.filename)}`,
            'Content-Length': result.data.sizeBytes,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
          });
          return response.end(result.data.content);
        }
        if (pathname === '/api/projects' && request.method === 'GET') {
          const statuses = url.searchParams.getAll('status').flatMap((value) => value.split(',')).filter(Boolean);
          return sendResult(response, runtime.business.listProjects({ query: url.searchParams.get('query') || '', startsFrom: url.searchParams.get('startsFrom') || '', startsTo: url.searchParams.get('startsTo') || '', statuses, includeEnded: url.searchParams.get('includeEnded') === 'true' }));
        }
        if (pathname === '/api/projects' && request.method === 'POST') return sendResult(response, runtime.business.createProject(await readJson(request)), 201);
        if (pathname === '/api/dashboard' && request.method === 'GET') return sendResult(response, runtime.business.dashboard());
        if (pathname === '/api/records' && request.method === 'GET') return sendResult(response, runtime.records.list({
          category: url.searchParams.get('category') || '', projectId: url.searchParams.get('projectId') || '',
          operationType: url.searchParams.get('operationType') || '', objectType: url.searchParams.get('objectType') || '',
          result: url.searchParams.get('result') || '', from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '',
          page: url.searchParams.get('page'), pageSize: url.searchParams.get('pageSize')
        }));
        if (pathname === '/api/exceptions' && request.method === 'GET') return sendResult(response, runtime.business.listExceptions({
          projectId: url.searchParams.get('projectId') || '', module: url.searchParams.get('module') || '',
          severity: url.searchParams.get('severity') || '', status: url.searchParams.get('status') || '',
          limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset')
        }));
        const exceptionConfirmMatch = pathname.match(/^\/api\/exceptions\/([^/]+)\/confirm$/);
        if (exceptionConfirmMatch && request.method === 'POST') return sendResult(response, runtime.business.confirmException(decodeURIComponent(exceptionConfirmMatch[1]), await readJson(request)));
        if (pathname === '/api/guides' && request.method === 'GET') return sendResult(response, runtime.guides.list({
          query: url.searchParams.get('query') || '', cooperationStatus: url.searchParams.get('cooperationStatus') || '',
          documentStatus: url.searchParams.get('documentStatus') || '', residenceArea: url.searchParams.get('residenceArea') || ''
        }));
        if (pathname === '/api/guides' && request.method === 'POST') return sendResult(response, runtime.guides.create(await readJson(request, 8 * 1024 * 1024)), 201);
        const guideDocumentMatch = pathname.match(/^\/api\/guides\/([^/]+)\/documents\/([^/]+)\/view$/);
        if (guideDocumentMatch && request.method === 'POST') return sendResult(response, runtime.guides.viewDocument(decodeURIComponent(guideDocumentMatch[1]), decodeURIComponent(guideDocumentMatch[2]), await readJson(request)));
        const guideActionMatch = pathname.match(/^\/api\/guides\/([^/]+)\/(status|sensitive|facts)$/);
        if (guideActionMatch) {
          const guideId = decodeURIComponent(guideActionMatch[1]); const action = guideActionMatch[2];
          if (request.method === 'PATCH' && action === 'status') return sendResult(response, runtime.guides.setStatus(guideId, await readJson(request)));
          if (request.method === 'POST' && action === 'sensitive') return sendResult(response, runtime.guides.reveal(guideId, await readJson(request)));
          if (request.method === 'POST' && action === 'facts') return sendResult(response, runtime.guides.addTourFact(guideId, await readJson(request)), 201);
        }
        const guideFactMatch = pathname.match(/^\/api\/guides\/([^/]+)\/facts\/([^/]+)$/);
        if (guideFactMatch && request.method === 'PUT') return sendResult(response, runtime.guides.correctTourFact(decodeURIComponent(guideFactMatch[1]), decodeURIComponent(guideFactMatch[2]), await readJson(request)));
        const guideMatch = pathname.match(/^\/api\/guides\/([^/]+)$/);
        if (guideMatch) {
          const guideId = decodeURIComponent(guideMatch[1]);
          if (request.method === 'GET') return sendResult(response, runtime.guides.get(guideId));
          if (request.method === 'PUT') return sendResult(response, runtime.guides.update(guideId, await readJson(request, 8 * 1024 * 1024)));
          if (request.method === 'DELETE') return sendResult(response, runtime.guides.remove(guideId));
        }
        const projectGuideActionMatch = pathname.match(/^\/api\/project-guides\/([^/]+)\/(assign|status|withdraw|replace)$/);
        if (projectGuideActionMatch) {
          const projectGuideId = decodeURIComponent(projectGuideActionMatch[1]); const action = projectGuideActionMatch[2];
          const expectedMethod = action === 'status' ? 'PATCH' : 'POST';
          if (request.method === expectedMethod) {
            const body = await readJson(request);
            if (action === 'assign') return sendResult(response, runtime.business.assignGuide(projectGuideId, body));
            if (action === 'status') return sendResult(response, runtime.business.setGuideHandling(projectGuideId, body));
            if (action === 'withdraw') return sendResult(response, runtime.business.withdrawGuide(projectGuideId, body));
            if (action === 'replace') return sendResult(response, runtime.business.replaceGuide(projectGuideId, body));
          }
        }
        const tablePreviewStatusMatch = pathname.match(/^\/api\/projects\/([^/]+)\/table-previews\/(insurance|transport|lodging|meals)\/status$/);
        if (tablePreviewStatusMatch && request.method === 'GET') return sendResult(response, runtime.exports.previewStatus(
          decodeURIComponent(tablePreviewStatusMatch[1]), tablePreviewStatusMatch[2], url.searchParams.get('version')
        ));
        const tablePreviewMatch = pathname.match(/^\/api\/projects\/([^/]+)\/table-previews\/(insurance|transport|lodging|meals)$/);
        if (tablePreviewMatch && request.method === 'POST') return sendResult(response, runtime.exports.preview(decodeURIComponent(tablePreviewMatch[1]), tablePreviewMatch[2]));
        const tableCheckMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tables\/check$/);
        if (tableCheckMatch && request.method === 'POST') return sendResult(response, runtime.exports.tableCenter(decodeURIComponent(tableCheckMatch[1]), { recalculate: true }));
        const tableCenterMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tables$/);
        if (tableCenterMatch && request.method === 'GET') return sendResult(response, runtime.exports.tableCenter(decodeURIComponent(tableCenterMatch[1])));
        const exportMatch = pathname.match(/^\/api\/projects\/([^/]+)\/exports\/(insurance|transport|lodging|meals)$/);
        if (exportMatch && request.method === 'POST') return sendResult(response, await runtime.exports.exportFile(decodeURIComponent(exportMatch[1]), exportMatch[2], await readJson(request)), 201);
        const recruitmentStepMatch = pathname.match(/^\/api\/projects\/([^/]+)\/recruitment\/(notice|preview|confirm)$/);
        if (recruitmentStepMatch && request.method === 'POST') {
          const projectId = decodeURIComponent(recruitmentStepMatch[1]); const action = recruitmentStepMatch[2]; const body = await readJson(request, 1024 * 1024);
          if (action === 'notice') return sendResult(response, runtime.business.recruitmentNotice(projectId, body));
          if (action === 'preview') return sendResult(response, runtime.business.previewRecruitment(projectId, body));
          if (action === 'confirm') return sendResult(response, runtime.business.confirmRecruitment(projectId, body), 201);
        }
        const recruitmentContextMatch = pathname.match(/^\/api\/projects\/([^/]+)\/recruitment$/);
        if (recruitmentContextMatch && request.method === 'GET') return sendResult(response, runtime.business.recruitmentContext(decodeURIComponent(recruitmentContextMatch[1])));
        const transportSuggestMatch = pathname.match(/^\/api\/projects\/([^/]+)\/transport\/suggest$/);
        if (transportSuggestMatch && request.method === 'POST') return sendResult(response, runtime.business.suggestTransport(decodeURIComponent(transportSuggestMatch[1]), await readJson(request, 2 * 1024 * 1024)));
        const lodgingSuggestMatch = pathname.match(/^\/api\/projects\/([^/]+)\/lodging\/suggest$/);
        if (lodgingSuggestMatch && request.method === 'POST') return sendResult(response, runtime.business.suggestLodging(decodeURIComponent(lodgingSuggestMatch[1]), await readJson(request, 2 * 1024 * 1024)));
        const mealsSuggestMatch = pathname.match(/^\/api\/projects\/([^/]+)\/meals\/suggest$/);
        if (mealsSuggestMatch && request.method === 'POST') return sendResult(response, runtime.business.suggestMeals(decodeURIComponent(mealsSuggestMatch[1]), await readJson(request, 2 * 1024 * 1024)));
        const arrangementAdjustMatch = pathname.match(/^\/api\/projects\/([^/]+)\/arrangements\/(transport|lodging|meals)\/adjust$/);
        if (arrangementAdjustMatch && request.method === 'POST') return sendResult(response, runtime.business.adjustArrangement(decodeURIComponent(arrangementAdjustMatch[1]), arrangementAdjustMatch[2], await readJson(request, 2 * 1024 * 1024)));
        const arrangementUnlockMatch = pathname.match(/^\/api\/projects\/([^/]+)\/arrangements\/(transport|lodging|meals)\/([^/]+)\/unlock$/);
        if (arrangementUnlockMatch && request.method === 'POST') return sendResult(response, runtime.business.unlockArrangement(decodeURIComponent(arrangementUnlockMatch[1]), arrangementUnlockMatch[2], decodeURIComponent(arrangementUnlockMatch[3])));
        const projectActionMatch = pathname.match(/^\/api\/projects\/([^/]+)\/(people|transport|lodging|meals|recruitment|recalculate|complete)$/);
        if (projectActionMatch && request.method === 'POST') {
          const projectId = decodeURIComponent(projectActionMatch[1]);
          const action = projectActionMatch[2];
          const body = await readJson(request, 2 * 1024 * 1024);
          if (action === 'people') return sendResult(response, runtime.business.savePeople(projectId, body));
          if (action === 'transport') return sendResult(response, runtime.business.saveTransport(projectId, body.vehicles || [], { confirmedIds: body.confirmedIds || [] }));
          if (action === 'lodging') return sendResult(response, runtime.business.saveLodging(projectId, body.rooms || [], { confirmedIds: body.confirmedIds || [] }));
          if (action === 'meals') return sendResult(response, runtime.business.saveMeals(projectId, body.sessions || [], { confirmedIds: body.confirmedIds || [] }));
          if (action === 'recruitment') return sendResult(response, runtime.business.recruit(projectId, body), 201);
          if (action === 'recalculate') return sendResult(response, runtime.business.recalculate(projectId));
          if (action === 'complete') return sendResult(response, runtime.business.complete(projectId));
        }
        const projectOverviewMatch = pathname.match(/^\/api\/projects\/([^/]+)\/overview$/);
        if (projectOverviewMatch && request.method === 'GET') return sendResult(response, runtime.business.overview(decodeURIComponent(projectOverviewMatch[1])));
        const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
        if (projectMatch) {
          const projectId = decodeURIComponent(projectMatch[1]);
          if (request.method === 'GET') {
            const data = runtime.business.summary(projectId);
            return data ? sendJson(response, 200, data) : sendJson(response, 404, { code: 'NOT_FOUND', message: '项目不存在' });
          }
          if (request.method === 'PUT') return sendResult(response, runtime.business.updateProject(projectId, await readJson(request)));
          if (request.method === 'DELETE') return sendResult(response, runtime.business.removeProject(projectId, await readJson(request)));
        }
        const projectStatusMatch = pathname.match(/^\/api\/projects\/([^/]+)\/status$/);
        if (projectStatusMatch && request.method === 'PATCH') return sendResult(response, runtime.business.endProject(decodeURIComponent(projectStatusMatch[1]), await readJson(request)));
        if (pathname === '/api/imports/context' && request.method === 'GET') return sendResult(response, runtime.imports.context());
        if (pathname === '/api/imports' && request.method === 'GET') return sendResult(response, runtime.imports.list({ status: url.searchParams.get('status') || '', targetType: url.searchParams.get('targetType') || '', projectId: url.searchParams.get('projectId') || '' }));
        if (pathname === '/api/imports' && request.method === 'POST') return sendResult(response, await runtime.imports.create(await readJson(request, 8 * 1024 * 1024)), 201);
        const importTemplateMatch = pathname.match(/^\/api\/imports\/templates\/([^/]+)$/);
        if (importTemplateMatch && request.method === 'GET') {
          const result = await runtime.imports.template(decodeURIComponent(importTemplateMatch[1]));
          if (!result.ok) return sendResult(response, result);
          response.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${result.data.filename}"`,
            'Content-Length': result.data.buffer.length,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
          });
          return response.end(result.data.buffer);
        }
        const importRowMatch = pathname.match(/^\/api\/imports\/([^/]+)\/rows\/([^/]+)$/);
        if (importRowMatch && request.method === 'PATCH') return sendResult(response, runtime.imports.updateRow(decodeURIComponent(importRowMatch[1]), decodeURIComponent(importRowMatch[2]), await readJson(request)));
        const importActionMatch = pathname.match(/^\/api\/imports\/([^/]+)\/(mapping|confirm)$/);
        if (importActionMatch) {
          const importId = decodeURIComponent(importActionMatch[1]);
          if (request.method === 'PUT' && importActionMatch[2] === 'mapping') return sendResult(response, runtime.imports.updateMapping(importId, await readJson(request)));
          if (request.method === 'POST' && importActionMatch[2] === 'confirm') return sendResult(response, runtime.imports.confirm(importId, await readJson(request)));
        }
        const importMatch = pathname.match(/^\/api\/imports\/([^/]+)$/);
        if (importMatch) {
          const importId = decodeURIComponent(importMatch[1]);
          if (request.method === 'GET') return sendResult(response, runtime.imports.get(importId));
          if (request.method === 'DELETE') return sendResult(response, await runtime.imports.cancel(importId));
        }
        if (pathname === '/api/backups/status' && request.method === 'GET') {
          if (!backups) return sendJson(response, 503, { error: '当前内存测试环境不支持备份' });
          return sendResult(response, await backups.status());
        }
        if (pathname === '/api/backups' && request.method === 'GET') {
          if (!backups) return sendJson(response, 503, { error: '当前内存测试环境不支持备份' });
          return sendResult(response, await backups.list());
        }
        if (pathname === '/api/backups' && request.method === 'POST') {
          if (!backups) return sendJson(response, 503, { error: '当前内存测试环境不支持备份' });
          return sendResult(response, await backups.createBackup(await readJson(request)), 201);
        }
        if (pathname === '/api/backups/open-location' && request.method === 'POST') {
          if (!backups) return sendJson(response, 503, { error: '当前内存测试环境不支持备份' });
          return sendResult(response, await backups.openLocation());
        }
        if (pathname === '/api/backups/exit-check' && request.method === 'GET') {
          if (!backups) return sendJson(response, 200, { requiresReminder: false });
          return sendJson(response, 200, { requiresReminder: await backups.requiresExitReminder() });
        }
        if (pathname === '/api/backups/exit' && request.method === 'POST') {
          if (!backups) return sendJson(response, 503, { error: '当前内存测试环境不支持备份' });
          const result = await backups.exitDecision(await readJson(request));
          if (result.ok && result.data.canExit) {
            auth.destroySession(request);
            return sendJson(response, 200, result.data, { 'Set-Cookie': expiredSessionCookie });
          }
          return sendResult(response, result);
        }
        const backupMatch = pathname.match(/^\/api\/backups\/([^/]+)\/(verify|restore)$/);
        if (backupMatch) {
          if (!backups) return sendJson(response, 503, { error: '当前内存测试环境不支持备份' });
          const backupId = decodeURIComponent(backupMatch[1]);
          if (request.method === 'POST' && backupMatch[2] === 'verify') return sendResult(response, await backups.verify(backupId));
          if (request.method === 'POST' && backupMatch[2] === 'restore') return sendResult(response, await backups.restore(backupId, await readJson(request)));
        }
        if (pathname === '/api/schools' && request.method === 'GET') {
          const activeValue = url.searchParams.get('active');
          const active = activeValue === null || activeValue === 'all' ? 'all' : activeValue === 'true';
          return sendJson(response, 200, runtime.schools.list({ query: url.searchParams.get('query') || '', active }).data);
        }
        if (pathname === '/api/schools' && request.method === 'POST') {
          const result = runtime.schools.create(await readJson(request));
          return sendJson(response, result.ok ? 201 : result.error.code === 'SIMILAR_SCHOOL' ? 409 : 400, result.ok ? result.data : result.error);
        }
        const schoolMatch = pathname.match(/^\/api\/schools\/([^/]+)(?:\/(project-defaults|status))?$/);
        if (schoolMatch) {
          const schoolId = decodeURIComponent(schoolMatch[1]);
          const action = schoolMatch[2] || '';
          let result;
          if (request.method === 'GET' && action === 'project-defaults') result = runtime.schools.projectDefaults(schoolId);
          else if (request.method === 'GET' && !action) result = runtime.schools.get(schoolId);
          else if (request.method === 'PUT' && !action) result = runtime.schools.update(schoolId, await readJson(request));
          else if (request.method === 'PATCH' && action === 'status') { const body = await readJson(request); result = runtime.schools.setActive(schoolId, body.active); }
          else if (request.method === 'DELETE' && !action) result = runtime.schools.remove(schoolId);
          if (result) return sendJson(response, result.ok ? 200 : result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'SIMILAR_SCHOOL' || result.error.code === 'SCHOOL_IN_USE' ? 409 : 400, result.ok ? result.data : result.error);
        }
        return sendJson(response, 404, { error: '该业务接口尚未实现' });
      }
      await serveStatic(request, response);
    } catch (error) {
      if (error?.code === 'ENOENT') return sendJson(response, 404, { error: '页面不存在' });
      if (error?.message === 'REQUEST_TOO_LARGE') return sendJson(response, 413, { error: '请求内容过大' });
      if (error?.message === 'INVALID_JSON') return sendJson(response, 400, { error: '请求格式错误' });
      sendJson(response, 500, { error: '本地服务发生错误' });
    }
  });
  server.once('close', closeDatabase);
  return server;
}

if (process.env.WORKBENCH_TEST_MODE !== '1') {
  createWorkbenchServer().listen(port, host, () => {
    console.log(`研学派团工作台 v1：http://${host}:${port}`);
    if (allowDevUnlock) console.log('开发解锁口令：local-dev（仅允许脱敏数据）');
  });
}
