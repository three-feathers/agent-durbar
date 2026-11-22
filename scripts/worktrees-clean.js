#!/usr/bin/env node
/*
 * Spec 021 FR-100 (issue #1992): `npm run worktrees:clean` lists, and with `--apply` removes, the linked git worktrees of THIS repo that are
 * finished. Every PR leaves one worktree (a node_modules copy, 200-900 MB); on 2026-11-22 35 of them filled a disk to 94%.
 *
 * DRY RUN BY DEFAULT: without `--apply` nothing is changed. For each linked worktree (never the main checkout, never the one this runs in):
 *   REMOVABLE  only when ALL hold: it is on a branch (not a detached HEAD, not locked); that branch's PR is MERGED or CLOSED (no PR, an
 *              OPEN PR, or a state that could not be read is never removable: "needs a look"); the working tree has no change at all
 *              (no tracked change, staged change or untracked file; ignored files such as node_modules do not count); and it holds no
 *              commit origin lacks (`git log origin/<branch>..HEAD` is empty; a branch origin no longer has is accepted only when its
 *              PR is MERGED, the branch having been deleted on merge).
 *   Removal    `git worktree remove <path>` WITHOUT --force, then `git branch -d <branch>` (never -D), then `git worktree prune`.
 *   A finished (merged or closed PR) worktree that is dirty is listed "finished but dirty: N files" and NEVER deleted.
 * It reports the disk each worktree uses and the total reclaimable. git runs through execFile with argument arrays (no shell, no user
 * string in a command line); the PR state comes from `gh pr list --head <branch> --state all --json state` (gh missing or failing = unknown).
 *
 * `--tmp` (list only, never deletes, even with --apply): stale agent temp directories directly under os.tmpdir() whose names match
 * `durbar-ui-shots-*` or `durbar-site-*`, a real directory (not a link), not changed for 2 days, and not a registered worktree.
 * `tmp.*` is NOT included: nothing here proves it is ours. Delete what it lists by hand after looking.
 *
 *   node scripts/worktrees-clean.js [--apply] [--tmp] [--root D]     --root D: the repo to read (default: this one)
 * Exit 0 on a finished run, 2 on usage or when git cannot be read.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const GIT_TIMEOUT_MS = 60000;
const TMP_PATTERNS = [/^durbar-ui-shots-[A-Za-z0-9._-]+$/, /^durbar-site-[A-Za-z0-9._-]+$/];
const TMP_MAX_AGE_MS = 2 * 24 * 3600 * 1000;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

function tryGit(args, cwd) {
  try { return { ok: true, out: git(args, cwd) }; } catch (e) { return { ok: false, out: '', err: String((e && e.stderr) || e.message || e).split('\n')[0] }; }
}

/** `git worktree list --porcelain` text -> [{ path, head, branch (short name or null), detached, locked, prunable }]. The first one is the main checkout. */
function parseWorktrees(text) {
  const list = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const wt = { path: '', head: '', branch: null, detached: false, locked: false, prunable: false, bare: false };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) wt.path = line.slice(9);
      else if (line.startsWith('HEAD ')) wt.head = line.slice(5);
      else if (line.startsWith('branch ')) wt.branch = line.slice(7).replace(/^refs\/heads\//, '');
      else if (line === 'detached') wt.detached = true;
      else if (line === 'bare') wt.bare = true;
      else if (line === 'locked' || line.startsWith('locked ')) wt.locked = true;
      else if (line === 'prunable' || line.startsWith('prunable ')) wt.prunable = true;
    }
    if (wt.path) list.push(wt);
  }
  return list;
}

/** Disk used by a directory tree in bytes, links not followed. */
function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      try {
        const st = fs.lstatSync(p);
        total += typeof st.blocks === 'number' ? st.blocks * 512 : st.size;
        if (e.isDirectory() && !st.isSymbolicLink()) stack.push(p);
      } catch { /* vanished */ }
    }
  }
  return total;
}

/** The PR state of a branch through gh: MERGED, CLOSED, OPEN, NONE (no PR) or UNKNOWN (gh missing or failed). */
function ghPrState(branch, cwd) {
  let out;
  try {
    out = execFileSync('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'state', '--limit', '30'], { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { return 'UNKNOWN'; }
  let arr;
  try { arr = JSON.parse(out); } catch { return 'UNKNOWN'; }
  if (!Array.isArray(arr)) return 'UNKNOWN';
  if (arr.length === 0) return 'NONE';
  const states = arr.map((x) => (x && typeof x.state === 'string' ? x.state : 'UNKNOWN'));
  if (states.includes('OPEN')) return 'OPEN';
  if (states.every((s) => s === 'MERGED' || s === 'CLOSED')) return states.includes('MERGED') ? 'MERGED' : 'CLOSED';
  return 'UNKNOWN';
}

/**
 * Decide one worktree. Returns { verdict: 'removable' | 'dirty' | 'look', why, files }.
 * 'dirty' = finished but has changes (never deleted); 'look' = anything else that is not removable.
 */
function classify(wt, ctx) {
  if (wt.bare) return { verdict: 'look', why: 'bare repository' };
  if (wt.locked) return { verdict: 'look', why: 'locked' };
  if (wt.detached || !wt.branch) return { verdict: 'look', why: 'detached HEAD' };
  if (!fs.existsSync(wt.path)) return { verdict: 'look', why: 'directory missing (git worktree prune clears the record)' };
  const state = ctx.prState(wt.branch);
  if (state === 'NONE') return { verdict: 'look', why: 'branch has no PR' };
  if (state === 'OPEN') return { verdict: 'look', why: 'PR is open' };
  if (state !== 'MERGED' && state !== 'CLOSED') return { verdict: 'look', why: 'PR state unknown' };
  const st = tryGit(['status', '--porcelain', '--untracked-files=all'], wt.path);
  if (!st.ok) return { verdict: 'look', why: 'git status failed' };
  const files = st.out.split(/\r?\n/).filter((l) => l.length > 0).length;
  if (files > 0) return { verdict: 'dirty', why: 'finished but dirty: ' + files + ' file' + (files === 1 ? '' : 's'), files };
  const onOrigin = tryGit(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/' + wt.branch], wt.path).ok;
  if (onOrigin) {
    const ahead = tryGit(['log', '--oneline', 'origin/' + wt.branch + '..HEAD'], wt.path);
    if (!ahead.ok) return { verdict: 'look', why: 'cannot compare with origin' };
    if (ahead.out.trim() !== '') return { verdict: 'look', why: 'commits origin does not have' };
  } else if (state !== 'MERGED') {
    return { verdict: 'look', why: 'closed PR and the branch is not on origin' };
  }
  return { verdict: 'removable', why: 'PR ' + state.toLowerCase() + ', clean, nothing unpushed' };
}

/** Remove one removable worktree: `worktree remove` (no --force), `branch -d` (never -D), `worktree prune`. Returns { removed, note }. */
function removeOne(wt, mainPath) {
  const r = tryGit(['worktree', 'remove', wt.path], mainPath);
  if (!r.ok) return { removed: false, note: 'git worktree remove refused: ' + r.err };
  const b = tryGit(['branch', '-d', wt.branch], mainPath);
  tryGit(['worktree', 'prune'], mainPath);
  return { removed: true, note: b.ok ? 'branch deleted' : 'worktree removed, branch kept (git branch -d refused: ' + b.err + ')' };
}

function realOr(p) { try { return fs.realpathSync(p); } catch { return path.resolve(p); } }
function inside(child, parent) {
  const rel = path.relative(realOr(parent), realOr(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function fmt(bytes) { return bytes >= 1e9 ? (bytes / 1e9).toFixed(2) + ' GB' : (bytes / 1e6).toFixed(0) + ' MB'; }

/** Stale agent temp directories (list only). */
function staleTmp(dirs, now, exclude) {
  const found = [];
  for (const root of dirs) {
    let names;
    try { names = fs.readdirSync(root); } catch { continue; }
    for (const name of names) {
      if (!TMP_PATTERNS.some((re) => re.test(name))) continue;
      const p = path.join(root, name);
      let st;
      try { st = fs.lstatSync(p); } catch { continue; }
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      if (now - st.mtimeMs < TMP_MAX_AGE_MS) continue;
      if (exclude.some((w) => inside(p, w) || inside(w, p))) continue;
      found.push({ path: p, bytes: dirSize(p) });
    }
  }
  return found;
}

/**
 * Whole run. opts: { apply, tmp, root, cwd, prState, now, tmpDirs, log }.
 * Returns { rows, removed, reclaimable, tmp } for the test.
 */
function run(opts) {
  const log = opts.log || ((s) => process.stdout.write(s + '\n'));
  const root = opts.root;
  const listed = tryGit(['worktree', 'list', '--porcelain'], root);
  if (!listed.ok) throw new Error('cannot read git worktree list: ' + listed.err);
  const all = parseWorktrees(listed.out);
  if (all.length === 0) throw new Error('git worktree list is empty');
  const mainPath = all[0].path;
  const here = opts.cwd || process.cwd();
  const prState = opts.prState || ((b) => ghPrState(b, mainPath));
  const rows = [];
  for (const wt of all.slice(1)) {
    if (inside(here, wt.path)) { rows.push({ wt, verdict: 'skip', why: 'the worktree this runs in', bytes: 0 }); continue; }
    const c = classify(wt, { prState });
    const bytes = fs.existsSync(wt.path) ? dirSize(wt.path) : 0;
    rows.push({ wt, bytes, ...c });
  }
  let reclaimable = 0;
  let removed = 0;
  log((opts.apply ? 'worktrees:clean --apply' : 'worktrees:clean (dry run: nothing is changed; --apply removes the REMOVABLE ones)') + ', ' + rows.length + ' linked worktree' + (rows.length === 1 ? '' : 's'));
  for (const r of rows) {
    const label = { removable: 'REMOVABLE', dirty: 'DIRTY    ', look: 'NEEDS A LOOK', skip: 'SKIPPED  ' }[r.verdict];
    let line = label + '  ' + fmt(r.bytes).padStart(9) + '  ' + r.wt.path + '  [' + (r.wt.branch || 'detached') + ']  ' + r.why;
    if (r.verdict === 'removable') {
      reclaimable += r.bytes;
      if (opts.apply) {
        const res = removeOne(r.wt, mainPath);
        r.removed = res.removed;
        if (res.removed) removed += 1;
        line += '  -> ' + (res.removed ? 'removed, ' : 'kept, ') + res.note;
        if (!res.removed) reclaimable -= r.bytes;
      }
    }
    log(line);
  }
  if (opts.apply) tryGit(['worktree', 'prune'], mainPath);
  const count = (v) => rows.filter((r) => r.verdict === v).length;
  const dirtyBytes = rows.filter((r) => r.verdict === 'dirty').reduce((s, r) => s + r.bytes, 0);
  log('summary: ' + count('removable') + ' removable (' + fmt(rows.filter((r) => r.verdict === 'removable').reduce((s, r) => s + r.bytes, 0)) + '), ' +
    count('dirty') + ' finished but dirty (' + fmt(dirtyBytes) + ', never deleted), ' + count('look') + ' need a look, ' + count('skip') + ' skipped');
  log(opts.apply ? ('removed ' + removed + ', reclaimed ' + fmt(reclaimable)) : ('reclaimable with --apply: ' + fmt(reclaimable)));
  let tmp = [];
  if (opts.tmp) {
    tmp = staleTmp(opts.tmpDirs || [os.tmpdir()], opts.now || Date.now(), all.map((w) => w.path));
    log('stale temp (list only, never deleted by this script; look, then remove by hand): ' + tmp.length + ', ' + fmt(tmp.reduce((s, t) => s + t.bytes, 0)));
    for (const t of tmp) log('  ' + fmt(t.bytes).padStart(9) + '  ' + t.path);
  }
  return { rows, removed, reclaimable, tmp };
}

function main(argv) {
  let apply = false, tmp = false, root = path.join(__dirname, '..');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') apply = true;
    else if (argv[i] === '--tmp') tmp = true;
    else if (argv[i] === '--root' && argv[i + 1]) root = argv[++i];
    else { process.stderr.write('usage: node scripts/worktrees-clean.js [--apply] [--tmp] [--root D]\n'); return 2; }
  }
  try { run({ apply, tmp, root }); } catch (e) { process.stderr.write('worktrees:clean: ' + e.message + '\n'); return 2; }
  return 0;
}

module.exports = { parseWorktrees, classify, run, staleTmp, ghPrState, dirSize, TMP_PATTERNS };
if (require.main === module) process.exit(main(process.argv.slice(2)));
