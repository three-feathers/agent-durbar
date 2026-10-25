/**
 * Spec 058 (issue #364), T101: the MCP Sign in in main. `npm run test:mcpsignin`. No Electron, no network, no AI credits, no real
 * session, no browser (the opener is a recorder).
 *  - `McpSignInStore`: the address is kept per agent and server for 10 minutes (injected clock), one at a time, dropped on connected,
 *    Cancel, the time limit and End; the window's view has the host only.
 *  - `mcpSignInOp`, `mcpOpenSignInOp`, `mcpCancelSignInOp` on the fake adapter: validation, `http:` / user:password / too long refused,
 *    the two-step open, masked errors without any address, a missing method -> manual.
 *  - `agentMcpReply`: `canSignIn`, `signIn`, `signInSteps` (name filled in, an odd name never becomes part of a command).
 *  - the registered channels (`registerMcpIpc` on a stand-in electron): window-only, a connected `mcp` event and a stopped session drop the
 *    entry, and no address reaches the `DURBAR_LOG` sink, the activity-log hook or the console.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { FakeAdapter } from '../src/adapters/fake';
import type { AgentAdapter, AgentEvent, McpServerStatus } from '../src/adapters/types';
import type { AgentInfo } from '../src/shared/api';
import { createDebugSink } from '../src/shared/redact';
import { agentMcpReply, signInStepsFor } from '../src/main/mcpsession';
import type { McpReplyInput } from '../src/main/mcpsession';
import { MAX_SIGN_INS, McpSignInStore, POLL_MS, RECENT_SIGN_IN_MS, SIGN_IN_MIN_TTL_MS, SIGN_IN_TTL_MS, appServerUrls, blockedAuthHost, mcpCancelSignInOp, mcpOpenSignInOp, mcpSignInOp, registrableDomain, serverUrlFor, signInErrorText, signInSiteNote } from '../src/main/mcpsignin';
import type { ServerUrlSources } from '../src/main/mcpsignin';
import type { McpServerSpec } from '../src/shared/mcp';
import { SIGN_IN_MIN_TTL_MS as SHARED_MIN_TTL_MS, SIGN_IN_REQUEST_TIMEOUT_MS, signInTtlMs } from '../src/shared/mcp';
import { CLAUDE_SIGN_IN_TIMEOUT_MS, ClaudeAdapter, claudeArgs } from '../src/adapters/claude';
import { createCliTransport } from '../src/adapters/claudeTransport';
import { fakeSpawn, SANDBOX_HOST_OK } from './fakes/claude-cli';
import { McpStore } from '../src/main/mcpstore';

const PAGE = 'https://auth.example.com/authorize?client_id=abc&state=SECRETSTATE123&code_challenge=PKCEPKCEPKCE';
const info = (id: string): AgentInfo => ({ id, name: 'Ana', cwd: '/w', permMode: 'ask', model: 'auto' }) as AgentInfo;
const routerOf = (ad: AgentAdapter | undefined) => ({ forAgent: () => ad });
const NEEDS: McpServerStatus[] = [{ name: 'teams', status: 'needs-auth', errorClass: 'auth' }, { name: 'web', status: 'connected' }];
const STEPS = 'In a terminal, run `copilot`, type `/mcp auth {name}` and finish in your browser.';

let done = false;
process.on('exit', (code) => {
  if (code === 0 && !done) {
    console.error('[058] mcp signin: FAIL (exited before the last check; a pending promise never settled)');
    process.exitCode = 1;
  }
});

async function main(): Promise<void> {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-mcp-signin-'));
  try {
    // ---- the preload passes ids, names and the shown host only: never an address (the window cannot supply one) ----
    {
      const pre = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'preload', 'preload.ts'), 'utf8');
      const lines = pre.split('\n').filter((l) => /agents:mcp(SignIn|OpenSignIn|CancelSignIn)'/.test(l)).map((l) => l.trim());
      assert.deepStrictEqual(lines, [
        "agentMcpSignIn: (id, name, again) => ipcRenderer.invoke('agents:mcpSignIn', id, name, again === true),",
        "agentMcpOpenSignIn: (id, name, host) => ipcRenderer.invoke('agents:mcpOpenSignIn', id, name, host),",
        "agentMcpCancelSignIn: (id, name) => ipcRenderer.invoke('agents:mcpCancelSignIn', id, name),",
      ], 'the three preload lines');
    }

    // ---- the store (FR-065) ----
    {
      let t = 1_000;
      const opened: string[] = [];
      const st = new McpSignInStore(() => t, async (u) => { opened.push(u); });
      assert.strictEqual(SIGN_IN_TTL_MS, 600_000, 'ten minutes');
      assert.ok(st.reserve('a', 'x') && !st.reserve('a', 'x'), 'reserve: the second one is refused while the first is starting');
      st.release('a', 'x');
      assert.ok(st.begin('a', 'x', PAGE, 'auth.example.com'));
      assert.ok(!st.begin('a', 'x', PAGE, 'auth.example.com') && !st.reserve('a', 'x'), 'one sign-in per server at a time');
      assert.ok(st.begin('a', 'y', PAGE, 'auth.example.com') && st.begin('b', 'x', PAGE, 'auth.example.com'), 'another server or agent may run');
      assert.deepStrictEqual(st.view('a', 'x'), { host: 'auth.example.com', opened: false, expiresInMs: 600_000 });
      assert.ok(!JSON.stringify(st.view('a', 'x')).includes('SECRETSTATE'), 'the window\'s view has no address');
      t += 599_999;
      assert.ok(st.has('a', 'x') && st.view('a', 'x')!.expiresInMs === 1, 'one millisecond before the limit it is still open');
      t += 1;
      assert.ok(!st.has('a', 'x') && st.view('a', 'x') === undefined, 'at 10 minutes it is gone');
      assert.strictEqual(await st.open('a', 'x', 'auth.example.com'), 'gone', 'an expired sign-in is not opened');
      assert.deepStrictEqual(opened, []);
      assert.ok(st.begin('a', 'x', PAGE, 'auth.example.com'), 'after the limit a new one may start');
      // opening: only the held address, re-checked
      assert.strictEqual(await st.open('a', 'x', 'auth.example.com'), 'opened');
      assert.deepStrictEqual(opened, [PAGE], 'the opener got the held address, after the call');
      assert.strictEqual(st.view('a', 'x')!.opened, true);
      // dropped: connected, Cancel, End
      st.onServers('a', [{ name: 'x', status: 'needs-auth' }, { name: 'y', status: 'connected' }]);
      assert.ok(st.has('a', 'x') && !st.has('a', 'y'), 'a connected report drops that server only');
      st.onServers('a', [{ name: 'x', status: 'connected' }]);
      assert.ok(!st.has('a', 'x'));
      assert.ok(st.begin('a', 'x', PAGE, 'h') && st.drop('a', 'x') && !st.drop('a', 'x'), 'Cancel drops');
      st.begin('a', 'x', PAGE, 'h');
      st.begin('b', 'x', PAGE, 'h');
      st.dropAgent('a');
      assert.ok(!st.has('a', 'x') && st.has('b', 'x'), 'End session drops that agent\'s sign-ins, not another agent\'s');
      st.clear();
      assert.ok(!st.has('b', 'x'), 'app exit');
      // a tampered or old entry that is not https is refused at open time (defence in depth) and dropped
      st.begin('a', 'z', 'http://auth.example.com/x', 'auth.example.com');
      opened.length = 0;
      assert.strictEqual(await st.open('a', 'z', 'auth.example.com'), 'refused');
      assert.deepStrictEqual(opened, [], 'http: never reaches the opener');
      assert.ok(!st.has('a', 'z'));
      // the opener fails: the entry stays and the error is not an address
      const bad = new McpSignInStore(() => 0, async () => { throw new Error(`no browser for ${PAGE}`); });
      bad.begin('a', 'x', PAGE, 'h');
      assert.strictEqual(await bad.open('a', 'x', 'h'), 'failed');
      assert.ok(bad.has('a', 'x') && bad.view('a', 'x')!.opened === false, 'a failed open can be tried again');
    }

    // ---- the operations (FR-065, Q13, Q16) ----
    {
      let t = 0;
      const opened: string[] = [];
      const store = new McpSignInStore(() => t, async (u) => { opened.push(u); });
      const ad = new FakeAdapter({ displayName: 'Copilot', capabilities: { mcpSignIn: true, mcpSignInSteps: STEPS } });
      ad.signInResult = { kind: 'browser', url: PAGE };
      const sid = await ad.start({ workspace: ws, quiet: true });
      const agents = new Map([[sid, info(sid)]]);
      let live: McpServerStatus[] = NEEDS;
      const secret = 'planted-secret-value-123456';
      const d = { agents, router: routerOf(ad), live: () => live, secrets: () => [secret] };
      const calls = () => ad.signInCalls.map((c) => (c.cancel ? 'cancel ' : 'start ') + c.name);

      assert.deepStrictEqual(await mcpSignInOp(d, store, 'nope', 'teams'), { ok: false, error: 'Unknown agent or server.' });
      for (const bad of ['', 'x'.repeat(65), 7, { toString: () => 'teams' }, undefined]) assert.strictEqual((await mcpSignInOp(d, store, sid, bad)).ok, false, `name ${String(bad).slice(0, 8)} refused`);
      assert.strictEqual((await mcpSignInOp(d, store, { toString: () => sid }, 'teams')).ok, false, 'a non-string id is refused');
      assert.match((await mcpSignInOp(d, store, sid, 'ghost') as { error: string }).error, /not running in this session/);
      assert.match((await mcpSignInOp(d, store, sid, 'web') as { error: string }).error, /does not need a sign-in/, 'a running server does not sign in');
      assert.deepStrictEqual(calls(), [], 'nothing was asked of the runtime for any of these');

      // the happy path: the reply has the host, never the address
      const r = await mcpSignInOp(d, store, sid, 'teams');
      assert.deepStrictEqual(r, { ok: true, kind: 'browser', host: 'auth.example.com' });
      assert.ok(!JSON.stringify(r).includes('SECRETSTATE') && !JSON.stringify(r).includes('authorize'), 'no address in the reply');
      assert.deepStrictEqual(calls(), ['start teams'], 'exactly one runtime call');
      assert.deepStrictEqual(opened, [], 'nothing opened before the user\'s click');
      // one at a time
      assert.deepStrictEqual(await mcpSignInOp(d, store, sid, 'teams'), { ok: false, error: 'A sign-in for teams is already open.' });
      assert.strictEqual(calls().length, 1, 'the second press asked nothing');
      // the second step
      assert.deepStrictEqual(await mcpOpenSignInOp(store, agents, sid, 'teams', 'auth.example.com'), { ok: true });
      assert.deepStrictEqual(opened, [PAGE], 'the held address was opened, once');
      assert.deepStrictEqual(await mcpOpenSignInOp(store, agents, 'nope', 'teams', 'auth.example.com'), { ok: false, error: 'Unknown agent or server.' });
      assert.strictEqual((await mcpOpenSignInOp(store, agents, sid, 'x'.repeat(65), 'auth.example.com')).ok, false);
      assert.strictEqual((await mcpOpenSignInOp(store, agents, sid, 'web', 'auth.example.com')).gone, true, 'nothing held for web');
      // Cancel: forgotten, the adapter's cancel is called, a second Cancel is harmless
      assert.deepStrictEqual(await mcpCancelSignInOp(d, store, sid, 'teams'), { ok: true });
      assert.ok(!store.has(sid, 'teams'));
      assert.deepStrictEqual(calls(), ['start teams', 'cancel teams']);
      assert.deepStrictEqual(await mcpCancelSignInOp(d, store, sid, 'teams'), { ok: true });
      assert.strictEqual(calls().length, 2, 'cancelling nothing calls nothing');
      assert.strictEqual((await mcpCancelSignInOp(d, store, 'nope', 'teams')).ok, false);
      assert.strictEqual((await mcpOpenSignInOp(store, agents, sid, 'teams', 'auth.example.com')).gone, true, 'after Cancel nothing opens');

      // several servers that need a sign-in at once (figma, signavio, wordserver): each one is independent
      live = [{ name: 'figma', status: 'needs-auth' }, { name: 'signavio', status: 'needs-auth' }, { name: 'wordserver', status: 'needs-auth', errorClass: 'auth' }, ...NEEDS];
      const multi = new McpSignInStore(() => t, async () => undefined);
      const md = { ...d };
      for (const n of ['figma', 'signavio', 'wordserver']) assert.strictEqual((await mcpSignInOp(md, multi, sid, n)).ok, true, `${n} signs in`);
      assert.deepStrictEqual(['figma', 'signavio', 'wordserver'].map((n) => multi.has(sid, n)), [true, true, true], 'three pending entries, one per server');
      assert.strictEqual((await mcpSignInOp(md, multi, sid, 'figma')).ok, false, 'the same server twice is refused');
      await mcpCancelSignInOp(md, multi, sid, 'signavio');
      assert.deepStrictEqual(['figma', 'signavio', 'wordserver'].map((n) => multi.has(sid, n)), [true, false, true], 'Cancel of one leaves the others');
      multi.onServers(sid, [{ name: 'figma', status: 'connected' }]);
      assert.deepStrictEqual(['figma', 'wordserver'].map((n) => multi.has(sid, n)), [false, true], 'connected for one leaves the others');
      ad.signInCalls.length = 0;
      live = NEEDS;
      // the 10-minute limit
      assert.strictEqual((await mcpSignInOp(d, store, sid, 'teams')).ok, true);
      t += SIGN_IN_TTL_MS - 1;
      assert.ok(store.has(sid, 'teams'));
      t += 1;
      const late = await mcpOpenSignInOp(store, agents, sid, 'teams', 'auth.example.com');
      assert.deepStrictEqual([late.ok, late.gone], [false, true], 'after 10 minutes the page is not opened');
      assert.match(late.error!, /no longer open/);
      assert.strictEqual((await mcpSignInOp(d, store, sid, 'teams')).ok, true, 'and a new Sign in works');
      store.drop(sid, 'teams');

      // Q16: refused addresses are never held or opened, and the manual steps are shown
      for (const bad of ['http://auth.example.com/authorize', 'https://user:pw@auth.example.com/a', 'https://user@auth.example.com/a', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url', 'https://auth.example.com/' + 'a'.repeat(2100)]) {
        ad.signInResult = { kind: 'browser', url: bad };
        ad.signInCalls.length = 0;
        const x = await mcpSignInOp(d, store, sid, 'teams');
        assert.strictEqual(x.ok, false, `refused: ${bad.slice(0, 40)}`);
        assert.strictEqual((x as { manual?: boolean }).manual, true, 'the terminal steps are shown');
        assert.ok(!JSON.stringify(x).includes('pw@') && !JSON.stringify(x).includes('passwd'), 'the refusal repeats no address');
        assert.ok(!store.has(sid, 'teams'), 'nothing held');
        assert.deepStrictEqual(calls(), ['start teams', 'cancel teams'], 'the runtime\'s listener is told to stop where it can');
      }
      opened.length = 0;
      // already connected
      ad.signInResult = { kind: 'connected' };
      assert.deepStrictEqual(await mcpSignInOp(d, store, sid, 'teams'), { ok: true, kind: 'connected' });
      assert.ok(!store.has(sid, 'teams'));

      // the runtime fails: masked, no address, manual steps
      const stub = ad as unknown as { startMcpSignIn: (s: string, n: string) => Promise<unknown> };
      const real = stub.startMcpSignIn;
      stub.startMcpSignIn = async () => { throw new Error(`login failed at ${PAGE} using ${secret} Authorization: Bearer abcdefghijklmnop`); };
      const f = await mcpSignInOp(d, store, sid, 'teams');
      assert.strictEqual(f.ok, false);
      assert.strictEqual((f as { manual?: boolean }).manual, true);
      const ftext = (f as { error: string }).error;
      const leaked = [/SECRETSTATE/, /example\.com/i, /abcdefghijklmnop/].some((re) => re.test(ftext)) || ftext.includes(secret);
      assert.ok(!leaked, `no address or secret in the error: ${ftext}`);
      assert.ok(!store.has(sid, 'teams') && store.reserve(sid, 'teams'), 'a failed start leaves nothing held or reserved');
      store.release(sid, 'teams');
      assert.strictEqual(signInErrorText(new Error('x'), [], 'fallback'), 'x');
      assert.strictEqual(signInErrorText(new Error('  '), [], 'fallback'), 'fallback', 'an empty error gets the fallback');
      stub.startMcpSignIn = real;

      // no method (an older runtime or another agent app): manual, nothing asked
      const noMethod = new FakeAdapter({ displayName: 'Codex', capabilities: { mcpSignIn: true }, omit: ['startMcpSignIn'] });
      const sid2 = await noMethod.start({ workspace: ws, quiet: true });
      const r2 = await mcpSignInOp({ ...d, agents: new Map([[sid2, info(sid2)]]), router: routerOf(noMethod) }, store, sid2, 'teams');
      assert.deepStrictEqual([r2.ok, (r2 as { manual?: boolean }).manual], [false, true]);
      assert.match((r2 as { error: string }).error, /Codex cannot start a sign-in/);
      // a session that is not running
      await ad.stop(sid);
      const r3 = await mcpSignInOp(d, store, sid, 'teams');
      assert.deepStrictEqual([r3.ok, (r3 as { manual?: boolean }).manual], [false, true]);
      assert.match((r3 as { error: string }).error, /not running\. Send a message to start it, then sign in/);
    }

    // ---- review on #598: refused addresses, host binding, provenance, session end, cap ----
    {
      let t = 0;
      const opened: string[] = [];
      const store = new McpSignInStore(() => t, async (u) => { opened.push(u); });
      const ad = new FakeAdapter({ displayName: 'Copilot', capabilities: { mcpSignIn: true, mcpSignInSteps: STEPS } });
      const sid = await ad.start({ workspace: ws, quiet: true });
      const agents = new Map([[sid, info(sid)]]);
      let serverUrl: string | undefined;
      const d = { agents, router: routerOf(ad), live: () => NEEDS, secrets: () => [] as string[], serverUrl: () => serverUrl };
      const go = async (url: string, su?: string) => {
        ad.signInResult = { kind: 'browser', url };
        serverUrl = su;
        store.drop(sid, 'teams');
        return mcpSignInOp(d, store, sid, 'teams');
      };
      // whitespace, tabs and newlines anywhere in the text are refused (the URL parser would drop them silently)
      for (const bad of ['https://auth.example.com/a\tb', 'https://auth.example.com/a\nb', 'https://auth.example.com/a\r\nb', ' https://auth.example.com/a', 'https://auth.example.com/a ', '\thttps://auth.example.com/a', 'https://auth.exa\tmple.com/a', 'https://auth.example.com/a\u0000b', 'https://auth.example.com/a b']) {
        const r = await go(bad);
        assert.deepStrictEqual([r.ok, (r as { manual?: boolean }).manual], [false, true], `refused: ${JSON.stringify(bad)}`);
        assert.ok(!store.has(sid, 'teams'), 'nothing held');
      }
      // an IDN host is shown, held and opened in punycode
      const idn = await go('https://аuth.example.com/authorize?x=1');
      assert.strictEqual(idn.ok, true);
      const shown = (idn as { host: string }).host;
      assert.ok(/^xn--/.test(shown), `the confirm shows the punycode host: ${shown}`);
      assert.ok(shown !== 'auth.example.com' && !/[^\x00-\x7f]/.test(shown), 'a lookalike never reads like the real domain');
      assert.deepStrictEqual(await mcpOpenSignInOp(store, agents, sid, 'teams', shown), { ok: true });
      assert.strictEqual(new URL(opened[opened.length - 1]).hostname, shown, 'the opened address has the host that was shown');
      // the open is bound to the host that was shown: a different, missing or non-string host opens nothing
      const n0 = opened.length;
      const r2 = await go('https://auth.example.com/a');
      assert.strictEqual(r2.ok, true);
      for (const wrong of ['evil.example.net', '', undefined, null, 7, { host: 'auth.example.com' }, ['auth.example.com'], 'AUTH.example.com']) {
        const x = await mcpOpenSignInOp(store, agents, sid, 'teams', wrong);
        assert.deepStrictEqual([x.ok, x.gone], [false, true], `host ${JSON.stringify(wrong)}: refused`);
      }
      assert.strictEqual(opened.length, n0, 'a host mismatch opened nothing');
      assert.strictEqual(store.has(sid, 'teams'), true, 'and the entry stays for the right click');
      assert.deepStrictEqual(await mcpOpenSignInOp(store, agents, sid, 'teams', 'auth.example.com'), { ok: true });
      // local and private hosts take the manual route
      for (const h of ['localhost', 'a.localhost', '127.0.0.1', '127.1.2.3', '2130706433', '0x7f.1', '[::1]', '[fe80::1]', '10.0.0.1', '172.16.5.5', '172.31.255.1', '192.168.1.1', '169.254.1.1', '8.8.8.8', 'intranet', 'auth.example.com.', 'LOCALHOST']) {
        if (h === 'auth.example.com.') continue;
        const r = await go(`https://${h}/authorize`);
        assert.deepStrictEqual([r.ok, (r as { manual?: boolean }).manual], [false, true], `${h} is refused`);
      }
      assert.ok(!blockedAuthHost('auth.example.com') && !blockedAuthHost('login.microsoftonline.com') && blockedAuthHost('::1') && blockedAuthHost(''), 'public names stay open');
      // FR-075: where the page is, compared with the server's own site
      assert.strictEqual(registrableDomain('login.example.co.uk'), 'example.co.uk');
      assert.strictEqual(registrableDomain('a.b.example.com'), 'example.com');
      assert.strictEqual(signInSiteNote('https://mcp.example.com/mcp', 'auth.example.com'), undefined, 'same site: no line');
      assert.strictEqual(signInSiteNote('https://mcp.example.com/mcp', 'login.example.net'), 'mcp.example.com', 'other site: the server host');
      assert.strictEqual(signInSiteNote('https://api.example.co.uk/mcp', 'login.example.co.uk'), undefined, 'co.uk: same site');
      assert.strictEqual(signInSiteNote('https://api.example.co.uk/mcp', 'login.other.co.uk'), 'api.example.co.uk', 'co.uk: other site');
      assert.strictEqual(signInSiteNote(undefined, 'auth.example.com'), undefined, 'a stdio or runtime-only server has no line');
      assert.strictEqual(signInSiteNote('node server.js', 'auth.example.com'), undefined);
      const far = await go('https://login.example.net/authorize', 'https://mcp.example.com/mcp');
      assert.deepStrictEqual(far, { ok: true, kind: 'browser', host: 'login.example.net', otherSite: 'mcp.example.com' });
      assert.strictEqual(store.view(sid, 'teams')!.otherSite, 'mcp.example.com', 'the line is part of the view the dialog repaints');
      const near = await go('https://auth.example.com/authorize', 'https://mcp.example.com/mcp');
      assert.deepStrictEqual(near, { ok: true, kind: 'browser', host: 'auth.example.com' });
      assert.strictEqual(store.view(sid, 'teams')!.otherSite, undefined);
      store.drop(sid, 'teams');

      // Sign in -> Cancel -> Sign in again: the runtime is asked again each time (what its listener does is T105)
      ad.signInCalls.length = 0;
      assert.strictEqual((await go('https://auth.example.com/a')).ok, true);
      await mcpCancelSignInOp(d, store, sid, 'teams');
      ad.signInResult = { kind: 'browser', url: 'https://auth.example.com/b' };
      assert.strictEqual((await mcpSignInOp(d, store, sid, 'teams')).ok, true);
      assert.deepStrictEqual(ad.signInCalls.map((c) => (c.cancel ? 'cancel ' : 'start ') + c.name), ['start teams', 'cancel teams', 'start teams'], 'a second Sign in calls the runtime again');
      store.drop(sid, 'teams');

      // a status that is not a sign-in need (pending with an auth class) is not signed in
      const pend = { ...d, live: () => [{ name: 'teams', status: 'pending', errorClass: 'auth' as const }] };
      assert.match((await mcpSignInOp(pend, store, sid, 'teams') as { error: string }).error, /does not need a sign-in/);

      // the session ends while the runtime is working: nothing is held, the runtime is told to stop, the steps show
      const stub = ad as unknown as { startMcpSignIn: (s: string, n: string) => Promise<unknown> };
      const realStart = stub.startMcpSignIn;
      ad.signInCalls.length = 0;
      stub.startMcpSignIn = async (s2: string, n: string) => { await ad.stop(s2); return { kind: 'browser', url: 'https://auth.example.com/late' }; };
      const gone = await mcpSignInOp(d, store, sid, 'teams');
      assert.deepStrictEqual([gone.ok, (gone as { manual?: boolean }).manual], [false, true]);
      assert.match((gone as { error: string }).error, /not running/);
      assert.ok(!store.has(sid, 'teams') && store.reserve(sid, 'teams'), 'a session that ended during the call holds no address');
      store.release(sid, 'teams');
      stub.startMcpSignIn = realStart;
      // the agent removed during the call
      const ad2 = new FakeAdapter({ displayName: 'Copilot', capabilities: { mcpSignIn: true } });
      const sid3 = await ad2.start({ workspace: ws, quiet: true });
      const agents3 = new Map([[sid3, info(sid3)]]);
      const st3 = ad2 as unknown as { startMcpSignIn: (s: string, n: string) => Promise<unknown> };
      st3.startMcpSignIn = async () => { agents3.delete(sid3); return { kind: 'browser', url: 'https://auth.example.com/late' }; };
      const g3 = await mcpSignInOp({ agents: agents3, router: routerOf(ad2), live: () => NEEDS, secrets: () => [] }, store, sid3, 'teams');
      assert.strictEqual(g3.ok, false);
      assert.ok(!store.has(sid3, 'teams'), 'a removed agent holds no address');

      // the store sweeps what expired and is capped
      t = 1_000_000;
      const cap = new McpSignInStore(() => t, async () => undefined);
      for (let i = 0; i < MAX_SIGN_INS; i++) assert.ok(cap.begin('a', `s${i}`, PAGE, 'h'), `entry ${i}`);
      assert.ok(!cap.begin('a', 'one-more', PAGE, 'h') && !cap.reserve('a', 'one-more'), `at most ${MAX_SIGN_INS} are held`);
      t += SIGN_IN_TTL_MS;
      assert.ok(cap.begin('a', 'one-more', PAGE, 'h'), 'expired entries are swept when one is added');
      assert.ok(!cap.has('a', 's0'), 'and they are gone');
    }

    // ---- FR-164 (owner 2026-10-23): Sign in again, through the agent app's own forced sign-in only ----
    {
      const store = new McpSignInStore(() => 0, async () => undefined);
      const mk = (caps: Record<string, unknown>) => { const ad = new FakeAdapter({ displayName: 'Copilot', capabilities: { mcpSignIn: true, ...caps } }); ad.signInResult = { kind: 'browser', url: PAGE }; return ad; };
      const ad = mk({ mcpSignInAgain: true });
      const sid = await ad.start({ workspace: ws, quiet: true });
      const live: McpServerStatus[] = [
        { name: 'teams', status: 'needs-auth', errorClass: 'auth', source: 'user' }, { name: 'web', status: 'connected', transport: 'http', source: 'user' }, { name: 'down', status: 'failed', error: '500', source: 'workspace' },
        { name: 'local', status: 'connected', transport: 'stdio', source: 'user' }, { name: 'slow', status: 'pending', source: 'user' }, { name: 'off', status: 'disabled', source: 'user' }, { name: 'gh', status: 'connected', source: 'builtin' },
        // review on #625, fail closed: a source the runtime did not name, or `unknown`, a built-in name, a `memory` transport, no address
        { name: 'nosrc', status: 'connected' }, { name: 'unk', status: 'connected', source: 'unknown' }, { name: 'github-mcp-server', status: 'connected', source: 'user' },
        { name: 'mem', status: 'connected', source: 'user', transport: 'memory' }, { name: 'noaddr', status: 'connected', source: 'user' }, { name: 'plain', status: 'connected', source: 'user' },
      ];
      const URLS: Record<string, string> = { web: 'https://web.example.test/mcp', down: 'http://down.example.test/mcp', teams: 'https://t.example.test', slow: 'https://s.example.test', off: 'https://o.example.test', gh: 'https://api.githubcopilot.com/mcp/', nosrc: 'https://n.example.test', unk: 'https://u.example.test', 'github-mcp-server': 'https://api.githubcopilot.com/mcp/', mem: 'https://m.example.test', plain: 'ftp://p.example.test' };
      const d = { agents: new Map([[sid, info(sid)]]), router: routerOf(ad), live: () => live, secrets: () => [], serverUrl: (_id: string, n: string) => URLS[n] };
      // a connected and a failed remote server can be signed in again; the runtime gets `again` (Copilot: forceReauth)
      assert.deepStrictEqual(await mcpSignInOp(d, store, sid, 'web', true), { ok: true, kind: 'browser', host: 'auth.example.com', otherSite: 'web.example.test' });
      assert.deepStrictEqual(ad.signInCalls.at(-1), { sessionId: sid, name: 'web', again: true });
      assert.strictEqual((await mcpSignInOp(d, store, sid, 'down', true)).ok, true);
      // not for: a server waiting for its first sign-in (that is Sign in), a local one, pending, disabled; only `true` counts as again
      for (const n of ['teams', 'local', 'slow', 'off', 'gh', 'nosrc', 'unk', 'github-mcp-server', 'mem', 'noaddr', 'plain']) assert.match((await mcpSignInOp(d, store, sid, n, true) as { error: string }).error, /cannot be signed in again now/, n);
      assert.match((await mcpSignInOp(d, store, sid, 'down', 'true') as { error: string }).error, /does not need a sign-in/, 'a string "true" is not again');
      assert.strictEqual(ad.signInCalls.length, 2, 'nothing else reached the runtime');
      // an agent app without the capability: refused before the runtime
      const no = mk({});
      const sid2 = await no.start({ workspace: ws, quiet: true });
      const d2 = { ...d, agents: new Map([[sid2, info(sid2)]]), router: routerOf(no) };
      assert.match((await mcpSignInOp(d2, store, sid2, 'web', true) as { error: string }).error, /cannot sign in again/);
      assert.strictEqual(no.signInCalls.length, 0);
      // the reply: canSignInAgain only with the capability, a running session, the server on, and a connected or failed remote server
      const rep = (x: AgentAdapter, id: string, off = new Set<string>()) => agentMcpReply({ a: info(id), ad: x, live, off, secrets: [], cli: live.map((l) => ({ name: l.name, enabled: true })), extras: [], ambientDisabled: new Set(), signIn: () => undefined, serverUrl: (n) => URLS[n] });
      const again = (r: ReturnType<typeof rep>) => r.servers.filter((x) => x.canSignInAgain).map((x) => x.name);
      assert.deepStrictEqual(again(rep(ad, sid)), ['web', 'down']);
      assert.deepStrictEqual(again(rep(ad, sid, new Set(['web']))), ['down'], 'a server switched off here: no');
      assert.deepStrictEqual(again(rep(no, sid2)), [], 'no capability: no');
      assert.deepStrictEqual(again(agentMcpReply({ a: info(sid), ad, live, off: new Set(), secrets: [], cli: live.map((l) => ({ name: l.name, enabled: true })), extras: [], ambientDisabled: new Set(), signIn: () => undefined })), [], 'no known address at all: nothing offered');
      // an open sign-in stays visible while the row reads Starting (a server signed in again passes through it)
      const held = agentMcpReply({ a: info(sid), ad, live, off: new Set(), secrets: [], cli: live.map((l) => ({ name: l.name, enabled: true })), extras: [], ambientDisabled: new Set(), signIn: (n) => (n === 'slow' ? { host: 'auth.example.com', opened: true, expiresInMs: 1000 } : undefined), serverUrl: (n) => URLS[n] });
      assert.deepStrictEqual(held.servers.find((x) => x.name === 'slow')!.signIn, { host: 'auth.example.com', opened: true, expiresInMs: 1000 }, 'pending row keeps its open sign-in');
      await ad.stop(sid);
      assert.deepStrictEqual(again(rep(ad, sid)), [], 'no running session: no');

      // review on #625: a Sign in again entry is not finished by the OLD "connected" (a re-read, the 5 s poll, another server's event)
      const st2 = new McpSignInStore(() => 0, async () => undefined);
      assert.ok(st2.begin('A', 'web', PAGE, 'auth.example.com', undefined, { again: true }));
      assert.ok(st2.begin('A', 'first', PAGE, 'auth.example.com'));
      for (let i = 0; i < 3; i++) st2.onServers('A', [{ name: 'web', status: 'connected' }, { name: 'other', status: 'failed' }]);
      assert.ok(st2.has('A', 'web'), 'still held: connected before any other state is the old sign-in');
      st2.onServers('A', [{ name: 'first', status: 'connected' }]);
      assert.ok(!st2.has('A', 'first'), 'a first sign-in still finishes on connected');
      st2.onServers('A', [{ name: 'web', status: 'pending' }]);
      assert.ok(st2.has('A', 'web'), 'another state: still waiting');
      st2.onServers('A', [{ name: 'web', status: 'connected' }]);
      assert.ok(!st2.has('A', 'web'), 'connected after another state: finished');
      // the op marks the entry: through mcpSignInOp, the next connected event does not drop it
      const ad3 = mk({ mcpSignInAgain: true });
      const sid3 = await ad3.start({ workspace: ws, quiet: true });
      const st3 = new McpSignInStore(() => 0, async () => undefined);
      assert.strictEqual((await mcpSignInOp({ ...d, agents: new Map([[sid3, info(sid3)]]), router: routerOf(ad3) }, st3, sid3, 'web', true)).ok, true);
      st3.onServers(sid3, [{ name: 'web', status: 'connected' }]);
      assert.ok(st3.has(sid3, 'web'), 'Sign in again from the op is held past the old connected');
    }

    // ---- the reply (FR-020, FR-068) ----
    {
      const ad = new FakeAdapter({ displayName: 'Copilot', capabilities: { mcpSignIn: true, mcpSignInSteps: STEPS } });
      const sid = await ad.start({ workspace: ws, quiet: true });
      const live: McpServerStatus[] = [
        { name: 'teams', status: 'needs-auth', errorClass: 'auth' },
        { name: 'failed-auth', status: 'failed', errorClass: 'auth', error: '401' },
        { name: 'web', status: 'connected' },
        { name: 'muted', status: 'needs-auth' },
        { name: 'bad name; rm -rf ~\nx', status: 'needs-auth' },
        { name: 'ext', status: 'needs-auth' },
      ];
      const base: McpReplyInput = {
        a: info(sid), ad, live, off: new Set(['muted']), secrets: [],
        cli: [{ name: 'teams', enabled: true }, { name: 'failed-auth', enabled: true }, { name: 'web', enabled: true }, { name: 'muted', enabled: true }, { name: 'bad name; rm -rf ~\nx', enabled: true }],
        extras: [{ name: 'ext', enabled: true, trusted: true }],
        ambientDisabled: new Set(),
        signIn: (n) => (n === 'teams' ? { host: 'auth.example.com', opened: true, expiresInMs: 5000 } : undefined),
      };
      const by = (r: ReturnType<typeof agentMcpReply>, n: string) => r.servers.find((x) => x.name === n)!;
      const r = agentMcpReply(base);
      assert.deepStrictEqual([by(r, 'teams').canSignIn, by(r, 'teams').signIn, by(r, 'teams').signInSteps], [true, { host: 'auth.example.com', opened: true, expiresInMs: 5000 }, 'In a terminal, run `copilot`, type `/mcp auth teams` and finish in your browser.']);
      assert.strictEqual(by(r, 'failed-auth').canSignIn, true, 'a failed server with errorClass auth reads Needs sign-in too');
      assert.deepStrictEqual([by(r, 'web').canSignIn, by(r, 'web').signIn, by(r, 'web').signInSteps], [undefined, undefined, undefined], 'a running server has no sign-in');
      assert.deepStrictEqual([by(r, 'muted').canSignIn, by(r, 'muted').signInSteps], [undefined, undefined], 'a server switched off for this session has none');
      const odd = by(r, 'bad name; rm -rf ~\nx');
      assert.strictEqual(odd.signInSteps, 'In a terminal, run `copilot`, type `/mcp auth <server name>` and finish in your browser.', 'an odd name is never put in a command');
      assert.strictEqual(by(r, 'ext').signInSteps, 'This server is only known to Agent Durbar; use Sign in here.', 'a folder extra is not in the CLI list');
      assert.ok(!JSON.stringify(r).includes('SECRET'), 'no address anywhere in the reply');
      // not live: no Sign in
      const off = agentMcpReply({ ...base, ad: new FakeAdapter({ capabilities: { mcpSignIn: true, mcpSignInSteps: STEPS } }) });
      assert.ok(off.servers.every((x) => !x.canSignIn), 'a session that is not running offers no Sign in');
      // an agent app without the capability (Claude, Codex today): no new field at all
      const claude = new FakeAdapter({ displayName: 'Claude Code' });
      const sidc = await claude.start({ workspace: ws, quiet: true });
      const rc = agentMcpReply({ ...base, a: info(sidc), ad: claude });
      assert.ok(rc.servers.every((x) => x.canSignIn === undefined && x.signIn === undefined && x.signInSteps === undefined), 'rows of an agent app without mcpSignIn keep today\'s behaviour');
      assert.strictEqual(signInStepsFor(undefined, 'a', 'cli'), undefined);
      assert.strictEqual(signInStepsFor('x {name} y {name}', 'a.b-1', 'runtime'), 'x a.b-1 y a.b-1');
    }

    // ---- the registered channels (window only; events drop the entry; nothing is logged) ----
    {
      const electronPath = require.resolve('electron');
      const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
      const fake = { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined }, safeStorage: { isEncryptionAvailable: () => false } };
      const saved = require.cache[electronPath];
      require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
      const consoleSeen: string[] = [];
      const realLog = { log: console.log, warn: console.warn, error: console.error };
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { registerMcpIpc } = require('../src/main/mcpipc') as typeof import('../src/main/mcpipc');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
        const store = new McpStore(path.join(ws, 'm.json'));
        store.load();
        const ad = new FakeAdapter({ displayName: 'Copilot', capabilities: { mcpSignIn: true, mcpSignInSteps: STEPS } });
        ad.signInResult = { kind: 'browser', url: PAGE };
        const sid = await ad.start({ workspace: ws, quiet: true });
        const agents = new Map([[sid, info(sid)]]);
        let listener: (e: AgentEvent) => void = () => undefined;
        const logs: string[] = [];
        const opened: string[] = [];
        let t = 50_000;
        const running = new Set<{ fn: () => unknown }>(); // the poller's timers: one per opened sign-in
        const tick = async (): Promise<void> => { for (const h of [...running]) await h.fn(); };
        registerMcpIpc({
          store: () => store, agents,
          router: { onEvent: (cb: (e: AgentEvent) => void) => { listener = cb; return () => undefined; }, forAgent: () => ad } as never,
          dev: { DURBAR_COPILOT_DIR: path.join(ws, 'copilot') } as never,
          appOf: () => 'copilot',
          log: (_a, action) => logs.push(action),
          openUrl: async (u) => { opened.push(u); },
          now: () => t,
          timers: { set: (fn: () => unknown) => { const h = { fn }; running.add(h); return h; }, clear: (h: unknown) => { running.delete(h as { fn: () => unknown }); } },
        });
        ad.onEvent((e) => listener(e));
        const logFile = path.join(ws, 'events.jsonl');
        const sink = createDebugSink(logFile, process.env, fs.appendFileSync);
        const emit = (e: AgentEvent): void => { sink({ event: e }); listener(e); };
        console.log = (...a: unknown[]) => { consoleSeen.push(a.join(' ')); };
        console.warn = console.log;
        console.error = console.log;
        const indexUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href;
        const frame = { url: indexUrl };
        const win = { senderFrame: frame, sender: { mainFrame: frame } };
        const other = { senderFrame: { url: 'https://example.com/' }, sender: { mainFrame: {} } };
        for (const ch of ['agents:mcpSignIn', 'agents:mcpOpenSignIn', 'agents:mcpCancelSignIn']) {
          assert.ok(handlers.has(ch), `${ch} is registered`);
          assert.throws(() => handlers.get(ch)!(other, sid, 'teams'), /did not come from its own window/, `${ch}: a foreign page is refused`);
        }
        const call = (ch: string, ...a: unknown[]) => handlers.get(ch)!(win, ...a) as Promise<Record<string, unknown>>;
        const mcpEvent = (servers: McpServerStatus[]): AgentEvent => ({ type: 'mcp', sessionId: sid, timestamp: 1, servers }) as AgentEvent;
        emit(mcpEvent(NEEDS));
        let entries = (await call('agents:mcp', sid) as unknown as { servers: Array<Record<string, unknown>> }).servers;
        assert.strictEqual(entries.find((x) => x.name === 'teams')!.canSignIn, true, 'agents:mcp offers Sign in');
        assert.match(String(entries.find((x) => x.name === 'teams')!.signInSteps), /\/mcp auth teams/);
        assert.deepStrictEqual(await call('agents:mcpSignIn', sid, 'teams'), { ok: true, kind: 'browser', host: 'auth.example.com' });
        entries = (await call('agents:mcp', sid) as unknown as { servers: Array<Record<string, unknown>> }).servers;
        assert.deepStrictEqual(entries.find((x) => x.name === 'teams')!.signIn, { host: 'auth.example.com', opened: false, expiresInMs: 600_000 });
        assert.deepStrictEqual(opened, [], 'nothing opened yet');
        assert.deepStrictEqual(await call('agents:mcpOpenSignIn', sid, 'teams', 'auth.example.com'), { ok: true });
        assert.deepStrictEqual(opened, [PAGE]);
        assert.strictEqual(((await call('agents:mcp', sid) as unknown as { servers: Array<{ name: string; signIn?: { opened: boolean } }> }).servers.find((x) => x.name === 'teams')!.signIn!.opened), true);
        // the window cannot supply an address: extra arguments (a URL, an object with a url) change nothing, only the held address opens
        opened.length = 0;
        for (const extra of ['https://evil.example/', { url: 'https://evil.example/' }, ['https://evil.example/']]) {
          assert.deepStrictEqual(await (handlers.get('agents:mcpOpenSignIn')!(win, sid, 'teams', 'auth.example.com', extra) as Promise<unknown>), { ok: true });
        }
        assert.deepStrictEqual(opened, [PAGE, PAGE, PAGE], 'the opener only ever got the held address');
        for (const wrong of ['https://evil.example/', { url: 'https://evil.example/' }]) assert.strictEqual((await call('agents:mcpOpenSignIn', sid, 'teams', wrong)).gone, true, 'a URL in the host slot opens nothing');
        assert.deepStrictEqual(opened, [PAGE, PAGE, PAGE]);
        // the runtime reports the server connected: the entry is dropped and the row stops offering Sign in
        emit(mcpEvent([{ name: 'teams', status: 'connected' }, { name: 'web', status: 'connected' }]));
        assert.strictEqual((await call('agents:mcpOpenSignIn', sid, 'teams', 'auth.example.com')).gone, true, 'connected drops the held address');
        entries = (await call('agents:mcp', sid) as unknown as { servers: Array<Record<string, unknown>> }).servers;
        assert.strictEqual(entries.find((x) => x.name === 'teams')!.signIn, undefined);
        // End session / Restart session: the stopped event drops it
        emit(mcpEvent(NEEDS));
        assert.strictEqual((await call('agents:mcpSignIn', sid, 'teams')).ok, true);
        emit({ type: 'status', sessionId: sid, timestamp: 2, status: 'stopped' } as AgentEvent);
        assert.strictEqual((await call('agents:mcpOpenSignIn', sid, 'teams', 'auth.example.com')).gone, true, 'End session drops the held address');
        // the time limit, through the channel
        emit(mcpEvent(NEEDS));
        assert.strictEqual((await call('agents:mcpSignIn', sid, 'teams')).ok, true);
        t += SIGN_IN_TTL_MS;
        assert.strictEqual((await call('agents:mcpOpenSignIn', sid, 'teams', 'auth.example.com')).gone, true, '10 minutes: gone');
        assert.deepStrictEqual(opened, [PAGE, PAGE, PAGE], 'nothing more was opened after the limit');
        // Cancel through the channel
        assert.strictEqual((await call('agents:mcpSignIn', sid, 'teams')).ok, true);
        assert.deepStrictEqual(await call('agents:mcpCancelSignIn', sid, 'teams'), { ok: true });
        assert.strictEqual((await call('agents:mcpOpenSignIn', sid, 'teams', 'auth.example.com')).gone, true);
        // ---- real 2026-10-23: the runtime sent no status after the browser sign-in; the page's server list is read again while a page is open ----
        {
          assert.strictEqual(POLL_MS, 5000, 'every 5 seconds');
          emit(mcpEvent(NEEDS));
          assert.strictEqual((await call('agents:mcpSignIn', sid, 'teams')).ok, true);
          assert.strictEqual(running.size, 0, 'no timer before the page is opened');
          ad.refreshCalls = 0;
          ad.connectOnRefresh = { name: 'teams', at: 3 };
          assert.deepStrictEqual(await call('agents:mcpOpenSignIn', sid, 'teams', 'auth.example.com'), { ok: true });
          assert.strictEqual(running.size, 1, 'one timer for the opened entry');
          assert.deepStrictEqual(await call('agents:mcpOpenSignIn', sid, 'teams', 'auth.example.com'), { ok: true });
          assert.strictEqual(running.size, 1, 'opening again does not add a second timer');
          const row = async () => ((await call('agents:mcp', sid)) as unknown as { servers: Array<{ name: string; status?: string; signIn?: unknown }> }).servers.find((x) => x.name === 'teams')!;
          await tick();
          await tick();
          assert.deepStrictEqual([ad.refreshCalls, (await row()).status], [2, 'needs-auth'], 'two reads: still waiting');
          assert.ok((await row()).signIn, 'the row still shows the waiting sign-in');
          await tick();
          assert.strictEqual(ad.refreshCalls, 3);
          const flipped = await row();
          assert.deepStrictEqual([flipped.status, flipped.signIn], ['connected', undefined], 'the third read reports connected: the row flips and the entry is gone');
          assert.strictEqual(running.size, 0, 'the timer is cleared on connected');
          const before = ad.refreshCalls;
          await tick();
          assert.strictEqual(ad.refreshCalls, before, 'no read after it is cleared');
          // Cancel clears the timer
          ad.connectOnRefresh = undefined;
          emit(mcpEvent(NEEDS));
          await call('agents:mcpSignIn', sid, 'teams');
          await call('agents:mcpOpenSignIn', sid, 'teams', 'auth.example.com');
          assert.strictEqual(running.size, 1);
          await call('agents:mcpCancelSignIn', sid, 'teams');
          assert.strictEqual(running.size, 0, 'the timer is cleared on Cancel');
          // the 10-minute limit clears it (the next tick finds the entry expired)
          await call('agents:mcpSignIn', sid, 'teams');
          await call('agents:mcpOpenSignIn', sid, 'teams', 'auth.example.com');
          assert.strictEqual(running.size, 1);
          t += SIGN_IN_TTL_MS;
          const calls0 = ad.refreshCalls;
          await tick();
          assert.strictEqual(running.size, 0, 'the timer is cleared at the time limit');
          assert.strictEqual(ad.refreshCalls, calls0, 'and the expired tick reads nothing');
          // End session clears it
          t += 1;
          await call('agents:mcpSignIn', sid, 'teams');
          await call('agents:mcpOpenSignIn', sid, 'teams', 'auth.example.com');
          assert.strictEqual(running.size, 1);
          emit({ type: 'status', sessionId: sid, timestamp: 3, status: 'stopped' } as AgentEvent);
          assert.strictEqual(running.size, 0, 'the timer is cleared when the session ends');
          // no overlapping reads: a read that never settles is not stacked on; the window regaining focus reads at once when none runs
          ad.refreshDelay = Infinity;
          emit(mcpEvent(NEEDS));
          await call('agents:mcpSignIn', sid, 'teams');
          await call('agents:mcpOpenSignIn', sid, 'teams', 'auth.example.com');
          const c1 = ad.refreshCalls;
          void tick();
          void tick();
          void tick();
          await new Promise((r) => setImmediate(r));
          assert.strictEqual(ad.refreshCalls, c1 + 1, 'three ticks while one read is running make one read');
          await call('agents:mcp', sid, true);
          assert.strictEqual(ad.refreshCalls, c1 + 1, 'focus while a read is running does not stack either');
          await call('agents:mcpCancelSignIn', sid, 'teams');
          ad.refreshDelay = undefined;
          // focus: only `focus === true` reads (a repaint after an event must not, or each read would trigger the next)
          await call('agents:mcpSignIn', sid, 'teams');
          await call('agents:mcpOpenSignIn', sid, 'teams', 'auth.example.com');
          const c2 = ad.refreshCalls;
          await call('agents:mcp', sid);
          await new Promise((r) => setImmediate(r));
          assert.strictEqual(ad.refreshCalls, c2, 'a plain agents:mcp call reads nothing');
          await call('agents:mcp', sid, true);
          await new Promise((r) => setImmediate(r));
          assert.strictEqual(ad.refreshCalls, c2 + 1, 'the window regaining focus reads at once');
          // a failing read is swallowed and the timer stays
          ad.refreshFail = 'runtime busy';
          await tick();
          assert.strictEqual(running.size, 1);
          ad.refreshFail = undefined;
          await call('agents:mcpCancelSignIn', sid, 'teams');
          assert.strictEqual(running.size, 0);
          // spec 058 FR-180 (T152): a signInEnd from the adapter ends the entry and stops the poll, as connected does
          for (const end of ['next-message', 'failed'] as const) {
            emit(mcpEvent(NEEDS));
            await call('agents:mcpSignIn', sid, 'teams');
            await call('agents:mcpOpenSignIn', sid, 'teams', 'auth.example.com');
            assert.strictEqual(running.size, 1);
            ad.endOnRefresh = { name: 'teams', at: ad.refreshCalls + 1, end, error: 'denied' };
            await tick();
            assert.strictEqual(running.size, 0, `${end}: the timer is cleared`);
            const row = ((await call('agents:mcp', sid)) as unknown as { servers: Array<{ name: string; signIn?: unknown; signInEnd?: string; status?: string }> }).servers.find((x) => x.name === 'teams')!;
            assert.deepStrictEqual([row.signIn, row.signInEnd, row.status], [undefined, end, 'needs-auth'], `${end}: the entry is gone and the row carries the end`);
            ad.endOnRefresh = undefined;
          }
          // the stub for the rest of this block: nothing is left open
          emit(mcpEvent([{ name: 'teams', status: 'connected' }]));
        }
        // the address is nowhere: not the DURBAR_LOG sink, the activity-log hook, the console, nor any reply above
        emit(mcpEvent([{ name: 'teams', status: 'connected' }]));
        const sinkText = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
        assert.ok(sinkText.length > 0, 'the sink recorded the events');
        for (const [where, text] of [['DURBAR_LOG sink', sinkText], ['activity log hook', logs.join('\n')], ['console', consoleSeen.join('\n')]] as const) {
          assert.ok(!/SECRETSTATE|PKCEPKCE|auth\.example\.com|authorize/.test(text), `no sign-in address in the ${where}`);
        }
        assert.deepStrictEqual(logs, [], 'sign-in writes no activity row');
      } finally {
        Object.assign(console, realLog);
        if (saved) require.cache[electronPath] = saved;
        else delete require.cache[electronPath];
      }
    }
    // ---- spec 058 FR-180 (T152): a time limit per entry, the two sign-in ends, steps without the in-app call ----
    {
      let t = 0;
      const st = new McpSignInStore(() => t, async () => undefined);
      // the agent app's listener time: 5 minutes minus the time to the answer minus 10 s, at least 30 s
      assert.deepStrictEqual([signInTtlMs(0), signInTtlMs(1_500), signInTtlMs(200_000), signInTtlMs(259_999), signInTtlMs(400_000)], [290_000, 288_500, 90_000, 30_001, 30_000]);
      // review on #635: a broken wait (negative, NaN, Infinity) counts as the full 30 s request timeout, never as no wait
      assert.deepStrictEqual([signInTtlMs(NaN), signInTtlMs(-5), signInTtlMs(-Infinity), signInTtlMs(Infinity)], [260_000, 260_000, 260_000, 260_000]);
      assert.ok(st.begin('a', 'claude-srv', PAGE, 'auth.example.com', undefined, { ttlMs: signInTtlMs(25_000) }) && st.begin('a', 'copilot-srv', PAGE, 'auth.example.com'));
      assert.deepStrictEqual([st.view('a', 'claude-srv')!.expiresInMs, st.view('a', 'copilot-srv')!.expiresInMs], [265_000, 600_000], 'each entry shows its own limit');
      t = 264_999;
      assert.ok(st.has('a', 'claude-srv'), 'one millisecond before its own limit it is open');
      t = 265_000;
      assert.ok(!st.has('a', 'claude-srv') && st.has('a', 'copilot-srv'), 'the entry with ttlMs ends at its own limit; Copilot\'s keeps its 10 minutes');
      assert.strictEqual(st.view('a', 'copilot-srv')!.expiresInMs, 335_000);
      t = 600_000;
      assert.ok(!st.has('a', 'copilot-srv'), 'and Copilot\'s at 10 minutes');
      // a ttlMs over 10 minutes is capped; missing = 10 minutes; present but not a positive finite number = the 30 s minimum (review on #635)
      for (const [bad, want] of [[3_600_000, 600_000], [undefined, 600_000], [NaN, 30_000], [0, 30_000], [-1, 30_000], [Infinity, 30_000], ['5000' as unknown as number, 30_000], [null as unknown as number, 30_000], [45_000, 45_000]] as const) {
        assert.ok(st.begin('b', 'x', PAGE, 'h', undefined, { ttlMs: bad }));
        assert.strictEqual(st.view('b', 'x')!.expiresInMs, want, `ttlMs ${String(bad)}`);
        st.drop('b', 'x');
      }
      // signInEnd drops the entry as connected does; only the two values count
      st.begin('a', 'n1', PAGE, 'h');
      st.begin('a', 'n2', PAGE, 'h');
      st.begin('a', 'n3', PAGE, 'h');
      st.onServers('a', [{ name: 'n1', status: 'needs-auth', signInEnd: 'next-message' }, { name: 'n2', status: 'needs-auth', signInEnd: 'failed' }, { name: 'n3', status: 'needs-auth', signInEnd: 'bogus' as never }]);
      assert.deepStrictEqual(['n1', 'n2', 'n3'].map((n) => st.has('a', n)), [false, false, true], 'next-message and failed end it; another value does not');
      // FR-176: the attempts of the last 5 minutes that are no longer held
      t = 1_000_000;
      const r = new McpSignInStore(() => t, async () => undefined);
      r.begin('a', 'x', PAGE, 'h');
      r.begin('a', 'y', PAGE, 'h');
      r.begin('b', 'x', PAGE, 'h');
      assert.deepStrictEqual(r.recent('a'), [], 'a held sign-in is polled, not re-read');
      r.drop('a', 'x');
      assert.deepStrictEqual(r.recent('a'), ['x'], 'after Cancel it is recent');
      r.onServers('a', [{ name: 'y', status: 'connected' }]);
      assert.deepStrictEqual(r.recent('a'), ['x'], 'a connected server is no longer an attempt');
      t += RECENT_SIGN_IN_MS - 1;
      assert.deepStrictEqual(r.recent('a'), ['x']);
      t += 1;
      assert.deepStrictEqual(r.recent('a'), [], 'after 5 minutes it is forgotten');
      r.drop('b', 'x');
      r.begin('b', 'z', PAGE, 'h');
      r.drop('b', 'z');
      r.dropAgent('b');
      assert.deepStrictEqual(r.recent('b'), [], 'End session forgets the attempts too');
      for (let i = 0; i < MAX_SIGN_INS + 10; i++) { r.begin('c', `s${i}`, PAGE, 'h'); r.drop('c', `s${i}`); }
      assert.strictEqual(r.recent('c').length, MAX_SIGN_INS, 'at most 64 attempts are remembered');
      // mcpSignInOp passes the adapter's ttlMs
      t = 0;
      const store = new McpSignInStore(() => t, async () => undefined);
      const ad = new FakeAdapter({ displayName: 'Claude Code', capabilities: { mcpSignIn: true } });
      ad.signInResult = { kind: 'browser', url: PAGE, ttlMs: 120_000 };
      const sid = await ad.start({ workspace: ws, quiet: true });
      const d = { agents: new Map([[sid, info(sid)]]), router: routerOf(ad), live: () => NEEDS, secrets: () => [] };
      assert.deepStrictEqual(await mcpSignInOp(d, store, sid, 'teams'), { ok: true, kind: 'browser', host: 'auth.example.com' });
      assert.strictEqual(store.view(sid, 'teams')!.expiresInMs, 120_000, 'the entry keeps the adapter\'s limit');
      t = 120_000;
      assert.strictEqual((await mcpOpenSignInOp(store, d.agents, sid, 'teams', 'auth.example.com')).gone, true, 'Open sign-in page never points at a closed listener');
    }

    // ---- FR-180 in the reply: steps on mcpSignInSteps alone, signInEnd, the note, Restart kept ----
    {
      const CL = "If Sign in is not available, run `claude mcp login {name}` in a terminal and finish in your browser. This works only for a server in Claude Code's own settings. Then press Restart on this row.";
      const live: McpServerStatus[] = [{ name: 'notes', status: 'needs-auth', errorClass: 'auth', signInEnd: 'failed' }, { name: 'web', status: 'connected', signInEnd: 'weird' as never }, { name: 'ext', status: 'needs-auth' }];
      const base = (ad: FakeAdapter, sid: string): McpReplyInput => ({ a: info(sid), ad, live, off: new Set(), secrets: [], cli: [], extras: [{ name: 'ext', enabled: true, trusted: true }], ambientDisabled: new Set(), app: 'claude', claudeList: [{ name: 'notes', enabled: true }, { name: 'web', enabled: true }] });
      const by = (r: ReturnType<typeof agentMcpReply>, n: string) => r.servers.find((x) => x.name === n)!;
      // the SDK transport's shape: steps, no in-app call
      const stepsOnly = new FakeAdapter({ displayName: 'Claude Code', capabilities: { mcpSignInSteps: CL, mcpSignInNote: 'Not checked on a real account yet.', mcpRestart: false } });
      const s1 = await stepsOnly.start({ workspace: ws, quiet: true });
      const r1 = agentMcpReply(base(stepsOnly, s1));
      assert.deepStrictEqual([by(r1, 'notes').canSignIn, by(r1, 'notes').signInSteps], [undefined, CL.replace('{name}', 'notes')], 'the steps show without mcpSignIn');
      assert.strictEqual(by(r1, 'notes').signInNote, undefined, 'no note where no Sign in is offered');
      assert.strictEqual(by(r1, 'ext').signInSteps, undefined, 'a folder extra without Sign in gets no "use Sign in here" line');
      // the CLI transport's shape
      const full = new FakeAdapter({ displayName: 'Claude Code', capabilities: { mcpSignIn: true, mcpRestart: true, mcpSignInRestart: true, mcpSignInSteps: CL, mcpSignInNote: 'Not checked on a real account yet.' } });
      const s2 = await full.start({ workspace: ws, quiet: true });
      const r2 = agentMcpReply(base(full, s2));
      const n2 = by(r2, 'notes');
      assert.deepStrictEqual([n2.canSignIn, n2.signInEnd, n2.signInNote, n2.signInRestart, n2.canRestart], [true, 'failed', 'Not checked on a real account yet.', true, true]);
      assert.deepStrictEqual([by(r2, 'web').signInEnd, by(r2, 'web').signInNote, by(r2, 'web').signInRestart], [undefined, undefined, undefined], 'an unknown signInEnd is not passed on; a running row has no note');
      assert.strictEqual(by(r2, 'ext').signInSteps, 'This server is only known to Agent Durbar; use Sign in here.');
      // an app without the Restart end (Copilot) keeps Restart hidden on a needs-sign-in row
      const cop = new FakeAdapter({ displayName: 'Copilot', capabilities: { mcpSignIn: true, mcpRestart: true, mcpSignInSteps: STEPS } });
      const s3 = await cop.start({ workspace: ws, quiet: true });
      assert.strictEqual(by(agentMcpReply(base(cop, s3)), 'notes').signInRestart, undefined);
    }

    // ---- review on #635: a real ClaudeAdapter on the fake CLI transport, through mcpSignInOp: main's address rule applies to Claude's answer ----
    {
      let authUrl = '';
      const sp = fakeSpawn();
      sp.next = (c) => {
        c.onWrite = (o) => {
          if (o.type === 'control_request') {
            const r = o.request as { subtype: string };
            const response = r.subtype === 'mcp_authenticate' ? { authUrl, requiresUserAction: true, callbackExpected: true, state: 'SECRETSTATE123', callbackPort: 41234 } : r.subtype === 'mcp_status' ? { mcpServers: [{ name: 'notes', status: 'needs-auth' }] } : {};
            setTimeout(() => c.send({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response } }), 0);
          } else if (o.type === 'user') {
            setTimeout(() => { c.send({ type: 'system', subtype: 'init', session_id: 'x', cwd: ws, tools: [], mcp_servers: [{ name: 'notes', status: 'needs-auth' }] }); c.send({ type: 'result', subtype: 'success', is_error: false }); }, 0);
          }
        };
      };
      const ad = new ClaudeAdapter({ sandboxFacts: SANDBOX_HOST_OK, claudePath: async () => '/usr/bin/claude', makeTransport: (x) => createCliTransport({ file: x.file, args: claudeArgs(x.launch), cwd: x.cwd, env: x.env, handlers: x.handlers, spawn: sp.spawn, closeGraceMs: 10, killGraceMs: 10 }), sessionExists: () => false, claudeMd: () => undefined, env: () => ({}) });
      let idle = false;
      ad.onEvent((e) => { if (e.type === 'status' && (e as { status: string }).status === 'idle') idle = true; });
      const sid = await ad.start({ workspace: ws, quiet: true, mcpServers: { notes: { type: 'http', url: 'https://mcp.example.com/mcp' } } });
      await ad.send(sid, { text: 'hi' });
      for (let i = 0; i < 500 && !idle; i++) await new Promise((r) => setTimeout(r, 2));
      assert.ok(idle, 'the CLI ran one turn');
      const store = new McpSignInStore(() => 0, async () => undefined);
      const d = { agents: new Map([[sid, info(sid)]]), router: routerOf(ad), live: () => [{ name: 'notes', status: 'needs-auth', errorClass: 'auth' as const }], secrets: () => [] };
      for (const bad of ['http://auth.example.com/authorize?state=SECRETSTATE123', 'https://127.0.0.1:41234/authorize', 'https://intranet/authorize', 'https://localhost/authorize', 'https://[::1]/authorize', 'https://user:pw@auth.example.com/a', 'https://auth.example.com/a b']) {
        authUrl = bad;
        const r = await mcpSignInOp(d, store, sid, 'notes');
        assert.deepStrictEqual([r.ok, (r as { manual?: boolean }).manual], [false, true], `Claude answered ${bad}: the terminal steps show`);
        assert.ok(!store.has(sid, 'notes'), `nothing held for ${bad}`);
        assert.ok(!JSON.stringify(r).includes('SECRETSTATE') && !JSON.stringify(r).includes('127.0.0.1') && !JSON.stringify(r).includes('intranet'), 'the refusal repeats no address');
      }
      authUrl = 'https://auth.example.com/authorize?state=SECRETSTATE123';
      assert.deepStrictEqual(await mcpSignInOp(d, store, sid, 'notes'), { ok: true, kind: 'browser', host: 'auth.example.com' }, 'and a good https page is held');
      assert.ok(store.view(sid, 'notes')!.expiresInMs <= 290_000 && store.view(sid, 'notes')!.expiresInMs >= 30_000, 'with Claude\'s listener time');
      await ad.stop(sid);
    }

    // ---- FR-185 (T157): the "different site" line compares with this app's own server, never another app's list ----
    {
      const src = (o: Partial<{ extras: Array<{ name: string; url?: string }>; copilot: Array<{ name: string; url?: string }>; claude: Record<string, { url?: string }>; codex: Record<string, { url?: string }> }>): ServerUrlSources => ({ extras: () => o.extras ?? [], copilot: () => o.copilot ?? [], claude: () => o.claude ?? {}, codex: () => o.codex ?? {} });
      const copilotNotes = [{ name: 'notes', url: 'https://tools.other.example/mcp' }];
      // the false warning: Codex's notes is on notes.example, its page on login.notes.example; the Copilot CLI list has another notes
      const falseWarn = src({ copilot: copilotNotes, codex: { notes: { url: 'https://mcp.notes.example/mcp' } } });
      assert.strictEqual(serverUrlFor('codex', 'notes', falseWarn), 'https://mcp.notes.example/mcp', 'Codex: its own config.toml');
      assert.strictEqual(signInSiteNote(serverUrlFor('codex', 'notes', falseWarn), 'login.notes.example'), undefined, 'no false "different site" line');
      // the hidden warning: Codex's notes is on notes.example, the page on evil.example, and the Copilot notes happens to be on evil.example
      const hidden = src({ copilot: [{ name: 'notes', url: 'https://mcp.evil.example/mcp' }], codex: { notes: { url: 'https://mcp.notes.example/mcp' } } });
      assert.strictEqual(signInSiteNote(serverUrlFor('codex', 'notes', hidden), 'login.evil.example'), 'mcp.notes.example', 'the real warning shows');
      // Claude Code: extras, then the user list Durbar passes
      const cl = src({ copilot: copilotNotes, claude: { notes: { url: 'https://mcp.notes.example/mcp' } } });
      assert.strictEqual(signInSiteNote(serverUrlFor('claude', 'notes', cl), 'login.notes.example'), undefined, 'Claude: no false line');
      assert.strictEqual(signInSiteNote(serverUrlFor('claude', 'notes', src({ copilot: [{ name: 'notes', url: 'https://mcp.evil.example/mcp' }], claude: { notes: { url: 'https://mcp.notes.example/mcp' } } })), 'login.evil.example'), 'mcp.notes.example', 'Claude: the real warning shows');
      // no match in the app's own lists: no line (never a line against another app's server)
      assert.strictEqual(serverUrlFor('claude', 'notes', src({ copilot: copilotNotes })), undefined, 'Claude: a Copilot-only name has no address');
      assert.strictEqual(serverUrlFor('codex', 'notes', src({ copilot: copilotNotes, claude: { notes: { url: 'https://x.example/' } } })), undefined, 'Codex: neither Copilot\'s nor Claude\'s list');
      assert.strictEqual(serverUrlFor(undefined, 'notes', src({ copilot: copilotNotes })), undefined, 'an unknown app: extras only');
      assert.strictEqual(serverUrlFor('claude', '__proto__', src({})), undefined, 'own names only');
      // the folder's extra comes first for every app; Copilot is unchanged (extras, then its CLI list)
      const ex = src({ extras: [{ name: 'notes', url: 'https://extra.example/mcp' }], copilot: copilotNotes, claude: { notes: { url: 'https://c.example/' } }, codex: { notes: { url: 'https://d.example/' } } });
      assert.deepStrictEqual(['copilot', 'claude', 'codex'].map((a) => serverUrlFor(a, 'notes', ex)), ['https://extra.example/mcp', 'https://extra.example/mcp', 'https://extra.example/mcp']);
      assert.strictEqual(serverUrlFor('copilot', 'notes', src({ copilot: copilotNotes, claude: { notes: { url: 'https://c.example/' } } })), 'https://tools.other.example/mcp', 'Copilot: its CLI list');
      assert.strictEqual(serverUrlFor('copilot', 'notes', src({ claude: { notes: { url: 'https://c.example/' } }, codex: { notes: { url: 'https://d.example/' } } })), undefined, 'Copilot: never another app\'s list');
      // review on #635: Codex's addresses come from the values-free Settings view, as {name: {url}} only
      const view = [{ app: 'copilot', servers: [{ name: 'notes', url: 'https://tools.other.example/mcp', envKeys: [], headerKeys: [] }] }, { app: 'codex', servers: [{ name: 'notes', url: 'https://mcp.notes.example/mcp', envKeys: ['TOKEN'], headerKeys: ['Authorization'] }, { name: 'local', envKeys: [], headerKeys: [] }, { name: 'notes', url: 'https://dup.example/' }] }];
      const cx = appServerUrls(view, 'codex');
      assert.deepStrictEqual({ ...cx }, { notes: { url: 'https://mcp.notes.example/mcp' }, local: {} }, 'addresses only, first entry wins, no keys or values');
      assert.strictEqual(serverUrlFor('codex', 'notes', src({ copilot: copilotNotes, codex: cx })), 'https://mcp.notes.example/mcp');
      assert.strictEqual(appServerUrls(view, 'codex').toString, undefined, 'no prototype: a name like toString is never inherited');
      // one source each (review on #635): the store's minimum is the shared one, and a broken wait uses the adapter's request limit
      assert.strictEqual(SIGN_IN_MIN_TTL_MS, SHARED_MIN_TTL_MS, 'the store\'s minimum is the shared constant');
      assert.strictEqual(SIGN_IN_MIN_TTL_MS, 30_000);
      assert.strictEqual(CLAUDE_SIGN_IN_TIMEOUT_MS, SIGN_IN_REQUEST_TIMEOUT_MS, 'Claude\'s request limit is the shared one');
      assert.strictEqual(signInTtlMs(NaN), signInTtlMs(SIGN_IN_REQUEST_TIMEOUT_MS), 'a broken wait counts as the whole request limit');
      assert.strictEqual(signInTtlMs(1e9), SIGN_IN_MIN_TTL_MS, 'the floor is the shared minimum');
      // the other lists are not even read for an app that does not use them
      let reads = 0;
      const counting: ServerUrlSources = { extras: () => [], copilot: () => { reads++; return copilotNotes; }, claude: () => ({}), codex: () => ({ notes: { url: 'https://mcp.notes.example/' } }) };
      serverUrlFor('codex', 'notes', counting);
      assert.strictEqual(reads, 0, 'Codex does not read the Copilot CLI list');
    }

    // ---- FR-185 and FR-176 through the channels (stand-in electron; Claude and Codex agents) ----
    {
      const electronPath = require.resolve('electron');
      const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
      const fake = { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined }, safeStorage: { isEncryptionAvailable: () => false } };
      const saved = require.cache[electronPath];
      require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
      // the modules that took `ipcMain` from the first stand-in load again with this one
      for (const m of ['../src/main/mcpipc', '../src/main/ipcguard']) delete require.cache[require.resolve(m)];
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { registerMcpIpc } = require('../src/main/mcpipc') as typeof import('../src/main/mcpipc');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
        const cdir = path.join(ws, 'copilot-185');
        fs.mkdirSync(cdir, { recursive: true });
        fs.writeFileSync(path.join(cdir, 'mcp-config.json'), JSON.stringify({ mcpServers: { notes: { type: 'http', url: 'https://tools.other.example/mcp' } } }));
        const store = new McpStore(path.join(ws, 'm185.json'));
        store.load();
        const ad = new FakeAdapter({ displayName: 'Claude Code', capabilities: { mcpSignIn: true } });
        ad.signInResult = { kind: 'browser', url: 'https://login.notes.example/authorize?state=SECRETSTATE123' };
        const sClaude = await ad.start({ workspace: ws, quiet: true });
        const sCodex = await ad.start({ workspace: ws, quiet: true });
        const agents = new Map([[sClaude, info(sClaude)], [sCodex, info(sCodex)]]);
        let listener: (e: AgentEvent) => void = () => undefined;
        let t = 10_000;
        registerMcpIpc({
          store: () => store, agents,
          router: { onEvent: (cb: (e: AgentEvent) => void) => { listener = cb; return () => undefined; }, forAgent: () => ad } as never,
          dev: { DURBAR_COPILOT_DIR: cdir } as never,
          appOf: (id) => (id === sClaude ? 'claude' : 'codex'),
          globalFor: (id): Record<string, McpServerSpec> => (id === sClaude ? { notes: { type: 'http', url: 'https://mcp.notes.example/mcp' } } : {}),
          codexServers: () => ({ notes: { url: 'https://mcp.notes.example/mcp' } }),
          openUrl: async () => undefined,
          now: () => t,
          timers: { set: () => ({}), clear: () => undefined },
        });
        ad.onEvent((e) => listener(e));
        const indexUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href;
        const frame = { url: indexUrl };
        const win = { senderFrame: frame, sender: { mainFrame: frame } };
        const call = (ch: string, ...a: unknown[]) => handlers.get(ch)!(win, ...a) as Promise<Record<string, unknown>>;
        for (const sid of [sClaude, sCodex]) listener({ type: 'mcp', sessionId: sid, timestamp: 1, servers: NEEDS.map((x) => (x.name === 'teams' ? { ...x, name: 'notes' } : x)) } as AgentEvent);
        assert.deepStrictEqual(await call('agents:mcpSignIn', sClaude, 'notes'), { ok: true, kind: 'browser', host: 'login.notes.example' }, 'Claude: no false line from the Copilot CLI list');
        assert.deepStrictEqual(await call('agents:mcpSignIn', sCodex, 'notes'), { ok: true, kind: 'browser', host: 'login.notes.example' }, 'Codex: no false line from the Copilot CLI list');
        // FR-176: after Cancel, the next dialog open or focus reads once (with the server's name); a plain repaint does not; 5 minutes later nothing
        await call('agents:mcpCancelSignIn', sClaude, 'notes');
        ad.refreshCalls = 0;
        ad.refreshNames.length = 0;
        await call('agents:mcp', sClaude);
        await new Promise((r) => setImmediate(r));
        assert.strictEqual(ad.refreshCalls, 0, 'a plain agents:mcp reads nothing');
        await call('agents:mcp', sClaude, true);
        await new Promise((r) => setImmediate(r));
        assert.deepStrictEqual(ad.refreshNames, ['notes'], 'open or focus within 5 minutes of an attempt: one read');
        await call('agents:mcp', sCodex, true);
        await new Promise((r) => setImmediate(r));
        assert.strictEqual(ad.refreshCalls, 1, 'a held, unopened sign-in of another agent is not re-read');
        ad.refreshDelay = Infinity;
        await call('agents:mcp', sClaude, true);
        await call('agents:mcp', sClaude, true);
        await new Promise((r) => setImmediate(r));
        assert.strictEqual(ad.refreshCalls, 2, 'one read in flight per agent');
        ad.refreshDelay = undefined;
        t += RECENT_SIGN_IN_MS;
        const c0 = ad.refreshCalls;
        listener({ type: 'status', sessionId: sCodex, timestamp: 2, status: 'stopped' } as AgentEvent);
        await call('agents:mcp', sCodex, true);
        await new Promise((r) => setImmediate(r));
        assert.strictEqual(ad.refreshCalls, c0, 'after 5 minutes (or End session) nothing is read');
      } finally {
        if (saved) require.cache[electronPath] = saved;
        else delete require.cache[electronPath];
      }
    }

    done = true;
    console.log('[058] mcp signin: PASS');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
