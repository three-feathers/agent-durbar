/** Unit test (spec 085): git output parsing with hostile text, the start/summary flow with a fake git runner (argv, bounds, failures), and the card words. No real git, no Electron. */
import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SessionStarts, countBinary, dayNumbers, isNotRepo, parseCount, parseShortstat, readReported, sourceId, validRef } from '../src/main/sessionsummary';
import { SummaryDays, localDay, parseDays } from '../src/main/summarydays';
import { boundedCount, cleanVendorStats, copilotVendorStats } from '../src/adapters/vendorstats';
import { FakeAdapter } from '../src/adapters/fake';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';
import { hardenedArgv, makeGitExec } from '../src/main/gitstatus';
import type { GitExec, GitRun } from '../src/main/gitstatus';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const W = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'sessionsummary.js')) as { text: (s: unknown, c: unknown) => string; duration: (ms: unknown) => string; tip: string; short: (s: unknown) => string; brief: (s: unknown) => string; reported: (r: unknown) => string; briefing: (b: unknown) => string };
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

  // a start whose only changes are untracked files is not clean: those files were already there, so they are not counted as new (review on #718)
  const g8 = fake({ status: Z('?? old.ts'), 'rev-parse': REF, shortstat: '', numstat: '', 'rev-list': '0', statusAll: Z('?? old.ts', '?? new.ts') });
  const S8 = new SessionStarts(g8.exec, now);
  await S8.noteStart('o', '/w');
  const o = await S8.summarize('o', '/w');
  assert.ok(o.ok && o.git.repo === true && o.git.dirtyAtStart === true && o.git.newFiles === 0, 'untracked-only start: dirty, no new files: ' + JSON.stringify(o));

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

  // every git call of this spec passes main's real runner allowlist (spec 063 `GIT_CALLER_OPTIONS`, `hardenedArgv`), not only the fake runner:
  // a flag this spec uses that the runner refuses would turn every card into "could not read git" (cross-PR drift, review on #718/#722)
  {
    const all: string[][] = [];
    for (const [start, sha] of [['', REF], [Z(' M a.ts'), REF], ['', '']] as Array<[string, string]>) {
      const gx = fake({ status: start, 'rev-parse': sha || err('Command failed', { code: 1 }), shortstat: ' 1 file changed', numstat: '', 'rev-list': '1', statusAll: Z('?? n.ts') });
      const SX = new SessionStarts(gx.exec, now);
      await SX.noteStart('a', '/w');
      await SX.summarize('a', '/w');
      all.push(...gx.calls);
    }
    const kinds = new Set(all.map((c) => c.slice(2).filter((x) => x.startsWith('-')).join(' ') + ' ' + c[2]));
    for (const want of ['status', 'rev-parse', 'rev-list']) assert.ok(all.some((c) => c[2] === want), 'covers ' + want);
    assert.ok(all.some((c) => c.includes('--untracked-files=normal')) && all.some((c) => c.includes('--untracked-files=all')) && all.some((c) => c.includes('--shortstat')) && all.some((c) => c.includes('--numstat')) && all.some((c) => c.includes('HEAD') && c[2] === 'rev-list'), 'every call shape is covered: ' + [...kinds].join(' | '));
    for (const c of all) assert.doesNotThrow(() => hardenedArgv(c, []), 'main\'s git runner allows ' + c.join(' '));
    // and the whole flow through the real runner (makeGitExec over a recording run): the same numbers, never "could not read"
    const seen: string[][] = [];
    const run: GitRun = async (argv) => {
      seen.push(argv);
      if (argv.includes('config')) throw err('no filter', { code: 1 });
      const sub = ['status', 'diff', 'rev-parse', 'rev-list'].find((x) => argv.includes(x));
      if (sub === 'status') return argv.includes('--untracked-files=all') ? Z('?? n.ts') : '';
      if (sub === 'rev-parse') return REF + '\n';
      if (sub === 'diff') return argv.includes('--shortstat') ? ' 2 files changed, 3 insertions(+)' : '';
      return '4\n';
    };
    const SR = new SessionStarts(makeGitExec(run), now);
    await SR.noteStart('r', '/w');
    const rr = await SR.summarize('r', '/w');
    assert.deepStrictEqual(rr, { ok: true, ms: 0, git: { repo: true, files: 2, added: 3, removed: 0, binary: 0, newFiles: 1, commits: 4, dirtyAtStart: false } }, 'through the real runner: ' + JSON.stringify(rr));
    assert.ok(seen.every((a) => a.includes('--no-optional-locks') || a.includes('config')), 'the hardened argv was used');
  }

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

  // ---- spec 085 (2026-10-31): vendor-reported numbers, the lounge line, the day rollup
  // FR-013: bounded counts only
  assert.strictEqual(boundedCount(3.9), 3);
  for (const bad of [-1, NaN, Infinity, '5', null, undefined, {}, [], true]) assert.strictEqual(boundedCount(bad), undefined, String(bad));
  assert.strictEqual(boundedCount(1e30), 1e12, 'clamped');
  assert.deepStrictEqual(cleanVendorStats({ files: 3, added: 4.7, removed: 0, nanoAiu: 2e9, requests: 2, path: '/etc/passwd', name: 'x' }), { files: 3, added: 4, removed: 0, nanoAiu: 2e9, requests: 2 }, 'only the five counts survive');
  assert.strictEqual(cleanVendorStats({ files: 'x', added: -1, removed: NaN }), undefined, 'nothing usable is nothing reported, not zeros');
  assert.strictEqual(cleanVendorStats(null), undefined);
  assert.strictEqual(cleanVendorStats([1, 2]), undefined);
  assert.strictEqual(cleanVendorStats(JSON.parse('{"__proto__":{"files":9}}')), undefined, 'an inherited or __proto__ member is not read');
  // the Copilot shape (read: SDK 1.0.24 usage.getMetrics): names are counted and dropped
  assert.deepStrictEqual(copilotVendorStats({ codeChanges: { filesModified: ['/home/u/secret.ts', 'b'], filesModifiedCount: 5, linesAdded: 10, linesRemoved: 2 }, totalNanoAiu: 1e9, totalUserRequests: 1 }), { files: 5, added: 10, removed: 2, nanoAiu: 1e9, requests: 1 });
  assert.deepStrictEqual(copilotVendorStats({ codeChanges: { filesModified: ['a', 'b', 'c'], linesAdded: 1, linesRemoved: 0 } }), { files: 3, added: 1, removed: 0 }, 'no count: the length of the list');
  assert.ok(!JSON.stringify(copilotVendorStats({ codeChanges: { filesModified: ['/home/u/secret.ts'], filesModifiedCount: 1, linesAdded: 1, linesRemoved: 1 } })).includes('secret'), 'no file name leaves the adapter');
  assert.strictEqual(copilotVendorStats({ codeChanges: 'x', totalNanoAiu: 'y' }), undefined);
  assert.strictEqual(copilotVendorStats(undefined), undefined);
  // FR-010: the adapter call, with the limits
  assert.strictEqual(sourceId('copilot'), 'copilot');
  for (const bad of ['<b>', 'A', '', 'x'.repeat(21), 5, null, 'a b']) assert.strictEqual(sourceId(bad), 'agent', String(bad));
  const fa = new FakeAdapter({ id: 'copilot', capabilities: { sessionStats: true } });
  const sid = await fa.start({ workspace: os.tmpdir() });
  assert.deepStrictEqual(await readReported(fa, sid), { source: 'copilot', files: 3, added: 40, removed: 7, nanoAiu: 2.5e9, requests: 2 });
  fa.statsAnswer = { files: '<script>', added: -3, nanoAiu: NaN };
  assert.strictEqual(await readReported(fa, sid), undefined, 'a hostile answer is not reported');
  fa.statsAnswer = async () => { throw new Error('boom'); };
  assert.strictEqual(await readReported(fa, sid), undefined, 'a rejection is not reported');
  fa.statsAnswer = () => new Promise(() => undefined);
  assert.strictEqual(await readReported(fa, sid, 20), undefined, 'a hang is not reported after the limit');
  const off = new FakeAdapter({ id: 'claude', capabilities: { sessionStats: false } });
  assert.strictEqual(off.sessionStats, undefined, 'no capability, no member');
  assert.strictEqual(await readReported(off, 'x'), undefined);
  assert.strictEqual(await readReported(undefined, 'x'), undefined);
  assert.strictEqual(await readReported({ id: 'x', capabilities: { sessionStats: true } }, 'x'), undefined, 'a flag without the member is nothing');
  assert.strictEqual(await readReported({ id: 'x', capabilities: { sessionStats: false }, sessionStats: async () => ({ files: 1 }) }, 'x'), undefined, 'a member without the flag is not asked (FR-027)');
  // a hostile adapter that returns a lot: main bounds it again
  const hostile = { id: '<img>', capabilities: { sessionStats: true }, sessionStats: async () => ({ files: 1e30, added: 5, extra: 'x', path: '/p' }) };
  assert.deepStrictEqual(await readReported(hostile, 'x'), { source: 'agent', files: 1e12, added: 5 });
  // the Copilot adapter on the fake SDK
  const client = new FakeClient();
  const cop = new FakeCopilot(client);
  const csid = await cop.start({ workspace: os.tmpdir(), quiet: true });
  assert.strictEqual(cop.capabilities.sessionStats, true);
  assert.deepStrictEqual(await cop.sessionStats!(csid), { files: 3, added: 40, removed: 7, nanoAiu: 2.5e9, requests: 2 }, 'from usage.getMetrics');
  client.last.metricsFail = 'nope';
  await assert.rejects(cop.sessionStats!(csid), /nope/);
  assert.strictEqual(await readReported(cop, csid), undefined, 'a failing runtime is not reported');
  client.last.metricsFail = '';
  client.last.metricsHangs = true;
  assert.strictEqual(await readReported(cop, csid, 20), undefined);
  client.last.metricsHangs = false;
  const usageNs = (client.last.rpc as Record<string, unknown>).usage;
  delete (client.last.rpc as Record<string, unknown>).usage;
  assert.strictEqual(await cop.sessionStats!(csid), undefined, 'an older runtime without usage.getMetrics');
  (client.last.rpc as Record<string, unknown>).usage = usageNs;
  client.last.metricsAnswer = { codeChanges: { filesModified: Array.from({ length: 4 }, (_, i) => `/home/x/${i}`), linesAdded: '9', linesRemoved: -1 }, totalNanoAiu: Infinity };
  assert.deepStrictEqual(await cop.sessionStats!(csid), { files: 4 }, 'hostile members dropped, names counted');
  // the words: a vendor sentence of its own, naming it
  assert.strictEqual(W.reported({ source: 'copilot', files: 3, added: 40, removed: 7, nanoAiu: 2.5e9, requests: 2 }), 'GitHub Copilot reported: 3 files, +40 −7, 2.5 AI credits, 2 requests.');
  assert.strictEqual(W.reported({ source: 'copilot', files: 1 }), 'GitHub Copilot reported: 1 file.', 'a missing member is left out, never a zero');
  assert.strictEqual(W.reported({ source: '<b>x</b>', files: 1 }), 'the agent app reported: 1 file.', 'the name comes from a fixed table');
  assert.strictEqual(W.reported({ source: 'copilot', files: 'x', added: -1, nanoAiu: NaN }), '');
  assert.strictEqual(W.reported(null), '');
  assert.strictEqual(W.reported([1]), '');
  assert.strictEqual(W.reported(JSON.parse('{"__proto__":{"files":9},"source":"claude"}')), '', 'inherited members are not read');
  assert.ok(!/Infinity|NaN|undefined|\[object/.test(W.reported({ source: 'codex', files: 1e30, nanoAiu: 1e30 })));
  const both = W.text({ ...full, reported: { source: 'copilot', files: 11, added: 300, removed: 80, nanoAiu: 1.25e9 } }, 'cost ≈ $0.40');
  assert.ok(both.startsWith('Session summary: 12 files changed, +340 −80, 3 new files, 1 commit, 25 min, cost ≈ $0.40.'), 'Durbar\'s own count stays first and unchanged');
  assert.ok(both.endsWith(' GitHub Copilot reported: 11 files, +300 −80, 1.25 AI credits.'), 'the vendor\'s numbers are separate and labelled, not merged: ' + both);
  assert.doesNotMatch(W.text(full, ''), /reported:/, 'no vendor sentence without vendor numbers');
  // FR-008: the short form
  assert.strictEqual(W.short(full), '12 files changed, +340 −80, 3 new files, 1 commit, 25 min');
  assert.strictEqual(W.short({ ok: true, ms: 20000, git: { repo: true, files: 0, added: 0, removed: 0, commits: 0 } }), 'no files changed, under 1 min');
  assert.strictEqual(W.brief(full), '12 files, +340 −80');
  assert.strictEqual(W.brief({ ok: true, ms: 20000, git: { repo: true, files: 1, added: 2, removed: 0, commits: 0 } }), '1 file, +2 −0');
  assert.strictEqual(W.brief({ ok: true, ms: 20000, git: { repo: true, files: 0, added: 0, removed: 0, commits: 0 } }), 'no files changed');
  assert.strictEqual(W.brief({ ok: true, ms: 1, git: { repo: false } }), '');
  assert.strictEqual(W.brief(null), '');
  for (const none of [{ ok: true, ms: 1, git: { repo: false } }, { ok: true, ms: 1, git: { repo: false, unreadable: true } }, { ok: true, ms: 1, git: { repo: true, noHead: true, files: 0 } }, { ok: false, error: 'x' }, null, undefined, 'x']) assert.strictEqual(W.short(none), '', JSON.stringify(none));
  assert.ok(!/NaN|Infinity|undefined|<|\[object/.test(W.short(evil)), W.short(evil));
  // FR-009: the briefing sentence and the rollup
  assert.strictEqual(W.briefing({ sessions: 3, files: 18, added: 400, removed: 90, commits: 2, minutes: 130 }), 'Sessions ended yesterday and today: 3, 18 files changed, +400 −90, 2 commits, 2 h 10 min.');
  assert.strictEqual(W.briefing({ sessions: 0 }), '');
  assert.strictEqual(W.briefing(undefined), '');
  assert.strictEqual(W.briefing({ sessions: '3', files: -4, added: 1e30, removed: NaN, commits: { x: 1 }, minutes: 'abc' }), '', 'a string for the session count is no count');
  assert.ok(!/NaN|Infinity|undefined|\[object/.test(W.briefing({ sessions: 2, files: -4, added: 1e30, removed: NaN, commits: { x: 1 }, minutes: 'abc' })));
  assert.deepStrictEqual(dayNumbers({ ok: true, ms: 125000, git: { repo: true, files: 2, added: 3, removed: 1, binary: 0, newFiles: 0, commits: 1, dirtyAtStart: false } }), { minutes: 2, files: 2, added: 3, removed: 1, commits: 1 });
  assert.deepStrictEqual(dayNumbers({ ok: true, ms: 60000, git: { repo: false } }), { minutes: 1 }, 'a non-git folder adds the session and its minutes only');
  assert.strictEqual(dayNumbers({ ok: false, error: 'x' }), undefined);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-days-'));
  const file = path.join(dir, 'durbar-summary-days.json');
  let dayNow = new Date(2026, 9, 31, 10, 0, 0);
  const D = new SummaryDays(file, () => dayNow);
  D.load();
  assert.strictEqual(D.recent(), undefined, 'nothing ended: nothing to say');
  D.add({ files: 5, added: 50, removed: 5, commits: 1, minutes: 30 });
  dayNow = new Date(2026, 9, 31, 18, 0, 0);
  D.add({ files: 2, added: 10, removed: 0, commits: 0, minutes: 5 });
  assert.deepStrictEqual(D.recent(), { sessions: 2, files: 7, added: 60, removed: 5, commits: 1, minutes: 35 });
  dayNow = new Date(2026, 10, 1, 9, 0, 0);
  assert.strictEqual(D.recent()!.sessions, 2, 'yesterday still counts');
  dayNow = new Date(2026, 10, 2, 9, 0, 0);
  assert.strictEqual(D.recent(), undefined, 'two days later it does not');
  const text = fs.readFileSync(file, 'utf8');
  assert.deepStrictEqual(Object.keys(JSON.parse(text)).sort(), ['days', 'version']);
  assert.ok(!/[\\/]/.test(text.replace(/"day":"[\d-]+"/g, '')), 'no path in the file');
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o077, 0, 'owner only');
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')), 'atomic: no temp file left');
  const D2 = new SummaryDays(file, () => new Date(2026, 9, 31, 20, 0, 0));
  D2.load();
  assert.strictEqual(D2.recent()!.sessions, 2, 'survives a restart');
  assert.strictEqual(localDay(new Date(2026, 0, 5)), '2026-01-05');
  // a corrupt, hostile or oversized file is an empty rollup; only 7 days are kept
  for (const bad of ['', 'not json', '[]', '{"days":"x"}', '{"days":[null,1,"a",{"day":"../../etc","sessions":1},{"day":"2026-10-31"}]}', JSON.stringify({ days: [{ day: '2026-10-31', sessions: 1 }], pad: 'x'.repeat(70000) })]) assert.deepStrictEqual(parseDays(bad), [], bad.slice(0, 40));
  const odd = parseDays(JSON.stringify({ days: [{ day: '2026-10-31', sessions: 2, files: '9', added: -1, removed: 1e30, commits: NaN, minutes: 3.7, path: '/x', __proto__: { y: 1 } }] }));
  assert.deepStrictEqual(odd, [{ day: '2026-10-31', sessions: 2, files: 0, added: 0, removed: 1e9, commits: 0, minutes: 3 }]);
  const many = parseDays(JSON.stringify({ days: Array.from({ length: 20 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, sessions: 1 })) }));
  assert.strictEqual(many.length, 7);
  assert.strictEqual(many[6].day, '2026-10-20', 'the newest 7');
  fs.writeFileSync(file, 'garbage');
  const D3 = new SummaryDays(file, () => dayNow);
  D3.load();
  D3.add({ minutes: 1 });
  assert.strictEqual(D3.recent()!.sessions, 1, 'a corrupt file starts over');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('[sessionsummary] all checks passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
