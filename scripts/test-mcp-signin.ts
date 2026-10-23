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
import { McpSignInStore, SIGN_IN_TTL_MS, mcpCancelSignInOp, mcpOpenSignInOp, mcpSignInOp, signInErrorText } from '../src/main/mcpsignin';
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
      assert.strictEqual(await st.open('a', 'x'), 'gone', 'an expired sign-in is not opened');
      assert.deepStrictEqual(opened, []);
      assert.ok(st.begin('a', 'x', PAGE, 'auth.example.com'), 'after the limit a new one may start');
      // opening: only the held address, re-checked
      assert.strictEqual(await st.open('a', 'x'), 'opened');
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
      assert.strictEqual(await st.open('a', 'z'), 'refused');
      assert.deepStrictEqual(opened, [], 'http: never reaches the opener');
      assert.ok(!st.has('a', 'z'));
      // the opener fails: the entry stays and the error is not an address
      const bad = new McpSignInStore(() => 0, async () => { throw new Error(`no browser for ${PAGE}`); });
      bad.begin('a', 'x', PAGE, 'h');
      assert.strictEqual(await bad.open('a', 'x'), 'failed');
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
      assert.deepStrictEqual(await mcpOpenSignInOp(store, agents, sid, 'teams'), { ok: true });
      assert.deepStrictEqual(opened, [PAGE], 'the held address was opened, once');
      assert.deepStrictEqual(await mcpOpenSignInOp(store, agents, 'nope', 'teams'), { ok: false, error: 'Unknown agent or server.' });
      assert.strictEqual((await mcpOpenSignInOp(store, agents, sid, 'x'.repeat(65))).ok, false);
      assert.strictEqual((await mcpOpenSignInOp(store, agents, sid, 'web')).gone, true, 'nothing held for web');
      // Cancel: forgotten, the adapter's cancel is called, a second Cancel is harmless
      assert.deepStrictEqual(await mcpCancelSignInOp(d, store, sid, 'teams'), { ok: true });
      assert.ok(!store.has(sid, 'teams'));
      assert.deepStrictEqual(calls(), ['start teams', 'cancel teams']);
      assert.deepStrictEqual(await mcpCancelSignInOp(d, store, sid, 'teams'), { ok: true });
      assert.strictEqual(calls().length, 2, 'cancelling nothing calls nothing');
      assert.strictEqual((await mcpCancelSignInOp(d, store, 'nope', 'teams')).ok, false);
      assert.strictEqual((await mcpOpenSignInOp(store, agents, sid, 'teams')).gone, true, 'after Cancel nothing opens');

      // the 10-minute limit
      assert.strictEqual((await mcpSignInOp(d, store, sid, 'teams')).ok, true);
      t += SIGN_IN_TTL_MS - 1;
      assert.ok(store.has(sid, 'teams'));
      t += 1;
      const late = await mcpOpenSignInOp(store, agents, sid, 'teams');
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
      assert.ok(!ftext.includes('SECRETSTATE') && !ftext.includes('example.com') && !ftext.includes(secret) && !ftext.includes('abcdefghijklmnop'), `no address or secret in the error: ${ftext}`);
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
        registerMcpIpc({
          store: () => store, agents,
          router: { onEvent: (cb: (e: AgentEvent) => void) => { listener = cb; return () => undefined; }, forAgent: () => ad } as never,
          dev: { DURBAR_COPILOT_DIR: path.join(ws, 'copilot') } as never,
          appOf: () => 'copilot',
          log: (_a, action) => logs.push(action),
          openUrl: async (u) => { opened.push(u); },
          now: () => t,
        });
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
        assert.deepStrictEqual(await call('agents:mcpOpenSignIn', sid, 'teams'), { ok: true });
        assert.deepStrictEqual(opened, [PAGE]);
        assert.strictEqual(((await call('agents:mcp', sid) as unknown as { servers: Array<{ name: string; signIn?: { opened: boolean } }> }).servers.find((x) => x.name === 'teams')!.signIn!.opened), true);
        // the runtime reports the server connected: the entry is dropped and the row stops offering Sign in
        emit(mcpEvent([{ name: 'teams', status: 'connected' }, { name: 'web', status: 'connected' }]));
        assert.strictEqual((await call('agents:mcpOpenSignIn', sid, 'teams')).gone, true, 'connected drops the held address');
        entries = (await call('agents:mcp', sid) as unknown as { servers: Array<Record<string, unknown>> }).servers;
        assert.strictEqual(entries.find((x) => x.name === 'teams')!.signIn, undefined);
        // End session / Restart session: the stopped event drops it
        emit(mcpEvent(NEEDS));
        assert.strictEqual((await call('agents:mcpSignIn', sid, 'teams')).ok, true);
        emit({ type: 'status', sessionId: sid, timestamp: 2, status: 'stopped' } as AgentEvent);
        assert.strictEqual((await call('agents:mcpOpenSignIn', sid, 'teams')).gone, true, 'End session drops the held address');
        // the time limit, through the channel
        emit(mcpEvent(NEEDS));
        assert.strictEqual((await call('agents:mcpSignIn', sid, 'teams')).ok, true);
        t += SIGN_IN_TTL_MS;
        assert.strictEqual((await call('agents:mcpOpenSignIn', sid, 'teams')).gone, true, '10 minutes: gone');
        assert.deepStrictEqual(opened, [PAGE], 'still opened only the one time');
        // Cancel through the channel
        assert.strictEqual((await call('agents:mcpSignIn', sid, 'teams')).ok, true);
        assert.deepStrictEqual(await call('agents:mcpCancelSignIn', sid, 'teams'), { ok: true });
        assert.strictEqual((await call('agents:mcpOpenSignIn', sid, 'teams')).gone, true);
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
