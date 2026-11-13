#!/usr/bin/env node
// Spec 021 FR-085 (2026-11-08): tests of scripts/picture-budget.js on throwaway git repos (offline). PB_MODULE swaps the module (mutant runs).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const helper = require(process.env.GIT_HELPER_MODULE ? path.resolve(process.env.GIT_HELPER_MODULE) : './git-index-helper.js'); // GIT_HELPER_MODULE swaps it (mutant runs)
const { plumbCommit, gitRun } = helper;
const pb = require(process.env.PB_MODULE ? path.resolve(process.env.PB_MODULE) : './picture-budget.js');

const KB = 1024;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-pb-'));
const G = (cwd, ...a) => gitRun(cwd, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a]).trim();
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

  // every picture or media extension counts (review of PR #1316: a 400 KB .apng passed)
  for (const ext of ['png', 'apng', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'tif', 'tiff', 'mp4', 'webm', 'mov', 'APNG', 'icns', 'jxl']) {
    d = repo(); markMain(d); put(d, `m/big.${ext}`, 400 * KB, 20); commit(d, 'f');
    r = pb.check(d); assert.strictEqual(r.status, 'fail', `.${ext} over budget must fail`); assert.match(r.lines.join('\n'), new RegExp(`big\\.${ext}: 400 KB`));
  }
  // judged by content too: a PNG, MP4 or JPEG under another name, over the budget, fails; plain bytes of any other kind do not
  const withBytes = (dir, p, magic, bytes) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), Buffer.concat([magic, Buffer.alloc(bytes, 7)])); };
  for (const [name, magic] of [['a.dat', Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')], ['b.bin', Buffer.from('\0\0\0\x18ftypmp42', 'latin1')], ['c.data', Buffer.from([0xff, 0xd8, 0xff, 0xe0])]]) {
    d = repo(); markMain(d); withBytes(d, `x/${name}`, magic, 400 * KB); commit(d, 'f');
    r = pb.check(d); assert.strictEqual(r.status, 'fail', `${name} is a picture by content`);
  }
  d = repo(); markMain(d); withBytes(d, 'x/blob.dat', Buffer.from('plain'), 400 * KB); commit(d, 'f'); assert.strictEqual(pb.check(d).status, 'ok');

  // history: a big picture committed and replaced by a small one in a later commit stays in history, and fails
  d = repo(); markMain(d); put(d, 'docs/shot.png', 900 * KB, 21); commit(d, 'big'); put(d, 'docs/shot.png', 50 * KB, 22); commit(d, 'small');
  r = pb.check(d); assert.strictEqual(r.status, 'fail'); assert.match(r.lines.join('\n'), /docs\/shot\.png: 900 KB \(a commit of this branch\)/); assert.match(r.lines.join('\n'), /fresh branch/);
  // committed then deleted: also in history
  d = repo(); markMain(d); put(d, 'docs/gone.png', 900 * KB, 23); commit(d, 'big'); G(d, 'rm', '-q', 'docs/gone.png'); G(d, 'commit', '-q', '-m', 'rm');
  assert.strictEqual(pb.check(d).status, 'fail');
  // a blob that main already holds, moved or reverted, is not new
  d = repo(); markMain(d); G(d, 'mv', 'docs/old-big.png', 'docs/elsewhere.png'); G(d, 'commit', '-q', '-m', 'mv'); assert.strictEqual(pb.check(d).status, 'ok');

  // a hostile file name (newline, ::error::, ##[error]) is never printed raw: no output line starts a workflow command (review of PR #1316).
  // Built in the git index only (git-index-helper.js), so it runs on Windows too, where such a file name cannot exist.
  d = repo(); markMain(d);
  const evil = 'docs/x\n::error::pwned\n##[add-mask]y\n::add-mask::z.png';
  plumbCommit(d, 'HEAD', { [evil]: 'A'.repeat(500 * KB) }, 'evil', 'refs/heads/feat');
  fs.mkdirSync(path.join(d, 'scripts'), { recursive: true }); fs.writeFileSync(path.join(d, pb.ALLOW_FILE), '::warning::bad\u2028##[error]x::error::z.png | 10 |\n'); // an allow-list line from the PR: a problem line
  r = pb.check(d); assert.strictEqual(r.status, 'fail', r.lines.join('\n'));
  const cli = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'picture-budget.js'), '--root', d], { encoding: 'utf8' });
  assert.strictEqual(cli.status, 1, cli.stdout + cli.stderr);
  for (const line of cli.stdout.split('\n')) assert.ok(!/^\s*::/.test(line) && !line.includes('::') && !line.includes('##['), `raw workflow command in output: ${JSON.stringify(line)}`);
  assert.match(cli.stdout, /docs\/x\\n: :error: :pwned\\n# #\[add-mask\]y\\n: :add-mask: :z\.png: 500 KB/);

  // content sniffing in the WORKING TREE (a staged `.dat` that is a PNG, never committed: history does not see it); mutant: `if (!named) continue`
  d = repo(); markMain(d); withBytes(d, 'x/staged.dat', Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), 400 * KB); G(d, 'add', 'x/staged.dat');
  r = pb.check(d); assert.strictEqual(r.status, 'fail', 'a staged PNG under another name'); assert.match(r.lines.join('\n'), /x\/staged\.dat: 400 KB, over/);
  withBytes(d, 'x/staged.dat', Buffer.from('plain'), 400 * KB); assert.strictEqual(pb.check(d).status, 'ok', 'plain bytes under the same name pass');

  // a picture renamed AND edited, staged only (history does not see it): counted under the new name; mutant: every rename skipped
  d = repo(); markMain(d); G(d, 'mv', 'docs/old-big.png', 'docs/moved2.png'); fs.appendFileSync(path.join(d, 'docs/moved2.png'), 'edit'); G(d, 'add', 'docs/moved2.png');
  r = pb.check(d); assert.strictEqual(r.status, 'fail', 'staged rename with edits'); assert.match(r.lines.join('\n'), /docs\/moved2\.png: 900 KB/);
  d = repo(); markMain(d); G(d, 'mv', 'docs/old-big.png', 'docs/moved3.png'); assert.strictEqual(pb.check(d).status, 'ok', 'a staged pure rename is not new');

  // symlinks are never read through: a committed x.png that links to a big file outside the checkout is not judged by the target
  d = repo(); markMain(d);
  const outside = path.join(tmp, `outside-${n++}.png`); put(path.dirname(outside), path.basename(outside), 900 * KB, 40);
  let linked = true;
  try { fs.symlinkSync(outside, path.join(d, 'docs/link.png')); } catch (e) { linked = false; console.log(`skipped the symlink case: cannot create a symlink here (${e.code}); the index-built link below still runs`); }
  plumbCommit(d, 'HEAD', { 'docs/link.png': { content: outside, mode: '120000' } }, 'link', 'refs/heads/feat');
  G(d, 'add', '-N', '.'); // makes no difference to the result; the link is in HEAD and, where possible, on disk
  r = pb.check(d); assert.strictEqual(r.status, 'ok', `${linked ? 'a symlink' : 'a link in history'} to a big file: ${r.lines.join('\n')}`);
  if (linked) { assert.strictEqual(pb.check(d).lines.join('\n').includes('link.png'), false); fs.mkdirSync(path.join(d, 'scripts'), { recursive: true }); fs.writeFileSync(path.join(d, pb.ALLOW_FILE), 'docs/link.png | 10 | linked\n'); assert.match(pb.check(d).lines.join('\n'), /docs\/link\.png is a symlink/); fs.rmSync(path.join(d, pb.ALLOW_FILE)); }

  // allow-list paths outside the checkout are refused without being looked up (no probing of files elsewhere)
  const ap = pb.parseAllow(`../outside.png | 10 | up\n/etc/hosts | 10 | absolute\nC:\\x.png | 10 | drive\na/../../b.png | 10 | inside-out\nok/fine.png | 10 | fine\n`);
  assert.strictEqual(ap.problems.length, 4, ap.problems.join('\n')); assert.deepStrictEqual([...ap.entries.keys()], ['ok/fine.png']);
  for (const x of ap.problems) assert.match(x, /must be a path inside the repository/);
  d = repo(); markMain(d); fs.mkdirSync(path.join(d, 'scripts'), { recursive: true }); fs.writeFileSync(path.join(d, pb.ALLOW_FILE), `${path.relative(d, outside)} | 10 | probe\n`);
  r = pb.check(d); assert.strictEqual(r.status, 'fail'); assert.match(r.lines.join('\n'), /must be a path inside the repository/); assert.doesNotMatch(r.lines.join('\n'), /does not exist/);

  // a symlinked FOLDER that points outside the checkout: an allow-list entry under it is refused the same way whether or not the target exists
  // (no probing of files elsewhere); mutant: only the last path part checked
  d = repo(); markMain(d);
  const outDir = path.join(tmp, `outdir-${n++}`); fs.mkdirSync(outDir); fs.writeFileSync(path.join(outDir, 'secret.bin'), 'x');
  let dirLinked = true;
  try { fs.symlinkSync(outDir, path.join(d, 'd'), 'dir'); } catch (e) { dirLinked = false; console.log(`skipped the symlinked-folder case: cannot create a symlink here (${e.code})`); }
  if (dirLinked) {
    fs.mkdirSync(path.join(d, 'scripts'), { recursive: true });
    const answer = (entry) => { fs.writeFileSync(path.join(d, pb.ALLOW_FILE), `${entry} | 10 | probe\n`); const x = pb.check(d); return x.lines.join('\n').replace(entry, '<entry>'); };
    const there = answer('d/secret.bin'), notThere = answer('d/nothere.bin');
    assert.match(there, /must be a path inside the repository/); assert.doesNotMatch(there, /does not exist/);
    assert.strictEqual(there, notThere, 'the answer does not depend on whether the file outside exists');
    assert.strictEqual(pb.check(d).status, 'fail');
  }

  // a git failure is "could not check" (exit 2), not a pass
  d = repo(); markMain(d); put(d, 'docs/p.png', 50 * KB, 30); commit(d, 'f');
  const blob = G(d, 'rev-parse', 'HEAD:docs/p.png'); fs.rmSync(path.join(d, '.git/objects', blob.slice(0, 2), blob.slice(2)), { force: true });
  assert.strictEqual(require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'picture-budget.js'), '--root', d], { encoding: 'utf8' }).status, 2);

  // FR-095 (issue #1631): a hung git child fails with a message instead of holding the lock. The stand-in `git` is a node script (runs on
  // Windows too) that sleeps 8 s and exits 0; the helper must kill it after 1 s. A helper with no timeout returns after 8 s: the label fails.
  assert.strictEqual(helper.GIT_TIMEOUT_MS, 60000, 'FR-095 timeout: the default is 60 s');
  const sleeper = path.join(tmp, 'sleeping-git.js'); fs.writeFileSync(sleeper, 'setTimeout(() => process.exit(0), 8000);\n');
  const hangs = (fn) => { const t0 = Date.now(); let err = null; try { fn(); } catch (e) { err = e; } return { err, ms: Date.now() - t0 }; };
  const viaRun = hangs(() => gitRun(tmp, ['hash-object', '-w', '--stdin'], { input: 'x', gitCmd: [process.execPath, sleeper], timeoutMs: 1000 }));
  assert.ok(viaRun.err, 'FR-095 timeout: gitRun did not fail on a hung child');
  assert.strictEqual(viaRun.err.message, 'git hash-object timed out after 1000 ms (killed)', 'FR-095 timeout: message names the command and the timeout');
  assert.ok(viaRun.ms < 6000, `FR-095 timeout: failed after ${viaRun.ms} ms, not within a few seconds`);
  d = repo(); markMain(d);
  const viaPlumb = hangs(() => plumbCommit(d, 'HEAD', { 'a.txt': 'a' }, 'm', null, { gitCmd: [process.execPath, sleeper], timeoutMs: 1000 }));
  assert.match(String(viaPlumb.err && viaPlumb.err.message), /^git read-tree timed out after 1000 ms/, 'FR-095 timeout: plumbCommit fails with the timeout message');
  assert.ok(viaPlumb.ms < 6000, 'FR-095 timeout: plumbCommit failed within a few seconds');
  assert.throws(() => gitRun(tmp, ['-c', 'a=b', 'rev-parse', 'nope-not-a-ref'], {}), (e) => e.code !== 'ETIMEDOUT' && !/timed out/.test(e.message), 'FR-095 timeout: an ordinary git failure is not reported as a timeout');

  // the real allow-list of this repository parses clean
  const real = pb.parseAllow(fs.readFileSync(path.join(__dirname, 'picture-budget-allow.txt'), 'utf8'));
  assert.deepStrictEqual(real.problems, []);
  assert.strictEqual(pb.BUDGET_BYTES, 300 * KB);
  console.log('picture-budget tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
