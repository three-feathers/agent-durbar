/**
 * Spec 095 T016 (US4, SC-003): the scan over a GENERATED corpus of more than 40 MB of fake Claude Code session files, read with the real
 * streamed reader (`claudeStream.ts`) and the real masker, on a fake clock (masking costs 1 ms per 1 000 characters, every clock read
 * 0.2 ms). Checks: the longest slice between yields stays under 50 ms of that clock; a cancel lands within one slice; the live heap (after
 * a forced GC) stays under 64 MB above the start, also while the 45 MB file is read, so the file is never held whole; nothing is kept after
 * the scan (and the process's peak resident memory grows less than 64 MB, which a synchronous whole-file read would break). Part of `npm run test:convsearch`. No credits, no network; the temp folder is removed at the end.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as v8 from 'v8';
import * as vm from 'vm';
import { SEARCH_HISTORY_LIMITS } from '../src/adapters/history';
import { claudeProjectSlug } from '../src/adapters/claudeHistory';
import { readClaudeHistoryStream } from '../src/adapters/claudeStream';
import { createMasker } from '../src/main/convmask';
import type { Masker } from '../src/main/convmask';
import { rendererScript, startScan } from '../src/main/convsearch';
import type { PlanSession, ScanBatch, ScanDeps, SessionSearchApi } from '../src/main/convsearch';

process.exitCode = 1;
v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;
const ROOT = ((): string => {
  for (let d = __dirname; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'package.json')) && fs.existsSync(path.join(d, 'src', 'renderer'))) return d;
    if (path.dirname(d) === d) throw new Error('repo root not found');
  }
})();
const S = rendererScript<SessionSearchApi>('sessionsearch.js', path.join(ROOT, 'src', 'main'));
const ST = rendererScript<{ unhide(s: string): string }>('safetext.js', path.join(ROOT, 'src', 'main'));
const MASKER = createMasker({ unhide: (s) => ST.unhide(s) });
const GHP = 'gh' + 'p_' + 'Qw3Er4Ty5Ui6Op7As8Df9Gh0Jk1Lz2Xc3Vb4Nm';

const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-095-corpus-'));
const WS = path.join(CFG, 'work folder');
const dir = path.join(CFG, 'projects', claudeProjectSlug(WS));
fs.mkdirSync(dir, { recursive: true });
const J = JSON.stringify;
const id = (i: number): string => `95000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const line = (type: 'user' | 'assistant', content: unknown): string => J({ type, cwd: WS, timestamp: '2026-10-19T10:00:00.000Z', message: { role: type, content } });

/** The corpus: one 45 MB file of mostly tool output (a few prompts and replies), and 24 files of about 0.5 MB of text messages. */
function write(): { bytes: number; sessions: PlanSession[]; needles: Set<string> } {
  let bytes = 0;
  const sessions: PlanSession[] = [];
  const needles = new Set<string>();
  const big = fs.openSync(path.join(dir, `${id(0)}.jsonl`), 'w');
  const chunk = 'tool output line with words '.repeat(2300); // about 64 KB
  bytes += fs.writeSync(big, line('user', 'please look at the needle in the big log') + '\n');
  for (let k = 0; bytes < 45 * 1024 * 1024; k++) {
    bytes += fs.writeSync(big, line('assistant', [{ type: 'tool_use', id: `t${k}`, name: 'Bash', input: { command: 'cat log' } }]) + '\n');
    bytes += fs.writeSync(big, line('user', [{ type: 'tool_result', tool_use_id: `t${k}`, content: 'needle ' + chunk }]) + '\n');
    if (k % 100 === 0) bytes += fs.writeSync(big, line('assistant', [{ type: 'text', text: `reply ${k} about the needle and ${GHP} nearby` }]) + '\n');
  }
  fs.closeSync(big);
  sessions.push({ adapter: 'claude', app: 'Claude Code', folderKey: WS, folderName: 'work folder', sessionId: id(0), group: 'earlier', title: 'Big log', time: 100, content: 'read' });
  needles.add(id(0));
  for (let i = 1; i <= 24; i++) {
    const out: string[] = [];
    for (let k = 0; k < 250; k++) {
      const pad = 'some ordinary words of a long conversation about code '.repeat(36);
      const hit = i % 3 === 0 && k === 200 ? ` the needle is here, see /home/someone/x and x**${GHP}** ` : '';
      out.push(line(k % 2 ? 'assistant' : 'user', k % 2 ? [{ type: 'text', text: pad + hit }] : pad + hit));
    }
    const text = out.join('\n') + '\n';
    bytes += Buffer.byteLength(text);
    fs.writeFileSync(path.join(dir, `${id(i)}.jsonl`), text);
    sessions.push({ adapter: 'claude', app: 'Claude Code', folderKey: WS, folderName: 'work folder', sessionId: id(i), group: 'earlier', title: `Session ${i}`, time: 100 - i, content: 'read' });
    if (i % 3 === 0) needles.add(id(i));
  }
  return { bytes, sessions, needles };
}

interface Run { slices: number[]; batches: ScanBatch[]; peak: number; clock: { t: number }; deps: ScanDeps; reads: number }
function harness(base: number, onYield?: (n: number) => void): Run {
  const clock = { t: 0 };
  const r: Run = { slices: [], batches: [], peak: 0, clock, deps: undefined as unknown as ScanDeps, reads: 0 };
  let last = 0;
  let yields = 0;
  const sample = (): void => { gc(); r.peak = Math.max(r.peak, process.memoryUsage().heapUsed - base); };
  const masker: Masker = {
    maskText: (raw, v) => { clock.t += raw.length / 1000; return MASKER.maskText(raw, v); },
    maskedWindow: (raw, f, t, v, w) => { const m = MASKER.maskedWindow(raw, f, t, v, w); clock.t += m.text.length / 1000; return m; },
  };
  r.deps = {
    now: () => (clock.t += 0.2),
    yieldNow: async () => {
      r.slices.push(clock.t - last);
      if (++yields % 25 === 0) sample();
      onYield?.(yields);
      await new Promise<void>((res) => setImmediate(res));
      last = clock.t;
    },
    sleep: async (ms) => { clock.t += ms; last = clock.t; },
    read: async (s, stop) => {
      r.reads++;
      // live heap sampled WHILE the file streams in: the 45 MB file must never be held whole
      const timer = setInterval(sample, 40);
      try {
        const res = await readClaudeHistoryStream(s.sessionId, WS, SEARCH_HISTORY_LIMITS, path.join(CFG), { stop });
        return res.ok ? { ok: true, items: res.history.items } : res;
      } finally {
        clearInterval(timer);
        sample();
        last = clock.t;
      }
    },
    values: () => [],
    masker,
    search: S,
    emit: (b) => r.batches.push(JSON.parse(JSON.stringify(b)) as ScanBatch),
  };
  return r;
}

async function main(): Promise<void> {
  const { bytes, sessions, needles } = write();
  assert.ok(bytes > 40 * 1024 * 1024, `a corpus over 40 MB (${(bytes / 1048576).toFixed(1)} MB)`);
  gc();
  const base = process.memoryUsage().heapUsed;
  const rss0 = process.resourceUsage().maxRSS; // KB, the process's peak so far (a synchronous whole-file read would raise it; the heap sampler cannot run during one)

  // the whole scan
  const r = harness(base);
  const end = await startScan({ sessions, platform: process.platform }, 'needle', r.deps).done;
  const rssGrowth = (process.resourceUsage().maxRSS - rss0) * 1024;
  assert.ok(rssGrowth < 64 * 1024 * 1024, `peak resident memory grew ${(rssGrowth / 1048576).toFixed(1)} MB during the scan, under 64 MB`);
  const hits = r.batches.flatMap((b) => b.hits);
  assert.deepStrictEqual(new Set(hits.map((h) => h.sessionId)), needles, 'every session with the word, and only those');
  assert.ok(!end.cancelled && !end.failed && end.progress.done === sessions.length);
  const longest = Math.max(...r.slices);
  assert.ok(r.slices.length > 20, `it yields (${r.slices.length} slices)`);
  assert.ok(longest < 50, `longest slice ${longest.toFixed(1)} ms of the fake clock, under 50`);
  assert.ok(r.peak < 64 * 1024 * 1024, `live heap at most ${(r.peak / 1048576).toFixed(1)} MB above the start, under 64 MB`);
  for (const h of hits) for (const e of h.excerpts) assert.ok(!e.text.includes('Qw3Er4Ty') && !e.text.includes('/home/'), `masked: ${e.text}`);
  const big = hits.find((h) => h.sessionId === id(0))!;
  assert.ok(big.excerpts.every((e) => !e.text.includes('tool output line')), 'the big file\'s tool output is never searched');

  // nothing kept: after the scan the heap is back near the start (the hits hold excerpts only)
  r.batches.length = 0;
  gc();
  const after = process.memoryUsage().heapUsed - base;
  assert.ok(after < 16 * 1024 * 1024, `nothing kept after the scan (${(after / 1048576).toFixed(1)} MB above the start)`);

  // cancelled within one slice: cancel at the 3rd yield, then no new read and the scan ends within 50 ms of the fake clock
  let handle: { cancel(): void } | undefined;
  let at = -1;
  let readsAt = -1;
  const c = harness(base, (n) => { if (n === 3) { at = c.clock.t; readsAt = c.reads; handle!.cancel(); } });
  const scan = startScan({ sessions, platform: process.platform }, 'needle', c.deps);
  handle = scan;
  const ce = await scan.done;
  assert.ok(ce.cancelled && at >= 0, 'cancelled');
  assert.strictEqual(c.reads, readsAt, 'no read starts after the cancel');
  assert.ok(c.clock.t - at < 50, `ended ${(c.clock.t - at).toFixed(1)} ms of the fake clock after the cancel`);

  console.log(`convsearch corpus: ${(bytes / 1048576).toFixed(1)} MB, ${r.slices.length} slices, longest ${longest.toFixed(1)} ms (fake clock), peak live heap ${(r.peak / 1048576).toFixed(1)} MB above start, peak RSS +${(rssGrowth / 1048576).toFixed(1)} MB`);
  console.log('convsearch corpus tests passed');
  process.exitCode = 0;
}
main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => fs.rmSync(CFG, { recursive: true, force: true }));
