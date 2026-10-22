/**
 * Spec 069: IPC for the agent apps' user-level MCP lists. Reads give names only; adds and removes are two steps (preview, then apply
 * with the single-use token), and nothing is written before the user confirmed the per-file review in the window (FR-005).
 */
import { ipcHandle } from '../ipcguard';
import type { GlobalApp } from '../../shared/api';
import { claudeOffKey, GLOBAL_APPS, offOf } from '../mcpglobal';
import type { GlobalLists } from '../mcpglobalio';

export interface McpGlobalIpcDeps {
  lists(): GlobalLists;
  /** The Settings off-list (`McpStore.ambientDisabled`). */
  offList(): string[];
  setOff(key: string, off: boolean): void;
}

export function register(deps: McpGlobalIpcDeps): void {
  ipcHandle('mcp:globalState', () => deps.lists().state((app) => offOf(app, deps.offList())));
  ipcHandle('mcp:globalPreview', (_e, input: unknown, apps: unknown, mode: unknown) => deps.lists().preview(input, apps, mode));
  ipcHandle('mcp:globalApply', (_e, token: unknown, replace: unknown) => deps.lists().apply(token, replace));
  ipcHandle('mcp:globalRemovePreview', (_e, name: unknown, apps: unknown) => deps.lists().removePreview(name, apps));
  ipcHandle('mcp:globalRemoveApply', (_e, token: unknown) => deps.lists().apply(token));
  ipcHandle('mcp:globalSetOff', (_e, app: unknown, name: unknown, off: unknown) => {
    if (!GLOBAL_APPS.includes(app as GlobalApp) || app === 'codex' || typeof name !== 'string' || !name || name.length > 64) return { ok: false };
    deps.setOff(app === 'claude' ? claudeOffKey(name) : name, off === true);
    return { ok: true };
  });
}
