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
import { normDir } from '../adapters/history';
import type { Masker } from './convmask';

/** FR-022 budgets and FR-011 / FR-013 / FR-031 sizes: the one place for them. */
export const BUDGET = {
  sliceMs: 15,
  batchMs: 250,
  batchHits: 20,
  maxSessions: 400,
  perFolder: 200,
  maxChars: 20_000,
  maxMs: 60_000,
  maxResults: 200,
  excerptTarget: 140,
  excerptChars: 180,
  maxExcerpts: 3,
  edgeGuard: 200,
  headChars: 60,
  triesPerWord: 8,
} as const;

/** The parts of DurbarSessionSearch (`src/renderer/sessionsearch.js`) the scan uses. */
export interface SessionSearchApi {
  fold(s: unknown): string;
  terms(q: string): string[];
  locate(text: unknown, query: string, max?: number): Array<{ start: number; end: number; term: number }>;
  anchorKey(t: unknown): string;
}

/**
 * T010: a pure window script, required by main from the built tree (`<dist>/main/..` + `/renderer/<name>`; packaged in `app.asar` with the
 * rest of `dist/**`). One source of truth: main runs the very file the window runs, so the fold cannot drift. Only these two names.
 */
export function rendererScript<T>(name: 'sessionsearch.js' | 'safetext.js', baseDir: string = __dirname): T {
  if (name !== 'sessionsearch.js' && name !== 'safetext.js') throw new Error('not a shared window script');
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

export type ReadOutcome = { ok: true; items: readonly HistoryItem[] } | { ok: false; reason: 'too-large' | 'unreadable' | 'missing' };

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
  titleOnly: { count: number; apps: string[] };
  hidden: number;
  floorsOff: number;
  capped: { sessions: boolean; perFolder: boolean; results: boolean };
  timedOut: boolean;
  /** Messages searched only in their first 20 000 characters, in sessions that did not match. */
  cut: number;
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
function excerptOf(search: SessionSearchApi, m: string, s: number, e: number, query: string): { text: string; marks: Array<[number, number]>; terms: Set<number> } {
  const text = (s > 0 ? '…' : '') + m.slice(s, e).replace(/\s+/g, ' ') + (e < m.length ? '…' : '');
  const marks: Array<[number, number]> = [];
  const terms = new Set<number>();
  for (const r of search.locate(text, query)) {
    marks.push([r.start, r.end]);
    terms.add(r.term);
  }
  return { text, marks, terms };
}

/** An excerpt of the masked text `m` for word `term`, cut at least `edgeGuard` characters inside an edge where raw context was left out. */
function cutIn(search: SessionSearchApi, m: string, atStart: boolean, atEnd: boolean, term: number, query: string): ReturnType<typeof excerptOf> | undefined {
  for (const r of search.locate(m, query)) {
    if (r.term !== term) continue;
    const [s, e] = bounds(m, r.start, r.end);
    if ((!atStart && s < BUDGET.edgeGuard) || (!atEnd && e > m.length - BUDGET.edgeGuard)) continue;
    return excerptOf(search, m, s, e, query);
  }
  return undefined;
}

const headOf = (search: SessionSearchApi, masked: string): string => [...search.anchorKey(masked)].slice(0, BUDGET.headChars).join('');

/**
 * T014: the excerpts of one message for `query`, from masked text only. Raw hits (on the folded raw text) only choose where to mask; each
 * word is confirmed in the masked window (A2) or not at all. Undefined when no word is in the raw text; throws when masking fails (the
 * caller drops the message: fail closed).
 */
export function messageExcerpts(
  raw: string,
  query: string,
  o: { n: number; speaker: Speaker; values: readonly string[]; masker: Masker; search: SessionSearchApi },
): { excerpts: Array<Excerpt & { terms: Set<number> }>; confirmed: Set<number> } | undefined {
  const { search, masker } = o;
  const words = [...new Set(search.terms(query))];
  const f = search.fold(raw);
  if (!words.some((w) => f.includes(w))) return undefined;
  const confirmed = new Set<number>();
  const out: Array<Excerpt & { terms: Set<number> }> = [];
  const tries = new Map<number, number>();
  let whole: string | undefined;
  const wholeText = (): string => (whole ??= masker.maskedWindow(raw, 0, raw.length, o.values, true).text);
  let head: string | undefined;
  for (const r of search.locate(raw, query, 64)) {
    if (confirmed.has(r.term)) continue;
    const t = tries.get(r.term) ?? 0;
    if (t >= BUDGET.triesPerWord) continue;
    tries.set(r.term, t + 1);
    let ex = whole !== undefined ? cutIn(search, whole, true, true, r.term, query) : undefined;
    if (!ex && whole === undefined) {
      const w = masker.maskedWindow(raw, r.start, r.end, o.values);
      ex = cutIn(search, w.text, w.atStart, w.atEnd, r.term, query);
      if (!ex && !(w.atStart && w.atEnd)) ex = cutIn(search, wholeText(), true, true, r.term, query);
    }
    if (!ex || !ex.terms.has(r.term)) continue; // the mask removed this occurrence (A2)
    if (head === undefined) {
      if (whole !== undefined) head = headOf(search, whole);
      else {
        const w0 = masker.maskedWindow(raw, 0, 0, o.values);
        head = w0.atEnd || w0.text.length >= BUDGET.headChars + BUDGET.edgeGuard ? headOf(search, w0.text) : headOf(search, wholeText());
      }
    }
    for (const x of ex.terms) confirmed.add(x);
    out.push({ text: ex.text, marks: ex.marks, speaker: o.speaker, anchor: { n: o.n, head }, terms: ex.terms });
  }
  return { excerpts: out, confirmed };
}

/** The sessions to scan, in scan order (FR-020), with what is left out counted. */
export function orderPlan(plan: ScanPlan): { list: PlanSession[]; notes: ScanNotes } {
  const platform = plan.platform ?? process.platform;
  const notes: ScanNotes = {
    searched: 0, folders: 0, notInstalled: [...new Set((plan.unavailable ?? []).map(String))], tooLarge: 0, unreadable: 0,
    titleOnly: { count: 0, apps: [] }, hidden: 0, floorsOff: 0, capped: { sessions: false, perFolder: false, results: false }, timedOut: false, cut: 0,
  };
  const seen = new Set<string>();
  const folderOrder: string[] = [];
  const byGroup: Record<'office' | 'earlier', Map<string, PlanSession[]>> = { office: new Map(), earlier: new Map() };
  for (const s of plan.sessions ?? []) {
    if (!s || s.helper) continue; // office helpers are not sessions of their own (FR-014: not a gap)
    if (s.floorOff) { notes.floorsOff++; continue; }
    if (s.hidden) { notes.hidden++; continue; }
    const fk = normDir(String(s.folderKey), platform);
    const key = `${s.adapter}\0${fk}\0${s.sessionId}`;
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

/**
 * One cross-scan gate for reads that start a process (an open Codex session's `thread/read`, FR-023): one read at a time across scans; a
 * read of the same key already in flight is shared, never started twice. The result is dropped as soon as the read settles (A1).
 */
export function createReadGate<T>(): { run(key: string, fn: () => Promise<T>): Promise<T>; inFlight(): number } {
  let tail: Promise<unknown> = Promise.resolve();
  const live = new Map<string, Promise<T>>();
  return {
    run(key, fn) {
      const cur = live.get(key);
      if (cur) return cur;
      const p = tail.then(() => fn());
      tail = p.catch(() => undefined);
      live.set(key, p);
      const drop = (): void => { if (live.get(key) === p) live.delete(key); };
      p.then(drop, drop);
      return p;
    },
    inFlight: () => live.size,
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
    const groups = { office: 0, earlier: 0 };
    const queue: ScanHit[] = [];
    const started = deps.now();
    let sliceStart = started;
    let lastFlush = started - BUDGET.batchMs;
    let dirty = false;
    let stopped = false;
    let found = 0;
    const words = [...new Set(deps.search.terms(query))];
    const titleOnlyApps = new Set<string>();
    const end = (failed: boolean): ScanEnd => ({ cancelled, failed, notes: { ...notes, titleOnly: { count: notes.titleOnly.count, apps: [...titleOnlyApps] } }, progress: { ...progress } });
    const flush = (): void => {
      if (cancelled) return;
      deps.emit({ hits: queue.splice(0, BUDGET.batchHits), progress: { ...progress }, groups: { ...groups } });
      lastFlush = deps.now();
      dirty = queue.length > 0;
    };
    const halt = (): boolean => cancelled || stopped;
    const tick = async (): Promise<void> => {
      const t = deps.now();
      if (t - started >= BUDGET.maxMs) { notes.timedOut = true; stopped = true; }
      if ((dirty || queue.length) && t - lastFlush >= BUDGET.batchMs) flush();
      if (t - sliceStart >= BUDGET.sliceMs) {
        await deps.yieldNow();
        sliceStart = deps.now();
      }
    };
    if (!words.length) return end(false);
    try {
      for (const s of list) {
        await tick();
        if (halt()) break;
        const hit = await session(s);
        if (cancelled) break;
        progress.done++;
        dirty = true;
        if (!hit) continue;
        queue.push(hit);
        groups[hit.group]++;
        if (++found >= BUDGET.maxResults) { notes.capped.results = true; stopped = true; }
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
      let title: string | undefined;
      try {
        title = deps.masker.maskText(String(s.title ?? ''), values);
      } catch {
        title = undefined;
      }
      const titleMarks: Array<[number, number]> = [];
      const confirmed = new Set<number>();
      if (title !== undefined) for (const r of deps.search.locate(title, query)) { titleMarks.push([r.start, r.end]); confirmed.add(r.term); }
      const hit = (excerpts: Excerpt[], more: number): ScanHit => ({
        adapter: s.adapter, sessionId: s.sessionId, ...(s.agentId ? { agentId: s.agentId } : {}), group: s.group === 'office' ? 'office' : 'earlier',
        app: s.app, folderName: s.folderName, title: title ?? 'Untitled session', titleMarks: title !== undefined ? titleMarks : [], time: s.time, excerpts, more,
      });
      if (confirmed.size === words.length) return hit([], 0); // a title hit at once, before its messages are read
      if (s.content === 'title') return undefined;
      const r = await deps.read(s, halt);
      sliceStart = deps.now(); // the read awaited I/O: the loop had its turns
      if (cancelled) return undefined;
      if (!r.ok) {
        if (r.reason === 'too-large') notes.tooLarge++;
        else if (r.reason === 'unreadable') notes.unreadable++;
        return undefined; // missing: the session ended or was deleted meanwhile
      }
      const shown: Array<Excerpt & { terms: Set<number> }> = [];
      const reserve: Array<Excerpt & { terms: Set<number> }> = [];
      const shownWords = new Set<number>();
      let total = 0;
      let n = -1;
      let cutHere = 0;
      for (const it of r.items) {
        if (it.type !== 'user' && it.type !== 'output') continue; // D2: tool output is never searched
        n++;
        await tick();
        if (halt()) break;
        let text = typeof it.text === 'string' ? it.text : '';
        if (text.length > BUDGET.maxChars) {
          // the reader cut it: drop the token the cut may have split (mask before cut), back to the last whitespace
          let k = BUDGET.maxChars;
          while (k > 0 && !isWs(text.charCodeAt(k - 1))) k--;
          text = text.slice(0, k);
          cutHere++;
        }
        let m: ReturnType<typeof messageExcerpts>;
        try {
          m = messageExcerpts(text, query, { n, speaker: it.type === 'user' ? 'you' : 'agent', values, masker: deps.masker, search: deps.search });
        } catch {
          continue; // masking failed: no hit from this message (fail closed)
        }
        if (!m) continue;
        for (const x of m.confirmed) confirmed.add(x);
        for (const e of m.excerpts) {
          total++;
          if (shown.length < BUDGET.maxExcerpts && [...e.terms].some((w) => !shownWords.has(w))) {
            shown.push(e);
            for (const w of e.terms) shownWords.add(w);
          } else if (reserve.length < BUDGET.maxExcerpts) reserve.push(e);
        }
      }
      if (cancelled || confirmed.size < words.length) {
        notes.cut += cutHere;
        return undefined;
      }
      const chosen = shown.concat(reserve).slice(0, BUDGET.maxExcerpts).sort((a, b) => a.anchor.n - b.anchor.n);
      return hit(chosen.map(({ terms: _t, ...e }) => e), total - chosen.length);
    }
  }
}
