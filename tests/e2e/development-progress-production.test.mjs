import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForServer(url) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('SERVER_START_TIMEOUT');
}

test('正式启动模式不暴露开发进度页面和接口', async (context) => {
  const port = await availablePort();
  const env = { ...process.env, PORT: String(port), WORKBENCH_UNLOCK_PASSWORD: 'production-progress-test', WORKBENCH_SENSITIVE_KEY: 'production-progress-sensitive-key' };
  delete env.WORKBENCH_TEST_MODE;
  const child = spawn(process.execPath, ['src/server/index.mjs'], { cwd: process.cwd(), env, windowsHide: true, stdio: 'ignore' });
  context.after(async () => {
    child.kill();
    if (child.exitCode === null) await new Promise((resolve) => child.once('exit', resolve));
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(`${base}/api/health`);
  assert.equal((await fetch(`${base}/dev-progress`)).status, 404);
  assert.equal((await fetch(`${base}/api/dev-progress`)).status, 404);
});
