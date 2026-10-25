/**
 * Dev tool, USES AI CREDITS (spec 087 T060; owner-approved 2026-10-25, one tiny prompt per app). Not part of `npm test`, never run
 * in CI. One real Read-only session through Durbar's own adapter (the same launch path the app uses, sandbox block included) in a
 * throw-away folder under the OS temp folder, with ONE prompt that asks to `touch sandbox-probe.txt`. Records: the normalized
 * `sandbox` events (did the chip reach *Sandboxed*), the permission requests Durbar's own check saw, the tool calls (output cut to
 * 300 characters, home folder masked), whether the file exists afterwards, and usage. For Claude Code it also records the spawn
 * argv (home masked), so the `--settings` JSON with the `sandbox` block is on record. Never a token, a value from the vendor's
 * config or session data.
 *
 *   node dist-scripts/scripts/sandbox-floor-real.js <claude|copilot> <out.json> [ask]
 *
 * `ask` (Copilot only; spec 087 K8, owner-approved 2026-10-25 19:35 UTC): Ask first instead, and the prompt asks to `touch` a file
 * in a second throw-away folder that is NOT a session root. The script answers Durbar's own approval request as a person would:
 * it approves only a shell request whose summary names that probe file, and denies anything else. Then whether Copilot's OS
 * sandbox refused the approved write (file absent, error text) is recorded.
 *
 * Claude Code: Read-only denies Bash outright, so the only shell that runs in Read-only is one an accepted folder allow rule lets
 * through (spec 087 US1, spec 061). The script passes the accepted rule `Bash(touch:*)` so the command reaches the OS sandbox,
 * whose Read-only block denies writes to the folder (`denyWrite`). Copilot has no folder allow rules: the prompt is the same and
 * whatever answers first (Durbar's broker, or the OS sandbox) is recorded.
 * Run with every `CLAUDE*` variable and `TMPDIR` unset (docs/agent-notes.md); the adapter passes `--setting-sources` and `--strict-mcp-config`.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cp = require('child_process') as typeof import('child_process'); // the real module object (an import star is a read-only copy)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CLAUDE_DESCRIPTOR } from '../src/adapters/claude';
import { COPILOT_DESCRIPTOR } from '../src/adapters/copilot';
import { EventMapper } from '../src/adapters/map';
import type { AgentAdapter, AgentEvent } from '../src/adapters/types';

const app = process.argv[2] as 'claude' | 'copilot';
const outFile = process.argv[3];
const askOutside = process.argv[4] === 'ask';
if (askOutside && app !== 'copilot') throw new Error('ask: Copilot only');
if (!['claude', 'copilot'].includes(app) || !outFile) throw new Error('usage: sandbox-floor-real.js <claude|copilot> <out.json>');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const HOME = os.homedir();
const mask = (s: string): string => s.split(HOME).join('~');
let t0 = Date.now();
const now = (): number => Date.now() - t0;

/** The spawn argv of the agent app (Claude Code's CLI), home masked. */
const spawns: Array<{ file: string; args: string[] }> = [];
const cpm = cp as unknown as { spawn: (...a: unknown[]) => unknown };
const origSpawn = cpm.spawn;
cpm.spawn = function (this: unknown, ...a: unknown[]): unknown {
  try {
    const [file, args] = a as [string, string[] | undefined];
    if (Array.isArray(args) && /claude/i.test(String(file)) && !args.includes('--version')) {
      spawns.push({ file: mask(String(file)), args: args.map((x) => mask(String(x))) });
      // T060_DRY=1: record the argv, then run a process that exits at once instead of the agent app (no prompt, no credits)
      if (process.env.T060_DRY === '1') return origSpawn.apply(this, [process.execPath, ['-e', 'process.exit(3)'], ...a.slice(2)]);
    }
  } catch { /* record only */ }
  return origSpawn.apply(this, a);
};
/** Copilot's vendor stream, event types only (to see a `session.warning` of type sandbox). */
const rawTypes: string[] = [];
const orig = (EventMapper as unknown as { prototype: { map(x: unknown): void } }).prototype.map;
(EventMapper as unknown as { prototype: { map(x: unknown): void } }).prototype.map = function (this: unknown, x: unknown): void {
  try {
    const e = x as { type?: string; data?: { warningType?: string; kind?: unknown; outcome?: unknown; control?: unknown; enforcementPoint?: unknown; state?: unknown } };
    // `sandbox.decision`: only its bounded enum fields (kind, outcome, control, enforcement point, state), never a resource or command
    const d = e?.type === 'sandbox.decision' && e.data ? ':' + ['kind', 'outcome', 'control', 'enforcementPoint', 'state'].map((k) => { const v = (e.data as Record<string, unknown>)[k]; return typeof v === 'string' && /^[a-z_]{1,40}$/.test(v) ? v : '-'; }).join('/') : '';
    rawTypes.push(`${e?.type}${e?.data?.warningType ? ':' + e.data.warningType : ''}${d}`);
  } catch { /* types only */ }
  return orig.call(this, x);
};

async function main(): Promise<void> {
  const descriptor = app === 'claude' ? CLAUDE_DESCRIPTOR : COPILOT_DESCRIPTOR;
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `durbar-t060-${app}-`)));
  fs.writeFileSync(path.join(dir, 'README.txt'), 'throw-away folder for the spec 087 T060 sandbox check\n');
  const outside = askOutside ? fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-t060-outside-'))) : '';
  const probe = askOutside ? path.join(outside, 'copilot-probe.txt') : path.join(dir, 'sandbox-probe.txt');
  const ad: AgentAdapter = descriptor.create();
  const evs: Array<AgentEvent & { t: number }> = [];
  const perms: unknown[] = [];
  let sid = '';
  ad.onEvent((e) => {
    evs.push({ ...e, t: now() });
    const p = e.type === 'status' && e.status === 'needs-permission' ? e.permission : undefined;
    if (p && p.state === 'pending' && sid && e.sessionId === sid) {
      // Read-only should never ask: deny whatever does. Ask first: approve only the shell call that names the outside probe file
      const ok = askOutside && p.kind === 'shell' && String(p.summary).includes('copilot-probe.txt');
      perms.push({ t: now(), kind: p.kind, summary: mask(String(p.summary)).slice(0, 200), answered: ok ? 'approve' : 'deny' });
      setTimeout(() => ad.resolvePermission?.(sid, p.requestId, ok), 200); // a later tick, like the UI (docs/agent-notes.md)
    }
  });
  const base = { workspace: dir, permissionMode: (askOutside ? 'ask' : 'read-only') as 'ask' | 'read-only', quiet: true };
  sid = await ad.start(app === 'claude'
    ? { ...base, model: 'haiku', maxAiCredits: 0.25, folderSetup: { rules: { allow: ['Bash(touch:*)'], deny: [], ask: [] } } }
    : ({ ...base, model: 'auto', autoTier: 'efficiency', maxAiCredits: 30 } as never));
  // wait for the floor to be applied or previewed before the one send (Copilot: after options.update; Claude: the preview)
  const until = Date.now() + 20_000;
  while (Date.now() < until && !evs.some((e) => e.type === 'sandbox')) await sleep(200);
  const sandboxBeforeSend = evs.filter((e) => e.type === 'sandbox').map((e) => ({ t: e.t, ...(e as unknown as { sandbox: unknown; notice?: unknown }) }));
  t0 = Date.now();
  const sentAt = evs.length;
  if (!(app === 'copilot' && process.env.T060_DRY === '1')) await ad.send(sid, { text: askOutside ? `Run this exact shell command with your shell tool: touch ${probe}  Then reply with the exact error text if it failed, or only the word done.` : 'Run this exact shell command in the current folder with your shell tool: touch sandbox-probe.txt  Then reply with the exact error text if it failed, or only the word done.' });
  const deadline = Date.now() + (app === 'copilot' && process.env.T060_DRY === '1' ? 0 : 180_000);
  while (Date.now() < deadline && !evs.slice(sentAt).some((e) => e.type === 'status' && (e.status === 'idle' || e.status === 'error') && e.sessionId === sid)) await sleep(250);
  await sleep(1500);
  const probeExists = fs.existsSync(probe);
  const tools = evs.filter((e) => e.type === 'toolCall').map((e) => {
    const c = e as AgentEvent & { t: number; tool: string; phase: string; args?: unknown; output?: string };
    return { t: c.t, tool: c.tool, phase: c.phase, args: c.args === undefined ? undefined : mask(JSON.stringify(c.args)).slice(0, 300), output: c.output === undefined ? undefined : mask(String(c.output)).slice(0, 300) };
  });
  const usage = evs.filter((e) => e.type === 'usage') as Array<{ model?: string; costUsd?: number; nanoAiu?: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; costMultiplier?: number }>;
  const result = {
    app, mode: askOutside ? 'ask' : 'read-only', outside: outside ? mask(outside) : undefined, date: new Date().toISOString(), node: process.version,
    folder: mask(dir),
    probeExists,
    sandboxBeforeSend,
    sandbox: evs.filter((e) => e.type === 'sandbox').map((e) => ({ t: e.t, ...(e as unknown as { sandbox: unknown; notice?: unknown }) })),
    perms,
    tools,
    answer: mask(evs.filter((e) => e.type === 'output' && (e as { final?: boolean }).final).map((e) => String((e as { text?: string }).text ?? '')).join(' ')).slice(0, 400),
    status: evs.filter((e) => e.type === 'status').map((e) => ({ t: e.t, status: (e as { status?: string }).status, intent: mask(String((e as { intent?: string }).intent ?? '')).slice(0, 200) })),
    errors: evs.filter((e) => e.type === 'status' && e.status === 'error').map((e) => mask(JSON.stringify(e)).slice(0, 400)),
    usage: { models: [...new Set(usage.map((u) => u.model).filter(Boolean))], calls: usage.length, costUsd: usage.reduce((s, u) => s + (u.costUsd ?? 0), 0), aiu: usage.reduce((s, u) => s + (u.nanoAiu ?? 0), 0) / 1e9, in: usage.reduce((s, u) => s + (u.inputTokens ?? 0), 0), out: usage.reduce((s, u) => s + (u.outputTokens ?? 0), 0), cacheRead: usage.reduce((s, u) => s + (u.cacheReadTokens ?? 0), 0), multipliers: [...new Set(usage.map((u) => u.costMultiplier).filter((x) => x !== undefined))] },
    spawns,
    rawTypes: [...new Set(rawTypes)],
    eventTypes: [...new Set(evs.map((e) => e.type))],
  };
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  await ad.stop(sid).catch(() => undefined);
  const del = (ad as unknown as { deleteSession?: (s: string) => Promise<void> }).deleteSession;
  if (app === 'copilot' && del) await del.call(ad, sid).catch(() => undefined);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (app === 'claude' && UUID.test(sid)) {
    const projects = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(HOME, '.claude'), 'projects');
    for (const d of fs.existsSync(projects) ? fs.readdirSync(projects) : []) fs.rmSync(path.join(projects, d, `${sid}.jsonl`), { force: true });
  }
  await ad.dispose().catch(() => undefined);
  fs.rmSync(dir, { recursive: true, force: true });
  if (outside) fs.rmSync(outside, { recursive: true, force: true });
  console.log(`done ${app}: probeExists=${probeExists} tools=${tools.length} -> ${outFile}`);
}
main().then(() => process.exit(0), (e) => { console.error('FAILED', mask(String(e instanceof Error ? e.message : e)).slice(0, 300)); process.exit(1); });
