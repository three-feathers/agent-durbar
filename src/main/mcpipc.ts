/** IPC for the Copilot CLI MCP list (global, read live), the per-folder MCP extras and the per-agent MCP switches (specs 019, 020). The renderer never receives a secret value or a file path. */
import { ipcMain, safeStorage } from 'electron';
import * as path from 'path';
import type { AgentInfo, AgentMcpEntry, McpFolderState, McpState } from '../shared/api';
import type { McpServerStatus } from '../adapters/types';
import type { McpServerSpec } from '../shared/mcp';
import type { CopilotAdapter } from '../adapters/copilot';
import type { DevEnv } from './devhooks';
import { BUILTIN_SERVERS, cliServers, copilotDir } from './mcpfiles';
import { applyFolderImport, MAX_IMPORT_FOLDERS, previewFolderImport } from './mcpimport';
import { McpStore } from './mcpstore';
import type { SecretCodec } from './mcpstore';

/**
 * OS-protected secret storage. On Linux Electron may fall back to a hard-coded key ("basic_text"): that is not protection,
 * so it counts as unavailable and secrets stay in memory only.
 */
export const safeStorageCodec: SecretCodec = {
  available: () => {
    try {
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

const trunc = (v: unknown, n: number): string => String(v ?? '').slice(0, n);
/** The folder/workspace an agent belongs to: the key of the saved folder list and of the MCP extras. */
const keyOf = (a: AgentInfo): string => a.workspaceFile ?? a.cwd;
const nameOfKey = (key: string): string => path.basename(key).replace(/\.code-workspace$/i, '') || key;

export function registerMcpIpc(deps: { store: () => McpStore; agents: Map<string, AgentInfo>; adapter: CopilotAdapter; dev: DevEnv }): { optionsFor(agentId: string): { mcpServers: Record<string, McpServerSpec>; disabledMcpServers: string[] } } {
  const { agents, adapter, dev } = deps;
  const store = deps.store;
  /** Per agent id, this run only: servers the user switched off for that agent. */
  const off = new Map<string, Set<string>>();
  /** Latest MCP state the runtime reported per session. */
  const live = new Map<string, McpServerStatus[]>();
  adapter.onEvent((e) => {
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

  ipcMain.handle('mcp:state', () => state());
  /** Names of every saved folder's extras, nothing else (spec 024 FR-016). No arguments; names that equal a CLI/built-in server are left out. */
  ipcMain.handle('mcp:extraNames', () => ({ ok: true, names: store().extraNames(cliNames()) }));
  ipcMain.handle('mcp:setCli', (_e, name: unknown, enabled: unknown) => {
    if (typeof name !== 'string' || !name || name.length > 64) return { ok: false };
    store().setAmbientDisabled(name, enabled !== true);
    return { ok: true };
  });
  ipcMain.handle('mcp:folderState', (_e, key: unknown): McpFolderState | { ok: false; error: string } => (knownKey(key) ? folderState(key) : bad));
  ipcMain.handle('mcp:upsert', (_e, key: unknown, input: unknown, originalName: unknown) => {
    if (!knownKey(key)) return bad;
    try {
      return store().upsert(key, input, typeof originalName === 'string' ? originalName : undefined, cliNames());
    } catch {
      return { ok: false, error: 'Could not save the server list.' };
    }
  });
  ipcMain.handle('mcp:remove', (_e, key: unknown, name: unknown) => ({ ok: knownKey(key) && typeof name === 'string' && store().remove(key, name) }));
  ipcMain.handle('mcp:setEnabled', (_e, key: unknown, name: unknown, enabled: unknown, trustAck: unknown) =>
    knownKey(key) && typeof name === 'string' ? store().setEnabled(key, name, enabled === true, trustAck === true) : { ok: false, error: 'Unknown server.' });
  ipcMain.handle('mcp:moveLegacy', (_e, name: unknown, key: unknown) => (knownKey(key) && typeof name === 'string' ? store().moveLegacy(name, key, cliNames()) : bad));
  /** Per-folder import from `.vscode/mcp.json` (spec 020 FR-020): preview, then apply the ticked ids. Read-only for the file; imported servers arrive off and untrusted. */
  ipcMain.handle('mcp:importPreview', (_e, key: unknown) => {
    if (!knownKey(key)) return { ...bad, label: '.vscode/mcp.json', files: [], items: [], digest: '', skipped: 0 };
    return previewFolderImport(dirsOf(key), store().list(key), cliNames());
  });
  ipcMain.handle('mcp:importApply', (_e, key: unknown, ids: unknown, digest: unknown) => {
    if (!knownKey(key)) return { ...bad, imported: [], failed: [] };
    if (!Array.isArray(ids) || typeof digest !== 'string') return { ok: false, error: 'Nothing selected.', imported: [], failed: [] };
    try {
      return applyFolderImport(store(), key, dirsOf(key), ids as string[], digest, cliNames());
    } catch {
      return { ok: false, error: 'Could not save the server list.', imported: [], failed: [] };
    }
  });
  ipcMain.handle('mcp:removeLegacy', (_e, name: unknown) => ({ ok: typeof name === 'string' && store().removeLegacy(name) }));

  ipcMain.handle('agents:mcp', (_e, id: unknown): { ok: boolean; servers: AgentMcpEntry[]; live: boolean } => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    if (!a) return { ok: false, servers: [], live: false };
    const s = store();
    const mine = off.get(a.id) ?? new Set<string>();
    const status = new Map((live.get(a.id) ?? []).map((x) => [x.name, x]));
    const entries: AgentMcpEntry[] = [];
    const seen = new Set<string>();
    const add = (name: string, origin: AgentMcpEntry['origin'], defaultOn: boolean): void => {
      if (seen.has(name)) return;
      seen.add(name);
      const st = status.get(name);
      entries.push({ name, origin, status: st?.status, error: st?.error, defaultOn, off: mine.has(name) });
    };
    const dis = new Set(s.ambientDisabled());
    const c = cli().servers;
    for (const am of c) add(am.name, 'cli', am.enabled);
    const names = new Set(c.map((x) => x.name.toLowerCase()));
    for (const v of s.list(keyOf(a))) if (!names.has(v.name.toLowerCase())) add(v.name, 'folder', v.enabled && v.trusted && !v.needsSecrets);
    for (const x of live.get(a.id) ?? []) add(x.name, 'runtime', !dis.has(x.name));
    return { ok: true, servers: entries, live: adapter.isLive(a.id) };
  });
  ipcMain.handle('agents:setMcp', async (_e, id: unknown, name: unknown, enabled: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    if (!a || typeof name !== 'string' || !name || name.length > 64) return { ok: false, error: 'unknown agent or server' };
    const set = off.get(a.id) ?? new Set<string>();
    if (enabled === true) set.delete(name);
    else set.add(name);
    off.set(a.id, set);
    if (!adapter.isLive(a.id)) return { ok: true };
    try {
      await adapter.setMcpEnabled(a.id, name, enabled === true);
      return { ok: true };
    } catch (err) {
      // e.g. a server that was not part of this session at start: it comes in with the next start
      return { ok: true, error: `Saved for this agent. The running session could not apply it now (${trunc(err instanceof Error ? err.message : err, 120)}); it applies at the next start.` };
    }
  });

  return {
    optionsFor(agentId: string) {
      const a = agents.get(agentId);
      if (!a) return { mcpServers: {}, disabledMcpServers: [...(off.get(agentId) ?? [])] };
      // Only this agent's own folder's extras are passed (spec 020 FR-012).
      const r = store().forSession(keyOf(a), off.get(agentId) ?? [], cliNames());
      return { mcpServers: r.mcpServers, disabledMcpServers: r.disabledMcpServers };
    },
  };
}

export { BUILTIN_SERVERS };
