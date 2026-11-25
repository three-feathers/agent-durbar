#!/usr/bin/env node
/*
 * Spec 021 FR-422 (delta 2026-11-25, harness series PR A): `npm run pr:ready`, run BEFORE the ready mark. It runs the CHEAP guards a ready
 * head must pass, in a fixed order, and stops at the first failure with that one line, so a round is not lost to a guard a script can run
 * in seconds (the measured plan of 2026-11-22: reviews and CI runs lost to a numbers clash, the `test:*` block order, a spec index, a rule
 * budget, a fragment, a CRLF cut, an unsigned commit).
 *
 *   1  specs:numbers   `git fetch origin main`, then scripts/spec-numbers.js (global FR/T/Q clash check: main, open PR heads, remote
 *                      branches, worktrees); that script reads the open PR list with `gh` itself (read only)
 *   2  fragments       scripts/fragments.js --check (the sorted `test:*` block and the other hot-file blocks)
 *   3  specs:check     scripts/specs-index.js --check and scripts/spec-numbers.js --dups
 *   4  rules:check     scripts/rules-check.js (word budgets)
 *   5  changelog:check scripts/changelog.js check
 *   6  theme-tokens    test:theme-tokens, only when src/renderer/app.js or screens.js changed (no "#NNNN" in a comment)
 *   7  public text     preflight's shapeHits on the added lines of specs/, docs/, changelog.d/ against origin/main (offline: no PR body, no
 *                      labels). A hit blocks only with --security (the PR is area:security, as in pr-preflight check 9); else it is a NOTE
 *   8  driver lint     test:uisuite, only when a scripts/ driver changed (check-*.js, shots-*.js, driver-helpers.js, ui-suite.js)
 *   9  CRLF warning    a NOTE (never a block) when an added test line cuts text out of a source file with a bare \n (rule 18)
 *   10 git hygiene     no uncommitted tracked change, `git diff --check`, every commit since origin/main with a good signature (%G? G, or
 *                      U: good signature, key not in the local allowed-signers file, a NOTE; N with a gpgsig header in the raw commit: signed, not checkable here, a NOTE; N without it, B X Y R E block, the letter shown), no AI
 *                      trailer in any message (preflight's AI_LINE; the message is matched, never printed)
 *   11 branch          the rule of .github/scripts/spec-gate.sh, ported (it needs bash, jq, perl and the PR event): branch NNN-slug and, when
 *                      src/ or specs/ changed, specs/NNN-*\/ exists, is touched (and holds spec, plan, tasks when src/ changed)
 *   12 prints the head sha and `ready: yes` only when 1 to 11 passed; otherwise `ready: no`.
 *
 * It NEVER marks anything ready, never pushes, never comments; the only network is the fetch (and gh's read in guard 1). Every command is
 * a fixed argv without a shell (the Node binary runs the scripts, so it also works on Windows); nothing from the repo goes into a command
 * line. Output from a failing command is shown as ONE line through scripts/safe-print.js. The full `npm test` is NOT part of it.
 * Exit 0 ready, 1 not ready, 2 wrong usage.
 *
 *   node scripts/pr-ready.js [--security] [--exempt] [--root DIR]     --exempt: the PR will carry Spec-Exempt (guard 11 notes, not blocks, src/ without a spec change)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { printable } = require('./safe-print.js');
const pp = require('./pr-preflight.js');

const BASE = 'origin/main';
const TIMEOUT_MS = 600000;
const MAX_BUFFER = 64 * 1024 * 1024;
const APP_FILES = ['src/renderer/app.js', 'src/renderer/screens.js'];
const DRIVER_RE = /^scripts\/((check|shots)-[^/]+\.js|driver-helpers\.js|ui-suite\.js)$/;
const TEST_FILE_RE = /^(scripts|src)\/(?:.*\/)?test-[^/]+\.(js|ts)$/;
// a call that cuts or finds text in a string, and a \n escape that is not \r?\n (the Windows runners check out CRLF)
const CUT_CALL = /\b(indexOf|lastIndexOf|search|match|exec|replace|test)\s*\(|RegExp\s*\(/;
const BARE_LF = /(?<!\\r\?)(?<!\\r)\\n/;

/** The real runner: fixed argv, no shell. -> { status, out } (stdout then stderr). */
function realRun(root) {
  return (cmd, args) => {
    const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, shell: false, windowsHide: true });
    return { status: r.error ? -1 : r.status, out: `${r.stdout || ''}${r.stderr || ''}${r.error ? String(r.error.message) : ''}` };
  };
}

// %G? letters: G and U are a good signature (U: the key is not in this machine's gpg.ssh.allowedSignersFile); the rest block
const OK_SIG = ['G', 'U'];
const SIG_WHY = { N: 'no signature', B: 'bad signature', X: 'expired signature', Y: 'signed with an expired key', R: 'signed with a revoked key', E: 'cannot be checked (missing key or tool problem)' };
/** True when the raw commit text has a gpgsig header (SSH signatures too): the headers end at the first blank line, split on \r?\n. */
function hasSigHeader(raw) {
  for (const l of String(raw).split(/\r?\n/)) {
    if (l === '') return false;
    if (/^gpgsig(-sha256)? /.test(l)) return true;
  }
  return false;
}
const NODE = process.execPath;
const lineOf = (out) => {
  const rows = String(out).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hit = rows.find((l) => /\b(FAIL|NOT CHECKED|clash|error|must|missing|not )/i.test(l));
  return printable(String(hit || rows[0] || '(no output)').slice(0, 220));
};
const fail = (text) => ({ ok: false, text });
const pass = (text, notes = []) => ({ ok: true, text, notes });

/** A script step: fixed argv; ok when status 0. */
function step(ctx, name, argvs) {
  for (const argv of argvs) {
    const r = ctx.run(NODE, argv);
    if (r.status !== 0) return fail(`${name}: ${lineOf(r.out)}`);
  }
  return pass(name);
}
const tsc = (ctx) => [path.join(ctx.root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.scripts.json'];
const tsTest = (ctx, name, js) => step(ctx, name, [tsc(ctx), [path.join(ctx.root, 'dist-scripts', 'scripts', js)]]);

function guardNumbers(ctx) {
  const f = ctx.run('git', ['fetch', '--quiet', '--no-tags', 'origin', 'main']);
  if (f.status !== 0) return fail(`specs:numbers: git fetch origin main failed: ${lineOf(f.out)}`);
  return step(ctx, 'specs:numbers', [['scripts/spec-numbers.js']]);
}
const guardFragments = (ctx) => step(ctx, 'fragments --check', [['scripts/fragments.js', '--check']]);
const guardSpecs = (ctx) => step(ctx, 'specs:check', [['scripts/specs-index.js', '--check'], ['scripts/spec-numbers.js', '--dups']]);
const guardRules = (ctx) => step(ctx, 'rules:check', [['scripts/rules-check.js']]);
const guardChangelog = (ctx) => step(ctx, 'changelog:check', [['scripts/changelog.js', 'check']]);
const guardThemeTokens = (ctx) => (ctx.files.some((f) => APP_FILES.includes(f))
  ? tsTest(ctx, 'test:theme-tokens (app.js or screens.js changed)', 'test-theme-tokens.js')
  : { skip: 'app.js and screens.js unchanged' });
const guardDrivers = (ctx) => (ctx.files.some((f) => DRIVER_RE.test(f))
  ? tsTest(ctx, 'test:uisuite (a scripts/ driver changed)', 'test-ui-suite.js')
  : { skip: 'no scripts/ driver changed' });

function guardPublicText(ctx) {
  const d = ctx.run('git', ['diff', ctx.mergeBase, 'HEAD', '--', 'specs', 'docs', 'changelog.d']);
  if (d.status !== 0) return fail(`public text: git diff failed: ${lineOf(d.out)}`);
  const hits = pp.shapeHits(pp.linesByFile(d.out));
  if (!hits.length) return pass('public text: no new shape words');
  const text = `public text: shape words in ${hits.slice(0, 5).map(printable).join(', ')}`;
  return ctx.security ? fail(`${text} (a security PR describes the fix, not the shape)`) : pass('public text: no new shape words', [`NOTE ${text}: a block only with --security`]);
}

/** Pure: files whose ADDED lines cut text out of a source file with a bare \n. diff: unified text (CRLF tolerated). */
function crlfCuts(diff) {
  const out = [];
  for (const { where, added } of pp.linesByFile(diff)) {
    if (!TEST_FILE_RE.test(where) || !/readFileSync/.test(added)) continue;
    if (added.split(/\r?\n/).some((l) => CUT_CALL.test(l) && BARE_LF.test(l) && !/\.(split|join)\(/.test(l))) out.push(where);
  }
  return out;
}
function guardCrlf(ctx) {
  if (!ctx.files.some((f) => /^(scripts|src)\//.test(f))) return { skip: 'nothing under scripts/ or src/ changed' };
  const d = ctx.run('git', ['diff', ctx.mergeBase, 'HEAD', '--', 'scripts', 'src']);
  const hits = d.status === 0 ? crlfCuts(d.out) : [];
  return pass('crlf: no bare \\n cut found', hits.map((f) => `NOTE crlf: ${printable(f)} cuts text from a source file with a bare \\n: accept \\r?\\n and run it once on a CRLF copy (rule 18)`));
}

function guardGit(ctx) {
  const st = ctx.run('git', ['status', '--porcelain', '--untracked-files=no']);
  if (st.status !== 0) return fail(`git: status failed: ${lineOf(st.out)}`);
  if (st.out.trim()) return fail('git: uncommitted changes to tracked files (the head sha would not be what you push)');
  for (const args of [['diff', '--check', ctx.mergeBase, 'HEAD'], ['diff', '--check']]) {
    const c = ctx.run('git', args);
    if (c.status !== 0) return fail(`git diff --check: ${lineOf(c.out)}`);
  }
  const lg = ctx.run('git', ['log', '--format=%H %G?', `${BASE}..HEAD`]);
  if (lg.status !== 0) return fail(`git: log failed: ${lineOf(lg.out)}`);
  const unlisted = [];
  const unchecked = [];
  for (const row of lg.out.split(/\r?\n/).filter(Boolean)) {
    // with no allowed-signers file, git also prints this stderr line per signed commit (the runner joins stdout and stderr): not a commit row
    if (/^error: gpg\.ssh\.allowedSignersFile needs to be configured/.test(row)) continue;
    const [sha, sig] = row.split(' ');
    // N: git prints it for an unsigned commit AND for a signed one it cannot check (an SSH signature, no allowed-signers file): the raw header tells them apart
    if (sig === 'N') {
      const raw = ctx.run('git', ['cat-file', 'commit', String(sha)]);
      if (raw.status === 0 && hasSigHeader(raw.out)) { unchecked.push(String(sha).slice(0, 9)); continue; }
    }
    if (!OK_SIG.includes(sig)) return fail(`git: commit ${printable(String(sha).slice(0, 9))} has signature status "${printable(sig || '')}": ${SIG_WHY[sig] || 'not a good signature'}`);
    if (sig === 'U') unlisted.push(String(sha).slice(0, 9));
  }
  const msgs = ctx.run('git', ['log', '-z', '--format=%H%n%B', `${BASE}..HEAD`]);
  for (const m of msgs.out.split('\0').filter((x) => x.trim())) {
    if (pp.AI_LINE.test(m)) return fail(`git: commit ${printable(m.slice(0, 9))} has an AI trailer or "Generated with" line (spec 021 FR-061)`);
  }
  return pass('git: clean tree, no whitespace error, every commit signed, no AI trailer', [
    ...(unlisted.length ? [`NOTE git: signature good, key not in the local allowed-signers file (%G? U): ${unlisted.length} commit(s)`] : []),
    ...(unchecked.length ? [`NOTE git: signature present, cannot be checked here (no allowed-signers file): GitHub shows whether it is verified (%G? N with a gpgsig header): ${unchecked.length} commit(s)`] : []),
  ]);
}

// .github/scripts/spec-gate.sh, ported: its checks 1 (branch NNN-slug) and 2 (src/ needs specs/NNN-*/). The exemption (a Spec-Exempt line or a
// label) is not visible offline: a branch that is not NNN-slug is a NOTE, and --exempt turns the "src/ without a spec change" failure into one.
const BRANCH_RE = /^([0-9]{3})-[a-z0-9][a-z0-9-]*$/;
function guardBranch(ctx) {
  const b = ctx.run('git', ['symbolic-ref', '--short', '-q', 'HEAD']);
  const name = b.status === 0 ? b.out.trim() : '';
  if (!name) return { skip: 'detached HEAD, the branch rule is not checked (the gate reads the PR branch)' };
  if (name === 'main') return { skip: 'on main' };
  const shown = printable(name);
  const m = name.match(BRANCH_RE);
  if (!m) return pass(`branch: "${shown}" is not NNN-slug`, [`NOTE branch "${shown}" is not NNN-slug: the Spec Kit gate fails it unless the PR is exempt (not visible offline); a branch rename closes its PR`]);
  const nnn = m[1];
  const src = ctx.files.some((f) => f.startsWith('src/'));
  const specFiles = ctx.files.filter((f) => f.startsWith('specs/'));
  if (!src && !specFiles.length) return pass(`branch: ${shown} (no src/ or specs/ change)`);
  const inFolder = (f) => f.startsWith('specs/') && f.split('/')[1].startsWith(`${nnn}-`);
  const lt = ctx.run('git', ['ls-tree', '--name-only', 'HEAD:specs']);
  const folder = lt.status === 0 ? lt.out.split(/\r?\n/).find((x) => x.startsWith(`${nnn}-`)) : undefined;
  if (!folder) return fail(`branch: no folder specs/${nnn}-*/ exists for branch ${shown}: create it with /speckit-specify, then plan and tasks`);
  if (src) {
    for (const f of ['spec.md', 'plan.md', 'tasks.md']) {
      if (ctx.run('git', ['cat-file', '-e', `HEAD:specs/${folder}/${f}`]).status !== 0) return fail(`branch: specs/${printable(folder)}/${f} is missing (spec, plan and tasks must all exist before code)`);
    }
  }
  if (specFiles.some(inFolder)) return pass(`branch ${nnn} matches specs/${printable(folder)}/ (the diff touches ${[...new Set(specFiles.map((f) => f.split('/')[1]))].map((x) => `specs/${printable(x)}/`).join(', ')})`);
  const others = [...new Set(specFiles.map((f) => f.split('/')[1]).filter((x) => /^[0-9]{3}-/.test(x)))];
  if (others.length) return fail(`branch ${nnn} (${shown}); the diff touches ${others.map((x) => `specs/${printable(x)}/`).join(' and ')} only: name the branch ${others[0].slice(0, 3)}-... (a rename closes the PR: open it under the right name)`);
  if (!src) return pass(`branch: ${shown} (specs/ change outside any spec folder)`);
  const text = `branch: this change touches src/ but nothing in specs/${printable(folder)}/ (the spec of branch ${shown}): tick the task in tasks.md, add the spec delta, or fix the branch number`;
  return ctx.exempt ? pass(`branch: ${shown}`, [`NOTE ${text} (--exempt: the PR carries Spec-Exempt)`]) : fail(text);
}

// one guard per line: the test's mutants drop a line by its id
const GUARDS = [
  ['numbers', guardNumbers],
  ['fragments', guardFragments],
  ['specs', guardSpecs],
  ['rules', guardRules],
  ['changelog', guardChangelog],
  ['theme-tokens', guardThemeTokens],
  ['public-text', guardPublicText],
  ['drivers', guardDrivers],
  ['crlf', guardCrlf],
  ['git', guardGit],
  ['branch', guardBranch],
];

/** Runs the guards in order; stops at the first failure. -> { lines, ok, head } */
function ready({ root = path.join(__dirname, '..'), run = realRun(root), security = false, exempt = false } = {}) {
  const lines = [];
  const ctx = { root, run, security, exempt, files: [], mergeBase: BASE };
  const verdict = (ok) => ({ lines, ok, head: ctx.head });
  const head = run('git', ['rev-parse', 'HEAD']);
  ctx.head = head.status === 0 ? head.out.trim() : '';
  GUARDS.forEach(([id, g], i) => {
    if (ctx.stopped) return;
    if (i >= 5 && !ctx.listed) {
      // the changed-file list is needed from guard 6 on, after the fetch of guard 1 made origin/main current
      ctx.listed = true;
      const mb = run('git', ['merge-base', BASE, 'HEAD']);
      const diff = run('git', ['diff', '--name-only', '-z', `${BASE}...HEAD`]);
      if (mb.status !== 0 || diff.status !== 0) { lines.push(`FAIL (${i + 1}) ${id}: cannot read the diff against ${BASE}: ${lineOf(mb.status !== 0 ? mb.out : diff.out)}`); ctx.stopped = true; return; }
      ctx.mergeBase = mb.out.trim();
      ctx.files = diff.out.split('\0').filter(Boolean);
    }
    const r = g(ctx);
    if (r.skip) { lines.push(`skip (${i + 1}) ${id}: ${r.skip}`); return; }
    if (!r.ok) { lines.push(`FAIL (${i + 1}) ${r.text}`); ctx.stopped = true; return; }
    lines.push(`ok   (${i + 1}) ${r.text}`);
    for (const n of r.notes || []) lines.push(`     ${n}`);
  });
  if (ctx.stopped) { lines.push('ready: no'); return verdict(false); }
  lines.push(`head ${ctx.head}`, 'ready: yes (cheap guards only: the full `npm test` is not part of this; nothing was marked ready or pushed)');
  return verdict(true);
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const known = ['--security', '--exempt', '--root'];
  const ri = argv.indexOf('--root');
  if (argv.some((a, i) => !known.includes(a) && argv[i - 1] !== '--root') || (ri >= 0 && !argv[ri + 1])) {
    console.log('usage: node scripts/pr-ready.js [--security] [--exempt] [--root DIR]');
    process.exit(2);
  }
  const root = ri >= 0 ? path.resolve(argv[ri + 1]) : path.join(__dirname, '..');
  const t0 = Date.now();
  const res = ready({ root, security: argv.includes('--security'), exempt: argv.includes('--exempt') });
  for (const l of res.lines) console.log(l);
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  process.exit(res.ok ? 0 : 1);
}

module.exports = { ready, crlfCuts, GUARDS, lineOf, realRun, DRIVER_RE, APP_FILES, BASE };
