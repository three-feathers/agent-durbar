/**
 * Spec 087 T021: Copilot's local sandbox as the floor, in the adapter, on the fake SDK client (no runtime, no account, no credits).
 * Part of `npm run test:runtime`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { eventProblems } from '../src/adapters/eventguard';
import type { AgentEvent, StartOptions } from '../src/adapters/types';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';
import { HOME_SECRETS } from '../src/adapters/sandboxRoots';

const WS = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-copilot-sbx-')));

class SbxCopilot extends FakeCopilot {
  constructor(fake: FakeClient, o: { platform?: string; home?: string; path?: string[] } = {}) {
    super(fake);
    this.sandboxPlatform = o.platform ?? 'linux';
    this.sandboxHome = () => o.home ?? '/home/me';
    this.sandboxPathDirs = () => o.path ?? ['/usr/bin', '/home/me/.local/bin', '/home/me', '/home', '/home/other', '/'];
    this.sandboxRealpath = (p) => p;
    this.sandboxTimeoutMs = 50;
  }
}
function make(o: { platform?: string; home?: string; path?: string[]; prep?: (c: FakeClient) => void } = {}) {
  const fake = new FakeClient();
  o.prep?.(fake);
  const ad = new SbxCopilot(fake, o);
  const events: AgentEvent[] = [];
  ad.onEvent((e) => {
    assert.deepStrictEqual(eventProblems(e), [], `event shape: ${JSON.stringify(e)}`);
    events.push(e);
  });
  return { ad, fake, events };
}
const start = (ad: SbxCopilot, mode: StartOptions['permissionMode'], extra: Partial<StartOptions> = {}) => ad.start({ workspace: WS, quiet: true, permissionMode: mode, ...extra });
const updates = (fake: FakeClient, sid: string) => fake.sessions.get(sid)!.calls.filter((c) => c.name === 'options.update' && (c.args[0] as { sandboxConfig?: unknown }).sandboxConfig).map((c) => c.args[0] as { sandboxConfig: Record<string, unknown>; sandboxConfigSource: string });
const sends = (fake: FakeClient, sid: string) => fake.sessions.get(sid)!.calls.filter((c) => c.name === 'send').length;
const sbx = (ev: AgentEvent[], sid: string) => ev.filter((e): e is Extract<AgentEvent, { type: 'sandbox' }> => e.type === 'sandbox' && e.sessionId === sid);
const last = (ev: AgentEvent[], sid: string) => sbx(ev, sid).pop()?.sandbox;

async function main(): Promise<void> {
  // ---- AC1: the update before the first send; Read-only and Ask first shapes; Allow all sends nothing ----
  {
    const { ad, fake, events } = make();
    const ro = await start(ad, 'read-only');
    const u = updates(fake, ro);
    assert.strictEqual(u.length, 1, 'one update at start');
    assert.strictEqual(u[0].sandboxConfigSource, 'session_flag');
    const c = u[0].sandboxConfig as { userPolicy: { filesystem: Record<string, string[]>; network: Record<string, boolean> } } & Record<string, unknown>;
    assert.strictEqual(c.enabled, true);
    assert.strictEqual(c.addCurrentWorkingDirectory, false);
    assert.strictEqual(c.allowDevToolAccess, false, 'never the dev-tool grants (they include writes)');
    assert.ok(!('allowBypass' in c), 'no bypass');
    assert.ok(!('credentials' in c), 'no credential injection');
    assert.deepStrictEqual(c.auth, { git: false, gh: false });
    assert.strictEqual(c.sandboxMcpServers, true);
    assert.deepStrictEqual(c.userPolicy.network, { allowOutbound: false, allowLocalNetwork: false });
    assert.deepStrictEqual(c.userPolicy.filesystem.readwritePaths, [], 'Read-only: no writable path');
    assert.deepStrictEqual(c.userPolicy.filesystem.readonlyPaths, [WS, '/usr/bin', '/home/me/.local/bin'], 'roots, then PATH folders minus home, its ancestors and other profiles');
    assert.deepStrictEqual(c.userPolicy.filesystem.deniedPaths, HOME_SECRETS.map((x) => '/home/me/' + x), 'with denied_paths: the credential folders');
    assert.strictEqual(last(events, ro)?.state, 'on');
    assert.strictEqual(last(events, ro)?.mechanism, 'bubblewrap');
    assert.deepStrictEqual(last(events, ro)?.covers, ['shell', 'mcp']);
    await ad.send(ro, { text: 'hi' });
    const calls = fake.sessions.get(ro)!.calls.map((x) => x.name);
    assert.ok(calls.indexOf('options.update') < calls.indexOf('send'), 'the update is recorded before the first send');
    const ask = await start(ad, 'ask');
    const ca = updates(fake, ask)[0].sandboxConfig as { userPolicy: { filesystem: Record<string, string[]> } };
    assert.deepStrictEqual(ca.userPolicy.filesystem.readwritePaths, [WS]);
    assert.deepStrictEqual(ca.userPolicy.filesystem.readonlyPaths, ['/usr/bin', '/home/me/.local/bin']);
    assert.deepStrictEqual(ca.userPolicy.filesystem.deniedPaths, [path.join(WS, '.git', 'hooks'), path.join(WS, '.git', 'config'), ...HOME_SECRETS.map((x) => '/home/me/' + x)], 'Ask first: protected paths in each root');
    const all = await start(ad, 'allow');
    assert.strictEqual(updates(fake, all).length, 0, 'Allow all: nothing sent');
    assert.strictEqual(last(events, all), null, 'Allow all: nothing to show');
    await ad.dispose();
  }

  // ---- without denied_paths nothing is claimed in deniedPaths ----
  {
    const { ad, fake } = make({ prep: (c) => { c.sandboxHost = { supported: true, capabilities: [{ name: 'shell', supported: true }] }; } });
    const ask = await start(ad, 'ask');
    assert.ok(!('deniedPaths' in (updates(fake, ask)[0].sandboxConfig as { userPolicy: { filesystem: object } }).userPolicy.filesystem));
    await ad.dispose();
  }

  // ---- AC1 (refused update) + AC3 + AC4: the first send is held; Continue; FR-007b resets ----
  {
    const { ad, fake, events } = make();
    fake.sessions.clear();
    const origCreate = fake.createSession.bind(fake);
    fake.createSession = async (cfg) => { const s = await origCreate(cfg); s.updateFail = 'unsupported-policy: denied paths cannot be enforced'; return s; };
    const sid = await start(ad, 'ask');
    assert.strictEqual(last(events, sid)?.state, 'off');
    assert.match(String(last(events, sid)?.reason), /refused the sandbox settings: unsupported-policy/);
    await ad.send(sid, { text: 'run it' });
    assert.strictEqual(sends(fake, sid), 0, 'held: nothing sent');
    const n = sbx(events, sid).find((e) => e.notice)!;
    assert.match(n.notice!.text, /Copilot could not start its OS sandbox: .*Nothing was sent\.$/);
    assert.deepStrictEqual(n.notice!.actions, ['continue'], 'AC3: Copilot never offers Always');
    await assert.rejects(ad.continueWithoutSandbox!(sid, { always: true }), /not offered for Copilot/);
    await ad.continueWithoutSandbox!(sid);
    assert.strictEqual(sends(fake, sid), 0, 'Continue sends nothing');
    await ad.send(sid, { text: 'run it now' });
    assert.strictEqual(sends(fake, sid), 1, 'the next send goes out');
    assert.strictEqual(updates(fake, sid).length, 1, 'without a new sandboxConfig');
    // a mode switch and a resume in the same run do not try again
    ad.setPermMode!(sid, 'read-only');
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(updates(fake, sid).length, 1, 'mode switch after Continue: no new update');
    await ad.stop(sid);
    fake.onDisk.add(sid);
    const again = await ad.start({ workspace: WS, quiet: true, permissionMode: 'ask', resumeSessionId: sid });
    assert.strictEqual(updates(fake, again).length, 0, 'resume in the same run: not tried again');
    // a NEW session tries again
    const fresh = await start(ad, 'ask');
    assert.strictEqual(updates(fake, fresh).length, 1, 'a new session sends the update again');
    await ad.dispose();
    // after a restart (fresh adapter) a resume tries again and shows the note exactly once
    const m2 = make();
    m2.fake.onDisk.add(sid);
    const orig2 = m2.fake.resumeSession.bind(m2.fake);
    m2.fake.resumeSession = async (id, cfg) => { const s = await orig2(id, cfg); s.updateFail = 'still unsupported'; return s; };
    const r2 = await m2.ad.start({ workspace: WS, quiet: true, permissionMode: 'ask', resumeSessionId: sid });
    assert.strictEqual(updates(m2.fake, r2).length, 1, 'after a restart the update is sent again');
    await m2.ad.send(r2, { text: 'x' });
    assert.strictEqual(sbx(m2.events, r2).filter((e) => e.notice).length, 1, 'the note once');
    await m2.ad.dispose();
  }

  // ---- unsupported host, a missing method, the policy (AC3: refusal) ----
  {
    const { ad, fake, events } = make({ prep: (c) => { c.sandboxHost = { supported: false, reason: 'bwrap 0.4 is too old; token ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', capabilities: [] }; } });
    const sid = await start(ad, 'read-only');
    assert.strictEqual(updates(fake, sid).length, 0, 'unsupported: no update');
    const st = last(events, sid)!;
    assert.strictEqual(st.state, 'off');
    assert.ok(!/ghp_a/.test(String(st.reason)) && /redacted/.test(String(st.reason)), 'the vendor reason is masked');
    assert.ok(String(st.reason).length <= 200);
    await ad.send(sid, { text: 'x' });
    assert.strictEqual(sends(fake, sid), 0);
    assert.strictEqual(fake.hostCalls, 1);
    await start(ad, 'ask');
    assert.strictEqual(fake.hostCalls, 1, 'getHostSupport once per runtime start');
    const req = await start(ad, 'ask', { requireOsSandbox: true });
    await assert.rejects(ad.send(req, { text: 'x' }), /Read-only and Ask first need/, 'policy: refused');
    await assert.rejects(ad.continueWithoutSandbox!(req), /organization requires/, 'FR-007d: Continue ignored under the policy');
    await ad.dispose();
    const old = make({ prep: (c) => { c.sandboxHostFail = 'Unknown method sandbox.getHostSupport'; } });
    const o = await start(old.ad, 'read-only');
    assert.match(String(last(old.events, o)?.reason), /cannot report its sandbox/);
    await old.ad.dispose();
  }

  // ---- a runtime that never answers: the start goes on, the first send is held (fail closed); a failed host check is asked again ----
  {
    const { ad, fake, events } = make();
    const orig = fake.createSession.bind(fake);
    fake.createSession = async (cfg) => { const s = await orig(cfg); s.rpc.options.update = () => new Promise(() => undefined); return s; };
    const sid = await start(ad, 'read-only');
    assert.match(String(last(events, sid)?.reason), /did not answer in time/);
    await ad.send(sid, { text: 'x' });
    assert.strictEqual(sends(fake, sid), 0, 'held');
    await ad.dispose();
    const m2 = make({ prep: (c) => { c.sandboxHostFail = 'boom'; } });
    await start(m2.ad, 'read-only');
    m2.fake.sandboxHostFail = '';
    const ok2 = await start(m2.ad, 'read-only');
    assert.strictEqual(m2.fake.hostCalls, 2, 'a failed host check is not kept');
    assert.strictEqual(last(m2.events, ok2)?.state, 'on');
    await m2.ad.dispose();
  }

  // ---- review on PR 733 (2): Continue with no note open is refused; one-shot ----
  {
    const { ad, fake } = make();
    const sid = await start(ad, 'read-only');
    await assert.rejects(ad.continueWithoutSandbox!(sid), /no OS sandbox note/, 'a working floor is never switched off');
    await ad.send(sid, { text: 'x' });
    assert.strictEqual(sends(fake, sid), 1);
    await ad.dispose();
    const m = make({ prep: (c) => { c.sandboxHost = { supported: false, reason: 'no bwrap', capabilities: [] }; } });
    const s2 = await start(m.ad, 'ask');
    await assert.rejects(m.ad.continueWithoutSandbox!(s2), /no OS sandbox note/, 'no note shown yet: refused');
    await m.ad.send(s2, { text: 'x' });
    await m.ad.continueWithoutSandbox!(s2);
    await assert.rejects(m.ad.continueWithoutSandbox!(s2), /no OS sandbox note/, 'one-shot');
    await m.ad.dispose();
  }

  // ---- review on PR 733 (6): a send right after a mode switch goes out only after the switch's update has answered ----
  {
    const { ad, fake } = make();
    const sid = await start(ad, 'read-only');
    const fsn = fake.sessions.get(sid)!;
    fsn.rpc.options.update = async (a: unknown) => { fsn.calls.push({ name: 'options.update', args: [a] }); await new Promise((r) => setTimeout(r, 30)); fsn.calls.push({ name: 'update-done', args: [] }); };
    ad.setPermMode!(sid, 'ask');
    await ad.send(sid, { text: 'now' });
    const names = fsn.calls.map((c) => c.name);
    assert.ok(names.indexOf('update-done') >= 0 && names.indexOf('update-done') < names.indexOf('send'), 'the send waits for the update: ' + names.join(','));
    await ad.dispose();
  }

  // ---- review on PR 733 (7): the 15 s cap itself (the default, not the test's short one) ----
  {
    const fake = new FakeClient();
    const plain = new FakeCopilot(fake) as unknown as { sandboxTimeoutMs: number };
    assert.strictEqual(plain.sandboxTimeoutMs, 15_000, 'the cap is 15 s');
  }

  // ---- review round 3 on PR 733 (1): a session folder the credential filter drops (~/.config without denied_paths, ~/.ssh) is refused ----
  {
    const H = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-087-cphome-')));
    fs.mkdirSync(path.join(H, '.config', 'gh'), { recursive: true });
    fs.mkdirSync(path.join(H, '.ssh'), { recursive: true });
    const { ad, fake, events } = make({ home: H, prep: (c) => { c.sandboxHost = { supported: true, capabilities: [{ name: 'shell', supported: true }] }; } });
    const sid = await ad.start({ workspace: path.join(H, '.config'), quiet: true, permissionMode: 'ask' });
    assert.strictEqual(last(events, sid)?.state, 'off', 'not shown as Sandboxed');
    assert.match(String(last(events, sid)?.reason), /credential folder/);
    await assert.rejects(ad.send(sid, { text: 'x' }), /credential folder.*Read-only and Ask first need/, 'refused, with the Change mode… text');
    assert.strictEqual(sends(fake, sid), 0);
    await assert.rejects(ad.continueWithoutSandbox!(sid), /credential folder/, 'no Continue past it');
    const s2 = await ad.start({ workspace: path.join(H, '.ssh'), quiet: true, permissionMode: 'read-only' });
    await assert.rejects(ad.send(s2, { text: 'x' }), /credential folder/);
    await ad.dispose();
    fs.rmSync(H, { recursive: true, force: true });
  }

  // ---- AC2: a switch to Allow all sends nothing and keeps the floor until a new session; back to Ask first sends the new floor ----
  {
    const { ad, fake, events } = make();
    const sid = await start(ad, 'read-only');
    ad.setPermMode!(sid, 'allow');
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(updates(fake, sid).length, 1, 'no second update for Allow all');
    assert.deepStrictEqual(last(events, sid), { state: 'on', mechanism: 'bubblewrap', covers: ['shell', 'mcp'], untilNewSession: true, verified: false });
    ad.setPermMode!(sid, 'ask');
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(updates(fake, sid).length, 2, 'Ask first again: the new floor at the switch');
    assert.deepStrictEqual((updates(fake, sid)[1].sandboxConfig as { userPolicy: { filesystem: Record<string, string[]> } }).userPolicy.filesystem.readwritePaths, [WS]);
    // FR-008: a sandbox warning turns it off at once; the session goes on
    fake.sessions.get(sid)!.fire('session.warning', { warningType: 'sandbox', message: 'sandbox lost: helper exited' });
    assert.strictEqual(last(events, sid)?.state, 'off');
    assert.match(String(last(events, sid)?.reason), /sandbox lost/);
    assert.ok(ad.isLive(sid));
    await ad.dispose();
  }

  // ---- Windows and macOS: home ancestors compared case-insensitively; mechanism names ----
  {
    const { ad, fake, events } = make({ platform: 'win32', home: 'C:\\Users\\Me', path: ['c:\\users', 'C:\\USERS\\me', 'C:\\Users\\Other', 'C:\\Users\\Me\\AppData\\Local\\bin', 'C:\\Windows\\System32', 'relative\\bin'] });
    const sid = await ad.start({ workspace: WS, quiet: true, permissionMode: 'ask' });
    const fsx = (updates(fake, sid)[0].sandboxConfig as { userPolicy: { filesystem: Record<string, string[]> } }).userPolicy.filesystem;
    assert.deepStrictEqual(fsx.readonlyPaths, ['C:\\Users\\Me\\AppData\\Local\\bin', 'C:\\Windows\\System32']);
    assert.strictEqual(last(events, sid)?.mechanism, 'processcontainer');
    await ad.dispose();
    const mac = make({ platform: 'darwin', home: '/Users/me', path: ['/USERS', '/users/ME', '/opt/homebrew/bin'] });
    const ms = await mac.ad.start({ workspace: WS, quiet: true, permissionMode: 'read-only' });
    assert.deepStrictEqual((updates(mac.fake, ms)[0].sandboxConfig as { userPolicy: { filesystem: Record<string, string[]> } }).userPolicy.filesystem.readonlyPaths, [WS, '/opt/homebrew/bin']);
    assert.strictEqual(last(mac.events, ms)?.mechanism, 'seatbelt');
    await mac.ad.dispose();
  }

  // ---- FR-012: the Settings line ----
  {
    assert.deepStrictEqual(await make().ad.sandboxHost!(), { available: true, mechanism: 'bubblewrap' });
    const w = await make({ platform: 'win32', prep: (c) => { c.sandboxHost = { supported: false, reason: 'ProcessContainer is not available', capabilities: [] }; } }).ad.sandboxHost!();
    assert.strictEqual(w.available, false);
    assert.match(String(w.fix), /Windows 11 25H2/);
  }
  fs.rmSync(WS, { recursive: true, force: true });
  done = true;
  console.log('copilot sandbox (spec 087 T021): all checks passed');
}
// review on PR 733 (7): a run that stops early (a never-answering fake, an unawaited path) must not exit 0
let done = false;
process.on('exit', (code) => {
  if (!done && code === 0) {
    console.error('copilot sandbox: the run ended before its last check');
    process.exitCode = 1;
  }
});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
