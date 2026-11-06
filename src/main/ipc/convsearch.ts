/**
 * Spec 095 T020 (FR-023, FR-031..FR-033): `search:start` and `search:cancel`, and the `search:batch` / `search:done` events, for the
 * conversation search. Window only: `ipcHandle` and `fromApp(e)` again here (the scan reads the text of every session). The window sends
 * only the query, cleaned and bounded here (`cleanQuery`), and a `searchId` main issued (random, 128 bits, one live at a time; a stale or
 * unknown one is ignored); the scope is main's (`buildScope`). A new start cancels the scan before it, so two starts leave one scan. The
 * events go to the window that started the scan only, and stop when it goes away. A stop main starts (window close or hide, quit) ends
 * with one `search:done` marked `stopped`; the window's own cancel and a new start end silently. Nothing is logged or stored: not the
 * query, not a hit.
 * Not reachable from the MCP tools, remote control or schedules (`test:convsearchipc`). Under the simulator neither channel is open
 * (`SIM_OPEN_CHANNELS`): the simulator's bridge fakes them in the window.
 */
import { randomBytes } from 'crypto';
import type { WebContents } from 'electron';
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { ConvSearchEvent, ConvSearchHit, ConvSearchNotes, ConvSearchStart } from '../../shared/api';
import { startScan } from '../convsearch';
import type { ScanDeps, ScanHit, ScanNotes } from '../convsearch';
import { createCodexListCache } from '../convscope';
import type { CodexListCache, Scope } from '../convscope';

/** FR-033: the query's bounds (Q3: 3 characters, spaces not counted, in code points before `fold`). */
export const QUERY = { maxChars: 200, maxWords: 8, minChars: 3 } as const;

const REFUSED = 'Agent Durbar refused a call that did not come from its own window.';
export const SHORT = 'Type at least 3 characters.';
export const NONE = 'Open a session first; earlier sessions are searched for the apps and folders you have open.';
const ID_RE = /^[0-9a-f]{32}$/;

/**
 * FR-033: the query main searches, or why not. Control characters become spaces (they never glue two words), the query is trimmed,
 * then cut to 8 words and 200 characters (code points; `cut` says so); it needs at least 3 characters other than spaces ("a bc" is
 * searched, "x y" is not). Always plain text: the scan matches folded words, never a pattern.
 */
export function cleanQuery(q: unknown): { ok: true; query: string; cut: boolean } | { ok: false; code: 'short' | 'invalid' } {
  if (typeof q !== 'string') return { ok: false, code: 'invalid' };
  const head = q.length > 4 * QUERY.maxChars ? q.slice(0, 4 * QUERY.maxChars) : q; // bounds the work below; still over 200 when cut
  const words = head.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().split(/\s+/).filter(Boolean);
  let query = words.slice(0, QUERY.maxWords).join(' ');
  const cps = [...query];
  if (cps.length > QUERY.maxChars) query = cps.slice(0, QUERY.maxChars).join('').trimEnd();
  const cut = head !== q || words.length > QUERY.maxWords || cps.length > QUERY.maxChars;
  if ([...query.replace(/\s+/g, '')].length < QUERY.minChars) return { ok: false, code: 'short' };
  return { ok: true, query, cut };
}

export interface ConvSearchIpcDeps {
  /** True when an agent is open (no agent: nothing to search, no scan starts). */
  hasSessions(): boolean;
  /** The plan and its readers, from main's own state (`buildScope`); `stop` says this search is no longer wanted; `codexLists` is main's own box-session cache (FR-026). */
  scope(stop: () => boolean, codexLists: CodexListCache): Promise<Scope>;
  /** Tests: the cache (default: a new one). */
  codexLists?: CodexListCache;
  /** The masker and the window's fold functions (loaded from the built tree when first needed). */
  matcher(): Pick<ScanDeps, 'masker' | 'search'>;
  /** Tests: the clock and the timers (main: `performance.now`, `setImmediate`, `setTimeout`). */
  now?(): number;
  yieldNow?(): Promise<void>;
  sleep?(ms: number): Promise<void>;
  /** Runs the scan after the start's answer has gone (main: `setImmediate`), so the window knows the id before any event. */
  defer?(fn: () => void): void;
}

/** FR-031: exactly the fields the window may get (no reliance on what else a hit object could carry). */
const toHit = (h: ScanHit): ConvSearchHit => ({
  adapter: h.adapter, sessionId: h.sessionId, ...(h.agentId ? { agentId: h.agentId } : {}), group: h.group, app: h.app, folderName: h.folderName,
  title: h.title, titleMarks: h.titleMarks, time: h.time, excerpts: h.excerpts.map((x) => ({ text: x.text, marks: x.marks, speaker: x.speaker, anchor: { n: x.anchor.n, head: x.anchor.head } })), more: h.more,
});
const noNotes = (): ScanNotes => ({ searched: 0, folders: 0, notInstalled: [], tooLarge: 0, unreadable: 0, titleOnly: { count: 0, apps: [] }, hidden: 0, floorsOff: 0, capped: { sessions: false, perFolder: false, results: false }, timedOut: false, cut: 0, bounded: 0, maskFailed: 0 });

export function register(deps: ConvSearchIpcDeps): { cancelAll(): void; dropKept(): void; live(): string | undefined } {
  const now = deps.now ?? (() => performance.now());
  const yieldNow = deps.yieldNow ?? (() => new Promise<void>((r) => setImmediate(r)));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const defer = deps.defer ?? ((fn: () => void) => void setImmediate(fn));
  let live: { id: string; sender: WebContents; cancel(): void; stopped(): void } | undefined;
  // FR-026 (owner answer C): the box session's earlier Codex titles, main's memory only, for the window that searched last
  const codexLists = deps.codexLists ?? createCodexListCache();
  let cacheOwner: WebContents | undefined;
  const dropCache = (): void => { codexLists.clear(); cacheOwner = undefined; };
  const stopLive = (): void => {
    const l = live;
    live = undefined;
    l?.cancel();
  };
  /**
   * Review of phase 2 (R2): a stop main starts itself (window close or hide, quit) tells a window that is still there, with one final
   * `search:done` carrying `stopped: true`, so a close or quit that is then cancelled does not leave it on "Searching…" for ever.
   */
  const stopByMain = (): void => {
    const l = live;
    stopLive();
    dropCache(); // FR-026: the window closed or hid, or a quit began
    l?.stopped();
  };
  const watched = new WeakSet<WebContents>();
  /** FR-023: the window closing or loading again ends its scan (once per window, not a listener per search). */
  const watch = (w: WebContents): void => {
    if (watched.has(w)) return;
    watched.add(w);
    const gone = (): void => {
      if (live?.sender === w) stopLive();
      if (cacheOwner === w) dropCache(); // FR-026: the window is destroyed or loads again
    };
    w.on?.('destroyed', gone);
    w.on?.('did-start-loading', gone);
  };

  ipcHandle('search:start', (e, query: unknown): ConvSearchStart => {
    if (!fromApp(e)) return { ok: false, code: 'invalid', error: REFUSED };
    stopLive(); // FR-020: a new start (also a too-short one) cancels the scan before it
    const q = cleanQuery(query);
    if (!q.ok) return q.code === 'short' ? { ok: false, code: 'short', error: SHORT } : { ok: false, code: 'invalid', error: 'That is not a search.' };
    if (!deps.hasSessions()) return { ok: false, code: 'none', error: NONE };
    const id = randomBytes(16).toString('hex');
    const sender = e.sender;
    watch(sender);
    if (cacheOwner !== sender) { codexLists.clear(); cacheOwner = sender; } // another window's box session is not this one's
    let cancelled = false;
    let scan: ReturnType<typeof startScan> | undefined;
    let last = { done: 0, total: 0 };
    let extra: Scope['notes'] = { floorOffFolders: 0, mcpValuesLocked: false, lateLists: 0, lateApps: [] };
    const me = {
      id, sender, cancel: (): void => { cancelled = true; scan?.cancel(); },
      stopped: (): void => { if (!sender.isDestroyed()) sender.send('search:done', { kind: 'done', searchId: id, notes: { ...noNotes(), queryCut: q.cut, ...extra }, progress: last, failed: false, stopped: true } satisfies ConvSearchEvent); },
    };
    live = me;
    const send = (channel: 'search:batch' | 'search:done', payload: ConvSearchEvent): void => {
      if (!cancelled && live === me && !sender.isDestroyed()) sender.send(channel, payload);
    };
    const done = (notes: ScanNotes, progress: { done: number; total: number }, failed: boolean): void => {
      const n: ConvSearchNotes = { ...notes, queryCut: q.cut, ...extra };
      send('search:done', { kind: 'done', searchId: id, notes: n, progress, failed });
    };
    defer(() => {
      if (cancelled) return; // a newer start or a cancel came first: this one never builds a plan (two starts make one scan)
      void (async () => {
        try {
          const sc = await deps.scope(() => cancelled, codexLists);
          if (cancelled) return;
          extra = { ...sc.notes };
          const m = deps.matcher();
          scan = startScan(sc.plan, q.query, {
            now, yieldNow, sleep, read: sc.read, values: sc.values, masker: m.masker, search: m.search,
            emit: (b) => { last = { ...b.progress }; send('search:batch', { kind: 'batch', searchId: id, hits: b.hits.map(toHit), progress: b.progress, groups: b.groups }); },
          });
          const end = await scan.done;
          if (!end.cancelled) done(end.notes, end.progress, end.failed);
        } catch {
          done(noNotes(), { done: 0, total: 0 }, true); // the scope or the matcher failed: said, never silent
        } finally {
          if (live === me) live = undefined;
        }
      })();
    });
    return { ok: true, searchId: id, query: q.query, cut: q.cut };
  });

  // FR-023, FR-033: only the live scan's own id, from the window that started it; anything else is ignored
  ipcHandle('search:cancel', (e, searchId: unknown): { ok: boolean } => {
    if (!fromApp(e)) return { ok: false };
    if (typeof searchId !== 'string' || !ID_RE.test(searchId) || !live || live.id !== searchId || live.sender !== e.sender) return { ok: false };
    stopLive();
    return { ok: true };
  });

  // FR-026, FR-033: the box was cleared or closed: that window's scan stops (no `done`: the window asked) and the kept titles go
  ipcHandle('search:clear', (e): { ok: boolean } => {
    if (!fromApp(e)) return { ok: false };
    if (live?.sender === e.sender) stopLive();
    dropCache();
    return { ok: true };
  });

  // FR-026 (review N-R1): an earlier session was deleted in Durbar: the kept titles go at once (a running scan goes on)
  return { cancelAll: stopByMain, dropKept: () => codexLists.clear(), live: () => live?.id };
}
