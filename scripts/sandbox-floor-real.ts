/**
 * Dev tool for spec 087 T060 (real check of the OS sandbox floor). Not part of `npm test`, never run in CI.
 *
 * **Dry by default: no prompt, no credits, no Copilot session.** A dry run prints the plan (the exact prompt, the cost cap) and:
 *  - Claude Code: runs Durbar's adapter up to the spawn, records the argv (with the `--settings` JSON and its `sandbox` block), and
 *    replaces EVERY spawn except `claude --version` with a process that exits at once (fail closed: no path match decides it);
 *  - Copilot: starts nothing (a start would open the signed-in SDK client and create a real session); it prints the `sandboxConfig`
 *    Durbar would send, built by the same pure function the adapter uses, for an assumed supported host.
 * **`--spend` runs ONE real prompt** through Durbar's own adapter (the same start/send and launch path the app uses, sandbox block
 * included, without the Electron window). It needs the owner's OK first (AGENTS.md: do not spend AI credits), prints the prompt and
 * the cost cap before it starts, and refuses when `CI` is set.
 *
 *   node dist-scripts/scripts/sandbox-floor-real.js <claude|copilot> <out.json> [ask] [--spend]
 *
 * Read-only (default): one prompt asks to `touch sandbox-probe.txt` in the session folder. Claude Code's Read-only denies Bash, so the
 * script passes the accepted folder rule `Bash(touch:*)` (spec 087 US1, spec 061), the one Read-only path that runs a shell; Copilot
 * has no folder rules (its broker answers first). `ask` (Copilot only, spec 087 K8/K15): Ask first, and the prompt asks to `touch` a
 * file in a second throw-away folder that is not a session root; the script approves only a shell request whose summary is EXACTLY
 * `run touch <that file>` and denies anything else.
 *
 * Output: sandbox events, permission requests, tool calls, the answer, usage, Copilot event types (and `sandbox.decision`'s bounded
 * enum fields), whether the probe file exists. Every text goes through Durbar's `redact` and has the home folder masked; no session
 * id is written. Temp folders, the Copilot session and Claude's transcript of this session are removed in a `finally`. Exit 1 when
 * the run failed or the sandbox never came `on`. Run with `TMPDIR` and every `CLAUDE*` variable unset, outside your own tool's sandbox.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CLAUDE_DESCRIPTOR } from '../src/adapters/claude';
import { COPILOT_DESCRIPTOR } from '../src/adapters/copilot';
import { copilotSandboxConfig } from '../src/adapters/copilotSandbox';
import { EventMapper } from '../src/adapters/map';
import type { AgentAdapter, AgentEvent } from '../src/adapters/types';
import { pathDirs } from '../src/shared/pathdirs';
import { redact } from '../src/shared/redact';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cp = require('child_process') as typeof import('child_process'); // the real module object (an import star is a read-only copy)

const args = process.argv.slice(2);
const spend = args.includes('--spend');
const [app, outFile, third] = args.filter((a) => a !== '--spend') as ['claude' | 'copilot', string, string | undefined];
const askOutside = third === 'ask';
if (!['claude', 'copilot'].includes(app) || !outFile || (third !== undefined && third !== 'ask')) throw new Error('usage: sandbox-floor-real.js <claude|copilot> <out.json> [ask] [--spend]');
if (askOutside && app !== 'copilot') throw new Error('ask: Copilot only');
if (spend && process.env.CI) throw new Error('refused: --spend never runs under CI');
const HOME = os.homedir();
const clean = (s: unknown, max = 400): string => redact(String(s ?? '')).split(HOME).join('~').slice(0, max);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let t0 = Date.now();
const now = (): number => Date.now() - t0;

/** The agent app's spawns, argv cleaned. In a dry run every spawn but `--version` is replaced (fail closed). */
const spawns: Array<{ file: string; args: string[]; replaced: boolean }> = [];
const cpm = cp as unknown as { spawn: (...a: unknown[]) => unknown };
const origSpawn = cpm.spawn;
cpm.spawn = function (this: unknown, ...a: unknown[]): unknown {
  const [file, argv] = a as [unknown, unknown];
  const list = Array.isArray(argv) ? argv.map(String) : [];
  const isVersion = list.length === 1 && list[0] === '--version';
  const replace = !spend && !isVersion;
  if (!isVersion) spawns.push({ file: clean(file, 300), args: list.map((x) => clean(x, 4000)), replaced: replace });
  if (replace) return origSpawn.apply(this, [process.execPath, ['-e', 'process.exit(3)'], ...a.slice(2)]);
  return origSpawn.apply(this, a);
};
/**
 * Copilot's vendor stream: event types, and for `sandbox.decision` only its bounded fields (`read:` `session-events.schema.json` of
 * `@github/copilot-sdk-linux-x64` 1.0.22): enum values (a short lower-case word), booleans and counts. Never `command`,
 * `deniedResource`, `processName`, `toolCallId` or `effectiveFilesystemPolicy` (they can hold paths or commands).
 */
const rawTypes: string[] = [];
const DECISION_ENUMS = ['kind', 'outcome', 'control', 'enforcementPoint', 'backend', 'degradationReason', 'platform', 'policySource', 'proxyMode', 'attestation', 'confidence', 'denialClass', 'permissiveSource', 'source'];
const DECISION_FLAGS = ['addCurrentWorkingDirectory', 'allowBypass', 'allowLocalNetwork', 'allowOutbound', 'ghAuth', 'gitAuth', 'keychainAccess'];
const DECISION_COUNTS = ['deniedPathsCount', 'readonlyPathsCount', 'readwritePathsCount', 'durationMs'];
const decisions: Array<Record<string, string | boolean | number>> = [];
const mapProto = (EventMapper as unknown as { prototype: { map(x: unknown): void } }).prototype;
const origMap = mapProto.map;
mapProto.map = function (this: unknown, x: unknown): void {
  try {
    const e = x as { type?: string; data?: Record<string, unknown> };
    if (e?.type === 'sandbox.decision' && e.data && decisions.length < 50) {
      const r: Record<string, string | boolean | number> = {};
      for (const k of DECISION_ENUMS) { const v = e.data[k]; if (typeof v === 'string' && /^[a-z][a-z0-9_-]{0,40}$/.test(v)) r[k] = v; }
      for (const k of DECISION_FLAGS) { const v = e.data[k]; if (typeof v === 'boolean') r[k] = v; }
      for (const k of DECISION_COUNTS) { const v = e.data[k]; if (typeof v === 'number' && Number.isFinite(v)) r[k] = v; }
      decisions.push(r);
    }
    const w = typeof e?.data?.warningType === 'string' && /^[a-z_]{1,40}$/.test(e.data.warningType) ? ':' + e.data.warningType : '';
    rawTypes.push(`${String(e?.type).slice(0, 60)}${w}`);
  } catch { /* types only */ }
  return origMap.call(this, x);
};

async function main(): Promise<number> {
  const mode = askOutside ? 'ask' : 'read-only';
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `durbar-t060-${app}-`)));
  const outside = askOutside ? fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-t060-outside-'))) : '';
  const probe = askOutside ? path.join(outside, 'copilot-probe.txt') : path.join(dir, 'sandbox-probe.txt');
  const expected = askOutside ? `run touch ${probe}` : '';
  const prompt = askOutside
    ? `Run this exact shell command with your shell tool: touch ${probe}  Then reply with the exact error text if it failed, or only the word done.`
    : 'Run this exact shell command in the current folder with your shell tool: touch sandbox-probe.txt  Then reply with the exact error text if it failed, or only the word done.';
  const cap = app === 'claude' ? 'Claude Code, model haiku, cap $0.25' : 'Copilot, model auto (efficiency tier), cap 30 AI credits';
  console.log(`${spend ? 'SPENDING ONE PROMPT' : 'DRY RUN (no prompt; pass --spend to spend one)'}: ${app}, ${mode}; ${cap}.\nPrompt: ${clean(prompt, 600)}`);
  let ad: AgentAdapter | undefined;
  let sid = '';
  const evs: Array<AgentEvent & { t: number }> = [];
  const perms: unknown[] = [];
  try {
    fs.writeFileSync(path.join(dir, 'README.txt'), 'throw-away folder for the spec 087 T060 sandbox check\n');
    if (app === 'copilot' && !spend) {
      const plan = copilotSandboxConfig({ mode, roots: [dir], pathDirs: pathDirs(process.env, process.platform), host: { supported: true, capabilities: ['shell', 'denied_paths', 'network'] }, home: os.userInfo().homedir, platform: process.platform });
      fs.writeFileSync(outFile, clean(JSON.stringify({ app, mode, dry: true, note: 'no Copilot session was started; the sandboxConfig Durbar would send for an assumed supported host', sandboxConfig: plan }, null, 2), 200_000));
      console.log(`dry: wrote the planned sandboxConfig -> ${outFile}`);
      return 0;
    }
    ad = (app === 'claude' ? CLAUDE_DESCRIPTOR : COPILOT_DESCRIPTOR).create();
    const a = ad;
    a.onEvent((e) => {
      evs.push({ ...e, t: now() });
      const p = e.type === 'status' && e.status === 'needs-permission' ? e.permission : undefined;
      if (p && p.state === 'pending' && sid && e.sessionId === sid) {
        const ok = askOutside && p.kind === 'shell' && p.summary === expected; // exact, never a substring
        perms.push({ t: now(), kind: p.kind, summary: clean(p.summary, 200), answered: ok ? 'approve' : 'deny' });
        setTimeout(() => a.resolvePermission?.(sid, p.requestId, ok), 200); // a later tick, like the UI (docs/agent-notes.md)
      }
    });
    const base = { workspace: dir, permissionMode: mode as 'ask' | 'read-only', quiet: true };
    sid = await a.start(app === 'claude'
      ? { ...base, model: 'haiku', maxAiCredits: 0.25, folderSetup: { rules: { allow: ['Bash(touch:*)'], deny: [], ask: [] } } }
      : ({ ...base, model: 'auto', autoTier: 'efficiency', maxAiCredits: 30 } as never));
    const until = Date.now() + 20_000;
    while (Date.now() < until && !evs.some((e) => e.type === 'sandbox')) await sleep(200);
    t0 = Date.now();
    const sentAt = evs.length;
    await a.send(sid, { text: prompt });
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline && !evs.slice(sentAt).some((e) => e.type === 'status' && (e.status === 'idle' || e.status === 'error') && e.sessionId === sid)) await sleep(250);
    await sleep(1500);
    const sbx = evs.filter((e) => e.type === 'sandbox').map((e) => { const x = e as unknown as { t: number; sandbox: { reason?: string } | null; notice?: { text?: string } }; return { t: x.t, sandbox: x.sandbox ? { ...x.sandbox, ...(x.sandbox.reason ? { reason: clean(x.sandbox.reason, 200) } : {}) } : null, ...(x.notice ? { notice: clean(x.notice.text, 300) } : {}) }; });
    const usage = evs.filter((e) => e.type === 'usage') as Array<{ model?: string; costUsd?: number; nanoAiu?: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; costMultiplier?: number }>;
    const result = {
      app, mode, dry: !spend, date: new Date().toISOString(), node: process.version,
      folder: clean(dir), ...(outside ? { outside: clean(outside) } : {}),
      probeExists: fs.existsSync(probe),
      sandbox: sbx,
      perms,
      tools: evs.filter((e) => e.type === 'toolCall').map((e) => { const c = e as AgentEvent & { t: number; tool: string; phase: string; args?: unknown; output?: string }; return { t: c.t, tool: clean(c.tool, 60), phase: c.phase, ...(c.args !== undefined ? { args: clean(JSON.stringify(c.args), 300) } : {}), ...(c.output !== undefined ? { output: clean(c.output, 300) } : {}) }; }),
      answer: clean(evs.filter((e) => e.type === 'output' && (e as { final?: boolean }).final).map((e) => String((e as { text?: string }).text ?? '')).join(' ')),
      status: evs.filter((e) => e.type === 'status').map((e) => ({ t: e.t, status: (e as { status?: string }).status, intent: clean((e as { intent?: string }).intent, 200) })),
      usage: { models: [...new Set(usage.map((u) => u.model).filter(Boolean))], calls: usage.length, costUsd: usage.reduce((s, u) => s + (u.costUsd ?? 0), 0), aiu: usage.reduce((s, u) => s + (u.nanoAiu ?? 0), 0) / 1e9, in: usage.reduce((s, u) => s + (u.inputTokens ?? 0), 0), out: usage.reduce((s, u) => s + (u.outputTokens ?? 0), 0), cacheRead: usage.reduce((s, u) => s + (u.cacheReadTokens ?? 0), 0), multipliers: [...new Set(usage.map((u) => u.costMultiplier).filter((x) => x !== undefined))] },
      spawns,
      rawTypes: [...new Set(rawTypes)],
      decisions,
    };
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
    const on = sbx.some((x) => (x.sandbox as { state?: string } | null)?.state === 'on');
    console.log(`done ${app}: sandbox on=${on} probeExists=${result.probeExists} tools=${result.tools.length} -> ${outFile}`);
    return spend && !on ? 1 : 0; // a real run whose sandbox never came on proves nothing
  } finally {
    if (ad && sid) {
      await ad.stop(sid).catch(() => undefined);
      const del = (ad as unknown as { deleteSession?: (s: string) => Promise<void> }).deleteSession;
      if (app === 'copilot' && del) await del.call(ad, sid).catch(() => undefined);
      // Claude: only this session's transcript, in this folder's own project directory (removed when empty); a non-UUID id is never a path
      if (app === 'claude' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) {
        const proj = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(HOME, '.claude'), 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'));
        fs.rmSync(path.join(proj, `${sid}.jsonl`), { force: true });
        try { if (fs.readdirSync(proj).length === 0) fs.rmdirSync(proj); } catch { /* not there */ }
      }
    }
    await ad?.dispose().catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
    if (outside) fs.rmSync(outside, { recursive: true, force: true });
  }
}
main().then((code) => process.exit(code), (e) => { console.error('FAILED', clean(e instanceof Error ? e.message : e, 300)); process.exit(1); });
