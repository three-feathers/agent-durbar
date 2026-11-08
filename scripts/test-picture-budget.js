#!/usr/bin/env node
// Spec 021 FR-063 (2026-11-08): tests of scripts/picture-budget.js on throwaway git repos (offline). PB_MODULE swaps the module (mutant runs).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pb = require(process.env.PB_MODULE ? path.resolve(process.env.PB_MODULE) : './picture-budget.js');

const KB = 1024;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-pb-'));
const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let n = 0;
function repo() {
  const dir = path.join(tmp, `r${n++}`);
  fs.mkdirSync(dir);
  G(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  put(dir, 'docs/old-big.png', 900 * KB, 1); // already on main: never counted
  commit(dir, 'base');
  return dir;
}
const put = (dir, p, bytes, seed) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), require('crypto').createHash('sha256').update(String(seed)).digest().toString('hex').repeat(Math.ceil(bytes / 64)).slice(0, bytes)); };
const commit = (dir, m) => { G(dir, 'add', '--all'); G(dir, 'commit', '-q', '-m', m); }; // throwaway repo, never the real one
const markMain = (dir) => { G(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD'); G(dir, 'checkout', '-q', '-b', 'feat'); };

try {
  // parseAllow
  const a = pb.parseAllow('# c\n\nart/a.png | 2000 | art pack, 1 file\nbad line\nart/b.png | 10 |\nart/a.png | 5 | twice\n');
  assert.strictEqual(a.entries.get('art/a.png'), 2000 * KB);
  assert.strictEqual(a.problems.length, 3, a.problems.join('\n'));

  // ok: a small picture and a big non-picture
  let d = repo(); markMain(d);
  put(d, 'docs/small.png', 100 * KB, 2); put(d, 'docs/data.json', 2000 * KB, 3); commit(d, 'f');
  let r = pb.check(d);
  assert.strictEqual(r.status, 'ok', r.lines.join('\n'));
  assert.match(r.lines[0], /1 picture/);

  // fail: a committed picture over budget; message has the path, size and fix
  d = repo(); markMain(d); put(d, 'docs/screenshots/new-big.png', 1500 * KB, 4); put(d, 'docs/ok.jpg', 10 * KB, 5); commit(d, 'f');
  r = pb.check(d);
  assert.strictEqual(r.status, 'fail');
  const text = r.lines.join('\n');
  assert.match(text, /docs\/screenshots\/new-big\.png: 1500 KB, over the 300 KB budget/);
  assert.doesNotMatch(text, /ok\.jpg/);
  assert.match(text, /crop or downscale that passes compress-shots/);
  assert.match(text, /keep it local only/);

  // exactly at the budget passes, one byte over fails
  d = repo(); markMain(d); put(d, 'a.webp', 300 * KB, 6); commit(d, 'f');
  assert.strictEqual(pb.check(d).status, 'ok');
  put(d, 'a.webp', 300 * KB + 1, 6); commit(d, 'g');
  assert.strictEqual(pb.check(d).status, 'fail');

  // changed picture counts (old-big.png shrinks to a bigger new content), untouched old-big does not
  d = repo(); markMain(d); put(d, 'docs/old-big.png', 800 * KB, 7); commit(d, 'f');
  assert.match(pb.check(d).lines.join('\n'), /docs\/old-big\.png: 800 KB/);

  // deleted: ignored
  d = repo(); markMain(d); G(d, 'rm', '-q', 'docs/old-big.png'); G(d, 'commit', '-q', '-m', 'rm');
  r = pb.check(d); assert.strictEqual(r.status, 'ok', r.lines.join('\n')); assert.match(r.lines[0], /0 picture/);

  // pure rename of an existing big picture: ignored; rename with edits: counted under the new name
  d = repo(); markMain(d); G(d, 'mv', 'docs/old-big.png', 'docs/moved.png'); G(d, 'commit', '-q', '-m', 'mv');
  assert.strictEqual(pb.check(d).status, 'ok');
  fs.appendFileSync(path.join(d, 'docs/moved.png'), 'edit'); G(d, 'commit', '-q', '-am', 'edit');
  r = pb.check(d); assert.strictEqual(r.status, 'fail'); assert.match(r.lines.join('\n'), /docs\/moved\.png/);

  // staged and unstaged changes of tracked files count; untracked files do not
  d = repo(); markMain(d); put(d, 'staged.png', 500 * KB, 8); G(d, 'add', 'staged.png'); put(d, 'untracked.png', 500 * KB, 9);
  r = pb.check(d); assert.strictEqual(r.status, 'fail');
  assert.match(r.lines.join('\n'), /staged\.png/); assert.doesNotMatch(r.lines.join('\n'), /untracked\.png/);

  // the base is the merge-base: a big picture that main gained after the branch point is not ours
  d = repo(); G(d, 'branch', 'feat'); put(d, 'docs/later-big.png', 900 * KB, 10); commit(d, 'main moves'); G(d, 'update-ref', 'refs/remotes/origin/main', 'HEAD'); G(d, 'checkout', '-q', 'feat');
  put(d, 'docs/mine.png', 20 * KB, 11); commit(d, 'f');
  r = pb.check(d); assert.strictEqual(r.status, 'ok', r.lines.join('\n')); assert.match(r.lines[0], /1 picture/);

  // no origin/main: a SKIP line with the fetch hint, never a silent pass; --strict fails
  d = repo(); put(d, 'x.png', 900 * KB, 12); commit(d, 'f');
  r = pb.check(d); assert.strictEqual(r.status, 'skip'); assert.match(r.lines.join('\n'), /SKIP.*git fetch origin main.*NOT checked/);
  r = pb.check(d, { strict: true }); assert.strictEqual(r.status, 'fail'); assert.match(r.lines.join('\n'), /strict/);

  // allow-list: raises the cap of one named file, with a reason; others stay at the budget; a stale or reasonless line fails
  d = repo(); markMain(d); put(d, 'art/pack.png', 900 * KB, 13); put(d, 'art/other.png', 900 * KB, 14);
  put(d, pb.ALLOW_FILE, 1, 0); fs.writeFileSync(path.join(d, pb.ALLOW_FILE), 'art/pack.png | 1000 | art pack, one atlas\n');
  commit(d, 'f');
  r = pb.check(d); assert.strictEqual(r.status, 'fail');
  assert.match(r.lines.join('\n'), /art\/other\.png/); assert.doesNotMatch(r.lines.join('\n'), /art\/pack\.png/);
  fs.writeFileSync(path.join(d, pb.ALLOW_FILE), 'art/pack.png | 500 | art pack\nart/other.png | 1000 | other\n'); commit(d, 'g');
  assert.match(pb.check(d).lines.join('\n'), /art\/pack\.png: 900 KB, over the 500 KB allow-list cap/);
  fs.writeFileSync(path.join(d, pb.ALLOW_FILE), 'art/pack.png | 1000 |\ngone.png | 10 | was here\n'); commit(d, 'h');
  r = pb.check(d); assert.strictEqual(r.status, 'fail');
  assert.match(r.lines.join('\n'), /art\/pack\.png has no reason/); assert.match(r.lines.join('\n'), /gone\.png does not exist/);

  // the real allow-list of this repository parses clean
  const real = pb.parseAllow(fs.readFileSync(path.join(__dirname, 'picture-budget-allow.txt'), 'utf8'));
  assert.deepStrictEqual(real.problems, []);
  assert.strictEqual(pb.BUDGET_BYTES, 300 * KB);
  console.log('picture-budget tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
