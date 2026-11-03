/**
 * Dev tool for spec 052 FR-214 (issue #1028): what Copilot's `abort`, `session.detach` and limit answers really do around Durbar's 5 s
 * give-up. Not part of `npm test`, never run in CI.
 *
 * **Dry by default: the runtime starts and one session is created, no prompt, no credits.** `--spend` sends real prompts through
 * Durbar's own adapter (the owner's OK first, AGENTS.md), at most `MAX_PROMPTS`, stopping at `MAX_AIU`, and refuses under `CI`.
 *
 *   node dist-scripts/scripts/copilot-giveup-real.js <out.json> [--spend] [--phases p1,p2,...] [--repl <dir>]
 *
 * A real hang is made with SIGSTOP on the runtime process (Linux only), so the pipe stays open and calls wait, as a hung runtime's
 * would; SIGCONT brings it back. Ask first, and the permission gate approves only the exact fixed command of the step. Everything runs
 * in a scratch folder this script makes under the temp folder, removed at the end with the session.
 *
 * Phases: `baseline` (abort with a command running), `term` (a command that ignores SIGTERM), `hang` (give-up, next message), `stop` (End and
 * resume under a hang), `question` (an answer under a hang), `late` (a close held back, then a resume), `limit` (can the runtime's limit be
 * provoked; `options.update` refuses a cap under 30, so it was not, real 2026-11-02). A run of them all is at most 7 prompts.
 *
 * `--repl <dir>` (issue #1028 question 3, the runtime's own limit, which needs at least 30 credits of real use): one session, kept alive so the
 * runtime's count stays, driven step by step by fixed commands in `<dir>/cmd` (see `runCommandLine`). `fill` reaches the cap on a dear model with
 * random words. No model call at `MAX_REPL_AIU` credits or over, by this script's own count. `history.truncate` resets the runtime's count (real
 * 2026-11-02): do not use it on a session you paid to exhaust, a new exhaustion is another 30 credits.
 *
 * Output: event names and timings only, never prompts' answers, session ids, paths or tool output.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { COPILOT_DESCRIPTOR } from '../src/adapters/copilot';
import { EventMapper } from '../src/adapters/map';
import type { AgentAdapter, AgentEvent } from '../src/adapters/types';
import { redact } from '../src/shared/redact';
import { ownSleepers, parseMaxPrompts, spendRefusal } from './copilot-giveup-gate';
import { maskIds } from './sandbox-real-mask';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cp = require('child_process') as typeof import('child_process');

const args = process.argv.slice(2);
const spend = args.includes('--spend');
const phaseArg = args.indexOf('--phases');
const wanted = phaseArg >= 0 ? (args[phaseArg + 1] ?? '').split(',') : ['baseline', 'term', 'hang', 'stop', 'question', 'late', 'limit'];
const outFile = args.find((a, i) => !a.startsWith('--') && !(i > 0 && (args[i - 1] === '--phases' || args[i - 1] === '--max-prompts' || args[i - 1] === '--repl')));
if (!outFile) throw new Error('usage: copilot-giveup-real.js <out.json> [--spend] [--phases p1,p2,...]');
if (spend && process.env.CI) throw new Error('refused: --spend never runs under CI');
if (process.platform !== 'linux') throw new Error('refused: Linux only (SIGSTOP and `ps --ppid`)');

const replArg = args.indexOf('--repl');
const replDir = replArg >= 0 ? args[replArg + 1] : '';
const maxArg = args.indexOf('--max-prompts');
const MAX_PROMPTS = maxArg >= 0 ? parseMaxPrompts(args[maxArg + 1]) : replDir ? 80 : 7; // baseline, term, hang, next send + stop, question, limit, and one send after a limit if the runtime raised one
const MAX_REPL_AIU = 43; // the owner's ceiling for this run is 45; one small call may still be on its way
const MAX_AIU = replDir ? MAX_REPL_AIU : 6;
const GIVE_UP_MS = 5000;
const HOME = os.homedir();
const clean = (s: unknown, max = 200): string => maskIds(redact(String(s ?? '')).split(HOME).join('~')).slice(0, max);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const msg = (e: unknown): string => clean(e instanceof Error ? e.message : e);

type Mark = { phase: string; t: number; name: string };
const marks: Mark[] = [];
let phase = 'setup';
let t0 = Date.now();
const mark = (name: string): void => {
  const m = { phase, t: Date.now() - t0, name };
  marks.push(m);
  console.log(`${phase.padEnd(9)} ${String(m.t).padStart(7)} ms  ${name}`);
};
const seen = (name: string, from = 0): boolean => marks.slice(from).some((m) => m.name === name || m.name.startsWith(`${name}:`));
const until = async (ok: () => boolean, ms: number): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (ok()) return true; await sleep(50); }
  return ok();
};

/* Copilot's own stream, names and bounded words only */
const bounded = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,40}$/.test(v) ? v : '');
const NOISY = /delta$|^assistant\.(streaming|reasoning|intent)|^session\.usage_info|^tool\.execution_(partial|progress)|^sandbox\.|^permission\.|^hook\.|^session\.indexed_search$/;
const mapProto = (EventMapper as unknown as { prototype: { map(x: unknown): void } }).prototype;
const origMap = mapProto.map;
let aiu = 0;
let lastUsage = { input: 0, cacheRead: 0, output: 0, aiu: 0 };
let firstUserEvent = ''; // the event a truncate goes back to (never printed)
const numberOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
/** The numbers of a limit or usage event: counts only. */
const numbers = (type: string, d: Record<string, unknown> | undefined): string => {
  if (type === 'assistant.usage') return `:in=${numberOf(d?.inputTokens)},read=${numberOf(d?.cacheReadTokens)},write=${numberOf(d?.cacheWriteTokens)},out=${numberOf(d?.outputTokens)},aiu=${round3(numberOf((d?.copilotUsage as { totalNanoAiu?: unknown } | undefined)?.totalNanoAiu) / 1e9)},total=${round3(aiu)}`;
  if (type === 'session_limits_exhausted.requested') return `:used=${round3(numberOf(d?.usedAiCredits))},max=${round3(numberOf(d?.maxAiCredits))}`;
  if (type === 'session_limits_exhausted.completed') return `:${bounded((d?.response as { action?: unknown } | undefined)?.action)}`;
  if (type === 'session.session_limits_changed') return `:max=${round3(numberOf((d?.sessionLimits as { maxAiCredits?: unknown } | undefined)?.maxAiCredits))}`;
  if (type === 'session.usage_checkpoint') return `:total=${round3(numberOf(d?.totalNanoAiu) / 1e9)}`;
  if (type === 'session.info' || type === 'session.warning' || type === 'session.error') {
    const text = String(d?.message ?? '');
    return `:${bounded(d?.infoType) || bounded(d?.warningType) || bounded(d?.errorType)}${/^(Session limit|Tool execution was skipped)/.test(text) || type === 'session.error' ? `:${clean(text, 110)}` : ''}`;
  }
  return '';
};
mapProto.map = function (this: unknown, x: unknown): void {
  const e = x as { type?: string; id?: unknown; data?: Record<string, unknown> };
  const type = String(e?.type);
  if (type === 'assistant.usage') {
    const n = Number((e.data?.copilotUsage as { totalNanoAiu?: unknown } | undefined)?.totalNanoAiu ?? 0) / 1e9 || 0;
    aiu += n;
    lastUsage = { input: numberOf(e.data?.inputTokens), cacheRead: numberOf(e.data?.cacheReadTokens), output: numberOf(e.data?.outputTokens), aiu: n };
  }
  if (type === 'user.message' && !firstUserEvent && typeof e.id === 'string') firstUserEvent = e.id;
  if (!NOISY.test(type)) {
    const extra = numbers(type, e.data).slice(1) || bounded(e.data?.toolName) || bounded(e.data?.reason) || bounded(e.data?.errorType) || (typeof e.data?.success === 'boolean' ? String(e.data.success) : '');
    mark(`raw:${type}${extra ? `:${extra}` : ''}`);
  }
  return origMap.call(this, x);
};

/* the runtime process and the tool's process */
const children = (): Array<{ pid: number; comm: string }> => cp.execFileSync('ps', ['-o', 'pid=,comm=', '--ppid', String(process.pid)], { encoding: 'utf8' }).split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p[0] && p[1] !== 'ps').map((p) => ({ pid: Number(p[0]), comm: p[1] }));
let runtimePid = 0;
const hang = (): void => { process.kill(runtimePid, 'SIGSTOP'); mark('SIGSTOP runtime'); };
const unhang = (): void => { process.kill(runtimePid, 'SIGCONT'); mark('SIGCONT runtime'); };
process.on('exit', () => { try { if (runtimePid) process.kill(runtimePid, 'SIGCONT'); } catch { /* gone */ } });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => process.exit(3)); // a hung runtime never stays behind
const leftovers = new Set<number>();
/** The pids of a `sleep <n>` the fixed command started: the runtime's descendants only, remembered so the run can kill what an abort left. */
const sleepers = (n: number): number[] => ownSleepers(cp.execFileSync('ps', ['-e', '-o', 'pid=,ppid=,args='], { encoding: 'utf8' }), runtimePid, n);
/** Marks when a tool's process first shows and when it goes. */
function watch(n: number): () => void {
  let was = false;
  const timer = setInterval(() => {
    const p = sleepers(n);
    p.forEach((x) => leftovers.add(x));
    if (p.length && !was) mark(`process sleep ${n} up`);
    if (!p.length && was) mark(`process sleep ${n} gone`);
    was = !!p.length;
  }, 100);
  return () => clearInterval(timer);
}

type RpcSession = {
  abort(): Promise<unknown>;
  disconnect(): Promise<unknown>;
  send(p: unknown): Promise<unknown>;
  rpc: {
    history: { truncate(p: { eventId: string }): Promise<{ eventsRemoved?: unknown }> };
    metadata: { isProcessing(): Promise<{ processing?: unknown }> };
    options: { update(p: unknown): Promise<unknown> };
    model: { getCurrent(): Promise<{ modelId?: string }>; switchTo(p: unknown): Promise<unknown> };
    ui: { handlePendingSessionLimitsExhausted(p: unknown): Promise<unknown> };
  };
};
type LiveLike = { session: RpcSession; limitRequestId?: string; capNow?: number | null; localLimit?: { requestId: string; held?: unknown }; lateCalls?: Set<unknown>; turnOpen?: boolean };
type Internals = { getClient(): Promise<{ listModels(): Promise<Array<{ id?: string; billing?: { multiplier?: number } }>> }>; sessions: Map<string, LiveLike> };

async function main(): Promise<number> {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-giveup-')));
  fs.writeFileSync(path.join(scratch, 'README.txt'), 'throw-away folder for the spec 052 FR-214 give-up probe\n');
  const out: Record<string, unknown> = { date: new Date().toISOString(), os: `${process.platform} ${os.release()}`, node: process.version, dry: !spend };
  const ad: AgentAdapter = COPILOT_DESCRIPTOR.create();
  const inner = ad as unknown as Internals;
  let sid = '';
  let prompts = 0;
  let approve = ''; // the one summary the gate approves now
  const live = (): LiveLike => { const l = inner.sessions.get(sid); if (!l) throw new Error('no live session'); return l; };
  let lastQuestion = '';
  let lastLimit = '';

  ad.onEvent((e: AgentEvent) => {
    if (sid && e.sessionId !== sid) return;
    if (e.type === 'status') {
      const intent = /^(Aborted|Thinking|Answered|Ready|Waiting for your answer|Stop sent: .*|Waiting for Copilot to stop .*|Not sent: .*|Stopped at the spending limit)$/.test(String(e.intent)) ? `:${e.intent}` : '';
      mark(`adapter:status:${e.status}${intent}`);
      const p = e.status === 'needs-permission' ? e.permission : undefined;
      if (p && p.state === 'pending') {
        const ok = p.kind === 'shell' && p.summary === approve; // exact, never a substring
        mark(ok ? 'gate:approve' : `gate:deny:${bounded(p.kind)}`);
        setTimeout(() => ad.resolvePermission?.(sid, p.requestId, ok), 200); // a later tick, like the UI
      }
    } else if (e.type === 'question') {
      if (e.phase === 'asked') lastQuestion = e.requestId;
      mark(`adapter:question:${e.phase}`);
    } else if (e.type === 'limit') {
      const l = e as unknown as { phase: string; requestId?: string; maxAiCredits?: unknown; usedAiCredits?: unknown; action?: unknown };
      if (l.phase === 'exhausted' && l.requestId) lastLimit = l.requestId;
      const whose = l.requestId ? (l.requestId.startsWith('durbar-cap') ? ':durbar' : ':runtime') : '';
      mark(`adapter:limit:${l.phase}${whose}${l.phase === 'exhausted' ? `:used=${round3(numberOf(l.usedAiCredits))},max=${round3(numberOf(l.maxAiCredits))}` : ''}${l.phase === 'resolved' ? `:${bounded(l.action)}` : ''}${l.phase === 'changed' ? `:max=${round3(numberOf(l.maxAiCredits))}` : ''}`);
    }
  });

  /** Times the session's calls, so a give-up and the late answer both show. `hold` keeps a disconnect back until the returned function is called. */
  const instrument = (l: LiveLike): void => {
    const s = l.session;
    const a = s.abort.bind(s);
    s.abort = () => { mark('abort: call'); return a().then((r) => { mark('abort: answered'); return r; }, (e: unknown) => { mark(`abort: failed`); throw e; }); };
    const d = s.disconnect.bind(s);
    s.disconnect = () => { mark('detach: call'); return d().then((r) => { mark('detach: answered'); return r; }, (e: unknown) => { mark(`detach: failed: ${msg(e)}`); throw e; }); };
    const u = s.rpc.ui.handlePendingSessionLimitsExhausted.bind(s.rpc.ui);
    s.rpc.ui.handlePendingSessionLimitsExhausted = (p) => { mark('limit cancel: call'); return u(p).then((r) => { mark(`limit cancel: answered ${JSON.stringify(r).slice(0, 80)}`); return r; }, (e: unknown) => { mark(`limit cancel: failed: ${msg(e)}`); throw e; }); };
  };
  const startSession = async (resume: boolean, cap?: number): Promise<void> => {
    const base = { workspace: scratch, quiet: true, permissionMode: 'ask' as const, model: replDir ? 'gpt-6-luna' : 'auto', ...(replDir ? {} : { autoTier: 'efficiency' }), maxAiCredits: resume ? cap : 30 };
    sid = await ad.start({ ...base, ...(resume ? { resumeSessionId: sid } : {}) } as never);
    instrument(live());
  };
  /** The one gate before every real send (review of #1038). */
  const nextPrompt = (): void => {
    const refused = spendRefusal({ prompts, maxPrompts: MAX_PROMPTS, aiu, maxAiu: MAX_AIU });
    if (refused) throw new Error(refused);
    prompts++;
  };
  const prompt = async (text: string, summary = ''): Promise<void> => {
    if (!spend) throw new Error('dry run: no prompt');
    nextPrompt();
    approve = summary;
    mark(`send (prompt ${prompts})`);
    await ad.send(sid, { text });
  };
  const runCommand = (cmd: string): Promise<void> => prompt(`Run this exact shell command once with your shell tool, exactly as written, and nothing else: ${cmd}`, `run ${cmd}`);
  const processing = async (): Promise<string> => {
    try {
      const r = await Promise.race([live().session.rpc.metadata.isProcessing(), sleep(3000).then(() => ({ processing: 'no answer in 3 s' }))]);
      return String(r.processing);
    } catch (e) { return `failed: ${msg(e)}`; }
  };
  /** One poll of the runtime's own word, marked when it changes. */
  const pollProcessing = async (ms: number): Promise<void> => {
    let was = '';
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const now = await processing();
      if (now !== was) mark(`isProcessing ${now}`);
      was = now;
      await sleep(200);
    }
  };
  /** A marked event that means the model used nothing more: a same-model switch needs no prompt and sends `session.model_change` (real 2026-10-31). */
  const eventsReach = async (): Promise<boolean> => {
    const from = marks.length;
    const current = await live().session.rpc.model.getCurrent();
    await live().session.rpc.model.switchTo({ modelId: current.modelId });
    const ok = await until(() => seen('raw:session.model_change', from), 5000);
    mark(ok ? 'events reach the adapter (model_change)' : 'NO event reached the adapter in 5 s (model_change)');
    return ok;
  };
  const beginPhase = (name: string): void => { phase = name; t0 = Date.now(); console.log(`--- ${name}`); };

  const stopWatches: Array<() => void> = [];
  const watchN = (n: number): void => { stopWatches.push(watch(n)); };
  try {
    const before = new Set(children().map((c) => c.pid));
    const client = await inner.getClient();
    const kids = children().filter((c) => !before.has(c.pid));
    runtimePid = kids[0]?.pid ?? 0;
    out.runtimeChild = kids.map((c) => c.comm);
    if (!runtimePid) throw new Error('no runtime child process found: the runtime runs in this process, so SIGSTOP cannot make a hang');
    mark(`runtime child: ${kids.map((c) => c.comm).join(',')}`);
    await startSession(false);
    mark('session created');

    if (!spend) {
      beginPhase('dry');
      if (args.includes('--prices')) {
        const models = await client.listModels() as unknown as Array<Record<string, unknown>>;
        out.models = models.map((m) => ({ id: m.id, billing: m.billing, limits: (m.capabilities as { limits?: unknown } | undefined)?.limits }));
        console.log(JSON.stringify(out.models, null, 1));
      }
      mark(`events reach: ${await eventsReach()}`);
      const a0 = Date.now(); await ad.interrupt?.(sid); mark(`interrupt with no turn: ${Date.now() - a0} ms`);
      hang();
      const a1 = Date.now(); await ad.interrupt?.(sid); mark(`interrupt under a hang: ${Date.now() - a1} ms`);
      unhang();
      await pollProcessing(1500);
    }

    if (spend && replDir) {
      beginPhase('repl');
      const ok = 'Reply with only: ok';
      const direct = async (text: string, summary = ''): Promise<void> => {
        nextPrompt();
        approve = summary;
        mark(`direct send (prompt ${prompts})`);
        await live().session.send({ prompt: text });
        mark('direct send answered');
      };
      const adapterSend = (text: string, summary = ''): Promise<void> => prompt(text, summary).then(() => mark('send answered'), (e: unknown) => { mark(`send failed: ${msg(e)}`); });
      const runText = (n: number): [string, string] => [`Run this exact shell command once with your shell tool, exactly as written, and nothing else: sleep ${n}`, `run sleep ${n}`];
      const noise = (chars: number): string => {
        const letters = 'bcdfghjklmnprstvwz', vowels = 'aeiou';
        let t = '';
        while (t.length < chars) {
          let w = '';
          for (let i = 0; i < 3; i++) w += letters[Math.floor(Math.random() * letters.length)] + vowels[Math.floor(Math.random() * vowels.length)];
          t += `${w} `;
        }
        return t;
      };
      /** Reaches `target` credits on a dear model: 30k characters, then 75% of the rest, then the rest, by the real tokens per character. */
      const fill = async (model: string, target: number): Promise<void> => {
        const models = await (await inner.getClient()).listModels() as unknown as Array<{ id?: string; billing?: { tokenPrices?: { inputPrice?: number; cacheReadPrice?: number; batchSize?: number } } }>;
        const prices = models.find((m) => m.id === model)?.billing?.tokenPrices;
        if (!prices?.inputPrice || !prices.batchSize) throw new Error('no price for that model');
        const per = prices.inputPrice / prices.batchSize;
        const perRead = (prices.cacheReadPrice ?? prices.inputPrice) / prices.batchSize;
        await live().session.rpc.model.switchTo({ modelId: model });
        let charsPerToken = 3.5;
        let context = 0;
        for (let step = 0; step < 6 && aiu < target; step++) {
          const left = target - aiu;
          const fresh = (left - context * perRead) / per;
          const chars = step === 0 ? 30_000 : Math.max(500, Math.round(Math.max(fresh, 0) * (step === 1 ? 0.75 : 1) * charsPerToken));
          const from = marks.length;
          mark(`fill step ${step}: ${chars} chars, ${round3(aiu)} used`);
          await prompt(`${ok}. The text below is a test of nothing: ignore it, use no tools.\n\n${noise(chars)}`);
          await until(() => seen('raw:session.idle', from) || seen('adapter:limit:exhausted', from), 240_000);
          await until(() => !live().turnOpen, 8000);
          const inTotal = lastUsage.input + lastUsage.cacheRead;
          if (context && inTotal > context) charsPerToken = chars / (inTotal - context);
          context = inTotal;
          mark(`fill step ${step} done: ${round3(aiu)} used, context ${context}, ${charsPerToken.toFixed(2)} chars per token`);
          if (seen('adapter:limit:exhausted', from)) break;
        }
      };
      const runLine = async (line: string): Promise<void> => {
        const [cmd, a, b, c] = line.trim().split(/\s+/);
        switch (cmd) {
          case 'fill': await fill(a, Number(b)); break;
          case 'stop&': { const t = Date.now(); void ad.stop(sid).then(() => mark(`stop returned in ${Date.now() - t} ms`)); break; }
          case 'model': await live().session.rpc.model.switchTo({ modelId: a }); mark('model switched'); break;
          case 'truncate': if (firstUserEvent) { const r = await live().session.rpc.history.truncate({ eventId: firstUserEvent }); mark(`truncate: ${numberOf(r.eventsRemoved)} events removed`); firstUserEvent = ''; } break;
          case 'state': { const l = live(); mark(`state: count ${round3(aiu)}, capNow ${l.capNow}, runtime request ${!!l.limitRequestId}, local limit ${l.localLimit ? (l.localLimit.held ? 'with a held message' : 'none held') : 'no'}, late calls ${l.lateCalls?.size ?? 0}, turn open ${!!l.turnOpen}, processing ${await processing()}`); break; }
          case 'hang': hang(); break;
          case 'unhang': unhang(); break;
          case 'interrupt': { const t = Date.now(); await ad.interrupt?.(sid); mark(`interrupt returned in ${Date.now() - t} ms`); break; }
          case 'interrupt&': { const t = Date.now(); void Promise.resolve(ad.interrupt?.(sid)).then(() => mark(`interrupt returned in ${Date.now() - t} ms`)); break; }
          case 'stop': { const t = Date.now(); await ad.stop(sid); mark(`stop returned in ${Date.now() - t} ms`); break; }
          case 'resume': await startSession(true, a ? Number(a) : undefined).then(() => mark('resume answered'), (e: unknown) => mark(`resume failed: ${msg(e)}`)); break;
          case 'send': await adapterSend(ok); break;
          case 'send&': void adapterSend(ok); break;
          case 'cmd': { const [t, q] = runText(Number(a)); watchN(Number(a)); await adapterSend(t, q); break; }
          case 'dsend': await direct(ok); break;
          case 'dsend&': void direct(ok).catch((e: unknown) => mark(`direct send failed: ${msg(e)}`)); break;
          case 'dcmd': { const [t, q] = runText(Number(a)); watchN(Number(a)); await direct(t, q); break; }
          case 'cap': { const t = Date.now(); await ad.setCap?.(sid, a === 'null' ? null : Number(a)); mark(`setCap ${a} answered in ${Date.now() - t} ms`); break; }
          case 'cap&': { const t = Date.now(); void Promise.resolve(ad.setCap?.(sid, a === 'null' ? null : Number(a))).then(() => mark(`setCap ${a} answered in ${Date.now() - t} ms`), (e: unknown) => mark(`setCap ${a} failed: ${msg(e)}`)); break; }
          case 'rawcap': await live().session.rpc.options.update({ sessionLimits: { maxAiCredits: Number(a) } }).then(() => mark(`raw cap ${a}: accepted`), (e: unknown) => mark(`raw cap ${a}: refused: ${msg(e)}`)); break;
          case 'limit': { // limit <add|set|unset|cancel> [credits]: the answer of the card shown last
            const action = (a === 'add' || a === 'set' ? { kind: a, credits: Number(b) } : { kind: a }) as never;
            const t = Date.now();
            await ad.resolveLimit?.(sid, lastLimit, action).then(() => mark(`limit ${a} answered in ${Date.now() - t} ms`), (e: unknown) => mark(`limit ${a} failed: ${msg(e)}`));
            break;
          }
          case 'limit&': {
            const action = (a === 'add' || a === 'set' ? { kind: a, credits: Number(b) } : { kind: a }) as never;
            const t = Date.now();
            void ad.resolveLimit?.(sid, lastLimit, action).then(() => mark(`limit ${a} answered in ${Date.now() - t} ms`), (e: unknown) => mark(`limit ${a} failed: ${msg(e)}`));
            break;
          }
          case 'limitlocal': { // the same, for Durbar's own card
            const action = (a === 'add' || a === 'set' ? { kind: a, credits: Number(b) } : { kind: a }) as never;
            const t = Date.now();
            await ad.resolveLimit?.(sid, live().localLimit?.requestId ?? 'none', action).then(() => mark(`local limit ${a} answered in ${Date.now() - t} ms`), (e: unknown) => mark(`local limit ${a} failed: ${msg(e)}`));
            break;
          }
          case 'adaptercapoff': live().capNow = null; mark('adapter cap forgotten (the runtime keeps its own)'); break;
          case 'poll': await pollProcessing(Number(a)); break;
          case 'wait': await sleep(Number(a)); break;
          case 'idle': { const from = Number(b ?? marks.length); await until(() => seen('raw:session.idle', from), Number(a)); break; }
          case 'procs': mark(`runtime stat: ${cp.execFileSync('ps', ['-o', 'stat=', '-p', String(runtimePid)], { encoding: 'utf8' }).trim()}`); break;
          case 'note': mark(`--- ${line.trim().slice(5, 90)}`); break;
          default: mark(`unknown command: ${cmd} ${c ?? ''}`);
        }
      };
      const inbox = path.join(replDir, 'cmd');
      const done = path.join(replDir, 'done');
      let seq = 0;
      mark(`repl ready`);
      for (;;) {
        if (!fs.existsSync(inbox)) { await sleep(100); continue; }
        const lines = fs.readFileSync(inbox, 'utf8').split('\n').filter((l) => l.trim());
        fs.unlinkSync(inbox);
        if (lines.some((l) => l.trim() === 'quit')) break;
        for (const line of lines) await runLine(line).catch((e: unknown) => { mark(`command failed: ${msg(e)}`); });
        fs.appendFileSync(done, `${++seq}\n`);
        fs.writeFileSync(outFile as string, JSON.stringify({ ...out, prompts, aiu, marks }, null, 2));
      }
    }

    if (spend && !replDir && wanted.includes('baseline')) {
      beginPhase('baseline');
      watchN(61);
      await runCommand('sleep 61');
      if (!(await until(() => seen('process sleep 61 up'), 60_000))) throw new Error('the command did not start');
      await sleep(1000);
      t0 = Date.now();
      await ad.interrupt?.(sid);
      mark('interrupt returned');
      await pollProcessing(6000);
    }

    if (spend && !replDir && wanted.includes('term')) {
      beginPhase('term');
      watchN(62);
      await runCommand(`sh -c 'trap "" TERM INT HUP; sleep 62'`);
      if (!(await until(() => seen('process sleep 62 up'), 60_000))) throw new Error('the command did not start');
      await sleep(1000);
      t0 = Date.now();
      await ad.interrupt?.(sid);
      mark('interrupt returned');
      await pollProcessing(15_000);
    }

    if (spend && !replDir && wanted.includes('hang')) {
      beginPhase('hang');
      watchN(63);
      await runCommand('sleep 63');
      if (!(await until(() => seen('process sleep 63 up'), 60_000))) throw new Error('the command did not start');
      await sleep(1000);
      t0 = Date.now();
      hang();
      await ad.interrupt?.(sid);
      mark('interrupt returned (give-up)');
      // the row says idle now: the person sends the next message while the runtime is still hung
      watchN(64);
      const sent = runCommand('sleep 64').then(() => mark('next send answered'), (e: unknown) => mark(`next send failed: ${msg(e)}`));
      await sleep(3000);
      unhang();
      await sent;
      await pollProcessing(3000);
      out.nextSendRan = await until(() => seen('process sleep 64 up'), 45_000);
      mark(`next send's command ran: ${out.nextSendRan}`);
    }

    if (spend && !replDir && wanted.includes('stop')) {
      beginPhase('stop');
      if (!sleepers(64).length) {
        watchN(64);
        await runCommand('sleep 64');
        await until(() => seen('process sleep 64 up'), 60_000);
      }
      await sleep(500);
      t0 = Date.now();
      hang();
      await ad.stop(sid);
      mark('stop returned (abort and detach given up on)');
      const resumed = startSession(true).then(() => mark('resume answered'), (e: unknown) => { mark(`resume failed: ${msg(e)}`); throw e; });
      await sleep(2000);
      unhang();
      await resumed;
      await until(() => seen('detach: answered'), 5000);
      await eventsReach();
      await pollProcessing(1500);
    }

    if (spend && !replDir && wanted.includes('question')) {
      beginPhase('question');
      const from = marks.length;
      await prompt('Use your ask_user tool to ask me this one question with the choices red and blue: "Pick one". Then reply with only my answer.');
      if (!(await until(() => seen('adapter:question:asked', from), 60_000))) throw new Error('no question came');
      // does the runtime give up on an unanswered question by itself?
      await sleep(45_000);
      mark(`still open after 45 s: ${await processing()}`);
      hang();
      const a = performance.now();
      ad.answerQuestion?.(sid, lastQuestion, { 'Pick one': 'red' });
      mark(`answerQuestion returned in ${(performance.now() - a).toFixed(2)} ms`);
      await sleep(GIVE_UP_MS + 3000);
      mark('8 s under a hang: nothing moves');
      unhang();
      const done = await until(() => seen('raw:session.idle', from), 45_000);
      mark(`turn ended after the hang: ${done}`);
    }

    if (spend && !replDir && wanted.includes('late')) {
      beginPhase('late');
      // the worst order a slow runtime could give: the old object's detach reaches the runtime after a resume of the same id. Before
      // FR-230 the resume went first and the late detach killed it; now the resume is refused until the close has landed.
      const old = live().session;
      const realDisconnect = old.disconnect.bind(old);
      let release: () => void = () => undefined;
      old.disconnect = () => { mark('detach: held back'); return new Promise<void>((r) => { release = r; }) as Promise<unknown>; };
      await ad.stop(sid);
      mark('stop returned');
      await startSession(true).then(() => mark('resumed over the open close (FR-230 failed)'), (e: unknown) => mark(`resume refused: ${msg(e)}`));
      await realDisconnect().catch(() => undefined);
      release();
      mark('late detach done');
      await startSession(true);
      mark('resumed');
      await eventsReach();
      await pollProcessing(1000);
    }

    if (spend && !replDir && wanted.includes('limit')) {
      beginPhase('limit');
      // the runtime's minimum is checked when a session is created; does an update take less, and does it ask?
      const from = marks.length;
      await live().session.rpc.options.update({ sessionLimits: { maxAiCredits: 0.001 } }).then(() => mark('cap 0.001: accepted'), (e: unknown) => mark(`cap 0.001: refused: ${msg(e)}`));
      const asked = (): boolean => marks.slice(from).some((m) => m.name.startsWith('raw:session_limits_exhausted.requested'));
      await until(asked, 3000);
      mark(`asked after the update: ${asked()}`);
      if (!asked()) {
        // past the adapter's own cap, which would hold the message: the runtime's is what is measured here
        nextPrompt();
        mark(`send past the adapter (prompt ${prompts})`);
        await live().session.send({ prompt: 'Reply with only: ok' });
        await until(() => asked() || seen('raw:session.idle', from), 60_000);
        await until(asked, 2000);
        mark(`asked after a send: ${asked()}`);
      }
      if (!asked()) {
        await ad.stop(sid);
        await startSession(true);
        await until(asked, 4000);
        mark(`asked after a resume: ${asked()}`);
      }
      out.limitAsked = asked();
      if (asked()) {
        mark(`adapter remembers the request: ${!!live().limitRequestId}`);
        hang();
        await ad.interrupt?.(sid);
        mark('interrupt returned (cancel and abort given up on)');
        unhang();
        await until(() => marks.slice(from).some((m) => m.name.startsWith('raw:session_limits_exhausted.completed')), 10_000);
        await pollProcessing(3000);
        await live().session.rpc.options.update({ sessionLimits: null }).catch((e: unknown) => mark(`cap removal failed: ${msg(e)}`));
        if (!spendRefusal({ prompts, maxPrompts: MAX_PROMPTS, aiu, maxAiu: MAX_AIU })) {
          nextPrompt();
          mark(`next send (prompt ${prompts})`);
          const f2 = marks.length;
          await live().session.send({ prompt: 'Reply with only: ok' });
          const idle = await until(() => seen('raw:session.idle', f2), 60_000);
          mark(`next send finished: ${idle}; asked again: ${marks.slice(f2).some((m) => m.name.startsWith('raw:session_limits_exhausted.requested'))}`);
        }
      }
    }
    return 0;
  } catch (e) {
    mark(`RUN STOPPED: ${msg(e)}`);
    return 1;
  } finally {
    phase = 'cleanup';
    try { if (runtimePid) process.kill(runtimePid, 'SIGCONT'); } catch { /* gone */ }
    stopWatches.forEach((s) => s());
    for (const p of leftovers) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
    Object.assign(out, { prompts, aiu, marks });
    fs.writeFileSync(outFile as string, JSON.stringify(out, null, 2));
    console.log(`prompts ${prompts}, about ${aiu.toFixed(3)} AI credits`);
    if (sid) await ad.stop(sid).catch((e: unknown) => console.log(`stop failed: ${msg(e)}`));
    const del = (ad as unknown as { deleteSession?: (s: string) => Promise<void> }).deleteSession;
    if (sid && del) await del.call(ad, sid).catch((e: unknown) => console.log(`deleteSession failed (the session stays on disk): ${msg(e)}`));
    await ad.dispose().catch((e: unknown) => console.log(`dispose failed: ${msg(e)}`));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

const watchdog = setTimeout(() => { console.error('watchdog'); process.exit(2); }, (replDir ? 90 : 15) * 60_000);
void main().then((code) => { clearTimeout(watchdog); process.exit(code); });
