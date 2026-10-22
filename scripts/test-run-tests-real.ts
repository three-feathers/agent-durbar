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
import { execFileSync, spawn } from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rt = require(path.join(__dirname, '..', '..', 'scripts', 'run-tests.js')) as {
  runSuites: (o: Record<string, unknown>) => Promise<{ failed: string[]; bailed: string | null }>;
  runMain: unknown;
};

const alive = (pid: number): boolean => {
  if (process.platform === 'win32') {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8', windowsHide: true });
    return new RegExp(`\\s${pid}\\s`).test(out);
  }
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};
const GRAND_SRC = "process.on('SIGTERM', () => {}); process.on('SIGINT', () => {}); require('fs').writeFileSync(process.env.PIDFILE, String(process.pid)); setInterval(() => {}, 1000);\n";
const HANG_SRC = "process.on('SIGTERM', () => {}); require('child_process').spawn(process.execPath, [process.env.GRAND], { stdio: 'inherit' }); setInterval(() => {}, 1000);\n";
const FAIL_SRC = "const fs = require('fs'); setInterval(() => { if (fs.existsSync(process.env.PIDFILE) && fs.readFileSync(process.env.PIDFILE, 'utf8')) { console.log('fixture failing'); process.exit(1); } }, 50);\n";
// the driver runs the real runner wiring (handlers, exit code) on one slow suite; the slow suite records its pid and waits
const DRIVER_SRC = "require(process.env.RUNNER).runMain({ suites: [{ name: 'test:slow', steps: [[process.env.SLOW]] }], jobs: 1, bail: true });\n";
const SLOW_SRC = "require('fs').writeFileSync(process.env.PIDFILE, String(process.pid)); setInterval(() => {}, 1000);\n";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-real-'));
  const pidFile = path.join(tmp, 'grandchild.pid');
  const grand = path.join(tmp, 'grandchild.js');
  const hang = path.join(tmp, 'hang.js');
  const fail = path.join(tmp, 'fail.js');
  // the fixture code is constant text; paths reach it through the environment at run time
  fs.writeFileSync(grand, GRAND_SRC);
  fs.writeFileSync(hang, HANG_SRC);
  fs.writeFileSync(fail, FAIL_SRC);
  const env = { ...process.env, PIDFILE: pidFile, GRAND: grand };

  let gpid = 0;
  try {
    const t0 = Date.now();
    const out: string[] = [];
    const run = rt.runSuites({
      suites: [{ name: 'test:hang', steps: [[hang]] }, { name: 'test:fail', steps: [[fail]] }, { name: 'test:never', steps: [[hang]] }],
      jobs: 2, bail: true, cwd: tmp, env, write: (t: string) => out.push(t), stopOpts: { graceMs: 1500 },
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
  // Ctrl-C / hangup / kill of a bailing runner: exit 128 + the signal number (not 1), and the suite is stopped (POSIX only)
  if (process.platform === 'win32') console.log('run-tests signal exit code: skipped on Windows (no POSIX signals; taskkill is covered above)');
  else {
    for (const [sig, want] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]] as const) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-sig-'));
      const slowPid = path.join(dir, 'slow.pid');
      fs.writeFileSync(path.join(dir, 'driver.js'), DRIVER_SRC);
      fs.writeFileSync(path.join(dir, 'slow.js'), SLOW_SRC);
      const runner = spawn(process.execPath, [path.join(dir, 'driver.js')], {
        env: { ...process.env, RUNNER: path.join(__dirname, '..', '..', 'scripts', 'run-tests.js'), SLOW: path.join(dir, 'slow.js'), PIDFILE: slowPid }, stdio: 'ignore',
      });
      let spid = 0;
      try {
        for (let i = 0; i < 100 && !(fs.existsSync(slowPid) && fs.readFileSync(slowPid, 'utf8')); i++) await sleep(100);
        spid = Number(fs.readFileSync(slowPid, 'utf8'));
        assert.ok(spid > 0, `${sig}: the slow suite started`);
        const exited = new Promise<number | string>((resolve) => runner.on('exit', (code, sg) => resolve(code === null ? String(sg) : code)));
        runner.kill(sig); // the runner this test started
        const code = await Promise.race([exited, sleep(15000).then(() => 'timeout')]);
        assert.strictEqual(code, want, `${sig} to a bailing runner exits ${want}`);
        for (let i = 0; i < 30 && alive(spid); i++) await sleep(100);
        assert.ok(!alive(spid), `${sig}: the slow suite (pid ${spid}) is gone: no orphan`);
        console.log(`run-tests signal exit code: ${sig} -> ${want} ok`);
      } finally {
        if (runner.exitCode === null && runner.signalCode === null) runner.kill('SIGKILL');
        if (spid > 0 && alive(spid)) { try { process.kill(spid, 'SIGKILL'); } catch (_) { /* gone */ } }
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
