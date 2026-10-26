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
  { name: 'shots-017-signs' }, // spec 017 FR-003..FR-009: meeting-room door signs on session desks (word, icon, colour, contrast in 6 themes, fit)
  { name: 'shots-018' },
  { name: 'shots-033', env: { DURBAR_SIM_FLOORS: '1' } },
  { name: 'shots-033-move', env: { DURBAR_SIM_FLOORS: '1' } }, // spec 033 FR-024 (#590): Move to floor in the folder menu, with Undo
  { name: 'shots-034-list' },
  { name: 'shots-015-compact' }, // spec 015 FR-014: Compacting on the desk, list, header, strip and ring (simcompact=1 in its own query)
  { name: 'shots-034-retry' }, // spec 034 FR-021: Retrying and Gave up (simretry=1 in its own query)
  { name: 'check-unread' }, // spec 001 FR-170..FR-177, spec 005 FR-176/FR-177 (issue #691): a finished agent's reply stays marked New until its chat is shown
  { name: 'check-rename-inline' }, // spec 059 FR-027 (issue #636): rename in place on every surface, Expert and Simple, both sizes
  { name: 'check-session-summary' }, // spec 085 FR-003/FR-007: the card shown in the chat when a session ends (simsummary=1), both sizes
  { name: 'shots-044-everywhere' },
  { name: 'shots-044-templates' },
  // spec 060 FR-002: the per-OS assertion needs a known manager set, the one the driver expects for the host OS (a real Windows host
  // has PowerShell; winget,brew,npm there hid the PowerShell route and failed the check)
  { name: 'shots-051-setup', env: { DURBAR_SIM_MANAGERS: process.platform === 'win32' ? 'powershell,winget,npm' : 'winget,brew,npm' } },
  { name: 'shots-081-updates' }, // spec 081: agent-app update check and update, canned results, no network
  { name: 'shots-051-account' }, // spec 051 FR-013: the signed-in account line, the picker tooltips and About agent apps (a fake identity)
  { name: 'shots-051-setup', label: 'shots-051-setup win32', env: { DURBAR_SIM_MANAGERS: 'powershell,winget,npm', DURBAR_SIM_PLATFORM: 'win32' } }, // spec 060 FR-011/FR-012: Windows' routes (PowerShell installer, winget, npm) and Run beside each command, on every OS
  { name: 'shots-052-ux', env: { DURBAR_SIM_KINDS: 'mixed' } },
  { name: 'shots-052-addleft' }, // FR-164: + Folder / + Workspace leftmost, one row in every theme, the File menu and Ctrl+O
  { name: 'shots-054-remote' },
  { name: 'shots-006-prevmarks' },
  { name: 'shots-003-mode-back' },
  { name: 'check-sandbox-floor' }, // spec 087: the OS sandbox chip, tooltips, note (Continue / Always / Change mode…), Codex card line, Settings line
  { name: 'shots-012-signin-chat' },
  { name: 'shots-058-mcp-restart' }, // spec 058: per-server Restart and Restart session with these servers
  { name: 'shots-058-mcp-signin' }, // spec 058 T102/T104: Sign in for a Copilot server that needs it (simmcpauth), the two-step open, the steps
  { name: 'shots-058-mcp-words' }, // spec 058 T113-T115: state words, hints, Details and live refresh in the MCP dialog
  { name: 'shots-058-mcp-settings' }, // spec 058 FR-080..FR-086 (#596): live MCP state over the running chats in Settings
  { name: 'shots-076-orgpolicy' }, // spec 076 FR-202..FR-205 (#602): what the agent app's own organization policy blocks, greyed with the reason
  { name: 'shots-058-mcp-health' }, // spec 058 FR-090..FR-096 (#603): failure reason, when, Copy diagnostics (masked), the MCP chip dot
  { name: 'shots-model', label: 'shots-model 1440', env: { MODEL_W: '1440', MODEL_H: '900' } },
  { name: 'shots-model', label: 'shots-model 1280', env: { MODEL_W: '1280', MODEL_H: '800' } },
  { name: 'shots-007-autotier' }, // spec 007 FR-013..FR-018 (#607): the Auto routing tier in the model menu, confirm, Undo, the organization lock
  { name: 'shots-043-editor' }, // spec 043 FR-014: the profile file editor (modes, split widths, save round trip, unsaved guard)
  { name: 'shots-043-ai' }, // spec 043 FR-026..FR-039: Create with AI (canned generation, Extra tools, Stop waiting, Cancel and reopen)
  { name: 'shots-043-manage' }, // spec 043 FR-040..FR-042: nothing written before Save, the Profile menu refreshes at once, Delete from the menu and Settings
  { name: 'check-dialog-focus' },
  { name: 'check-grant-chips' },
  { name: 'check-sched-sendto' },
  { name: 'check-sched-edit' },
  { name: 'check-sched-top' }, // spec 044 FR-027..FR-035: the top-bar Schedules button
  { name: 'check-question-options' },
  { name: 'check-question-visible' },
  { name: 'check-chat-no-scroll' },
  { name: 'check-sim-guard' }, // spec 010 FR-026: the real preload API is refused by main under DURBAR_SIM
  { name: 'shots-069-mcp-global' }, // spec 069: add to the agent apps' own lists, review, remove, source chips
  { name: 'shots-069-harmonize' }, // spec 069 part 2: copy servers between the agent apps' lists
  { name: 'shots-069-mcp-tools' }, // spec 069 part 3: tools on expand, Remove in the agent dialog (058's state words and Details stay)
  { name: 'shots-059-long-url' }, // spec 059 FR-019: a long unbroken name stays in its card, the inbox and the Schedules rows
  { name: 'check-activity-table' }, // spec 052 FR-071 delta 2026-10-21 (#474): Tools > Activity renders its rows
  { name: 'check-codex-file-card' }, // spec 052 FR-172: a Codex write card names the files and shows the change
  { name: 'check-theme-art' }, // spec 040 FR-023: a picked theme's characters and gadgets on desks, walkers, places and chips
  { name: 'check-crew' }, // spec 077: Cheeky Crew portraits: box vs protected zones, pose, sharpness, the fallback with a picture removed
  { name: 'check-permission-scope' }, // spec 003 FR-108: the approval card says how far "for this session" reaches
  { name: 'check-ro-ask' }, // spec 003 FR-094..FR-097: a Read-only denial's "Switch to Ask first…" opens the mode menu
  { name: 'check-why-allowed' }, // spec 003 FR-099..FR-105 (#605): the why-allowed tag on tool cards and Undo this rule
  { name: 'check-composer-toolbar' }, // spec 005 FR-037..FR-043: chat settings under the message box, one Send / Stop slot
  { name: 'check-slash-suggest' }, // spec 073: the "/" list in the message box (keyboard, ARIA, geometry)
  { name: 'check-notes' }, // spec 083: save a message, the Notes drawer, Insert and notes in the "/" list (US1 scenarios 1..6, SC-001, SC-002)
  { name: 'check-notes-count' }, // spec 083 T030..T032: the header count, the marker on a saved message, the drawer's search (SC-005)
  { name: 'check-edits' }, // spec 005 FR-020..FR-026: file edits in the chat
  { name: 'shots-068-coffee' }, // spec 068: coffee break (simbreak=8 in its own query)
  { name: 'shots-001-lobby' }, // spec 001 FR-034..FR-040: Boss queue, Bank, Postbox and its letter, who is at a place (simsched in its own query)
  { name: 'check-done-desk-mask' }, // spec 041 FR-065: no token of a done reply on the office floor
  // spec 052 FR-171: wrapping, sizes, box widths, field weight, dark contrast. Two drivers that run at once (issue #738: one took ~650 s
  // against the 600 s limit); the light part also has the six built-in themes' contrast, the dark part the tones and the stylesheet check
  { name: 'check-ui-text', label: 'check-ui-text light', env: { UITEXT_PART: 'light' } },
  { name: 'check-ui-text', label: 'check-ui-text dark', env: { UITEXT_PART: 'dark' } },
  { name: 'shots-006-crash' }, // spec 006 FR-038..FR-046 (#606): the crash card (Resume all, Pick…, Dismiss), per-row resume, the lost-turn note
  { name: 'shots-074-navigator', env: { DURBAR_SIM_FLOORS: '1' } }, // spec 074: Go to (keyboard navigator), chat numbers, the shortcut in Settings
  { name: 'check-browser-dialogs', env: { DURBAR_SIM_BROWSER_CONSENT: 'ask' } }, // spec 080 T015 AC6: the once-per-app consent, Leave this page?, a hidden session's page dialog (toast, chat forward once, marker)
  { name: 'check-browser-dialogs', label: 'check-browser-dialogs 1280', env: { DURBAR_SIM_BROWSER_CONSENT: 'ask', BROWSER_DIALOGS_SIZE: '1280x800' } }, // the same at 1280x800: the note, Leave this page?, the hidden dialog's toast
  { name: 'check-browser-tab' }, // spec 080 T014/T015/T018: Chat | Browser tabs, the bar, the native view's attach and detach, the simulator's test pages, two sessions' own views
  // issue #748 (spec 021 FR-057): drivers that asserted but nothing ran, each passing alone on the simulator (seconds on a 4-core Linux box)
  { name: 'check-checkpoints' }, // spec 065 FR-003/FR-004/FR-007: the note after a turn that changed files, preview, restore, Undo the undo, the refusal (~21 s)
  { name: 'check-mode-refusal' }, // spec 012 FR-087: Codex refusing Read-only / Ask first (simsendfail=sandbox) (~14 s)
  { name: 'check-plan-mode' }, // spec 066: Plan first (next message), the chip, the plan card with Approve / Revise / Reject (~18 s)
  { name: 'shots-006-continue' }, // spec 006 FR-021: a folder continues its last session after a restart (~12 s)
  { name: 'shots-006-remove' }, // spec 006 FR-022: removing a folder is easy to find, Cancel keeps it (~26 s)
  { name: 'shots-012-elicit' }, // spec 012 FR-151..FR-155: an MCP elicitation as a form in the question card, and the URL mode (~28 s)
  { name: 'shots-021' }, // spec 011 FR-026..FR-029: usage totals kept across restarts, the reset, "credits not reported" (~29 s)
  { name: 'shots-030-handover' }, // spec 030 FR-042..FR-045: continue a conversation in another agent app (mixed agent apps) (~20 s)
  { name: 'shots-043-default' }, // spec 043 FR-009: the folder's default agent in the New session dialog (~28 s)
  { name: 'shots-061-foldersetup' }, // spec 061: the folder-setup dialog (simfoldersetup=1) (~18 s)
  { name: 'shots-i7' }, // spec 020 FR-020..FR-031: the per-folder Import from VS Code action (~31 s)
  { name: 'shots-m9' }, // spec 011: the credit cap (~29 s)
  { name: 'shots-m10' }, // spec 020: Tools This session / All time, MCP extras per folder, the agent MCP dialog (~37 s)
];

/**
 * Drivers that assert, pass by hand on the simulator and are on purpose NOT in DRIVERS, each with the reason (issue #748, spec 021 FR-057).
 * scripts/test-ui-suite.ts fails on an asserting scripts/check-*.js or shots-*.js that is in neither DRIVERS, shots-docs' DOC_SHOTS nor here,
 * so a driver can no longer be written, cited as `sim:` evidence and never run. Moving one into DRIVERS is the way out of this list.
 */
const NOT_IN_SUITE = {
  'shots-034': 'passes alone but takes about 124 s (fixed settles at both sizes, Serious mode, reduced motion, mini); CI is near its limit (#738). Needs its sleeps turned into until() waits before it joins the suite. Since spec 068 FR-005 it checks that the credit limit is a break, not a faint',
  'shots-024-custom': 'passes alone with DURBAR_SIM_PLACES=3 but takes about 89 s (custom places: seeding, Add / Edit dialog, Settings, rename, delete at both sizes); too long for the suite today. Run it by hand: DURBAR_SIM_PLACES=3 as its header says',
  'check-rename': 'npm run check:rename, about 140 s (spec 059, issue #372: rename a session, every kind and level, both sizes); check-rename-inline in DRIVERS covers the in-place rename on every surface',
  'check-perf': 'npm run check:perf measures frame times and DOM growth under load; its limits depend on the machine, so it is a local check, not a gate on shared runners',
};

/** The screenshot variables the drivers read; all point at one folder. */
const OUT_VARS = ['OUT', 'SHOTS_012', 'SHOTS_021', 'SHOTS_024', 'SHOTS_033', 'SHOTS_034', 'SHOTS_OUT', 'MODEL_OUT', 'CARDMENU_OUT', 'MODE_OUT', 'ABOUT_OUT', 'HERO_OUT', 'SHOTS_DIR', 'I7_OUT', 'M9_OUT', 'M10_OUT'];
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

module.exports = { syntaxErrors, main, runOne, DRIVERS, NOT_IN_SUITE }; // runOne: also spec 001 FR-082 (scripts/shots-docs.js)
if (require.main === module) main().catch((e) => { console.error('ui-suite:', e.message); process.exitCode = 1; });
