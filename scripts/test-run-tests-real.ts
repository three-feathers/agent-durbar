/**
 * Real no-orphan test (spec 008 FR-115): the runner's `--bail` stop on real processes. Tiny fixture suites: one fails once the other is
 * up; the other ignores SIGTERM and has a grandchild that ignores it too and holds the stdio pipes. After the bail the runner must have
 * returned (it must not hang on the pipes) and the grandchild must be gone. POSIX: process group TERM then KILL; Windows: taskkill /T /F
 * (that branch runs only on CI's Windows runner). Only processes this test started are touched. No Electron.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rt = require(path.join(__dirname, '..', '..', 'scripts', 'run-tests.js')) as {
  runSuites: (o: Record<string, unknown>) => Promise<{ failed: string[]; bailed: string | null }>;
};

const alive = (pid: number): boolean => {
  if (process.platform === 'win32') {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8', windowsHide: true });
    return new RegExp(`\\s${pid}\\s`).test(out);
  }
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-real-'));
  const pidFile = path.join(tmp, 'grandchild.pid');
  const grand = path.join(tmp, 'grandchild.js');
  const hang = path.join(tmp, 'hang.js');
  const fail = path.join(tmp, 'fail.js');
  fs.writeFileSync(grand, `process.on('SIGTERM', () => {}); process.on('SIGINT', () => {}); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);\n`);
  fs.writeFileSync(hang, `process.on('SIGTERM', () => {}); require('child_process').spawn(process.execPath, [${JSON.stringify(grand)}], { stdio: 'inherit' }); setInterval(() => {}, 1000);\n`);
  fs.writeFileSync(fail, `const fs = require('fs'); const t = setInterval(() => { if (fs.existsSync(${JSON.stringify(pidFile)}) && fs.readFileSync(${JSON.stringify(pidFile)}, 'utf8')) { console.log('fixture failing'); process.exit(1); } }, 50);\n`);

  let gpid = 0;
  try {
    const t0 = Date.now();
    const out: string[] = [];
    const run = rt.runSuites({
      suites: [{ name: 'test:hang', steps: [[hang]] }, { name: 'test:fail', steps: [[fail]] }, { name: 'test:never', steps: [[hang]] }],
      jobs: 2, bail: true, cwd: tmp, write: (t: string) => out.push(t), stopOpts: { graceMs: 1500 },
    });
    const res = await Promise.race([run, sleep(15000).then(() => 'timeout' as const)]);
    gpid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.ok(gpid > 0, 'the grandchild recorded its pid');
    assert.notStrictEqual(res, 'timeout', 'the runner returned (it did not hang on a grandchild that ignores TERM)');
    assert.ok(Date.now() - t0 < 15000, 'it returned in time');
    const r = res as { failed: string[]; bailed: string | null };
    assert.strictEqual(r.bailed, 'test:fail');
    assert.deepStrictEqual(r.failed, ['test:fail']);
    assert.ok(/fixture failing/.test(out.join('')), 'the failing suite output is printed');
    for (let i = 0; i < 30 && alive(gpid); i++) await sleep(100);
    assert.ok(!alive(gpid), `the grandchild (pid ${gpid}) is gone: no orphan`);
    console.log(`run-tests real stop: ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } finally {
    // only a process this test started, and only when the assertions above failed
    if (!gpid && fs.existsSync(pidFile)) gpid = Number(fs.readFileSync(pidFile, 'utf8')) || 0;
    if (gpid > 0 && alive(gpid)) { try { process.kill(gpid, 'SIGKILL'); } catch (_) { /* gone */ } }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
