/**
 * Spec 062: end-to-end check with REAL CI accounts, through Durbar's own code, on the machine it runs on (CI runners only; workflow
 * "E2E real accounts"). For each agent app: install (the first route Durbar offers, spec 060) → detect → sign in → list models →
 * one tiny read-only turn → stop. USES A FEW CREDITS (one one-line prompt per app). Never run it on your own machine: it installs
 * software into your home folder and signs Codex in with the key in OPENAI_API_KEY.
 *
 *   node dist-scripts/scripts/e2e-real.js <out.json> [--only claude,copilot,codex]
 *
 * Secrets come from the environment only (COPILOT_GITHUB_TOKEN, ANTHROPIC_API_KEY, OPENAI_API_KEY). They are never printed, logged,
 * written to a file or put on a command line: the Codex key goes over stdin, and every line printed goes through `redact()`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, execFile } from 'child_process';
import { HarnessSetup } from '../src/main/harnesssetup';
import type { SetupDone } from '../src/main/harnesssetup';
import { detectClaude, detectCodex, detectCopilot, nodeDetectEnv, nodeExec } from '../src/adapters/detect';
import type { SetupKind } from '../src/shared/harnesssetup';
import { CLAUDE_DESCRIPTOR } from '../src/adapters/claude';
import { CODEX_DESCRIPTOR } from '../src/adapters/codex';
import { COPILOT_DESCRIPTOR } from '../src/adapters/copilot';
import type { AgentAdapter, AgentEvent } from '../src/adapters/types';
import { redact } from '../src/shared/redact';

type Step = 'install' | 'detect' | 'sign-in' | 'models' | 'turn';
interface Row { app: SetupKind; os: string; ok: boolean; failedAt?: Step; route?: string; version?: string; signIn?: string; models?: number; sampleModels?: string; readOnly?: string; answer?: string; usage?: string; secs: number; detail?: string }

const APPS: { kind: SetupKind; model?: string; descriptor: { create(): AgentAdapter } }[] = [
  { kind: 'copilot', model: 'auto', descriptor: COPILOT_DESCRIPTOR },
  { kind: 'claude', model: 'haiku', descriptor: CLAUDE_DESCRIPTOR },
  { kind: 'codex', descriptor: CODEX_DESCRIPTOR },
];
const SECRETS = ['COPILOT_GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'].map((k) => process.env[k]).filter((v): v is string => !!v && v.length >= 8);
/** Every printed line: secret values cut out first (belt and braces with Actions' own masking), then the usual redaction. */
const clean = (s: unknown): string => { let t = String(s ?? ''); for (const v of SECRETS) t = t.split(v).join('[secret]'); return redact(t).replace(/\s+/g, ' ').slice(0, 300); };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function killTree(child: { pid?: number }): void {
  if (!child.pid) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => undefined);
  else try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
}

async function install(kind: SetupKind): Promise<{ ok: boolean; route?: string; detail?: string }> {
  let done: ((d: SetupDone) => void) | undefined;
  const hs = new HarnessSetup({
    detectEnv: nodeDetectEnv(),
    spawn: (file, args, opts) => spawn(file, args, { ...opts, shell: false }) as never,
    killTree: killTree as never,
    send: ((ch: string, p: unknown) => { if (ch === 'harness:done' && done) done(p as SetupDone); }) as never,
    redetect: async () => undefined,
    isRoot: () => typeof process.getuid === 'function' && process.getuid() === 0,
    limits: { install: 12 * 60_000, signin: 60_000 },
  });
  const plans = hs.plans(kind, 'install').plans;
  if (!plans.length) return { ok: false, detail: 'no install route on this machine' };
  const p = hs.prepare(kind, 'install', 0); // the first route: least privilege first (spec 060)
  if (!p.ok) return { ok: false, route: plans[0].manager, detail: p.error };
  const ready = await hs.withScript(p.job);
  if (!ready.ok) return { ok: false, route: plans[0].manager, detail: ready.error };
  const end = new Promise<SetupDone>((r) => { done = r; });
  const s = hs.start(ready.job);
  if (!s.ok) return { ok: false, route: plans[0].manager, detail: s.error };
  const d = await end;
  return { ok: d.ok, route: plans[0].manager, detail: d.ok ? undefined : `${d.reason ?? 'exit ' + d.exitCode}: ${d.lines.slice(-2).join(' | ')}` };
}

/** Only the kind of sign-in a CLI reports: its own line can carry a masked key tail, which never goes to a public log. */
const signInKind = (line: string): string => (/api key/i.test(line) ? 'API key' : /chatgpt/i.test(line) ? 'ChatGPT' : /not logged in|not signed in/i.test(line) ? 'not signed in' : 'unknown');

/** One short, redacted line of a CLI's own answer (never with a secret on the command line). */
function cliLine(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 30_000, windowsHide: true }, (_e, out, err) => resolve(clean(`${out || ''} ${err || ''}`).slice(0, 160) || '(no output)'));
  });
}

/** Codex keeps its own sign-in: `codex login --with-api-key` reads the key from stdin (never argv). */
function codexLogin(bin: string): Promise<string | undefined> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Promise.resolve('OPENAI_API_KEY is not set');
  return new Promise((resolve) => {
    const c = spawn(bin, ['login', '--with-api-key'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let err = '';
    c.stderr.on('data', (b: Buffer) => { err += b.toString(); });
    c.on('error', (e) => resolve(e.message));
    c.on('close', (code) => resolve(code === 0 ? undefined : `exit ${code}: ${err}`));
    c.stdin.end(key + '\n');
  });
}

async function check(app: (typeof APPS)[number]): Promise<Row> {
  const t0 = Date.now();
  const row: Row = { app: app.kind, os: process.platform, ok: false, secs: 0 };
  const fail = (at: Step, detail: unknown): Row => ({ ...row, failedAt: at, detail: clean(detail), secs: Math.round((Date.now() - t0) / 1000) });

  const ins = await install(app.kind);
  row.route = ins.route;
  if (!ins.ok) return fail('install', ins.detail);

  const env = nodeDetectEnv();
  const det = app.kind === 'claude' ? await detectClaude(env, nodeExec) : app.kind === 'codex' ? await detectCodex(env, nodeExec) : await detectCopilot();
  row.version = 'version' in det ? String((det as { version?: string }).version ?? '') : '';
  if (det.state === 'not-installed') return fail('detect', `detection: ${det.state} ${'hint' in det ? det.hint ?? '' : ''}`);
  const bin = (det as { path?: string }).path;
  if (app.kind === 'codex') {
    if (!bin) return fail('detect', 'codex found but no path');
    const e = await codexLogin(bin);
    if (e) return fail('sign-in', e);
  }

  const ad = app.descriptor.create();
  const events: AgentEvent[] = [];
  ad.onEvent((e) => events.push(e));
  try {
    // Durbar's own verdict is recorded, not trusted blindly: the turn below is the proof (an API-key sign-in may not be one
    // that the app's check recognises, which is itself a finding)
    const si = ad.verifySignIn ? await ad.verifySignIn() : undefined;
    row.signIn = si ? `${si.status}${si.detail ? ' (' + si.detail + ')' : ''}` : 'not checked';
    if (app.kind === 'codex' && bin) row.signIn += `; codex says: ${signInKind(await cliLine(bin, ['login', 'status']))}`;

    const models = ad.listModelOptions ? await ad.listModelOptions() : [];
    row.models = models.length;
    row.sampleModels = models.slice(0, 4).map((m) => m.id).join(', ');
    // an empty list is recorded, not failed: a Copilot Free login lists none and still runs `auto` (real 2026-10-20); the turn decides

    // the turn, read-only first (Durbar's default). Codex's read-only sandbox depends on the OS (Linux user namespaces, macOS
    // sandbox-exec, the Windows elevated sandbox): when it cannot start, that is recorded and the same one-line prompt, which uses
    // no tool, runs once more with full access in a throw-away folder, to prove the account and the turn itself.
    const ro = await turn(ad, app, events, 'read-only');
    row.readOnly = ro.ok ? 'ok' : ro.detail;
    const t = ro.ok || app.kind !== 'codex' ? ro : await turn(ad, app, events, 'allow');
    row.answer = t.answer;
    row.usage = t.usage;
    if (!t.ok) return fail('turn', t.detail);
  } catch (e) {
    return fail(row.models === undefined ? (row.signIn === undefined ? 'sign-in' : 'models') : 'turn', e instanceof Error ? e.message : e);
  } finally {
    await ad.dispose().catch(() => undefined);
  }
  return { ...row, ok: true, secs: Math.round((Date.now() - t0) / 1000) };
}

async function turn(ad: AgentAdapter, app: (typeof APPS)[number], events: AgentEvent[], mode: 'read-only' | 'allow'): Promise<{ ok: boolean; detail?: string; answer?: string; usage?: string }> {
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `durbar-e2e-${app.kind}-`));
    try {
      const sid = await ad.start({ workspace: dir, permissionMode: mode, ...(app.model ? { model: app.model } : {}), quiet: true });
      await ad.send(sid, { text: 'Reply with only the word ok.' });
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline && !events.some((e) => e.type === 'status' && (e.status === 'idle' || e.status === 'error') && e.sessionId === sid)) await sleep(250);
      // the closing event of each message holds its full text; without one, the deltas are joined
      const outs = events.filter((e) => e.type === 'output' && e.sessionId === sid) as Array<{ delta?: string; final?: boolean; text?: string }>;
      const finals = outs.filter((e) => e.final && typeof e.text === 'string');
      const out = (finals.length ? finals.map((e) => e.text).join(' ') : outs.map((e) => e.delta ?? '').join('')).trim();
      const err = events.find((e) => e.type === 'status' && e.status === 'error' && e.sessionId === sid) as { intent?: string } | undefined;
      const use = events.filter((e) => e.type === 'usage' && e.sessionId === sid) as Array<{ inputTokens?: number; outputTokens?: number; nanoAiu?: number; costUsd?: number }>;
      const answer = clean(out).slice(0, 40);
      const usage = use.length ? `${use.reduce((s, u) => s + (u.inputTokens ?? 0), 0)} in / ${use.reduce((s, u) => s + (u.outputTokens ?? 0), 0)} out${use.some((u) => u.nanoAiu) ? `, ${(use.reduce((s, u) => s + (u.nanoAiu ?? 0), 0) / 1e9).toFixed(3)} AIU` : ''}${use.some((u) => u.costUsd) ? `, ≈ $${use.reduce((s, u) => s + (u.costUsd ?? 0), 0).toFixed(4)}` : ''}` : 'none reported';
      await ad.stop(sid).catch(() => undefined);
      if (err) return { ok: false, detail: clean(err.intent ?? 'error'), answer, usage };
      if (!/\bok\b/i.test(out)) return { ok: false, detail: clean(`no "ok" in the answer: ${out.slice(0, 80) || '(empty)'}`), answer, usage };
      return { ok: true, answer, usage };
    } catch (e) {
      return { ok: false, detail: clean(e instanceof Error ? e.message : e) };
    } finally {
      // Windows: the agent's child may still hold the folder for a moment after stop (EBUSY, real 2026-10-20); cleanup never fails the check
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { /* a temp folder left behind */ }
    }
  }
}

async function main(): Promise<void> {
  const outFile = process.argv[2];
  if (!outFile) throw new Error('usage: e2e-real.js <out.json> [--only claude,copilot,codex]');
  const i = process.argv.indexOf('--only');
  const only = i > 0 ? new Set(process.argv[i + 1].split(',')) : undefined;
  const rows: Row[] = [];
  for (const app of APPS) if (!only || only.has(app.kind)) { const r = await check(app); rows.push(r); console.log(clean(`${r.ok ? 'ok  ' : 'FAIL'} ${r.app} ${r.failedAt ? 'at ' + r.failedAt + ': ' + r.detail : ''}`)); }
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 2));
  const esc = (v: unknown) => clean(v).replace(/\|/g, '\\|');
  console.log(`\n### E2E with real accounts on ${process.platform}\n\n| App | Result | Install route | Version | Sign-in | Models | Read-only turn | Answer | Usage | Time | Detail |\n|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of rows) console.log(`| ${r.app} | ${r.ok ? 'ok' : 'FAIL at ' + r.failedAt} | ${esc(r.route)} | ${esc(r.version)} | ${esc(r.signIn)} | ${r.models ?? ''} ${r.sampleModels ? '(' + esc(r.sampleModels) + ')' : ''} | ${esc(r.readOnly)} | ${esc(r.answer)} | ${esc(r.usage)} | ${r.secs} s | ${esc(r.detail)} |`);
  if (rows.some((r) => !r.ok)) process.exitCode = 1;
}
main().catch((e) => { console.error('e2e-real:', clean(e instanceof Error ? e.message : e)); process.exit(1); });
