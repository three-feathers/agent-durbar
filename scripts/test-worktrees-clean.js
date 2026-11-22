#!/usr/bin/env node
/*
 * Spec 021 FR-100 (issue #1992): scripts/worktrees-clean.js on a TEMP git repo in os.tmpdir() with invented branches and worktrees. The PR state
 * is injected (`prState`), so there is no network; `ghPrState` runs against a fake `gh` first on PATH (POSIX). Every guard has a fixture, and
 * every mutant of the script (a guard dropped or loosened) is written to the temp dir and must die at its own assert message (review of #1996).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SRC = path.join(__dirname, 'worktrees-clean.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wtclean-test-')));
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_TERMINAL_PROMPT: '0' };
function g(cwd, ...args) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, env: ENV, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
}
function branches(cwd) { return g(cwd, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean); }
function write(p, text) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }

/** A fresh origin + clone with one worktree per case. */
function fixture(name) {
  const base = path.join(tmp, name);
  fs.mkdirSync(base);
  const origin = path.join(base, 'origin.git');
  const main = path.join(base, 'main');
  g(base, 'init', '--bare', '-b', 'main', origin);
  g(base, 'clone', origin, main);
  write(path.join(main, 'a.txt'), 'a\n');
  write(path.join(main, '.gitignore'), 'node_modules/\ndist/\n.env\n.claude/\nout/\nrelease/\nbuild/\n');
  g(main, 'add', '.');
  g(main, 'commit', '-m', 'init');
  g(main, 'push', 'origin', 'HEAD:main');
  g(main, 'branch', '--set-upstream-to=origin/main', 'main');
  g(main, 'checkout', '-q', '-b', 'side');
  write(path.join(main, 'side.txt'), 's\n');
  g(main, 'add', '.'); g(main, 'commit', '-m', 'side');
  g(main, 'checkout', '-q', 'main');
  const wts = {};
  function add(branch, { push = 'u', commit = true, at } = {}) {
    const p = at || path.join(base, 'wt-' + branch);
    g(main, 'worktree', 'add', '-b', branch, p, 'main');
    if (commit) { write(path.join(p, branch + '.txt'), branch + '\n'); g(p, 'add', '.'); g(p, 'commit', '-m', branch); }
    if (push === 'u') g(p, 'push', '-u', 'origin', branch);
    else if (push === 'plain') g(p, 'push', 'origin', branch);
    else if (push === 'other') g(p, 'push', '-u', 'origin', branch + ':other-name');
    // push 'none': the caller pushes
    wts[branch] = p;
    return p;
  }
  add('merged-clean');
  write(path.join(add('merged-dirty'), 'untracked.txt'), 'x\n');
  const up = add('merged-unpushed');
  write(path.join(up, 'late.txt'), 'late\n'); g(up, 'add', '.'); g(up, 'commit', '-m', 'late, not pushed');
  add('no-pr'); add('open-pr'); add('unknown-pr');
  add('closed-gone'); g(main, 'update-ref', '-d', 'refs/remotes/origin/closed-gone');
  add('squashed'); g(main, 'update-ref', '-d', 'refs/remotes/origin/squashed');
  add('locked'); g(main, 'worktree', 'lock', wts.locked);
  write(path.join(add('ignored-env'), '.env'), 'SECRET=1\n');
  const ib = add('ignored-build');
  write(path.join(ib, 'node_modules', 'x', 'i.js'), '1\n'); write(path.join(ib, 'dist', 'o.js'), '1\n'); write(path.join(ib, 'out', 'p.js'), '1\n');
  write(path.join(add('ignored-deep'), 'notes', 'out', 'draft.md'), 'my notes\n');
  write(path.join(add('ignored-release'), 'release', 'installer.txt'), 'key\n');
  write(path.join(add('ignored-secret'), 'dist', '.env.local'), 'S=1\n');
  write(path.join(add('deep-repo'), 'out', 'a', 'b', 'c', 'd', '.git'), 'gitdir: /nowhere\n');
  add('other-remote', { push: 'none' });
  g(main, 'remote', 'add', 'other', origin);
  g(wts['other-remote'], 'push', '-u', 'other', 'other-remote');
  add('late-commit'); add('late-branch'); add('late-dirty'); add('mid-commit'); add('mid-branch');
  add('outer');
  const inner = add('inner', { at: path.join(wts.outer, '.claude', 'worktrees', 'inner') });
  add('outer2'); write(path.join(wts.outer2, '.claude', 'x', '.git'), 'gitdir: /nowhere\n');
  const mm = add('mid-merge'); g(mm, 'merge', '--no-commit', '--no-ff', 'side');
  add('diff-upstream', { push: 'other' });
  add('no-upstream', { push: 'plain' });
  add('flip');
  const det = path.join(base, 'wt-detached');
  g(main, 'worktree', 'add', '--detach', det, 'main');
  wts.detached = det;
  assert.ok(fs.existsSync(inner));
  return { base, main, wts };
}

const STATES = { 'open-pr': 'OPEN', 'unknown-pr': 'UNKNOWN', 'no-pr': 'NONE', inner: 'OPEN', 'closed-gone': 'CLOSED', main: 'MERGED' };
const prState = (b) => (typeof b !== 'string' ? 'MERGED' : STATES[b] || 'MERGED'); // a detached HEAD has no branch: a careless script would see MERGED

// A stand-in for git for the unit cases: every answer is "fine and empty", so only the guard under test can say "look".
function stubGit(over) {
  return (args) => {
    const key = args.join(' ');
    for (const k of Object.keys(over || {})) if (key.startsWith(k)) return over[k];
    if (args[0] === 'rev-parse' && args[1] === '--git-path') return { ok: true, out: 'no-such-' + args[2] + '\n' };
    if (args[0] === 'config' && args[2].endsWith('.remote')) return { ok: true, out: 'origin\n' };
    if (args[0] === 'config' && args[2].endsWith('.merge')) return { ok: true, out: 'refs/heads/' + args[2].split('.')[1] + '\n' };
    if (args[0] === 'rev-parse' && args[1] === '--verify') return { ok: true, out: 'x\n' };
    return { ok: true, out: '' };
  };
}

function check(modPath, tag) {
  const mod = require(modPath);
  const fx = fixture(tag + '-fx');
  const lines = [];
  const dry = mod.run({ apply: false, root: fx.main, cwd: fx.main, prState, log: (s) => lines.push(s) });
  const rootLine = lines.find((l) => l.startsWith('new worktrees go under'));
  assert.ok(rootLine && rootLine.includes(fx.main + '-worktrees'), tag + ': root: the root for new worktrees is printed');
  const row = (b) => dry.rows.find((r) => r.wt.branch === b || (b === 'detached' && !r.wt.branch));
  const is = (b, verdict, why, msg) => {
    assert.strictEqual(row(b).verdict, verdict, tag + ': ' + msg + ' (verdict ' + row(b).verdict + ': ' + row(b).why + ')');
    if (why) assert.ok(why.test(row(b).why), tag + ': ' + msg + ' (reason "' + row(b).why + '")');
  };
  assert.ok(!dry.rows.some((r) => r.wt.path === fx.main), tag + ': the main checkout is never in the loop');
  is('merged-clean', 'removable', null, 'merged-clean is removable');
  is('merged-dirty', 'dirty', /finished but dirty: 1 file\b/, 'a merged but dirty worktree is listed dirty');
  is('merged-unpushed', 'look', /commits origin does not have/, 'an unpushed commit needs a look');
  is('no-pr', 'look', /no PR/, 'no PR needs a look');
  is('open-pr', 'look', /open/, 'an open PR needs a look');
  is('unknown-pr', 'look', /unknown/, 'an unknown PR state needs a look');
  is('closed-gone', 'look', /not on origin/, 'a closed PR whose branch is not on origin needs a look');
  is('squashed', 'removable', null, 'a merged PR whose branch left origin is removable');
  is('locked', 'look', /locked/, 'a locked worktree needs a look');
  is('ignored-env', 'dirty', /ignored file.*\.env/, 'an ignored .env is data, listed dirty');
  is('ignored-build', 'removable', null, 'ignored node_modules and dist are rebuildable');
  is('outer', 'look', /contains worktree/, 'a worktree holding another worktree needs a look');
  is('outer2', 'look', /nested \.git/, 'a worktree holding a nested .git needs a look');
  is('mid-merge', 'look', /MERGE_HEAD/, 'a merge in progress needs a look');
  is('diff-upstream', 'look', /upstream/, 'an upstream with another name needs a look');
  is('no-upstream', 'look', /upstream/, 'a branch with no upstream needs a look');
  is('detached', 'look', /detached/, 'a detached HEAD needs a look');
  is('ignored-deep', 'dirty', /ignored file.*notes\/out\/draft\.md/, 'an ignored notes/out/draft.md is data (the allow-list is top-level only)');
  is('ignored-release', 'dirty', /ignored file.*release\/installer\.txt/, 'an ignored release/installer.txt is data (release is not an allowed folder)');
  is('ignored-secret', 'dirty', /ignored file.*dist\/\.env\.local/, 'a .env inside an allowed dist/ is data');
  is('deep-repo', 'look', /nested \.git: .*d[\\/]\.git/, 'a nested .git four levels down needs a look');
  is('other-remote', 'look', /another remote|upstream/, 'an upstream on another remote needs a look');
  assert.ok(!/upstream/.test(row('merged-clean').why), tag + ': merged-clean has the origin upstream');
  assert.ok(lines.some((l) => /finished but dirty: 1 file\b/.test(l)), tag + ': the dirty line says "finished but dirty: 1 file"');
  assert.ok(Object.values(fx.wts).every((p) => fs.existsSync(p)), tag + ': a dry run removes nothing');
  assert.ok(dry.reclaimable > 0, tag + ': the reclaimable total is counted');

  // guards that need a git or gh that fails, and the ones a real repo cannot show (bare, missing directory)
  const wtOf = (b) => ({ path: fx.wts[b], head: g(fx.wts[b], 'rev-parse', 'HEAD').trim(), branch: b, detached: false, locked: false, bare: false, prunable: false });
  const ctxFor = (over, ps) => ({ prState: ps || (() => 'MERGED'), tryGit: stubGit(over), mainPath: fx.main, all: [] });
  const dirU = path.join(tmp, tag + '-unit'); fs.mkdirSync(dirU, { recursive: true });
  const synth = (over) => ({ path: dirU, head: 'h', branch: 'u', detached: false, locked: false, bare: false, prunable: false, ...over });
  assert.strictEqual(mod.classify(synth(), ctxFor()).verdict, 'removable', tag + ': unit: the stub setup is removable');
  assert.match(mod.classify(synth({ bare: true }), ctxFor()).why, /bare/, tag + ': unit: a bare worktree needs a look');
  assert.match(mod.classify(synth({ locked: true }), ctxFor()).why, /locked/, tag + ': unit: a locked worktree needs a look');
  assert.match(mod.classify(synth({ detached: true, branch: null }), ctxFor()).why, /detached/, tag + ': unit: a detached worktree needs a look');
  assert.match(mod.classify(synth({ path: path.join(tmp, 'gone-' + tag) }), ctxFor()).why, /missing/, tag + ': unit: a missing directory needs a look');
  assert.match(mod.classify(synth(), ctxFor({ status: { ok: false, out: '' } })).why, /status failed/, tag + ': unit: a git status error needs a look');
  assert.match(mod.classify(synth(), ctxFor({ log: { ok: false, out: '' } })).why, /compare/, tag + ': unit: a git log error needs a look');
  write(path.join(dirU, 'MERGE_HEAD'), 'x\n');
  assert.match(mod.classify(synth(), ctxFor({ 'rev-parse --git-path MERGE_HEAD': { ok: true, out: 'MERGE_HEAD\n' } })).why, /in progress/, tag + ': unit: an in-progress operation needs a look');
  assert.match(mod.classify(synth(), ctxFor({ 'rev-parse --git-path': { ok: false, out: '' } })).why, /rev-parse failed/, tag + ': unit: a failing rev-parse needs a look');
  assert.match(mod.classify(synth(), ctxFor({}, () => 'UNKNOWN')).why, /unknown/, tag + ': unit: UNKNOWN needs a look');
  assert.match(mod.classify(synth(), ctxFor({}, () => 'NONE')).why, /no PR/, tag + ': unit: no PR needs a look');
  assert.match(mod.classify(synth(), ctxFor({}, () => 'OPEN')).why, /open/, tag + ': unit: an open PR needs a look');
  assert.match(mod.classify(synth(), ctxFor({ 'rev-parse --verify': { ok: false, out: '' } }, () => 'CLOSED')).why, /not on origin/, tag + ': unit: closed and not on origin needs a look');

  // operations in progress: one marker in the worktree's own git dir per kind git uses
  const gdir = path.resolve(fx.wts['merged-clean'], g(fx.wts['merged-clean'], 'rev-parse', '--git-dir').trim());
  const realCtx = { prState: () => 'MERGED', mainPath: fx.main, all: [] };
  for (const name of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'sequencer', 'rebase-merge', 'rebase-apply']) {
    const mk = path.join(gdir, name);
    if (/^(sequencer|rebase-)/.test(name)) fs.mkdirSync(mk); else fs.writeFileSync(mk, 'x\n');
    const why = mod.classify(wtOf('merged-clean'), realCtx).why;
    fs.rmSync(mk, { recursive: true, force: true });
    assert.ok(new RegExp(name).test(why), tag + ': progress: a ' + name + ' in progress needs a look (reason "' + why + '")');
  }
  assert.strictEqual(mod.classify(wtOf('merged-clean'), realCtx).verdict, 'removable', tag + ': progress: without a marker it is removable');
  assert.match(mod.classify(synth(), ctxFor({ 'ls-files': { ok: false, out: '' } })).why, /ls-files failed/, tag + ': unit: a git ls-files error needs a look');

  // --apply on the same fixture; "flip" is merged at the first look and open at the re-check right before its removal
  const calls = {};
  const flip = (b) => {
    calls[b] = (calls[b] || 0) + 1;
    // the 2nd call is the lookup inside the removal: the worktree changes DURING it (a commit; a branch switch)
    if (b === 'mid-commit' && calls[b] === 2) { const p = fx.wts[b]; write(path.join(p, 'mid.txt'), 'm\n'); g(p, 'add', '.'); g(p, 'commit', '-m', 'mid'); }
    if (b === 'mid-branch' && calls[b] === 2) g(fx.wts[b], 'switch', '-c', 'mid-branch-2');
    if (b !== 'flip') return prState(b);
    return calls[b] === 1 ? 'MERGED' : 'OPEN';
  };
  const hooked = (wt) => {
    if (wt.branch === 'late-commit') { write(path.join(wt.path, 'late.txt'), 'l\n'); g(wt.path, 'add', '.'); g(wt.path, 'commit', '-m', 'late'); }
    if (wt.branch === 'late-branch') { g(wt.path, 'switch', '-c', 'late-branch-2'); }
    if (wt.branch === 'late-dirty') write(path.join(wt.path, 'late.txt'), 'l\n');
  };
  const applyLines = [];
  const ap = mod.run({ apply: true, root: fx.main, cwd: fx.main, prState: flip, beforeRemove: hooked, log: (x) => applyLines.push(x) });
  const w = fx.wts;
  assert.ok(!fs.existsSync(w['merged-clean']), tag + ': --apply removes merged-clean');
  assert.ok(!branches(fx.main).includes('merged-clean'), tag + ': --apply deletes the merged-clean branch');
  assert.ok(!fs.existsSync(w['ignored-build']), tag + ': --apply removes a worktree holding only rebuildable ignored files');
  assert.ok(fs.existsSync(path.join(w['merged-dirty'], 'untracked.txt')), tag + ': a dirty worktree is kept with its file');
  assert.ok(fs.existsSync(path.join(w['ignored-env'], '.env')), tag + ': an ignored .env is kept');
  assert.ok(fs.existsSync(w.inner) && fs.existsSync(w.outer), tag + ': a nested worktree is kept with its outer one');
  for (const k of ['merged-unpushed', 'no-pr', 'open-pr', 'unknown-pr', 'closed-gone', 'locked', 'outer2', 'mid-merge', 'diff-upstream', 'no-upstream', 'detached']) {
    assert.ok(fs.existsSync(w[k]), tag + ': --apply keeps ' + k);
  }
  const lineOf = (b) => applyLines.find((l) => l.includes('[' + b + ']')) || '';
  assert.ok(fs.existsSync(w['late-commit']) && /changed since the check, kept: HEAD or branch moved/.test(lineOf('late-commit')), tag + ': late: a HEAD that moved before the removal is kept, "moved" (' + lineOf('late-commit').slice(-60) + ')');
  assert.ok(fs.existsSync(w['late-branch']) && /changed since the check, kept: HEAD or branch moved/.test(lineOf('late-branch')), tag + ': late: a branch that changed before the removal is kept, "moved"');
  assert.ok(fs.existsSync(w['late-dirty']) && /changed since the check/.test(lineOf('late-dirty')), tag + ': late: a file that appeared before the removal keeps the worktree');
  assert.ok(fs.existsSync(w['mid-commit']) && /changed during the PR check, kept: HEAD or branch moved/.test(lineOf('mid-commit')), tag + ': mid: a commit made during the PR lookup keeps the worktree (' + lineOf('mid-commit').slice(-70) + ')');
  assert.ok(fs.existsSync(w['mid-branch']) && /changed during the PR check, kept: HEAD or branch moved/.test(lineOf('mid-branch')), tag + ': mid: a branch switch during the PR lookup keeps the worktree');
  for (const k of ['ignored-deep', 'ignored-release', 'ignored-secret', 'deep-repo', 'other-remote']) assert.ok(fs.existsSync(w[k]), tag + ': --apply keeps ' + k);
  assert.ok(fs.existsSync(w.flip) && /changed since the check, kept: PR is open/.test(lineOf('flip')), tag + ': the state is checked again right before the removal (recheck)');
  assert.ok(!fs.existsSync(w.squashed), tag + ': a squash-merged worktree whose branch left origin is removed');
  assert.ok(branches(fx.main).includes('squashed'), tag + ': git branch -d refuses the squash-merged branch, so it is kept (never -D)');
  assert.ok(ap.removed >= 3 && fs.existsSync(fx.main), tag + ': the main checkout stays');

  // the worktree it runs in is skipped
  const fs2 = fixture(tag + '-self');
  const selfLines = [];
  const selfRes = mod.run({ apply: true, root: fs2.main, cwd: fs2.wts['merged-clean'], prState, log: (x) => selfLines.push(x) });
  assert.ok(selfLines.some((l) => l.startsWith('new worktrees go under') && l.includes(fs2.main + '-worktrees') && !l.includes('merged-clean')), tag + ': root: run from a linked worktree, the root still comes from the main checkout');
  assert.ok(fs.existsSync(fs2.wts['merged-clean']) && selfRes.rows.find((r) => r.wt.branch === 'merged-clean').verdict === 'skip', tag + ': self: the worktree it runs in is skipped, not removed');

  const realGit = (args, cwd) => { try { return { ok: true, out: execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { ok: false, out: '', err: String(e.message) }; } };
  const unreadLines = [];
  const un = mod.run({ apply: true, root: fs2.main, cwd: fs2.main, prState, tryGit: (args, cwd) => (args[0] === 'symbolic-ref' ? { ok: false, out: '' } : realGit(args, cwd)), log: (x) => unreadLines.push(x) });
  assert.ok(un.removed === 0 && unreadLines.some((l) => /changed since the check, kept: HEAD or branch unreadable/.test(l)), tag + ': recheck: a HEAD or branch that cannot be read again keeps the worktree, "unreadable"');

  // through npm without `--`
  const fs3 = fixture(tag + '-npm');
  const sp = spawnSync(process.execPath, [modPath, '--root', fs3.main], { cwd: fs3.main, env: { ...ENV, npm_lifecycle_event: 'worktrees:clean' }, encoding: 'utf8', timeout: 60000 });
  assert.match(sp.stderr, /NOTE: run through npm without --apply.*-- --apply/, tag + ': npm: run through npm without --apply, it says how to apply');
  assert.ok(fs.existsSync(fs3.wts['merged-clean']), tag + ': npm: it stays a dry run');
  const sp2 = spawnSync(process.execPath, [modPath, '--apply', '--root', fs3.main], { cwd: fs3.main, env: { ...ENV, npm_lifecycle_event: 'worktrees:clean' }, encoding: 'utf8', timeout: 60000 });
  assert.ok(!/NOTE: run through npm/.test(sp2.stderr) && /^worktrees:clean --apply/m.test(sp2.stdout), tag + ': npm: with --apply it applies and does not nag');

  ghCases(mod, tag);
  staticCheck(modPath, tag);
}

function ghCases(mod, tag) {
  if (process.platform === 'win32') return; // the fake gh is a POSIX script
  const dir = path.join(tmp, tag + '-gh'); fs.mkdirSync(dir);
  const repo = path.join(dir, 'repo'); fs.mkdirSync(repo);
  g(repo, 'init', '-b', 'main');
  const commit = (n) => { write(path.join(repo, n), n); g(repo, 'add', '.'); g(repo, 'commit', '-m', n); return g(repo, 'rev-parse', 'HEAD').trim(); };
  const c0 = commit('c0'), c1 = commit('c1'), c2 = commit('c2');
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), '#!/usr/bin/env node\nif (process.env.FAKE_GH_MODE === "fail") { process.stderr.write("boom"); process.exit(1); }\nprocess.stdout.write(process.env.FAKE_GH_JSON || "");\n', { mode: 0o755 });
  const saved = { PATH: process.env.PATH };
  process.env.PATH = bin + path.delimiter + saved.PATH;
  const ask = (json, mode) => { process.env.FAKE_GH_JSON = json; process.env.FAKE_GH_MODE = mode || ''; return mod.ghPrState('b', c1, repo); };
  const pr = (state, oid, cross) => ({ state, headRefOid: oid, isCrossRepository: cross === undefined ? false : cross });
  try {
    assert.strictEqual(ask('', 'fail'), 'UNKNOWN', tag + ': gh: a gh failure is UNKNOWN');
    assert.strictEqual(ask('not json'), 'UNKNOWN', tag + ': gh: unreadable output is UNKNOWN');
    assert.strictEqual(ask('{}'), 'UNKNOWN', tag + ': gh: a non-list answer is UNKNOWN');
    assert.strictEqual(ask('[]'), 'NONE', tag + ': gh: an empty answer is NONE');
    assert.strictEqual(ask(JSON.stringify([pr('MERGED', c1)])), 'MERGED', tag + ': gh: a merged PR with this head is MERGED');
    assert.strictEqual(ask(JSON.stringify([pr('CLOSED', c1)])), 'CLOSED', tag + ': gh: a closed PR with this head is CLOSED');
    assert.strictEqual(ask(JSON.stringify([pr('MERGED', c1, true)])), 'NONE', tag + ': gh: a fork PR is ignored');
    assert.strictEqual(ask(JSON.stringify([{ state: 'MERGED', headRefOid: c1 }])), 'NONE', tag + ': gh: a PR without isCrossRepository is ignored');
    assert.strictEqual(ask(JSON.stringify([pr('MERGED', c0)])), 'NONE', tag + ': gh: a reused branch name (another head) does not match');
    assert.strictEqual(ask(JSON.stringify([pr('MERGED', c2)])), 'MERGED', tag + ': gh: a PR whose head is a descendant of HEAD matches');
    assert.strictEqual(ask(JSON.stringify([pr('MERGED', c1), pr('OPEN', c1)])), 'OPEN', tag + ': gh: any open matching PR makes it OPEN');
    assert.strictEqual(ask(JSON.stringify([pr('WEIRD', c1)])), 'UNKNOWN', tag + ': gh: an odd state is UNKNOWN');
  } finally {
    process.env.PATH = saved.PATH; delete process.env.FAKE_GH_JSON; delete process.env.FAKE_GH_MODE;
  }
}

// No force anywhere in the code, whatever the quote style (comments stripped).
function staticCheck(modPath, tag) {
  const code = fs.readFileSync(modPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/--force|['"`]-f+['"`]|['"`]-D['"`]|['"`]-[a-zA-Z]*f[a-zA-Z]*['"`]/.test(code), tag + ': static: the script never forces a removal or force-deletes a branch');
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
  assert.deepStrictEqual(mod.ignoredData(['dist/a.js', 'x.tsbuildinfo', '.env', 'notes/out/x.md', 'release/s.p12', 'dist/.env.local', 'dist/k.pem', 'out/a/b.js', 'a/x.tsbuildinfo', '']), ['.env', 'notes/out/x.md', 'release/s.p12', 'dist/.env.local', 'dist/k.pem', 'a/x.tsbuildinfo'], 'ignored: only non-rebuildable ignored entries are data');
}

check(SRC, 'real');
tmpList();
parseCase();

// Mutants: each must die at its own message.
const src = fs.readFileSync(SRC, 'utf8');
const MUTANTS = [
  ['unknown-removable', "  if (state !== 'MERGED' && state !== 'CLOSED') return { verdict: 'look', why: 'PR state unknown' };\n", '', /unknown/],
  ['closed-not-on-origin', "} else if (state !== 'MERGED') {", '} else if (false) {', /not on origin/],
  ['locked-dropped', 'if (wt.locked) return', 'if (false) return', /locked/],
  ['bare-dropped', 'if (wt.bare) return', 'if (false) return', /bare/],
  ['missing-dropped', 'if (!fs.existsSync(wt.path)) return', 'if (false) return', /missing/],
  ['detached-dropped', 'if (wt.detached || !wt.branch) return', 'if (false) return', /detached/],
  ['main-in-loop', 'for (const wt of all.slice(1))', 'for (const wt of all)', /main checkout is never in the loop/],
  ['gh-failure-merged', "} catch { return 'UNKNOWN'; }\n  let arr;", "} catch { return 'MERGED'; }\n  let arr;", /gh failure/],
  ['gh-empty-merged', "if (mine.length === 0) return 'NONE';", "if (mine.length === 0) return 'MERGED';", /empty answer/],
  ['gh-fork-counts', "|| x.isCrossRepository !== false) continue;", ') continue;', /fork PR|isCrossRepository/],
  ['gh-oid-ignored', "if (x.headRefOid === headSha || tryGit(['merge-base', '--is-ancestor', headSha, x.headRefOid], cwd).ok)", 'if (true)', /reused branch name/],
  ['gh-ancestor-dropped', " || tryGit(['merge-base', '--is-ancestor', headSha, x.headRefOid], cwd).ok", '', /descendant/],
  ['open-dropped', "  if (state === 'OPEN') return { verdict: 'look', why: 'PR is open' };\n", '', /open/],
  ['none-dropped', "  if (state === 'NONE') return { verdict: 'look', why: 'no PR of this repository matches this branch and HEAD' };\n", '', /no PR/],
  ['log-error-ignored', "if (!ahead.ok) return { verdict: 'look', why: 'cannot compare with origin' };", '', /git log error/],
  ['status-error-ignored', "if (!st.ok) return { verdict: 'look', why: 'git status failed' };", '', /git status error/],
  ['rev-parse-error-ignored', "if (!gp.ok) return { verdict: 'look', why: 'git rev-parse failed' };", '', /failing rev-parse/],
  ['ignored-data-allowed', 'if (data.length > 0) return', 'if (false) return', /ignored \.env/],
  ['rebuildable-empty', "new Set(['dist', 'dist-scripts', 'out', 'build', '_site'])", 'new Set([])', /rebuildable|only non-rebuildable/],
  ['ignored-listing-dropped', "const data = ignoredData(ig.out.split('\\0'));", 'const data = [];', /ignored \.env|ignored file/],
  ['allow-any-depth', 'REBUILDABLE_TOP.has(segs[0])', 'segs.some((x) => REBUILDABLE_TOP.has(x))', /notes\/out/],
  ['allow-release', "new Set(['dist', 'dist-scripts', 'out', 'build', '_site'])", "new Set(['dist', 'dist-scripts', 'out', 'build', '_site', 'release'])", /release\/installer/],
  ['secret-in-dist', ' && !SECRET_LIKE.test(p)', '', /\.env inside an allowed dist|only non-rebuildable/],
  ['nested-depth-capped', 'const MAX_NESTED_DEPTH = 64;', 'const MAX_NESTED_DEPTH = 2;', /nested \.git four levels/],
  ['ls-files-error-ignored', "if (!ig.ok) return { verdict: 'look', why: 'git ls-files failed' };", '', /ls-files error/],
  ['head-moved-dropped', 'first.head !== wt.head || ', '', /HEAD that moved/],
  ['branch-moved-dropped', ' || first.branch !== wt.branch', '', /branch that changed/],
  ['last-reread-dropped', "  const last = readHeadBranch(wt, tg);\n  if (!last) return { removed: false, note: 'changed during the PR check, kept: HEAD or branch unreadable' };\n  if (last.head !== wt.head || last.branch !== wt.branch) return { removed: false, note: 'changed during the PR check, kept: HEAD or branch moved' };\n  const fin = classify({ ...wt, head: last.head, branch: last.branch }, { ...ctx, prState: () => seen });\n  if (fin.verdict !== 'removable') return { removed: false, note: 'changed during the PR check, kept: ' + fin.why };\n", '', /mid: a commit made during/],
  ['last-branch-compare-dropped', ' || last.branch !== wt.branch', '', /mid: a branch switch/],
  ['recheck-unreadable', "if (!first) return { removed: false, note: 'changed since the check, kept: HEAD or branch unreadable' };\n  if (first.head !== wt.head || first.branch !== wt.branch)", "if (first && (first.head !== wt.head || first.branch !== wt.branch))", /unreadable/],
  ['other-remote-ok', " || remote.out.trim() !== 'origin'", '', /another remote|upstream on another remote/],
  ['progress-cherry', "'CHERRY_PICK_HEAD', ", '', /CHERRY_PICK_HEAD in progress/],
  ['progress-rebase-head', "'REBASE_HEAD', ", '', /REBASE_HEAD in progress/],
  ['progress-revert', "'REVERT_HEAD', ", '', /REVERT_HEAD in progress/],
  ['progress-bisect', "'BISECT_LOG', ", '', /BISECT_LOG in progress/],
  ['progress-sequencer', "'rebase-apply', 'sequencer']", "'rebase-apply']", /sequencer in progress/],
  ['progress-rebase-merge', "'rebase-merge', ", '', /rebase-merge in progress/],
  ['progress-rebase-apply', "'rebase-apply', 'sequencer']", "'sequencer']", /rebase-apply in progress/],
  ['progress-merge-head', "['MERGE_HEAD', ", '[', /merge in progress|MERGE_HEAD in progress/],
  ['root-from-cwd', "mainPath + '-worktrees'", "here + '-worktrees'", /root/],
  ['nested-worktree', 'if (inner) return', 'if (false) return', /holding another worktree/],
  ['nested-git', 'if (nested) return', 'if (false) return', /nested \.git/],
  ['in-progress-dropped', "if (fs.existsSync(p)) return { verdict: 'look', why: 'a ' + name", "if (false) return { verdict: 'look', why: 'a ' + name", /merge in progress|in-progress/],
  ['upstream-dropped', "if (!remote.ok || remote.out.trim() !== 'origin' || !merge.ok || merge.out.trim() !== 'refs/heads/' + wt.branch) {", 'if (false) {', /upstream/],
  ['upstream-name-dropped', "|| !merge.ok || merge.out.trim() !== 'refs/heads/' + wt.branch", '|| !merge.ok', /another name/],
  ['recheck-dropped', "if (slow.verdict !== 'removable') return", 'if (false) return', /checked again|keeps the worktree/],
  ['self-not-skipped', 'if (inside(here, wt.path)) {', 'if (false) {', /runs in is skipped/],
  ['force-double-quoted', "['worktree', 'remove', wt.path]", '["worktree", "remove", "-f", "-f", wt.path]', /static/],
  ['branch-force-D', "['branch', '-d', wt.branch]", "['branch', '-D', wt.branch]", /never -D|static/],
  ['dry-run-applies', "if (opts.apply) {\n        const res", "if (true) {\n        const res", /dry run removes nothing/],
  ['npm-note-dropped', 'if (!apply && env && env.npm_lifecycle_event)', 'if (false)', /says how to apply/],
  ['tmp-any', "/^durbar-site-[A-Za-z0-9._-]+$/]", "/^durbar-site-[A-Za-z0-9._-]+$/, /^tmp\\./]", /only old durbar/],
];
let n = 0;
for (const [name, from, to, expect] of MUTANTS) {
  assert.ok(src.includes(from), 'mutant ' + name + ': the text to change is gone from the script');
  const mp = path.join(tmp, 'mutant-' + name + '.js');
  fs.writeFileSync(mp, src.replace(from, () => to));
  let died = null;
  try {
    if (name === 'tmp-any') {
      const m = require(mp);
      const dir = path.join(tmp, 'mtmp'); fs.mkdirSync(dir);
      const p = path.join(dir, 'tmp.AbCdEf'); fs.mkdirSync(p);
      const old = (Date.now() - 5 * 24 * 3600 * 1000) / 1000; fs.utimesSync(p, old, old);
      assert.deepStrictEqual(m.staleTmp([dir], Date.now(), []).map((f) => path.basename(f.path)), [], 'tmp: only old durbar-ui-shots-* and durbar-site-* directories are listed');
    } else if (name === 'rebuildable-empty') {
      const m = require(mp);
      assert.deepStrictEqual(m.ignoredData('!! node_modules/\n'), [], 'ignored: only non-rebuildable ignored entries are data');
      check(mp, name);
    } else check(mp, name);
  } catch (e) { died = e; }
  assert.ok(died, 'mutant ' + name + ' survived');
  assert.ok(expect.test(String(died.message)), 'mutant ' + name + ' died at the wrong assert: ' + String(died.message).split('\n')[0]);
  n++;
}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
console.log('worktrees-clean: ok (' + n + ' mutants killed)');
