/*
 * The simulator UI checks on any OS (spec 008 FR-091): runs every assertion-bearing driver one after another, with no shell.
 *
 *   npm run check:ui                      (builds first)
 *   node scripts/ui-suite.js --list       the drivers
 *   node scripts/ui-suite.js --only shots-017,shots-033
 *   UI_SUITE_OUT=<folder>                 where every screenshot goes (default: a new temp folder, printed at the end)
 *   UI_SUITE_XVFB=1                       Linux: run under xvfb-run even when a display is set
 *   UI_SUITE_JOBS=<n>                     drivers at once (default 2; each has its own profile and, on Linux, its own xvfb display)
 *   UI_SUITE_RETRY=1                      run each failed driver once more, alone, at the end; a pass then is reported as FLAKY
 *                                         (listed in the summary and the GitHub job summary), never as a clean pass
 *
 * Each driver gets a fresh DURBAR_USER_DATA, its own settings and the same output folder for all screenshot variables. A driver fails on
 * a non-zero exit (a failing driver exits 1, FR-090), a "DRIVER FAILED" line or its time limit. Before any Electron starts, every
 * selected driver and the shared helpers get a `node --check` syntax pass (spec 008 FR-112): a syntax error used to hang Electron with no
 * DRIVER FAILED line until the time limit. Then Electron is installed once (scripts/ensure-electron.js, FR-114), so parallel drivers never
 * race to fetch it. Linux without a display runs under xvfb-run.
 * Simulator only: no real agent session, no account, no AI credits (constitution IV). Prints one line per driver; exits 1 if any failed.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { ensureElectron } = require('./ensure-electron');

const ROOT = path.join(__dirname, '..');
const SIM = { DURBAR_SIM: '15', DURBAR_SIM_FREEZE: '1' };

/** Every driver that asserts (not only screenshots), with the settings its header documents. */
const DRIVERS = [
  { name: 'shots-001-welcome', sim: false }, // the first-run screen: no simulator
  { name: 'check-office-fill' }, // spec 001 FR-041..FR-046: grown desks with few agents (its own sim, simrooms and simhelpers per layout)
  { name: 'shots-017' },
  { name: 'shots-018' },
  { name: 'shots-033', env: { DURBAR_SIM_FLOORS: '1' } },
  { name: 'shots-033-move', env: { DURBAR_SIM_FLOORS: '1' } }, // spec 033 FR-024 (#590): Move to floor in the folder menu, with Undo
  { name: 'shots-034-list' },
  { name: 'shots-044-everywhere' },
  { name: 'shots-044-templates' },
  // spec 060 FR-002: the per-OS assertion needs a known manager set, the one the driver expects for the host OS (a real Windows host
  // has PowerShell; winget,brew,npm there hid the PowerShell route and failed the check)
  { name: 'shots-051-setup', env: { DURBAR_SIM_MANAGERS: process.platform === 'win32' ? 'powershell,winget,npm' : 'winget,brew,npm' } },
  { name: 'shots-051-setup', label: 'shots-051-setup win32', env: { DURBAR_SIM_MANAGERS: 'powershell,winget,npm', DURBAR_SIM_PLATFORM: 'win32' } }, // spec 060 FR-011/FR-012: Windows' routes (PowerShell installer, winget, npm) and Run beside each command, on every OS
  { name: 'shots-052-ux', env: { DURBAR_SIM_KINDS: 'mixed' } },
  { name: 'shots-052-addleft' }, // FR-164: + Folder / + Workspace leftmost, one row in every theme, the File menu and Ctrl+O
  { name: 'shots-054-remote' },
  { name: 'shots-006-prevmarks' },
  { name: 'shots-003-mode-back' },
  { name: 'shots-012-signin-chat' },
  { name: 'shots-058-mcp-restart' }, // spec 058: per-server Restart and Restart session with these servers
  { name: 'shots-058-mcp-signin' }, // spec 058 T102/T104: Sign in for a Copilot server that needs it (simmcpauth), the two-step open, the steps
  { name: 'shots-058-mcp-words' }, // spec 058 T113-T115: state words, hints, Details and live refresh in the MCP dialog
  { name: 'shots-058-mcp-settings' }, // spec 058 FR-080..FR-086 (#596): live MCP state over the running chats in Settings
  { name: 'shots-model', label: 'shots-model 1440', env: { MODEL_W: '1440', MODEL_H: '900' } },
  { name: 'shots-model', label: 'shots-model 1280', env: { MODEL_W: '1280', MODEL_H: '800' } },
  { name: 'shots-043-editor' }, // spec 043 FR-014: the profile file editor (modes, split widths, save round trip, unsaved guard)
  { name: 'shots-043-ai' }, // spec 043 FR-026..FR-039: Create with AI (canned generation, Extra tools, Stop waiting, Cancel and reopen)
  { name: 'shots-043-manage' }, // spec 043 FR-040..FR-042: nothing written before Save, the Profile menu refreshes at once, Delete from the menu and Settings
  { name: 'check-dialog-focus' },
  { name: 'check-grant-chips' },
  { name: 'check-sched-sendto' },
  { name: 'check-sched-edit' },
  { name: 'check-question-options' },
  { name: 'check-question-visible' },
  { name: 'check-sim-guard' }, // spec 010 FR-026: the real preload API is refused by main under DURBAR_SIM
  { name: 'shots-069-mcp-global' }, // spec 069: add to the agent apps' own lists, review, remove, source chips
  { name: 'shots-069-harmonize' }, // spec 069 part 2: copy servers between the agent apps' lists
  { name: 'shots-069-mcp-tools' }, // spec 069 part 3: tools on expand, Remove in the agent dialog (058's state words and Details stay)
  { name: 'shots-059-long-url' }, // spec 059 FR-019: a long unbroken name stays in its card, the inbox and the Schedules rows
  { name: 'check-activity-table' }, // spec 052 FR-071 delta 2026-10-21 (#474): Tools > Activity renders its rows
  { name: 'check-codex-file-card' }, // spec 052 FR-172: a Codex write card names the files and shows the change
  { name: 'check-theme-art' }, // spec 040 FR-023: a picked theme's characters and gadgets on desks, walkers, places and chips
  { name: 'check-composer-toolbar' }, // spec 005 FR-037..FR-043: chat settings under the message box, one Send / Stop slot
  { name: 'check-slash-suggest' }, // spec 073: the "/" list in the message box (keyboard, ARIA, geometry)
  { name: 'check-edits' }, // spec 005 FR-020..FR-026: file edits in the chat
  { name: 'shots-068-coffee' }, // spec 068: coffee break (simbreak=8 in its own query)
  { name: 'shots-001-lobby' }, // spec 001 FR-034..FR-040: Boss queue, Bank, Postbox and its letter, who is at a place (simsched in its own query)
  { name: 'check-done-desk-mask' }, // spec 041 FR-065: no token of a done reply on the office floor
  { name: 'check-ui-text' }, // spec 052 FR-171: wrapping, sizes, box widths, field weight, dark contrast
  { name: 'shots-074-navigator', env: { DURBAR_SIM_FLOORS: '1' } }, // spec 074: Go to (keyboard navigator), chat numbers, the shortcut in Settings
];

/** The screenshot variables the drivers read; all point at one folder. */
const OUT_VARS = ['OUT', 'SHOTS_012', 'SHOTS_021', 'SHOTS_024', 'SHOTS_033', 'SHOTS_034', 'SHOTS_OUT', 'MODEL_OUT', 'CARDMENU_OUT', 'MODE_OUT', 'ABOUT_OUT', 'HERO_OUT', 'SHOTS_DIR'];
const TIMEOUT_MS = Number(process.env.UI_SUITE_TIMEOUT_MS || 600_000);

function args(a = process.argv.slice(2)) {
  const i = a.indexOf('--only');
  return { list: a.includes('--list'), only: i >= 0 ? new Set(String(a[i + 1] || '').split(',').filter(Boolean)) : undefined };
}

/** Spec 008 FR-112: syntax errors in the given files, from `node --check` (no shell, nothing run). [] when all parse. */
function syntaxErrors(files) {
  const out = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8', shell: false, windowsHide: true });
    if (r.status !== 0) out.push({ file: path.relative(ROOT, f), error: String(r.stderr || r.error || `exit ${r.status}`).trim() });
  }
  return out;
}

function runOne(d, outDir) {
  const electron = require('electron'); // the binary's path
  const user = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-ui-user-'));
  const env = { ...process.env, ...(d.sim === false ? {} : SIM), ...(d.env || {}), DURBAR_USER_DATA: user, DURBAR_DRIVER: path.join(__dirname, d.name + '.js') };
  if (d.sim === false) { delete env.DURBAR_SIM; delete env.DURBAR_SIM_FREEZE; }
  if (d.freeze === false) delete env.DURBAR_SIM_FREEZE; // a driver that needs the live simulator (spec 001 FR-082: shots-docs.js)
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

/** `ensure`, `run` and `argv` are for tests (scripts/test-ui-suite.ts); the defaults install Electron and start the real drivers. */
async function main({ ensure = ensureElectron, run = runOne, argv } = {}) {
  const a = args(argv);
  const todo = DRIVERS.filter((d) => !a.only || a.only.has(d.name) || a.only.has(d.label || ''));
  if (a.list) { for (const d of DRIVERS) console.log(d.label || d.name); return; }
  for (const d of todo) if (!fs.existsSync(path.join(__dirname, d.name + '.js'))) throw new Error(`no such driver: ${d.name}`);
  // FR-112: fail at once on a syntax error instead of a silent Electron hang until the time limit
  const bad = syntaxErrors([...new Set(todo.map((d) => path.join(__dirname, d.name + '.js')).concat(path.join(__dirname, 'driver-helpers.js')))]);
  if (bad.length) {
    for (const b of bad) console.error(`ui-suite: syntax error in ${b.file}\n${b.error.split(/\r?\n/).map((l) => '      | ' + l).join('\n')}`);
    throw new Error(`${bad.length} file(s) do not parse: ${bad.map((b) => b.file).join(', ')}; no driver was started`);
  }
  // FR-114: install Electron once before the drivers start in parallel (two first runs racing on the same binary fail, PR #546)
  if (!ensure()) throw new Error('the Electron binary is not installed and could not be fetched (see above); no driver was started');
  const outDir = process.env.UI_SUITE_OUT ? path.resolve(process.env.UI_SUITE_OUT) : fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-ui-shots-'));
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`ui-suite: ${todo.length} drivers on ${process.platform}, screenshots in ${outDir}`);
  // fast checks (owner rule): in parallel, never fewer checks; each driver has its own profile and window (own xvfb display on Linux)
  const jobs = Math.max(1, Math.min(6, Number(process.env.UI_SUITE_JOBS || 2) || 2));
  const failed = [];
  const started = Date.now();
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const d = todo[next++];
      const r = await run(d, outDir);
      console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${(d.label || d.name).padEnd(26)} ${String(r.secs).padStart(4)} s${r.ok ? '' : '  ' + r.why.trim().slice(0, 300)}`);
      if (!r.ok) {
        failed.push(d.label || d.name);
        console.log(r.log.split(/\r?\n/).filter((l) => l.trim()).slice(-25).map((l) => '      | ' + l.slice(0, 240)).join('\n'));
      }
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  // a slow runner (macOS in CI) can lose a race against a fixed delay: one more run alone, reported as FLAKY so it stays visible
  const flaky = [];
  if (process.env.UI_SUITE_RETRY === '1' && failed.length) {
    for (const label of [...failed]) {
      const d = todo.find((x) => (x.label || x.name) === label);
      const r = await run(d, outDir);
      console.log(`  ${r.ok ? 'FLAKY (passed on retry)' : 'FAIL again'} ${label}${r.ok ? '' : '  ' + r.why.trim().slice(0, 300)}`);
      if (r.ok) { failed.splice(failed.indexOf(label), 1); flaky.push(label); }
    }
  }
  console.log(`ui-suite: ${jobs} at a time, ${Math.round((Date.now() - started) / 1000)} s in all`);
  console.log(`\nui-suite: ${todo.length - failed.length}/${todo.length} passed on ${process.platform}${flaky.length ? '; FLAKY (passed only on retry): ' + flaky.join(', ') : ''}${failed.length ? '; failed: ' + failed.join(', ') : ''}`);
  if (flaky.length && process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n**Flaky drivers on ${process.platform}** (failed once, passed on retry): ${flaky.join(', ')}\n`);
  if (failed.length) process.exitCode = 1;
}

module.exports = { syntaxErrors, main, runOne, DRIVERS }; // runOne: also spec 001 FR-082 (scripts/shots-docs.js)
if (require.main === module) main().catch((e) => { console.error('ui-suite:', e.message); process.exitCode = 1; });
