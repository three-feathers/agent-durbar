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
 *   node dist-scripts/scripts/sandbox-floor-real.js <claude|copilot> <out.json> [ask|switch] [--spend]
 *
 * Read-only (default): one prompt asks to `touch sandbox-probe.txt` in the session folder. Claude Code's Read-only denies Bash, so the
 * script passes the accepted folder rule `Bash(touch:*)` (spec 087 US1, spec 061), the one Read-only path that runs a shell; Copilot
 * has no folder rules (its broker answers first). `ask` (Copilot only, spec 087 K8/K15): Ask first, and the prompt asks to `touch` a
 * file in a second throw-away folder that is not a session root; the script approves only a shell request whose summary is EXACTLY
 * `run touch <that file>` and denies anything else.
 *
 * `switch` (Copilot only, spec 087 T066, K16, FR-022c): can a floor already running be cleared in place? A session folder F under the
 * temp folder and a second throw-away folder P under the HOME folder (not the temp folder: K15). The command C is `touch P/probe.txt`
 * then `curl` to example.com, each exit code printed. Step 1 (prompt 1, the control): Ask first, floor on, the card approved only for
 * exactly `run C`; C must fail, or the probe stops (it cannot tell). Step 2 (no prompt): `setPermMode(allow)` as the app does, then
 * `options.update({ sandboxConfig: { enabled: false }, sandboxConfigSource: 'session_disabled' })` on that session (resolved or refused,
 * the error masked). Step 3 (prompt 2): C again; verdict A only if the write AND the network succeed (`sandbox-switch-verdict.ts`).
 * Step 4 (prompt 3): after A, back to Ask first (the adapter re-sends the floor), C must fail; otherwise (B) stop and resume the same
 * session in Allow all (as `mcpRestartSessionOp`), read its history (no credit) and C must succeed. At most 3 prompts (session cap 30
 * credits, the runtime's minimum).
 * The session's tools are limited to the runtime's shell tool (`availableTools`/`excludedTools`, no MCP server); the list is read back
 * from the session before any prompt and the run refuses when anything else is there. Its dry run spends nothing but does start
 * the runtime: it checks the sign-in (a yes/no and the auth kind, never the login or a token), the versions and the shell tool, and
 * creates one session with no prompt (to read its tools and floor), which it deletes. F and P are removed in a `finally` (and on
 * SIGINT/SIGTERM) only when they hold nothing but the probe files.
 *
 * Output: sandbox events, permission requests, tool calls, the answer, usage, Copilot event types (and `sandbox.decision`'s bounded
 * enum fields), whether the probe file exists. Every text goes through Durbar's `redact` and has the home folder masked; no session
 * id is written: `maskArgv` masks the value after `--session-id`/`--resume`, and every UUID-shaped run is masked (`sandbox-real-mask.ts`). Temp folders, the Copilot session and Claude's transcript of this session are removed in a `finally`. Exit 1 when
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
import { maskArgv, maskIds } from './sandbox-real-mask';
import { parseExitCodes, step4Expected, stepOutcome, switchVerdict } from './sandbox-switch-verdict';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cp = require('child_process') as typeof import('child_process'); // the real module object (an import star is a read-only copy)

const args = process.argv.slice(2);
const spend = args.includes('--spend');
const [app, outFile, third] = args.filter((a) => a !== '--spend') as ['claude' | 'copilot', string, string | undefined];
const askOutside = third === 'ask';
const switchProbe = third === 'switch';
if (!['claude', 'copilot'].includes(app) || !outFile || (third !== undefined && third !== 'ask' && third !== 'switch')) throw new Error('usage: sandbox-floor-real.js <claude|copilot> <out.json> [ask|switch] [--spend]');
if ((askOutside || switchProbe) && app !== 'copilot') throw new Error(`${third}: Copilot only`);
if (spend && process.env.CI) throw new Error('refused: --spend never runs under CI');
const HOME = os.homedir();
const HOME_REAL = ((): string => { try { return fs.realpathSync(HOME); } catch { return HOME; } })(); // switch makes P under the real path
const clean = (s: unknown, max = 400): string => maskIds(redact(String(s ?? '')).split(HOME_REAL).join('~').split(HOME).join('~')).slice(0, max); // never a session id (review on PR 753)
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
  const replace = !spend && !isVersion && !switchProbe; // switch's dry run starts the runtime (no prompt is ever sent without --spend)
  if (!isVersion) spawns.push({ file: clean(file, 300), args: maskArgv(list).map((x) => clean(x, 4000)), replaced: replace });
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
let probeStep = 0; // switch: the step each `sandbox.decision` belongs to
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
      if (switchProbe) r.step = probeStep;
      decisions.push(r);
    }
    const w = typeof e?.data?.warningType === 'string' && /^[a-z_]{1,40}$/.test(e.data.warningType) ? ':' + e.data.warningType : '';
    rawTypes.push(`${String(e?.type).slice(0, 60)}${w}`);
  } catch { /* types only */ }
  return origMap.call(this, x);
};

/* ---------------- spec 087 T066: the `switch` probe (K16, FR-022c) ---------------- */

const SWITCH_PREFIX = 'durbar-t066-';
const SWITCH_CAP = 30; // AI credits per session: the runtime refuses less ("Minimum session limit is 30 AI credits", real: 2026-10-28); the budget is the 3 prompts
const SWITCH_MAX_AIU = 1; // the script's own stop: no further prompt once the run has used this much (the 30-credit cap is far above the budget)
const SWITCH_MAX_CALLS = 4; // tool calls in one step before the turn is interrupted (a model that wanders)
const SHELL_TOOL = 'bash'; // checked against the runtime's own tool list before anything is spent
const bounded = (v: unknown): string | undefined => (typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,40}$/.test(v) ? v : undefined);
const version = (v: unknown): string | undefined => (typeof v === 'string' && /^[0-9][0-9A-Za-z.+-]{0,30}$/.test(v) ? v : undefined);
function timedOut<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} did not answer in ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer));
}
/** Remove a folder this script made, only when it is directly under `parent`, has our prefix and holds nothing but `allowed` files. */
function removeOwn(dir: string, parent: string, allowed: readonly string[]): string {
  try {
    if (!dir) return 'nothing to remove';
    if (path.dirname(dir) !== parent || !path.basename(dir).startsWith(SWITCH_PREFIX)) return `left ${clean(dir)}: not a folder this script made`;
    if (!fs.existsSync(dir)) return `already gone: ${clean(dir)}`;
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) return `left ${clean(dir)}: not a plain folder`;
    const names = fs.readdirSync(dir);
    const other = names.filter((n) => !allowed.includes(n) || !fs.lstatSync(path.join(dir, n)).isFile());
    if (other.length) return `left ${clean(dir)}: it holds ${other.length} other entr${other.length === 1 ? 'y' : 'ies'}`;
    for (const n of names) fs.unlinkSync(path.join(dir, n));
    fs.rmdirSync(dir);
    return `removed ${clean(dir)}`;
  } catch (e) {
    return `could not remove ${clean(dir)}: ${clean(e instanceof Error ? e.message : e, 200)}`;
  }
}

type RpcSession = {
  rpc: {
    options: { update(p: unknown): Promise<unknown> };
    sandbox?: { getEnforcementStatus?: () => Promise<unknown> };
    tools?: { initializeAndValidate?: () => Promise<unknown>; getCurrentMetadata?: () => Promise<{ tools?: Array<{ name?: unknown }> | null }> };
  };
  getEvents(): Promise<Array<{ type?: string }>>;
};
type Internals = { getClient(): Promise<unknown>; sessions: Map<string, { session: RpcSession; sandboxApplying?: Promise<void> }> };
type RpcClient = {
  getAuthStatus(): Promise<{ isAuthenticated?: unknown; authType?: unknown }>;
  getStatus(): Promise<{ version?: unknown; protocolVersion?: unknown }>;
  rpc: { tools?: { list?: (p: unknown) => Promise<{ tools?: Array<{ name?: unknown }> }> }; sandbox?: { getHostSupport?: () => Promise<unknown> } };
  createSession(cfg: Record<string, unknown>): Promise<unknown>;
  resumeSession(id: string, cfg: Record<string, unknown>): Promise<unknown>;
};

async function runSwitch(): Promise<number> {
  if (spend && process.env.TMPDIR) throw new Error('refused: unset TMPDIR (the session folder must be under the system temp folder)');
  const tmpRoot = fs.realpathSync(os.tmpdir());
  const homeReal = HOME_REAL;
  if (homeReal === tmpRoot || homeReal.startsWith(tmpRoot + path.sep)) throw new Error('refused: the home folder is inside the temp folder, so P would prove nothing (K15)');
  let F = '';
  let P = '';
  let ad: AgentAdapter | undefined;
  let sid = '';
  const cleanup = (): string[] => [removeOwn(P, homeReal, ['probe.txt']), removeOwn(F, tmpRoot, ['README.txt', 'probe.txt'])];
  const onSignal = (sig: string) => (): void => { console.log(`${sig}: ${cleanup().join('; ')} (the Copilot session, if any, is left on disk)`); process.exit(130); };
  process.once('SIGINT', onSignal('SIGINT'));
  process.once('SIGTERM', onSignal('SIGTERM'));
  const evs: Array<AgentEvent & { t: number }> = [];
  const perms: Array<Record<string, unknown>> = [];
  const steps: Array<Record<string, unknown>> = [];
  let curMode: 'ask' | 'allow' = 'ask';
  const out: Record<string, unknown> = { app, scenario: 'switch', dry: !spend, date: new Date().toISOString(), os: `${process.platform} ${os.release()}`, node: process.version };
  try {
    F = fs.realpathSync(fs.mkdtempSync(path.join(tmpRoot, `${SWITCH_PREFIX}session-`)));
    P = fs.realpathSync(fs.mkdtempSync(path.join(homeReal, `${SWITCH_PREFIX}outside-`)));
    const probe = path.join(P, 'probe.txt');
    if (!/^[A-Za-z0-9/._-]+$/.test(probe)) throw new Error('refused: the probe path has characters the fixed command would need to quote');
    fs.writeFileSync(path.join(F, 'README.txt'), 'throw-away folder for the spec 087 T066 sandbox switch probe\n');
    const C = `touch ${probe}; echo "touch=$?"; curl -sS -m 5 -o /dev/null https://example.com; echo "curl=$?"`;
    const expected = `run ${C}`;
    const prompt = `Run this exact shell command once with your shell tool, exactly as written, and nothing else: ${C}  Then reply with only the two lines it printed.`;
    Object.assign(out, { folder: clean(F), outside: clean(P), command: clean(C, 600), prompt: clean(prompt, 800) });
    console.log(`${spend ? 'SPENDING AT MOST 3 PROMPTS' : 'DRY RUN (no prompt; pass --spend to spend at most 3)'}: copilot, switch; model auto (efficiency tier), cap ${SWITCH_CAP} AI credits per session.`);
    console.log(`F = ${clean(F)}\nP = ${clean(P)}\nPrompt (each step): ${clean(prompt, 800)}`);
    console.log('Step 1 (prompt 1): Ask first, floor on; approve only exactly `run C`; C must fail, else stop.\nStep 2 (no prompt): setPermMode(allow), then options.update({ sandboxConfig: { enabled: false }, sandboxConfigSource: "session_disabled" }).\nStep 3 (prompt 2): C again; A only if the write and the network both succeed.\nStep 4 (prompt 3): A -> Ask first again, C must fail; B -> stop, resume in Allow all, C must succeed.');

    ad = COPILOT_DESCRIPTOR.create();
    const a = ad;
    const inner = a as unknown as Internals;
    // pre-flight, no credit: the runtime starts, but no prompt is sent
    const client = (await inner.getClient()) as RpcClient;
    const auth = await timedOut(client.getAuthStatus(), 30_000, 'getAuthStatus');
    const status = await timedOut(client.getStatus(), 30_000, 'getStatus').catch(() => ({}) as { version?: unknown; protocolVersion?: unknown });
    let sdkVersion = 'unknown';
    try { sdkVersion = String((JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'node_modules', '@github', 'copilot-sdk', 'package.json'), 'utf8')) as { version?: unknown }).version ?? 'unknown'); } catch { /* not found */ }
    const builtin = await timedOut(Promise.resolve().then(() => client.rpc.tools?.list?.({})), 30_000, 'tools.list').catch(() => undefined);
    const builtinNames = (builtin?.tools ?? []).map((t) => bounded(t.name)).filter((n): n is string => !!n);
    const host = await timedOut(Promise.resolve().then(() => client.rpc.sandbox?.getHostSupport?.()), 30_000, 'getHostSupport').catch((e: unknown) => ({ error: clean(e instanceof Error ? e.message : e, 200) }));
    Object.assign(out, {
      signedIn: auth?.isAuthenticated === true, authType: bounded(auth?.authType) ?? 'unknown',
      cliVersion: version(status?.version) ?? 'unknown', protocolVersion: typeof status?.protocolVersion === 'number' ? status.protocolVersion : 'unknown', sdkVersion,
      shellTool: builtinNames.includes(SHELL_TOOL) ? SHELL_TOOL : null, builtinTools: builtinNames.slice(0, 80),
      hostSupport: clean(JSON.stringify(host ?? null), 400),
    });
    console.log(`pre-flight: signedIn=${out.signedIn} authType=${out.authType} cli=${out.cliVersion} sdk=${sdkVersion} shellTool=${out.shellTool ?? 'MISSING'}`);
    if (auth?.isAuthenticated !== true) throw new Error('refused: no signed-in Copilot client on this computer (nothing was spent)');
    if (!builtinNames.includes(SHELL_TOOL)) throw new Error(`refused: the runtime lists no "${SHELL_TOOL}" tool, so the session cannot be limited to the shell`);
    // FR-022 review item 6: the shell tool only, no MCP server; on create AND resume (the B path resumes)
    const lock = { availableTools: [`builtin:${SHELL_TOOL}`], excludedTools: ['mcp:*', 'custom:*'], mcpServers: {} };
    const origCreate = client.createSession.bind(client);
    const origResume = client.resumeSession.bind(client);
    client.createSession = (cfg) => origCreate({ ...cfg, ...lock });
    client.resumeSession = (id, cfg) => origResume(id, { ...cfg, ...lock });

    const live = () => inner.sessions.get(sid);
    const toolsOf = async (): Promise<string[] | null> => {
      const s = live()?.session;
      await timedOut(Promise.resolve().then(() => s?.rpc.tools?.initializeAndValidate?.()), 30_000, 'tools.initializeAndValidate');
      const m = await timedOut(Promise.resolve().then(() => s?.rpc.tools?.getCurrentMetadata?.()), 30_000, 'tools.getCurrentMetadata');
      return Array.isArray(m?.tools) ? m.tools.map((t) => bounded(t.name) ?? '?').slice(0, 80) : null;
    };
    const mustBeShellOnly = async (where: string): Promise<string[]> => {
      const names = await toolsOf();
      if (!names || !names.length || names.some((n) => n !== SHELL_TOOL)) throw new Error(`refused (${where}): the session's tools could not be limited to "${SHELL_TOOL}" (it has: ${names ? names.join(', ') || 'none' : 'no list'}); nothing more is sent`);
      return names;
    };
    const enforcement = async (): Promise<unknown> => {
      try {
        const r = (await timedOut(Promise.resolve().then(() => live()?.session.rpc.sandbox?.getEnforcementStatus?.()), 15_000, 'getEnforcementStatus')) as Record<string, unknown> | undefined;
        if (!r) return 'no answer';
        return { required: r.required === true, blocked: r.blocked === true, ...(r.reason !== undefined ? { reason: bounded(r.reason) ?? clean(r.reason, 160) } : {}) };
      } catch (e) {
        return { error: clean(e instanceof Error ? e.message : e, 200) };
      }
    };
    const chip = (): unknown => {
      const s = [...evs].reverse().find((e) => e.type === 'sandbox' && e.sessionId === sid) as unknown as { sandbox: Record<string, unknown> | null } | undefined;
      if (!s) return 'no sandbox event';
      if (!s.sandbox) return null;
      const { state, mechanism, writes, untilNewSession, approvedMayLeave, managed, verified } = s.sandbox;
      return { state, mechanism, writes, untilNewSession, approvedMayLeave, managed, verified };
    };

    a.onEvent((e) => {
      evs.push({ ...e, t: now() });
      if (!sid || e.sessionId !== sid) return;
      const p = e.type === 'status' && e.status === 'needs-permission' ? e.permission : undefined;
      if (p && p.state === 'pending') {
        const ok = curMode === 'ask' && p.kind === 'shell' && p.summary === expected; // exact, never a substring
        perms.push({ step: probeStep, t: now(), kind: p.kind, summary: clean(p.summary, 300), answered: ok ? 'approve' : 'deny' });
        setTimeout(() => a.resolvePermission?.(sid, p.requestId, ok), 200); // a later tick, like the UI
      } else if (e.type === 'permission') {
        const q = e.permission as { kind?: string; summary?: string; state?: string; via?: string };
        if (q.via === 'policy' || q.via === 'quiet') perms.push({ step: probeStep, t: now(), kind: q.kind, summary: clean(q.summary, 300), answered: `auto (${q.via})` });
      }
    });
    const base = { workspace: F, quiet: true, model: 'auto', autoTier: 'efficiency', maxAiCredits: SWITCH_CAP };
    sid = await a.start({ ...base, permissionMode: 'ask' } as never);
    const t0wait = Date.now();
    while (Date.now() - t0wait < 20_000 && !evs.some((e) => e.type === 'sandbox' && e.sessionId === sid)) await sleep(200);
    const tools0 = await mustBeShellOnly('before step 1');
    Object.assign(out, { sessionTools: tools0, start: { chip: chip(), enforcement: await enforcement() } });
    const started = chip() as { state?: string } | null | string;
    console.log(`session: tools=[${tools0.join(',')}] chip=${JSON.stringify(started)}`);
    if (!spend) {
      fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
      console.log(`dry: no prompt sent; the probe session is deleted now -> ${outFile}`);
      return 0;
    }
    if (typeof started !== 'object' || started?.state !== 'on') throw new Error('refused: the floor is not on in Ask first, so the control cannot run (nothing was spent)');

    const usageOf = (from: number) => {
      const u = evs.slice(from).filter((e) => e.type === 'usage' && e.sessionId === sid) as Array<{ model?: string; nanoAiu?: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }>;
      return { models: [...new Set(u.map((x) => x.model).filter(Boolean))], calls: u.length, aiu: u.reduce((s, x) => s + (x.nanoAiu ?? 0), 0) / 1e9, in: u.reduce((s, x) => s + (x.inputTokens ?? 0), 0), out: u.reduce((s, x) => s + (x.outputTokens ?? 0), 0), cacheRead: u.reduce((s, x) => s + (x.cacheReadTokens ?? 0), 0) };
    };
    let prompts = 0;
    const runStep = async (n: number, label: string): Promise<ReturnType<typeof stepOutcome>> => {
      if (!spend) throw new Error('refused: no prompt without --spend');
      probeStep = n;
      fs.rmSync(probe, { force: true });
      const from = evs.length;
      prompts++;
      console.log(`step ${n} (prompt ${prompts} of at most 3): ${label}`);
      await a.send(sid, { text: prompt });
      const deadline = Date.now() + 180_000;
      const ended = (): boolean => evs.slice(from).some((e) => e.type === 'status' && (e.status === 'idle' || e.status === 'error') && e.sessionId === sid);
      const starts = (): number => evs.slice(from).filter((e) => e.type === 'toolCall' && e.sessionId === sid && (e as { phase?: string }).phase === 'start').length;
      while (Date.now() < deadline && !ended() && starts() <= SWITCH_MAX_CALLS) await sleep(250);
      const timed = !ended();
      if (timed) await a.interrupt?.(sid).catch(() => undefined); // no answer in 3 minutes, or too many tool calls
      await sleep(1500);
      const calls = evs.slice(from).filter((e) => e.type === 'toolCall' && e.sessionId === sid && ((e as { phase?: string }).phase === 'complete' || (e as { phase?: string }).phase === 'failed')) as Array<AgentEvent & { tool?: string; phase?: string; output?: string }>;
      const last = calls[calls.length - 1];
      const codes = parseExitCodes(String(last?.output ?? ''));
      const fileExists = fs.existsSync(probe);
      const outcome = stepOutcome({ ran: !!last, ...codes, fileExists });
      steps.push({
        step: n, label, mode: curMode, outcome, ...codes, fileExists, timedOut: timed,
        toolCalls: calls.map((c) => ({ tool: clean(c.tool, 40), phase: c.phase, output: clean(c.output, 400) })),
        perms: perms.filter((p) => p.step === n), chip: chip(), enforcement: await enforcement(),
        decisions: decisions.filter((d) => d.step === n),
        answer: clean(evs.slice(from).filter((e) => e.type === 'output' && (e as { final?: boolean }).final && e.sessionId === sid).map((e) => String((e as { text?: string }).text ?? '')).join(' '), 300),
        usage: usageOf(from),
      });
      fs.rmSync(probe, { force: true });
      console.log(`  -> ${outcome} (touch=${codes.touch ?? '?'} file=${fileExists} curl=${codes.curl ?? '?'}; ${usageOf(0).aiu} AIU so far)`);
      if (usageOf(0).aiu > SWITCH_MAX_AIU || timed) throw new Error(`stopped after step ${n}: ${timed ? 'the turn did not end (time or tool calls)' : `${usageOf(0).aiu} AIU is over the ${SWITCH_MAX_AIU} AIU stop`}; no further prompt`);
      return outcome;
    };

    // Step 1: the control
    const control = await runStep(1, 'control: Ask first, floor on');
    if (control !== 'both-blocked') {
      Object.assign(out, { verdict: 'cannot-tell', why: `control was ${control}: the probe cannot tell (K15-style); stopped after 1 prompt`, steps, prompts });
      return 0;
    }
    // Step 2: the switch, then the in-place clear (no prompt)
    probeStep = 2;
    curMode = 'allow';
    if (!a.setPermMode) throw new Error('the adapter has no setPermMode');
    a.setPermMode(sid, 'allow');
    await live()?.sandboxApplying?.catch(() => undefined);
    const chipAfterSwitch = chip();
    let update: 'resolved' | 'refused' = 'refused';
    let updateError: string | undefined;
    try {
      const s = live()?.session;
      if (!s) throw new Error('no live session');
      await timedOut(s.rpc.options.update({ sandboxConfig: { enabled: false }, sandboxConfigSource: 'session_disabled' }), 15_000, 'options.update');
      update = 'resolved';
    } catch (e) {
      updateError = clean(e instanceof Error ? e.message : e, 300);
    }
    await sleep(1000);
    steps.push({ step: 2, label: 'switch to Allow all, then options.update enabled:false / session_disabled', update, ...(updateError ? { updateError } : {}), chipAfterSwitch, chip: chip(), enforcement: await enforcement(), decisions: decisions.filter((d) => d.step === 2) });
    console.log(`step 2 (no prompt): update ${update}${updateError ? `: ${updateError}` : ''}`);
    // Step 3: C in Allow all (refuses if the tools are no longer limited)
    await mustBeShellOnly('before step 3');
    const after = await runStep(3, 'C in Allow all after the update');
    const v = switchVerdict({ control, update, after });
    // Step 4: narrow back (A) or the B path (stop, resume in Allow all)
    let history: Record<string, unknown> | undefined;
    if (v.verdict === 'A') {
      curMode = 'ask';
      a.setPermMode?.(sid, 'ask');
      await live()?.sandboxApplying?.catch(() => undefined);
    } else {
      probeStep = 4;
      await a.stop(sid);
      const again = await a.start({ ...base, permissionMode: 'allow', resumeSessionId: sid } as never);
      if (again !== sid) throw new Error('refused: the resume returned another session id');
      curMode = 'allow';
      await sleep(1000);
      await mustBeShellOnly('after the resume');
      const evts = await timedOut(live()!.session.getEvents(), 30_000, 'getEvents').catch(() => [] as Array<{ type?: string }>);
      history = { events: evts.length, userMessages: evts.filter((x) => x?.type === 'user.message').length, chipAfterResume: chip() };
    }
    const expect4 = step4Expected(v.verdict);
    const got4 = await runStep(4, v.verdict === 'A' ? 'A: back to Ask first, C must fail' : 'B path: resumed in Allow all, C must succeed');
    Object.assign(out, { update, ...(updateError ? { updateError } : {}), verdict: v.verdict, why: v.why, step4: { path: v.verdict === 'A' ? 'narrow' : 'B', expected: expect4, outcome: got4, holds: got4 === expect4, ...(history ? { history } : {}) }, steps, prompts });
    return 0;
  } catch (e) {
    out.error = clean(e instanceof Error ? e.message : e, 400);
    console.error('FAILED', out.error);
    return 1;
  } finally {
    out.steps ??= steps;
    out.usage = (() => {
      const u = evs.filter((e) => e.type === 'usage') as Array<{ nanoAiu?: number }>;
      return { calls: u.length, aiu: u.reduce((s, x) => s + (x.nanoAiu ?? 0), 0) / 1e9 };
    })();
    out.rawTypes = [...new Set(rawTypes)];
    if (ad && sid) {
      await ad.stop(sid).catch(() => undefined);
      await (ad as unknown as { deleteSession?: (s: string) => Promise<void> }).deleteSession?.call(ad, sid).catch(() => undefined);
    }
    await ad?.dispose().catch(() => undefined);
    out.cleanup = cleanup();
    console.log(`cleanup: ${(out.cleanup as string[]).join('; ')}`);
    try { fs.writeFileSync(outFile, JSON.stringify(out, null, 2)); } catch { /* reported below */ }
    console.log(`verdict=${String(out.verdict ?? 'none')} prompts=${String(out.prompts ?? 0)} aiu=${(out.usage as { aiu: number }).aiu} -> ${outFile}`);
  }
}

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
(switchProbe ? runSwitch() : main()).then((code) => process.exit(code), (e) => { console.error('FAILED', clean(e instanceof Error ? e.message : e, 300)); process.exit(1); });
