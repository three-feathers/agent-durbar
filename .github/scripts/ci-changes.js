#!/usr/bin/env node
/*
 * Which parts of CI a pull request needs: the ONE place that decides (spec 008 FR-104, FR-191). `.github/scripts/ci-changes.sh`
 * runs this file; each job that skips work calls it after a `fetch-depth: 2` checkout. Writes name=true|false lines to
 * $GITHUB_OUTPUT (stdout when unset).
 *
 * On a pull request the checkout is GitHub's test merge commit, so HEAD^1 is the base branch and `git diff HEAD^1 HEAD` is exactly
 * what the PR changes. EVERY OTHER EVENT (push to main, merge queue, nightly, by hand) RUNS EVERYTHING: every output is true, so the
 * checks before a release are never fewer (owner decision, Vikram 2026-11-08: "Ok go"; "Include common sense optimization").
 * (ui-platforms.yml has no merge_group trigger: in the queue only ci.yml runs, in full; the UI suite runs on pushes to main, nightly
 * and by hand.) On a pull request ci-changes.sh runs the BASE branch's copy of this file (HEAD^1's, reviewed on main) with
 * `--root <checkout>`, so a PR's own edit of the decision cannot skip its own checks; with no base copy everything runs.
 *
 *   code=false    only docs/, specs/ or Markdown changed: build, test, office and package jobs pass without running (FR-104)
 *   themes=true   the look or the layout checks can change: the office job also runs theme geometry (FR-031)
 *   ui=true       something the app, its build, its packaging or the simulator UI drivers use changed (FR-191): the UI suite
 *                 (ui-platforms.yml), the office layout job and package smoke run. False for tooling, report and unit-test
 *                 scripts, docs, other workflows, a version-only bump of package.json / package-lock.json and a package.json
 *                 change only to npm scripts the UI run cannot reach (not build, pack:dir or a lifecycle hook).
 *   macos=true    the path-filtered macOS build and test (macos-pr.yml) has work: false only when every change is docs or a
 *                 version-only bump (FR-191)
 *
 * When in doubt a path counts (fail open toward running): an unknown top-level file or folder, a file under scripts/fixtures or
 * scripts/fakes, a non-source file in scripts/, a scripts/ path gone at head (deleted or renamed away), a scripts/ name the literal
 * matcher cannot read, an unreadable or unparsable package.json are all ui=true.
 *
 * The UI closure is derived, not hand-listed: the roots are every scripts/*.{js,cjs,mjs,ts} that ui-platforms.yml names,
 * check-parallel.js (the office job), the scripts of the npm scripts the UI run reaches (build, pack:dir, the lifecycle hooks npm ci
 * runs, every `npm run` in the workflow, followed through package.json) and electron-builder's afterPack; from each code file in the closure
 * every string literal that names a file or folder in scripts/ is followed (require('./x'), path.join(__dirname, 'x.json') and
 * ui-suite.js's DRIVERS names, which are file names without .js). A new helper a driver loads is in the closure as soon as it is
 * named. Files are read as data only: no PR text reaches a shell (execFileSync with an argument array, no shell).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
// review of PR #1349: names from the PR are printed through the repo's safe-print (no workflow command, no second line); the workflow
// runs the BASE branch's copy of this file and of safe-print.js, so both sit at the same relative place in the temp copy
const { printable } = require(path.join(__dirname, '..', '..', 'scripts', 'safe-print.js'));

const DOCS = /^(docs\/|specs\/|changelog\.d\/)|\.md$|^LICENSE$/;
const THEMES = /^(src\/renderer\/|scripts\/check-office-overlap\.js|scripts\/check-theme-geometry\.js|scripts\/check-parallel\.js|scripts\/fixtures\/themes\/|\.github\/workflows\/ci\.yml|\.github\/scripts\/ci-changes\.(sh|js))/;
// always UI: the app, the CI plumbing the UI and office runs use, the UI workflow and this decision itself
const ALWAYS_UI = /^(src\/|scripts\/fixtures\/|scripts\/fakes\/|\.github\/actions\/|\.github\/workflows\/(ui-platforms|ci)\.yml$|\.github\/scripts\/ci-changes\.(sh|js)$)/;
// scripts/ files of these kinds count only when the closure names them; any other kind there counts always (fail open)
const SOURCE = /\.(js|cjs|mjs|ts|sh|py|md|txt|re)$/;
const PKG = ['package.json', 'package-lock.json'];

// the npm scripts the UI run, the office job and package smoke start: `build`, `pack:dir` and every lifecycle hook npm ci runs
// (pre*, post*, install, prepare); with every `npm run <name>` in ui-platforms.yml they seed the REACHED set (reachedNpm)
const UI_NPM_SCRIPT = /^(build|pack:dir|pack:dir:prebuilt|install|prepare|pre.*|post.*)$/; // pack:dir:prebuilt: the office job's package step (FR-194)
// Review of PR #1349, round 4 (Paco's suggestion): which npm scripts a command line starts, with the default INVERTED. A line is
// PARSED only when every command in it (commands joined by `&&` only) is one of these exact forms:
//   [VAR=value ...] node|tsc|electron|electron-builder <args>       starts no npm script
//   [VAR=value ...] npx node|tsc|electron|electron-builder <args>   starts no npm script
//   [VAR=value ...] npm run|run-script [-s|--silent] <name> [-- <args>]          starts <name>
//   [VAR=value ...] npm start|test|t|tst|restart|stop [-- <args>]                 starts that script
// Anything else is OPAQUE: a shell metacharacter (& | ; ` $ ( ) < > quotes backslash), npm with an option before its command,
// `npm.cmd`, a path to `.bin`, `npm exec`, yarn, pnpm, run-p and every other word as the command. An opaque REACHED line makes
// every npm script count as reached (fail open), so the list of evasions stops mattering: what is not listed above runs everything.
const EXACT_TOOL = new Set(['node', 'tsc', 'electron', 'electron-builder']);
const NPM_LIFECYCLE_CMD = { start: 'start', test: 'test', t: 'test', tst: 'test', restart: 'restart', stop: 'stop' };
const NPM_RUN_FLAG = new Set(['-s', '--silent']);
const SCRIPT_NAME = /^[\w:.+-]+$/;
const ENV_ASSIGN = /^[A-Za-z_]\w*=[\w./:,+-]*$/;
const SHELL_META = /[&|;`$()<>'"\\\r\n]/;
/** The npm script names one command line starts, and whether any of it is not an exact form (opaque). */
function npmTargets(line) {
  const names = [];
  const text = String(line == null ? '' : line);
  if (SHELL_META.test(text.split('&&').join(' '))) return { names, opaque: true };
  for (const cmd of text.split('&&')) {
    const t = cmd.trim().split(/\s+/).filter(Boolean);
    while (t.length && ENV_ASSIGN.test(t[0])) t.shift();
    if (!t.length) return { names, opaque: true };
    if (t[0] === 'npx') t.shift();
    if (EXACT_TOOL.has(t[0])) continue;
    if (t[0] !== 'npm') return { names, opaque: true };
    const sub = t[1];
    let i = 2;
    if (sub === 'run' || sub === 'run-script') {
      while (i < t.length && NPM_RUN_FLAG.has(t[i])) i++;
      const name = t[i++];
      if (!name || !SCRIPT_NAME.test(name)) return { names, opaque: true };
      names.push(name);
    } else if (Object.prototype.hasOwnProperty.call(NPM_LIFECYCLE_CMD, sub)) {
      names.push(NPM_LIFECYCLE_CMD[sub]);
    } else return { names, opaque: true };
    if (i < t.length && t[i] !== '--') return { names, opaque: true };
  }
  return { names, opaque: false };
}
// a workflow line starts npm scripts only when it names a runner; only those lines are parsed (strictly), other commands
// (apt-get, echo, test ...) start none
// case-insensitive (review round 5): `NPM run x` or `Npm.cmd` is looked at, and as it is not an exact form (those are lower case) it fails open
const RUNNER_WORD = /(^|[^\w.-])(npm|npx|yarn|pnpm|bun|npm-run-all\d*|run-[ps]|concurrently|lerna|nx|turbo)([^\w-]|$)|\.bin[\/\\]|npm\.cmd/i;
/** The command lines of a workflow: each `run:` value and each line of a `run: |` block (comments and blank lines dropped). */
function workflowCommands(wfText) {
  const out = [];
  const lines = String(wfText || '').split(/\r?\n/);
  for (let k = 0; k < lines.length; k++) {
    const m = lines[k].match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!m) continue;
    const rest = m[2].trim();
    if (/^[|>][-+]?\d*$/.test(rest)) {
      const indent = m[1].length;
      while (k + 1 < lines.length && (lines[k + 1].trim() === '' || lines[k + 1].search(/\S/) > indent)) out.push(lines[++k].trim());
    } else out.push(rest);
  }
  return out.filter((c) => c && !c.startsWith('#'));
}
const parseJson = (text) => { try { const j = JSON.parse(text || ''); return j && typeof j === 'object' ? j : null; } catch { return null; } };
/** Every npm script name the UI run can reach: the seeds, every script a workflow line starts, and every script a reached script
 *  starts, followed to any depth; with an opaque runner on any of those lines, every script. */
function reachedNpm(pkgText, wfText) {
  const pkg = parseJson(pkgText) || {};
  const scripts = (typeof pkg.scripts === 'object' && pkg.scripts) || {};
  const names = new Set(Object.keys(scripts).filter((k) => UI_NPM_SCRIPT.test(k)));
  let opaque = false;
  const visit = (line) => {
    const r = npmTargets(line);
    if (r.opaque) opaque = true;
    return r.names;
  };
  for (const cmd of workflowCommands(wfText)) if (RUNNER_WORD.test(cmd)) for (const n of visit(cmd)) names.add(n);
  const todo = [...names];
  while (todo.length) {
    const n = todo.pop();
    if (!Object.prototype.hasOwnProperty.call(scripts, n)) continue; // a name with no script starts nothing
    for (const m of visit(scripts[n])) if (!names.has(m)) { names.add(m); todo.push(m); }
  }
  if (opaque) for (const k of Object.keys(scripts)) names.add(k);
  return names;
}
/** package.json / package-lock.json without the release's version fields (and, with `keep`, without the npm scripts not in it: the
 *  scripts the UI run cannot reach); null when it does not parse. */
function withoutVersion(text, name, keep) {
  if (text == null) return null;
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  delete j.version;
  if (name === 'package-lock.json' && j.packages && j.packages[''] && typeof j.packages[''] === 'object') delete j.packages[''].version;
  if (keep && name === 'package.json' && j.scripts && typeof j.scripts === 'object') {
    j.scripts = Object.fromEntries(Object.entries(j.scripts).filter(([k]) => keep.has(k)));
  }
  return JSON.stringify(j);
}
/** True when base and head differ only in the top-level "version" (and the lock's packages[""].version); with `keep` also in npm
 *  scripts outside it. For ui, `keep` is the reached set of base and head together (review of PR #1349): an edit of any reached
 *  line (`test:uisuite`, a script `build` chains to) counts. */
function versionOnly(name, io, keep = null) {
  const a = withoutVersion(io.readBase(name), name, keep), b = withoutVersion(io.read(name), name, keep);
  return a !== null && b !== null && a === b;
}

const LITERAL = /(['"`])([\w./-]+)\1/g;
// a name the literal matcher cannot read (a space, a non-ASCII letter, ...) can never join the closure, so it counts (fail open)
const PLAIN_NAME = /^[\w./-]+$/;
// a scripts/ path named in a command, with or without its extension (review round 5: `node scripts/copy-assets` runs copy-assets.js)
const SCRIPT_FILE = /(?<![\w./-])scripts\/[\w./-]*[\w-]/g;
const CODE = /\.(js|cjs|mjs|ts)$/;
// how a name resolves, as node does for a script path: the file, the name with an extension, the folder's index file, the folder
const RESOLVE = ['', '.js', '.ts', '.cjs', '.mjs', '/index.js', '/index.ts', '/index.cjs', '/index.mjs'];
/** The file (or folder prefix, ending in /) a scripts/ name resolves to in the head tree, or null. */
function resolveScript(rel, io) {
  for (const ext of RESOLVE) if (io.isFile(rel + ext)) return rel + ext;
  return io.isDir(rel) ? rel.replace(/\/?$/, '/') : null;
}
// the ci.yml steps the `ui` decision gates (the office job: office layout and package smoke) start commands too (review round 5)
const WF_UI = '.github/workflows/ui-platforms.yml';
const WF_CI = '.github/workflows/ci.yml';
/** The workflow text the UI decision covers: all of ui-platforms.yml, and each ci.yml step whose `if:` reads the ui output. */
function uiWorkflowText(wfUiText, ciText) {
  const gated = String(ciText || '').split(/\r?\n(?=\s*- )/).filter((step) => step.includes("steps.changes.outputs.ui == 'true'"));
  return [String(wfUiText || ''), ...gated.flatMap((step) => workflowCommands(step).map((c) => `      - run: ${c}`))].join('\n');
}
/** Every file (and folder prefix, ending in /) in scripts/ that the UI run can load, from the roots by string literals. Roots: the
 *  scripts/ files ui-platforms.yml names, check-parallel.js (the office job), and the scripts/ files of every npm script the UI run
 *  can reach: `build`, `pack:dir`, the lifecycle hooks `npm ci` runs, each `npm run <name>` in the workflow, and every `npm run`
 *  inside those, followed; plus electron-builder's afterPack. */
function uiClosure(io) {
  const roots = new Set(); // check-parallel.js comes from the office job's ui-gated step in ci.yml
  const wf = uiWorkflowText(io.read(WF_UI), io.read(WF_CI));
  const addRoot = (name) => { const r = resolveScript(name, io); if (r) roots.add(r); };
  for (const m of wf.matchAll(SCRIPT_FILE)) addRoot(m[0]);
  const pkg = parseJson(io.read('package.json')) || {}; // unparsable: the package rule makes it ui=true
  const scripts = (typeof pkg.scripts === 'object' && pkg.scripts) || {};
  for (const n of reachedNpm(io.read('package.json'), wf)) for (const m of String(scripts[n] || '').matchAll(SCRIPT_FILE)) addRoot(m[0]);
  if (pkg && pkg.build && typeof pkg.build.afterPack === 'string') for (const m of pkg.build.afterPack.matchAll(SCRIPT_FILE)) addRoot(m[0]);
  const seen = new Set(), todo = [...roots];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (f.endsWith('/') || !CODE.test(f)) continue;
    const text = io.read(f);
    if (text == null) continue;
    const dir = path.posix.dirname(f);
    for (const m of text.matchAll(LITERAL)) {
      const lit = m[2];
      if (!lit || lit.startsWith('/') || lit.includes('..')) continue;
      const rel = path.posix.normalize(path.posix.join(dir, lit));
      if (!rel.startsWith('scripts/')) continue;
      const r = resolveScript(rel, io);
      if (r && r.endsWith('/')) seen.add(r);
      else if (r) todo.push(r);
    }
  }
  return seen;
}

/** The reached npm names of base and head together: a line reached on either side counts when it changes. */
function keepNpm(io) {
  return new Set([...reachedNpm(io.read('package.json'), uiWorkflowText(io.read(WF_UI), io.read(WF_CI))),
    ...reachedNpm(io.readBase('package.json'), uiWorkflowText(io.readBase(WF_UI), io.readBase(WF_CI)))]);
}

/** Does this one changed path count for the UI suite? */
function uiPath(f, io, closure) {
  if (ALWAYS_UI.test(f)) return true;
  if (PKG.includes(f)) return !versionOnly(f, io, keepNpm(io));
  if (f.startsWith('scripts/')) {
    if (closure.has(f) || [...closure].some((c) => c.endsWith('/') && f.startsWith(c))) return true;
    // review of PR #1349: a file gone at head (deleted, or the old name of a rename: the diff has --no-renames) may have been loaded
    // by the UI run, and the head closure cannot know; a name the literal matcher cannot read can never join it. Both count.
    if (!io.isFile(f) || !PLAIN_NAME.test(f)) return true;
    return !SOURCE.test(f);
  }
  if (DOCS.test(f) || f.startsWith('.github/')) return false;
  return true; // build/, tsconfig*.json, root dotfiles, anything new
}

/** The decision for a pull request's changed files. `io` reads the head tree (read, isFile, isDir) and the base (readBase). */
function decide(files, io) {
  const list = files.filter(Boolean);
  const code = list.some((f) => !DOCS.test(f));
  const themes = list.some((f) => THEMES.test(f));
  let ui = false;
  if (code) {
    const closure = uiClosure(io);
    ui = list.some((f) => uiPath(f, io, closure));
  }
  const macos = list.some((f) => !DOCS.test(f) && !(PKG.includes(f) && versionOnly(f, io)));
  return { code, themes, ui, macos };
}

/** The real tree: the checkout (head) and HEAD^1 (base). scripts/ is listed once, so a literal costs a set lookup, not a stat. */
function gitIo(root) {
  const abs = (p) => path.join(root, ...p.split('/'));
  const files = new Set(), dirs = new Set();
  const walk = (rel) => {
    let ents = [];
    try { ents = fs.readdirSync(abs(rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules') { dirs.add(r); walk(r); } } else files.add(r);
    }
  };
  walk('scripts');
  const cache = new Map();
  return {
    read: (p) => { if (!cache.has(p)) { let t = null; try { t = fs.readFileSync(abs(p), 'utf8'); } catch { /* missing */ } cache.set(p, t); } return cache.get(p); },
    isFile: (p) => (p.startsWith('scripts/') ? files.has(p) : (() => { try { return fs.statSync(abs(p)).isFile(); } catch { return false; } })()),
    isDir: (p) => (p.startsWith('scripts/') ? dirs.has(p) : (() => { try { return fs.statSync(abs(p)).isDirectory(); } catch { return false; } })()),
    readBase: (p) => { try { return execFileSync('git', ['show', `HEAD^1:${p}`], { cwd: root, encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }); } catch { return null; } },
  };
}

function main(env = process.env, argv = process.argv.slice(2)) {
  const out = (k, v) => { if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${k}=${v}\n`); else console.log(`${k}=${v}`); };
  let r;
  if (env.EVENT_NAME !== 'pull_request') {
    r = { code: true, themes: true, ui: true, macos: true };
    console.log(`${env.EVENT_NAME || 'no event'}: not a pull request, everything runs.`);
  } else {
    // --root <checkout>: the workflow runs the base copy of this file from a temp folder on the PR's checkout
    const at = argv.indexOf('--root');
    const root = at >= 0 && argv[at + 1] ? path.resolve(argv[at + 1]) : path.join(__dirname, '..', '..');
    const files = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', 'HEAD^1', 'HEAD'], { cwd: root, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
    for (const f of files) console.log(printable(f)); // a name may hold a newline or `::`: never a workflow command
    r = decide(files, gitIo(root));
    if (!r.code) console.log('Docs, specs and Markdown only: build, test and office checks are skipped (the job passes).');
    else if (!r.ui) console.log('Nothing the app, its build or the UI drivers use changed: the UI suite, office layout and package smoke are skipped (spec 008 FR-191).');
    if (r.code && !r.macos) console.log('Docs and a version-only package bump: the macOS pull-request build and test is skipped (spec 008 FR-191).');
  }
  for (const k of ['code', 'themes', 'ui', 'macos']) out(k, r[k]);
}

module.exports = { decide, uiClosure, versionOnly, gitIo, npmTargets, reachedNpm, workflowCommands };
if (require.main === module) main();
