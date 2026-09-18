import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'tables-e2e-password';
process.env.WORKBENCH_SENSITIVE_KEY = 'tables-e2e-sensitive-key';
const runtimeRoot = mkdtempSync(join(tmpdir(), 't25-api-runtime-'));
process.env.WORKBENCH_RUNTIME_ROOT = runtimeRoot;
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('P16/P17 API 跑通检查、脱敏预览、条件隐藏和旧版本失效', async (context) => {
  const server = createWorkbenchServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(runtimeRoot, { recursive: true, force: true }); });
  const port = server.address().port; const base = `http://127.0.0.1:${port}`; const baseHeaders = { Host: `127.0.0.1:${port}`, Origin: base, 'Content-Type': 'application/json' };
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ password: 'tables-e2e-password' }) });
  const headers = { ...baseHeaders, Cookie: login.headers.get('set-cookie').split(';')[0] };
  const request = async (method, path, body) => { const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); return { response, data: await response.json() }; };
  const post = (path, body) => request('POST', path, body);
  const school = (await post('/api/schools', { name: 'T24 API 脱敏学校', contacts: [{ name: '联系人', phone: '13800002410', isDefault: true }] })).data;
  const project = (await post('/api/projects', { id: 't24-api', schoolId: school.id, grade: '八年级', destination: '脱敏基地', startsOn: '2026-10-10', endsOn: '2026-10-10', meetingPlace: '学校门口', meetingAt: '2026-10-10T07:00', itinerary: '脱敏行程' })).data;
  const peoplePayload = { classes: [{ id: 't24-api-c1', name: '801', studentTotal: 10, boys: 5, girls: 5, guideRequired: 1,
    teachers: [{ id: 't24-api-t1', name: '测试老师', phone: '13800002411', gender: '女', ridesVehicle: true }] }], manualStaff: [] };
  const people = (await post(`/api/projects/${project.id}/people`, peoplePayload)).data;
  const fullId = '430102199001011234'; const license = 'D-T24-0001';
  const guide = (await post('/api/guides', { name: '测试导游', workPhone: '13900002411', gender: '女', idNumber: fullId, guideLicenseNumber: license,
    documents: [{ documentType: '身份证', expiresOn: '2027-12-31' }, { documentType: '导游证', expiresOn: '2027-12-31' }] })).data;
  const batch = (await post(`/api/projects/${project.id}/recruitment`, { rawText: 'T24 API 接龙', entries: [{ order: 1, name: guide.name, phone: '13900002411' }] })).data;
  await post(`/api/project-guides/${batch.rows[0].id}/assign`, { classIds: [people.classes[0].id] });
  const vehicle = { vehicleLabel: '1车', fleetName: '脱敏车队', vehicleModel: '20座大巴', plateNumber: '湘A24101', capacity: 20, driverName: '测试司机', driverPhone: '13700002411', driverGender: '男' };
  const suggestion = (await post(`/api/projects/${project.id}/transport/suggest`, { vehicles: [vehicle] })).data;
  await post(`/api/projects/${project.id}/transport`, { vehicles: suggestion.vehicles });

  const center = await post(`/api/projects/${project.id}/tables/check`, {});
  assert.equal(center.response.status, 200);
  assert.deepEqual(center.data.tables.map((row) => [row.type, row.status]), [['insurance','ready'],['transport','ready']]);
  const insurance = await post(`/api/projects/${project.id}/table-previews/insurance`, {});
  assert.equal(insurance.response.status, 200);
  assert.equal(JSON.stringify(insurance.data).includes(fullId), false);
  assert.equal(JSON.stringify(insurance.data).includes(license), false);
  const transport = await post(`/api/projects/${project.id}/table-previews/transport`, {});
  assert.deepEqual(transport.data.totals, { vehicles: 1, students: 10, teachers: 1, guides: 1, people: 12, seats: 20, emptySeats: 8 });
  const insuranceExport = await post(`/api/projects/${project.id}/exports/insurance`, { previewVersion: insurance.data.dataVersion, purpose: 'E2E 脱敏保险验收', confirmed: true });
  assert.equal(insuranceExport.response.status, 201); assert.equal(JSON.stringify(insuranceExport.data).includes(fullId), false); assert.match(insuranceExport.data.downloadUrl, /^\/api\/exports\/.+\/download$/);
  const insuranceDownload = await fetch(`${base}${insuranceExport.data.downloadUrl}`, { headers });
  assert.equal(insuranceDownload.status, 200); assert.match(insuranceDownload.headers.get('content-type'), /spreadsheetml/);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await insuranceDownload.arrayBuffer());
  assert.equal(workbook.worksheets[0].getCell('B5').text, fullId); assert.equal(workbook.worksheets[0].getCell('D5').text, license);
  const transportExport = await post(`/api/projects/${project.id}/exports/transport`, { previewVersion: transport.data.dataVersion });
  assert.equal(transportExport.response.status, 201);

  peoplePayload.classes[0].studentTotal = 11; peoplePayload.classes[0].girls = 6;
  await post(`/api/projects/${project.id}/people`, peoplePayload);
  const status = await request('GET', `/api/projects/${project.id}/table-previews/transport/status?version=${transport.data.dataVersion}`);
  assert.deepEqual({ stale: status.data.stale, previewVersion: status.data.previewVersion > 0, versionAdvanced: status.data.currentVersion > transport.data.dataVersion }, { stale: true, previewVersion: true, versionAdvanced: true });
  const staleExport = await post(`/api/projects/${project.id}/exports/transport`, { previewVersion: transport.data.dataVersion });
  assert.equal(staleExport.response.status, 409); assert.equal(staleExport.data.code, 'PREVIEW_STALE');
  const staleDownload = await fetch(`${base}${transportExport.data.downloadUrl}`, { headers });
  assert.equal(staleDownload.status, 409); assert.equal((await staleDownload.json()).code, 'EXPORT_NOT_CURRENT');
});
