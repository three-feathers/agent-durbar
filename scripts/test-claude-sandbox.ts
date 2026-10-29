/**
 * Spec 087 T020: Claude Code's OS sandbox floor in the adapter, over the real CLI transport and a scripted fake `claude` child. Host
 * facts are injected (no probe, no real CLI); no account, no credits. Part of `npm run test:runtime`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeAdapter, claudeArgs } from '../src/adapters/claude';
import { CLAUDE_SANDBOX_VERIFIED, claudeSandboxState, claudeSandboxVerified } from '../src/adapters/claudeSandbox';
import type { ClaudeSandboxFacts } from '../src/adapters/claudeSandbox';
import { createCliTransport } from '../src/adapters/claudeTransport';
import { eventProblems } from '../src/adapters/eventguard';
import type { AgentEvent, StartOptions } from '../src/adapters/types';
import { FakeClaudeChild, fakeSpawn } from './fakes/claude-cli';
import { HOME_SECRETS } from '../src/adapters/sandboxRoots';
const SECRETS = HOME_SECRETS.map((x) => '~/' + x);

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, f: () => T | undefined | false, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined && v !== false) return v as T;
    if (Date.now() > end) throw new assert.AssertionError({ message: `timed out waiting for ${what}` });
    await tick(2);
  }
}
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-claude-sbx-'));
const REAL_WS = fs.realpathSync.native(WS);
const LINUX: ClaudeSandboxFacts = { platform: 'linux', version: '2.1.312', haveBwrap: true, haveSocat: true };
const SANDBOX_ERR = 'Error: sandbox is not available on this system (bubblewrap: setting up uid map: Permission denied); failIfUnavailable is set\n';

type Behave = 'ok' | 'sandbox-exit-init' | 'sandbox-exit-turn' | 'crash-before-init';
function scripted(behave: () => Behave) {
  return (c: FakeClaudeChild): void => {
    const b = behave();
    c.onWrite = (o) => {
      const sub = o.type === 'control_request' ? (o.request as { subtype: string }).subtype : undefined;
      if (sub === 'initialize') {
        if (b === 'sandbox-exit-init') return void setTimeout(() => { c.err(SANDBOX_ERR); c.exit(1, null); }, 0);
        setTimeout(() => c.send({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response: {} } }), 0);
      } else if (o.type === 'user') {
        if (b === 'sandbox-exit-turn') return void setTimeout(() => { c.err(SANDBOX_ERR); c.exit(1, null); }, 0);
        if (b === 'crash-before-init') return void setTimeout(() => { c.err('Error: something unrelated went wrong\n'); c.exit(1, null); }, 0);
        setTimeout(() => {
          c.send({ type: 'system', subtype: 'init', session_id: 'x', cwd: WS, model: 'm', permissionMode: 'default', tools: [], mcp_servers: [] });
          c.send({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } });
        }, 0);
      }
    };
  };
}

function make(o: { facts?: () => ClaudeSandboxFacts; behave?: () => Behave; exists?: (id: string) => boolean; home?: string; realpath?: (p: string) => string } = {}) {
  const sp = fakeSpawn();
  let behave: () => Behave = o.behave ?? (() => 'ok');
  sp.next = scripted(() => behave());
  let factCalls = 0;
  const ad = new ClaudeAdapter({
    claudePath: async () => '/usr/local/bin/claude',
    makeTransport: (x) => createCliTransport({ file: x.file, args: claudeArgs(x.launch), cwd: x.cwd, env: x.env, handlers: x.handlers, spawn: sp.spawn, closeGraceMs: 10, killGraceMs: 10 }),
    sessionExists: o.exists ?? (() => false),
    claudeMd: () => undefined,
    env: () => ({ PATH: '/usr/bin' }),
    sandboxFacts: async () => {
      factCalls++;
      return (o.facts ?? (() => LINUX))();
    },
    realpath: o.realpath ?? ((p) => p),
    home: o.home ?? '/nonexistent-home-087',
  });
  const events: AgentEvent[] = [];
  ad.onEvent((e) => {
    const bad = eventProblems(e);
    assert.deepStrictEqual(bad, [], `event shape: ${JSON.stringify(e)}`);
    events.push(e);
  });
  return { ad, sp, events, setBehave: (b: () => Behave) => (behave = b), factCalls: () => factCalls };
}
const at = (a: string[], f: string): string | undefined => (a.includes(f) ? a[a.indexOf(f) + 1] : undefined);
const settingsOf = (a: string[]): Record<string, unknown> | undefined => (at(a, '--settings') ? (JSON.parse(at(a, '--settings') as string) as Record<string, unknown>) : undefined);
const sandboxOf = (a: string[]): Record<string, unknown> | undefined => settingsOf(a)?.sandbox as Record<string, unknown> | undefined;
const sbx = (ev: AgentEvent[], sid: string) => ev.filter((e): e is Extract<AgentEvent, { type: 'sandbox' }> => e.type === 'sandbox' && e.sessionId === sid);
const lastState = (ev: AgentEvent[], sid: string) => sbx(ev, sid).pop()?.sandbox;
const usersWritten = (sp: ReturnType<typeof fakeSpawn>): number => sp.children.reduce((n, c) => n + c.objects().filter((x) => x.type === 'user').length, 0);
const start = (ad: ClaudeAdapter, mode: StartOptions['permissionMode'], extra: Partial<StartOptions> = {}) => ad.start({ workspace: WS, quiet: true, permissionMode: mode, ...extra });

async function main(): Promise<void> {
  // ---- AC1: the `sandbox` key of --settings is exactly Durbar's block in Read-only and Ask first; none in Allow all; folder setup kept ----
  {
    const folderSetup = { hooks: [], rules: { allow: ['Bash(npm test:*)'], deny: [], ask: [] } };
    for (const mode of ['read-only', 'ask', 'allow'] as const) {
      const { ad, sp, events } = make();
      const sid = await start(ad, mode, { folderSetup } as Partial<StartOptions>);
      await ad.send(sid, { text: 'hi' });
      await until('init', () => events.some((e) => e.type === 'status' && e.sessionId === sid && (e as { status: string }).status === 'idle'));
      const args = sp.calls[0].args;
      const settings = settingsOf(args) ?? {};
      if (mode === 'allow') {
        assert.ok(!('sandbox' in settings), 'Allow all: no sandbox key (the app default)');
        assert.strictEqual(lastState(events, sid), null, 'Allow all: nothing to show');
      } else {
        const want: Record<string, unknown> = {
          enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false, excludedCommands: [],
          filesystem: { denyRead: ['~/', ...SECRETS], allowRead: [WS], denyWrite: [...(mode === 'ask' ? [] : [WS]), ...SECRETS] },
          network: { allowedDomains: [], strictAllowlist: true },
        };
        assert.deepStrictEqual(settings.sandbox, want, `${mode}: the sandbox key is exactly Durbar's block`);
        assert.strictEqual(lastState(events, sid)?.state, 'on', `${mode}: on after init`);
        const states = sbx(events, sid).map((e) => e.sandbox?.state);
        assert.ok(states.indexOf('unknown') >= 0 && states.indexOf('unknown') < states.indexOf('on'), `${mode}: unknown (checking) before on`);
        // T060 (spec 087, 2026-10-25) recorded Linux Read-only only: Ask first keeps "not verified" until a run covers it
        assert.strictEqual(lastState(events, sid)?.verified, mode === 'read-only', `${mode} on Linux: verified only in Read-only`);
        assert.strictEqual(claudeSandboxState({ mode, facts: { ...LINUX, platform: 'darwin' }, started: true })?.verified, false, `${mode} on macOS: not verified until T061`);
      }
      if (mode === 'allow') {
        assert.deepStrictEqual(JSON.parse(JSON.stringify(CLAUDE_SANDBOX_VERIFIED)), { linux: ['read-only'] }, 'only Linux Read-only is recorded');
        assert.strictEqual(claudeSandboxVerified('linux', 'read-only'), true);
        for (const [p, m] of [['linux', 'ask'], ['linux', 'allow'], ['linux', 'bogus'], ['darwin', 'read-only'], ['win32', 'read-only'], ['__proto__', 'read-only'], ['toString', 'read-only']]) assert.strictEqual(claudeSandboxVerified(p, m), false, `${p} ${m}: not verified`);
      }
      assert.ok(JSON.stringify(settings).includes('npm test'), `${mode}: the folder-setup part of the JSON is kept`);
      await ad.dispose();
    }
    void REAL_WS;
  }

  // ---- no `on` without init: a launch whose init never came stays unknown ----
  {
    const { ad, sp, events } = make();
    sp.next = (c) => { c.onWrite = (o) => { if (o.type === 'control_request') setTimeout(() => c.send({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response: {} } }), 0); }; };
    const sid = await start(ad, 'read-only');
    await ad.send(sid, { text: 'hi' });
    await until('user written', () => usersWritten(sp) === 1);
    await tick(20);
    assert.strictEqual(lastState(events, sid)?.state, 'unknown', 'no init: never on');
    await ad.dispose();
  }

  // ---- AC2 + AC3: a sandbox exit before init: nothing re-sent, no relaunch until Continue, then one relaunch with the same argv minus the key ----
  for (const when of ['sandbox-exit-init', 'sandbox-exit-turn'] as const) {
    const m = make({ behave: () => when });
    const sid = await start(m.ad, 'ask');
    await m.ad.send(sid, { text: 'please run the tests' });
    const note = await until('notice', () => sbx(m.events, sid).find((e) => e.notice));
    assert.match(note.notice!.text, /could not start its OS sandbox/);
    assert.match(note.notice!.text, /Nothing was sent\.$/);
    assert.deepStrictEqual(note.notice!.actions, ['continue'], 'Linux: Continue only (a fixable cause), never Always');
    assert.strictEqual(note.sandbox?.state, 'off');
    assert.ok(!m.events.some((e) => e.type === 'status' && e.sessionId === sid && (e as { status: string }).status === 'error'), `${when}: not shown as a crash`);
    const usersAtExit = usersWritten(m.sp);
    await tick(30);
    assert.strictEqual(m.sp.calls.length, 1, `${when}: no relaunch before the person chooses`);
    assert.strictEqual(usersWritten(m.sp), usersAtExit, `${when}: no prompt written after the exit`);
    // the person sends again WITHOUT choosing: the sandbox is tried again (never without it)
    await m.ad.send(sid, { text: 'again' });
    await until('second notice', () => sbx(m.events, sid).filter((e) => e.notice).length === 2);
    assert.ok(sandboxOf(m.sp.calls[1].args), 'a new try keeps the sandbox key');
    // Continue: nothing is sent by it; the next send relaunches exactly once without the key
    m.setBehave(() => 'ok');
    await m.ad.continueWithoutSandbox!(sid);
    assert.strictEqual(lastState(m.events, sid)?.state, 'off');
    assert.match(String(lastState(m.events, sid)?.reason), /continue without the OS sandbox/);
    const before = m.sp.calls.length;
    const usersBefore = usersWritten(m.sp);
    await tick(20);
    assert.strictEqual(m.sp.calls.length, before, 'Continue alone launches nothing');
    assert.strictEqual(usersWritten(m.sp), usersBefore, 'Continue re-sends nothing');
    await m.ad.send(sid, { text: 'now run them' });
    const idles = (): number => m.events.filter((e) => e.type === 'status' && e.sessionId === sid && (e as { status: string }).status === 'idle' && !(e as { intent?: string }).intent).length;
    const idle0 = idles();
    await until('turn after continue', () => m.sp.calls.length === before + 1 && usersWritten(m.sp) === usersBefore + 1 && idles() > idle0);
    const first = m.sp.calls[0].args;
    const after = m.sp.calls[before].args;
    // the argv with the `sandbox` key taken out of --settings (and --settings dropped when nothing else is in it)
    const strip = (a: string[]): string[] => {
      const i = a.indexOf('--settings');
      if (i < 0) return a;
      const { sandbox: _s, ...rest } = JSON.parse(a[i + 1]) as Record<string, unknown>;
      void _s;
      return Object.keys(rest).length ? [...a.slice(0, i + 1), JSON.stringify(rest), ...a.slice(i + 2)] : [...a.slice(0, i), ...a.slice(i + 2)];
    };
    assert.ok(!sandboxOf(after), 'Continue: no sandbox key');
    assert.deepStrictEqual(strip(after), strip(first), 'the same argv minus the sandbox key (mode, tool lists, prompt tool, session id)');
    assert.strictEqual(at(after, '--permission-mode'), 'default');
    assert.strictEqual(at(after, '--permission-prompt-tool'), 'stdio');
    assert.strictEqual(at(after, '--session-id'), sid, 'the same --session-id (Claude never wrote the session)');
    // FR-007b: a mode switch (relaunch) and a resume in the same run do not try again
    m.ad.setPermMode!(sid, 'read-only');
    await m.ad.send(sid, { text: 'read only now' });
    await until('relaunch for mode', () => m.sp.calls.length === before + 2);
    assert.ok(!sandboxOf(m.sp.calls[before + 1].args), 'mode-switch relaunch: no sandbox key again');
    assert.strictEqual(at(m.sp.calls[before + 1].args, '--resume'), sid, 'the relaunch resumes the same session');
    await m.ad.stop(sid);
    const again = await m.ad.start({ workspace: WS, quiet: true, permissionMode: 'ask', resumeSessionId: sid });
    await m.ad.send(again, { text: 'resumed' });
    await until('resume launch', () => m.sp.calls.length === before + 3);
    assert.ok(!sandboxOf(m.sp.calls[before + 2].args), 'a resume in the same run: no sandbox key');
    // FR-007b reset: a NEW session in the same folder tries again
    const fresh = await start(m.ad, 'ask');
    await m.ad.send(fresh, { text: 'new session' });
    await until('new session launch', () => m.sp.calls.length === before + 4);
    assert.ok(sandboxOf(m.sp.calls[before + 3].args), 'a new session carries the sandbox key again');
    await m.ad.dispose();
  }

  // ---- AC8: a restart of Durbar (fresh adapter) resuming the same id tries again and shows the note exactly once ----
  {
    const sid = '11111111-2222-3333-4444-555555555555';
    const m1 = make({ behave: () => 'sandbox-exit-init', exists: () => true });
    await m1.ad.start({ workspace: WS, quiet: true, permissionMode: 'read-only', resumeSessionId: sid });
    await m1.ad.send(sid, { text: 'x' });
    await until('note 1', () => sbx(m1.events, sid).find((e) => e.notice));
    await m1.ad.continueWithoutSandbox!(sid);
    await m1.ad.dispose();
    const m2 = make({ behave: () => 'sandbox-exit-init', exists: () => true });
    await m2.ad.start({ workspace: WS, quiet: true, permissionMode: 'read-only', resumeSessionId: sid });
    await m2.ad.send(sid, { text: 'y' });
    await until('note after restart', () => sbx(m2.events, sid).find((e) => e.notice));
    assert.ok(sandboxOf(m2.sp.calls[0].args), 'after a restart the sandbox is tried again');
    assert.strictEqual(at(m2.sp.calls[0].args, '--resume'), sid);
    await tick(20);
    assert.strictEqual(sbx(m2.events, sid).filter((e) => e.notice).length, 1, 'the note exactly once');
    await m2.ad.dispose();
  }

  // ---- AC2 (policy): requireOsSandbox: a sandbox exit is refused, no Continue; Continue itself refuses (FR-007d) ----
  {
    const m = make({ behave: () => 'sandbox-exit-turn' });
    const sid = await start(m.ad, 'read-only', { requireOsSandbox: true });
    await m.ad.send(sid, { text: 'x' });
    const n = await until('refusal', () => sbx(m.events, sid).find((e) => e.notice));
    assert.strictEqual(n.notice!.refused, true);
    assert.deepStrictEqual(n.notice!.actions, [], 'no Continue under the policy');
    assert.match(n.notice!.text, /Read-only and Ask first need/, "the existing MODE_REFUSAL text, so Change mode… is offered");
    await assert.rejects(m.ad.continueWithoutSandbox!(sid), /organization requires/);
    await m.ad.dispose();
  }

  // ---- AC4: an unclassified exit before init takes the crash path; the state stays unknown; no notice, no relaunch ----
  {
    const m = make({ behave: () => 'crash-before-init' });
    const sid = await start(m.ad, 'ask');
    await m.ad.send(sid, { text: 'x' });
    const err = await until('crash text', () => m.events.find((e) => e.type === 'status' && e.sessionId === sid && (e as { status: string }).status === 'error')) as { intent?: string };
    assert.match(String(err.intent), /Send a message to resume/);
    assert.ok(!sbx(m.events, sid).some((e) => e.notice), 'no sandbox note for a crash');
    assert.strictEqual(lastState(m.events, sid)?.state, 'unknown', 'state stays unknown');
    await tick(20);
    assert.strictEqual(m.sp.calls.length, 1, 'no relaunch');
    await m.ad.dispose();
  }

  // ---- pre-checks (nothing spawned): too old, Linux without bwrap/socat, win32; AC5/AC6/AC7 for Always continue ----
  {
    const cases: Array<[ClaudeSandboxFacts, RegExp, string[]]> = [
      [{ platform: 'linux', version: '2.1.308', haveBwrap: true, haveSocat: true }, /too old/, ['continue']],
      [{ platform: 'linux', version: 'not a version', haveBwrap: true, haveSocat: true }, /too old/, ['continue']],
      [{ platform: 'linux', version: '2.1.312', haveBwrap: false, haveSocat: true }, /bubblewrap/, ['continue']],
      [{ platform: 'linux', version: '2.1.312', haveBwrap: true, haveSocat: false }, /socat/, ['continue']],
      [{ platform: 'win32', version: '2.1.312' }, /no OS sandbox on Windows; Durbar's own checks still apply/, ['continue', 'always']],
    ];
    for (const [facts, re, actions] of cases) {
      const m = make({ facts: () => facts });
      const sid = await start(m.ad, 'read-only');
      await m.ad.send(sid, { text: 'x' });
      const n = await until('pre-check note', () => sbx(m.events, sid).find((e) => e.notice));
      assert.match(n.notice!.text, re);
      assert.deepStrictEqual(n.notice!.actions, actions, `${facts.platform} ${facts.version}: actions`);
      assert.strictEqual(m.sp.calls.length, 0, 'nothing spawned');
      if (facts.platform !== 'win32') await assert.rejects(m.ad.continueWithoutSandbox!(sid, { always: true }), /not offered|offered only/, 'Always is refused for a fixable cause');
      await m.ad.dispose();
    }
    // policy + pre-check: the send itself is refused with the MODE_REFUSAL text (the existing refusal path), nothing spawned
    const m = make({ facts: () => ({ platform: 'win32', version: '2.1.312' }) });
    const sid = await start(m.ad, 'ask', { requireOsSandbox: true, sandboxAlwaysContinue: true });
    await assert.rejects(m.ad.send(sid, { text: 'x' }), /Read-only and Ask first need/, 'AC7: a stored Always is ignored under the policy');
    assert.strictEqual(m.sp.calls.length, 0);
    await m.ad.dispose();
    // AC5: win32 with Always stored: no note, state off (Not sandboxed), the pre-check still ran at this session start
    const w = make({ facts: () => ({ platform: 'win32', version: '2.1.312' }) });
    const before = w.factCalls();
    const ws = await start(w.ad, 'read-only', { sandboxAlwaysContinue: true });
    await w.ad.send(ws, { text: 'x' });
    await until('spawned', () => w.sp.calls.length === 1);
    assert.ok(w.factCalls() > before, 'the pre-check ran');
    assert.ok(!sbx(w.events, ws).some((e) => e.notice), 'no note with the stored choice');
    assert.strictEqual(lastState(w.events, ws)?.state, 'off');
    assert.ok(!sandboxOf(w.sp.calls[0].args), 'no sandbox key on win32');
    // undone in Settings: the next session (no stored choice) shows the note again
    const ws2 = await start(w.ad, 'read-only');
    await w.ad.send(ws2, { text: 'x' });
    await until('note back', () => sbx(w.events, ws2).find((e) => e.notice));
    await w.ad.continueWithoutSandbox!(ws2, { always: true }); // offered on win32: accepted
    await w.ad.dispose();
    // AC6: a stored choice and a host that is now sandbox-capable: the key is back and the state reaches on
    const fixed = make({ facts: () => LINUX });
    const fs2 = await start(fixed.ad, 'read-only', { sandboxAlwaysContinue: true });
    await fixed.ad.send(fs2, { text: 'x' });
    await until('on', () => lastState(fixed.events, fs2)?.state === 'on');
    assert.ok(sandboxOf(fixed.sp.calls[0].args), 'the stored choice never turns the attempt off');
    await fixed.ad.dispose();
  }

  // ---- FR-015: no usable root refuses (the roots rule drops a filesystem root) ----
  {
    const m = make();
    const sid = await m.ad.start({ workspace: '/', quiet: true, permissionMode: 'read-only' });
    await assert.rejects(m.ad.send(sid, { text: 'x' }), /Read-only and Ask first need/);
    assert.strictEqual(m.sp.calls.length, 0);
    await m.ad.dispose();
  }

  // ---- review on PR 733 (2): Continue with no note open is refused: a working floor is never switched off; Continue is one-shot ----
  {
    const m = make();
    const sid = await start(m.ad, 'read-only');
    await m.ad.send(sid, { text: 'x' });
    await until('on', () => lastState(m.events, sid)?.state === 'on');
    await assert.rejects(m.ad.continueWithoutSandbox!(sid), /no OS sandbox note/, 'no note: refused');
    m.ad.setPermMode!(sid, 'ask');
    await m.ad.send(sid, { text: 'y' });
    await until('relaunch', () => m.sp.calls.length === 2);
    assert.ok(sandboxOf(m.sp.calls[1].args), 'the floor stays after a refused Continue');
    await m.ad.dispose();
    const n = make({ behave: () => 'sandbox-exit-init' });
    const nid = await start(n.ad, 'read-only');
    await n.ad.send(nid, { text: 'x' });
    await until('note', () => sbx(n.events, nid).find((e) => e.notice));
    await n.ad.continueWithoutSandbox!(nid);
    await assert.rejects(n.ad.continueWithoutSandbox!(nid), /no OS sandbox note/, 'a second Continue is refused (one-shot)');
    await n.ad.dispose();
  }

  // ---- review round 3 on PR 733 (1, 5): the adapter passes its home folder (a linked ~/.ssh is denied at its target); a session whose
  // own folder is a credential folder is refused like FR-015 (nothing spawned, Change mode… text), never shown as Sandboxed ----
  {
    const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-087-home-')));
    const home = path.join(tmp, 'me');
    fs.mkdirSync(path.join(home, 'dot', 'ssh'), { recursive: true });
    fs.mkdirSync(path.join(home, 'proj'), { recursive: true });
    fs.symlinkSync(path.join(home, 'dot', 'ssh'), path.join(home, '.ssh'), 'dir');
    const real = (p: string): string => fs.realpathSync.native(p);
    const m = make({ home, realpath: real });
    const sid = await m.ad.start({ workspace: path.join(home, 'proj'), quiet: true, permissionMode: 'ask' });
    await m.ad.send(sid, { text: 'x' });
    await until('spawned', () => m.sp.calls.length === 1);
    const blk = sandboxOf(m.sp.calls[0].args) as { filesystem: { denyRead: string[]; denyWrite: string[] } };
    assert.ok(blk.filesystem.denyRead.includes(path.join(home, 'dot', 'ssh')) && blk.filesystem.denyWrite.includes(path.join(home, 'dot', 'ssh')), 'the adapter denies the real target of a linked ~/.ssh');
    await m.ad.dispose();
    // review round 4 (2): a SECOND session folder that is a credential folder is left out: not in allowRead, never an --add-dir, named
    fs.mkdirSync(path.join(home, '.aws'), { recursive: true });
    const wsFile = path.join(tmp, 'two.code-workspace');
    fs.writeFileSync(wsFile, JSON.stringify({ folders: [{ path: path.join(home, 'proj') }, { path: path.join(home, '.aws') }] }));
    const w = make({ home, realpath: real });
    const ws2 = await w.ad.start({ workspace: wsFile, quiet: true, permissionMode: 'ask' });
    await w.ad.send(ws2, { text: 'x' });
    await until('spawned', () => w.sp.calls.length === 1);
    const a2 = w.sp.calls[0].args;
    const addDirs = a2.map((x, i) => (a2[i - 1] === '--add-dir' ? x : '')).filter(Boolean);
    assert.ok(!addDirs.some((d) => d.includes('.aws')), 'the credential folder is not an --add-dir (no implicit write grant): ' + addDirs.join(','));
    assert.ok(!(sandboxOf(a2) as { filesystem: { allowRead: string[] } }).filesystem.allowRead.some((d) => d.includes('.aws')));
    await until('on', () => lastState(w.events, ws2)?.state === 'on');
    assert.ok((lastState(w.events, ws2)?.leftOut ?? []).some((x) => /\.aws \(credential folder\)$/.test(x)), 'the state names the folder it left out');
    await w.ad.dispose();
    // the same workspace in Allow all keeps both folders (no floor, nothing left out)
    const wa = make({ home, realpath: real });
    const wa2 = await wa.ad.start({ workspace: wsFile, quiet: true, permissionMode: 'allow' });
    await wa.ad.send(wa2, { text: 'x' });
    await until('spawned', () => wa.sp.calls.length === 1);
    assert.ok(wa.sp.calls[0].args.some((x) => x.includes('.aws')), 'Allow all: the folder stays an --add-dir');
    await wa.ad.dispose();
    // review round 5: an ALLOW-LIST: a second folder dropped for any reason (a filesystem root, a link to it, a quote, unresolvable) is
    // never an --add-dir and is named; Read-only -> Allow all passes the folders again (no floor)
    const quoted = path.join(tmp, 'it"s');
    // no folder is made: a quote drops the path before it is resolved (and Windows cannot make such a name)
    fs.symlinkSync(path.parse(tmp).root, path.join(tmp, 'to-root'), 'dir');
    const odd = [path.parse(tmp).root, quoted, path.join(tmp, 'missing'), path.join(tmp, 'to-root')];
    const wsOdd = path.join(tmp, 'odd.code-workspace');
    fs.writeFileSync(wsOdd, JSON.stringify({ folders: [{ path: path.join(home, 'proj') }, ...odd.map((p) => ({ path: p }))] }));
    const o = make({ home, realpath: real });
    const os1 = await o.ad.start({ workspace: wsOdd, quiet: true, permissionMode: 'read-only' });
    await o.ad.send(os1, { text: 'x' });
    await until('spawned', () => o.sp.calls.length === 1);
    const oa = o.sp.calls[0].args;
    assert.ok(!oa.includes('--add-dir'), 'none of the dropped folders is an --add-dir: ' + oa.filter((x, i) => oa[i - 1] === '--add-dir').join(','));
    await until('on', () => lastState(o.events, os1)?.state === 'on');
    const named = lastState(o.events, os1)?.leftOut ?? [];
    for (const p of odd) assert.ok(named.includes(`${p} (not usable)`), `named: ${p} in ${JSON.stringify(named)}`);
    assert.ok(String(lastState(o.events, os1)?.reason).length <= 200);
    o.ad.setPermMode!(os1, 'allow');
    await o.ad.send(os1, { text: 'y' });
    await until('relaunch', () => o.sp.calls.length === 2);
    const oa2 = o.sp.calls[1].args;
    assert.ok(oa2.filter((x, i) => oa2[i - 1] === '--add-dir').length === odd.length, 'Allow all: the folders are --add-dir again (no floor)');
    await o.ad.dispose();
    // review round 6 (3): an extra folder that is a link goes on as --add-dir in its RESOLVED form (the form the block holds)
    fs.mkdirSync(path.join(tmp, 'realextra'), { recursive: true });
    fs.symlinkSync(path.join(tmp, 'realextra'), path.join(tmp, 'linkextra'), 'dir');
    const wsLink = path.join(tmp, 'link.code-workspace');
    fs.writeFileSync(wsLink, JSON.stringify({ folders: [{ path: path.join(home, 'proj') }, { path: path.join(tmp, 'linkextra') }] }));
    const lk = make({ home, realpath: real });
    const ls1 = await lk.ad.start({ workspace: wsLink, quiet: true, permissionMode: 'ask' });
    await lk.ad.send(ls1, { text: 'x' });
    await until('spawned', () => lk.sp.calls.length === 1);
    const la = lk.sp.calls[0].args;
    assert.deepStrictEqual(la.filter((x, i) => la[i - 1] === '--add-dir'), [path.join(tmp, 'realextra')], 'the resolved path, never the link');
    await lk.ad.dispose();
    // round 5: the session's OWN folder unusable (a link to the filesystem root): refused, nothing spawned
    const wsRoot = path.join(tmp, 'rootfirst.code-workspace');
    fs.writeFileSync(wsRoot, JSON.stringify({ folders: [{ path: path.join(tmp, 'to-root') }, { path: path.join(home, 'proj') }] }));
    const rr = make({ home, realpath: real });
    const rs = await rr.ad.start({ workspace: wsRoot, quiet: true, permissionMode: 'ask' });
    await assert.rejects(rr.ad.send(rs, { text: 'x' }), /own folder.*Read-only and Ask first need/);
    assert.strictEqual(rr.sp.calls.length, 0);
    await rr.ad.dispose();
    const c = make({ home, realpath: real });
    const cs = await c.ad.start({ workspace: path.join(home, 'dot', 'ssh'), quiet: true, permissionMode: 'read-only' });
    await assert.rejects(c.ad.send(cs, { text: 'x' }), /credential folder or sits inside one \(for example ~\/\.ssh\).*Read-only and Ask first need/, 'its own folder is a credential folder: refused, in Claude\'s words (no "holds one")');
    assert.strictEqual(c.sp.calls.length, 0, 'nothing spawned');
    assert.notStrictEqual(lastState(c.events, cs)?.state, 'on', 'never shown as Sandboxed');
    await c.ad.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---- review round 2 on PR 733 (4): the ADAPTER's note closes when a new attempt starts (not only main's copy) ----
  {
    const m = make({ behave: () => 'sandbox-exit-init' });
    const sid = await start(m.ad, 'read-only');
    await m.ad.send(sid, { text: 'x' });
    await until('note', () => sbx(m.events, sid).find((e) => e.notice));
    m.setBehave(() => 'ok');
    await m.ad.send(sid, { text: 'try again' });
    await until('a new attempt reaches on', () => lastState(m.events, sid)?.state === 'on');
    await assert.rejects(m.ad.continueWithoutSandbox!(sid), /no OS sandbox note/, 'the note of the earlier attempt no longer answers');
    await m.ad.dispose();
  }

  // ---- review on PR 733 (3): Allow all on a live CLI, then Read-only: the relaunch carries the block and starts as checking ----
  {
    const m = make();
    const sid = await start(m.ad, 'allow');
    await m.ad.send(sid, { text: 'x' });
    await until('turn', () => m.events.some((e) => e.type === 'status' && e.sessionId === sid && (e as { status: string }).status === 'idle' && !(e as { intent?: string }).intent));
    assert.ok(!sandboxOf(m.sp.calls[0].args));
    const before = sbx(m.events, sid).length;
    m.ad.setPermMode!(sid, 'read-only');
    await m.ad.send(sid, { text: 'y' });
    await until('relaunch', () => m.sp.calls.length === 2);
    assert.ok(sandboxOf(m.sp.calls[1].args), 'the relaunch for Read-only carries the block');
    await until('on after init', () => lastState(m.events, sid)?.state === 'on');
    assert.deepStrictEqual(sbx(m.events, sid).slice(before).map((e) => e.sandbox?.state), ['unknown', 'on'], 'checking, then on');
    await m.ad.dispose();
  }

  // ---- review on PR 733 (6): a Continue from before the policy does not survive into a session under the policy (FR-007d) ----
  {
    const m = make({ behave: () => 'sandbox-exit-init', exists: () => true });
    const sid = await start(m.ad, 'read-only');
    await m.ad.send(sid, { text: 'x' });
    await until('note', () => sbx(m.events, sid).find((e) => e.notice));
    await m.ad.continueWithoutSandbox!(sid);
    await m.ad.stop(sid);
    m.setBehave(() => 'ok');
    await m.ad.start({ workspace: WS, quiet: true, permissionMode: 'read-only', resumeSessionId: sid, requireOsSandbox: true });
    await m.ad.send(sid, { text: 'y' });
    await until('second launch', () => m.sp.calls.length === 2);
    assert.ok(sandboxOf(m.sp.calls[1].args), 'under the policy the remembered Continue is ignored: the block is back');
    await m.ad.dispose();
  }

  // ---- review on PR 733 (6): a stored Always on a FIXABLE cause (Linux without bubblewrap) still shows the note; nothing is spawned ----
  {
    const m = make({ facts: () => ({ platform: 'linux', version: '2.1.312', haveBwrap: false, haveSocat: true }) });
    const sid = await start(m.ad, 'read-only', { sandboxAlwaysContinue: true });
    await m.ad.send(sid, { text: 'x' });
    await until('note', () => sbx(m.events, sid).find((e) => e.notice));
    assert.strictEqual(m.sp.calls.length, 0, 'the stored choice only applies where the host can never sandbox the app');
    await m.ad.dispose();
  }

  // ---- FR-012: the Settings line ----
  {
    assert.deepStrictEqual(await make().ad.sandboxHost!(), { available: true, mechanism: 'bubblewrap' });
    const w = await make({ facts: () => ({ platform: 'win32', version: '2.1.312' }) }).ad.sandboxHost!();
    assert.strictEqual(w.available, false);
    assert.match(String(w.reason), /Windows/);
  }
  fs.rmSync(WS, { recursive: true, force: true });
  done = true;
  console.log('claude sandbox (spec 087 T020): all checks passed');
}
// review on PR 733 (7): a run that stops early (a hang, an unawaited path) must not exit 0
let done = false;
process.on('exit', (code) => {
  if (!done && code === 0) {
    console.error('claude sandbox: the run ended before its last check');
    process.exitCode = 1;
  }
});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
