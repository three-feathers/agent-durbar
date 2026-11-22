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
 *   code=false    every changed path is on the docs allow list and no test suite names one (spec 117 FR-387, DOCS_ALLOW
 *                 below): build, test, office and package jobs pass without running (FR-104); the merge queue runs them all
 *   themes=true   the look or the layout checks can change: the office job also runs theme geometry (FR-031)
 *   ui=true       something the app, its build, its packaging or the simulator UI drivers use changed (FR-191): the UI suite
 *                 (ui-platforms.yml), the office layout job and package smoke run. False for tooling, report and unit-test
 *                 scripts, docs, other workflows, a version-only bump of package.json / package-lock.json and a package.json
 *                 change only to npm scripts the UI run cannot reach (not build, pack:dir or a lifecycle hook).
 *   macos=true    the path-filtered macOS build and test (macos-pr.yml) has work: false only when every change is docs or a
 *                 version-only bump (FR-191)
 *   os_sensitive=true  the diff can behave differently on Windows: ui-platforms.yml runs its Windows UI shards on the pull request
 *                 (spec 117 FR-012, O2); false only when the diff is not empty and every path is on the OS-neutral list (fails
 *                 closed: osSensitive below). ci-changes.sh writes each name once, and everything runs when
 *                 the decision wrote one not exactly once or not exactly true/false.
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

// spec 117 FR-387 (reviews of #2032): the docs-only skip FAILS CLOSED. A path may take it only when it is on this small ALLOW list, in
// plain form, AND no `npm test` suite names it (docsOnly below); everything else, any unknown path, an odd path and an empty diff run
// everything. Allowed: Markdown under specs/ and docs/ (only `.md`: never a script, picture, SVG or CODEOWNERS there), except
// docs/rules/ (rule text, test:rules), docs/agent-setup/ and docs/site/ (the public site), and two named root files, CHANGELOG.md and
// CONTRIBUTING.md (not SECURITY.md, README.md, AGENTS.md, CLAUDE.md, LICENSE). changelog.d/ is not on the list: changelog.js reads
// every fragment, so a fragment runs everything. The prefixes are lower case on purpose (`Docs/x.md`, `Src/x.md` are not on the list,
// and a case-insensitive checkout could make them the real folders); the exclusions match in any case (`docs/RULES/x.md` is
// docs/rules on Windows and macOS). scripts/test-ci-changes.ts guards each part with a fixture and a mutant.
const DOCS_ALLOW = /^(specs|docs)\/.+\.md$|^(CHANGELOG|CONTRIBUTING)\.md$/;
const DOCS_DENY = /^docs\/(rules|agent-setup|site)\//i; // root files need no entry: only the two named ones are allowed
// a plain git path: no backslash, no `.` or `..` or empty segment, no leading or trailing blank, no control character, not absolute
const PLAIN_PATH = (f) => typeof f === 'string' && f !== '' && f === f.trim() && !/[\\\u0000-\u001f\u007f]/.test(f) && f.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
const DOCS = { test: (f) => PLAIN_PATH(f) && DOCS_ALLOW.test(f) && !DOCS_DENY.test(f) };
// for `ui` and `macos` only (FR-191, unchanged): documentation and Markdown outside the always-UI folders do not start the UI suite, even when
// they run Build and test (a suite reads them)
const UI_DOCS = /^(docs\/|specs\/|changelog\.d\/)|\.md$|^LICENSE$/;
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
// ci.yml jobs the `ui` decision gates (the office job: office layout and package smoke) start commands too. Review rounds 5 and 6:
// the WHOLE text of every ci.yml job that reads `outputs.ui` in any way (any case, any quoting, `!=`, fromJSON, a step gated only
// on the build's outcome) is taken, not step by step, so no way of writing a step's condition escapes. Jobs are cut by indentation
// (a job starts at two spaces under `jobs:`), so a `run: |` block holding a `- ` line stays in its job. When the jobs cannot be
// cut (no `jobs:` line, no job found), the whole of ci.yml is taken (fail open).
const WF_UI = '.github/workflows/ui-platforms.yml';
const WF_CI = '.github/workflows/ci.yml';
/** The jobs of a workflow as text, cut by indentation; null when they cannot be found. */
function workflowJobs(text) {
  const lines = String(text || '').split(/\r?\n/);
  const at = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (at < 0) return null;
  const jobs = [];
  for (const l of lines.slice(at + 1)) {
    if (/^ {2}[^\s#][^:]*:\s*(#.*)?$/.test(l)) jobs.push([l]);
    else if (/^\S/.test(l)) break; // a new top-level key ends `jobs:`
    else if (jobs.length) jobs[jobs.length - 1].push(l);
  }
  return jobs.length ? jobs.map((j) => j.join('\n')) : null;
}
// any reference to the ui output: `outputs.ui`, `outputs. ui`, `outputs['ui']`, `outputs [ "ui" ]`, any case (review round 7). Linear:
// no nested quantifier, each \s* is bounded by a literal on both sides.
const UI_OUTPUT_REF = /outputs\s*(\.\s*ui\b|\[\s*['"]ui['"]\s*\])/i;
/** The workflow text the UI decision covers: all of ui-platforms.yml, and each ci.yml job that reads the ui output (or all of
 *  ci.yml when its jobs cannot be cut). */
function uiWorkflowText(wfUiText, ciText) {
  const jobs = workflowJobs(ciText);
  const covered = jobs ? jobs.filter((job) => UI_OUTPUT_REF.test(job)) : [String(ciText || '')];
  return [String(wfUiText || ''), ...covered.flatMap((job) => workflowCommands(job).map((c) => `      - run: ${c}`))].join('\n');
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

// ---- spec 117 FR-012 (O2, owner decision Vikram 2026-11-22, T048): `os_sensitive=true|false`, whether a pull request's diff can
// behave differently on Windows, so ui-platforms.yml starts its Windows UI shards on the PR. It FAILS CLOSED: a path counts as
// OS-neutral only when it is a plain path on the OS_NEUTRAL list below and on no OS_SENSITIVE line; every other path (the main
// process, preload, build, packaging, dependencies, workflows and CI scripts, the driver plumbing, shell scripts, fonts, any unknown
// or new path, an odd path) and an empty diff are os_sensitive. A src/shared or src/adapters file is neutral only when neither its base
// nor its head text, nor any file it imports by a relative path (followed, base and head), matches an OS_USE line (an OS module,
// a non-literal require or import, a process field or bracket, a destructured process, a platform word, an os call, __dirname); a file
// unreadable on both sides, or an import that resolves to nothing in src/, counts. A driver (scripts/check-* or scripts/shots-*) is
// neutral only when neither its base nor its head text matches an OS_PLATFORM line (review of #2039: 24 drivers branch on the platform). The neutral prefixes are lower case on purpose (`Src/renderer/x.js` is not on the list, and a case-insensitive
// checkout could make it another folder); the sensitive lines match in any case (`src/renderer/KEYS.js` is keys.js on Windows and
// macOS). scripts/test-ci-os-sensitive.ts guards each line with a fixture and a mutant that dies at its own assert.
const OS_NEUTRAL = /^(docs\/|specs\/|changelog\.d\/|src\/renderer\/|scripts\/fixtures\/|scripts\/(test|shots|check)-[\w.-]+\.(ts|js)$)|^[^/]+\.md$/;
const OS_SENSITIVE = [
  /^src\/renderer\/(keys|browserpane)\.js$/i, // the platform's shortcut keys; the browser pane (a native view)
  /^src\/renderer\/(crew|profileeditor)\.js$/i, // Windows path rules (folder keys, same-path compare)
  /\.(ttf|otf|woff2?|ttc)$/i, // fonts lay out differently per OS
  /^scripts\/(driver-helpers|ui-suite|check-parallel|check-office-overlap|check-theme-geometry|check-mac-titlebar)\.js$/i, // the UI run's plumbing and its font-sensitive layout checks
  /\.(sh|ps1|cmd|bat)$/i, // shell scripts
];
const OS_SHARED = /^src\/(shared|adapters)\/[\w./-]+\.(ts|js)$/;
const OS_DRIVER = /^scripts\/(check|shots)-[\w.-]+\.(ts|js)$/;
// text that branches on the OS (review of #2039): the drivers are judged by these lines only, since nearly all of them read
// process.env, __dirname and the path module the same way on every OS
const OS_PLATFORM = [
  // a process field that differs per OS, or any bracket access on process
  /\bprocess\s*(?:\?\.\s*)?\[|\bprocess\s*\??\.\s*(?:platform|arch|getuid|getgid|umask)\b/,
  // a destructured process: const { platform } = process
  /\}\s*=\s*(?:(?:globalThis|global|window)\s*\.\s*)?process\b/,
  // a platform word: win32, darwin, platform (a parameter too), isMac, IS_MAC, isWindows ...
  /\b(?:win32|darwin|platform|is_?mac|is_?win(?:dows)?)\b/i,
  // an os call that differs per OS
  /\bos\s*\.\s*(?:type|release|arch|EOL|version|userInfo|constants)\b/,
];
// text that can behave differently per OS: src/shared and src/adapters files are judged by all of these
const OS_USE = [
  ...OS_PLATFORM,
  // an OS module by import, require or dynamic import, with or without `node:`, any subpath
  /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)['"`](?:node:)?(?:fs|path|os|child_process|net|tls|dgram|worker_threads|cluster|readline|electron|url|module|process)(?:\/[\w/]*)?['"`]/,
  // a require or dynamic import whose argument is not a string literal (a module name in a variable)
  /\b(?:require|import)\s*\(\s*[^'"`\s)]/,
  // other process fields whose values differ per machine and OS
  /\bprocess\s*\??\.\s*(?:env|cwd|execPath|kill|pid|versions)\b/,
  // a path relative to the file itself
  /\b__(?:dirname|filename)\b/,
];
const matchesAny = (list, t) => list.some((re) => re.test(t));
// a relative import or require ('./x', '../y/z')
const REL_IMPORT = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)['"`](\.{1,2}\/[^'"`]*)['"`]/g;
/** Does a file (base or head and, with `follow`, what it imports by a relative path, followed) match an OS_USE line? */
function usesOs(f, io, follow, lines = OS_USE) {
  const seen = new Set(), todo = [f];
  const exists = (p) => io.read(p) != null || io.readBase(p) != null;
  while (todo.length) {
    const p = todo.pop();
    if (seen.has(p)) continue;
    seen.add(p);
    const texts = [io.read(p), io.readBase(p)].filter((t) => t != null);
    if (!texts.length) return true; // unreadable on both sides
    for (const t of texts) {
      if (matchesAny(lines, t)) return true;
      if (follow) for (const m of t.matchAll(REL_IMPORT)) {
        const rel = path.posix.normalize(path.posix.join(path.posix.dirname(p), m[1]));
        if (!rel.startsWith('src/')) return true; // leaves src/: cannot say
        const stem = rel.replace(/\.js$/, '');
        const hit = [rel, `${stem}.ts`, `${stem}.js`, `${rel}/index.ts`, `${rel}/index.js`].find((c) => /\.(ts|js)$/.test(c) && exists(c));
        if (!hit) return true; // an import that resolves to nothing (a .json, a folder, a typo)
        todo.push(hit);
      }
    }
  }
  return false;
}
/** One changed path: can it behave differently on Windows? */
function osPath(f, io) {
  if (!PLAIN_PATH(f)) return true; // the docs rule's plain-path test (FR-387)
  if (OS_SENSITIVE.some((re) => re.test(f))) return true;
  if (OS_SHARED.test(f)) return usesOs(f, io, true);
  if (OS_DRIVER.test(f)) return usesOs(f, io, false, OS_PLATFORM);
  return !OS_NEUTRAL.test(f);
}
/** The decision for a pull request: true unless the diff is not empty and every path is OS-neutral. */
function osSensitive(files, io) {
  const list = Array.isArray(files) ? files : [];
  return list.length === 0 || list.some((f) => osPath(f, io));
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
  if (UI_DOCS.test(f) || f.startsWith('.github/')) return false;
  return true; // build/, tsconfig*.json, root dotfiles, anything new
}

/** The decision for a pull request's changed files. `io` reads the head tree (read, isFile, isDir) and the base (readBase). */
/** True only when the diff may take the docs-only skip: not empty, every path on the allow list, and no suite names any of them
 *  (by a literal in a step file, as the fast lane reads them: a suite that reads a doc must run when it changes). An unreadable suite
 *  list counts as "named" (fail closed). */
function docsOnly(list, io) {
  if (!list.length || !list.every((f) => DOCS.test(f))) return false;
  const names = suiteNames(io.read(SUITE_LIST));
  if (!names.length) return false;
  const scripts = (parseJson(io.read('package.json')) || {}).scripts || {};
  const changed = new Set(list);
  for (const name of names) for (const src of stepSources(scripts[name])) {
    for (const r of literalTargets(src, io)) if (r.endsWith('/') ? list.some((f) => f.startsWith(r)) : changed.has(r)) return false;
  }
  return true;
}

function decide(files, io) {
  const list = files.filter((f) => f !== '');
  const code = !docsOnly(list, io);
  const themes = list.some((f) => THEMES.test(f));
  let ui = false;
  if (code) {
    const closure = uiClosure(io);
    ui = list.some((f) => uiPath(f, io, closure));
  }
  // macos (FR-191, unchanged): only docs and a version-only bump skip the path-filtered macOS job, which code still gates elsewhere
  const macos = list.some((f) => !UI_DOCS.test(f) && !(PKG.includes(f) && versionOnly(f, io)));
  return { code, themes, ui, macos };
}

// ---- spec 117 FR-386: the fast lane (fast-lane.yml, advisory, never a required check). `--suites` writes `fast=yes` and
// `suites=<names>`: the `npm test` suites (scripts/test-suites.txt) this PR's diff touches, so each OS hears about a platform bug in
// minutes, before its full Build and test leg ends. Derived, not hand-listed, except the docs table below. A suite is picked when:
//   - it is new in the list, or its package.json line changed;
//   - one of its step files changed (`node dist-scripts/scripts/test-x.js` is scripts/test-x.ts; `node scripts/x.js` is itself);
//   - a step file names a changed file (not package.json, its lock or the list) by a string literal, one level deep (`'../src/shared/api'`, `'./fakes/x'`, `'scripts/x.sh'`,
//     relative to the step file or to the repo root, resolved as node does), or names a folder at least two levels deep that holds one;
//   - a docs path its check reads changed (FAST_DOC_SUITES: the docs gates of a docs-only PR).
// Picking fewer than the full run is safe here because the lane decides nothing else: the required jobs still run every suite.
const SUITE_LIST = 'scripts/test-suites.txt';
const SUITE_NAME = /^test:[\w:.+-]+$/;
// rule text needs no row: rules-check.js names 'AGENTS.md' and 'docs/rules', so the literal rule picks test:rules
const FAST_DOC_SUITES = [
  [/^specs\//, 'test:specsindex'],
  [/^changelog\.d\/|^CHANGELOG\.md$/, 'test:changelog'],
];
/** The suite names of a test-suites.txt text (as scripts/run-tests.js reads it); names that are not plain `test:*` are dropped. */
function suiteNames(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter((n) => SUITE_NAME.test(n));
}
/** The source files of a suite's `node <file>` steps: a compiled dist-scripts/X.js is X.ts. */
function stepSources(cmd) {
  return String(cmd || '').replace(/^tsc -p tsconfig\.scripts\.json\s*&&\s*/, '').split('&&')
    .map((c) => c.trim().split(/\s+/)).filter((t) => t[0] === 'node' && t[1]).map((t) => t[1].replace(/^dist-scripts\/(.+)\.js$/, '$1.ts'));
}
/** The file or folder (ending in /) a literal names from `dir`, or from the repo root; null when it names neither. */
function resolveLiteral(lit, dir, io) {
  if (!lit || lit.startsWith('/')) return null;
  // a bare word ('fs', 'fixtures') names a neighbour of the step file or, exactly, a file at the repo root ('LICENSE', review of
  // #2032); only a literal with `/` or `.` is resolved from the root with extensions
  if (!/[./]/.test(lit) && io.isFile(lit)) return lit;
  for (const base of /[./]/.test(lit) ? [dir, ''] : [dir]) {
    const rel = path.posix.normalize(base ? path.posix.join(base, lit) : lit);
    if (!rel || rel === '.' || rel.startsWith('..')) continue;
    for (const ext of RESOLVE) if (io.isFile(rel + ext)) return rel + ext;
    if (rel.split('/').length >= 2 && io.isDir(rel)) return rel.replace(/\/?$/, '/');
  }
  return null;
}
/** The fast-lane suites for a pull request's changed files, in list order. */
const fastTargetCache = new WeakMap(); // io -> step file -> the files and folders its literals name (the tree does not change in a run)
/** The files and folders (ending in /) a step file names by literal, read once per tree. */
function literalTargets(src, io) {
  if (!fastTargetCache.has(io)) {
    const memo = (fn) => { const m = new Map(); return (p) => { if (!m.has(p)) m.set(p, fn(p)); return m.get(p); }; };
    fastTargetCache.set(io, { io: { ...io, isFile: memo(io.isFile), isDir: memo(io.isDir) }, bySrc: new Map() }); // a literal recurs in many files
  }
  const c = fastTargetCache.get(io);
  if (!c.bySrc.has(src)) {
    const out = new Set();
    const text = CODE.test(src) ? io.read(src) : null;
    if (text != null) for (const m of text.matchAll(LITERAL)) { const r = resolveLiteral(m[2], path.posix.dirname(src), c.io); if (r) out.add(r); }
    c.bySrc.set(src, out);
  }
  return c.bySrc.get(src);
}
function fastSuites(files, io) {
  const changed = new Set(files.filter(Boolean));
  const names = suiteNames(io.read(SUITE_LIST));
  const baseNames = new Set(suiteNames(io.readBase(SUITE_LIST)));
  const scripts = (parseJson(io.read('package.json')) || {}).scripts || {};
  const baseScripts = (parseJson(io.readBase('package.json')) || {}).scripts || {};
  // package.json, its lock and the suite list are named by dozens of tests (the version, the scripts): they pick by the rules
  // above (a new or changed suite line), not by literal, or every dependency bump would pick a third of the list
  const byLiteral = new Set([...changed].filter((f) => !PKG.includes(f) && f !== SUITE_LIST));
  const hit = (r) => r && (r.endsWith('/') ? [...byLiteral].some((f) => f.startsWith(r)) : byLiteral.has(r));
  const picked = new Set();
  for (const name of names) {
    const cmd = scripts[name];
    if (typeof cmd !== 'string') continue;
    if (!baseNames.has(name) || baseScripts[name] !== cmd) { picked.add(name); continue; }
    for (const src of stepSources(cmd)) {
      if (changed.has(src) || [...literalTargets(src, io)].some(hit)) { picked.add(name); break; }
    }
  }
  for (const f of changed) for (const [re, name] of FAST_DOC_SUITES) if (re.test(f) && names.includes(name)) picked.add(name);
  return names.filter((n) => picked.has(n));
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
  const at = argv.indexOf('--root');
  const root = at >= 0 && argv[at + 1] ? path.resolve(argv[at + 1]) : path.join(__dirname, '..', '..');
  const changedFiles = () => execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', 'HEAD^1', 'HEAD'], { cwd: root, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
  if (argv.includes('--suites')) { // spec 117 FR-386: the fast lane's suites only (the other outputs are not written)
    const suites = env.EVENT_NAME === 'pull_request' ? fastSuites(changedFiles(), gitIo(root)) : [];
    if (env.EVENT_NAME !== 'pull_request') console.log(`${env.EVENT_NAME || 'no event'}: the fast lane runs on pull requests only.`);
    else console.log(suites.length ? `fast lane: ${suites.length} suite(s): ${suites.join(' ')}` : 'fast lane: no suite is touched by this diff.');
    out('fast', 'yes');
    out('suites', suites.join(' '));
    return;
  }
  let r;
  if (env.EVENT_NAME !== 'pull_request') {
    r = { code: true, themes: true, ui: true, macos: true, os_sensitive: true };
    console.log(`${env.EVENT_NAME || 'no event'}: not a pull request, everything runs.`);
  } else {
    // --root <checkout>: the workflow runs the base copy of this file from a temp folder on the PR's checkout
    const files = changedFiles();
    for (const f of files) console.log(printable(f)); // a name may hold a newline or `::`: never a workflow command
    const tree = gitIo(root);
    r = { ...decide(files, tree), os_sensitive: osSensitive(files, tree) };
    if (!r.code) console.log('Docs, specs and Markdown only: build, test and office checks are skipped (the job passes).');
    else if (!r.ui) console.log('Nothing the app, its build or the UI drivers use changed: the UI suite, office layout and package smoke are skipped (spec 008 FR-191).');
    if (r.code && !r.macos) console.log('Docs and a version-only package bump: the macOS pull-request build and test is skipped (spec 008 FR-191).');
    if (r.ui && !r.os_sensitive) console.log('No OS-sensitive path changed: the Windows UI shards are skipped on this pull request (spec 117 FR-012).');
  }
  for (const k of ['code', 'themes', 'ui', 'macos', 'os_sensitive']) out(k, r[k]);
}

module.exports = { decide, uiClosure, versionOnly, gitIo, npmTargets, reachedNpm, workflowCommands, fastSuites, suiteNames, stepSources, DOCS, osSensitive };
if (require.main === module) main();
