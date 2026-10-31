/** IPC for the Copilot CLI MCP list (global, read live), the per-folder MCP extras and the per-agent MCP switches (specs 019, 020). The renderer never receives a secret value or a file path. */
import type { OrgMcpServer, OrgVerdict } from '../shared/orgpolicy';
import { safeStorage } from 'electron';
import { fromAppFrame as fromApp, ipcHandle } from './ipcguard';
import * as path from 'path';
import type { AgentInfo, AgentMcpReply, GlobalApp, McpContextView, McpFolderState, McpState } from '../shared/api';
import type { McpServerStatus } from '../adapters/types';
import { setMcpOp } from './agentops';
import type { AdapterRouter } from '../adapters/router';
import type { McpServerSpec } from '../shared/mcp';
import type { DevEnv } from './devhooks';
import { BUILTIN_SERVERS, cliServers, copilotDir } from './mcpfiles';
import { applyFolderImport, MAX_IMPORT_FOLDERS, previewFolderImport } from './mcpimport';
import { mcpSecretValues } from './mcpmask';
import { claudeOffKey, mergeSessionServers, offOf } from './mcpglobal';
import { agentMcpReply, mcpRefreshOp, mcpRestartOp } from './mcpsession';
import { McpCallTracker } from './mcpcall';
import { mcpToolsOp } from './mcptoolsop';
import { McpContextTracker } from './mcpcontextop';
import type { McpCostStore } from './mcpcosts';
import { McpSignInStore, SignInPoller, mcpCancelSignInOp, mcpOpenSignInOp, mcpSignInOp, serverUrlFor } from './mcpsignin';
import { McpStore } from './mcpstore';
import { mcpHealthUpdate } from '../shared/mcphealth';
import type { McpHealthMark } from '../shared/mcphealth';
import type { SecretCodec } from './mcpstore';

/**
 * OS-protected secret storage. On Linux Electron may fall back to a hard-coded key ("basic_text"): that is not protection,
 * so it counts as unavailable and secrets stay in memory only.
 *
 * macOS (spec 019 FR-023): `isEncryptionAvailable()` reads the Keychain item `agent-durbar Safe Storage` to answer (`read:` Chromium
 * `os_crypt_mac`), which can show a Keychain prompt just for opening Settings. Every Mac has a login Keychain, so it is not asked:
 * a refused or failing Keychain shows up as a failed encrypt/decrypt, which `McpStore` handles (values stay in memory or show as missing).
 */
export const safeStorageCodec: SecretCodec = {
  available: () => {
    try {
      if (process.platform === 'darwin') return true;
      if (!safeStorage.isEncryptionAvailable()) return false;
      const ss = safeStorage as unknown as { getSelectedStorageBackend?: () => string };
      if (process.platform === 'linux' && typeof ss.getSelectedStorageBackend === 'function') {
        const b = ss.getSelectedStorageBackend();
        return b !== 'basic_text' && b !== 'unknown';
      }
      return true;
    } catch {
      return false;
    }
  },
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (blob) => safeStorage.decryptString(Buffer.from(blob, 'base64')),
};

/** The folder/workspace an agent belongs to: the key of the saved folder list and of the MCP extras. */
const keyOf = (a: AgentInfo): string => a.workspaceFile ?? a.cwd;
const nameOfKey = (key: string): string => path.basename(key).replace(/\.code-workspace$/i, '') || key;

export function registerMcpIpc(deps: {
  store: () => McpStore;
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'onEvent' | 'forAgent'>;
  dev: DevEnv;
  /** Spec 069 FR-009: servers of the agent app's own user list that Durbar passes itself (Claude Code), values included (main only). */
  globalFor?(agentId: string): Record<string, McpServerSpec>;
  /** Spec 069 FR-011: the names of each agent app's user list, read now. */
  globalNames?(): Partial<Record<GlobalApp, string[]>>;
  /** Spec 058 FR-185: the addresses of Codex's own `config.toml` servers (the values-free view), for the "different site" line of a Codex agent. */
  codexServers?(): Record<string, { url?: string }>;
  /** The agent app of an agent (`copilot`, `claude`, `codex`, ...). */
  appOf?(agentId: string): string | undefined;
  /** Spec 052 activity log row for an MCP restart (spec 058 FR-021). */
  log?(a: AgentInfo, action: string): void;
  /** Spec 058 FR-065: opens a sign-in page in the system browser (main's `shell.openExternal`); only called after the user's click. */
  openUrl?(url: string): Promise<void>;
  /** The clock of the sign-in store's 10-minute limit, and the timers of its 3-second poll (tests). */
  now?(): number;
  timers?: import('./mcpsignin').PollTimers;
  /** Spec 076 FR-202/FR-203 (issue #602): why the agent app's own organization policy blocks a server or a tool of this agent, or undefined. */
  orgMcp?(agentId: string, s: OrgMcpServer): Promise<OrgVerdict | undefined>;
  /** The same from the last read, for the often repainted list (never waits). */
  orgMcpNow?(agentId: string, s: OrgMcpServer): OrgVerdict | undefined;
  orgTool?(agentId: string, server: string, tool: string): Promise<OrgVerdict | undefined>;
  /** Spec 100 FR-003: new MCP figures for the window. */
  pushContext?(id: string, view: McpContextView): void;
  /** Spec 100 FR-004, FR-012: the last figures, in their own file: never in the store that holds the user's servers and secrets. */
  costs?(): McpCostStore | undefined;
}): { optionsFor(agentId: string): { mcpServers: Record<string, McpServerSpec>; disabledMcpServers: string[]; disabledMcpTools?: Record<string, string[]> }; secretValuesFor(agentId: string): string[] } {
  const { agents, router, dev } = deps;
  const store = deps.store;
  /** Per agent id, this run only: servers the user switched off for that agent. */
  const off = new Map<string, Set<string>>();
  /** Latest MCP state the runtime reported per session. */
  const live = new Map<string, McpServerStatus[]>();
  /** The secret values handed to one session (its folder's extras), used to mask server errors. */
  const secretValuesFor = (agentId: string): string[] => {
    const a = agents.get(agentId);
    if (!a) return [];
    try {
      // Spec 069 FR-009: the user list's values too (all of them, also one a folder extra shadows: masking more is safe).
      return mcpSecretValues(deps.globalFor?.(agentId), store().forSession(keyOf(a), off.get(agentId) ?? [], cliNames()).mcpServers);
    } catch {
      return []; // store not ready or unreadable: the shape-based masking still runs, and the event is not lost
    }
  };
  /** Spec 058 FR-092: per session, when each server's state started and whether a failure came after Running (dropped when it stops). */
  const health = new Map<string, Map<string, McpHealthMark>>();
  /** Spec 058 FR-065: the sign-in pages the agent apps handed back, in memory only (never logged, never written), for at most 10 minutes. */
  const signIns = new McpSignInStore(deps.now ?? Date.now, deps.openUrl ?? (async () => { throw new Error('no browser'); }));
  /** FR-064 (real 2026-10-23): while a sign-in page is open, read the agent app's server list again every 5 s (at most 10 minutes) and when the window regains focus. */
  const poller = new SignInPoller(signIns, (id, name) => {
    const ad = router.forAgent(id);
    return ad && ad.isLive(id) ? ad.refreshMcpStatus?.(id, name) : undefined;
  }, deps.timers ?? { set: (fn, ms) => setInterval(fn, ms), clear: (h) => clearInterval(h as ReturnType<typeof setInterval>) });
  signIns.hooks = { opened: (a, n) => poller.start(a, n), dropped: (a, n) => poller.stop(a, n) };
  /**
   * FR-176: after Cancel or the time limit, a browser step the user still finishes is picked up by the agent app, but no page is held, so
   * nothing polls. For 5 minutes after an attempt, the dialog opening or the window regaining focus reads the list once for that session
   * (one read in flight per agent; a failing read changes nothing).
   */
  const rechecking = new Set<string>();
  const recheck = (id: string): void => {
    const names = signIns.recent(id);
    const ad = router.forAgent(id);
    if (!names.length || rechecking.has(id) || !ad?.isLive(id) || typeof ad.refreshMcpStatus !== 'function') return;
    rechecking.add(id);
    void Promise.resolve()
      .then(() => ad.refreshMcpStatus?.(id, names[0]))
      .catch(() => undefined)
      .finally(() => rechecking.delete(id));
  };
  /** Spec 058 FR-187: the class of each server's last failed tool call (a word only; the text is classified and dropped here). */
  const calls = new McpCallTracker();
  /** Spec 100: what each session's MCP tool definitions take in its window (FR-003, FR-004). */
  const contexts = new McpContextTracker({
    agents,
    router,
    secrets: secretValuesFor,
    live: (id) => live.get(id) ?? [],
    off: (id) => off.get(id) ?? new Set<string>(),
    push: (id, view) => deps.pushContext?.(id, view),
    persist: (id, servers, at) => { const app = deps.appOf?.(id); if (app) deps.costs?.()?.set(app, servers, at); },
    now: deps.now,
  });
  router.onEvent((e) => {
    calls.onEvent(e);
    if (e.type === 'mcp') {
      live.set(e.sessionId, e.servers);
      calls.onServers(e.sessionId, e.servers); // FR-188: a server that came back to connected drops its call class
      health.set(e.sessionId, mcpHealthUpdate(health.get(e.sessionId), e.servers, Date.now()));
      signIns.onServers(e.sessionId, e.servers); // connected: the sign-in is finished
    } else if (e.type === 'status' && e.status === 'stopped') {
      live.delete(e.sessionId);
      health.delete(e.sessionId);
      signIns.dropAgent(e.sessionId); // End session, Restart session (it ends the session first), a failed reconnect
    }
    contexts.onEvent(e); // after `live` is current
  });

  /** The Copilot CLI list is read again on every call, so edits of the file show up the next time a screen opens. */
  const cli = () => cliServers(copilotDir(dev), new Set(store().ambientDisabled()));
  const cliNames = (): string[] => cli().servers.map((x) => x.name);
  /** A folder key is only accepted when an agent of that folder exists (the renderer cannot invent keys). */
  const knownKey = (key: unknown): key is string => typeof key === 'string' && !!key && [...agents.values()].some((a) => keyOf(a) === key);

  const state = (): McpState => {
    const r = cli();
    return { cli: r.servers, file: r.file, secretsPersist: store().secretsPersist };
  };
  const folderState = (key: string): McpFolderState => {
    const s = store();
    const names = cliNames();
    return {
      ok: true,
      key,
      name: nameOfKey(key),
      servers: s.list(key),
      legacy: s.legacyList(),
      secretsPersist: s.secretsPersist,
      skipped: s.forSession(key, [], names).skipped,
      cliNames: names,
    };
  };
  const bad = { ok: false, error: 'Unknown folder.' } as const;
  /** The folders behind a key (a workspace has several), taken from the agents in the office, never from the renderer. */
  const dirsOf = (key: string): string[] => {
    const out: string[] = [];
    for (const a of agents.values()) if (keyOf(a) === key) for (const d of a.folders?.length ? a.folders : [a.cwd]) if (d && !out.includes(d)) out.push(d);
    return out.slice(0, MAX_IMPORT_FOLDERS);
  };

  ipcHandle('mcp:state', () => state());
  /** Names of every saved folder's extras, nothing else (spec 024 FR-016). No arguments; names that equal a CLI/built-in server are left out. */
  ipcHandle('mcp:extraNames', () => ({ ok: true, names: store().extraNames(cliNames()) }));
  ipcHandle('mcp:setCli', (_e, name: unknown, enabled: unknown) => {
    if (typeof name !== 'string' || !name || name.length > 64) return { ok: false };
    store().setAmbientDisabled(name, enabled !== true);
    return { ok: true };
  });
  ipcHandle('mcp:folderState', (_e, key: unknown): McpFolderState | { ok: false; error: string } => (knownKey(key) ? folderState(key) : bad));
  ipcHandle('mcp:upsert', (_e, key: unknown, input: unknown, originalName: unknown) => {
    if (!knownKey(key)) return bad;
    try {
      return store().upsert(key, input, typeof originalName === 'string' ? originalName : undefined, cliNames());
    } catch {
      return { ok: false, error: 'Could not save the server list.' };
    }
  });
  ipcHandle('mcp:remove', (_e, key: unknown, name: unknown) => ({ ok: knownKey(key) && typeof name === 'string' && store().remove(key, name) }));
  ipcHandle('mcp:setEnabled', (_e, key: unknown, name: unknown, enabled: unknown, trustAck: unknown) =>
    knownKey(key) && typeof name === 'string' ? store().setEnabled(key, name, enabled === true, trustAck === true) : { ok: false, error: 'Unknown server.' });
  ipcHandle('mcp:moveLegacy', (_e, name: unknown, key: unknown) => (knownKey(key) && typeof name === 'string' ? store().moveLegacy(name, key, cliNames()) : bad));
  /** Per-folder import from `.vscode/mcp.json` (spec 020 FR-020): preview, then apply the ticked ids. Read-only for the file; imported servers arrive off and untrusted. */
  ipcHandle('mcp:importPreview', (_e, key: unknown) => {
    if (!knownKey(key)) return { ...bad, label: '.vscode/mcp.json', files: [], items: [], digest: '', skipped: 0 };
    return previewFolderImport(dirsOf(key), store().list(key), cliNames());
  });
  ipcHandle('mcp:importApply', (_e, key: unknown, ids: unknown, digest: unknown) => {
    if (!knownKey(key)) return { ...bad, imported: [], failed: [] };
    if (!Array.isArray(ids) || typeof digest !== 'string') return { ok: false, error: 'Nothing selected.', imported: [], failed: [] };
    try {
      return applyFolderImport(store(), key, dirsOf(key), ids as string[], digest, cliNames());
    } catch {
      return { ok: false, error: 'Could not save the server list.', imported: [], failed: [] };
    }
  });
  ipcHandle('mcp:removeLegacy', (_e, name: unknown) => ({ ok: typeof name === 'string' && store().removeLegacy(name) }));

  /** Spec 058 FR-078: what Agent Durbar passed as disabled at the last session start, and what the user switched since: a runtime `disabled` for these is ours, not the agent app's. */
  const launched = new Map<string, Set<string>>();
  const touched = new Map<string, Set<string>>();
  ipcHandle('agents:mcp', (_e, id: unknown, focus?: unknown): AgentMcpReply => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    if (!a) return { ok: false, servers: [], live: false };
    if (focus === true) {
      poller.kick(a.id); // only the window regaining focus or the dialog opening asks for this (a repaint after an `mcp` event must not, or each read would trigger the next)
      recheck(a.id);
    }
    const s = store();
    const dis = new Set(s.ambientDisabled());
    // Spec 069 FR-009/FR-011: each agent app's own list. Copilot loads the Copilot CLI list itself; Durbar passes Claude Code's list to
    // Claude sessions; Codex reports its own list as the session runs (runtime rows).
    const gn = deps.globalNames?.() ?? {};
    const all = cli().servers;
    return agentMcpReply({
      a,
      ad: router.forAgent(a.id),
      live: live.get(a.id) ?? [],
      off: off.get(a.id) ?? new Set<string>(),
      secrets: secretValuesFor(a.id),
      cli: all,
      extras: s.list(keyOf(a)),
      ambientDisabled: dis,
      launchedOff: launched.get(a.id),
      switchedHere: touched.get(a.id),
      app: deps.appOf?.(a.id),
      claudeList: (gn.claude ?? []).map((n) => ({ name: n, enabled: !dis.has(claudeOffKey(n)) })),
      toolsOff: s.toolsOffFor(keyOf(a)),
      health: health.get(a.id),
      lastCall: (n) => calls.get(a.id, n),
      signIn: (n) => signIns.view(a.id, n),
      serverUrl: (n) => serverUrlOf(a.id, n),
      orgBlocked: deps.orgMcpNow ? (n) => deps.orgMcpNow?.(a.id, serverDefOf(a.id, n)) : undefined,
      global: gn,
      builtin: new Set(all.filter((x) => x.origin === 'builtin').map((x) => x.name)),
    });
  });
  /** Spec 058 FR-190: read the agent app's whole server list again (the dialog opening, Refresh); one read at a time per agent. */
  const refreshing = new Map<string, Promise<void>>();
  const lastRead = new Map<string, number>();
  ipcHandle('agents:mcpRefresh', (e, id: unknown, manual?: unknown) => (fromApp(e) ? mcpRefreshOp({ agents, router, lastRead, now: deps.now }, refreshing, id, manual) : { ok: false, supported: false, error: 'invalid request' }));
  /** Spec 058 FR-021: restart one server of this agent's running session; one at a time per server. */
  const restarting = new Set<string>();
  ipcHandle('agents:mcpRestart', (_e, id: unknown, name: unknown) =>
    mcpRestartOp({ agents, router, live: (k) => live.get(k) ?? [], off: (k) => new Set([...(off.get(k) ?? []), ...store().ambientDisabled(), ...offOf('claude', store().ambientDisabled())]), secrets: secretValuesFor, log: deps.log }, restarting, id, name));
  /** Spec 058 FR-075/FR-185: the server's own address, for the "different site" line, from the lists this agent's app uses (`serverUrlFor`). */
  const serverUrlOf = (agentId: string, name: string): string | undefined => {
    const a = agents.get(agentId);
    if (!a) return undefined;
    try {
      return serverUrlFor(deps.appOf?.(agentId), name, { extras: () => store().list(keyOf(a)), copilot: () => cli().servers, claude: () => deps.globalFor?.(agentId) ?? {}, codex: () => deps.codexServers?.() ?? {} });
    } catch {
      return undefined;
    }
  };
  /**
   * Spec 076 FR-200 (issue #602): what Durbar knows of a server of this agent, for the organization's command and URL rules: this
   * folder's extra, the user list Durbar passes, then (Copilot sessions only: it loads that list itself) the Copilot CLI list.
   */
  const serverDefOf = (agentId: string, name: string): OrgMcpServer => {
    const a = agents.get(agentId);
    const app = deps.appOf?.(agentId);
    try {
      const all = cli().servers;
      const builtin = all.some((v) => v.name === name && v.origin === 'builtin');
      const def: { command?: string; args?: readonly string[]; url?: string } | undefined =
        (a ? store().list(keyOf(a)).find((v) => v.name === name) : undefined) ?? deps.globalFor?.(agentId)?.[name] ?? (app === 'claude' || app === 'codex' ? undefined : all.find((v) => v.name === name));
      return { name, ...(def?.command ? { command: def.command, args: def.args ?? [] } : {}), ...(def?.url ? { url: def.url } : {}), ...(builtin ? { builtin: true } : {}) };
    } catch {
      return { name };
    }
  };
  /** Spec 058 FR-065: Sign in, Open sign-in page, Cancel. Window only; main holds the address, the window gets the host. */
  ipcHandle('agents:mcpSignIn', (e, id: unknown, name: unknown, again?: unknown) =>
    fromApp(e) ? mcpSignInOp({ agents, router, live: (k) => live.get(k) ?? [], secrets: secretValuesFor, serverUrl: serverUrlOf }, signIns, id, name, again) : { ok: false, error: 'invalid request' });
  ipcHandle('agents:mcpOpenSignIn', (e, id: unknown, name: unknown, host: unknown) => (fromApp(e) ? mcpOpenSignInOp(signIns, agents, id, name, host) : { ok: false, error: 'invalid request' }));
  ipcHandle('agents:mcpCancelSignIn', (e, id: unknown, name: unknown) => (fromApp(e) ? mcpCancelSignInOp({ agents, router }, signIns, id, name) : { ok: false, error: 'invalid request' }));
  /** Spec 069 FR-061: the tools turned off for one server in this agent's folder (applies to new sessions and after Restart session). */
  ipcHandle('agents:setMcpToolsOff', (_e, id: unknown, name: unknown, off: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    if (!a) return { ok: false, error: 'Unknown agent.' };
    return store().setToolsOff(keyOf(a), name as string, off);
  });
  /** Spec 069 FR-032: the tools of one server of this agent's running session, masked and cut. */
  ipcHandle('agents:mcpTools', (_e, id: unknown, name: unknown) => mcpToolsOp({ agents, router, secrets: secretValuesFor, orgTool: deps.orgTool }, id, name));
  /** Spec 100 FR-003: the last figures; `open` asks first, at most once a minute. Names and numbers only (FR-040). */
  ipcHandle('agents:mcpContext', (_e, id: unknown, open: unknown) => contexts.get(id, open));
  /** Spec 100 FR-012: the last figures per agent app, for Settings. */
  ipcHandle('mcp:costs', () => {
    const c = deps.costs?.();
    if (!c) return { ok: false, costs: {} };
    // FR-012: a figure of a server no list has any more goes; a list that could not be read keeps its app's figures
    const gn = deps.globalNames?.() ?? {};
    const running = new Map<string, string[]>();
    for (const [id, list] of live) {
      const app = deps.appOf?.(id);
      if (app) running.set(app, [...(running.get(app) ?? []), ...list.map((x) => x.name)]);
    }
    let extras: string[] = [];
    let cliList: string[] = [];
    try {
      extras = store().extraNames([]);
      cliList = cliNames();
    } catch {
      return { ok: true, costs: c.all() }; // the store is not ready: nothing is pruned on a guess
    }
    const known: Record<string, string[]> = {};
    for (const app of ['copilot', 'claude', 'codex']) known[app] = [...(gn[app as GlobalApp] ?? []), ...extras, ...(running.get(app) ?? []), ...(app === 'copilot' ? cliList : [])];
    c.prune(known);
    return { ok: true, costs: c.all() };
  });
  ipcHandle('agents:setMcp', async (_e, id: unknown, name: unknown, enabled: unknown) => {
    const r = await setMcpOp({ agents, router, wsKey: keyOf, orgMcpRefusal: async (a, n) => { const v = await deps.orgMcp?.(a.id, serverDefOf(a.id, n)); return v?.refuse ? `${v.why}: it cannot be switched on.` : undefined; } }, off, id, name, enabled);
    if (r.ok && typeof id === 'string' && typeof name === 'string') { const t = touched.get(id) ?? new Set<string>(); t.add(name); touched.set(id, t); }
    return r;
  });

  return {
    secretValuesFor,
    optionsFor(agentId: string) {
      const a = agents.get(agentId);
      if (!a) return { mcpServers: {}, disabledMcpServers: [...(off.get(agentId) ?? [])] };
      // Only this agent's own folder's extras are passed (spec 020 FR-012).
      const r = store().forSession(keyOf(a), off.get(agentId) ?? [], cliNames());
      launched.set(agentId, new Set(r.disabledMcpServers));
      touched.delete(agentId);
      // Spec 069 FR-009: the agent app's own user list that Durbar passes itself (Claude Code); a folder extra of the same name wins.
      const toolsOff = store().toolsOffFor(keyOf(a)); // spec 069 FR-061/FR-062
      return { mcpServers: mergeSessionServers(deps.globalFor?.(agentId) ?? {}, r.mcpServers, off.get(agentId)), disabledMcpServers: r.disabledMcpServers, ...(Object.keys(toolsOff).length ? { disabledMcpTools: toolsOff } : {}) };
    },
  };
}

export { BUILTIN_SERVERS };
