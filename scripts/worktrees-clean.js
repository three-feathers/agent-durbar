#!/usr/bin/env node
/*
 * Spec 021 FR-100 (issue #1992): `npm run worktrees:clean -- --apply` lists, and with `--apply` removes, the linked git worktrees of THIS repo
 * that are finished. Every PR leaves one worktree (a node_modules copy, 200-900 MB); on 2026-11-22 35 of them filled a disk to 94%.
 * NOTE: through npm the flag needs `--`: `npm run worktrees:clean -- --apply` (without it npm drops the flag; run through npm without --apply this script says so and stays a dry run).
 *
 * DRY RUN BY DEFAULT: without `--apply` nothing is changed. For each linked worktree (never the main checkout, never the one this runs in)
 * it is REMOVABLE only when ALL hold; anything else is "needs a look" or "finished but dirty" and is never deleted:
 *   - it is on a branch (not detached, not locked, not bare), its directory exists, and no other registered worktree and no `.git` at ANY depth
 *     (node_modules aside) lives inside it;
 *   - no other registered worktree has a top-level link (symlink, or a junction on Windows; `node_modules` is the usual one: agents share one
 *     `npm ci` that way) that resolves into it, dangling or not (issue #2063): removing it would break that worktree. It is kept as "linked from <path>";
 *     once the dependant is removed, the next run frees it. A sibling folder (or link) that cannot be read keeps it too: its links were not all seen;
 *   - no merge, rebase, cherry-pick, revert or bisect is in progress (MERGE_HEAD, REBASE_HEAD, rebase-merge, rebase-apply, CHERRY_PICK_HEAD,
 *     REVERT_HEAD, sequencer, BISECT_LOG; found with `git rev-parse --git-path`);
 *   - the branch has a PR in THIS repository (not a fork) whose head commit is the worktree's HEAD or a descendant of it (the branch name alone
 *     proves nothing: names get reused) and that PR is MERGED or CLOSED (no PR, an open PR, gh missing or failing = needs a look);
 *   - the working tree has no change at all: no tracked change, staged change or untracked file, and no IGNORED file (every one listed, folders
 *     expanded) except rebuildable ones: anything under node_modules, or under a TOP-LEVEL dist, dist-scripts, out, build or _site, or a root *.tsbuildinfo,
 *     and even there never a `.env*`, key or certificate. A `.env`, local settings, notes, `notes/out/x.md` or `release/x.p12` count as dirty;
 *   - the branch's upstream is `origin/<same name>`, and no commit is missing on origin (`git log origin/<branch>..HEAD` is empty; an upstream
 *     origin no longer has is accepted only for a MERGED PR whose head matched, the branch having been deleted on merge).
 *   Removal: the HEAD, the branch and the whole state are read AGAIN after the (slow) PR lookup, immediately before each removal; then `git worktree remove <path>` WITHOUT --force, then `git branch -d <branch>`
 *   (never -D), then `git worktree prune`.
 * It reports the disk each worktree uses and the total reclaimable. git runs through execFile with argument arrays (no shell, no user string in a
 * command line); the PR comes from `gh pr list --head <branch> --state all --json state,headRefOid,isCrossRepository`.
 *
 * `--tmp` (list only, never deletes, even with --apply): stale agent temp directories directly under os.tmpdir() named `durbar-ui-shots-*` or
 * `durbar-site-*`, real directories, not changed for 2 days, not a registered worktree. `tmp.*` is NOT included: nothing proves it is ours.
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
// Ignored paths that a build recreates. Anything else ignored (.env, local settings, notes) is the owner's data.
const REBUILDABLE_TOP = new Set(['dist', 'dist-scripts', 'out', 'build', '_site']);
const SECRET_LIKE = /(^|\/)(\.env[^/]*|[^/]*\.(p12|pfx|pem|key|crt|cer|jks|keystore|asc|gpg))$/i;
const MAX_NESTED_DEPTH = 64;
const IN_PROGRESS = ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply', 'sequencer'];

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

// work counters, read by the test to pin the cost of one run (a regression shows as a counter failure, not a CI timeout)
const stats = { git: 0, stat: 0 };

function tryGit(args, cwd) {
  stats.git++;
  try { return { ok: true, out: git(args, cwd) }; } catch (e) { return { ok: false, out: '', err: String((e && e.stderr) || e.message || e).split('\n')[0] }; }
}

/** `git worktree list --porcelain` text -> [{ path, head, branch (short name or null), detached, locked, prunable, bare }]. The first one is the main checkout. */
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

/**
 * Disk used by a directory tree in bytes (links and junctions not followed), and how many entries could not be read (EPERM, EBUSY, EACCES...).
 * Stats.blocks is 0 on Windows, so the allocated size is used only when blocks is positive and the file size otherwise. statFn is for the test.
 */
function dirSizeChecked(dir, statFn) {
  const stat = statFn || fs.lstatSync;
  let bytes = 0, unreadable = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { if (!e || e.code !== 'ENOENT') unreadable += 1; continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      try {
        stats.stat++;
        const st = stat(p);
        bytes += st.blocks > 0 ? st.blocks * 512 : st.size;
        if (e.isDirectory() && !st.isSymbolicLink()) stack.push(p);
      } catch (err) { if (!err || err.code !== 'ENOENT') unreadable += 1; }
    }
  }
  return { bytes, unreadable };
}
function dirSize(dir, statFn) { return dirSizeChecked(dir, statFn).bytes; }

/** A `.git` entry anywhere below dir (not dir's own), skipping node_modules and links. A tree deeper than MAX_NESTED_DEPTH counts as a hit. */
function findNestedGit(root) {
  const stack = [[root, 0]];
  while (stack.length) {
    const [dir, depth] = stack.pop();
    if (depth > MAX_NESTED_DEPTH) return dir + ' (deeper than ' + MAX_NESTED_DEPTH + ' levels)';
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name === '.git') { if (dir !== root) return path.join(dir, e.name); continue; }
      if (e.name === 'node_modules' || !e.isDirectory()) continue;
      stack.push([path.join(dir, e.name), depth + 1]);
    }
  }
  return null;
}

/**
 * The PR state of a worktree's branch through gh: MERGED, CLOSED, OPEN, NONE (no PR in this repository whose head is this HEAD or a descendant)
 * or UNKNOWN (gh missing, failed or unreadable). Only PRs of THIS repository count (a fork PR can share the branch name) and only those whose
 * headRefOid is the worktree's HEAD, or a descendant of it (the PR got more commits): a reused branch name does not match.
 */
function defaultGh(args, cwd) {
  return execFileSync('gh', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}
// runGh(args, cwd) -> stdout text, or throws: injectable so a test runs on every OS without a gh binary or a PATH shim.
function ghPrState(branch, headSha, cwd, runGh) {
  let out;
  try {
    out = (runGh || defaultGh)(['pr', 'list', '--head', branch, '--state', 'all', '--json', 'state,headRefOid,isCrossRepository', '--limit', '30'], cwd);
  } catch { return 'UNKNOWN'; }
  let arr;
  try { arr = JSON.parse(out); } catch { return 'UNKNOWN'; }
  if (!Array.isArray(arr)) return 'UNKNOWN';
  const mine = [];
  for (const x of arr) {
    if (!x || typeof x.state !== 'string' || typeof x.headRefOid !== 'string' || x.isCrossRepository !== false) continue;
    if (x.headRefOid === headSha || tryGit(['merge-base', '--is-ancestor', headSha, x.headRefOid], cwd).ok) mine.push(x.state);
  }
  if (mine.length === 0) return 'NONE';
  if (mine.includes('OPEN')) return 'OPEN';
  if (mine.every((s) => s === 'MERGED' || s === 'CLOSED')) return mine.includes('MERGED') ? 'MERGED' : 'CLOSED';
  return 'UNKNOWN';
}

// realpath.native expands Windows 8.3 short names (RUNNER~1) the way git prints long ones; the JS realpath does not.
function realOr(p) { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } }
function inside(child, parent) {
  const rel = path.relative(realOr(parent), realOr(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Ignored files (paths relative to the worktree, folders expanded) that are not rebuildable. node_modules is not listed by the caller. */
function ignoredData(paths) {
  const keep = [];
  for (const p of paths) {
    if (!p) continue;
    const segs = p.split('/');
    const rebuildable = (segs.length > 1 && REBUILDABLE_TOP.has(segs[0]) && !SECRET_LIKE.test(p)) || (segs.length === 1 && /\.tsbuildinfo$/.test(p));
    if (!rebuildable) keep.push(p);
  }
  return keep;
}

/**
 * Decide one worktree. Returns { verdict: 'removable' | 'dirty' | 'look', why }.
 * ctx: { prState(branch, headSha), tryGit(args, cwd), mainPath, all (every registered worktree) }.
 * 'dirty' = finished but holds changes or non-rebuildable ignored files (never deleted); 'look' = anything else that is not removable.
 */
function classify(wt, ctx) {
  const tg = ctx.tryGit || tryGit;
  const mainPath = ctx.mainPath || wt.path;
  if (wt.bare) return { verdict: 'look', why: 'bare repository' };
  if (wt.locked) return { verdict: 'look', why: 'locked' };
  if (wt.detached || !wt.branch) return { verdict: 'look', why: 'detached HEAD' };
  if (!fs.existsSync(wt.path)) return { verdict: 'look', why: 'directory missing (git worktree prune clears the record)' };
  const inner = (ctx.all || []).find((o) => o.path !== wt.path && inside(o.path, wt.path));
  if (inner) return { verdict: 'look', why: 'contains worktree ' + inner.path };
  const linked = linkedFrom(wt, ctx.all || [], ctx.readdir);
  if (linked) return { verdict: 'look', why: linked };
  const nested = findNestedGit(wt.path);
  if (nested) return { verdict: 'look', why: 'contains a nested .git: ' + nested };
  // one git call answers for every marker: one line per --git-path, in order
  const gp = tg(['rev-parse', ...IN_PROGRESS.flatMap((name) => ['--git-path', name])], wt.path);
  if (!gp.ok) return { verdict: 'look', why: 'git rev-parse failed' };
  const gpLines = gp.out.replace(/\s+$/, '').split(/\r?\n/);
  // fail closed: anything but exactly one non-empty line per marker is an answer we cannot trust
  if (gpLines.length !== IN_PROGRESS.length || gpLines.some((l) => l.trim() === '')) return { verdict: 'look', why: 'git rev-parse answered ' + gpLines.length + ' lines for ' + IN_PROGRESS.length + ' markers' };
  for (let i = 0; i < IN_PROGRESS.length; i++) {
    if (gpLines[i] && fs.existsSync(path.resolve(wt.path, gpLines[i].trim()))) return { verdict: 'look', why: 'a ' + IN_PROGRESS[i] + ' is in progress' };
  }
  const state = ctx.prState(wt.branch, wt.head);
  if (state === 'NONE') return { verdict: 'look', why: 'no PR of this repository matches this branch and HEAD' };
  if (state === 'OPEN') return { verdict: 'look', why: 'PR is open' };
  if (state !== 'MERGED' && state !== 'CLOSED') return { verdict: 'look', why: 'PR state unknown' };
  const st = tg(['status', '--porcelain', '--untracked-files=all'], wt.path);
  if (!st.ok) return { verdict: 'look', why: 'git status failed' };
  const lines = st.out.split(/\r?\n/).filter((l) => l.length > 0);
  const changed = lines.filter((l) => !(l === '?? node_modules' && isLink(path.join(wt.path, 'node_modules')))).length;
  const ig = tg(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', '.', ':(exclude)node_modules', ':(exclude,glob)**/node_modules/**'], wt.path);
  if (!ig.ok) return { verdict: 'look', why: 'git ls-files failed' };
  const data = ignoredData(ig.out.split('\0'));
  if (changed > 0) return { verdict: 'dirty', why: 'finished but dirty: ' + changed + ' file' + (changed === 1 ? '' : 's') };
  if (data.length > 0) return { verdict: 'dirty', why: 'finished but holds ' + data.length + ' ignored file' + (data.length === 1 ? '' : 's') + ' that are not rebuildable: ' + data.slice(0, 3).join(', ') };
  const remote = tg(['config', '--get', 'branch.' + wt.branch + '.remote'], mainPath);
  const merge = tg(['config', '--get', 'branch.' + wt.branch + '.merge'], mainPath);
  if (!remote.ok || remote.out.trim() !== 'origin' || !merge.ok || merge.out.trim() !== 'refs/heads/' + wt.branch) {
    return { verdict: 'look', why: 'no upstream origin/' + wt.branch + ' (push with -u)' };
  }
  const onOrigin = tg(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/' + wt.branch], mainPath).ok;
  if (onOrigin) {
    const ahead = tg(['log', '--oneline', 'origin/' + wt.branch + '..' + wt.head], mainPath);
    if (!ahead.ok) return { verdict: 'look', why: 'cannot compare with origin' };
    if (ahead.out.trim() !== '') return { verdict: 'look', why: 'commits origin does not have' };
  } else if (state !== 'MERGED') {
    return { verdict: 'look', why: 'closed PR and the branch is not on origin' };
  }
  return { verdict: 'removable', why: 'PR ' + state.toLowerCase() + ', clean, nothing unpushed' };
}

/** realpath of a path that may not exist: the nearest existing ancestor is resolved (/tmp on macOS, /home on Fedora Atomic are links) and the missing rest appended. */
function nearestReal(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); } catch {
      const up = path.dirname(cur);
      if (up === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = up;
    }
  }
}

/**
 * The reason a worktree is kept because of another worktree's top-level links (issue #2063), or null when none points into it. A link is a symlink or a
 * Windows junction (both show as links to lstat); a dangling link counts through its link text, resolved through its nearest existing ancestor. Fail closed:
 * a sibling folder that exists but cannot be read, or a link whose text cannot be read, keeps the worktree (its links could not all be seen).
 * Cheap: one readdir per sibling, no git, no network. readdir is injectable for the test.
 */
function linkedFrom(wt, all, readdir) {
  const rd = readdir || fs.readdirSync;
  for (const o of all) {
    if (o.path === wt.path || !fs.existsSync(o.path)) continue; // a missing sibling is "directory missing" on its own row
    let entries;
    try { entries = rd(o.path, { withFileTypes: true }); } catch (e) { return 'cannot read ' + o.path + ' to check its links (' + String((e && e.code) || e) + ')'; }
    for (const e of entries) {
      if (!e.isSymbolicLink()) continue;
      const p = path.join(o.path, e.name);
      let target;
      try { target = fs.realpathSync.native(p); } catch {
        try { target = nearestReal(path.resolve(o.path, fs.readlinkSync(p))); } catch { return 'cannot read the link ' + p + ' to see where it points'; }
      }
      if (inside(target, wt.path)) return 'linked from ' + o.path + ' (' + e.name + ') (its link would dangle)';
    }
  }
  return null;
}

function isLink(p) { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } }

/** HEAD and branch of a worktree right now, or null when either cannot be read. */
function readHeadBranch(wt, tg) {
  const head = tg(['rev-parse', 'HEAD'], wt.path);
  const br = tg(['symbolic-ref', '--short', '-q', 'HEAD'], wt.path);
  return head.ok && br.ok ? { head: head.out.trim(), branch: br.out.trim() } : null;
}

/**
 * Remove one removable worktree. The PR lookup (gh, up to 60 s) is the slow part and anything can change during it, so everything else is read
 * AGAIN after it, immediately before `git worktree remove`: HEAD, branch, status, nested and ignored files. Then `worktree remove` (no --force),
 * `branch -d` (never -D), `worktree prune`.
 */
function removeOne(wt, mainPath, ctx) {
  if (ctx.beforeRemove) ctx.beforeRemove(wt);
  const tg = ctx.tryGit || tryGit;
  const first = readHeadBranch(wt, tg);
  if (!first) return { removed: false, note: 'changed since the check, kept: HEAD or branch unreadable' };
  if (first.head !== wt.head || first.branch !== wt.branch) return { removed: false, note: 'changed since the check, kept: HEAD or branch moved' };
  let seen;
  const slow = classify({ ...wt }, { ...ctx, prState: (b, h) => { seen = ctx.prState(b, h); return seen; } });
  if (slow.verdict !== 'removable') return { removed: false, note: 'changed since the check, kept: ' + slow.why };
  // last re-read: no slow call between here and the removal (the PR state is the one just looked up)
  const last = readHeadBranch(wt, tg);
  if (!last) return { removed: false, note: 'changed during the PR check, kept: HEAD or branch unreadable' };
  if (last.head !== wt.head || last.branch !== wt.branch) return { removed: false, note: 'changed during the PR check, kept: HEAD or branch moved' };
  const fin = classify({ ...wt, head: last.head, branch: last.branch }, { ...ctx, prState: () => seen });
  if (fin.verdict !== 'removable') return { removed: false, note: 'changed during the PR check, kept: ' + fin.why };
  const r = tryGit(['worktree', 'remove', wt.path], mainPath);
  if (!r.ok) return { removed: false, note: 'git worktree remove refused: ' + r.err };
  const b = tryGit(['branch', '-d', wt.branch], mainPath);
  tryGit(['worktree', 'prune'], mainPath);
  return { removed: true, note: b.ok ? 'branch deleted' : 'worktree removed, branch kept (git branch -d refused: ' + b.err + ')' };
}

/** The root for new worktrees: next to the MAIN checkout. git prints forward slashes on Windows, so the path is normalised to the OS form. */
function newWorktreeRoot(mainPath) { return path.resolve(mainPath) + '-worktrees'; }

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
 * Whole run. opts: { apply, tmp, root, cwd, prState, tryGit, now, tmpDirs, log }.
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
  const ctx = { prState: opts.prState || ((b, sha) => ghPrState(b, sha, mainPath)), tryGit: opts.tryGit || tryGit, mainPath, all, beforeRemove: opts.beforeRemove };
  const rows = [];
  for (const wt of all.slice(1)) {
    if (opts.only && !opts.only.includes(wt.branch || 'detached')) continue; // test-only filter
    if (inside(here, wt.path)) { rows.push({ wt, verdict: 'skip', why: 'the worktree this runs in', bytes: 0 }); continue; }
    const c = classify(wt, ctx);
    const sz = fs.existsSync(wt.path) ? dirSizeChecked(wt.path) : { bytes: 0, unreadable: 0 };
    // a tree that cannot be read completely is not removable: git worktree remove would meet the same entries
    if (c.verdict === 'removable' && sz.unreadable > 0) { rows.push({ wt, bytes: sz.bytes, verdict: 'look', why: sz.unreadable + ' entr' + (sz.unreadable === 1 ? 'y' : 'ies') + ' cannot be read (permission or lock)' }); continue; }
    rows.push({ wt, bytes: sz.bytes, ...c });
  }
  let reclaimable = 0;
  let removed = 0;
  log((opts.apply ? 'worktrees:clean --apply' : 'worktrees:clean (dry run: nothing is changed; `npm run worktrees:clean -- --apply` removes the REMOVABLE ones)') + ', ' + rows.length + ' linked worktree' + (rows.length === 1 ? '' : 's'));
  log('new worktrees go under (from the MAIN checkout, never from where you stand): ' + newWorktreeRoot(mainPath) + path.sep + 'NNN-slug');
  for (const r of rows) {
    const label = { removable: 'REMOVABLE', dirty: 'DIRTY    ', look: 'NEEDS A LOOK', skip: 'SKIPPED  ' }[r.verdict];
    let line = label + '  ' + fmt(r.bytes).padStart(9) + '  ' + r.wt.path + '  [' + (r.wt.branch || 'detached') + ']  ' + r.why;
    if (r.verdict === 'removable') {
      reclaimable += r.bytes;
      if (opts.apply) {
        const res = removeOne(r.wt, mainPath, ctx);
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

function main(argv, env) {
  let apply = false, tmp = false, root = path.join(__dirname, '..');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') apply = true;
    else if (argv[i] === '--tmp') tmp = true;
    else if (argv[i] === '--root' && argv[i + 1]) root = argv[++i];
    else { process.stderr.write('usage: node scripts/worktrees-clean.js [--apply] [--tmp] [--root D]   (through npm: npm run worktrees:clean -- --apply)\n'); return 2; }
  }
  // Through npm, `npm run worktrees:clean --apply` (no `--`) never reaches this script: npm keeps the flag. We cannot see that it was dropped, but we can
  // see that we run under npm without --apply, and say how to apply.
  if (!apply && env && env.npm_lifecycle_event) {
    process.stderr.write('NOTE: run through npm without --apply, so this is a dry run. To remove: npm run worktrees:clean -- --apply (the `--` is needed; npm drops a bare --apply).\n');
  }
  try { run({ apply, tmp, root }); } catch (e) { process.stderr.write('worktrees:clean: ' + e.message + '\n'); return 2; }
  return 0;
}

module.exports = { stats, dirSizeChecked, newWorktreeRoot, parseWorktrees, classify, run, staleTmp, ghPrState, dirSize, ignoredData, main, TMP_PATTERNS };
if (require.main === module) process.exit(main(process.argv.slice(2), process.env));
