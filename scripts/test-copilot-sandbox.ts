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
import { FakeClient, FakeCopilot, RestartingFakeCopilot } from './fakes/copilot-sdk';
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
    await assert.rejects(ad.send(sid, { text: 'x' }), /holds one \(for example ~\/\.ssh or ~\/\.config\).*Read-only and Ask first need/, 'refused, with the Change mode… text, in Copilot\'s words');
    assert.strictEqual(sends(fake, sid), 0);
    await assert.rejects(ad.continueWithoutSandbox!(sid), /credential folder/, 'no Continue past it');
    const s2 = await ad.start({ workspace: path.join(H, '.ssh'), quiet: true, permissionMode: 'read-only' });
    await assert.rejects(ad.send(s2, { text: 'x' }), /credential folder/);
    await ad.dispose();
    // review round 4 (2): a SECOND folder that the filter drops is named in the state, never dropped silently
    fs.mkdirSync(path.join(H, 'proj'), { recursive: true });
    const wsFile = path.join(H, 'two.code-workspace');
    fs.writeFileSync(wsFile, JSON.stringify({ folders: [{ path: path.join(H, 'proj') }, { path: path.join(H, '.ssh') }] }));
    const m3 = make({ home: H });
    const s3 = await m3.ad.start({ workspace: wsFile, quiet: true, permissionMode: 'ask' });
    const fsys = (updates(m3.fake, s3)[0].sandboxConfig as { userPolicy: { filesystem: Record<string, string[]> } }).userPolicy.filesystem;
    assert.deepStrictEqual(fsys.readwritePaths, [path.join(H, 'proj')], 'the credential folder is not granted');
    assert.strictEqual(last(m3.events, s3)?.state, 'on');
    assert.ok((last(m3.events, s3)?.leftOut ?? []).some((x) => /\.ssh \(credential folder\)$/.test(x)), 'and the state names it');
    await m3.ad.dispose();
    // review round 5: a second folder dropped for any other reason (a filesystem root, a quote, unresolvable) is named too
    const q = path.join(H, 'it"s');
    // no folder is made: a quote drops the path before it is resolved (and Windows cannot make such a name)
    const wsOdd = path.join(H, 'odd.code-workspace');
    fs.writeFileSync(wsOdd, JSON.stringify({ folders: [{ path: path.join(H, 'proj') }, { path: path.parse(H).root }, { path: q }, { path: path.join(H, 'missing') }] }));
    const m4 = make({ home: H });
    m4.ad['sandboxRealpath' as never] = ((p: string) => fs.realpathSync.native(p)) as never;
    const s4 = await m4.ad.start({ workspace: wsOdd, quiet: true, permissionMode: 'ask' });
    assert.deepStrictEqual((updates(m4.fake, s4)[0].sandboxConfig as { userPolicy: { filesystem: Record<string, string[]> } }).userPolicy.filesystem.readwritePaths, [path.join(H, 'proj')]);
    const named4 = last(m4.events, s4)?.leftOut ?? [];
    for (const p of [path.parse(H).root, q, path.join(H, 'missing')]) assert.ok(named4.includes(`${p} (not usable)`), `named: ${p} in ${JSON.stringify(named4)}`);
    await m4.ad.dispose();
    // round 5: the session's OWN folder unusable (a link to the filesystem root): refused as FR-015, with that reason
    fs.symlinkSync(path.parse(H).root, path.join(H, 'to-root'), 'dir');
    const wsR = path.join(H, 'rootfirst.code-workspace');
    fs.writeFileSync(wsR, JSON.stringify({ folders: [{ path: path.join(H, 'to-root') }, { path: path.join(H, 'proj') }] }));
    const m5 = make({ home: H });
    m5.ad['sandboxRealpath' as never] = ((p: string) => fs.realpathSync.native(p)) as never;
    const s5 = await m5.ad.start({ workspace: wsR, quiet: true, permissionMode: 'read-only' });
    await assert.rejects(m5.ad.send(s5, { text: 'x' }), /own folder.*Read-only and Ask first need/);
    assert.strictEqual(sends(m5.fake, s5), 0);
    await m5.ad.dispose();
    fs.rmSync(H, { recursive: true, force: true });
  }

  // ---- AC2 + T072 (FR-022c; T066 verdict A, real: 2026-10-28): a switch to Allow all lowers the floor in place with exactly the proven payload;
  // resolved: no floor (null); back to Ask first re-sends the full floor (FR-004) ----
  {
    const LOWER = { sandboxConfig: { enabled: false }, sandboxConfigSource: 'session_disabled' };
    const { ad, fake, events } = make();
    const sid = await start(ad, 'read-only');
    ad.setPermMode!(sid, 'allow');
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(updates(fake, sid).length, 2, 'AC1: one lowering at the switch');
    assert.deepStrictEqual(updates(fake, sid)[1], LOWER, 'AC1: exactly the T066 payload, no other field');
    assert.strictEqual(last(events, sid), null, 'AC1: resolved: no floor, no word, no action (as a fresh Allow all session)');
    assert.strictEqual(sbx(events, sid).filter((e) => e.notLowered).length, 0, 'resolved: no notLowered event (no toast)');
    ad.setPermMode!(sid, 'ask');
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(updates(fake, sid).length, 3, 'Ask first again: the new floor at the switch');
    const back = updates(fake, sid)[2] as { sandboxConfig: { enabled: boolean; userPolicy: { filesystem: Record<string, string[]> } }; sandboxConfigSource: string };
    assert.deepStrictEqual([back.sandboxConfig.enabled, back.sandboxConfigSource], [true, 'session_flag'], 'AC1: narrowing re-sends the full floor');
    assert.deepStrictEqual(back.sandboxConfig.userPolicy.filesystem.readwritePaths, [WS]);
    assert.strictEqual(last(events, sid)?.state, 'on');
    assert.strictEqual(last(events, sid)?.heldFloor, true, 'review on PR #833: a floor in force says heldFloor (the Allow all dialog names the lowering)');
    // the sends wait for the switch: a send right after it goes out after the lowering settled
    ad.setPermMode!(sid, 'allow');
    await ad.send(sid, { text: 'after the switch' });
    const names = fake.sessions.get(sid)!.calls.map((x) => (x.name === 'options.update' && (x.args[0] as { sandboxConfigSource?: string }).sandboxConfigSource === 'session_disabled' ? 'lower' : x.name));
    assert.ok(names.lastIndexOf('lower') >= 0 && names.lastIndexOf('lower') < names.lastIndexOf('send'), 'the send goes after the lowering: ' + names.join(','));
    assert.strictEqual(last(events, sid), null, 'lowered again');
    // a fresh Allow all session holds no floor: a switch to Allow all and back is as before (nothing lowered)
    const fresh = await start(ad, 'allow');
    ad.setPermMode!(fresh, 'allow');
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(updates(fake, fresh).length, 0, 'no floor: nothing to lower');
    // FR-008: a sandbox warning turns it off at once; the session goes on
    ad.setPermMode!(sid, 'ask');
    await new Promise((r) => setTimeout(r, 5));
    fake.sessions.get(sid)!.fire('session.warning', { warningType: 'sandbox', message: 'sandbox lost: helper exited' });
    assert.strictEqual(last(events, sid)?.state, 'off');
    assert.match(String(last(events, sid)?.reason), /sandbox lost/);
    assert.ok(ad.isLive(sid));
    await ad.dispose();
  }

  // ---- T072 AC1 (FR-022c): a refused or a hanging lowering keeps the floor assumed in force: untilNewSession, Restart without the sandbox
  // stays offered (FR-022), and the window is told (notLowered: the toast). Refused: narrowing re-sends the floor. Hanging: the lowering may
  // still land, so a narrowing claims nothing and holds the sends (FR-007) until it answers (review on PR #833) ----
  {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const T = require('../../src/renderer/sandboxtext.js') as { canRestartWithoutSandbox(o: unknown): boolean };
    for (const how of ['refused', 'hangs'] as const) {
      const { ad, fake, events } = make();
      const sid = await start(ad, 'ask');
      const fs0 = fake.sessions.get(sid)!;
      if (how === 'refused') fs0.updateFail = 'policy conflict: below-floor change';
      else fs0.updateHangs = true;
      ad.setPermMode!(sid, 'allow');
      await new Promise((r) => setTimeout(r, how === 'hangs' ? 120 : 5)); // the 50 ms limit of the test adapter (15 s in the app)
      assert.deepStrictEqual(updates(fake, sid)[1], { sandboxConfig: { enabled: false }, sandboxConfigSource: 'session_disabled' }, `${how}: the lowering was tried`);
      assert.deepStrictEqual(last(events, sid), { state: 'on', mechanism: 'bubblewrap', covers: ['shell', 'mcp'], untilNewSession: true, verified: false }, `${how}: the floor is kept until a new session`);
      assert.strictEqual(T.canRestartWithoutSandbox({ sandbox: last(events, sid), mode: 'allow', caps: { resume: true } }), true, `${how}: Restart without the sandbox is offered`);
      assert.strictEqual(sbx(events, sid).filter((e) => e.notLowered === true).length, 1, `${how}: one notLowered event for the toast`);
      fs0.updateFail = '';
      fs0.updateHangs = false;
      ad.setPermMode!(sid, 'ask');
      await new Promise((r) => setTimeout(r, 5));
      if (how === 'refused') {
        assert.strictEqual(last(events, sid)?.heldFloor, true, 'after a refused lowering: the narrowed state holds the floor');
        const back = updates(fake, sid)[2] as { sandboxConfig: { enabled: boolean }; sandboxConfigSource: string };
        assert.deepStrictEqual([back?.sandboxConfig.enabled, back?.sandboxConfigSource], [true, 'session_flag'], 'refused: narrowing re-sends the floor');
        assert.strictEqual(last(events, sid)?.state, 'on');
      } else {
        assert.strictEqual(updates(fake, sid).length, 2, 'hangs: no floor is sent while the lowering may still land');
        assert.strictEqual(last(events, sid)?.state, 'unknown', 'hangs: fail closed, nothing is claimed');
        await ad.send(sid, { text: 'x' });
        assert.strictEqual(sends(fake, sid), 0, 'hangs: the send is held (FR-007)');
        assert.ok(sbx(events, sid).some((e) => e.notice && /earlier request to turn its sandbox off/.test(e.notice.text)), 'hangs: the note says why');
      }
      await ad.dispose();
    }
  }

  // ---- review on PR #833, item 1: a lowering that answers AFTER the limit is not ignored ----
  for (const late of ['resolve', 'reject'] as const) {
    // (a) still in Allow all: a late success ends the floor (state null); a late refusal keeps it
    {
      const { ad, fake, events } = make();
      const sid = await start(ad, 'read-only');
      const fs0 = fake.sessions.get(sid)!;
      fs0.lowerDeferred = true;
      ad.setPermMode!(sid, 'allow');
      await new Promise((r) => setTimeout(r, 120)); // past the 50 ms limit
      assert.strictEqual(last(events, sid)?.untilNewSession, true, `(a) ${late}: before the late answer, the floor is assumed on`);
      if (late === 'resolve') fs0.deferred.shift()!.resolve(); else fs0.deferred.shift()!.reject(new Error('late refusal'));
      await new Promise((r) => setTimeout(r, 10));
      if (late === 'resolve') assert.strictEqual(last(events, sid), null, '(a) resolve: the floor is off, and the state says so');
      else assert.strictEqual(last(events, sid)?.untilNewSession, true, '(a) reject: the floor stays');
      assert.strictEqual(updates(fake, sid).length, 2, `(a) ${late}: no new update`);
      await ad.dispose();
    }
    // (b) back to Ask first after the limit: no floor is claimed until the late answer; then the floor goes out after it, and only then is it on
    {
      const { ad, fake, events } = make();
      const sid = await start(ad, 'ask');
      const fs0 = fake.sessions.get(sid)!;
      fs0.lowerDeferred = true;
      ad.setPermMode!(sid, 'allow');
      await new Promise((r) => setTimeout(r, 120));
      ad.setPermMode!(sid, 'ask');
      await new Promise((r) => setTimeout(r, 5));
      assert.strictEqual(last(events, sid)?.state, 'unknown', `(b) ${late}: Ask first while the lowering is out: unknown, never a confirmed on`);
      assert.strictEqual(updates(fake, sid).length, 2, `(b) ${late}: the floor waits for the lowering's answer`);
      const sending = ad.send(sid, { text: 'x' });
      await sending;
      assert.strictEqual(sends(fake, sid), 0, `(b) ${late}: the send is held`);
      if (late === 'resolve') fs0.deferred.shift()!.resolve(); else fs0.deferred.shift()!.reject(new Error('late refusal'));
      await new Promise((r) => setTimeout(r, 10));
      const u = updates(fake, sid);
      assert.strictEqual(u.length, 3, `(b) ${late}: the floor is sent again after the late answer`);
      assert.deepStrictEqual([(u[2].sandboxConfig as { enabled: boolean }).enabled, u[2].sandboxConfigSource], [true, 'session_flag']);
      assert.strictEqual(last(events, sid)?.state, 'on', `(b) ${late}: on only after the floor went out last`);
      await ad.send(sid, { text: 'y' });
      assert.strictEqual(sends(fake, sid), 1, `(b) ${late}: sends go out again`);
      await ad.dispose();
    }
  }

  // ---- review on PR #833, item 2: the order. Allow all, then Ask first at once, with a slow lowering inside the limit: lower, then the floor;
  // a send waits for both; on at the end ----
  {
    const { ad, fake, events } = make();
    const sid = await start(ad, 'ask');
    const fs0 = fake.sessions.get(sid)!;
    fs0.lowerDeferred = true;
    ad.setPermMode!(sid, 'allow');
    ad.setPermMode!(sid, 'ask');
    const sending = ad.send(sid, { text: 'x' });
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(updates(fake, sid).length, 2, 'the floor waits for the lowering');
    assert.strictEqual(sends(fake, sid), 0, 'the send waits too');
    fs0.deferred.shift()!.resolve(); // within the 50 ms limit
    await sending;
    const seq = fs0.calls.filter((c) => c.name === 'send' || (c.name === 'options.update' && (c.args[0] as { sandboxConfig?: unknown }).sandboxConfig)).map((c) => (c.name === 'send' ? 'send' : (c.args[0] as { sandboxConfig: { enabled: boolean } }).sandboxConfig.enabled ? 'floor' : 'lower'));
    assert.deepStrictEqual(seq, ['floor', 'lower', 'floor', 'send'], 'start floor, lower, the floor again, then the send');
    assert.strictEqual(last(events, sid)?.state, 'on');
    await ad.dispose();
  }

  // ---- review on PR #833, item 2: sandboxSeq. A lowering that resolves after a later change (here the direct re-apply a sign-in refresh does)
  // does not overwrite that change's state: the floor is off now, so the current mode runs again ----
  {
    const { ad, fake, events } = make();
    const sid = await start(ad, 'ask');
    const fs0 = fake.sessions.get(sid)!;
    fs0.lowerDeferred = true;
    ad.setPermMode!(sid, 'allow');
    await new Promise((r) => setTimeout(r, 5));
    const live = (ad as unknown as { sessions: Map<string, { broker: { setMode(m: string): void } }> }).sessions.get(sid)!;
    live.broker.setMode('ask');
    await (ad as unknown as { applySandbox(s: string, l: unknown, m: string): Promise<void> }).applySandbox(sid, live, 'ask');
    assert.strictEqual(last(events, sid)?.state, 'on', 'the later change: on');
    fs0.deferred.shift()!.resolve();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(last(events, sid)?.state, 'on', 'the stale lowering did not overwrite it with null');
    assert.strictEqual(updates(fake, sid).length, 4, 'and the floor was sent again after it');
    await ad.dispose();
  }

  // ---- review on PR #833, item 3: a refused narrowing (state off) of a session that still holds an earlier floor says heldFloor, and the
  // switch to Allow all lowers it; a session that never had a floor says nothing ----
  {
    const { ad, fake, events } = make();
    const sid = await start(ad, 'read-only');
    fake.sessions.get(sid)!.updateFail = 'no';
    ad.setPermMode!(sid, 'ask');
    await new Promise((r) => setTimeout(r, 5));
    assert.deepStrictEqual([last(events, sid)?.state, last(events, sid)?.heldFloor], ['off', true], 'off, floor held from Read-only');
    fake.sessions.get(sid)!.updateFail = '';
    ad.setPermMode!(sid, 'allow');
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(updates(fake, sid)[2]?.sandboxConfigSource, 'session_disabled', 'and the switch lowers it');
    assert.strictEqual(last(events, sid), null);
    const off = make({ prep: (c) => { c.sandboxHost = { supported: false, reason: 'no bwrap', capabilities: [] }; } });
    const s2 = await start(off.ad, 'ask');
    assert.strictEqual(last(off.events, s2)?.heldFloor, undefined, 'no floor ever: no heldFloor');
    await ad.dispose();
    await off.ad.dispose();
  }

  // ---- T072 (FR-022c): a managed floor is never lowered (a policy conflict); its state stays ----
  {
    const { ad, fake, events } = make();
    const sid = await start(ad, 'ask');
    const live = (ad as unknown as { sessions: Map<string, { sandbox?: Record<string, unknown> }> }).sessions.get(sid)!;
    live.sandbox = { ...live.sandbox, managed: true }; // the adapter has no managed source today; the guard is what is pinned
    const before = JSON.stringify(live.sandbox);
    const n = sbx(events, sid).length;
    ad.setPermMode!(sid, 'allow');
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(updates(fake, sid).length, 1, 'managed: no lowering sent');
    assert.strictEqual(JSON.stringify(live.sandbox), before, 'managed: the state is kept');
    assert.strictEqual(sbx(events, sid).length, n, 'managed: no new state event');
    await ad.dispose();
  }

  // ---- T072 AC1: allowBypass is never sent, and never named in src/ outside a comment; no other vendor opt-out route ----
  {
    const srcRoot = path.join(__dirname, '..', '..', 'src');
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|js)$/.test(e.name) ? [path.join(d, e.name)] : []));
    const files = walk(srcRoot);
    assert.ok(files.length > 50, 'the source files are found');
    for (const f of files) {
      fs.readFileSync(f, 'utf8').replace(/\r/g, '').split('\n').forEach((line, i) => {
        const at = line.indexOf('allowBypass');
        if (at < 0) return;
        const before = line.slice(0, at);
        assert.ok(/^\s*(\*|\/\/|\/\*)/.test(line) || before.includes('//'), `${path.relative(srcRoot, f)}:${i + 1}: allowBypass outside a comment`);
      });
      const code = fs.readFileSync(f, 'utf8');
      assert.ok(!/disableForSession\s*\(/.test(code), `${path.relative(srcRoot, f)}: no sandbox.disableForSession call`);
    }
    const cop = fs.readFileSync(path.join(srcRoot, 'adapters', 'copilot.ts'), 'utf8');
    assert.strictEqual((cop.match(/session_disabled/g) ?? []).length, 1, 'one lowering call site');
    assert.match(cop, /options\.update\(\{ sandboxConfig: \{ enabled: false \}, sandboxConfigSource: 'session_disabled' \}\)/, 'the proven payload, literally');
  }

  // ---- T069 (FR-022, FR-022b; issue #806): Restart without the sandbox through the existing Restart session op ----
  {
    const { mcpRestartSessionOp } = await import('../src/main/mcpsession');
    const { startOptionsOf } = await import('../src/main/startopts');
    const { ad, fake, events } = make();
    const sid = await start(ad, 'read-only');
    fake.sessions.get(sid)!.updateFail = 'refused'; // FR-022c's lowering refused: the B fallback
    ad.setPermMode!(sid, 'allow');
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(updates(fake, sid).length, 2, 'AC1: the Read-only floor, then the refused lowering');
    assert.strictEqual(last(events, sid)?.untilNewSession, true, 'AC1: the floor is kept until a new session');
    const info = { id: sid, name: 'Ana', cwd: WS, permMode: 'allow', model: 'auto' } as import('../src/shared/api').AgentInfo;
    // the op's resume is main's ensureLive with startOptionsFor: the agent's CURRENT mode goes as permissionMode
    const so = startOptionsOf(info, WS, 'auto', undefined);
    assert.strictEqual(so.permissionMode, 'allow', 'startOptionsFor carries the current mode into the restart');
    const calls: string[] = [];
    let resumeErr: Error | undefined;
    const d = {
      agents: new Map([[sid, info]]), router: { forAgent: () => ad }, busy: () => false,
      endSession: async (id: string) => { calls.push('end'); await ad.stop(id); },
      resume: async (a: typeof info) => { calls.push('resume'); if (resumeErr) throw resumeErr; await ad.start({ ...startOptionsOf(a, WS, 'auto', undefined), quiet: false, resumeSessionId: a.id }); },
      secrets: () => [],
    };
    const r = await mcpRestartSessionOp(d as never, new Set(), sid, true, 'sandbox');
    assert.deepStrictEqual(r, { ok: true });
    assert.deepStrictEqual(calls, ['end', 'resume'], 'End session, then the same id through the resume path');
    assert.ok(ad.isLive(sid), 'the same session id is live again');
    assert.strictEqual(updates(fake, sid).length, 0, 'AC1: the resumed session got no sandboxConfig update (the Allow all app default)');
    assert.strictEqual(last(events, sid), null, 'AC1: the state is null (no word, no action)');
    assert.strictEqual(sends(fake, sid), 0, 'nothing was sent by the restart');
    await ad.send(sid, { text: 'next' });
    assert.strictEqual(sends(fake, sid), 1, 'AC1: the first send is not held');
    // AC2: a resume that fails leaves the agent ended with the error; a sign-in error is marked; nothing was sent
    for (const [err, kind] of [[new Error('Failed to authenticate. API Error: 401 OAuth access token is invalid.'), 'auth'], [new Error('cannot resume'), undefined]] as const) {
      ad.setPermMode!(sid, 'allow');
      resumeErr = err;
      calls.length = 0;
      const x = await mcpRestartSessionOp(d as never, new Set(), sid, true, 'sandbox');
      assert.deepStrictEqual([x.ok, x.ended, x.errorKind], [false, true, kind], `AC2: ${err.message}`);
      assert.ok(!ad.isLive(sid), 'AC2: the agent stays ended');
      resumeErr = undefined;
      fake.onDisk.add(sid);
      await ad.start({ workspace: WS, quiet: true, permissionMode: 'allow', resumeSessionId: sid });
      assert.strictEqual(sends(fake, sid), 0, 'AC2: nothing was sent');
    }
    // AC3: waiting requests at the restart are denied, none approved (End session stops the broker)
    const ask = await start(ad, 'ask');
    const info2 = { ...info, id: ask, permMode: 'ask' } as typeof info;
    const decide = fake.sessions.get(ask)!.config.onPermissionRequest as (r: unknown) => Promise<{ kind: string; feedback?: string }>;
    const p1 = decide({ kind: 'shell', fullCommandText: 'npm install', toolCallId: 'w1' });
    const p2 = decide({ kind: 'url', url: 'https://example.com', toolCallId: 'w2' });
    await new Promise((res) => setTimeout(res, 20));
    const d2 = { ...d, agents: new Map([[ask, info2]]), endSession: async (id: string) => { await ad.stop(id); }, resume: async (a: typeof info) => { await ad.start({ ...startOptionsOf(a, WS, 'auto', undefined), resumeSessionId: a.id }); } };
    assert.deepStrictEqual(await mcpRestartSessionOp(d2 as never, new Set(), ask, true, 'sandbox'), { ok: true });
    for (const res of await Promise.all([p1, p2])) assert.strictEqual(res.kind, 'reject', `AC3: denied, not approved: ${JSON.stringify(res)}`);
    await ad.dispose();
  }

  // ---- review on PR 823 (question 1): End session ends a kept floor too: the state is null, not "until a new session" on an ended agent ----
  {
    const { ad, fake, events } = make();
    const sid = await start(ad, 'read-only');
    fake.sessions.get(sid)!.updateFail = 'refused'; // FR-022c's lowering refused: the floor is kept
    ad.setPermMode!(sid, 'allow');
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(last(events, sid)?.untilNewSession, true, 'before: the kept floor');
    const n = events.length;
    await ad.stop(sid);
    const after = events.slice(n).filter((e) => e.sessionId === sid).map((e) => e.type === 'sandbox' ? 'sandbox:' + JSON.stringify(e.sandbox) : e.type === 'status' ? 'status:' + e.status : e.type);
    assert.deepStrictEqual(after.filter((x) => x.startsWith('sandbox') || x === 'status:stopped'), ['sandbox:null', 'status:stopped'], 'End session: the kept floor is cleared before the stop: ' + JSON.stringify(after));
    assert.strictEqual(updates(fake, sid).length, 2, 'nothing sent to the runtime for it (the floor and the refused lowering only)');
    // a Read-only session that ends keeps its state as before (no kept floor to clear)
    const ro = await start(ad, 'read-only');
    const m = events.length;
    await ad.stop(ro);
    assert.ok(!events.slice(m).some((e) => e.type === 'sandbox' && e.sessionId === ro), 'Read-only: no sandbox event at the end');
    await ad.dispose();
  }

  // ---- T069 AC4 (FR-022d): a sign-in refresh resumes Allow all without the floor; Ask first gets it again ----
  {
    class SbxRestarting extends RestartingFakeCopilot {
      constructor(prep: (c: FakeClient, n: number) => void = () => undefined) {
        super(prep);
        this.sandboxPlatform = 'linux';
        this.sandboxHome = () => '/home/me';
        this.sandboxPathDirs = () => ['/usr/bin'];
        this.sandboxRealpath = (p) => p;
        this.sandboxTimeoutMs = 50;
      }
    }
    const ad = new SbxRestarting();
    const events: AgentEvent[] = [];
    ad.onEvent((e) => events.push(e));
    const allow = await ad.start({ workspace: WS, quiet: true, permissionMode: 'read-only' });
    const ask = await ad.start({ workspace: WS, quiet: true, permissionMode: 'ask' });
    ad.clients[0].sessions.get(allow)!.updateFail = 'refused'; // FR-022c's lowering refused: the floor is kept
    ad.setPermMode!(allow, 'allow');
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(last(events, allow)?.untilNewSession, true, 'before: the kept floor');
    await ad.refreshAuth();
    assert.strictEqual(ad.clients.length, 2, 'a new runtime');
    const c2 = ad.clients[1];
    assert.strictEqual(updates(c2, allow).length, 0, 'AC4: Allow all after the refresh: no update (the resumed session has the app default)');
    assert.strictEqual(last(events, allow), null, 'AC4: and the state says so (no word, no action)');
    assert.strictEqual(updates(c2, ask).length, 1, 'AC4: Ask first after the refresh: the floor is sent again');
    assert.strictEqual(last(events, ask)?.state, 'on');
    await ad.dispose();
    // a Durbar restart: a fresh adapter resuming the same id in Allow all reports null and sends nothing
    const m = make();
    m.fake.onDisk.add(allow);
    const again = await m.ad.start({ workspace: WS, quiet: true, permissionMode: 'allow', resumeSessionId: allow });
    assert.strictEqual(updates(m.fake, again).length, 0);
    assert.strictEqual(last(m.events, again), null, 'AC4: a fresh adapter resuming Allow all: null');
    await m.ad.dispose();
    // review on PR 823: a session the refresh cannot resume is dropped, and its kept floor ends with it (dropAfterReconnect)
    let dropId = '';
    const ad3 = new SbxRestarting((c, n) => { if (n === 1) c.resumeFail.add(dropId); });
    const ev3: AgentEvent[] = [];
    ad3.onEvent((e) => ev3.push(e));
    dropId = await ad3.start({ workspace: WS, quiet: true, permissionMode: 'read-only' });
    ad3.clients[0].sessions.get(dropId)!.updateFail = 'refused';
    ad3.setPermMode!(dropId, 'allow');
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(last(ev3, dropId)?.untilNewSession, true, 'before: the kept floor');
    const k = ev3.length;
    await ad3.refreshAuth();
    assert.ok(!ad3.isLive(dropId), 'the refresh could not resume it: dropped');
    const seq = ev3.slice(k).filter((e) => e.sessionId === dropId && (e.type === 'sandbox' || (e.type === 'status' && e.status === 'stopped'))).map((e) => e.type === 'sandbox' ? 'sandbox:' + JSON.stringify(e.sandbox) : 'status:stopped');
    assert.deepStrictEqual(seq, ['sandbox:null', 'status:stopped'], 'a dropped session: the kept floor is cleared, then it stops: ' + JSON.stringify(seq));
    await ad3.dispose();
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

  // ---- FR-021a (K15): a shell request in Ask first with the floor on carries the card's own sandbox line; nothing else does ----
  {
    const NOTE = 'If you approve, Copilot’s sandbox may still let this write outside the folder (seen on Linux, 2026-10-25).';
    type Decide = (r: unknown) => Promise<{ kind: string }>;
    const pendingOf = (ev: AgentEvent[], sid: string, id: string) => ev.map((e) => (e.type === 'status' && e.sessionId === sid ? e.permission : undefined)).find((p) => p?.requestId === id && p.state === 'pending');
    const ask = async (m: ReturnType<typeof make>, sid: string, req: Record<string, unknown>) => {
      const r = (m.fake.sessions.get(sid)!.config.onPermissionRequest as Decide)(req);
      await new Promise((res) => setTimeout(res, 20));
      const p = pendingOf(m.events, sid, String(req.toolCallId));
      assert.ok(p, `${String(req.toolCallId)}: a pending card`);
      m.ad.resolvePermission(sid, String(req.toolCallId), false);
      await r;
      return p;
    };
    const m = make();
    const sid = await start(m.ad, 'ask');
    assert.strictEqual(last(m.events, sid)?.approvedMayLeave, true, 'Ask first, on: the state says an approved command may leave');
    const shellReq = { kind: 'shell', fullCommandText: 'touch /elsewhere/x', toolCallId: 'k15-shell' };
    assert.strictEqual((await ask(m, sid, shellReq))?.sandboxNote, NOTE, 'shell: the line is on the card');
    assert.ok(!('sandboxNote' in shellReq), "the runtime's request object is not changed");
    assert.strictEqual((await ask(m, sid, { kind: 'write', fileName: path.join(WS, 'a.txt'), toolCallId: 'k15-write' }))?.sandboxNote, undefined, 'a file edit (Durbar checks it, not the sandbox): no line');
    await m.ad.dispose();
    const off = make({ prep: (c) => { c.sandboxHost = { supported: false, reason: 'no bwrap', capabilities: [] }; } });
    const s2 = await start(off.ad, 'ask');
    assert.strictEqual(last(off.events, s2)?.state, 'off');
    assert.strictEqual((await ask(off, s2, { kind: 'shell', fullCommandText: 'ls', toolCallId: 'k15-off' }))?.sandboxNote, undefined, 'no sandbox in force: no sandbox line');
    await off.ad.dispose();
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
