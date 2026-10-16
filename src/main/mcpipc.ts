/** IPC for the global MCP settings and the per-agent MCP switches (spec 019). The renderer never receives a secret value or a file path. */
import { ipcMain, safeStorage } from 'electron';
import { randomUUID } from 'crypto';
import * as path from 'path';
import type { AgentInfo, AgentMcpEntry, McpImportPreview, McpState } from '../shared/api';
import type { McpServerStatus } from '../adapters/types';
import type { McpServerSpec } from '../shared/mcp';
import type { CopilotAdapter } from '../adapters/copilot';
import type { ImportCandidate } from '../shared/mcpimport';
import { vscodeUserDirs } from '../adapters/vscodeChat';
import type { DevEnv } from './devhooks';
import { BUILTIN_SERVERS, ambientServers, copilotDir, readCandidates, vscodeMcpFiles } from './mcpfiles';
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
  const imports = new Map<string, ImportCandidate[]>();

  const state = (): McpState => {
    const s = store();
    return {
      servers: s.list(),
      ambient: ambientServers(copilotDir(dev), new Set(s.ambientDisabled())),
      secretsPersist: s.secretsPersist,
      skipped: s.forSession().skipped,
    };
  };

  ipcMain.handle('mcp:state', () => state());
  ipcMain.handle('mcp:upsert', (_e, input: unknown, originalName: unknown) => {
    try {
      return store().upsert(input, typeof originalName === 'string' ? originalName : undefined);
    } catch {
      return { ok: false, error: 'Could not save the server list.' };
    }
  });
  ipcMain.handle('mcp:remove', (_e, name: unknown) => ({ ok: typeof name === 'string' && store().remove(name) }));
  ipcMain.handle('mcp:setEnabled', (_e, name: unknown, enabled: unknown, trustAck: unknown) =>
    typeof name === 'string' ? store().setEnabled(name, enabled === true, trustAck === true) : { ok: false, error: 'Unknown server.' });
  ipcMain.handle('mcp:setAmbient', (_e, name: unknown, enabled: unknown) => {
    if (typeof name !== 'string') return { ok: false };
    store().setAmbientDisabled(name, enabled !== true);
    return { ok: true };
  });

  ipcMain.handle('mcp:importPreview', (_e, source: unknown): McpImportPreview => {
    const kind = source === 'vscode' ? 'vscode' : 'copilot';
    const files = kind === 'copilot' ? [path.join(copilotDir(dev), 'mcp-config.json')] : vscodeMcpFiles(dev.DURBAR_VSCODE_USER_DIR ? [{ dir: dev.DURBAR_VSCODE_USER_DIR }] : vscodeUserDirs());
    const candidates: ImportCandidate[] = [];
    const shown: string[] = [];
    let skipped = 0;
    let error: string | undefined;
    for (const f of files) {
      const r = readCandidates(f, kind);
      if (!r) continue;
      shown.push(f);
      skipped += r.skipped;
      error = error ?? r.error;
      for (const c of r.candidates) candidates.push({ ...c, name: candidates.some((x) => x.name.toLowerCase() === c.name.toLowerCase()) ? `${c.name.slice(0, 44)}-${candidates.length + 1}` : c.name });
    }
    if (!shown.length) return { ok: false, error: kind === 'copilot' ? 'No ~/.copilot/mcp-config.json found.' : 'No VS Code user mcp.json found.', source: kind, files: [], candidates: [], skipped: 0 };
    if (error && !candidates.length) return { ok: false, error, source: kind, files: shown, candidates: [], skipped };
    const token = randomUUID();
    imports.set(token, candidates);
    for (const k of [...imports.keys()].slice(0, Math.max(0, imports.size - 4))) imports.delete(k);
    return {
      ok: true,
      token,
      source: kind,
      files: shown,
      skipped,
      candidates: candidates.map((c) => ({ name: c.name, transport: c.transport, command: c.command, args: c.args, url: c.url, envKeys: Object.keys(c.env), headerKeys: Object.keys(c.headers), notes: c.notes })),
    };
  });
  ipcMain.handle('mcp:importApply', (_e, token: unknown, names: unknown) => {
    const cands = typeof token === 'string' ? imports.get(token) : undefined;
    if (!cands) return { ok: false, error: 'The import expired. Open it again.', added: [] as string[] };
    imports.delete(token as string);
    const want = new Set(Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : []);
    return { ok: true, added: store().addImported(cands.filter((c) => want.has(c.name))) };
  });

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
    for (const v of s.list()) add(v.name, 'durbar', v.enabled && v.trusted && !v.needsSecrets);
    const dis = new Set(s.ambientDisabled());
    for (const am of ambientServers(copilotDir(dev), dis)) add(am.name, 'ambient', am.enabled);
    for (const x of live.get(a.id) ?? []) add(x.name, 'ambient', !dis.has(x.name));
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
      const r = store().forSession(off.get(agentId) ?? []);
      return { mcpServers: r.mcpServers, disabledMcpServers: r.disabledMcpServers };
    },
  };
}

export { BUILTIN_SERVERS };
