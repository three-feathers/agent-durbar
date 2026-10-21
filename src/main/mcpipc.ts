/** IPC for the Copilot CLI MCP list (global, read live), the per-folder MCP extras and the per-agent MCP switches (specs 019, 020). The renderer never receives a secret value or a file path. */
import { safeStorage } from 'electron';
import { ipcHandle } from './ipcguard';
import * as path from 'path';
import type { AgentInfo, AgentMcpEntry, GlobalApp, McpFolderState, McpSourceTag, McpState } from '../shared/api';
import type { McpServerStatus } from '../adapters/types';
import { setMcpOp } from './agentops';
import type { AdapterRouter } from '../adapters/router';
import type { McpServerSpec } from '../shared/mcp';
import type { DevEnv } from './devhooks';
import { BUILTIN_SERVERS, cliServers, copilotDir } from './mcpfiles';
import { applyFolderImport, MAX_IMPORT_FOLDERS, previewFolderImport } from './mcpimport';
import { maskMcpError, mcpSecretValues } from './mcpmask';
import { claudeOffKey, sourcesFor } from './mcpglobal';
import { McpStore } from './mcpstore';
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
  /** The agent app of an agent (`copilot`, `claude`, `codex`, ...). */
  appOf?(agentId: string): string | undefined;
}): { optionsFor(agentId: string): { mcpServers: Record<string, McpServerSpec>; disabledMcpServers: string[] }; secretValuesFor(agentId: string): string[] } {
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
      return mcpSecretValues({ ...(deps.globalFor?.(agentId) ?? {}), ...store().forSession(keyOf(a), off.get(agentId) ?? [], cliNames()).mcpServers });
    } catch {
      return []; // store not ready or unreadable: the shape-based masking still runs, and the event is not lost
    }
  };
  router.onEvent((e) => {
    if (e.type === 'mcp') live.set(e.sessionId, e.servers);
    else if (e.type === 'status' && e.status === 'stopped') live.delete(e.sessionId);
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

  ipcHandle('agents:mcp', (_e, id: unknown): { ok: boolean; servers: AgentMcpEntry[]; live: boolean } => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    if (!a) return { ok: false, servers: [], live: false };
    const s = store();
    const secrets = secretValuesFor(a.id);
    const mine = off.get(a.id) ?? new Set<string>();
    const status = new Map((live.get(a.id) ?? []).map((x) => [x.name, x]));
    const entries: AgentMcpEntry[] = [];
    const seen = new Set<string>();
    const add = (name: string, origin: AgentMcpEntry['origin'], defaultOn: boolean): void => {
      if (seen.has(name)) return;
      seen.add(name);
      const st = status.get(name);
      entries.push({ name, origin, status: st?.status, error: maskMcpError(st?.error, secrets), defaultOn, off: mine.has(name) });
    };
    const dis = new Set(s.ambientDisabled());
    // Spec 069 FR-009/FR-011: each agent app's own list. Copilot loads the Copilot CLI list itself; Durbar passes Claude Code's list to
    // Claude sessions; Codex reports its own list as the session runs (runtime rows).
    const app = deps.appOf?.(a.id);
    const gn = deps.globalNames?.() ?? {};
    const c = app === 'claude' || app === 'codex' ? [] : cli().servers;
    for (const am of c) add(am.name, 'cli', am.enabled);
    if (app === 'claude') for (const n of gn.claude ?? []) add(n, 'cli', !dis.has(claudeOffKey(n)));
    const names = new Set([...c.map((x) => x.name.toLowerCase()), ...(app === 'claude' ? (gn.claude ?? []).map((n) => n.toLowerCase()) : [])]);
    const extras = s.list(keyOf(a));
    for (const v of extras) if (!names.has(v.name.toLowerCase())) add(v.name, 'folder', v.enabled && v.trusted && !v.needsSecrets);
    for (const x of live.get(a.id) ?? []) add(x.name, 'runtime', !dis.has(x.name));
    const builtin = new Set(cli().servers.filter((x) => x.origin === 'builtin').map((x) => x.name));
    const folder = new Set(extras.map((v) => v.name));
    for (const e of entries) e.sources = sourcesFor(e.name, gn, folder, builtin);
    return { ok: true, servers: entries, live: router.forAgent(a.id)?.isLive(a.id) ?? false };
  });
  ipcHandle('agents:setMcp', (_e, id: unknown, name: unknown, enabled: unknown) => setMcpOp({ agents, router, wsKey: keyOf }, off, id, name, enabled));

  return {
    secretValuesFor,
    optionsFor(agentId: string) {
      const a = agents.get(agentId);
      if (!a) return { mcpServers: {}, disabledMcpServers: [...(off.get(agentId) ?? [])] };
      // Only this agent's own folder's extras are passed (spec 020 FR-012).
      const r = store().forSession(keyOf(a), off.get(agentId) ?? [], cliNames());
      // Spec 069 FR-009: the agent app's own user list that Durbar passes itself (Claude Code); a folder extra of the same name wins.
      const mine = off.get(agentId) ?? new Set<string>();
      const glob = Object.fromEntries(Object.entries(deps.globalFor?.(agentId) ?? {}).filter(([n]) => !mine.has(n)));
      return { mcpServers: { ...glob, ...r.mcpServers }, disabledMcpServers: r.disabledMcpServers };
    },
  };
}

export { BUILTIN_SERVERS };
