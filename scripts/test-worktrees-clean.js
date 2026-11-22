#!/usr/bin/env node
/*
 * Spec 021 FR-100 (issue #1992): scripts/worktrees-clean.js on a TEMP git repo in os.tmpdir() with invented branches and worktrees.
 * The PR state is injected (`prState`), so there is no network and no gh. Mutants of the script (a dirty or unpushed worktree deleted, a
 * branch force-deleted, ...) are written to the temp dir and must die at their own assert message.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC = path.join(__dirname, 'worktrees-clean.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wtclean-test-')));
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_TERMINAL_PROMPT: '0' };
function g(cwd, ...args) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, env: ENV, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
}
function branches(cwd) { return g(cwd, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean); }

/** A fresh origin + clone with one worktree per case. Returns the paths. */
function fixture(name) {
  const base = path.join(tmp, name);
  fs.mkdirSync(base);
  const origin = path.join(base, 'origin.git');
  const main = path.join(base, 'main');
  g(base, 'init', '--bare', '-b', 'main', origin);
  g(base, 'clone', origin, main);
  fs.writeFileSync(path.join(main, 'a.txt'), 'a\n');
  g(main, 'add', 'a.txt');
  g(main, 'commit', '-m', 'init');
  g(main, 'push', 'origin', 'HEAD:main');
  const wts = {};
  function add(branch, { push = true, commit = false } = {}) {
    const p = path.join(base, 'wt-' + branch);
    g(main, 'worktree', 'add', '-b', branch, p, 'main');
    if (commit) { fs.writeFileSync(path.join(p, branch + '.txt'), branch + '\n'); g(p, 'add', '.'); g(p, 'commit', '-m', branch); }
    if (push) g(p, 'push', '-u', 'origin', branch);
    wts[branch] = p;
    return p;
  }
  add('merged-clean', { commit: true });
  const dirty = add('merged-dirty', { commit: true });
  fs.writeFileSync(path.join(dirty, 'untracked.txt'), 'x\n');
  add('merged-unpushed', { push: true });
  fs.writeFileSync(path.join(wts['merged-unpushed'], 'late.txt'), 'late\n');
  g(wts['merged-unpushed'], 'add', '.'); g(wts['merged-unpushed'], 'commit', '-m', 'late, not pushed');
  add('no-pr', { commit: true });
  add('open-pr', { commit: true });
  add('squashed', { commit: true, push: false }); // merged by squash, branch deleted on origin: git branch -d must refuse
  const det = path.join(base, 'wt-detached');
  g(main, 'worktree', 'add', '--detach', det, 'main');
  wts.detached = det;
  return { base, main, wts };
}

const STATES = { 'merged-clean': 'MERGED', 'merged-dirty': 'MERGED', 'merged-unpushed': 'MERGED', 'no-pr': 'NONE', 'open-pr': 'OPEN', squashed: 'MERGED' };
const prState = (b) => (typeof b === 'string' ? STATES[b] || 'UNKNOWN' : 'MERGED'); // a detached HEAD has no branch: a careless script would see MERGED

/** Run one script copy on a fresh fixture and return what is left; the asserts are in check(). */
function runCase(modPath, label, apply) {
  const fx = fixture(label);
  const lines = [];
  const mod = require(modPath);
  // run from a directory that is not one of the worktrees
  const res = mod.run({ apply, root: fx.main, cwd: fx.main, prState, log: (s) => lines.push(s) });
  return { fx, res, lines };
}

function check(modPath, tag) {
  const dry = runCase(modPath, tag + '-dry', false);
  const v = (b) => dry.res.rows.find((r) => r.wt.branch === b || (b === 'detached' && !r.wt.branch)).verdict;
  assert.strictEqual(v('merged-clean'), 'removable', tag + ': merged-clean is removable');
  assert.strictEqual(v('merged-dirty'), 'dirty', tag + ': a merged but dirty worktree is listed dirty');
  assert.strictEqual(v('merged-unpushed'), 'look', tag + ': an unpushed commit needs a look');
  assert.strictEqual(v('no-pr'), 'look', tag + ': no PR needs a look');
  assert.strictEqual(v('open-pr'), 'look', tag + ': an open PR needs a look');
  assert.strictEqual(v('detached'), 'look', tag + ': a detached HEAD needs a look');
  assert.ok(dry.lines.some((l) => /finished but dirty: 1 file\b/.test(l)), tag + ': the dirty line says "finished but dirty: 1 file"');
  assert.ok(Object.values(dry.fx.wts).every((p) => fs.existsSync(p)), tag + ': a dry run removes nothing');
  assert.ok(dry.res.reclaimable > 0, tag + ': the reclaimable total is counted');

  const ap = runCase(modPath, tag + '-apply', true);
  const w = ap.fx.wts;
  assert.ok(!fs.existsSync(w['merged-clean']), tag + ': --apply removes merged-clean');
  assert.ok(!branches(ap.fx.main).includes('merged-clean'), tag + ': --apply deletes the merged-clean branch');
  assert.ok(fs.existsSync(w['merged-dirty']) && fs.existsSync(path.join(w['merged-dirty'], 'untracked.txt')), tag + ': a dirty worktree is kept with its file');
  assert.ok(fs.existsSync(w['merged-unpushed']), tag + ': an unpushed worktree is kept');
  assert.ok(branches(ap.fx.main).includes('merged-unpushed'), tag + ': the unpushed branch is kept');
  assert.ok(fs.existsSync(w['no-pr']), tag + ': a no-PR worktree is kept');
  assert.ok(fs.existsSync(w['open-pr']), tag + ': an open-PR worktree is kept');
  assert.ok(fs.existsSync(w.detached), tag + ': a detached worktree is kept');
  assert.ok(!fs.existsSync(w.squashed), tag + ': a squash-merged worktree whose branch left origin is removed');
  assert.ok(branches(ap.fx.main).includes('squashed'), tag + ': git branch -d refuses the squash-merged branch, so it is kept (never -D)');
  assert.ok(fs.existsSync(ap.fx.main), tag + ': the main checkout stays');
}

function selfSkip() {
  // the worktree this runs in is skipped, never removed
  const fx = fixture('self');
  const mod = require(SRC);
  const res = mod.run({ apply: true, root: fx.main, cwd: path.join(fx.wts['merged-clean']), prState, log: () => {} });
  assert.ok(fs.existsSync(fx.wts['merged-clean']), 'self: the worktree it runs in is not removed');
  assert.strictEqual(res.rows.find((r) => r.wt.branch === 'merged-clean').verdict, 'skip', 'self: it is reported as skipped');
}

function tmpList() {
  const mod = require(SRC);
  const dir = path.join(tmp, 'tmplist');
  fs.mkdirSync(dir);
  const mk = (n) => { const p = path.join(dir, n); fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'f'), 'x'); return p; };
  const old = Date.now() - 5 * 24 * 3600 * 1000;
  const stale = mk('durbar-ui-shots-abc'); const stale2 = mk('durbar-site-xyz'); const young = mk('durbar-ui-shots-new');
  const other = mk('tmp.AbCdEf'); const unrelated = mk('someone-elses'); const near = mk('durbar-ui-shotsX');
  for (const p of [stale, stale2, other, unrelated, near]) fs.utimesSync(p, old / 1000, old / 1000);
  const found = mod.staleTmp([dir], Date.now(), []).map((f) => path.basename(f.path)).sort();
  assert.deepStrictEqual(found, ['durbar-site-xyz', 'durbar-ui-shots-abc'], 'tmp: only old durbar-ui-shots-* and durbar-site-* directories are listed');
  assert.ok(fs.existsSync(young) && fs.existsSync(other) && fs.existsSync(unrelated) && fs.existsSync(stale), 'tmp: listing deletes nothing');
  assert.deepStrictEqual(mod.staleTmp([dir], Date.now(), [stale]).map((f) => path.basename(f.path)), ['durbar-site-xyz'], 'tmp: a registered worktree path is never listed');
}

function parseCase() {
  const mod = require(SRC);
  const l = mod.parseWorktrees('worktree /a\nHEAD 1\nbranch refs/heads/main\n\nworktree /b\nHEAD 2\ndetached\n\nworktree /c\nHEAD 3\nbranch refs/heads/x/y\nlocked reason\n');
  assert.deepStrictEqual(l.map((w) => [w.path, w.branch, w.detached, w.locked]), [['/a', 'main', false, false], ['/b', null, true, false], ['/c', 'x/y', false, true]], 'parse: porcelain output');
}

// No force anywhere in the code (comments stripped): never --force, never branch -D.
const code = fs.readFileSync(SRC, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert.ok(!/--force|'-f'|'-D'/.test(code), 'static: the script never forces a removal or force-deletes a branch');
check(SRC, 'real');
selfSkip();
tmpList();
parseCase();

// Mutants: each must die at its own message.
const src = fs.readFileSync(SRC, 'utf8');
const MUTANTS = [
  ['dirty-deleted', "if (files > 0) return { verdict: 'dirty'", "if (files > 99999) return { verdict: 'dirty'", /listed dirty/],
  ['unpushed-deleted', "if (ahead.out.trim() !== '') return", "if (false) return", /unpushed/],
  ['no-pr-deleted', "if (state === 'NONE') return { verdict: 'look'", "if (state === 'NONE') return { verdict: 'removable'", /no PR/],
  ['open-pr-deleted', "if (state === 'OPEN') return { verdict: 'look'", "if (state === 'OPEN') return { verdict: 'removable'", /open PR/],
  ['detached-deleted', "if (wt.detached || !wt.branch) return", "if (false) return", /detached/],
  ['branch-force-D', "['branch', '-d', wt.branch]", "['branch', '-D', wt.branch]", /never -D/],
  ['self-not-skipped', "if (inside(here, wt.path)) {", "if (false) {", /self/],
  ['tmp-any', "/^durbar-site-[A-Za-z0-9._-]+$/]", "/^durbar-site-[A-Za-z0-9._-]+$/, /^tmp\\./]", /only old durbar/],
  ['dry-run-applies', "if (opts.apply) {\n        const res", "if (true) {\n        const res", /dry run removes nothing/],
];
let n = 0;
for (const [name, from, to, expect] of MUTANTS) {
  assert.ok(src.includes(from), 'mutant ' + name + ': the text to change is gone from the script');
  const mp = path.join(tmp, 'mutant-' + name + '.js');
  fs.writeFileSync(mp, src.replace(from, to));
  let died = null;
  try {
    const m = require(mp);
    // `check` for the repo cases; the self and tmp cases use SRC, so run them against the mutant explicitly
    if (name === 'self-not-skipped') {
      const fx = fixture('mself');
      m.run({ apply: true, root: fx.main, cwd: fx.wts['merged-clean'], prState, log: () => {} });
      assert.ok(fs.existsSync(fx.wts['merged-clean']), 'self: the worktree it runs in is not removed');
    } else if (name === 'tmp-any') {
      const dir = path.join(tmp, 'mtmp');
      fs.mkdirSync(dir);
      const p = path.join(dir, 'tmp.AbCdEf'); fs.mkdirSync(p);
      const old = (Date.now() - 5 * 24 * 3600 * 1000) / 1000; fs.utimesSync(p, old, old);
      const found = m.staleTmp([dir], Date.now(), []).map((f) => path.basename(f.path));
      assert.deepStrictEqual(found, [], 'tmp: only old durbar-ui-shots-* and durbar-site-* directories are listed');
    } else check(mp, name);
  } catch (e) { died = e; }
  assert.ok(died, 'mutant ' + name + ' survived');
  assert.ok(expect.test(String(died.message)), 'mutant ' + name + ' died at the wrong assert: ' + String(died.message).split('\n')[0]);
  n++;
}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
console.log('worktrees-clean: ok (' + n + ' mutants killed)');
