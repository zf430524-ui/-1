import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runtime = mkdtempSync(join(tmpdir(), 'guides-api-e2e-'));
process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'guides-e2e-password';
process.env.WORKBENCH_SENSITIVE_KEY = 'guides-e2e-sensitive-key';
process.env.WORKBENCH_CERTIFICATES_PATH = join(runtime, 'certificates');
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

const fullId = '430102199001011234';
const guideInput = (index) => ({
  name: ['王晨', '李敏', '周妍', '陈浩', '刘芳', '赵琳'][index - 1], workPhone: `1380000000${index}`,
  gender: index % 2 ? '女' : '男', residenceArea: index < 4 ? '长沙' : '株洲', idNumber: fullId,
  guideLicenseNumber: `D-TEST-100${index}`, cooperationStatus: index === 6 ? '停止合作' : '可合作',
  documents: [{ documentType: '身份证', expiresOn: index === 5 ? '' : index === 4 ? '2026-09-14' : index === 3 ? '2026-10-15' : '2027-12-31' },
    { documentType: '导游证', expiresOn: index === 4 ? '2026-09-14' : '2027-12-31' }]
});

test('P14/P15 API 建立 6 名导游、脱敏查询、受控查看和状态维护', async (context) => {
  const server = createWorkbenchServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(runtime, { recursive: true, force: true }); });
  const { port } = server.address(); const base = `http://127.0.0.1:${port}`;
  const baseHeaders = { Host: `127.0.0.1:${port}`, Origin: base, 'Content-Type': 'application/json' };

  assert.equal((await fetch(`${base}/api/guides`, { headers: baseHeaders })).status, 401);
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ password: 'guides-e2e-password' }) });
  const headers = { ...baseHeaders, Cookie: login.headers.get('set-cookie').split(';')[0] };
  const created = [];
  for (let index = 1; index <= 6; index++) {
    const response = await fetch(`${base}/api/guides`, { method: 'POST', headers, body: JSON.stringify(guideInput(index)) });
    assert.equal(response.status, 201); created.push(await response.json());
  }

  const response = await fetch(`${base}/api/guides`, { headers }); const rawList = await response.text(); const list = JSON.parse(rawList);
  assert.equal(list.length, 6);
  for (const forbidden of [fullId, 'D-TEST-1001', 'idNumberProtected', 'guideLicenseProtected', 'controlledFileRef', 'bank']) assert.equal(rawList.includes(forbidden), false, forbidden);
  assert.equal(list.find((guide) => guide.name === '周妍').documentStatuses.身份证, '临期');
  assert.equal(list.find((guide) => guide.name === '陈浩').documentStatuses.导游证, '过期');
  assert.equal(list.find((guide) => guide.name === '刘芳').documentStatuses.身份证, '缺失');

  const rejected = await fetch(`${base}/api/guides/${created[0].id}/sensitive`, { method: 'POST', headers, body: JSON.stringify({ purpose: '', confirmed: false }) });
  assert.equal(rejected.status, 409);
  const revealed = await (await fetch(`${base}/api/guides/${created[0].id}/sensitive`, { method: 'POST', headers, body: JSON.stringify({ purpose: '保险资料人工核对', confirmed: true }) })).json();
  assert.equal(revealed.idNumber, fullId); assert.equal(revealed.guideLicenseNumber, 'D-TEST-1001'); assert.match(revealed.logId, /^log_/);

  const stopped = await (await fetch(`${base}/api/guides/${created[1].id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ cooperationStatus: '停止合作' }) })).json();
  assert.equal(stopped.cooperation_status ?? stopped.cooperationStatus, '停止合作');
  const restored = await (await fetch(`${base}/api/guides/${created[1].id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ cooperationStatus: '可合作' }) })).json();
  assert.equal(restored.cooperation_status ?? restored.cooperationStatus, '可合作');
});
