/*
 * The simulator UI checks on any OS (spec 008 FR-091): runs every assertion-bearing driver one after another, with no shell.
 *
 *   npm run check:ui                      (builds first)
 *   node scripts/ui-suite.js --list       the drivers
 *   node scripts/ui-suite.js --only shots-017,shots-033
 *   UI_SUITE_OUT=<folder>                 where every screenshot goes (default: a new temp folder, printed at the end)
 *   UI_SUITE_XVFB=1                       Linux: run under xvfb-run even when a display is set
 *
 * Each driver gets a fresh DURBAR_USER_DATA, its own settings and the same output folder for all screenshot variables. A driver fails on
 * a non-zero exit (a failing driver exits 1, FR-090), a "DRIVER FAILED" line or its time limit. Linux without a display runs under xvfb-run.
 * Simulator only: no real agent session, no account, no AI credits (constitution IV). Prints one line per driver; exits 1 if any failed.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SIM = { DURBAR_SIM: '15', DURBAR_SIM_FREEZE: '1' };

/** Every driver that asserts (not only screenshots), with the settings its header documents. */
const DRIVERS = [
  { name: 'shots-001-welcome', sim: false }, // the first-run screen: no simulator
  { name: 'shots-017' },
  { name: 'shots-018' },
  { name: 'shots-033', env: { DURBAR_SIM_FLOORS: '1' } },
  { name: 'shots-034-list' },
  { name: 'shots-044-everywhere' },
  { name: 'shots-044-templates' },
  { name: 'shots-051-setup' },
  { name: 'shots-052-ux', env: { DURBAR_SIM_KINDS: 'mixed' } },
  { name: 'shots-054-remote' },
  { name: 'shots-006-prevmarks' },
  { name: 'shots-012-signin-chat' },
  { name: 'shots-model', label: 'shots-model 1440', env: { MODEL_W: '1440', MODEL_H: '900' } },
  { name: 'shots-model', label: 'shots-model 1280', env: { MODEL_W: '1280', MODEL_H: '800' } },
  { name: 'check-dialog-focus' },
  { name: 'check-grant-chips' },
  { name: 'check-sched-sendto' },
  { name: 'check-question-options' },
];

/** The screenshot variables the drivers read; all point at one folder. */
const OUT_VARS = ['OUT', 'SHOTS_012', 'SHOTS_021', 'SHOTS_024', 'SHOTS_033', 'SHOTS_034', 'SHOTS_OUT', 'MODEL_OUT', 'CARDMENU_OUT', 'MODE_OUT', 'ABOUT_OUT'];
const TIMEOUT_MS = Number(process.env.UI_SUITE_TIMEOUT_MS || 600_000);

function args() {
  const a = process.argv.slice(2);
  const i = a.indexOf('--only');
  return { list: a.includes('--list'), only: i >= 0 ? new Set(String(a[i + 1] || '').split(',').filter(Boolean)) : undefined };
}

function runOne(d, outDir) {
  const electron = require('electron'); // the binary's path
  const user = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-ui-user-'));
  const env = { ...process.env, ...(d.sim === false ? {} : SIM), ...(d.env || {}), DURBAR_USER_DATA: user, DURBAR_DRIVER: path.join(__dirname, d.name + '.js') };
  if (d.sim === false) { delete env.DURBAR_SIM; delete env.DURBAR_SIM_FREEZE; }
  for (const v of OUT_VARS) env[v] = outDir;
  const argv = [ROOT, '--no-sandbox'];
  const useXvfb = process.platform === 'linux' && (!process.env.DISPLAY || process.env.UI_SUITE_XVFB === '1'); // UI_SUITE_XVFB=1: keep windows off a desktop
  const [file, list] = useXvfb ? ['xvfb-run', ['-a', electron, ...argv]] : [electron, argv];
  return new Promise((resolve) => {
    const started = Date.now();
    let log = '';
    const child = spawn(file, list, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
    const keep = (b) => { log += b.toString(); if (log.length > 400_000) log = log.slice(-200_000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => { log += '\n[ui-suite] time limit reached'; child.kill(); }, TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.rmSync(user, { recursive: true, force: true });
      const failedLine = log.split(/\r?\n/).find((l) => l.includes('DRIVER FAILED') || l.includes('[ui-suite] time limit'));
      resolve({ ok: code === 0 && !failedLine, code, secs: Math.round((Date.now() - started) / 1000), why: failedLine || (code !== 0 ? `exit ${code}` : ''), log });
    });
  });
}

async function main() {
  const a = args();
  const todo = DRIVERS.filter((d) => !a.only || a.only.has(d.name) || a.only.has(d.label || ''));
  if (a.list) { for (const d of DRIVERS) console.log(d.label || d.name); return; }
  for (const d of todo) if (!fs.existsSync(path.join(__dirname, d.name + '.js'))) throw new Error(`no such driver: ${d.name}`);
  const outDir = process.env.UI_SUITE_OUT ? path.resolve(process.env.UI_SUITE_OUT) : fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-ui-shots-'));
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`ui-suite: ${todo.length} drivers on ${process.platform}, screenshots in ${outDir}`);
  const failed = [];
  for (const d of todo) {
    const r = await runOne(d, outDir);
    console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${(d.label || d.name).padEnd(26)} ${String(r.secs).padStart(4)} s${r.ok ? '' : '  ' + r.why.trim().slice(0, 300)}`);
    if (!r.ok) {
      failed.push(d.label || d.name);
      console.log(r.log.split(/\r?\n/).filter((l) => l.trim()).slice(-25).map((l) => '      | ' + l.slice(0, 240)).join('\n'));
    }
  }
  console.log(`\nui-suite: ${todo.length - failed.length}/${todo.length} passed on ${process.platform}${failed.length ? '; failed: ' + failed.join(', ') : ''}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error('ui-suite:', e.message); process.exitCode = 1; });
