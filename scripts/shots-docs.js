/*
 * Every screenshot the README and the website link, retaken in one command (spec 001 FR-082/FR-083, owner 2026-10-23).
 * Simulator only: no real agent session, no account, no AI credits (constitution IV).
 *
 *   npm run shots:docs                       builds, then retakes every linked picture into docs/screenshots/
 *   node scripts/shots-docs.js --out <dir>   write somewhere else (CI: a folder to compare or upload)
 *   node scripts/shots-docs.js --only shots-hero,shots-001-lobby
 *   node scripts/shots-docs.js --list        which driver makes which linked file
 *   node scripts/shots-docs.js --check       no Electron: every linked image has a driver or a reason (also in test:uisuite)
 *   node scripts/shots-docs.js --linked-only copy only the linked files (default: also the other pictures of the same drivers
 *                                            that are already in docs/screenshots, e.g. the 1280x800 twin of a linked 1440x900)
 *   SHOTS_DOCS_JOBS=<n>                      drivers at once (default 1: one Electron at a time)
 *   SHOTS_DOCS_CLOCK=<UTC ISO time>          the pinned page clock (default below; spec 001 FR-084), time zone UTC, locale en-US
 *
 * It adds no driver of its own: the pictures come from the drivers that already take them, started by spec 008's runner
 * (ui-suite.js runOne: a fresh profile each, no shell, xvfb-run on Linux without a display or with UI_SUITE_XVFB=1). Every driver
 * writes into a new temporary folder; only then are the files copied, so a failed run leaves the old pictures in place.
 * Linked = `docs/screenshots/*.png` in README.md, `file` in docs/site/gallery.json, any `*.png` in docs/site/landing.json.
 * docs/feature-history.md and CHANGELOG.md keep their old pictures on purpose (a record, spec 025 FR-006).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const CLOCK = '2026-10-20T09:30:00Z';

/** `f`: a file the driver writes under the same name; `{ to, from }`: the linked name and the name the driver writes. */
const THEMES = [['clean-office', 'clean'], ['corporate'], ['durbar-european'], ['durbar-indian'], ['durbar-japanese'], ['retro']];
const DOC_SHOTS = [
  { name: 'shots-hero', files: ['m5-sim15-1440x900-closed.png', 'm6-fullchat-sim15-1280x800.png'] },
  { name: 'shots-003-011', files: ['m6-fullchat-sim15-1440x900.png', '003-allow-all-menu-1440x900.png'] },
  { name: 'shots-017-signs', files: ['017-signs-1440x900.png', '017-held-dialog-1440x900.png', '017-open-office-1440x900.png', '017-open-office-1280x800.png', '017-office-layout-1440x900.png'] }, // spec 017 FR-004: meeting-room door signs on the desks
  { name: 'check-office-fill', files: ['001-helpers-2-1440x900.png', '001-helpers-2-1280x800.png', '001-helpers-3-1440x900.png', '001-helpers-3-1280x800.png', '001-fill-1-1440x900.png', '001-fill-1-1920x1080.png', '001-fill-4-1440x900.png', '001-fill-6-1440x900.png', '001-shutters-1440x900.png'] },
  { name: 'shots-001-live-activity', freeze: false, files: ['001-live-activity-dense-1440x900.png', '001-live-activity-side-1440x900.png'] },
  { name: 'shots-001-lobby', files: ['001-lobby-15-1280x800.png', '001-lobby-15-1440x900.png', '001-lobby-15-1440x900-retro.png', '001-lobby-3-1440x900.png'] },
  { name: 'shots-005-cardmenu', files: ['005-card-menu-stop-end-1440x900.png'] },
  { name: 'check-ro-ask', files: ['003-ro-ask-menu-1440x900.png'] },
  { name: 'check-why-allowed', files: ['003-why-allowed-1440x900.png'] },
  { name: 'check-sandbox-floor', files: ['087-sandbox-note-1440x900.png'] }, // spec 087: the OS sandbox note and the chip
  { name: 'check-composer-toolbar', files: ['005-composer-expert-light-1440x900.png', '005-composer-ctxsummary-1440x900.png', '005-composer-ctxsummary-1280x800.png'] },
  { name: 'check-edits', files: ['005-edit-expert-1440x900.png'] },
  { name: 'shots-006-crash', files: ['006-crash-card-1440x900.png'] },
  { name: 'shots-006-home', files: ['006-home-warning-1440x900.png'] },
  { name: 'shots-006-prevmarks', files: ['006-prev-menu-1440x900.png', '006-sessions-expanded-1440x900.png'] },
  { name: 'shots-009-vschat', files: ['009-vschat-latest-1440x900.png'] },
  { name: 'shots-012-cost-cap', freeze: false, files: ['cost-cap-1440x900.png'] },
  { name: 'shots-015-compact', files: ['015-compacting-office-1440x900.png', '015-compacting-office-1280x800.png', '015-compacting-chat-1440x900.png', '015-compacting-chat-1280x800.png'] },
  { name: 'shots-017', files: [{ to: '012-harness-picker-1440x900.png', from: '012-picker-1440x900.png' }] },
  { name: 'shots-024', files: ['024-lobby-1440x900.png'] },
  { name: 'shots-030-handoff', files: ['handoff-review-1440x900.png'] },
  { name: 'shots-033', files: ['033-floors-on-1440x900.png'] },
  { name: 'shots-040-aitheme', env: { DURBAR_SIM_KINDS: 'mixed' }, files: ['040-theme-picker-1440x900.png', '040-aitheme-preview-1440x900.png'] },
  { name: 'shots-043-ai', files: ['043-ai-questionnaire-1440x900.png'] },
  { name: 'shots-043-manage', files: ['043-profile-delete-confirm-1440x900.png'] },
  { name: 'shots-043-editor', files: ['043-editor-new-asp-split-1440x900.png', '043-editor-split-clean-1440x900.png'] },
  { name: 'shots-044-templates', files: ['044-templates-1440x900.png'] },
  { name: 'shots-051-setup', files: ['051-harnesses-1440x900.png'] },
  { label: 'shots-051-setup win32', name: 'shots-051-setup', files: ['051-install-manual-win32-1440x900.png'] },
  { name: 'shots-081-updates', files: ['081-updates-avail-1440x900.png'] },
  { name: 'shots-052-ux', files: ['052-office-1440x900.png'] },
  { name: 'shots-063-folder-status', files: ['063-folder-changes-1440x900.png'] },
  { name: 'shots-064-send-several', files: ['064-send-several-1440x900.png'] },
  { name: 'shots-068-coffee', files: ['068-coffee-office-15-1440x900.png', '068-coffee-bar-1440x900.png'] },
  { name: 'check-slash-suggest', files: ['073-slash-1440x900.png'] },
  { name: 'shots-074-navigator', files: ['074-navigator-start-1440x900.png'] },
  { name: 'shots-058-mcp-settings', files: ['058-mcp-settings-1440x900.png'] },
  { name: 'shots-076-orgpolicy', files: ['076-orgpolicy-mode-1440x900.png', '076-orgpolicy-server-1440x900.png'] },
  { name: 'shots-058-mcp-health', files: ['058-mcp-health-1440x900.png'] },
  // one office per theme (shots-themes.js, the Settings path); the README (035-*) and the landing page (site-theme-*) show the same
  ...THEMES.map(([id, short]) => ({
    label: `shots-themes ${id}`, name: 'shots-themes', env: { DURBAR_THEME: id, SHOTS_SIZE: '1440x900', SHOTS_PREFIX: '' },
    files: [{ to: `site-theme-${short || id}-1440x900.png`, from: `${id}-1440x900.png` }]
      .concat(['corporate', 'durbar-indian', 'retro'].includes(id) ? [{ to: `035-${id}-1440x900.png`, from: `${id}-1440x900.png` }] : []),
  })),
];

/** Linked pictures that no driver retakes, with the reason (FR-083). Empty: every linked picture is retaken; a new entry needs a reason a reviewer accepts. */
const NO_DRIVER = {};

/** main's own validator (src/main/simclock.ts, built by `npm run build`), so the script and the app accept exactly the same values. */
function builtClockQuery() {
  for (const f of [path.join(ROOT, 'dist', 'main', 'simclock.js'), path.join(ROOT, 'dist-scripts', 'src', 'main', 'simclock.js')]) {
    if (fs.existsSync(f)) return require(f).simClockQuery;
  }
  throw new Error('dist/main/simclock.js is missing: run `npm run build` first (npm run shots:docs does)');
}

/** Review on #574: the clock to pin, checked like main checks it. A value main would ignore fails here, before any driver starts. */
function pinnedClock(value, query = builtClockQuery()) {
  const v = value === undefined || value === '' ? CLOCK : String(value);
  if (!query(v)) throw new Error(`SHOTS_DOCS_CLOCK=${JSON.stringify(v)} is not a UTC time main accepts (YYYY-MM-DDTHH:MM[:SS]Z, for example ${CLOCK}); nothing was retaken`);
  return v;
}

const target = (f) => (typeof f === 'string' ? f : f.to);
const source = (f) => (typeof f === 'string' ? f : f.from);

/** The docs/screenshots files the README, the website gallery and the landing page link (sorted, unique). */
function linkedImages(root = ROOT) {
  const out = new Set();
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const m of readme.matchAll(/docs\/screenshots\/([A-Za-z0-9._-]+\.png)/g)) out.add(m[1]);
  const gallery = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'site', 'gallery.json'), 'utf8'));
  for (const g of gallery) if (g && typeof g.file === 'string') out.add(g.file);
  const landing = fs.readFileSync(path.join(root, 'docs', 'site', 'landing.json'), 'utf8');
  for (const m of landing.matchAll(/([A-Za-z0-9._-]+\.png)/g)) out.add(m[1]);
  return [...out].sort();
}

/** FR-083: `uncovered` = linked but neither retaken nor explained; `unlinked` = retaken but linked nowhere; `missingDrivers`. */
function coverage(root = ROOT) {
  const linked = linkedImages(root);
  const made = new Set(DOC_SHOTS.flatMap((d) => d.files.map(target)));
  return {
    linked,
    uncovered: linked.filter((f) => !made.has(f) && !NO_DRIVER[f]),
    unlinked: [...made].filter((f) => !linked.includes(f)).sort(),
    explainedButMade: Object.keys(NO_DRIVER).filter((f) => made.has(f)),
    missingDrivers: [...new Set(DOC_SHOTS.map((d) => d.name))].filter((n) => !fs.existsSync(path.join(root, 'scripts', n + '.js'))),
  };
}

function args(a) {
  const val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  return {
    list: a.includes('--list'), check: a.includes('--check'), linkedOnly: a.includes('--linked-only'),
    out: val('--out'), only: val('--only') ? new Set(String(val('--only')).split(',').filter(Boolean)) : undefined,
  };
}

/** The ui-suite settings for a driver (sim kinds, floors, managers ...), so both runners start it the same way. */
function suiteEnv(d, suite) {
  const s = suite.find((x) => (x.label || x.name) === (d.label || d.name)) || suite.find((x) => x.name === d.name && !x.label);
  return { ...((s && s.env) || {}), ...(d.env || {}) };
}

/** `run` and `ensure` are for tests; by default the real ui-suite runner and Electron install. */
async function main({ argv = process.argv.slice(2), run, ensure, clockQuery } = {}) {
  const a = args(argv);
  if (a.list) { for (const d of DOC_SHOTS) console.log(`${(d.label || d.name).padEnd(30)} ${d.files.map(target).join(' ')}`); return; }
  const c = coverage();
  const problems = [
    ...c.uncovered.map((f) => `linked but no driver retakes it (add it to DOC_SHOTS, or to NO_DRIVER with a reason): ${f}`),
    ...c.unlinked.map((f) => `retaken but linked nowhere (drop it from DOC_SHOTS): ${f}`),
    ...c.explainedButMade.map((f) => `both retaken and in NO_DRIVER: ${f}`),
    ...c.missingDrivers.map((n) => `no such driver: scripts/${n}.js`),
  ];
  if (problems.length) { for (const p of problems) console.error('shots-docs: ' + p); throw new Error(`${problems.length} problem(s) in the linked-screenshot list`); }
  if (a.check) { console.log(`shots-docs: ${c.linked.length} linked screenshots, each with a driver or a reason`); return; }

  const clock = pinnedClock(process.env.SHOTS_DOCS_CLOCK, clockQuery || builtClockQuery()); // before any Electron starts
  const suite = require('./ui-suite');
  const runOne = run || suite.runOne;
  const todo = DOC_SHOTS.filter((d) => !a.only || a.only.has(d.name) || a.only.has(d.label || ''));
  if (!todo.length) throw new Error('no driver selected');
  if (!(ensure || require('./ensure-electron').ensureElectron)()) throw new Error('the Electron binary is not installed and could not be fetched');
  const out = path.resolve(a.out || SHOTS);
  fs.mkdirSync(out, { recursive: true });
  const jobs = Math.max(1, Math.min(4, Number(process.env.SHOTS_DOCS_JOBS || 1) || 1));
  console.log(`shots-docs: ${todo.length} driver runs on ${process.platform}, ${jobs} at a time, clock ${clock} UTC, into ${out}`);
  const failed = [];
  const copied = [];
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const d = todo[next++];
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-docs-shots-'));
      const r = await runOne({ name: d.name, sim: d.sim, freeze: d.freeze, env: { ...suiteEnv(d, suite.DRIVERS), DURBAR_SIM_CLOCK: clock } }, tmp);
      const missing = d.files.filter((f) => !fs.existsSync(path.join(tmp, source(f))));
      const label = d.label || d.name;
      if (!r.ok || missing.length) {
        failed.push(label);
        console.log(`  FAIL ${label.padEnd(30)} ${String(r.secs).padStart(4)} s  ${r.ok ? 'not written: ' + missing.map(source).join(', ') : r.why.trim().slice(0, 300)}`);
        if (!r.ok) console.log(r.log.split(/\r?\n/).filter((l) => l.trim()).slice(-20).map((l) => '      | ' + l.slice(0, 240)).join('\n'));
      } else {
        const names = d.files.map((f) => [source(f), target(f)]);
        if (!a.linkedOnly) {
          // the same driver's other pictures that docs/screenshots already has (a linked 1440x900's 1280x800 twin, other spec views)
          const mapped = new Set(names.map(([s]) => s));
          for (const f of fs.readdirSync(tmp)) if (f.endsWith('.png') && !mapped.has(f) && fs.existsSync(path.join(SHOTS, f))) names.push([f, f]);
        }
        for (const [s, t] of names) { fs.copyFileSync(path.join(tmp, s), path.join(out, t)); copied.push(t); }
        console.log(`  ok   ${label.padEnd(30)} ${String(r.secs).padStart(4)} s  ${names.length} file(s)`);
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  console.log(`\nshots-docs: ${copied.length} file(s) written${failed.length ? '; failed: ' + failed.join(', ') : ''}`);
  if (failed.length) process.exitCode = 1;
  return { copied, failed };
}

module.exports = { DOC_SHOTS, NO_DRIVER, CLOCK, linkedImages, coverage, pinnedClock, main };
if (require.main === module) main().catch((e) => { console.error('shots-docs:', e.message); process.exitCode = 1; });
