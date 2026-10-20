/**
 * Dev tool, USES AI CREDITS (spec 044, owner-approved 2026-10-20): does a READ-ONLY MCP tool run in a Read-only Copilot session?
 * The real `CopilotAdapter` in Read-only mode, one tiny stdio MCP server with one tool `echo` (annotations `readOnlyHint: true`;
 * the server file is given as argument and logs each `tools/call` to `calls.log` beside it), one prompt asking for that tool.
 * Records the permission request kinds the runtime sent to Durbar's broker, Durbar's decisions, the tool events and whether the server
 * really received the call. Not part of `npm test`.
 *   npx tsx scripts/mcp-readonly-copilot-real.ts <echo-server.js> <empty-folder> [write]
 */
import { CopilotAdapter } from '../src/adapters/copilot';
import type { AgentEvent } from '../src/adapters/types';
import * as fs from 'fs';
import * as path from 'path';

type Raw = { type: string; data?: Record<string, unknown> };
class M extends CopilotAdapter {
  raw(sid: string): any { return (this as any).sessions.get(sid)?.session; } // eslint-disable-line @typescript-eslint/no-explicit-any
  rawClient(): Promise<any> { return this.getClient(); } // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function main(): Promise<void> {
  const [server, folder, hint] = process.argv.slice(2);
  const readOnlyHint = hint !== 'write'; // 'write': the same tool without readOnlyHint, to see the broker's answer
  if (!server || !folder) throw new Error('usage: mcp-readonly-copilot-real.ts <echo-server.js> <empty-folder>');
  fs.mkdirSync(folder, { recursive: true });
  const callsLog = path.join(path.dirname(server), 'calls.log');
  fs.rmSync(callsLog, { force: true });
  const ad = new M();
  const norm: AgentEvent[] = [];
  ad.onEvent((e) => norm.push(e));
  const evs: Raw[] = [];
  const sid = await ad.start({
    workspace: folder, model: 'auto', autoTier: 'efficiency', maxAiCredits: 30, quiet: true, permissionMode: 'read-only',
    mcpServers: { echo: { type: 'stdio', command: process.execPath, args: [server], tools: ['*'], env: { ECHO_READONLY: readOnlyHint ? '1' : '0' } } },
  } as never);
  ad.raw(sid).on((e: Raw) => evs.push({ type: e.type, data: e.data }));
  try {
    const idle = new Promise<void>((resolve) => { const t = setInterval(() => { if (evs.some((e) => e.type === 'session.idle')) { clearInterval(t); resolve(); } }, 200); setTimeout(() => { clearInterval(t); resolve(); }, 120000); });
    await ad.send(sid, { text: 'Call the echo tool of the echo MCP server once with text "hi", then reply with exactly what it returned. Use no other tool.' });
    await idle;
    const perms = norm.filter((e) => e.type === 'permission' || (e.type === 'status' && (e as { permission?: unknown }).permission)).map((e) => {
      const p = (e as { permission?: { kind?: string; summary?: string; state?: string; via?: string } }).permission;
      return { event: e.type, kind: p?.kind, summary: p?.summary, state: p?.state, via: p?.via };
    });
    const tools = evs.filter((e) => /^tool\.|permission/.test(e.type)).map((e) => ({ type: e.type, toolName: (e.data as { toolName?: unknown; mcpToolName?: unknown })?.toolName, mcpServerName: (e.data as { mcpServerName?: unknown })?.mcpServerName, success: (e.data as { success?: unknown })?.success, kind: ((e.data as { permissionRequest?: { kind?: unknown } })?.permissionRequest)?.kind }));
    const answer = evs.filter((e) => e.type === 'assistant.message').map((e) => String((e.data as { content?: unknown })?.content ?? '')).join(' ').slice(0, 160);
    const nano = evs.filter((e) => e.type === 'assistant.usage').reduce((s, e) => s + Number((e.data as { copilotUsage?: { totalNanoAiu?: number } })?.copilotUsage?.totalNanoAiu ?? 0), 0);
    const mcpLoaded = evs.filter((e) => e.type === 'session.mcp_servers_loaded').map((e) => JSON.stringify(e.data).slice(0, 300));
    console.log(JSON.stringify({ readOnlyHint, mcpLoaded: mcpLoaded.map((m) => m.slice(0, 80)), durbarPermissions: perms, toolEvents: tools, serverReceivedCalls: fs.existsSync(callsLog) ? fs.readFileSync(callsLog, 'utf8').trim().split('\n').length : 0, answer, aiCredits: nano / 1e9 }, null, 2));
  } finally {
    await ad.stop(sid).catch(() => undefined);
    await (await ad.rawClient()).deleteSession(sid).catch(() => undefined);
    await (await ad.rawClient()).stop();
  }
}
main().catch((e) => { console.error('FAILED', String(e instanceof Error ? e.message : e).slice(0, 300)); process.exit(1); });
