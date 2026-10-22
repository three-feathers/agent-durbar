/**
 * Codex and MCP (spec 012 FR-147): Durbar's MCP servers for a session (the Copilot-CLI list and the folder's extras, spec 019/020)
 * as Codex `config.mcp_servers` overrides on `thread/start`/`thread/resume`, and Codex's server states as Durbar's `mcp` event.
 * Pure. Secret values (env, headers) pass through to Codex only; they are never logged or put in an error.
 */
import type { McpServerSpec } from '../shared/mcp';
import type { McpServerStatus } from './types';
import { isObj } from '../shared/guards';

const NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** `{mcp_servers: {...}}` for the thread `config`, or undefined when there is nothing to say. Disabled names get `enabled: false`. */
export function codexMcpConfig(servers: Readonly<Record<string, McpServerSpec>> | undefined, disabled: readonly string[] = [], toolsOff: Readonly<Record<string, readonly string[]>> = {}): { mcp_servers: Record<string, Record<string, unknown>> } | undefined {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, s] of Object.entries(servers ?? {})) {
    if (!NAME.test(name) || !isObj(s)) continue;
    const tools = Array.isArray(s.tools) && s.tools.length && !s.tools.includes('*') ? { enabled_tools: s.tools.filter((t) => typeof t === 'string').slice(0, 200) } : {};
    if (typeof s.command === 'string' && s.command && (s.type === 'stdio' || !s.url)) {
      out[name] = {
        command: s.command,
        ...(Array.isArray(s.args) ? { args: s.args.filter((a) => typeof a === 'string') } : {}),
        ...(isObj(s.env) ? { env: s.env } : {}),
        ...(typeof s.workingDirectory === 'string' && s.workingDirectory ? { cwd: s.workingDirectory } : {}),
        ...tools,
      };
    } else if (typeof s.url === 'string' && /^https?:\/\//i.test(s.url)) {
      out[name] = { url: s.url, ...(isObj(s.headers) ? { http_headers: s.headers } : {}), ...tools };
    }
  }
  for (const name of disabled) if (NAME.test(name)) out[name] = { ...(out[name] ?? {}), enabled: false };
  // spec 069 FR-062: single tools turned off in Durbar, for Durbar's own servers and as an override of the user's (real: codex-cli 0.163.0,
  // 2026-10-22: a `-c` override of `disabled_tools` hides the tool in `mcpServerStatus/list`; this thread/start path not run)
  for (const [name, tools] of Object.entries(toolsOff)) {
    const list = (tools ?? []).filter((t) => typeof t === 'string' && t).slice(0, 500);
    if (NAME.test(name) && list.length) out[name] = { ...(out[name] ?? {}), disabled_tools: list };
  }
  return Object.keys(out).length ? { mcp_servers: out } : undefined;
}

const RUNTIME: Record<string, string> = { connected: 'connected', ready: 'connected', failed: 'failed', authenticationRequired: 'needs-auth', starting: 'pending', notStarted: 'pending', cancelled: 'stopped', disabled: 'disabled' };

/** One Codex status word (`runtimeStatus` of `mcpServerStatus/list`, or `status` of `mcpServer/startupStatus/updated`) to Durbar's. */
export function codexMcpState(v: unknown): string {
  return typeof v === 'string' && RUNTIME[v] ? RUNTIME[v] : 'pending';
}

/** `mcpServerStatus/list` `data` to Durbar's list (its items have `runtimeStatus`, `authStatus`, `toolsError`; no `failureReason`, that is only on the startup notification); names Durbar switched off read as disabled. */
export function codexMcpServers(data: unknown, disabled: readonly string[] = []): McpServerStatus[] {
  const out: McpServerStatus[] = [];
  for (const s of Array.isArray(data) ? data.slice(0, 100) : []) {
    if (!isObj(s) || typeof s.name !== 'string' || !s.name) continue;
    const name = s.name.slice(0, 64);
    const auth = s.authStatus === 'notLoggedIn' || s.runtimeStatus === 'authenticationRequired';
    const status = disabled.includes(name) ? 'disabled' : auth ? 'needs-auth' : codexMcpState(s.runtimeStatus ?? 'notStarted');
    const err = typeof s.toolsError === 'string' && s.toolsError ? { error: s.toolsError.slice(0, 300) } : {};
    out.push({ name, status, ...(status === 'needs-auth' ? { errorClass: 'auth' as const } : {}), ...(s.pluginId ? { source: 'plugin' } : {}), ...(s.httpOrigin ? { transport: 'http' } : {}), ...err });
  }
  return out;
}
