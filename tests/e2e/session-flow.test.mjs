import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WORKBENCH_TEST_MODE = '1';
process.env.WORKBENCH_UNLOCK_PASSWORD = 'e2e-password';
const { createWorkbenchServer } = await import('../../src/server/index.mjs');

test('未解锁不能访问业务 API，解锁后可访问，退出后再次失效', async (context) => {
  const server = createWorkbenchServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Host: `127.0.0.1:${address.port}`, Origin: `http://127.0.0.1:${address.port}` };

  const locked = await fetch(`${base}/api/projects`, { headers });
  assert.equal(locked.status, 401);

  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'e2e-password' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const protectedRequest = await fetch(`${base}/api/projects`, { headers: { ...headers, Cookie: cookie } });
  assert.equal(protectedRequest.status, 200);
  assert.deepEqual(await protectedRequest.json(), []);

  const logout = await fetch(`${base}/api/session`, { method: 'DELETE', headers: { ...headers, Cookie: cookie } });
  assert.equal(logout.status, 200);
  const lockedAgain = await fetch(`${base}/api/projects`, { headers: { ...headers, Cookie: cookie } });
  assert.equal(lockedAgain.status, 401);
});
