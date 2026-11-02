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
import type { AgentInfo, AgentMcpEntry } from '../src/shared/api';
import { McpCallTracker } from '../src/main/mcpcall';
import { agentMcpReply, mcpRefreshOp } from '../src/main/mcpsession';
import { classifyMcpCall } from '../src/shared/mcpcall';
import { maskMcpEvent } from '../src/main/mcpmask';

const info = (id: string): AgentInfo => ({ id, name: 'Ana', cwd: '/w', permMode: 'ask', model: 'auto' }) as AgentInfo;

let done = false;
process.on('exit', (code) => {
  if (code === 0 && !done) {
    console.error('[058] mcp call: FAIL (exited before the last check; a pending promise never settled)');
    process.exitCode = 1;
  }
});

// made-up shapes of a Conditional Access refusal: a code, a sentence, a claims blob, a trace id, an e-mail address
const MAIL = 'jane.doe@example.invalid';
const TRACE = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const CLAIMS = 'eyJhY2Nlc3NfdG9rZW4iOnsibmJmIjp7ImVzc2VudGlhbCI6dHJ1ZX19fQ';
const POLICY_TEXT = `AADSTS530003: Your device is required to be managed to access this resource. Trace ID: ${TRACE}. User: ${MAIL}. claims=${CLAIMS}`;

async function main(): Promise<void> {
  // ---- the classifier (FR-187) ----
  const cases: [string, ReturnType<typeof classifyMcpCall>][] = [
    [POLICY_TEXT, 'policy'],
    ['AADSTS530001: blocked', 'policy'],
    ['AADSTS53000: device not compliant', 'policy'],
    ['AADSTS53001: device not domain joined', 'policy'],
    ['AADSTS53003: blocked by conditional access', 'policy'],
    ['aadsts530003: lower case', 'policy'],
    ['error=insufficient_claims', 'policy'],
    ['{"error":"interaction_required"}', 'policy'],
    ['AADSTS5300: too short', undefined],
    // review of #980: what signing in again fixes says sign-in, also with interaction_required beside it
    ['{"error":"interaction_required","error_description":"AADSTS50076: multi-factor authentication is required"}', 'auth'],
    ['invalid_grant AADSTS50173 interaction_required', 'auth'],
    ['{"error":"interaction_required"} AADSTS530003', 'policy'],
    // whole words: a code inside a longer word is not that code
    ['XAADSTS53000: blocked', undefined],
    ['AADSTS53000_suffix', undefined],
    ['XAADSTS50076 failed', undefined],
    ['AADSTS50076_suffix', undefined],
    ['AADSTS5300001: seven digits', undefined],
    ['not_insufficient_claims_at_all', undefined],
    ['interaction_required_not', undefined],
    ['Blocked by Conditional Access policy', 'policy'],
    ['Your device must be managed to use this', undefined], // wording with "must": not claimed (only the known shapes)
    ['The device is required to be managed', 'policy'],
    ['device is not compliant', 'policy'],
    ['The server answered 401 Unauthorized', 'auth'],
    ['AADSTS50076: failed', 'auth'],
    ['AADSTS70043: failed', 'auth'],
    ['token expired', 'auth'],
    ['MCP OAuth challenge required (HTTP 401)', 'auth'],
    ['spawn x ENOENT', undefined],
    ['rate limit exceeded', undefined],
    ['file 4010 not found', undefined],
    // review on #800: a bare 401 is not a sign-in
    ['issue 401 not found', undefined],
    ['line 401 of input.csv', undefined],
    ['Page 401 of 900', undefined],
    ['error on line 401', undefined],
    ['record 401', undefined],
    ['HTTP 401', 'auth'],
    ['HTTP/1.1 401', 'auth'],
    ['status: 401', 'auth'],
    ['status code 401', 'auth'],
    ['error 401', 'auth'],
    ['code=401', 'auth'],
    ['response (401)', 'auth'],
    ['401 Unauthorized', 'auth'],
    // review on #800 Q1: only the Entra codes that a new sign-in fixes
    ['AADSTS50058: failed', 'auth'],
    ['AADSTS50072: failed', 'auth'],
    ['AADSTS50074: failed', 'auth'],
    ['AADSTS50078: failed', 'auth'],
    ['AADSTS50079: failed', 'auth'],
    ['AADSTS50132: failed', 'auth'],
    ['AADSTS50133: failed', 'auth'],
    ['AADSTS50173: failed', 'auth'],
    ['AADSTS70008: failed', 'auth'],
    ['AADSTS70044: failed', 'auth'],
    ['AADSTS700082: failed', 'auth'],
    ['AADSTS65001: failed', 'auth'],
    ['AADSTS50105: the user is not assigned to a role for the application', undefined],
    ['AADSTS50020: the user is from another tenant', undefined],
    ['AADSTS50144: the password expired', undefined],
    ['AADSTS50034: the user does not exist', undefined],
    ['AADSTS70001: application not found', undefined],
    ['AADSTS500760: not a listed code', undefined],
    ['AADSTS5007: short', undefined],
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

  // ---- FR-193: maskMcpEvent sets the word from the masked text, and only the word ----
  {
    const SECRET = 'sk-hostile-secret-value-1234567890';
    const ev = (output: string, extra: Partial<AgentEvent> = {}): AgentEvent => ({ type: 'toolCall', sessionId: 's1', timestamp: 1, callId: 'c', tool: 'x-send', phase: 'failed', mcpServer: 'x', output, ...extra }) as AgentEvent;
    const out = maskMcpEvent(ev(POLICY_TEXT + ' capolids=11111111-2222-3333-4444-555555555555'), []) as AgentEvent & { mcpCall?: string; output?: string };
    assert.strictEqual(out.mcpCall, 'policy');
    assert.deepStrictEqual(Object.keys(out).sort(), [...Object.keys(ev('')), 'mcpCall'].sort(), 'one new key, a word');
    assert.strictEqual((maskMcpEvent(ev('plain failure')) as { mcpCall?: string }).mcpCall, undefined);
    assert.strictEqual((maskMcpEvent(ev(POLICY_TEXT, { phase: 'complete' })) as { mcpCall?: string }).mcpCall, undefined, 'only a failed call');
    assert.strictEqual((maskMcpEvent(ev(POLICY_TEXT, { mcpServer: undefined })) as { mcpCall?: string }).mcpCall, undefined, 'only an MCP call');
    assert.strictEqual((maskMcpEvent(ev('The server answered 401 Unauthorized')) as { mcpCall?: string }).mcpCall, undefined, 'auth is not policy');
    // the text is read after masking: a secret value in the session's list is gone before the match, and the word never holds it
    const m = maskMcpEvent(ev('AADSTS530003 ' + SECRET), [SECRET]) as AgentEvent & { mcpCall?: string; output?: string };
    assert.strictEqual(m.mcpCall, 'policy');
    assert.ok(!JSON.stringify(m).includes(SECRET), 'the secret is masked and the word carries none of it');
    // a code that only exists inside a masked value is not read
    assert.strictEqual((maskMcpEvent(ev('x ' + SECRET + ' y'.padEnd(5)), [SECRET]) as { mcpCall?: string }).mcpCall, undefined);
    const CODEY = 'AADSTS530003-value-of-a-secret-token';
    assert.strictEqual((maskMcpEvent(ev('failed: ' + CODEY), [CODEY]) as { mcpCall?: string }).mcpCall, undefined, 'a code inside a masked value is not read: the match runs on the masked text');
    assert.strictEqual((maskMcpEvent(ev('before AADSTS530003'.replace('AADSTS530003', 'AAD' + SECRET + 'STS530003')), [SECRET]) as { mcpCall?: string }).mcpCall, undefined, 'masking first: the secret is cut out, so no code is left');
  }

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
    // FR-188 (review on #800): a server coming back to `connected` drops its class; one that never left keeps it
    {
      const u = new McpCallTracker();
      const ev = (server: string, output: string): AgentEvent => ({ type: 'toolCall', sessionId: 's9', timestamp: 1, callId: 'c', tool: 'x', phase: 'failed', mcpServer: server, output }) as AgentEvent;
      u.onServers('s9', [{ name: 'a', status: 'connected' }, { name: 'p', status: 'connected' }]);
      u.onEvent(ev('a', 'The server answered 401 Unauthorized'));
      u.onEvent(ev('p', POLICY_TEXT));
      u.onServers('s9', [{ name: 'a', status: 'connected' }, { name: 'p', status: 'connected' }]);
      assert.deepStrictEqual([u.get('s9', 'a'), u.get('s9', 'p')], ['auth', 'policy'], 'a repeated connected report changes nothing (a policy keeps saying connected)');
      u.onServers('s9', [{ name: 'a', status: 'needs-auth' }, { name: 'p', status: 'connected' }]);
      assert.strictEqual(u.get('s9', 'a'), 'auth', 'needs-auth keeps the class');
      u.onServers('s9', [{ name: 'a', status: 'connected' }, { name: 'p', status: 'connected' }]);
      assert.strictEqual(u.get('s9', 'a'), undefined, 'needs-auth then connected: signed in again, the words go');
      assert.strictEqual(u.get('s9', 'p'), 'policy', 'the policy stays: that server never left connected');
      u.onEvent(ev('a', 'HTTP 401'));
      u.onServers('s9', [{ name: 'p', status: 'connected' }]);
      u.onServers('s9', [{ name: 'a', status: 'connected' }, { name: 'p', status: 'connected' }]);
      assert.strictEqual(u.get('s9', 'a'), 'auth', 'a server missing from a report and then back is not a fix (no earlier state to compare)');
      u.onServers('s9', [{ name: 'a', status: 'pending' }]);
      u.onServers('s9', [{ name: 'a', status: 'connected' }]);
      assert.strictEqual(u.get('s9', 'a'), undefined, 'a restart (pending then connected) drops it');
      u.onEvent({ type: 'status', sessionId: 's9', timestamp: 2, status: 'stopped' } as AgentEvent);
      u.onEvent(ev('a', 'HTTP 401'));
      u.onServers('s9', [{ name: 'a', status: 'connected' }]);
      assert.strictEqual(u.get('s9', 'a'), 'auth', 'a stopped session forgot the states too');
    }
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
    let inflight = new Map<string, Promise<void>>();
    const run = (id: unknown = sid) => mcpRefreshOp({ agents, router, timeoutMs: 80 }, inflight, id, true); // the button: no throttle
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
    // review on #800: the adapter's call is the single-flight key until it settles, so presses on a hung adapter add no read
    const before = ad.refreshCalls;
    for (let i = 0; i < 3; i++) assert.strictEqual((await run()).ok, false);
    assert.strictEqual(ad.refreshCalls, before, 'three more presses on a hung adapter: no new read');
    assert.strictEqual(inflight.size, 1, 'the hung call is still the marker');
    // a late answer clears the marker and the next press reads again
    ad.refreshDelay = 0;
    inflight = new Map();
    assert.strictEqual((await run()).ok, true, 'and the next read works');
    // FR-190 (owner, 2026-10-27): opening the dialog reads at most once a minute per agent; Refresh always reads
    {
      const ad2 = new FakeAdapter({ displayName: 'Copilot', capabilities: { mcpSignIn: true } });
      const s2 = await ad2.start({ workspace: '/w', quiet: true });
      const ag2 = new Map([[s2, info(s2)]]);
      let clock = 1_000_000;
      const dd = { agents: ag2, router: { forAgent: () => ad2 }, lastRead: new Map<string, number>(), now: () => clock };
      const open = () => mcpRefreshOp(dd, new Map(), s2, false);
      const press = () => mcpRefreshOp(dd, new Map(), s2, true);
      assert.deepStrictEqual(await open(), { ok: true, supported: true });
      assert.strictEqual(ad2.refreshCalls, 1, 'the first open reads');
      clock += 59_999;
      assert.deepStrictEqual(await open(), { ok: true, supported: true, skipped: true });
      assert.strictEqual(ad2.refreshCalls, 1, 'a second open within 60 s reads nothing');
      assert.strictEqual((await press()).skipped, undefined);
      assert.strictEqual(ad2.refreshCalls, 2, 'Refresh within 60 s reads');
      clock += 59_999;
      await open();
      assert.strictEqual(ad2.refreshCalls, 2, 'the minute counts from the last read, Refresh included');
      clock += 2;
      await open();
      assert.strictEqual(ad2.refreshCalls, 3, 'an open after 60 s reads');
      clock -= 500_000; // a clock that went back: reads rather than waits for ever
      await open();
      assert.strictEqual(ad2.refreshCalls, 4, 'a clock that moved back does not block reads');
      await mcpRefreshOp({ ...dd, lastRead: new Map() }, new Map(), s2, undefined);
      assert.strictEqual(ad2.refreshCalls, 5, 'no memory of a read: reads');
    }
    // a call that settles late clears its own marker
    {
      const ad3 = new FakeAdapter({ displayName: 'Copilot', capabilities: { mcpSignIn: true } });
      const s3 = await ad3.start({ workspace: '/w', quiet: true });
      const infl = new Map<string, Promise<void>>();
      ad3.refreshDelay = 60;
      const dd3 = { agents: new Map([[s3, info(s3)]]), router: { forAgent: () => ad3 }, timeoutMs: 10 };
      assert.strictEqual((await mcpRefreshOp(dd3, infl, s3, true)).ok, false, 'the time limit (10 ms) passes first');
      assert.strictEqual(infl.size, 1);
      await new Promise((r) => setTimeout(r, 120));
      assert.strictEqual(infl.size, 0, 'the late call settled and cleared the marker');
      // the open-time read says it must start nothing; the button does not say so
      ad3.refreshDelay = 0;
      await mcpRefreshOp({ ...dd3, timeoutMs: 80 }, infl, s3, false);
      await mcpRefreshOp({ ...dd3, timeoutMs: 80 }, infl, s3, true);
      assert.deepStrictEqual(ad3.refreshOpts.slice(-2), [{ startNothing: true }, undefined], 'open: startNothing; Refresh: plain');
    }
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
