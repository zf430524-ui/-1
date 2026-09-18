import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const edgePaths = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForValue(read, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (value) return value;
    await delay(50);
  }
  throw new Error('BROWSER_WAIT_TIMEOUT');
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }

  command(method, params = {}) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  async evaluate(expression) {
    const result = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'BROWSER_EVALUATION_FAILED');
    return result.result.value;
  }

  async waitFor(expression, timeoutMs = 10000) {
    return waitForValue(() => this.evaluate(expression), timeoutMs);
  }

  close() { this.socket.close(); }
}

export function findEdge() { return edgePaths.find(existsSync) || ''; }

export async function openHeadlessEdge(edgePath) {
  const profile = mkdtempSync(join(tmpdir(), 'study-tour-edge-'));
  const child = spawn(edgePath, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  const port = await waitForValue(() => {
    try { return Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]); } catch { return 0; }
  });
  const targets = await waitForValue(async () => {
    try { const rows = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); return rows.find((row) => row.type === 'page'); } catch { return null; }
  });
  const client = new CdpClient(targets.webSocketDebuggerUrl);
  await client.connect();
  await client.command('Page.enable');
  await client.command('Runtime.enable');
  await client.command('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  return {
    client,
    async close() {
      client.close();
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
      rmSync(profile, { recursive: true, force: true });
    }
  };
}
