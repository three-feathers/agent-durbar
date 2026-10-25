/** Unit test (spec 085): git output parsing with hostile text, the start/summary flow with a fake git runner (argv, bounds, failures), and the card words. No real git, no Electron. */
import * as assert from 'assert';
import * as path from 'path';
import { SessionStarts, countBinary, isNotRepo, parseCount, parseShortstat, validRef } from '../src/main/sessionsummary';
import type { GitExec } from '../src/main/gitstatus';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const W = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'sessionsummary.js')) as { text: (s: unknown, c: unknown) => string; duration: (ms: unknown) => string; tip: string };
const Z = (...r: string[]): string => r.join('\0') + '\0';
const REF = 'a'.repeat(40);

// shortstat: the three shapes, singular words, and hostile text
assert.deepStrictEqual(parseShortstat(' 3 files changed, 10 insertions(+), 2 deletions(-)\n'), { files: 3, added: 10, removed: 2 });
assert.deepStrictEqual(parseShortstat(' 1 file changed, 1 insertion(+)\n'), { files: 1, added: 1, removed: 0 });
assert.deepStrictEqual(parseShortstat(' 1 file changed, 4 deletions(-)\n'), { files: 1, added: 0, removed: 4 });
assert.deepStrictEqual(parseShortstat(''), { files: 0, added: 0, removed: 0 });
assert.deepStrictEqual(parseShortstat('fatal: not a git repository'), { files: 0, added: 0, removed: 0 });
assert.deepStrictEqual(parseShortstat(' 99999999999999999999 files changed, 1 insertion(+)'), { files: 0, added: 1, removed: 0 }, 'a number too long for a count is zero, not a float');
assert.strictEqual(parseShortstat(' 999999999999 files changed').files, 1_000_000_000, 'clamped');
assert.deepStrictEqual(parseShortstat('x'.repeat(5000) + ' 7 files changed'), { files: 0, added: 0, removed: 0 }, 'only the first 1 KB is read');
assert.strictEqual(parseShortstat(' -5 files changed').files, 5, 'never negative');

// counts and refs
assert.strictEqual(parseCount('12\n'), 12);
assert.strictEqual(parseCount('12 rm -rf'), 0);
assert.strictEqual(parseCount('-3'), 0);
assert.strictEqual(parseCount(''), 0);
assert.strictEqual(validRef(REF + '\n'), REF);
assert.strictEqual(validRef('b'.repeat(64)), 'b'.repeat(64));
for (const bad of ['', 'HEAD', '--output=/tmp/x', REF + ' --exec', 'A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), REF + '\n' + REF]) assert.strictEqual(validRef(bad), undefined, JSON.stringify(bad));
assert.strictEqual(countBinary('-\t-\timg.png\n3\t1\tsrc/a.ts\n-\t-\tb.bin\n'), 2);
assert.strictEqual(countBinary('3\t-\tweird\n'), 0);

// a fake git: answers by the subcommand, records every argv
interface Fake { exec: GitExec; calls: string[][]; set(k: string, v: string | Error): void; hold?: Promise<void> }
function fake(answers: Record<string, string | Error>, hold?: Promise<void>): Fake {
  const calls: string[][] = [];
  const f: Fake = {
    calls,
    set: (k, v) => { answers[k] = v; },
    exec: async (args) => {
      calls.push(args);
      if (hold) await hold;
      const k = args[2] === 'rev-list' ? 'rev-list' : args[2] === 'diff' ? (args.includes('--numstat') ? 'numstat' : 'shortstat') : args[2] === 'status' && args.includes('--untracked-files=all') ? 'statusAll' : args[2];
      const a = answers[k];
      if (a === undefined) throw new Error('no answer for ' + k);
      if (a instanceof Error) throw a;
      return a;
    },
  };
  return f;
}
const err = (msg: string, extra: Record<string, unknown> = {}): Error => Object.assign(new Error(msg), extra);
const NOREPO = err('Command failed: git status\nfatal: not a git repository (or any of the parent directories): .git', { code: 128 });
const TIMEOUT = err('Command failed: git status', { killed: true, signal: 'SIGTERM', code: null });
let clock = 1000;
const now = (): number => clock;

async function main(): Promise<void> {
  // a clean repository at the start; after the session: files changed, two new untracked files, three commits
  const g = fake({ status: '', 'rev-parse': REF + '\n', shortstat: ' 12 files changed, 340 insertions(+), 80 deletions(-)\n', numstat: '-\t-\ta.png\n1\t1\tb.ts\n', 'rev-list': '3\n', statusAll: Z(' M a.ts', '?? new1.ts', '?? new2.ts') });
  const S = new SessionStarts(g.exec, now);
  assert.strictEqual((await S.summarize('s1', '/work')).ok, false, 'no start: no summary');
  await S.noteStart('s1', '/work');
  await S.noteStart('s1', '/work'); // the second message is not a second start
  assert.strictEqual(g.calls.filter((c) => c[2] === 'rev-parse').length, 1, 'the start is read once');
  // the start is status-only (no line counts, no untracked file names) plus rev-parse: two calls
  assert.deepStrictEqual(g.calls, [['-C', '/work', 'status', '--porcelain=v1', '-z', '--untracked-files=normal'], ['-C', '/work', 'rev-parse', '--verify', '-q', 'HEAD']], 'the start reads only status and rev-parse');
  clock += 25 * 60000;
  const sum = await S.summarize('s1', '/work');
  assert.deepStrictEqual(sum, { ok: true, ms: 25 * 60000, git: { repo: true, files: 12, added: 340, removed: 80, binary: 1, newFiles: 2, commits: 3, dirtyAtStart: false } });
  // the commands: argv arrays, read-only, the commit id is the only dynamic value besides the folder, and it came from main's own rev-parse
  for (const c of g.calls) {
    assert.strictEqual(c[0], '-C');
    assert.strictEqual(c[1], '/work');
    assert.ok(!c.some((x) => /[;|&$`]/.test(x)), 'no shell characters in ' + c.join(' '));
  }
  const diff = g.calls.find((c) => c.includes('--shortstat'))!;
  assert.deepStrictEqual(diff, ['-C', '/work', 'diff', '--no-ext-diff', '--no-textconv', '--shortstat', REF, '--'], 'tracked changes against the start commit, no diff helper');
  assert.ok(g.calls.filter((c) => c[2] === 'diff' && c.includes(REF)).every((c) => c.includes('--no-ext-diff') && c.includes('--no-textconv')), 'every diff against the start commit runs without a configured helper');
  assert.deepStrictEqual(g.calls.find((c) => c[2] === 'rev-list'), ['-C', '/work', 'rev-list', '--count', `${REF}..HEAD`]);
  assert.ok(g.calls.every((c) => !['commit', 'add', 'checkout', 'reset', 'stash', 'push', 'clean', 'restore'].includes(c[2])), 'read-only');

  // the reads run together, at the start and at the end: a runner that holds every call sees all of them before any answers
  {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const gp = fake({ status: '', 'rev-parse': REF, shortstat: ' 1 file changed', numstat: '', 'rev-list': '0', statusAll: '' }, gate);
    const SP = new SessionStarts(gp.exec, now);
    const started = SP.noteStart('p', '/w');
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(gp.calls.length, 2, 'both start reads are running at once');
    // the race: End while the start is still being read waits for it, never "not a git folder"
    const ended = SP.summarize('p', '/w');
    release();
    await started;
    const pr = await ended;
    assert.ok(pr.ok && pr.git.repo === true && pr.git.files === 1, 'an End right after the first message waits for the start: ' + JSON.stringify(pr));
    assert.strictEqual(gp.calls.length, 6, 'four end reads');
    let release2!: () => void;
    const gate2 = new Promise<void>((r) => { release2 = r; });
    const gq = fake({ status: '', 'rev-parse': REF, shortstat: '', numstat: '', 'rev-list': '0', statusAll: '' });
    const SQ = new SessionStarts(gq.exec, now);
    await SQ.noteStart('q', '/w');
    const held = fake({ status: '', 'rev-parse': REF, shortstat: '', numstat: '', 'rev-list': '0', statusAll: '' }, gate2);
    (SQ as unknown as { exec: GitExec }).exec = held.exec;
    const e2 = SQ.summarize('q', '/w');
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(held.calls.length, 4, 'the four end reads are running at once');
    release2();
    await e2;
  }

  // the tree was not clean at the start: the counts include earlier changes (said), new files are not counted and not listed
  const g2 = fake({ status: Z(' M a.ts'), 'rev-parse': REF, shortstat: ' 1 file changed, 2 insertions(+)', numstat: '2\t0\ta.ts\n', 'rev-list': '0', statusAll: Z(' M a.ts', '?? n.ts') });
  const S2 = new SessionStarts(g2.exec, now);
  await S2.noteStart('d', '/w');
  const d = await S2.summarize('d', '/w');
  assert.ok(d.ok && d.git.repo && d.git.dirtyAtStart && d.git.newFiles === 0);
  assert.ok(!g2.calls.some((c) => c.includes('--untracked-files=all')), 'untracked files are not listed when they would not be counted');

  // not a repository (git's own words) versus could not read (a time limit, too much output, git missing)
  assert.ok(isNotRepo(NOREPO) && !isNotRepo(TIMEOUT) && !isNotRepo(err('spawn git ENOENT', { code: 'ENOENT' })) && !isNotRepo(undefined));
  const g3 = fake({ status: NOREPO, 'rev-parse': NOREPO });
  const S3 = new SessionStarts(g3.exec, now);
  await S3.noteStart('n', '/plain');
  assert.deepStrictEqual(await S3.summarize('n', '/plain'), { ok: true, ms: 0, git: { repo: false } });
  for (const [what, ans] of [
    ['status times out at the start', { status: TIMEOUT, 'rev-parse': REF }],
    ['status output over the limit at the start', { status: err('stdout maxBuffer length exceeded', { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), 'rev-parse': REF }],
    ['rev-parse times out at the start', { status: '', 'rev-parse': TIMEOUT }],
    ['git is missing', { status: err('spawn git ENOENT', { code: 'ENOENT' }), 'rev-parse': err('spawn git ENOENT', { code: 'ENOENT' }) }],
    ['shortstat times out at the end', { status: '', 'rev-parse': REF, shortstat: TIMEOUT, numstat: '', 'rev-list': '0', statusAll: '' }],
    ['rev-list fails at the end', { status: '', 'rev-parse': REF, shortstat: '', numstat: '', 'rev-list': TIMEOUT, statusAll: '' }],
  ] as Array<[string, Record<string, string | Error>]>) {
    const gx = fake(ans);
    const SX = new SessionStarts(gx.exec, now);
    await SX.noteStart('x', '/w');
    assert.deepStrictEqual(await SX.summarize('x', '/w'), { ok: true, ms: 0, git: { repo: false, unreadable: true } }, what + ': could not read, never "not a git folder"');
  }
  // untracked files that cannot be listed (over the limit) are said, not shown as zero new files
  const g6 = fake({ status: '', 'rev-parse': REF, shortstat: ' 1 file changed', numstat: '', 'rev-list': '0', statusAll: err('stdout maxBuffer length exceeded', { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }) });
  const S6 = new SessionStarts(g6.exec, now);
  await S6.noteStart('u', '/w');
  const u = await S6.summarize('u', '/w');
  assert.ok(u.ok && u.git.repo && u.git.newFiles === 0 && u.git.newFilesUnknown === true, JSON.stringify(u));

  // a folder with no commit yet (rev-parse -q exits 1): files and lines are not counted, commits read from HEAD, and still none is fine
  const g7 = fake({ status: '', 'rev-parse': err('Command failed', { code: 1 }), 'rev-list': err('fatal: ambiguous argument HEAD', { code: 128 }), statusAll: Z('?? a.ts') });
  const S7 = new SessionStarts(g7.exec, now);
  await S7.noteStart('e', '/w');
  const e7 = await S7.summarize('e', '/w');
  assert.deepStrictEqual(e7, { ok: true, ms: 0, git: { repo: true, files: 0, added: 0, removed: 0, binary: 0, newFiles: 1, commits: 0, dirtyAtStart: false, noHead: true } });

  // a hostile rev-parse answer is not used as an argument
  const g5 = fake({ status: '', 'rev-parse': '--upload-pack=evil', shortstat: ' 1 file changed', numstat: '', 'rev-list': '5', statusAll: '' });
  const S5 = new SessionStarts(g5.exec, now);
  await S5.noteStart('h', '/w');
  const h = await S5.summarize('h', '/w');
  assert.ok(h.ok && h.git.repo && h.git.noHead === true && h.git.files === 0, 'no checked commit: no comparison');
  assert.ok(g5.calls.every((c) => !c.some((x) => x.includes('evil'))), 'the hostile text never reaches an argument');

  // forget: the next session in the folder starts again
  S.forget('s1');
  assert.strictEqual(S.has('s1'), false);

  // the words
  const full = { ok: true, ms: 25 * 60000 + 20000, git: { repo: true, files: 12, added: 340, removed: 80, binary: 0, newFiles: 3, commits: 1, dirtyAtStart: false } };
  assert.strictEqual(W.text(full, 'cost ≈ $0.40'), 'Session summary: 12 files changed, +340 −80, 3 new files, 1 commit, 25 min, cost ≈ $0.40.');
  assert.strictEqual(W.text(full, ''), 'Session summary: 12 files changed, +340 −80, 3 new files, 1 commit, 25 min, cost not reported.');
  assert.match(W.text({ ...full, pullRequests: 2 }, ''), /2 pull requests opened/);
  assert.doesNotMatch(W.text(full, ''), /pull request/, 'no pull request is mentioned unless the adapter reported one');
  assert.match(W.text({ ok: true, ms: 1, git: { repo: false } }, ''), /^Session summary: not a git folder, so files and lines are not counted, under 1 min, cost not reported\.$/);
  assert.match(W.text({ ok: true, ms: 0, git: { repo: true, files: 1, added: 1, removed: 0, commits: 0, dirtyAtStart: true } }, ''), /1 file changed, \+1 −0, no commits, .*already had changes/);
  assert.match(W.text({ ok: true, ms: 0, git: { repo: true, noHead: true, files: 0, added: 0, removed: 0, commits: 2 } }, ''), /no commit in the folder when it began, so files and lines are not counted, 2 commits/);
  assert.match(W.text({ ok: true, ms: 1, git: { repo: false, unreadable: true } }, ''), /^Session summary: could not read git in the folder, so files and lines are not counted, under 1 min, cost not reported\.$/);
  assert.match(W.text({ ok: true, ms: 0, git: { repo: true, files: 1, added: 1, removed: 0, commits: 0, newFiles: 0, newFilesUnknown: true } }, ''), /1 file changed, \+1 −0, new files not counted, no commits/);
  assert.match(W.tip, /only what is not committed yet/, 'the tooltip says what the button lists');
  assert.strictEqual(W.text({ ok: false, error: 'x' }, ''), '');
  assert.strictEqual(W.text(null, ''), '');
  assert.strictEqual(W.duration(65 * 60000), '1 h 5 min');
  assert.strictEqual(W.duration(2 * 3600000), '2 h');
  assert.strictEqual(W.duration(59999), 'under 1 min');
  // a hostile summary: strings for numbers, huge or negative numbers, markup, control characters, extra keys, a hostile cost
  const evil = { ok: true, ms: '9'.repeat(30), pullRequests: '<img src=x>', __proto__: { x: 1 }, git: { repo: true, files: '<script>', added: -5, removed: Infinity, newFiles: NaN, commits: 1e30, dirtyAtStart: 'yes' } };
  const t = W.text(evil, 'cost \u0007<b>x</b>'.padEnd(500, 'z'));
  assert.ok(!/NaN|Infinity|undefined|\[object/.test(t), t);
  assert.match(t, /no tracked files changed, 1000000000 commits, under 1 min/);
  assert.ok(!t.includes('\u0007') && t.length < 300, 'control characters removed, cost cut');
  assert.ok(!/already had changes/.test(t), 'dirtyAtStart must be the boolean true');
  console.log('[sessionsummary] all checks passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
