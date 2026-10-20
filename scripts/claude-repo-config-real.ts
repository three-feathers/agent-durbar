/**
 * Dev tool, USES A FEW CENTS (spec 012 T083, #289; owner-approved 2026-10-20): a folder's own `.claude/settings.json` (hooks and
 * `permissions.allow`) and `.mcp.json` must NOT be used in a Claude session started by Durbar's `ClaudeAdapter` (`--setting-sources ""`,
 * `--strict-mcp-config`). One Read-only `haiku` session in the prepared folder, one prompt that makes Claude use a tool. The hooks only
 * `touch` marker files and the `.mcp.json` server logs `initialize` to its `calls.log`; afterwards the script reports which markers
 * exist and whether the server was started. Not part of `npm test`.
 *   npx tsx scripts/claude-repo-config-real.ts <claude-binary> <prepared-folder> <markers-folder> <server-calls.log>
 */
import { ClaudeAdapter } from '../src/adapters/claude';
import type { AgentEvent } from '../src/adapters/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function main(): Promise<void> {
  const [bin, folder, markers, callsLog] = process.argv.slice(2);
  if (!bin || !folder || !markers || !callsLog) throw new Error('usage: claude-repo-config-real.ts <claude> <folder> <markers> <calls.log>');
  for (const f of fs.readdirSync(markers)) fs.rmSync(path.join(markers, f));
  fs.rmSync(callsLog, { force: true });
  const ad = new ClaudeAdapter({ claudePath: async () => bin });
  const evs: AgentEvent[] = [];
  ad.onEvent((e) => evs.push(e));
  const sid = await ad.start({ workspace: folder, permissionMode: 'read-only', model: 'haiku', quiet: true, maxAiCredits: 0.25 } as never);
  await ad.send(sid, { text: 'Read the file hello.txt with your Read tool, then reply with only its first word. Also list the names of any MCP servers you can use, or say none.' });
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    if (evs.some((e) => e.type === 'status' && ((e as { status?: string }).status === 'idle' || (e as { status?: string }).status === 'error'))) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  await new Promise((r) => setTimeout(r, 1500));
  const tools = evs.filter((e) => e.type === 'toolCall').map((e) => ({ tool: (e as { tool?: string }).tool, phase: (e as { phase?: string }).phase, mcpServer: (e as { mcpServer?: string }).mcpServer }));
  const answer = evs.filter((e) => e.type === 'output' && (e as { final?: boolean }).final).map((e) => String((e as { text?: string }).text ?? '')).join(' ').slice(0, 200);
  const mcp = evs.filter((e) => e.type === 'mcp').map((e) => (e as { servers?: Array<{ name?: string }> }).servers?.map((x) => x.name));
  const usd = evs.filter((e) => e.type === 'usage').reduce((s, e) => s + Number((e as { costUsd?: number }).costUsd ?? 0), 0);
  const perms = evs.filter((e) => e.type === 'permission').map((e) => (e as { permission?: { kind?: string; state?: string } }).permission);
  console.log(JSON.stringify({
    hookMarkers: fs.readdirSync(markers),
    repoMcpServerStarted: fs.existsSync(callsLog),
    tools, mcpStatus: mcp, permissions: perms, answer, costUsd: Math.round(usd * 1e5) / 1e5,
    eventTypes: [...new Set(evs.map((e) => e.type))],
  }, null, 2));
  await ad.stop(sid).catch(() => undefined);
  // the throw-away session's transcript is removed (only this session id, only in Claude's projects folder)
  const projects = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects');
  for (const d of fs.existsSync(projects) ? fs.readdirSync(projects) : []) fs.rmSync(path.join(projects, d, `${sid}.jsonl`), { force: true });
}
main().catch((e) => { console.error('FAILED', String(e instanceof Error ? e.message : e).slice(0, 300)); process.exit(1); });
