/**
 * Dev tool for spec 058 T220 (`real:` check of FR-243, the shell guard). Not part of `npm test`, never run in CI.
 *
 * Question: with Copilot SDK 1.0.32 (runtime 1.0.110), whose runtime approves "read-only" shell commands by itself, does a shell
 * command as harmless as `ls` still reach Durbar's `onPermissionRequest` broker when the session is created with the guard
 * (`managedSettings.permissions.ask: ['Shell(*)']`, Assisted mode off, `permissionMode: 'manual'`)?
 *
 * **Dry by default: no prompt, no credits.** A dry run starts the signed-in runtime only to read the sign-in state (yes/no, never the
 * login or a token) and the model list (free), picks the cheapest model (token prices, else multiplier) and prints the plan.
 * **`--spend` sends at most TWO prompts in ONE session** through Durbar's own adapter (the app's start/send path, without the window):
 *   1. Read-only: "run `ls`"; the broker must see a `shell` request and deny it (`Denied (read-only mode)`).
 *   2. Ask first (the same session, switched as the app does): "the mode changed, run `ls -1`"; the broker must see it pending; the
 *      script denies it. A step where the model makes no shell call proves nothing either way (inconclusive).
 * The folder is a new empty temp folder (one README) under the temp folder, never the repository or a user folder. Cap: 30 AI credits,
 * the runtime's minimum (not the budget: two short prompts). The second prompt is not sent when the first used 1 AI credit or more, ran
 * any tool call that was not a shell call, did not end within 3 minutes, or had no usage report.
 *
 * Output: per step, the broker's shell requests (kind, summary, state), tool calls (name, success, output cut to 200 characters), the
 * answer (cut), usage (model, calls, AI credits, tokens) and whether the session config carried the guard; all text through `redact`,
 * the home folder masked. Never ~/.copilot, ~/.claude, a token, an environment value or the session id. The session is deleted and the
 * folder removed in a `finally`. Exit 1 when a step failed or a shell call ran without reaching the broker.
 *
 *   node dist-scripts/scripts/shell-guard-real.js <out.json> [--spend]
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { COPILOT_DESCRIPTOR } from '../src/adapters/copilot';
import type { AgentAdapter, AgentEvent } from '../src/adapters/types';
import { redact } from '../src/shared/redact';

const args = process.argv.slice(2);
const spend = args.includes('--spend');
const [outFile] = args.filter((a) => a !== '--spend');
if (!outFile) throw new Error('usage: shell-guard-real.js <out.json> [--spend]');
if (spend && process.env.CI) throw new Error('refused: --spend never runs under CI');

const HOME = os.homedir();
const clean = (s: unknown, n = 300): string => redact(String(s ?? '')).split(HOME).join('~').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>').replace(/\s+/g, ' ').slice(0, n);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const PROMPT = 'Run this exact shell command in the current folder with your shell tool: ls  Then reply with only the word done, or the exact error text if it failed.';
// 2026-11-13 run: after the Read-only denial ("Do not retry it") the same words made the model answer from history with no tool call, so
// the second prompt says the mode changed and asks for a slightly different command
const PROMPT2 = 'The mode changed: Agent Durbar now asks you before each command. Run this exact shell command in the current folder with your shell tool: ls -1  Then reply with only the word done, or the exact error text if it failed.';
const MAX_PROMPTS = 2;

type Ev = AgentEvent & { t: number };
interface Step { label: string; mode: string; outcome: 'reached the broker' | 'ran without the broker' | 'no shell call (inconclusive)'; brokerShell: Array<{ kind: string; summary: string; state: string }>; tools: Array<{ tool: string; phase: string; success?: boolean; output?: string }>; answer: string; ended: boolean; usage: { models: string[]; calls: number; aiu: number | null; in: number; out: number }; ranWithoutBroker: boolean }

async function main(): Promise<number> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-t220-')));
  fs.writeFileSync(path.join(dir, 'README.txt'), 'throw-away folder for the spec 058 T220 shell guard check\n');
  let ad: AgentAdapter | undefined;
  let sid = '';
  let prompts = 0;
  const evs: Ev[] = [];
  const sentConfigs: Array<{ managedSettings: unknown; permissionMode: unknown }> = [];
  const out: Record<string, unknown> = { date: new Date().toISOString(), dry: !spend, node: process.version, platform: process.platform, folder: clean(dir), prompt: PROMPT };
  let code = 0;
  try {
    ad = COPILOT_DESCRIPTOR.create();
    const a = ad as AgentAdapter & { getClient(): Promise<{ getAuthStatus?: () => Promise<{ isAuthenticated?: boolean; authType?: string }>; getStatus?: () => Promise<{ version?: string }>; createSession(c: Record<string, unknown>): Promise<unknown> }>; listModelOptions(): Promise<Array<{ id: string; disabled?: boolean; multiplier?: number; pricing?: { inputPerMTok?: number; outputPerMTok?: number } }>> };
    const client = await a.getClient();
    const auth = typeof client.getAuthStatus === 'function' ? await client.getAuthStatus() : undefined;
    out.signedIn = auth?.isAuthenticated === true;
    out.authType = clean(auth?.authType, 40);
    out.runtime = clean((await client.getStatus?.())?.version, 40);
    if (!out.signedIn) throw new Error('Copilot is not signed in: T220 not run (no interactive login from this script)');
    // the cheapest model the account lists: its price per million input plus output tokens (the AIU price list), else its multiplier
    const price = (m: { multiplier?: number; pricing?: { inputPerMTok?: number; outputPerMTok?: number } }): number => (m.pricing && Number.isFinite(m.pricing.inputPerMTok) && Number.isFinite(m.pricing.outputPerMTok) ? (m.pricing.inputPerMTok as number) + (m.pricing.outputPerMTok as number) : typeof m.multiplier === 'number' && Number.isFinite(m.multiplier) ? m.multiplier : NaN);
    const models = (await a.listModelOptions()).filter((m) => m.id !== 'auto' && !m.disabled && Number.isFinite(price(m)));
    models.sort((x, y) => price(x) - price(y));
    const model = models[0]?.id;
    out.model = model ?? 'auto (efficiency tier)';
    out.modelPrice = models[0] ? price(models[0]) : undefined;
    console.log(`${spend ? `SPENDING AT MOST ${MAX_PROMPTS} PROMPTS` : 'DRY RUN (no prompt; pass --spend)'}: copilot, model ${String(out.model)} (input+output per M tokens ${String(out.modelPrice)}), cap 30 AI credits, runtime ${String(out.runtime)}.\nPrompt: ${PROMPT}`);
    if (!spend) return 0;

    // what Durbar sends at create (the guard's two fields only; never the handlers or anything else)
    const orig = client.createSession.bind(client);
    client.createSession = (c) => { sentConfigs.push({ managedSettings: c.managedSettings, permissionMode: c.permissionMode }); return orig(c); };
    a.onEvent((e) => {
      evs.push({ ...e, t: Date.now() });
      const p = e.type === 'status' && e.status === 'needs-permission' ? e.permission : undefined;
      if (p && p.state === 'pending' && sid && e.sessionId === sid) setTimeout(() => a.resolvePermission?.(sid, p.requestId, false), 200); // deny, a later tick like the UI
    });
    sid = await a.start({ workspace: dir, permissionMode: 'read-only', quiet: true, maxAiCredits: 30, ...(model ? { model } : { model: 'auto', autoTier: 'efficiency' }) } as never);
    out.guardSent = sentConfigs;

    const steps: Step[] = [];
    const run = async (label: string, mode: string, text: string): Promise<Step> => {
      if (prompts >= MAX_PROMPTS) throw new Error('prompt budget used');
      const from = evs.length;
      prompts++;
      await a.send(sid, { text });
      const end = Date.now() + 180_000;
      const ended = (): boolean => evs.slice(from).some((e) => e.sessionId === sid && e.type === 'status' && (e.status === 'idle' || e.status === 'error'));
      while (Date.now() < end && !ended()) await sleep(250);
      const done = ended();
      if (!done) await a.interrupt?.(sid).catch(() => undefined);
      let usage = evs.slice(from).filter((e) => e.type === 'usage');
      for (let i = 0; i < 60 && !usage.some((u) => typeof (u as { nanoAiu?: unknown }).nanoAiu === 'number'); i++) { await sleep(500); usage = evs.slice(from).filter((e) => e.type === 'usage'); }
      const mine = evs.slice(from).filter((e) => e.sessionId === sid);
      const broker = mine.filter((e) => e.type === 'status' && e.status === 'needs-permission' && e.permission).map((e) => (e as { permission: { kind: string; summary: string; state: string } }).permission).filter((p) => p.kind === 'shell').map((p) => ({ kind: p.kind, summary: clean(p.summary, 120), state: p.state }));
      const calls = mine.filter((e) => e.type === 'toolCall') as Array<AgentEvent & { tool: string; phase: string; success?: boolean; output?: string }>;
      const tools = calls.map((c) => ({ tool: clean(c.tool, 60), phase: c.phase, ...(c.success !== undefined ? { success: c.success } : {}), ...(c.output ? { output: clean(c.output, 200) } : {}) }));
      const priced = usage.filter((u) => typeof (u as { nanoAiu?: unknown }).nanoAiu === 'number') as Array<{ nanoAiu: number }>;
      const aiu = priced.length ? priced.reduce((s, u) => s + u.nanoAiu, 0) / 1e9 : null;
      const shellCalls = tools.filter((t) => /bash|shell|powershell/i.test(t.tool));
      // a shell call that did not fail and no broker request: the runtime approved it by itself (or its output shows the folder)
      const ranWithoutBroker = !broker.length && (shellCalls.some((t) => t.phase !== 'start' && t.phase !== 'failed') || tools.some((t) => /README\.txt/.test(t.output ?? '')));
      const s: Step = {
        label, mode, outcome: broker.length ? 'reached the broker' : ranWithoutBroker ? 'ran without the broker' : 'no shell call (inconclusive)', brokerShell: broker, tools, ended: done, ranWithoutBroker,
        answer: clean(mine.filter((e) => e.type === 'output' && (e as { final?: boolean }).final).map((e) => String((e as { text?: string }).text ?? '')).join(' '), 300),
        usage: { models: [...new Set(usage.map((u) => String((u as { model?: string }).model ?? '')).filter(Boolean))], calls: usage.length, aiu, in: usage.reduce((t, u) => t + ((u as { inputTokens?: number }).inputTokens ?? 0), 0), out: usage.reduce((t, u) => t + ((u as { outputTokens?: number }).outputTokens ?? 0), 0) },
      };
      steps.push(s);
      console.log(`${label}: ${s.outcome}; broker shell requests=${broker.length} (${broker.map((b) => b.state).join(',') || 'none'}) tools=${tools.length} ranWithoutBroker=${ranWithoutBroker} aiu=${String(aiu)}`);
      return s;
    };
    out.steps = steps;
    const s1 = await run('1 read-only', 'read-only', PROMPT);
    const stray = s1.tools.some((t) => !/bash|shell|powershell/i.test(t.tool));
    if (!s1.ended || s1.usage.aiu === null || s1.usage.aiu >= 1 || stray) {
      out.stoppedAfter1 = !s1.ended ? 'the turn did not end' : s1.usage.aiu === null ? 'usage unreadable' : stray ? 'a tool call that is not the shell' : 'used 1 AI credit or more';
    } else {
      a.setPermMode?.(sid, 'ask');
      await run('2 ask first', 'ask', PROMPT2);
    }
    out.prompts = prompts;
    const bypass = steps.some((s) => s.ranWithoutBroker);
    const all = steps.length === MAX_PROMPTS && steps.every((s) => s.brokerShell.length > 0);
    out.verdict = bypass ? 'guard FAILED: a shell command ran without the broker' : all ? 'guard holds: every shell request reached the broker' : `partial: ${steps.filter((s) => s.brokerShell.length).map((s) => s.mode).join(', ') || 'no step'} reached the broker; the rest had no shell call`;
    if (!all) code = 1;
    return code;
  } finally {
    if (ad && sid) {
      await ad.stop(sid).catch(() => undefined);
      const del = (ad as unknown as { deleteSession?: (s: string) => Promise<void> }).deleteSession;
      if (del) await del.call(ad, sid).then(() => { out.sessionDeleted = true; }, (e: unknown) => { out.sessionDeleted = false; out.deleteError = clean(e instanceof Error ? e.message : e, 200); });
    }
    await ad?.dispose().catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
    out.prompts = prompts;
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
    console.log(`prompts=${prompts} verdict=${String(out.verdict ?? 'none')} -> ${outFile}`);
  }
}
main().then((c) => process.exit(c), (e) => { console.error('FAILED', clean(e instanceof Error ? e.message : e, 300)); process.exit(1); });
