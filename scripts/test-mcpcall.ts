/**
 * Spec 058 FR-187..FR-192 (issue #779 A and B): the last-call outcome on a Running row, and the re-read of the server list.
 * `npm run test:mcpcall`. Pure classifier, main's tracker, the `agents:mcp` reply, `mcpRefreshOp`, the page's words and the simulator's
 * copy of the classifier. Fake adapters only: no runtime, no account, no credits. No real vendor error text, e-mail address or ID is used
 * (the strings below are made-up shapes).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { FakeAdapter } from '../src/adapters/fake';
import type { AgentEvent } from '../src/adapters/types';
import type { AgentInfo, AgentMcpEntry, McpRefreshResult } from '../src/shared/api';
import { McpCallTracker } from '../src/main/mcpcall';
import { agentMcpReply, mcpRefreshOp } from '../src/main/mcpsession';
import { classifyMcpCall } from '../src/shared/mcpcall';

const info = (id: string): AgentInfo => ({ id, name: 'Ana', cwd: '/w', permMode: 'ask', model: 'auto' }) as AgentInfo;

let done = false;
process.on('exit', (code) => {
  if (code === 0 && !done) {
    console.error('[058] mcp call: FAIL (exited before the last check; a pending promise never settled)');
    process.exitCode = 1;
  }
});

// made-up shapes of a Conditional Access refusal: a code, a sentence, a claims blob, a trace id, an e-mail address
const MAIL = 'jane.doe@contoso.example';
const TRACE = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const CLAIMS = 'eyJhY2Nlc3NfdG9rZW4iOnsibmJmIjp7ImVzc2VudGlhbCI6dHJ1ZX19fQ';
const POLICY_TEXT = `AADSTS530003: Your device is required to be managed to access this resource. Trace ID: ${TRACE}. User: ${MAIL}. claims=${CLAIMS}`;

async function main(): Promise<void> {
  // ---- the classifier (FR-187) ----
  const cases: [string, ReturnType<typeof classifyMcpCall>][] = [
    [POLICY_TEXT, 'policy'],
    ['AADSTS530001: blocked', 'policy'],
    ['AADSTS53000 short code is not a policy code', undefined],
    ['Blocked by Conditional Access policy', 'policy'],
    ['Your device must be managed to use this', undefined], // wording with "must": not claimed (only the known shapes)
    ['The device is required to be managed', 'policy'],
    ['device is not compliant', 'policy'],
    ['The server answered 401 Unauthorized', 'auth'],
    ['AADSTS50076: strong authentication is required', 'auth'],
    ['AADSTS70043: the refresh token has expired', 'auth'],
    ['token expired', 'auth'],
    ['MCP OAuth challenge required (HTTP 401)', 'auth'],
    ['spawn x ENOENT', undefined],
    ['rate limit exceeded', undefined],
    ['file 4010 not found', undefined],
    ['', undefined],
  ];
  for (const [text, want] of cases) assert.strictEqual(classifyMcpCall(text), want, JSON.stringify(text));
  assert.strictEqual(classifyMcpCall('anything', true), 'auth', 'the adapter said it needs a sign-in');
  assert.strictEqual(classifyMcpCall(POLICY_TEXT, true), 'policy', 'a policy refusal is not shown as a missing sign-in');
  for (const bad of [undefined, null, 42, {}, [], Symbol.iterator]) assert.strictEqual(classifyMcpCall(bad), undefined);
  // masking: the answer is one of two words, never a piece of the text
  for (const [text] of cases) {
    const r = classifyMcpCall(text);
    assert.ok(r === undefined || r === 'auth' || r === 'policy');
  }
  // linear time on hostile input (cut first)
  const t0 = process.hrtime.bigint();
  classifyMcpCall('a '.repeat(2_000_000) + 'AADSTS');
  classifyMcpCall('AADSTS5300'.repeat(400_000));
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 500, 'a huge text is cut first');
  assert.strictEqual(classifyMcpCall(' '.repeat(5000) + 'AADSTS530003'), undefined, 'text past the cut is not read');

  // ---- the tracker (FR-187, FR-188) ----
  {
    const t = new McpCallTracker();
    const call = (server: string | undefined, phase: 'start' | 'complete' | 'failed', output?: string, extra: Partial<AgentEvent> = {}): AgentEvent =>
      ({ type: 'toolCall', sessionId: 's1', timestamp: 1, callId: 'c', tool: 'x', phase, ...(server ? { mcpServer: server } : {}), ...(output !== undefined ? { output } : {}), ...extra }) as AgentEvent;
    t.onEvent(call('teams', 'failed', POLICY_TEXT));
    assert.strictEqual(t.get('s1', 'teams'), 'policy');
    assert.strictEqual(t.get('s2', 'teams'), undefined, 'per session');
    assert.strictEqual(t.get('s1', 'other'), undefined, 'per server');
    t.onEvent(call('teams', 'start'));
    assert.strictEqual(t.get('s1', 'teams'), 'policy', 'a call that has only started changes nothing');
    t.onEvent(call(undefined, 'failed', POLICY_TEXT));
    t.onEvent(call(undefined, 'complete'));
    assert.strictEqual(t.get('s1', 'teams'), 'policy', 'a call of no MCP server changes nothing');
    t.onEvent(call('teams', 'complete', 'ok'));
    assert.strictEqual(t.get('s1', 'teams'), undefined, 'a later successful call clears it');
    t.onEvent(call('teams', 'failed', 'whatever', { mcpAuth: true }));
    assert.strictEqual(t.get('s1', 'teams'), 'auth', 'the adapter\'s mcpAuth flag counts');
    t.onEvent(call('teams', 'failed', 'rate limit exceeded'));
    assert.strictEqual(t.get('s1', 'teams'), undefined, 'a failure of another kind is the newest outcome');
    t.onEvent(call('teams', 'failed', POLICY_TEXT));
    t.onEvent({ type: 'status', sessionId: 's1', timestamp: 2, status: 'stopped' } as AgentEvent);
    assert.strictEqual(t.get('s1', 'teams'), undefined, 'a stopped session is forgotten');
    // bounded: 200 servers per session at most
    for (let i = 0; i < 300; i++) t.onEvent(call('srv' + i, 'failed', POLICY_TEXT));
    assert.strictEqual(t.get('s1', 'srv0'), 'policy');
    assert.strictEqual(t.get('s1', 'srv299'), undefined, 'the table does not grow without bound');
    // nothing but the class is kept
    assert.ok(!JSON.stringify([...(t as unknown as { bySession: Map<string, Map<string, string>> }).bySession]).match(/AADSTS|jane|0f1e/), 'no piece of the text is kept');
  }

  // ---- the reply (FR-188, FR-189, FR-190) ----
  {
    const ad = new FakeAdapter({ displayName: 'Copilot', capabilities: { mcpSignIn: true } });
    const sid = await ad.start({ workspace: '/w', quiet: true });
    const a = info(sid);
    const calls = new Map<string, 'auth' | 'policy'>([['teams', 'policy'], ['crm', 'auth'], ['broken', 'policy'], ['off-one', 'policy']]);
    const base = {
      a, ad, off: new Set(['off-one']), secrets: [], cli: [], extras: [], ambientDisabled: new Set<string>(),
      live: [{ name: 'teams', status: 'connected' }, { name: 'crm', status: 'connected' }, { name: 'fine', status: 'connected' }, { name: 'broken', status: 'failed' }, { name: 'off-one', status: 'connected' }],
      lastCall: (n: string) => calls.get(n),
    };
    const r = agentMcpReply(base);
    const by = (n: string): AgentMcpEntry => r.servers.find((x) => x.name === n)!;
    assert.strictEqual(by('teams').lastCall, 'policy');
    assert.strictEqual(by('crm').lastCall, 'auth');
    assert.strictEqual(by('fine').lastCall, undefined, 'a Running server whose calls work says nothing');
    assert.strictEqual(by('broken').lastCall, undefined, 'only a Running row carries it (a failed server has its own reason)');
    assert.strictEqual(by('off-one').lastCall, undefined, 'a server switched off here carries nothing');
    assert.ok(!JSON.stringify(r).match(/AADSTS|jane|0f1e|claims/), 'the reply holds the class and nothing of the text');
    assert.strictEqual(r.canRefresh, true, 'Copilot can read its list again');
    assert.strictEqual(agentMcpReply({ ...base, ad: new FakeAdapter({ displayName: 'Codex', capabilities: {} }) }).canRefresh, undefined, 'an app without the call cannot');
    const codex = new FakeAdapter({ displayName: 'Codex', capabilities: { mcpSignIn: true }, omit: ['refreshMcpStatus'] });
    const csid = await codex.start({ workspace: '/w', quiet: true });
    assert.strictEqual(agentMcpReply({ ...base, a: info(csid), ad: codex }).canRefresh, undefined, 'no refreshMcpStatus: no Refresh');
    assert.strictEqual(agentMcpReply({ ...base, lastCall: undefined }).servers.some((x) => x.lastCall), false, 'no tracker, no class');
  }

  // ---- mcpRefreshOp (FR-190, FR-191) ----
  {
    const ad = new FakeAdapter({ displayName: 'Copilot', capabilities: { mcpSignIn: true } });
    const sid = await ad.start({ workspace: '/w', quiet: true });
    const agents = new Map([[sid, info(sid)]]);
    const router = { forAgent: () => ad };
    const inflight = new Map<string, Promise<McpRefreshResult>>();
    const run = (id: unknown = sid) => mcpRefreshOp({ agents, router, timeoutMs: 80 }, inflight, id);
    assert.deepStrictEqual(await run(), { ok: true, supported: true });
    assert.strictEqual(ad.refreshCalls, 1, 'one re-read of the whole list');
    assert.deepStrictEqual(ad.refreshNames, [undefined], 'with no server name: every server');
    assert.strictEqual((await run('nope')).ok, false);
    assert.strictEqual((await run(42)).ok, false);
    assert.strictEqual(ad.refreshCalls, 1, 'an unknown agent reads nothing');
    // one read at a time: a second call while the first runs shares it
    ad.refreshDelay = 30;
    const [x, y] = await Promise.all([run(), run()]);
    assert.deepStrictEqual([x.ok, y.ok], [true, true]);
    assert.strictEqual(ad.refreshCalls, 2, 'two presses, one read');
    assert.strictEqual(inflight.size, 0, 'nothing stays in flight');
    // a failing read: a short sentence, no vendor text
    ad.refreshDelay = 0;
    ad.refreshFail = `boom ${MAIL} ${TRACE}`;
    const f = await run();
    assert.strictEqual(f.ok, false);
    assert.strictEqual(f.supported, true);
    assert.ok(f.error && !f.error.includes(MAIL) && !f.error.includes(TRACE) && /did not answer/.test(f.error), f.error);
    // a read that never ends is cut by the time limit
    ad.refreshFail = undefined;
    ad.refreshDelay = Infinity;
    const slow = await run();
    assert.strictEqual(slow.ok, false, 'a read that never answers fails after the limit');
    assert.strictEqual(inflight.size, 0);
    ad.refreshDelay = 0;
    assert.strictEqual((await run()).ok, true, 'and the next read works');
    // unsupported: says so, reads nothing
    const bare = new FakeAdapter({ displayName: 'Codex', capabilities: { mcpSignIn: true }, omit: ['refreshMcpStatus'] });
    const bsid = await bare.start({ workspace: '/w', quiet: true });
    const r2 = await mcpRefreshOp({ agents: new Map([[bsid, info(bsid)]]), router: { forAgent: () => bare } }, new Map(), bsid);
    assert.deepStrictEqual(r2, { ok: false, supported: false });
    // not running: asks for a message
    await ad.stop(sid);
    const stopped = await run();
    assert.strictEqual(stopped.ok, false);
    assert.strictEqual(stopped.supported, true);
  }

  // ---- the page's words (FR-189) ----
  {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const W = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'mcpwords.js')) as { callWord: (c: unknown) => string; callHint: (c: unknown, app?: string) => string };
    assert.strictEqual(W.callWord('policy'), 'last call blocked by your organization’s access policy');
    assert.strictEqual(W.callWord('auth'), 'last call needs sign-in');
    for (const bad of [undefined, null, '', 'weird', '__proto__', 'constructor', 'toString', 7, {}]) assert.strictEqual(W.callWord(bad), '', String(bad));
    for (const c of ['policy', 'auth']) {
      assert.ok(W.callHint(c, 'GitHub Copilot').length > 20);
      assert.ok(!/AADSTS|@|[0-9a-f]{8}-/.test(W.callWord(c) + W.callHint(c)), 'fixed words only');
    }
    assert.strictEqual(W.callHint('weird'), '');
  }

  // ---- the simulator's copy of the classifier gives the same answers (FR-187) ----
  {
    const ts = require('typescript') as typeof import('typescript');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'sim.ts'), 'utf8');
    const block = src.slice(src.indexOf('/* mcpcall:begin */'), src.indexOf('/* mcpcall:end */'));
    assert.ok(block.includes('const simCallClass'), 'the simulator marks its copy');
    const js = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const sim = new Function(js + '\nreturn simCallClass;')() as (t: unknown, a?: boolean) => string | undefined;
    for (const [text] of cases) for (const flag of [false, true]) assert.strictEqual(sim(text, flag), classifyMcpCall(text, flag), JSON.stringify(text) + flag);
    for (const bad of [undefined, null, 5]) assert.strictEqual(sim(bad), classifyMcpCall(bad));
  }

  done = true;
  console.log('[058] mcp call PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
