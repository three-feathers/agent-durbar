/**
 * Spec 095 T021 (FR-016, FR-020, FR-024, FR-030, FR-033; US5): what a conversation search reads, decided in main from its own state. The
 * window sends only the query, so it can name no folder, path or session here. The plan holds the open agents (helpers are events, never
 * entries of `agents`, so none is listed), then per folder the earlier sessions of each app that has an agent there (listed once per
 * folder and app with `previousSessionsOf`, open sessions left out by `openIdsOf`) and its VS Code chats (`listChats`). Names are the
 * user's (spec 059); hidden earlier sessions and sessions on floors that are off are marked for `orderPlan` to skip and count (Q5's note,
 * Q9); the top-bar folder filter is not known here (review question A). Earlier Copilot and Codex sessions are title only (Q4, review
 * question B), and so is an open session whose app holds no live session (no process is started to read it).
 *
 * The readers are the existing ones, with the search limits (`SEARCH_HISTORY_LIMITS`: text items only, no 300 cap): Claude Code through
 * the streamed read (FR-024, open and earlier), a live Copilot or Codex session through the adapter's `history` (Codex behind the
 * cross-scan gate, FR-023; a folder's Codex `thread/list` too, as it also starts a short-lived app-server), a VS Code chat through
 * `readChat`. Paths stay in this file's private map; a `PlanSession` holds none. Nothing
 * is logged or stored.
 */
import type { AdapterRouter } from '../adapters/router';
import { historyOf, previousSessionsOf } from '../adapters/router';
import type { HistoryItem, HistoryResult, PreviousSession } from '../adapters/history';
import { SEARCH_HISTORY_LIMITS } from '../adapters/history';
import { readClaudeHistoryStream } from '../adapters/claudeStream';
import { DEFAULT_TIMEOUT_MS as CODEX_RPC_TIMEOUT_MS } from '../adapters/codexRpc';
import { listChats, readChat } from '../adapters/vscodeChat';
import type { ChatFileRef, UserDir } from '../adapters/vscodeChat';
import type { AgentInfo } from '../shared/api';
import { floorOf } from '../shared/floors';
import { scanSecretValues } from './convmask';
import type { McpValueSources } from './convmask';
import type { PlanSession, ReadOutcome, ScanDeps, ScanPlan } from './convsearch';
import type { FolderStore } from './folders';
import { openIdsOf } from './prevsessions';

export interface ScopeDeps {
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'forAgent' | 'adapterIdOf'>;
  store?: Pick<FolderStore, 'get' | 'sessionNames' | 'floors'>;
  wsKey(a: AgentInfo): string;
  resumeIdFor(id: string): string;
  /** The app's display name ("Codex"). */
  appName(adapterId: string): string;
  vsUserDirs(): UserDir[];
  /** FR-012: a VS Code chat the scan listed can be opened with `vschat:read` (View) by the agent it was listed for. */
  rememberChat?(agentId: string, ref: ChatFileRef): void;
  /** FR-030: the MCP secret values, never through a keychain prompt (`scanSecretValues`). */
  values: McpValueSources;
  /** FR-023: the one cross-scan gate for Codex calls (`createReadGate`): an open session's read and a folder's `thread/list`. */
  gate: { run(key: string, fn: () => Promise<unknown>, timeoutMs?: number): Promise<unknown> };
  /** Tests: the Claude config folder and the readers. */
  claudeDir?: string;
  /** FR-026: the box session's kept Codex lists (absent: list every time). */
  keptLists?: ListCache;
  /** FR-022 (review of phase 2 code): the listings running now, shared across scans (main's one map; absent: no sharing), so quick new starts never pile up readers of the same folder. */
  listings?: Map<string, Promise<unknown>>;
  /** The clock of the kept lists and of the plan's deadline (ms; default `Date.now`). */
  now?(): number;
  /** The plan's deadline timer (tests inject their own; main: an unref'd `setTimeout`). */
  wait?(ms: number): Promise<void>;
  /** Issue 1904 (FR-015): folders whose listings are over, of all the plan's folders; called at the start (0) and after each folder. */
  onListing?(done: number, total: number): void;
  /** Spec 095 FR-054: the sessions the plan holds so far, for the title pass: the open ones first, then what each listing step added; `values` masks a session's title. */
  onSessions?(sessions: readonly PlanSession[], values: (s: PlanSession) => readonly string[]): void;
  readClaude?: typeof readClaudeHistoryStream;
  listChats?: typeof listChats;
  readChat?: typeof readChat;
}

export interface Scope {
  plan: ScanPlan;
  read: ScanDeps['read'];
  values: ScanDeps['values'];
  /** What the end state adds to the scan's notes (owner answers C and D, FR-014). */
  notes: { floorOffFolders: number; mcpValuesLocked: boolean; lateLists: number; lateApps: string[] };
}

/** FR-026: a kept list older than this is listed again (a session deleted in Previous sessions, or made in the Codex app, shows within it). */
export const KEPT_LIST_TTL_MS = 5 * 60_000;
/** FR-022 (review N-R2): the most building the plan may take; a listing still running then is given up, the rest are skipped. */
export const SCOPE_LIST_MS = 30_000;
/** FR-022 (issue 1904, part 2): the most one read of the plan may take; then it is skipped and counted (`notes.slow`), and the scan goes on. Under the Codex gate's 20 s, a fraction of the scan's 60 s. */
export const SEARCH_READ_MS = 15_000;
const LATE = Symbol('late');

/**
 * FR-026 (owner answer C; issue 1904, part 2): what a listing gave, kept in memory for the search box session, so the searches typed one
 * after another list nothing again: each folder's earlier sessions per app (`previousSessionsOf`, Codex's `thread/list` among them: no new
 * app-server) and each folder's VS Code chats. Nothing is written or sent. A key is `folderKey + NUL + kind`. An entry is dropped when it
 * is older than `KEPT_LIST_TTL_MS`, or when an open session of that folder and app (`ids`, the agents' ids at the listing) has left the
 * office since it was listed (it is an earlier session now). A new open session does not drop it: it adds no earlier session, and a
 * resumed one is left out by the open-session filter at each search. `dropFolder` drops one folder (the Previous sessions panel listed it
 * again); `clear()` drops everything (the box cleared or closed, a delete, the window gone, main's own stop).
 */
export interface ListCache {
  get<T = PreviousSession>(key: string, openIds: readonly string[], now: number): T[] | undefined;
  set<T = PreviousSession>(key: string, openIds: readonly string[], list: readonly T[], now: number): void;
  dropFolder(folderKey: string): void;
  clear(): void;
  size(): number;
}

/** The key of a kept list: a folder and what was listed in it (an adapter id, or `vscode` for its chats). */
export const keptKey = (folderKey: string, kind: string): string => `${folderKey}\0${kind}`;

export function createListCache(ttlMs: number = KEPT_LIST_TTL_MS): ListCache {
  const m = new Map<string, { at: number; ids: Set<string>; list: unknown[] }>();
  const copy = <T>(list: readonly T[]): T[] => JSON.parse(JSON.stringify(list)) as T[]; // plain data (titles, times, chat refs): a copy goes out and comes in
  return {
    get<T>(key: string, openIds: readonly string[], now: number): T[] | undefined {
      const e = m.get(key);
      if (!e) return undefined;
      const open = new Set(openIds);
      if (!(now - e.at >= 0 && now - e.at < ttlMs) || [...e.ids].some((id) => !open.has(id))) {
        m.delete(key);
        return undefined;
      }
      return copy(e.list as T[]);
    },
    set<T>(key: string, openIds: readonly string[], list: readonly T[], now: number): void {
      m.set(key, { at: now, ids: new Set(openIds), list: copy(list) });
    },
    dropFolder(folderKey) {
      for (const k of [...m.keys()]) if (k === folderKey || k.startsWith(folderKey + '\0')) m.delete(k);
    },
    clear: () => m.clear(),
    size: () => m.size,
  };
}

/** Where a planned session is read from: main only (a path never leaves this file). */
type Source =
  | { kind: 'claude'; id: string; cwd: string }
  | { kind: 'live'; agentId: string; adapter: string }
  | { kind: 'vscode'; ref: ChatFileRef }
  | { kind: 'none' };

const VSCODE = 'vscode';
/**
 * Review of phase 2 (R3): the gate's limit for a folder's Codex `thread/list`, above the probe's worst case (two requests of
 * `DEFAULT_TIMEOUT_MS` each, `initialize` and `thread/list`, plus the close), so the gate never lets a second app-server start beside one
 * that is still running.
 */
export const CODEX_LIST_GATE_MS = 2 * CODEX_RPC_TIMEOUT_MS + 10_000;
const UNTITLED = 'Untitled session';
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The plan and its readers. `stop` is asked between folders (a newer search makes this one moot). */
export async function buildScope(d: ScopeDeps, stop: () => boolean = () => false): Promise<Scope> {
  const values = (s: PlanSession): readonly string[] => scanSecretValues(d.values, { folderKey: s.folderKey, agentId: s.agentId, open: s.group === 'office' });
  const sources = new WeakMap<PlanSession, Source>();
  const sessions: PlanSession[] = [];
  const unavailable = new Set<string>();
  const doc = d.store?.floors();
  const floorOff = (a: AgentInfo): boolean => !!doc && doc.floors.find((f) => f.id === floorOf(a.floor, doc))?.on === false;
  const add = (s: PlanSession, src: Source): void => {
    sessions.push(s);
    sources.set(s, src);
  };
  const adapterOf = (a: AgentInfo): string => d.router.adapterIdOf(a.id) ?? a.adapterId;
  const folderName = (a: AgentInfo): string => text(a.label) || text(a.name) || 'Folder';

  // 1. the open sessions, in the office's order (FR-020): content when it can be read without starting anything
  let floorOffFolders = 0;
  // FR-022 (review N-R2): the plan's own deadline; each listing races the time left, and none starts after it
  const clock = d.now ?? Date.now;
  const wait = d.wait ?? ((ms: number) => new Promise<void>((r) => { const h = setTimeout(r, ms); h.unref?.(); }));
  const deadline = clock() + SCOPE_LIST_MS;
  let lateLists = 0;
  const lateApps = new Set<string>();
  // a listing already running for this folder and app (an earlier scan's) is waited for, not started again; gone when it settles
  const shared = <T>(k: string, start: () => Promise<T>): Promise<T> => {
    const m = d.listings;
    if (!m) return start();
    const run = m.get(k);
    if (run) return run as Promise<T>;
    const p: Promise<T> = start().finally(() => { if (m.get(k) === p) m.delete(k); });
    m.set(k, p);
    return p;
  };
  const inTime = async <T>(p: Promise<T>): Promise<T | typeof LATE> => {
    const left = deadline - clock();
    if (left <= 0) return LATE;
    // a listing given up that fails later is not an unhandled rejection: the race has already subscribed to it (test: scope deadline)
    return Promise.race([p, wait(left).then((): typeof LATE => LATE)]);
  };
  const late = (app: string): void => { lateLists++; lateApps.add(app); };
  const firstOf = new Map<string, AgentInfo>(); // folder -> its first agent; folder + app -> the agent its earlier sessions are listed for
  for (const a of d.agents.values()) {
    const ad = d.router.forAgent(a.id);
    if (!ad) continue;
    const adapter = adapterOf(a);
    const key = d.wsKey(a);
    if (!firstOf.has(key)) firstOf.set(key, a);
    if (!firstOf.has(`${key}\0${adapter}`)) firstOf.set(`${key}\0${adapter}`, a);
    let src: Source = { kind: 'none' };
    if (adapter === 'claude') src = { kind: 'claude', id: d.resumeIdFor(a.id), cwd: a.cwd };
    else if (ad.history && ad.isLive(a.id)) src = { kind: 'live', agentId: a.id, adapter };
    add({
      adapter, app: d.appName(adapter), folderKey: key, folderName: folderName(a), sessionId: a.id, agentId: a.id, group: 'office',
      title: text(a.alias) || text(a.title) || UNTITLED, time: 0, content: src.kind === 'none' ? 'title' : 'read', floorOff: floorOff(a),
    }, src);
  }

  // 2. per folder, the earlier sessions of each app with an agent there, then its VS Code chats
  // one copy of the agents for the folder loop: the open ids and a folder's Codex ids (key of the kept list) must agree, whatever closes while a listing is awaited
  const snapshot = new Map(d.agents);
  const openIds = openIdsOf({ agents: snapshot, resumeIdFor: d.resumeIdFor });
  // issue 1904: a folder counts as done when all its listings (VS Code chats, and each app's earlier sessions) are over, whatever they gave
  const left = new Map<string, number>();
  for (const [k, a] of firstOf) left.set(d.wsKey(a), (left.get(d.wsKey(a)) ?? 0) + 1);
  let foldersDone = 0;
  const report = (): void => { try { d.onListing?.(foldersDone, left.size); } catch { /* a progress callback never stops the plan */ } };
  let told = 0;
  const tellSessions = (): void => { // FR-054: what was added since the last call
    const added = sessions.slice(told);
    told = sessions.length;
    if (added.length) try { d.onSessions?.(added, values); } catch { /* a progress callback never stops the plan */ }
  };
  tellSessions(); // the open sessions: their titles are known before any listing
  report();
  let previous: string | undefined;
  const finished = (): void => {
    if (previous === undefined) return;
    const n = (left.get(previous) ?? 1) - 1;
    left.set(previous, n);
    tellSessions(); // each step's sessions (`finished` also runs once after the loop)
    if (n === 0) { foldersDone++; report(); }
    previous = undefined;
  };
  for (const [k, a] of firstOf) {
    finished(); // the step before this one is over (every `continue` below ends a step)
    if (stop()) break;
    previous = d.wsKey(a);
    const key = d.wsKey(a);
    const f = d.store?.get(key);
    const hidden = (src: string): Set<string> => new Set((f?.prevHidden ?? []).filter((m) => m.src === src).map((m) => m.id));
    const names = (src: string): Map<string, string> => new Map((d.store?.sessionNames(key) ?? []).filter((e) => e.src === src).map((e) => [e.id, e.name]));
    const off = floorOff(a);
    if (k.includes('\0')) {
      const adapter = adapterOf(a);
      const ad = d.router.forAgent(a.id);
      if (!ad?.listPreviousSessions) continue;
      let list: PreviousSession[];
      try {
        let started = false; // this scan's call ran (it was not shared): only then is the list excluding this scan's open ids kept
        const listing = (): Promise<PreviousSession[]> => { started = true; return previousSessionsOf(ad, a.cwd, openIds); };
        // owner answer C: a folder on a floor that is off starts no app-server; it is counted instead
        if (adapter === 'codex' && off) { floorOffFolders++; continue; }
        // FR-026: the box session's kept list (issue 1904: of every app), else the listing; Codex's `thread/list` goes through the gate (one at a time)
        const ids = [...snapshot.values()].filter((x) => d.wsKey(x) === key && adapterOf(x) === adapter).map((x) => x.id);
        const at = clock();
        const kk = keptKey(key, adapter);
        const kept = d.keptLists?.get<PreviousSession>(kk, ids, at);
        if (kept) list = kept.filter((s) => !openIds.has(s.id)); // a session resumed since: open now, not earlier
        else {
          if (clock() >= deadline) { late(d.appName(adapter)); continue; } // past the plan's deadline: not started
          const run = adapter === 'codex'
            ? d.gate.run(`list\0${key}`, listing, CODEX_LIST_GATE_MS) as Promise<PreviousSession[]>
            : shared(`list\0${k}`, listing);
          const r = await inTime(run);
          if (r === LATE) { late(d.appName(adapter)); continue; } // given up: not kept
          // a listing leaves out the open ids of the scan that started it, so only that scan keeps it, under its own ids (review of PR 1232, round 2)
          if (started) d.keptLists?.set(kk, ids, r, at);
          list = r.filter((s) => !openIds.has(s.id)); // shared with an earlier scan's call: a session resumed since is open now
        }
      } catch {
        unavailable.add(d.appName(adapter)); // FR-014: "Not searched: Codex (not installed)", once
        continue;
      }
      const hid = hidden(adapter);
      const nm = names(adapter);
      for (const p of list) {
        const read = adapter === 'claude';
        add({
          adapter, app: d.appName(adapter), folderKey: key, folderName: folderName(a), sessionId: p.id, agentId: a.id, group: 'earlier',
          title: nm.get(p.id) || text(p.title) || UNTITLED, time: Number(p.modifiedTime) || 0, content: read ? 'read' : 'title', floorOff: off, hidden: hid.has(p.id),
        }, read ? { kind: 'claude', id: p.id, cwd: a.cwd } : { kind: 'none' });
      }
    } else {
      let chats: { sessions: ChatFileRef[] };
      try {
        const kk = keptKey(key, VSCODE);
        const at = clock();
        const kept = d.keptLists?.get<ChatFileRef>(kk, [], at); // issue 1904: the box session's kept chat list; no open-session filter applies to chats
        if (kept) chats = { sessions: kept };
        else {
          if (clock() >= deadline) { late('VS Code'); continue; }
          let started = false;
          const r = await inTime(shared(`chats\0${key}`, () => { started = true; return (d.listChats ?? listChats)(d.vsUserDirs(), { folders: a.folders, workspaceFile: a.workspaceFile }); }));
          if (r === LATE) { late('VS Code'); continue; }
          if (started) d.keptLists?.set(kk, [], r.sessions, at); // a failed or given up listing is not kept
          chats = r;
        }
      } catch {
        continue;
      }
      const hid = hidden(VSCODE);
      const nm = names(VSCODE);
      for (const ref of chats.sessions) {
        const s = ref.summary;
        d.rememberChat?.(a.id, ref);
        add({
          adapter: VSCODE, app: 'VS Code', folderKey: key, folderName: folderName(a), sessionId: s.key, agentId: a.id, group: 'earlier',
          title: nm.get(s.key) || text(s.title) || UNTITLED, time: Number(s.updated) || 0, content: 'read', floorOff: off, hidden: hid.has(s.key),
        }, { kind: 'vscode', ref });
      }
    }
  }
  finished();

  const readOnce = async (s: PlanSession, halt: () => boolean): Promise<ReadOutcome> => {
    const src = sources.get(s) ?? { kind: 'none' };
    if (src.kind === 'claude') {
      const r = await (d.readClaude ?? readClaudeHistoryStream)(src.id, src.cwd, SEARCH_HISTORY_LIMITS, d.claudeDir, { stop: halt });
      return r.ok ? { ok: true, items: r.history.items } : { ok: false, reason: r.reason };
    }
    if (src.kind === 'live') {
      const ad = d.router.forAgent(src.agentId);
      if (!ad || !ad.isLive(src.agentId)) return { ok: false, reason: 'missing' }; // it ended meanwhile
      const once = (): Promise<HistoryResult> => historyOf(ad, src.agentId, SEARCH_HISTORY_LIMITS);
      // review of phase 2 (R1): checked again in the same tick as the call, after the wait at the gate; a Codex session that ended
      // meanwhile would otherwise be read through a new app-server (`history` takes the probe branch for a session that is not live)
      const gated = (): Promise<HistoryResult | undefined> => (ad.isLive(src.agentId) ? once() : Promise.resolve(undefined));
      const h = src.adapter === 'codex' ? ((await d.gate.run(`read\0${src.agentId}`, gated)) as HistoryResult | undefined) : await once();
      return h ? { ok: true, items: h.items } : { ok: false, reason: 'missing' };
    }
    if (src.kind === 'vscode') {
      const r = await (d.readChat ?? readChat)(src.ref);
      if (!r.ok) return { ok: false, reason: 'unreadable' };
      const items: HistoryItem[] = [];
      for (const b of r.transcript.blocks) {
        if (b.type === 'user') items.push({ type: 'user', text: b.text });
        else if (b.type === 'assistant') items.push({ type: 'output', text: b.text });
      }
      return { ok: true, items };
    }
    return { ok: false, reason: 'unreadable' };
  };
  // issue 1904 (FR-022): every read races its own limit; the plan's `wait` is the timer (tests inject their own). A Claude Code stream is told to stop.
  const read = async (s: PlanSession, halt: () => boolean): Promise<ReadOutcome> => {
    let over = false;
    const run = readOnce(s, () => halt() || over);
    run.catch(() => undefined); // a read given up that fails later is not an unhandled rejection
    const r = await Promise.race([run, wait(SEARCH_READ_MS).then((): typeof LATE => LATE)]);
    if (r !== LATE) return r;
    over = true;
    return { ok: false, reason: 'timeout' };
  };
  // owner answer D: the open agents' session values are left out of the mask while the vault would prompt (`scanSecretValues`): said
  let mcpValuesLocked = true;
  try { mcpValuesLocked = !d.values.noPrompt(); } catch { /* unknown: said as locked */ }
  return { plan: { sessions, unavailable: [...unavailable] }, read, values, notes: { floorOffFolders, mcpValuesLocked, lateLists, lateApps: [...lateApps] } };
}
