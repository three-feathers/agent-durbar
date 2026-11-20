/**
 * Spec 095 (search conversations), phase 1: the pure core of the scan in main. No Electron, no IPC, no fs, no network, no log: the readers,
 * the clock, the yield, the masker and the sink are injected (phase 2 wires them). One session is read at a time; its text is matched,
 * masked, cut into excerpts and released before the next one (A1: no transcript is kept). What leaves here is a `ScanHit`: ids, the masked
 * title, the folder's display name, times and masked excerpts (FR-031); never a path or raw text.
 *
 * Matching (FR-040) reuses the window's own `DurbarSessionSearch` (`fold`, `terms`, `locate`, `anchorKey`), loaded by main from the built
 * tree (T010: `dist/renderer/sessionsearch.js` ships next to `dist/main`, as `profileeditor.js` does for `profiles:generate`).
 * Masking (FR-030) runs BEFORE any cut: on a window around a raw hit (`convmask.ts`), then the words are looked for again in the masked
 * window and a hit the mask removed is dropped (A2). An excerpt is cut only well inside the window (`edgeGuard`), else the whole message is
 * masked; a mask that throws drops the hit (fail closed).
 */
import * as path from 'path';
import type { HistoryItem } from '../adapters/history';
import { SEARCH_MAX_TEXT_CHARS, normDir } from '../adapters/history';
import { MASK_CALL_WORK, MaskBudgetError } from './convmask';
import type { MaskedWindow, Masker } from './convmask';

/** FR-022 budgets and FR-011 / FR-013 / FR-031 sizes: the one place for them. */
export const BUDGET = {
  sliceMs: 15,
  batchMs: 250,
  batchHits: 20,
  maxSessions: 400,
  perFolder: 200,
  /** The readers' cap (`SEARCH_MAX_TEXT_CHARS`, one constant). */
  maxChars: SEARCH_MAX_TEXT_CHARS,
  maxMs: 60_000,
  maxResults: 200,
  excerptTarget: 140,
  excerptChars: 180,
  maxExcerpts: 3,
  edgeGuard: 200,
  headChars: 60,
  triesPerWord: 8,
  /** Window radii tried in turn around a hit (then the whole message), so a window grows only as far as the edge guard needs. */
  radii: [600, 1_800],
  /** Review finding 4: the most the masks of one message may cost together (`maskWork`, estimated microseconds). Over it, the message shows nothing and is counted. */
  messageWork: 25_000,
} as const;

/** The parts of DurbarSessionSearch (`src/renderer/sessionsearch.js`) the scan uses. */
export interface SessionSearchApi {
  fold(s: unknown): string;
  terms(q: string): string[];
  locate(text: unknown, query: string, max?: number): Array<{ start: number; end: number; term: number }>;
  /** Issue 1904: `locate` with each range's place in its word (0 whole word, 1 word start, 2 inside), best first. */
  locateRanked(text: unknown, query: string, max?: number): Array<{ start: number; end: number; term: number; tier: number }>;
  /** Issue 1904: the best place of each query word in `text` (3: the word is not there). */
  bestTiers(text: unknown, query: string): number[];
  anchorKey(t: unknown): string;
}

/**
 * T010: a pure window script, required by main from the built tree (`<dist>/main/..` + `/renderer/<name>`; packaged in `app.asar` with the
 * rest of `dist/**`). One source of truth: main runs the very file the window runs, so the fold cannot drift. Only these three names (`liveact.js`: the activity log's mask, `src/main/activitymask.ts`).
 */
export function rendererScript<T>(name: 'sessionsearch.js' | 'safetext.js' | 'liveact.js', baseDir: string = __dirname): T {
  if (name !== 'sessionsearch.js' && name !== 'safetext.js' && name !== 'liveact.js') throw new Error('not a shared window script');
  return require(path.join(baseDir, '..', 'renderer', name)) as T;
}

export type Speaker = 'you' | 'agent' | 'title';
export interface Excerpt {
  /** Masked, at most `excerptChars` characters, with `…` where it was cut. */
  text: string;
  /** [start, end) of every query word found in `text`. */
  marks: Array<[number, number]>;
  speaker: Speaker;
  /** FR-013: `n` = ordinal among the text messages; `head` = the first 60 characters of `anchorKey` of the MASKED message. */
  anchor: { n: number; head: string };
}

export interface PlanSession {
  /** Adapter id (`copilot`, `claude`, `codex`) or `vscode`. */
  adapter: string;
  /** App name for notes ("Codex"). */
  app: string;
  /** The folder (main only: deduplication and per-folder caps; never sent). */
  folderKey: string;
  /** What the row shows for the folder (a name, never a path). */
  folderName: string;
  sessionId: string;
  agentId?: string;
  group: 'office' | 'earlier';
  /** The user's name for the session (spec 059) or its title. */
  title: string;
  /** Last active, ms. */
  time: number;
  /** `title`: searched by title only (earlier Copilot and Codex sessions, Q4 and review question B). */
  content: 'read' | 'title';
  helper?: boolean;
  floorOff?: boolean;
  hidden?: boolean;
}

export interface ScanPlan {
  sessions: readonly PlanSession[];
  /** Apps whose sessions could not be listed ("Codex (not installed)"), said once in the end state. */
  unavailable?: readonly string[];
  platform?: NodeJS.Platform;
}

/** `timeout` (issue 1904): the read did not answer within its own limit (`SEARCH_READ_MS`): skipped and counted. */
export type ReadOutcome = { ok: true; items: readonly HistoryItem[] } | { ok: false; reason: 'too-large' | 'unreadable' | 'missing' | 'timeout' };

export interface ScanHit {
  adapter: string;
  sessionId: string;
  agentId?: string;
  group: 'office' | 'earlier';
  app: string;
  folderName: string;
  /** Masked. */
  title: string;
  titleMarks: Array<[number, number]>;
  time: number;
  excerpts: Excerpt[];
  /** Hits not shown ("+N more"). */
  more: number;
  /** Issue 1904 (FR-040): 0 every query word occurs as a whole word, 1 as a word start at worst, 2 inside a word at worst. */
  rank: 0 | 1 | 2;
}

export interface ScanProgress {
  done: number;
  total: number;
}

export interface ScanBatch {
  hits: ScanHit[];
  progress: ScanProgress;
  /** Sessions found so far per group. */
  groups: { office: number; earlier: number };
}

export interface ScanNotes {
  searched: number;
  folders: number;
  notInstalled: string[];
  tooLarge: number;
  unreadable: number;
  /** Issue 1904 (FR-022): sessions whose read did not answer within its own limit. */
  slow: number;
  titleOnly: { count: number; apps: string[] };
  hidden: number;
  floorsOff: number;
  capped: { sessions: boolean; perFolder: boolean; results: boolean };
  timedOut: boolean;
  /** Messages searched only in their first 20 000 characters, in sessions that did not match. */
  cut: number;
  /** Review finding 4: messages whose masks would cost more than `messageWork`: nothing of them is shown (fail closed). */
  bounded: number;
  /** Review of PR 1098, finding 5: messages (and titles) whose masking failed: nothing of them is shown (fail closed, and said). */
  maskFailed: number;
}

export interface ScanEnd {
  cancelled: boolean;
  failed: boolean;
  notes: ScanNotes;
  progress: ScanProgress;
}

export interface ScanDeps {
  /** A monotonic clock, ms. */
  now(): number;
  /** Give the event loop a turn (setImmediate in main). */
  yieldNow(): Promise<void>;
  /** Wait (setTimeout in main): only to keep 250 ms between the last batches. */
  sleep(ms: number): Promise<void>;
  /** The text history of one session, through the existing readers (text only). `stop` says the scan no longer wants it. */
  read(s: PlanSession, stop: () => boolean): Promise<ReadOutcome>;
  /** FR-030: the MCP secret values to mask this session with (`scanSecretValues`). */
  values(s: PlanSession): readonly string[];
  masker: Masker;
  search: SessionSearchApi;
  emit(b: ScanBatch): void;
  /** FR-054: the title rows already sent while the plan was built (`createEarlyTitles`). */
  early?: EarlyTitles;
}

const isWs = (c: number): boolean => c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x2028 || c === 0x2029 || c === 0x3000 || (c >= 0x2000 && c <= 0x200a);
const isLow = (s: string, i: number): boolean => i > 0 && i < s.length && /[\uDC00-\uDFFF]/.test(s[i]) && /[\uD800-\uDBFF]/.test(s[i - 1]);

/** The bounds of an excerpt of `m` around [ms, me): about `excerptTarget` characters, the match centred, cut at whitespace. */
function bounds(m: string, ms: number, me: number): [number, number] {
  const T = BUDGET.excerptTarget;
  if (me - ms >= BUDGET.excerptChars - 2) {
    let e = ms + BUDGET.excerptChars - 2;
    if (isLow(m, e)) e--;
    return [ms, e];
  }
  const pad = Math.floor((T - (me - ms)) / 2);
  let s = Math.max(0, ms - pad);
  let e = Math.min(m.length, me + pad);
  const room = T - (e - s);
  if (room > 0) {
    s = Math.max(0, s - room);
    e = Math.min(m.length, s + T);
  }
  if (s > 0 && !isWs(m.charCodeAt(s - 1))) {
    let k = s;
    while (k < ms && !isWs(m.charCodeAt(k))) k++;
    s = k < ms ? k + 1 : ms;
  }
  if (e < m.length && !isWs(m.charCodeAt(e))) {
    let k = e;
    while (k > me && !isWs(m.charCodeAt(k - 1))) k--;
    e = k > me ? k - 1 : me;
  }
  return [s, e];
}

/** The excerpt text with its marks, from masked text only. */
function excerptOf(search: SessionSearchApi, m: string, s: number, e: number, query: string): { text: string; marks: Array<[number, number]>; terms: Set<number>; tiers: Map<number, number> } {
  const text = (s > 0 ? '…' : '') + m.slice(s, e).replace(/\s+/g, ' ') + (e < m.length ? '…' : '');
  const marks: Array<[number, number]> = [];
  const terms = new Set<number>();
  for (const r of search.locate(text, query)) {
    marks.push([r.start, r.end]);
    terms.add(r.term);
  }
  const tiers = new Map<number, number>();
  search.bestTiers(text, query).forEach((t, i) => { if (terms.has(i)) tiers.set(i, t); });
  return { text, marks, terms, tiers };
}

/** An excerpt of the masked text `m` for word `term`, cut at least `edgeGuard` characters inside an edge where raw context was left out. */
function cutIn(search: SessionSearchApi, m: string, atStart: boolean, atEnd: boolean, term: number, query: string): ReturnType<typeof excerptOf> | 'grow' | undefined {
  let near = false;
  for (const r of search.locateRanked(m, query)) { // issue 1904: the word's best place first (whole word, word start, inside)
    if (r.term !== term) continue;
    if (r.end - r.start >= BUDGET.excerptChars - 2) {
      // a match longer than an excerpt (review of PR 1098): its start, cut on a code point, marked to the cut, then `…`
      if ((!atStart && r.start < BUDGET.edgeGuard) || (!atEnd && r.start + BUDGET.excerptChars > m.length - BUDGET.edgeGuard)) { near = true; continue; }
      const [s, e] = bounds(m, r.start, r.end);
      const lead = s > 0 ? '…' : '';
      const body = m.slice(s, e); // at most excerptChars - 2, on a code point (`bounds`): with both marks, within excerptChars
      return { text: lead + body + '…', marks: [[lead.length, lead.length + body.length]], terms: new Set([term]), tiers: new Map([[term, r.tier]]) };
    }
    const [s, e] = bounds(m, r.start, r.end);
    if ((!atStart && s < BUDGET.edgeGuard) || (!atEnd && e > m.length - BUDGET.edgeGuard)) { near = true; continue; }
    return excerptOf(search, m, s, e, query);
  }
  return near ? 'grow' : undefined; // 'grow': found only near an edge, a wider window may do; undefined: masked away (A2)
}

/** What the scan keeps beside an excerpt (never sent): the words it holds, the best place of each in its word, and the word it was built for. */
type Ranked = { terms: Set<number>; tiers: Map<number, number>; tier: number; forTerm: number };

const headOf = (search: SessionSearchApi, masked: string): string => [...search.anchorKey(masked)].slice(0, BUDGET.headChars).join('');

/**
 * T014: the excerpts of one message for `query`, from masked text only. Raw hits (on the folded raw text) only choose where to mask; each
 * word is confirmed in the masked window (A2) or not at all. A window grows (`radii`, then the whole message) only while the edge guard
 * fails. `cutEnd`: the reader cut the message, so its end is not the message's own edge (review finding 3: the guard holds there too).
 * Undefined when no word is in the raw text. Throws when masking fails, and `MaskBudgetError` when the message's masks would cost more than
 * `messageWork`: the caller then drops the whole message (fail closed).
 */
export function messageExcerpts(
  raw: string,
  query: string,
  o: { n: number; speaker: Speaker; values: readonly string[]; masker: Masker; search: SessionSearchApi; cutEnd?: boolean },
): { excerpts: Array<Excerpt & Ranked>; confirmed: Set<number> } | undefined {
  const { search, masker } = o;
  const words = [...new Set(search.terms(query))];
  const f = search.fold(raw);
  if (!words.some((w) => f.includes(w))) return undefined;
  const confirmed = new Set<number>();
  const out: Array<Excerpt & Ranked> = [];
  const tries = new Map<number, number>();
  let spent = 0;
  const mask = (from: number, to: number, opt: { whole?: boolean; radius?: number }): MaskedWindow => {
    const left = BUDGET.messageWork - spent;
    if (left <= 0) throw new MaskBudgetError();
    const w = masker.maskedWindow(raw, from, to, o.values, { ...opt, budget: Math.min(MASK_CALL_WORK, left) });
    spent += w.work;
    return { ...w, atEnd: w.atEnd && !o.cutEnd };
  };
  let whole: MaskedWindow | undefined;
  const wholeOf = (): MaskedWindow => (whole ??= mask(0, raw.length, { whole: true }));
  /** The masked windows around [from, to), smallest first, while `ok` says 'grow' (the edge guard failed); then the whole message. */
  const grow = <T>(from: number, to: number, ok: (w: MaskedWindow) => T | 'grow' | undefined): T | undefined => {
    const done = (r: T | 'grow' | undefined): T | undefined => (r === 'grow' ? undefined : r);
    if (whole) return done(ok(whole));
    for (const radius of BUDGET.radii) {
      const w = mask(from, to, { radius });
      const r = ok(w);
      if (r !== 'grow' || (w.atStart && w.atEnd)) return done(r);
    }
    return done(ok(wholeOf()));
  };
  let head: string | undefined;
  for (const r of search.locateRanked(raw, query, 64)) { // issue 1904: each word's best occurrence first, so the excerpt is the whole word before the in-word hit
    if (confirmed.has(r.term)) continue;
    const t = tries.get(r.term) ?? 0;
    if (t >= BUDGET.triesPerWord) continue;
    tries.set(r.term, t + 1);
    const ex = grow(r.start, r.end, (w) => cutIn(search, w.text, w.atStart, w.atEnd, r.term, query));
    // cutIn picked an occurrence of this word in the masked text, so `terms` holds it; the check stays as the A2 rule in one line (the excerpt's own marks must show the word)
    if (!ex || !ex.terms.has(r.term)) continue; // the mask removed this occurrence (A2)
    // the head: the first 60 characters of the masked message's key, from a start window that reaches well past them (masks shrink text)
    head ??= grow(0, 0, (w) => (w.atEnd || w.text.length >= BUDGET.headChars + BUDGET.edgeGuard ? headOf(search, w.text) : 'grow')) ?? headOf(search, wholeOf().text); // a cut message: its start is far from the cut
    for (const x of ex.terms) confirmed.add(x);
    out.push({ text: ex.text, marks: ex.marks, speaker: o.speaker, anchor: { n: o.n, head }, terms: ex.terms, tiers: ex.tiers, tier: ex.tiers.get(r.term) ?? r.tier, forTerm: r.term });
  }
  return { excerpts: out, confirmed };
}

/** The identity of a planned session: one row per (app, folder, session). */
export const sessionKey = (s: PlanSession, platform: NodeJS.Platform = process.platform): string => `${s.adapter}\0${normDir(String(s.folderKey), platform)}\0${s.sessionId}`;

/** The sessions to scan, in scan order (FR-020), with what is left out counted. */
export function orderPlan(plan: ScanPlan): { list: PlanSession[]; notes: ScanNotes } {
  const platform = plan.platform ?? process.platform;
  const notes: ScanNotes = {
    searched: 0, folders: 0, notInstalled: [...new Set((plan.unavailable ?? []).map(String))], tooLarge: 0, unreadable: 0, slow: 0,
    titleOnly: { count: 0, apps: [] }, hidden: 0, floorsOff: 0, capped: { sessions: false, perFolder: false, results: false }, timedOut: false, cut: 0, bounded: 0, maskFailed: 0,
  };
  const seen = new Set<string>();
  const folderOrder: string[] = [];
  const byGroup: Record<'office' | 'earlier', Map<string, PlanSession[]>> = { office: new Map(), earlier: new Map() };
  for (const s of plan.sessions ?? []) {
    if (!s || s.helper) continue; // office helpers are not sessions of their own (FR-014: not a gap)
    if (s.floorOff) { notes.floorsOff++; continue; }
    if (s.hidden) { notes.hidden++; continue; }
    const fk = normDir(String(s.folderKey), platform);
    const key = sessionKey(s, platform);
    if (seen.has(key)) continue; // FR-020: two agents of one app in a folder list the same earlier sessions
    seen.add(key);
    if (!folderOrder.includes(fk)) folderOrder.push(fk);
    const m = byGroup[s.group === 'office' ? 'office' : 'earlier'];
    if (!m.has(fk)) m.set(fk, []);
    m.get(fk)!.push(s);
  }
  const list: PlanSession[] = [];
  for (const g of ['office', 'earlier'] as const) {
    for (const fk of folderOrder) {
      let ss = (byGroup[g].get(fk) ?? []).map((s, i) => ({ s, i })).sort((a, b) => (b.s.time || 0) - (a.s.time || 0) || a.i - b.i).map((x) => x.s);
      if (g === 'earlier' && ss.length > BUDGET.perFolder) { ss = ss.slice(0, BUDGET.perFolder); notes.capped.perFolder = true; }
      list.push(...ss);
    }
  }
  if (list.length > BUDGET.maxSessions) { list.length = BUDGET.maxSessions; notes.capped.sessions = true; }
  notes.folders = new Set(list.map((s) => normDir(String(s.folderKey), platform))).size;
  return { list, notes };
}

/** T022 (review of PR 1098): the longest a gated read may hold the gate; then it rejects and the next read runs (the hung one is left to end by itself). */
export const READ_GATE_TIMEOUT_MS = 20_000;

/**
 * One cross-scan gate for Codex calls (an open session's `thread/read`, a folder's `thread/list` probe; FR-023): one at a time across scans; a
 * read of the same key already in flight is shared, never started twice. The result is dropped as soon as the read settles (A1). A read
 * that does not settle within `timeoutMs` rejects (the scan counts its session as unreadable), so a hung `thread/read` cannot block the
 * reads of later scans. `run`'s own `timeoutMs` replaces it for one call (a call that may take longer, such as a whole probe). `wait` is the
 * timer (tests inject their own).
 */
export function createReadGate<T>(o: { timeoutMs?: number; wait?: (ms: number) => Promise<void> } = {}): { run(key: string, fn: () => Promise<T>, timeoutMs?: number): Promise<T>; inFlight(): number } {
  const ms = o.timeoutMs ?? READ_GATE_TIMEOUT_MS;
  const wait = o.wait ?? ((t: number) => new Promise<void>((r) => { const h = setTimeout(r, t); h.unref?.(); }));
  let tail: Promise<unknown> = Promise.resolve();
  const live = new Map<string, Promise<T>>();
  return {
    run(key, fn, timeoutMs) {
      const cur = live.get(key);
      if (cur) return cur;
      const p = tail.then(() => Promise.race([fn(), wait(timeoutMs ?? ms).then((): never => { throw new Error('read timed out'); })]));
      tail = p.catch(() => undefined);
      live.set(key, p);
      const drop = (): void => { if (live.get(key) === p) live.delete(key); };
      p.then(drop, drop);
      return p;
    },
    inFlight: () => live.size,
  };
}

/** FR-021: the masked title of a planned session, where the query words are in it, and the best place of each word (issue 1904). A throwing mask is no title hit (`failed`). */
function titleOf(s: PlanSession, query: string, d: Pick<ScanDeps, 'masker' | 'search'>, values: readonly string[], nWords: number): { title?: string; marks: Array<[number, number]>; confirmed: Set<number>; best: number[]; failed: boolean } {
  const marks: Array<[number, number]> = [];
  const confirmed = new Set<number>();
  const best: number[] = Array.from({ length: nWords }, () => 3);
  let title: string;
  try {
    title = d.masker.maskText(String(s.title ?? ''), values);
  } catch {
    return { marks, confirmed, best, failed: true };
  }
  for (const r of d.search.locate(title, query)) { marks.push([r.start, r.end]); confirmed.add(r.term); }
  d.search.bestTiers(title, query).forEach((t, i) => { if (t < best[i]) best[i] = t; });
  return { title, marks, confirmed, best, failed: false };
}
const rankOfBest = (best: readonly number[]): 0 | 1 | 2 => Math.min(2, Math.max(0, ...best)) as 0 | 1 | 2;

function hitOf(s: PlanSession, title: string | undefined, marks: Array<[number, number]>, excerpts: Excerpt[], more: number, rank: 0 | 1 | 2): ScanHit {
  return {
    adapter: s.adapter, sessionId: s.sessionId, ...(s.agentId ? { agentId: s.agentId } : {}), group: s.group === 'office' ? 'office' : 'earlier',
    app: s.app, folderName: s.folderName, title: title ?? 'Untitled session', titleMarks: title !== undefined ? marks : [], time: s.time, excerpts, more, rank,
  };
}

/** Spec 095 FR-054: the title rows already sent while the plan was being built; `startScan` skips the sessions in `emitted` in its own title pass. */
export interface EarlyTitles {
  emitted: Set<string>;
  groups: { office: number; earlier: number };
  /** The sessions the plan has so far (the open ones, then a folder's listing): their title hits go out at once, in batches of at most 20. */
  add(sessions: readonly PlanSession[]): void;
}

export function createEarlyTitles(query: string, d: Pick<ScanDeps, 'masker' | 'search' | 'values' | 'emit'> & { platform?: NodeJS.Platform }): EarlyTitles {
  const words = [...new Set(d.search.terms(query))];
  const emitted = new Set<string>();
  const seen = new Set<string>();
  const groups = { office: 0, earlier: 0 };
  return {
    emitted,
    groups,
    add(sessions) {
      if (!words.length) return;
      const out: ScanHit[] = [];
      for (const s of sessions) {
        if (!s || s.helper || s.floorOff || s.hidden || emitted.size >= BUDGET.maxResults) continue; // the same left-outs as `orderPlan`, which counts them
        const k = sessionKey(s, d.platform);
        if (seen.has(k)) continue;
        seen.add(k);
        let t: ReturnType<typeof titleOf>;
        try { t = titleOf(s, query, d, d.values(s), words.length); } catch { continue; }
        if (t.failed || t.confirmed.size < words.length) continue;
        emitted.add(k);
        groups[s.group === 'office' ? 'office' : 'earlier']++;
        out.push(hitOf(s, t.title, t.marks, [], 0, rankOfBest(t.best)));
      }
      for (let i = 0; i < out.length; i += BUDGET.batchHits) d.emit({ hits: out.slice(i, i + BUDGET.batchHits), progress: { done: 0, total: 0 }, groups: { ...groups } });
    },
  };
}

/** T015: the streamed scan. `cancel()` stops it before the next session or message; `done` always settles. */
export function startScan(plan: ScanPlan, query: string, deps: ScanDeps): { cancel(): void; done: Promise<ScanEnd> } {
  let cancelled = false;
  const done = run();
  return { cancel: () => { cancelled = true; }, done };

  async function run(): Promise<ScanEnd> {
    const { list, notes } = orderPlan(plan);
    const progress: ScanProgress = { done: 0, total: list.length };
    const emitted = deps.early?.emitted ?? new Set<string>();
    const groups = { office: deps.early?.groups.office ?? 0, earlier: deps.early?.groups.earlier ?? 0 };
    let flushes = 0;
    const queue: ScanHit[] = [];
    const started = deps.now();
    let sliceStart = started;
    let lastFlush = started - BUDGET.batchMs;
    let dirty = false;
    let stopped = false;
    const words = [...new Set(deps.search.terms(query))];
    const titleOnlyApps = new Set<string>();
    const end = (failed: boolean): ScanEnd => ({ cancelled, failed, notes: { ...notes, titleOnly: { count: notes.titleOnly.count, apps: [...titleOnlyApps] } }, progress: { ...progress } });
    const flush = (): void => {
      if (cancelled) return;
      deps.emit({ hits: queue.splice(0, BUDGET.batchHits), progress: { ...progress }, groups: { ...groups } });
      lastFlush = deps.now();
      dirty = queue.length > 0;
      flushes++;
    };
    // review of PR 1098, finding 7: the 60 s stop also holds during a read (a reader asks `halt` between its lines)
    const halt = (): boolean => {
      if (!cancelled && !stopped && deps.now() - started >= BUDGET.maxMs) { notes.timedOut = true; stopped = true; }
      return cancelled || stopped;
    };
    const tick = async (): Promise<void> => {
      const t = deps.now();
      if (t - started >= BUDGET.maxMs) { notes.timedOut = true; stopped = true; }
      if ((dirty || queue.length) && t - lastFlush >= BUDGET.batchMs) flush();
      if (t - sliceStart >= BUDGET.sliceMs) {
        await deps.yieldNow();
        sliceStart = deps.now();
      }
    };
    const keyOf = (s: PlanSession): string => sessionKey(s, plan.platform);
    if (!words.length) return end(false);
    try {
      // FR-054: the title pass first: every title is in the plan, no read; those rows go out at once, not held to the 250 ms spacing
      for (const s of list) {
        if (cancelled || emitted.size >= BUDGET.maxResults) break;
        const k = keyOf(s);
        if (emitted.has(k)) continue;
        let t: ReturnType<typeof titleOf>;
        try { t = titleOf(s, query, deps, deps.values(s), words.length); } catch { continue; } // counted in the content pass
        if (!t.failed && t.confirmed.size === words.length) {
          emitted.add(k);
          groups[s.group === 'office' ? 'office' : 'earlier']++;
          queue.push(hitOf(s, t.title, t.marks, [], 0, rankOfBest(t.best)));
          if (queue.length >= BUDGET.batchHits) flush();
        }
        if (deps.now() - sliceStart >= BUDGET.sliceMs) { await deps.yieldNow(); sliceStart = deps.now(); }
      }
      if (emitted.size >= BUDGET.maxResults) notes.capped.results = true;
      while (queue.length && !cancelled) flush();
      if (!cancelled && !flushes) deps.emit({ hits: [], progress: { ...progress }, groups: { ...groups } }); // the first batch tells the window the plan's total
      for (const s of list) {
        if (emitted.size >= BUDGET.maxResults && !emitted.has(keyOf(s))) { stopped = true; break; }
        await tick();
        if (halt()) break;
        const hit = await session(s);
        if (cancelled) break;
        progress.done++;
        dirty = true;
        if (!hit) continue;
        queue.push(hit);
        const k = keyOf(s);
        if (!emitted.has(k)) { emitted.add(k); groups[hit.group]++; if (emitted.size >= BUDGET.maxResults) { notes.capped.results = true; stopped = true; } }
      }
      while (queue.length && !cancelled) {
        const wait = BUDGET.batchMs - (deps.now() - lastFlush);
        if (wait > 0) await deps.sleep(wait);
        if (!cancelled) flush();
      }
      return end(false);
    } catch {
      return end(true);
    }

    async function session(s: PlanSession): Promise<ScanHit | undefined> {
      notes.searched++;
      if (s.content === 'title') { notes.titleOnly.count++; titleOnlyApps.add(String(s.app)); }
      let values: readonly string[];
      try {
        values = deps.values(s);
      } catch {
        notes.unreadable++; // no values, no masking: nothing of this session is searched (fail closed)
        return undefined;
      }
      // FR-021: the title is masked before it is matched; a throwing mask means no title hit
      const t = titleOf(s, query, deps, values, words.length);
      if (t.failed) notes.maskFailed++;
      const { title, marks: titleMarks, confirmed } = t;
      const best = t.best.slice(); // issue 1904: the best place of each word in the title or a shown message
      const titleDone = !t.failed && confirmed.size === words.length;
      const hit = (excerpts: Excerpt[], more: number): ScanHit => hitOf(s, title, titleMarks, excerpts, more, rankOfBest(best));
      if (titleDone && s.content === 'title') return undefined; // its row went out in the title pass
      if (s.content === 'title') return undefined;
      // review of PR 1098, finding 4: a reader that throws costs this session only (counted as unreadable), not the scan
      let r: ReadOutcome;
      try {
        r = await deps.read(s, halt);
      } catch {
        r = { ok: false, reason: 'unreadable' };
      }
      sliceStart = deps.now(); // the read awaited I/O: the loop had its turns
      if (cancelled) return undefined;
      if (!r.ok) {
        if (r.reason === 'too-large') notes.tooLarge++;
        else if (r.reason === 'unreadable') notes.unreadable++;
        else if (r.reason === 'timeout') notes.slow++; // issue 1904: skipped, counted, the scan goes on
        return undefined; // missing: the session ended or was deleted meanwhile
      }
      // issue 1904: the excerpts kept so far, at most `maxExcerpts` per word they were built for, the best place first (then the earliest message)
      const pool: Array<Excerpt & Ranked> = [];
      const better = (a: Excerpt & Ranked, b: Excerpt & Ranked): number => a.tier - b.tier || a.anchor.n - b.anchor.n;
      let total = 0;
      let n = -1;
      let cutHere = 0;
      for (const it of r.items) {
        if (it.type !== 'user' && it.type !== 'output') continue; // D2: tool output is never searched
        n++;
        await tick();
        if (halt()) break;
        let text = typeof it.text === 'string' ? it.text : '';
        // a reader cut it (with or without a `…`; finding 6: a text at the cap counts as cut): drop the token the cut may have split
        // (mask before cut), back to the last whitespace
        const cutEnd = text.length >= BUDGET.maxChars;
        if (cutEnd) {
          let k = BUDGET.maxChars;
          while (k > 0 && !isWs(text.charCodeAt(k - 1))) k--;
          text = text.slice(0, k);
          cutHere++;
        }
        let m: ReturnType<typeof messageExcerpts>;
        try {
          m = messageExcerpts(text, query, { n, speaker: it.type === 'user' ? 'you' : 'agent', values, masker: deps.masker, search: deps.search, cutEnd });
        } catch (e) {
          if (e instanceof MaskBudgetError) notes.bounded++;
          else notes.maskFailed++;
          continue; // masking failed or would cost too much: no hit from this message (fail closed, counted)
        }
        if (!m) continue;
        for (const x of m.confirmed) confirmed.add(x);
        for (const e of m.excerpts) {
          total++;
          e.tiers.forEach((t, w) => { if (t < best[w]) best[w] = t; });
          pool.push(e);
          const same = pool.filter((x) => x.forTerm === e.forTerm).sort(better);
          if (same.length > BUDGET.maxExcerpts) pool.splice(pool.indexOf(same[same.length - 1]), 1);
        }
      }
      if (cancelled || confirmed.size < words.length) {
        notes.cut += cutHere;
        return undefined;
      }
      const shown: Array<Excerpt & Ranked> = [];
      const reserve: Array<Excerpt & Ranked> = [];
      const shownWords = new Set<number>();
      for (const e of pool.sort(better)) {
        if (shown.length < BUDGET.maxExcerpts && [...e.terms].some((w) => !shownWords.has(w))) {
          shown.push(e);
          for (const w of e.terms) shownWords.add(w);
        } else reserve.push(e);
      }
      const chosen = shown.concat(reserve).slice(0, BUDGET.maxExcerpts).sort((a, b) => a.anchor.n - b.anchor.n);
      if (titleDone && !chosen.length) return undefined; // FR-054: its title row is shown already, and there is nothing to add
      return hit(chosen.map(({ terms: _t, tiers: _i, tier: _r, forTerm: _f, ...e }) => e), total - chosen.length);
    }
  }
}
