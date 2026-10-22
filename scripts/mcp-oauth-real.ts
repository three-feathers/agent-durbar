/**
 * Spec 058 T116 (real check for T105, FR-064/FR-070): does an MCP OAuth sign-in made in one Durbar Copilot session serve a LATER session on
 * the same machine, with Durbar's `mcpOAuthTokenStorage: 'persistent'`? CI runners only (workflow "MCP OAuth real check", manual
 * dispatch). **0 prompts**: no message is sent; sign-in, MCP status and the tool list need no model call. It does use the CI account
 * (COPILOT_GITHUB_TOKEN) to start the Copilot runtime, and it leaves an MCP sign-in for a loopback demo server in the runner's keychain.
 *
 *   node dist-scripts/scripts/mcp-oauth-real.js <out.json>
 *
 * Steps:
 *   A  Durbar's Copilot adapter starts a session with the demo server (`scripts/demo-oauth-mcp.ts`, which requires OAuth) -> needs-auth?
 *      Then the call T098 will make, `session.rpc.mcp.oauth.login({serverName, clientName, callbackSuccessMessage})` -> an authorization
 *      URL; the "browser" is a plain HTTP client (the demo server auto-approves; its 302 goes to the runtime's own loopback callback).
 *      -> connected, tools listed.
 *   A2 a second session in the same runtime -> connected without a new sign-in (two agents, one sign-in).
 *   B  the runtime is shut down; a NEW adapter (new runtime process) starts a NEW session -> connected with no new `/authorize` = the
 *      sign-in was kept (FR-070). If it is not connected: `oauth.probe`, and `oauth.login` again to see whether it returns no URL.
 * Plus, names only: Windows Credential Manager targets (`cmdkey /list`) and files under ~/.copilot that look like MCP/OAuth storage,
 * before and after (one log line each; on Linux and macOS with the file's permission bits from `fs.statSync`, never its contents), and
 * every `mcp` state the adapter reported per session, in order, so a transient `needs-auth` before `connected` shows. Never a value,
 * never a token, never the authorization URL (only its host and path).
 *
 * Until T098 lands, the login call reaches the adapter's live session object directly (test-only); the session config is Durbar's own.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { COPILOT_DESCRIPTOR } from '../src/adapters/copilot';
import type { AgentAdapter, AgentEvent, McpServerStatus } from '../src/adapters/types';
import { redact } from '../src/shared/redact';
import { startDemoOAuthMcp } from './demo-oauth-mcp';
import type { DemoServer, DemoStats } from './demo-oauth-mcp';

const NAME = 'demo-oauth';
const SECRETS = ['COPILOT_GITHUB_TOKEN'].map((k) => process.env[k]).filter((v): v is string => !!v && v.length >= 8);
const clean = (s: unknown): string => { let t = String(s ?? ''); for (const v of SECRETS) t = t.split(v).join('[secret]'); return redact(t).replace(/\s+/g, ' ').slice(0, 300); };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const lines: string[] = [];
const log = (s: string): void => { const l = clean(s); lines.push(l); console.log(l); };

/** The SDK session's MCP calls this check uses (types: `@github/copilot-sdk` 1.0.22 rpc.d.ts). */
interface McpRpc {
  list(): Promise<{ servers: Array<{ name: string; status: string; error?: string }> }>;
  listTools(p: { serverName: string }): Promise<{ tools?: Array<{ name: string }> }>;
  oauth: {
    login(p: { serverName: string; clientName?: string; callbackSuccessMessage?: string }): Promise<{ authorizationUrl?: string }>;
    probe(p: { serverName: string }): Promise<{ status: string; reason?: string; error?: string }>;
  };
}
function rpcOf(ad: AgentAdapter, sid: string): McpRpc {
  const live = (ad as unknown as { sessions: Map<string, { session: { rpc: { mcp: McpRpc } } }> }).sessions.get(sid);
  if (!live) throw new Error('no live session');
  return live.session.rpc.mcp;
}

/** Every state the adapter's `mcp` events reported for the demo server in one session, in order, repeats folded (`needs-auth -> connected`).
 *  The 1 s polling of `waitState` sees only the latest event; this sequence shows a transient state too (review on #478). */
export function statusSequence(events: AgentEvent[], sid: string, name = NAME): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.type !== 'mcp' || e.sessionId !== sid) continue;
    const s = e.servers.find((x) => x.name === name);
    const st = s ? s.status : '(absent)';
    if (out[out.length - 1] !== st) out.push(st);
  }
  return out;
}

function statusOf(events: AgentEvent[], sid: string): McpServerStatus | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'mcp' && e.sessionId === sid) return e.servers.find((s) => s.name === NAME);
  }
  return undefined;
}

/** Waits for the demo server's state (adapter events first, the runtime's own list as a fallback). */
async function waitState(ad: AgentAdapter, events: AgentEvent[], sid: string, want: (s: string) => boolean, ms: number): Promise<{ status: string; error?: string; via: string; secs: number }> {
  const t0 = Date.now();
  let last = { status: 'unknown', error: undefined as string | undefined, via: 'none' };
  while (Date.now() - t0 < ms) {
    const ev = statusOf(events, sid);
    if (ev) last = { status: ev.status, error: ev.error, via: 'event' };
    if (!ev || !want(ev.status)) {
      const l = await rpcOf(ad, sid).list().catch(() => undefined);
      const s = l?.servers.find((x) => x.name === NAME);
      if (s) last = { status: s.status, error: s.error, via: 'mcp.list' };
    }
    if (want(last.status)) break;
    await sleep(1000);
  }
  return { ...last, secs: Math.round((Date.now() - t0) / 1000) };
}

const settled = (s: string): boolean => ['connected', 'needs-auth', 'failed'].includes(s);

function cmdkeyTargets(): Promise<string[] | undefined> {
  if (process.platform !== 'win32') return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile('cmdkey', ['/list'], { windowsHide: true, timeout: 20_000 }, (_e, out) => {
      resolve(String(out ?? '').split(/\r?\n/).map((l) => /^\s*Target:\s*(.+)$/i.exec(l)?.[1]?.trim()).filter((x): x is string => !!x));
    });
  });
}

/** Permission bits of a file (`0600`), from `fs.statSync` only: never opens or reads the file. On Windows the bits do not describe the ACL. */
export function modeOf(abs: string): string {
  try { return (fs.statSync(abs).mode & 0o777).toString(8).padStart(4, '0'); } catch { return '?'; }
}

/** File names (relative) under ~/.copilot; only the names, never contents. */
function copilotFiles(): string[] {
  const root = path.join(os.homedir(), '.copilot');
  const out: string[] = [];
  const walk = (d: string, depth: number): void => {
    if (depth > 4 || out.length > 2000) return;
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  };
  walk(root, 0);
  return out;
}
const interesting = (n: string): boolean => /copilot|mcp|oauth|127\.0\.0\.1|localhost|token|credential|keychain|secret/i.test(n);
/** Session folders hold no auth; their names are ids, not interesting. */
const notSession = (n: string): boolean => !/^(session-state|history-session-state|logs)\//.test(n);

/** The "browser": GET the authorization URL, follow the demo server's 302 to the runtime's loopback callback. */
async function browser(authUrl: string): Promise<string> {
  const a = await fetch(authUrl, { redirect: 'manual' });
  const loc = a.headers.get('location');
  if (a.status !== 302 || !loc) return `authorize answered ${a.status}`;
  const cb = new URL(loc);
  if (cb.searchParams.get('error')) return `authorize refused: ${cb.searchParams.get('error')}`;
  const r = await fetch(cb, { redirect: 'manual' });
  return `callback ${cb.protocol}//${cb.hostname}${cb.pathname} answered ${r.status}`;
}

const delta = (a: DemoStats, b: DemoStats): string => `registrations +${b.registrations - a.registrations}, sign-ins (authorize) +${b.authorizations - a.authorizations}, code grants +${b.codeGrants - a.codeGrants}, refresh grants +${b.refreshGrants - a.refreshGrants}, 401s +${b.challenges - a.challenges}, MCP requests with a token +${b.authorizedRequests - a.authorizedRequests}`;
const snap = (s: DemoStats): DemoStats => ({ ...s, methods: [...s.methods] });

async function newSession(label: string, ad: AgentAdapter, events: AgentEvent[], demo: DemoServer, dir: string): Promise<string> {
  const sid = await ad.start({ workspace: dir, permissionMode: 'read-only', quiet: true, mcpServers: { [NAME]: { type: 'http', url: demo.url, tools: ['*'] } } });
  log(`${label}: session started`);
  return sid;
}

/** A package's version from its package.json. The SDK's `exports` map does not list `./package.json`, so it is read from the folder
 *  next to the SDK's resolved entry (node_modules/@github/<name>), never through `require.resolve('<name>/package.json')`. */
function versionOf(name: string): string {
  try {
    let d = path.dirname(require.resolve('@github/copilot-sdk'));
    while (path.basename(path.dirname(d)) !== '@github' && path.dirname(d) !== d) d = path.dirname(d);
    const pj = path.join(path.dirname(d), name.replace(/^@github\//, ''), 'package.json');
    return (JSON.parse(fs.readFileSync(pj, 'utf8')) as { version?: string }).version ?? '?';
  } catch {
    return '?';
  }
}

interface Result {
  os: string; arch: string; node: string; runtime: string; sdk: string; prompts: 0;
  a?: { first: string; login?: string; browser?: string; after?: string; tools?: string; demo?: string };
  a2?: { state: string; demo: string };
  b?: { state: string; demo: string; probe?: string; relogin?: string };
  credman?: { before: number; after: number; added: string[] };
  files?: { added: Array<{ name: string; mode?: string }> };
  /** Every `mcp` state the adapter reported per session, in order (A, A2, B). */
  sequences?: Record<string, string>;
  verdict: string;
  lines: string[];
}

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) throw new Error('usage: mcp-oauth-real.js <out.json>');
  const res: Result = { os: `${process.platform} ${os.release()}`, arch: process.arch, node: process.version, runtime: versionOf(`@github/copilot-sdk-${process.platform}-${process.arch}`), sdk: versionOf('@github/copilot-sdk'), prompts: 0, verdict: 'not run', lines };
  const demo = await startDemoOAuthMcp();
  log(`demo OAuth MCP server on ${demo.base} (loopback, auto-approve)`);
  const start = snap(demo.stats);
  const credBefore = await cmdkeyTargets();
  const filesBefore = new Set(copilotFiles());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-mcp-oauth-'));
  res.sequences = {};
  const seq = (label: string, events: AgentEvent[], sid: string): void => {
    const q = statusSequence(events, sid).join(' -> ') || '(no mcp event)';
    res.sequences![label] = q;
    log(`${label}: every mcp state the adapter reported, in order: ${q}`);
  };
  let ad: AgentAdapter | undefined;
  try {
    // ---- A: first session, sign in through the runtime
    ad = COPILOT_DESCRIPTOR.create();
    const evA: AgentEvent[] = [];
    ad.onEvent((e) => evA.push(e));
    const sid = await newSession('A', ad, evA, demo, dir);
    const s0 = await waitState(ad, evA, sid, settled, 60_000);
    res.a = { first: `${s0.status} (${s0.via}, ${s0.secs} s)${s0.error ? ': ' + clean(s0.error) : ''}` };
    log(`A: demo server ${res.a.first}; demo: ${delta(start, demo.stats)}`);
    if (s0.status !== 'connected') {
      const before = snap(demo.stats);
      const lr = await rpcOf(ad, sid).oauth.login({ serverName: NAME, clientName: 'Agent Durbar', callbackSuccessMessage: 'Signed in. You can close this tab and go back to Agent Durbar.' });
      if (lr.authorizationUrl) {
        const u = new URL(lr.authorizationUrl);
        res.a.login = `authorizationUrl on ${u.protocol}//${u.host}${u.pathname}`;
        log(`A: oauth.login -> ${res.a.login}`);
        res.a.browser = await browser(lr.authorizationUrl);
        log(`A: browser step: ${res.a.browser}`);
      } else {
        res.a.login = 'no authorizationUrl (runtime says cached tokens were valid)';
        log(`A: oauth.login -> ${res.a.login}`);
      }
      const s1 = await waitState(ad, evA, sid, (s) => s === 'connected' || s === 'failed', 60_000);
      res.a.after = `${s1.status} (${s1.via}, ${s1.secs} s)${s1.error ? ': ' + clean(s1.error) : ''}`;
      res.a.demo = delta(before, demo.stats);
      log(`A: after sign-in: ${res.a.after}; demo: ${res.a.demo}`);
    }
    const tools = await rpcOf(ad, sid).listTools({ serverName: NAME }).then((t) => (t.tools ?? []).map((x) => x.name).join(', '), (e: unknown) => `listTools failed: ${clean(e instanceof Error ? e.message : e)}`);
    res.a.tools = tools;
    log(`A: tools: ${tools}`);

    // ---- A2: another session in the same runtime (two agents, one sign-in)
    {
      const before = snap(demo.stats);
      const sid2 = await newSession('A2', ad, evA, demo, dir);
      const s = await waitState(ad, evA, sid2, settled, 60_000);
      res.a2 = { state: `${s.status} (${s.via}, ${s.secs} s)${s.error ? ': ' + clean(s.error) : ''}`, demo: delta(before, demo.stats) };
      log(`A2: ${res.a2.state}; demo: ${res.a2.demo}`);
      await sleep(2000);
      seq('A2', evA, sid2);
      await ad.stop(sid2).catch(() => undefined);
    }
    seq('A', evA, sid);
    await ad.stop(sid).catch(() => undefined);
    await ad.dispose().catch(() => undefined);
    ad = undefined;
    log('A: session ended, runtime shut down');
    await sleep(3000);

    // ---- B: new runtime process, new session
    {
      const before = snap(demo.stats);
      ad = COPILOT_DESCRIPTOR.create();
      const evB: AgentEvent[] = [];
      ad.onEvent((e) => evB.push(e));
      const sidB = await newSession('B', ad, evB, demo, dir);
      const s = await waitState(ad, evB, sidB, settled, 60_000);
      res.b = { state: `${s.status} (${s.via}, ${s.secs} s)${s.error ? ': ' + clean(s.error) : ''}`, demo: delta(before, demo.stats) };
      log(`B: ${res.b.state}; demo: ${res.b.demo}`);
      const pr = await rpcOf(ad, sidB).oauth.probe({ serverName: NAME }).then((p) => `${p.status}${p.reason ? ' (' + p.reason + ')' : ''}${p.error ? ': ' + p.error : ''}`, (e: unknown) => `probe failed: ${e instanceof Error ? e.message : e}`);
      res.b.probe = clean(pr);
      log(`B: oauth.probe -> ${res.b.probe}`);
      if (s.status !== 'connected') {
        // does the runtime still hold a token it can use when asked to sign in again? (no browser step here)
        const lr = await rpcOf(ad, sidB).oauth.login({ serverName: NAME, clientName: 'Agent Durbar' }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }) as { authorizationUrl?: string; error?: string });
        res.b.relogin = 'error' in lr && lr.error ? `login failed: ${clean(lr.error)}` : lr.authorizationUrl ? 'a NEW authorizationUrl (no kept sign-in)' : 'no authorizationUrl (the kept sign-in was used)';
        log(`B: oauth.login again -> ${res.b.relogin}`);
      }
      const after = await waitState(ad, evB, sidB, settled, 5_000);
      if (after.status === 'connected') {
        const t = await rpcOf(ad, sidB).listTools({ serverName: NAME }).then((x) => (x.tools ?? []).map((y) => y.name).join(', '), () => '');
        log(`B: tools: ${t}`);
      }
      await sleep(2000);
      seq('B', evB, sidB);
      const bConnected = after.status === 'connected';
      const noNewSignIn = demo.stats.authorizations === before.authorizations;
      res.verdict = res.a.after?.startsWith('connected') || res.a.first.startsWith('connected')
        ? bConnected && noNewSignIn ? 'PASS: session B connected with no new sign-in (the sign-in was kept across sessions and runtime processes)' : `FAIL: session B ${after.status}, new sign-ins ${demo.stats.authorizations - before.authorizations}`
        : 'FAIL: session A never connected after sign-in';
      await ad.stop(sidB).catch(() => undefined);
    }
  } catch (e) {
    res.verdict = `ERROR: ${clean(e instanceof Error ? e.message : e)}`;
    log(res.verdict);
  } finally {
    await ad?.dispose().catch(() => undefined);
    const credAfter = await cmdkeyTargets();
    if (credBefore && credAfter) {
      const added = credAfter.filter((t) => !credBefore.includes(t));
      res.credman = { before: credBefore.length, after: credAfter.length, added: added.filter(interesting).map(clean) };
      log(`Credential Manager: ${credBefore.length} -> ${credAfter.length} targets; new ones that look like Copilot/MCP: ${res.credman.added.length || '(none)'}${added.length > res.credman.added.length ? ` (+${added.length - res.credman.added.length} other)` : ''}`);
      for (const t of res.credman.added) log(`  target ${t}`);
    }
    const added = copilotFiles().filter((f) => !filesBefore.has(f) && notSession(f));
    // one line per file: clean() caps a line at 300 characters, which cut the Linux list (review on #478). Name and mode bits only.
    const posix = process.platform !== 'win32';
    res.files = { added: added.slice(0, 40).map((f) => ({ name: clean(f), mode: posix ? modeOf(path.join(os.homedir(), '.copilot', ...f.split('/'))) : undefined })) };
    log(`~/.copilot new files (names only${posix ? ' and permission bits' : ''}, session folders left out): ${res.files.added.length || '(none)'}${added.length > 40 ? ` (first 40 of ${added.length})` : ''}`);
    for (const f of res.files.added) log(`  file ${f.name}${f.mode ? ` mode ${f.mode}` : ''}`);
    log(`verdict: ${res.verdict}`);
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { /* a temp folder left behind */ }
    await demo.close();
    fs.writeFileSync(out, JSON.stringify(res, null, 2));
    const md = `### MCP OAuth real check on ${res.os} (${res.arch})\n\nCopilot runtime ${res.runtime} (SDK ${res.sdk}), Node ${res.node}, prompts sent: 0\n\n**${res.verdict}**\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`;
    fs.writeFileSync(out.replace(/\.json$/, '.md'), md);
    if (!res.verdict.startsWith('PASS')) process.exitCode = 1;
  }
}
if (require.main === module) main().catch((e) => { console.error('mcp-oauth-real:', clean(e instanceof Error ? e.message : e)); process.exit(1); });
