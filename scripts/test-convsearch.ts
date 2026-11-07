/**
 * Spec 095 T010, T014, T015, T017: the conversation search's scan over FAKE readers of the four kinds (open session, earlier Claude
 * Code, open Codex, VS Code chat), a fake clock and a fake yield: `npm run test:convsearch`. No credits, no network, no real store.
 */
import './safetext-shared'; // the compiled hidden-character module for safetext.js (spec 084 FR-033)
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { HistoryItem } from '../src/adapters/history';
import { MaskBudgetError, createMasker } from '../src/main/convmask';
import { SEARCH_HISTORY_LIMITS, SEARCH_MAX_TEXT_CHARS, cut as readerCut } from '../src/adapters/history';
import type { Masker } from '../src/main/convmask';
import { BUDGET, createReadGate, messageExcerpts, orderPlan, rendererScript, startScan } from '../src/main/convsearch';
import type { PlanSession, ReadOutcome, ScanBatch, ScanDeps, ScanEnd, SessionSearchApi } from '../src/main/convsearch';

process.exitCode = 1;
const ROOT = ((): string => {
  for (let d = __dirname; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'package.json')) && fs.existsSync(path.join(d, 'src', 'renderer'))) return d;
    if (path.dirname(d) === d) throw new Error('repo root not found');
  }
})();
const MAIN_DIR = path.join(ROOT, 'src', 'main');

// ---- T010: main loads the window's own file (one source of truth), by the dist layout: <dist>/main/.. + /renderer/<name>
const S = rendererScript<SessionSearchApi>('sessionsearch.js', MAIN_DIR);
assert.strictEqual(S, require(path.join(ROOT, 'src', 'renderer', 'sessionsearch.js')), 'the very module the window runs, not a copy');
assert.throws(() => rendererScript('app.js' as never, MAIN_DIR), /not a shared window script/);
{
  const copy = fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8');
  for (const f of ['sessionsearch.js', 'safetext.js', 'cuttext.js']) assert.ok(copy.includes(`'${f}'`), `the build copies ${f} next to main`);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { build: { files: string[] } };
  assert.ok(pkg.build.files.includes('dist/**/*'), 'and the package ships dist/**');
  const built = path.join(ROOT, 'dist', 'renderer', 'sessionsearch.js');
  if (fs.existsSync(built)) assert.strictEqual(fs.readFileSync(built, 'utf8'), fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'sessionsearch.js'), 'utf8'), 'the built copy is the source');
  else console.log('convsearch: no dist build here, built-copy equality not checked');
}
const ST = rendererScript<{ unhide(s: string): string }>('safetext.js', MAIN_DIR);
const MASKER = createMasker({ unhide: (s) => ST.unhide(s) });

// ---- fixtures
const GHP = 'gh' + 'p_' + 'Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0Fe9Dc8';
const MCPV = 'mcp-secret-VALUE-77fa';
const USER = 'alicewonder';
const SECRETS = [GHP, MCPV, USER];
const u = (text: string): HistoryItem => ({ type: 'user', text });
const a = (text: string): HistoryItem => ({ type: 'output', text });
const tool = (output: string): HistoryItem => ({ type: 'tool', callId: 'c' + output.length, tool: 'bash', label: output, output });
let sid = 0;
const sess = (o: Partial<PlanSession>): PlanSession => ({ adapter: 'claude', app: 'Claude Code', folderKey: '/home/' + USER + '/proj', folderName: 'proj', sessionId: `s${++sid}`, group: 'earlier', title: 'Untitled', time: 1000 - sid, content: 'read', ...o });

interface Harness { deps: ScanDeps; batches: ScanBatch[]; reads: string[]; slices: number[]; clock: { t: number }; work: { masks: number } }
function harness(items: Record<string, readonly HistoryItem[] | ReadOutcome>, o: { masker?: Masker; cost?: number; onYield?: () => void; values?: (s: PlanSession) => readonly string[] } = {}): Harness {
  const clock = { t: 0 };
  const batches: ScanBatch[] = [];
  const reads: string[] = [];
  const slices: number[] = [];
  const work = { masks: 0 };
  let last = 0;
  const cost = o.cost ?? 1;
  const base = o.masker ?? MASKER;
  // the fake clock: masking costs `cost` ms per 1 000 characters, a message 0.2 ms
  const masker: Masker = {
    maskText: (raw, v) => { work.masks++; clock.t += (cost * raw.length) / 1000; return base.maskText(raw, v); },
    maskedWindow: (raw, f, t, v, w) => { work.masks++; const r = base.maskedWindow(raw, f, t, v, w); clock.t += (cost * r.text.length) / 1000; return r; },
  };
  const deps: ScanDeps = {
    now: () => (clock.t += 0.2),
    yieldNow: async () => { slices.push(clock.t - last); o.onYield?.(); await new Promise<void>((r) => setImmediate(r)); last = clock.t; },
    sleep: async (ms) => { clock.t += ms; last = clock.t; },
    read: async (s) => {
      reads.push(s.sessionId);
      await new Promise<void>((r) => setImmediate(r));
      last = clock.t;
      const x = items[s.sessionId];
      if (!x) return { ok: false, reason: 'missing' };
      return Array.isArray(x) ? { ok: true, items: x as HistoryItem[] } : (x as ReadOutcome);
    },
    values: o.values ?? (() => [MCPV]),
    masker,
    search: S,
    emit: (b) => batches.push(JSON.parse(JSON.stringify(b)) as ScanBatch),
  };
  return { deps, batches, reads, slices, clock, work };
}
const hitsOf = (h: Harness) => h.batches.flatMap((b) => b.hits);
/** SC-002: walk every string of every batch: no secret, no piece of one, no home path, no full path, no raw message over 180 characters. */
function walk(h: Harness, what: string): number {
  let n = 0;
  const visit = (v: unknown, at: string): void => {
    if (typeof v === 'string') {
      n++;
      for (const x of SECRETS) for (let i = 0; i + 8 <= x.length; i += 1) if (v.includes(x.slice(i, i + Math.min(8, x.length)))) assert.fail(`${what}: piece of a secret at ${at}: ${JSON.stringify(v)}`);
      assert.ok(!/\/home\/|\/Users\/|[A-Za-z]:\\+Users|[A-Za-z]:\/(?!\/)|\/proj\b/.test(v), `${what}: a path at ${at}: ${JSON.stringify(v)}`);
      assert.ok(v.length <= BUDGET.excerptChars, `${what}: a string over ${BUDGET.excerptChars} characters at ${at}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${at}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, `${at}.${k}`);
  };
  visit(h.batches, 'batches');
  return n;
}
const run = async (h: Harness, sessions: PlanSession[], q: string, extra: { unavailable?: string[]; platform?: NodeJS.Platform } = {}): Promise<ScanEnd> => startScan({ sessions, ...extra }, q, h.deps).done;

async function main(): Promise<void> {
  // ---- T014: the excerpt builder
  {
    const o = { n: 4, speaker: 'agent' as const, values: [MCPV], masker: MASKER, search: S };
    const text = 'We looked at many things first. '.repeat(4) + 'Then the plan was to fix the invoice export to CSV when the totals were empty, ' + 'and the rest of the work waited. '.repeat(6);
    const r = messageExcerpts(text, 'invoice export', o)!;
    assert.strictEqual(r.excerpts.length, 1, 'both words in one excerpt');
    const e = r.excerpts[0];
    assert.ok(e.text.length <= BUDGET.excerptChars && e.text.length >= 100, `about 140 characters (${e.text.length})`);
    assert.ok(e.text.startsWith('…') && e.text.endsWith('…'), 'cut on both sides, marked');
    assert.deepStrictEqual(e.marks.map(([s, t]) => e.text.slice(s, t)), ['invoice', 'export'], 'every word marked');
    const body = e.text.slice(1, -1);
    assert.ok(text.includes(' ' + body + ' '), `cut at word boundaries on both sides: ${JSON.stringify(e.text)}`);
    assert.deepStrictEqual(e.anchor, { n: 4, head: S.anchorKey(text).slice(0, 60) }, 'the anchor: n and the head of the masked message');
    assert.deepStrictEqual([...r.confirmed].sort(), [0, 1]);
    // the head is built after the full masking: a secret at the start of the message is masked in the head too
    const r2 = messageExcerpts(`**${GHP}** then the invoice`, 'invoice', o)!;
    assert.ok(!r2.excerpts[0].anchor.head.includes('gh' + 'p_') && r2.excerpts[0].anchor.head.startsWith('[redacted]'), `masked head: ${r2.excerpts[0].anchor.head}`);
    // A2: a word found only inside a secret is dropped (the masked text does not hold it)
    assert.deepStrictEqual(messageExcerpts(`key ${GHP} here`, 'zx9yw8', o)!.excerpts, [], 'a match inside a token is dropped');
    assert.deepStrictEqual(messageExcerpts(`see /home/${USER}/notes`, USER, o)!.excerpts, [], 'a match on a user name in a home path is dropped');
    assert.deepStrictEqual(messageExcerpts(`the ${MCPV} value`, 'VALUE-77fa', o)!.excerpts, [], 'an MCP secret value cannot be found by its value');
    assert.strictEqual(messageExcerpts('nothing here', 'invoice', o), undefined, 'no raw hit: nothing masked at all');
    // two words in far apart places: two excerpts, each marked
    const far = 'invoice ' + 'filler words go here and on '.repeat(40) + ' export';
    const r3 = messageExcerpts(far, 'invoice export', o)!;
    assert.strictEqual(r3.excerpts.length, 2);
    // a long match: still at most 180 characters, cut on a code point boundary
    // review of PR 1098 (the isLow survivor): a match over 178 characters whose cut falls between the two halves of a surrogate pair
    const longWord = 'x' + '\u{1F600}'.repeat(150);
    const r4 = messageExcerpts(`ab ${longWord} y`, longWord, o)!;
    assert.strictEqual(r4.excerpts.length, 1, 'a long match gives an excerpt');
    const t4 = r4.excerpts[0].text;
    assert.ok(t4.length <= BUDGET.excerptChars && t4.endsWith('…') && !/[\uD800-\uDBFF]…$/.test(t4), `cut on a code point: ${JSON.stringify(t4.slice(-4))}`);
    assert.deepStrictEqual(r4.excerpts[0].marks, [[1, t4.length - 1]], 'the visible part of the match is marked');
    assert.ok(r4.excerpts.every((x) => x.text.length <= BUDGET.excerptChars && !/[\uD800-\uDBFF]$/.test(x.text.replace(/…$/, ''))), 'a long match is cut on a code point boundary');
    // a secret next to the hit, glued to Markdown, at the edge of the excerpt: never shown, the hit still is
    for (let pad = 0; pad < 140; pad += 7) {
      const t = 'w '.repeat(pad) + `x**${GHP}**` + ' w'.repeat(3) + ' invoice ' + 'w '.repeat(140 - pad) + ` x**${GHP}** tail`;
      const ex = messageExcerpts(t, 'invoice', o)!.excerpts;
      assert.strictEqual(ex.length, 1);
      assert.ok(!ex[0].text.includes('Zx9Yw8') && !ex[0].text.includes('gh' + 'p_'), `no secret at pad ${pad}: ${ex[0].text}`);
    }
    // the edge guard: a secret whose mask needs context outside the window (`password:` before its edge), with masks between it and the hit
    // that shrink the text, so a cut around the hit would reach it: the excerpt is then cut from the whole masked message
    let guarded = 0;
    for (let pad = 0; pad < 40; pad++) {
      const toks = 'eyJ' + 'hbGciOiJIUzI1NiJ9' + '.' + 'eyJ' + 'a'.repeat(300) + '.' + 'b'.repeat(240); // a 565-character token: masked to 10
      const t = 'lead words '.repeat(150) + ' password: hunter2value ' + 'w '.repeat(pad) + toks + ' invoice ' + 'tail words '.repeat(150);
      for (const ex of messageExcerpts(t, 'invoice', o)!.excerpts) {
        assert.ok(!ex.text.includes('hunter2value'), `no context-masked secret at the excerpt edge (pad ${pad}): ${ex.text}`);
        guarded++;
      }
    }
    assert.strictEqual(guarded, 40);
    // re-review of PR 1098: a long match near a window edge that is not the message's edge is not cut there; the window grows (here
    // straight to the whole message, which the stub marks) on both sides
    {
      const L = 'x' + 'y'.repeat(200);
      const pad = (n: number) => 'p '.repeat(n);
      for (const side of ['left', 'right'] as const) {
        const win = side === 'left' ? pad(25) + L + ' ' + pad(400) : pad(400) + L + ' ' + pad(60);
        const stub: Masker = {
          maskText: (r) => r,
          maskedWindow: (raw, _f, _t, _v, w) => (w?.whole ? { text: 'WHOLE ' + raw, atStart: true, atEnd: true, work: 1 } : { text: win, atStart: false, atEnd: false, work: 1 }),
        };
        const ex = messageExcerpts(pad(500) + L + ' ' + pad(500), L, { ...o, masker: stub })!.excerpts;
        assert.strictEqual(ex.length, 1);
        assert.ok(ex[0].anchor.head.startsWith('whole'), `${side} edge: the excerpt is cut from the whole message, not next to the window's edge (head ${ex[0].anchor.head.slice(0, 10)})`);
      }
    }
    // the mask throws: the caller gets the throw (and drops the message)
    const bad = createMasker({ unhide: () => { throw new Error('x'); } });
    assert.throws(() => messageExcerpts('the invoice', 'invoice', { ...o, masker: bad }));
  }

  // ---- T015: plan order, dedupe, caps, notes (pure)
  {
    sid = 0;
    const p = orderPlan({
      platform: 'win32',
      sessions: [
        sess({ sessionId: 'e-old', folderKey: 'C:\\Work\\A', time: 1 }),
        sess({ sessionId: 'o1', group: 'office', folderKey: 'C:\\Work\\B', time: 5 }),
        sess({ sessionId: 'e-new', folderKey: 'C:\\Work\\A', time: 9 }),
        sess({ sessionId: 'e-new', folderKey: 'c:/work/a/', time: 9 }), // the same session listed by a second agent of the app (Windows: case and separators)
        sess({ sessionId: 'e-new', adapter: 'codex', folderKey: 'C:\\Work\\A', time: 9 }), // another app: not a duplicate
        sess({ sessionId: 'h', helper: true }),
        sess({ sessionId: 'f', floorOff: true }),
        sess({ sessionId: 'x', hidden: true }),
        sess({ sessionId: 'x2', hidden: true }),
        sess({ sessionId: 'o2', group: 'office', folderKey: 'C:\\Work\\A', time: 2 }),
        sess({ sessionId: 'b1', folderKey: 'C:\\Work\\B', time: 3 }),
      ],
    });
    assert.deepStrictEqual(p.list.map((s) => s.adapter + ':' + s.sessionId), ['claude:o2', 'claude:o1', 'claude:e-new', 'codex:e-new', 'claude:e-old', 'claude:b1'], 'office first; then per folder in office order, newest first; duplicates once');
    assert.deepStrictEqual([p.notes.hidden, p.notes.floorsOff, p.notes.folders], [2, 1, 2], 'hidden and floors off counted, helpers not');
    const linux = orderPlan({ platform: 'linux', sessions: [sess({ sessionId: 'd', folderKey: '/p/A' }), sess({ sessionId: 'd', folderKey: '/p/a' })] });
    assert.strictEqual(linux.list.length, 2, 'Linux: folder case matters');
    const mac = orderPlan({ platform: 'darwin', sessions: [sess({ sessionId: 'd', folderKey: '/Users/x/A' }), sess({ sessionId: 'd', folderKey: '/users/x/a/' })] });
    assert.strictEqual(mac.list.length, 1, 'macOS: case-insensitive');
    const many = orderPlan({ platform: 'linux', sessions: Array.from({ length: 630 }, (_, i) => sess({ folderKey: `/f${i % 3}`, time: i })) });
    assert.deepStrictEqual([many.list.length, many.notes.capped.perFolder, many.notes.capped.sessions], [400, true, true], '200 per folder, 400 per scan');
  }

  // ---- T015: the scan over the four kinds
  {
    sid = 0;
    const open = sess({ sessionId: 'open-copilot', adapter: 'copilot', app: 'GitHub Copilot', group: 'office', agentId: 'a1', title: 'Office work', time: 50 });
    const claude = sess({ sessionId: 'claude-earlier', title: 'Old chat', time: 40 });
    const codexOpen = sess({ sessionId: 'codex-open', adapter: 'codex', app: 'Codex', group: 'office', agentId: 'a2', title: 'Codex work', time: 45 });
    const vs = sess({ sessionId: 'vs-chat', adapter: 'vscode', app: 'VS Code', title: 'VS chat', time: 30 });
    const toolOnly = sess({ sessionId: 'tool-only', title: 'Tools', time: 35 });
    const codexEarlier = sess({ sessionId: 'codex-earlier', adapter: 'codex', app: 'Codex', title: 'invoice export notes', content: 'title', time: 20 });
    const copilotEarlier = sess({ sessionId: 'copilot-earlier', adapter: 'copilot', app: 'GitHub Copilot', title: 'nothing', content: 'title', time: 21 });
    const titleHit = sess({ sessionId: 'title-hit', title: 'Invoice export plan', time: 10 });
    const big = sess({ sessionId: 'too-big', time: 9 });
    const broken = sess({ sessionId: 'broken', time: 8 });
    const h = harness({
      'open-copilot': [u('please fix the invoice'), tool('invoice export TOOL'), a(`Done with the export, token ${GHP} kept out`)],
      'claude-earlier': [u('the export of the invoice to CSV'), a(`saved to /home/${USER}/proj/out.csv`)],
      'codex-open': [u('unrelated'), a('also unrelated')],
      'vs-chat': [u('Invoice'), a('export'), u('invoice export again'), a('invoice and export once more'), u('and invoice export a fifth time')],
      'tool-only': [u('hello'), tool('invoice export only in tool output')],
      'too-big': { ok: false, reason: 'too-large' },
      broken: { ok: false, reason: 'unreadable' },
      'codex-earlier': [u('invoice export')],
      'copilot-earlier': [u('invoice export')],
      'title-hit': [u('should not be read')],
    });
    const end = await run(h, [claude, open, vs, codexOpen, toolOnly, codexEarlier, copilotEarlier, titleHit, big, broken], 'invoice export', { unavailable: ['Codex (not installed)'] });
    const hits = hitsOf(h);
    assert.deepStrictEqual(hits.map((x) => x.sessionId), ['open-copilot', 'claude-earlier', 'vs-chat', 'codex-earlier', 'title-hit'], 'the matching sessions, office first, then newest first');
    assert.ok(!hits.some((x) => x.sessionId === 'tool-only'), 'D2: tool output never matches');
    assert.ok(!hits.some((x) => x.sessionId === 'codex-open'), 'a session without the words is not a hit');
    assert.ok(!h.reads.includes('codex-earlier') && !h.reads.includes('copilot-earlier'), 'earlier Copilot and Codex sessions: title only, never read');
    assert.ok(!h.reads.includes('title-hit'), 'a title hit is a hit at once, before its messages are read');
    const th = hits.find((x) => x.sessionId === 'title-hit')!;
    assert.deepStrictEqual([th.excerpts.length, th.titleMarks.map(([s, t]) => th.title.slice(s, t))], [0, ['Invoice', 'export']], 'title hit: no excerpt line, the title marked');
    const oc = hits.find((x) => x.sessionId === 'open-copilot')!;
    assert.deepStrictEqual(oc.excerpts.map((e) => [e.speaker, e.anchor.n]), [['you', 0], ['agent', 1]], 'the words in two messages: two excerpts; n counts text messages only (the tool item is not counted)');
    assert.deepStrictEqual([oc.agentId, oc.group, oc.folderName, oc.app], ['a1', 'office', 'proj', 'GitHub Copilot']);
    const v = hits.find((x) => x.sessionId === 'vs-chat')!;
    assert.deepStrictEqual([v.excerpts.length, v.more], [3, 2], 'at most 3 excerpts, then +N more');
    assert.deepStrictEqual(v.excerpts.map((e) => e.anchor.n), [0, 1, 2], 'the first ones that show every word, in message order');
    assert.deepStrictEqual([end.notes.tooLarge, end.notes.unreadable, end.notes.titleOnly.count, end.notes.notInstalled, end.cancelled, end.failed], [1, 1, 2, ['Codex (not installed)'], false, false]);
    assert.deepStrictEqual(end.notes.titleOnly.apps.sort(), ['Codex', 'GitHub Copilot']);
    assert.deepStrictEqual(end.progress, { done: 10, total: 10 });
    assert.ok(walk(h, 'four kinds') > 30, 'every string of every batch walked');
    // batches: at most 20 hits, at most one per 250 ms of the fake clock
    assert.ok(h.batches.every((b) => b.hits.length <= BUDGET.batchHits));
    const last = h.batches[h.batches.length - 1];
    assert.deepStrictEqual(last.groups, { office: 1, earlier: 4 });
  }

  // ---- every word, any order, across messages and the title; the minimum query is not the scan's (IPC, phase 2) but a blank one scans nothing
  {
    sid = 0;
    const h = harness({ s1: [u('alpha only')], s2: [u('beta here'), a('and ALPHA there')], s3: [u('gamma')] });
    await run(h, [sess({ sessionId: 's1' }), sess({ sessionId: 's2' }), sess({ sessionId: 's3', title: 'Beta notes' })], 'beta alpha');
    assert.deepStrictEqual(hitsOf(h).map((x) => x.sessionId), ['s2'], 'every word, any order; title words count with the messages');
    const h2 = harness({ s3: [u('alpha')] });
    sid = 2;
    await run(h2, [sess({ sessionId: 's3', title: 'Beta notes' })], 'beta alpha');
    assert.deepStrictEqual(hitsOf(h2).map((x) => [x.sessionId, x.excerpts.length, x.titleMarks.length]), [['s3', 1, 1]], 'title word plus message word');
    const h3 = harness({ s1: [u('x')] });
    const e3 = await run(h3, [sess({ sessionId: 's1' })], '   ');
    assert.deepStrictEqual([h3.reads.length, h3.batches.length, e3.progress.done], [0, 0, 0], 'a blank query reads nothing');
  }

  // ---- FR-021: the title is masked before it is matched; a throwing masker means no title hit
  {
    sid = 0;
    const h = harness({});
    await run(h, [sess({ sessionId: 't1', title: `deploy with ${GHP}`, content: 'title' }), sess({ sessionId: 't2', title: `/home/${USER}/proj notes`, content: 'title' })], 'zx9yw8vu7');
    assert.deepStrictEqual(hitsOf(h), [], 'a title cannot be found by a secret in it');
    const h1 = harness({});
    await run(h1, [sess({ sessionId: 't1', title: `deploy with ${GHP}`, content: 'title' })], 'deploy');
    assert.strictEqual(hitsOf(h1)[0].title, 'deploy with [redacted]', 'the title is sent masked');
    walk(h1, 'masked title');
    const throwing: Masker = { maskText: () => { throw new Error('mask'); }, maskedWindow: () => { throw new Error('mask'); } };
    const h2 = harness({ m: [u('deploy now')] }, { masker: throwing });
    await run(h2, [sess({ sessionId: 't3', title: 'deploy', content: 'title' }), sess({ sessionId: 'm', title: 'deploy' })], 'deploy');
    assert.deepStrictEqual(hitsOf(h2), [], 'fail closed: no title hit and no message hit when masking throws');
    const h3 = harness({ m: [u('deploy now')] }, { values: () => { throw new Error('store'); } });
    const e3 = await run(h3, [sess({ sessionId: 'm', title: 'deploy' })], 'deploy');
    assert.deepStrictEqual([hitsOf(h3).length, h3.reads.length, e3.notes.unreadable], [0, 0, 1], 'no secret values, nothing searched (fail closed)');
  }

  // ---- SC-002: a corpus of secrets in messages; every string of every batch walked
  {
    sid = 0;
    const pad = (n: number) => 'filler words to move things around '.repeat(n);
    const msgs: HistoryItem[] = [];
    for (let k = 0; k < 30; k++) {
      msgs.push(u(`${pad(k)} invoice ${pad(k % 5)} x**${GHP}** ${MCPV} https://bob:${MCPV}@host.test/r /home/${USER}/a C:\\Users\\${USER}\\b /Users/${USER}/c ${pad(3)}`));
      msgs.push(a(`${GHP.slice(0, 20)}**${GHP.slice(20)}** invoice "C:\\\\Users\\\\${USER}\\\\x" ${pad(k)}`));
    }
    const h = harness({ big: msgs });
    await run(h, [sess({ sessionId: 'big', title: `notes ${GHP} /home/${USER}/x` })], 'invoice');
    assert.strictEqual(hitsOf(h)[0]?.excerpts.length, 3, 'excerpts were built');
    assert.strictEqual(hitsOf(h).length, 1);
    assert.ok(walk(h, 'secret corpus') > 10);
  }

  // ---- caps: 200 results, the 60 s stop (fake clock), 20 000 characters per message
  {
    sid = 0;
    const items: Record<string, HistoryItem[]> = {};
    const list = Array.from({ length: 260 }, (_, i) => { const s = sess({ folderKey: `/f${i % 3}`, sessionId: `r${i}` }); items[s.sessionId] = [u('match me')]; return s; });
    const h = harness(items);
    const e = await run(h, list, 'match');
    assert.deepStrictEqual([hitsOf(h).length, e.notes.capped.results], [BUDGET.maxResults, true], '200 results, then stop');
    assert.ok(h.batches.every((b) => b.hits.length <= BUDGET.batchHits), 'batches of at most 20');
    // the 60 s stop: a slow reader on the fake clock
    sid = 0;
    const slow = harness(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`z${i}`, [u('no')]])));
    const realRead = slow.deps.read;
    slow.deps.read = async (s, stop) => { slow.clock.t += 5_000; return realRead(s, stop); };
    const e2 = await run(slow, Array.from({ length: 50 }, (_, i) => sess({ sessionId: `z${i}` })), 'match');
    assert.ok(e2.notes.timedOut && slow.reads.length < 15 && slow.reads.length >= 11, `stopped after 60 s (${slow.reads.length} reads)`);
    // 20 000 characters: a word after the cut is not searched, and the cut never leaves half a token
    sid = 0;
    const long = 'a '.repeat(9_990) + 'x'.repeat(30) + GHP + ' late';
    const h3 = harness({ L: [u(long)] });
    const e3 = await run(h3, [sess({ sessionId: 'L' })], 'late');
    assert.deepStrictEqual([hitsOf(h3).length, e3.notes.cut], [0, 1], 'beyond 20 000 characters: not searched, and said');
    const h4 = harness({ L: [u(long.slice(0, 20_001))] });
    await run(h4, [sess({ sessionId: 'L' })], 'xxxxxxxx');
    assert.deepStrictEqual(hitsOf(h4), [], 'the run the cut split is dropped, not searched half');
  }

  // ---- review finding 3: a spaced MCP value cut by the reader's 20 000-character limit (the reviewer's probe 5): the cut end is not the
  // message's own edge, so the edge guard holds there and the value's first word never shows
  {
    sid = 0;
    const V = 'Tr0ub4dorXYZ99 correcthorsebattery';
    const fill = (n: number): string => { let t = ''; for (let i = 0; t.length < n; i++) t += 'w' + (i % 97) + ' '; return t.slice(0, n); };
    for (const tail of [31, 60, 120, 190]) {
      const pre = fill(20_000 - 24);
      const rawMsg = pre.slice(0, pre.length - tail - 9) + ' invoice ' + pre.slice(pre.length - tail) + ' ' + V + ' tail';
      const h = harness({ cutv: [u(readerCut(rawMsg, 20_000))] }, { values: () => [V] });
      await run(h, [sess({ sessionId: 'cutv' })], 'invoice');
      assert.ok(!JSON.stringify(h.batches).includes('Tr0ub4dor'), `no first word of a cut value (tail ${tail}): ${JSON.stringify(hitsOf(h).map((x) => x.excerpts.map((e) => e.text)))}`);
    }
    // and a hit far from the cut is still found
    const pre = fill(20_000 - 24);
    const early = pre.slice(0, 5_000) + ' invoice ' + pre.slice(5_000) + ' ' + V + ' tail';
    const h2 = harness({ early: [u(readerCut(early, 20_000))] }, { values: () => [V] });
    await run(h2, [sess({ sessionId: 'early' })], 'invoice');
    assert.strictEqual(hitsOf(h2).length, 1, 'a hit far from the cut is found');
  }

  // ---- review finding 4: a token-dense 20 000-character message: its masks stop at the message budget, it shows nothing and is counted
  {
    const tok = (i: number) => 'gh' + 'p_' + (String(i).padStart(6, '0') + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6').slice(0, 36);
    let dense = '**x** ';
    for (let i = 0; dense.length < 19_900; i++) dense += '**' + tok(i) + '** invoice '; // every token next to a mark: the costly case
    let dense2 = '';
    for (let i = 0; dense2.length < 19_900; i++) dense2 += '**' + tok(i) + '** ';
    for (const [msg, q] of [[dense, 'invoice'], [dense2, 'a1b2c3d4']] as const) {
      let work = 0;
      const counting: Masker = { maskText: (r, v, b) => MASKER.maskText(r, v, b), maskedWindow: (r, f, t, v, w) => { const x = MASKER.maskedWindow(r, f, t, v, w); work += x.work; return x; } };
      let threw: unknown;
      try { messageExcerpts(msg.slice(0, 19_990), q, { n: 0, speaker: 'you', values: [], masker: counting, search: S }); } catch (e) { threw = e; }
      assert.ok(work <= BUDGET.messageWork, `the masks of one message stay within its budget (${work} <= ${BUDGET.messageWork})`);
      if (q === 'invoice') assert.ok(threw instanceof MaskBudgetError, 'over budget: MaskBudgetError, not an unmasked excerpt');
    }
    sid = 0;
    const h = harness({ dense: [u(dense.slice(0, 19_990)), a('the invoice is fine')] });
    const e = await run(h, [sess({ sessionId: 'dense' })], 'invoice');
    assert.deepStrictEqual([e.notes.bounded, hitsOf(h).length, hitsOf(h)[0]?.excerpts.map((x) => x.anchor.n)], [1, 1, [1]], 'the dense message is counted and shows nothing; the next message still matches');
    walk(h, 'dense');
  }

  // ---- review of PR 1098, finding 4: a reader that throws costs its session only (unreadable), the scan goes on
  {
    sid = 0;
    const h = harness({ good1: [u('deploy now')], good2: [a('the deploy is done')] });
    const real = h.deps.read;
    h.deps.read = async (s, stop) => { if (s.sessionId === 'bad') throw Object.assign(new Error('EIO'), { code: 'EIO' }); return real(s, stop); };
    const e = await run(h, [sess({ sessionId: 'bad', time: 30 }), sess({ sessionId: 'good1', time: 20 }), sess({ sessionId: 'good2', time: 10 })], 'deploy');
    assert.deepStrictEqual([e.failed, e.notes.unreadable, e.progress.done, hitsOf(h).map((x) => x.sessionId)], [false, 1, 3, ['good1', 'good2']]);
  }

  // ---- review of PR 1098, finding 5: masking that fails (not the budget) is counted, and nothing of it is shown
  {
    sid = 0;
    const broken = createMasker({ unhide: () => { throw new Error('safetext missing'); } });
    const h = harness({ m1: [u('deploy one'), a('deploy two')] }, { masker: broken });
    const e = await run(h, [sess({ sessionId: 'm1', title: 'deploy' })], 'deploy');
    assert.deepStrictEqual([e.failed, hitsOf(h).length, e.notes.maskFailed, e.notes.bounded], [false, 0, 3, 0], 'the title and both messages counted as mask failures, none shown');
  }

  // ---- review of PR 1098, finding 6: one cap for the readers and the scan, and a text cut at the cap without a `…` counts as cut
  {
    assert.strictEqual(SEARCH_HISTORY_LIMITS.maxTextChars, BUDGET.maxChars);
    assert.strictEqual(SEARCH_MAX_TEXT_CHARS, BUDGET.maxChars);
    sid = 0;
    const V = 'Tr0ub4dorXYZ99 correcthorsebattery';
    const fill = (n: number): string => { let t = ''; for (let i = 0; t.length < n; i++) t += 'w' + (i % 97) + ' '; return t.slice(0, n); };
    const pre = fill(20_000 - 24);
    const rawMsg = pre.slice(0, pre.length - 40) + ' invoice ' + pre.slice(pre.length - 31) + ' ' + V + ' tail';
    const h = harness({ bare: [u(rawMsg.slice(0, BUDGET.maxChars))] }, { values: () => [V] });
    await run(h, [sess({ sessionId: 'bare' })], 'invoice');
    assert.ok(!JSON.stringify(h.batches).includes('Tr0ub4dor'), 'a bare slice at the cap keeps the guard at its end');
  }

  // ---- review of PR 1098, finding 7: the 60 s stop holds during a read (the reader asks `stop` between its lines)
  {
    sid = 0;
    const h = harness({});
    let sawStop = false;
    let linesRead = 0;
    h.deps.read = async (_s, stop) => {
      for (let i = 0; i < 1000; i++) { h.clock.t += 100; linesRead++; if (stop()) { sawStop = true; break; } await Promise.resolve(); }
      return { ok: true, items: [u('match')] };
    };
    const e = await run(h, [sess({ sessionId: 'slow' }), sess({ sessionId: 'next' })], 'match');
    assert.ok(sawStop && e.notes.timedOut && linesRead <= 601, `the read stopped at 60 s (${linesRead} lines of 100 ms)`);
  }

  // ---- review of PR 1098, finding 8: cancel stops a read in progress (the reader's `stop` turns true)
  {
    sid = 0;
    const h = harness({});
    let stopSeen = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    let started!: () => void;
    const inRead = new Promise<void>((r) => { started = r; });
    h.deps.read = async (_s, stop) => { started(); await gate; stopSeen = stop(); return { ok: true, items: [u('match')] }; };
    const scan = startScan({ sessions: [sess({ sessionId: 'r1' })] }, 'match', h.deps);
    await inRead;
    scan.cancel();
    release();
    const e = await scan.done;
    assert.ok(e.cancelled && stopSeen, 'the reader is told to stop after a cancel');
    // (no case for the `cancelled` check in `flush`: every flush follows a cancel check with no await between, so a cancel, which arrives
    // only during an await, never reaches it; the check stays as defence. The `nothing emitted after cancel` case below covers the outcome.)
  }

  // ---- cancel between sessions and between messages; nothing emitted after it; no transcript kept (each read once, no cache across scans)
  {
    sid = 0;
    const items: Record<string, HistoryItem[]> = {};
    const list = Array.from({ length: 30 }, (_, i) => { const s = sess({ sessionId: `c${i}` }); items[s.sessionId] = Array.from({ length: 200 }, (_, k) => u(`message ${k} word`)); return s; });
    let handle: { cancel(): void } | undefined;
    let yields = 0;
    let readsAtCancel = -1;
    let masksAtCancel = -1;
    const h = harness(items, { onYield: () => { if (++yields === 5) { readsAtCancel = h.reads.length; masksAtCancel = h.work.masks; handle!.cancel(); } } });
    const scan = startScan({ sessions: list }, 'word', h.deps);
    handle = scan;
    const batchesAtStart = h.batches.length;
    const e = await scan.done;
    assert.ok(e.cancelled, 'cancelled');
    assert.strictEqual(h.reads.length, readsAtCancel, 'cancel between sessions: no further read');
    assert.ok(masksAtCancel > 0 && h.work.masks === masksAtCancel, `cancel between messages: no message of the session being read is matched after it (${masksAtCancel} -> ${h.work.masks})`);
    assert.ok(e.progress.done < list.length);
    const n = h.batches.length;
    await new Promise<void>((r) => setImmediate(r));
    assert.strictEqual(h.batches.length, n, 'nothing emitted after cancel');
    assert.ok(n >= batchesAtStart);
    // two scans one after the other read every session again: no cache of conversation text between queries
    sid = 0;
    const h2 = harness({ k1: [u('alpha')], k2: [u('beta')] });
    await run(h2, [sess({ sessionId: 'k1' }), sess({ sessionId: 'k2' })], 'alpha');
    await run(h2, [sess({ sessionId: 'k1' }), sess({ sessionId: 'k2' })], 'alpha');
    assert.deepStrictEqual(h2.reads, ['k1', 'k2', 'k1', 'k2'], 'each session read once per scan, again on the next scan');
  }

  // ---- slices: the scan yields within its budget on the fake clock
  {
    sid = 0;
    const items: Record<string, HistoryItem[]> = {};
    const list = Array.from({ length: 20 }, (_, i) => { const s = sess({ sessionId: `y${i}` }); items[s.sessionId] = Array.from({ length: 300 }, (_, k) => a(`reply ${k} with the target word inside ${'pad '.repeat(k % 50)}`)); return s; });
    const h = harness(items);
    await run(h, list, 'target');
    assert.ok(h.slices.length > 10, `it yields (${h.slices.length})`);
    const longest = Math.max(...h.slices);
    assert.ok(longest < 50, `longest slice ${longest.toFixed(1)} ms of the fake clock < 50`);
  }

  // ---- FR-023: one Codex thread/read at a time across scans; a read in flight is shared
  {
    const gate = createReadGate<ReadOutcome>();
    let live = 0;
    let maxLive = 0;
    const started: string[] = [];
    const codexRead = (id: string) => gate.run(id, async () => {
      started.push(id);
      live++;
      maxLive = Math.max(maxLive, live);
      await new Promise<void>((r) => setTimeout(r, 5));
      live--;
      return { ok: true, items: [u('codex invoice')] };
    });
    sid = 0;
    const hs = [harness({}), harness({}), harness({})];
    for (const h of hs) h.deps.read = (s) => codexRead(s.sessionId);
    const cx = (id: string) => sess({ sessionId: id, adapter: 'codex', group: 'office' });
    const s1 = startScan({ sessions: [cx('cx1'), cx('cx2')] }, 'invoice', hs[0].deps);
    // wait (bounded, on a condition) until the first scan's read is in flight, then type again: two new scans, the first is cancelled
    for (let i = 0; i < 1000 && !started.length; i++) await new Promise<void>((r) => setImmediate(r));
    assert.deepStrictEqual(started, ['cx1'], 'the first read is in flight');
    const s2 = startScan({ sessions: [cx('cx2'), cx('cx1')] }, 'invoice', hs[1].deps); // another session: must wait for the read in flight
    const s3 = startScan({ sessions: [cx('cx1')] }, 'invoice', hs[2].deps); // the same session: must reuse it
    s1.cancel();
    await Promise.all([s1.done, s2.done, s3.done]);
    assert.strictEqual(maxLive, 1, 'never two Codex reads at once, across scans');
    assert.deepStrictEqual(started, ['cx1', 'cx2', 'cx1'], `the read in flight was reused by the third scan, not started again (${started.join(',')})`);
    assert.strictEqual(gate.inFlight(), 0, 'no read result kept after it settled');
    assert.deepStrictEqual([hitsOf(hs[1]).length, hitsOf(hs[2]).length], [2, 1]);
    assert.strictEqual(hitsOf(hs[0]).length, 0, 'the cancelled scan emitted no hits');
  }

  // ---- T017: the scan path's sources import no network API, no child_process, write nothing, call no *Sync fs function, log nothing
  {
    const files = ['src/main/convsearch.ts', 'src/main/convmask.ts', 'src/adapters/claudeStream.ts'];
    let imports = 0;
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const lines = text.split(/\r?\n/);
      const code = lines.filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      const mods = [...code.matchAll(/(?:from\s+|require\()\s*'([^']+)'/g)].map((m) => m[1]);
      imports += mods.length;
      for (const m of mods) assert.ok(['fs', 'path', 'readline', '../shared/redact', '../adapters/history', './convmask', './claudeHistory', './history'].includes(m), `${f}: unexpected import ${m}`);
      if (f !== 'src/adapters/claudeStream.ts') assert.ok(!mods.includes('fs') && !mods.includes('readline'), `${f}: no fs at all`);
      assert.ok(!/\b(?:https?|net|tls|dgram|dns|http2|child_process|electron|undici)\b['"]/.test(code), `${f}: no network or process module`);
      assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(code), `${f}: no network call`);
      assert.ok(!/\b\w+Sync\s*\(/.test(code), `${f}: no *Sync call`);
      assert.ok(!/\b(?:writeFile|appendFile|createWriteStream|mkdir|rmdir|unlink|rename|copyFile|truncate|chmod|symlink)\w*\s*\(|\bfs\.(?:promises\.)?open\w*\s*\(|\bopen\s*\(/.test(code.replace(/fs\.promises\.stat|createReadStream|createInterface/g, '')), `${f}: no fs write`);
      assert.ok(!/\bconsole\.|\blog\w*\s*\(|debugSink|DURBAR_LOG/.test(code), `${f}: no log call (the query is never logged)`);
      assert.ok(!/\bspawn|exec(?:File)?\s*\(/.test(code), `${f}: no process`);
    }
    assert.ok(imports >= 6, `the import scan saw the imports (${imports})`);
  }

  console.log('convsearch tests passed');
  process.exitCode = 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
