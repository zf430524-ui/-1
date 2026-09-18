import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const resultDirectory = join(process.cwd(), '.runtime', 'dev-progress');
const resultPath = join(resultDirectory, 'latest-check.json');
const startedAt = new Date().toISOString();
const timeoutMs = Number(process.env.WORKBENCH_CHECK_TIMEOUT_MS || 10 * 60 * 1000);

await mkdir(resultDirectory, { recursive: true });
await writeFile(resultPath, JSON.stringify({ state: 'running', startedAt }, null, 2));

const command = process.platform === 'win32' ? process.env.ComSpec : 'npm';
const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd run check:base'] : ['run', 'check:base'];
let child;
try {
  child = spawn(command, args, { cwd: process.cwd(), env: process.env, windowsHide: true });
} catch (error) {
  await writeFile(resultPath, JSON.stringify({ state: 'failed', startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(startedAt), exitCode: 1, tests: 0, passed: 0, failed: 0, reason: 'CHECK_PROCESS_START_FAILED' }, null, 2));
  console.error(`无法启动完整检查：${error.message}`);
  process.exit(1);
}
let output = '';
let timedOut = false;

for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => {
    const text = chunk.toString();
    output += text;
    if (output.length > 1024 * 1024) output = output.slice(-1024 * 1024);
    (stream === child.stdout ? process.stdout : process.stderr).write(chunk);
  });
}

const timer = setTimeout(() => {
  timedOut = true;
  child.kill();
}, timeoutMs);

const exitCode = await new Promise((resolve) => {
  child.once('error', () => resolve(1));
  child.once('exit', (code) => resolve(code ?? 1));
});
clearTimeout(timer);

function sum(pattern) {
  return [...output.matchAll(pattern)].reduce((total, match) => total + Number(match[1]), 0);
}

const result = {
  state: timedOut ? 'timed_out' : exitCode === 0 ? 'passed' : 'failed',
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - Date.parse(startedAt),
  exitCode,
  tests: sum(/(?:#|ℹ)\s*tests\s+(\d+)/g),
  passed: sum(/(?:#|ℹ)\s*pass\s+(\d+)/g),
  failed: sum(/(?:#|ℹ)\s*fail\s+(\d+)/g)
};
await writeFile(resultPath, JSON.stringify(result, null, 2));
process.exitCode = timedOut ? 124 : exitCode;
