/**
 * Spec 054 Phase 1 (T001, T003, T004, T007): remote control. The URL allowlist, the Copilot adapter's `setRemote` against a FAKE session
 * (no runtime process, no Copilot account, nothing sent to GitHub) and the main-side IPC logic (`remoteops.ts`, without Electron).
 * What the real runtime does is NOT tested here (spec 054 T020).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { allowedRemoteUrl, cleanRemoteError } from '../src/shared/remote';
import { createRemoteOps, NO_REMOTE, NOT_IN_ALLOW_ALL, NOT_RUNNING } from '../src/main/remoteops';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';
import type { FakeSession } from './fakes/copilot-sdk';
import type { AgentAdapter } from '../src/adapters/types';
import type { RemoteState } from '../src/shared/remote';
import { REMOTE_NOT_STARTED } from '../src/adapters/copilot';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-remote-'));
const names = (s: FakeSession): string[] => s.calls.map((c) => c.name);

async function setup(): Promise<{ ad: FakeCopilot; fake: FakeClient; sid: string; s: FakeSession }> {
  const fake = new FakeClient();
  const ad = new FakeCopilot(fake);
  const sid = await ad.start({ workspace: dir, quiet: true });
  return { ad, fake, sid, s: fake.last };
}

async function main(): Promise<void> {
  // ---- T001 / FR-005: the allowlist
  assert.ok(allowedRemoteUrl('https://github.com/o/r/tasks/1'));
  assert.ok(allowedRemoteUrl('https://GitHub.com/o/r'), 'host is case-insensitive');
  for (const bad of [
    'http://github.com/o/r', // not https
    'https://gist.github.com/x', // subdomain
    'https://github.com.evil.example/x', // look-alike suffix
    'https://evilgithub.com/x',
    'https://user:pw@github.com/x', // user info
    'https://u@github.com/x',
    'https://github.com:8443/x', // port
    'javascript:alert(1)',
    'file:///etc/passwd',
    'github.com/o/r', // not absolute
    '',
    'https://github.com/' + 'a'.repeat(2050), // too long
  ]) assert.ok(!allowedRemoteUrl(bad), 'refused: ' + bad.slice(0, 60));
  for (const v of [undefined, null, 42, {}, ['https://github.com/x']]) assert.ok(!allowedRemoteUrl(v), 'non-strings are refused');

  assert.strictEqual(cleanRemoteError(new Error('bad\nthing\u0007 here')), 'bad thing here');
  assert.strictEqual(cleanRemoteError(undefined), 'Remote control failed.');
  assert.strictEqual(cleanRemoteError('x'.repeat(400)).length, 300);

  // ---- T003 / FR-002: the Copilot adapter
  {
    const { ad, fake, sid, s } = await setup();
    assert.strictEqual(ad.capabilities.remote, true);
    assert.strictEqual(typeof ad.setRemote, 'function');
    // never on by default: neither the create config nor the client sets remote
    assert.ok(!('remoteSession' in fake.created[0]), 'create never sets remoteSession');
    assert.ok(!names(s).some((n) => n.startsWith('remote.')), 'nothing remote is called on start');

    const on = await ad.setRemote(sid, true);
    assert.deepStrictEqual(on, { ok: true, on: true, steerable: true, url: 'https://github.com/o/r/tasks/1', visibility: 'unshared' });
    const en = s.calls.find((c) => c.name === 'remote.enable');
    assert.deepStrictEqual(en?.args[0], { mode: 'on' }, 'enable asks for export AND steering');
    assert.ok(names(s).includes('visibility.get'));

    const off = await ad.setRemote(sid, false);
    assert.deepStrictEqual(off, { ok: true, on: false });
    assert.ok(names(s).includes('remote.disable'));
    assert.ok(!names(s).includes('visibility.set'), 'Durbar never changes who can see the session');
  }
  {
    // the URL: shareUrl only as a fallback; a non-GitHub URL is dropped; visibility failures are ignored
    const { ad, sid, s } = await setup();
    s.remoteAnswer = { remoteSteerable: false };
    s.visibilityAnswer = { synced: true, status: 'repo', shareUrl: 'https://github.com/o/r/share/9' };
    assert.deepStrictEqual(await ad.setRemote(sid, true), { ok: true, on: true, steerable: false, url: 'https://github.com/o/r/share/9', visibility: 'repo' });
    s.remoteAnswer = { url: 'https://evil.example/phish', remoteSteerable: true };
    s.visibilityAnswer = { synced: false };
    assert.deepStrictEqual(await ad.setRemote(sid, true), { ok: true, on: true, steerable: true }, 'an unexpected host never leaves the adapter');
    s.remoteAnswer = undefined;
    s.visibilityFail = 'visibility boom';
    assert.deepStrictEqual(await ad.setRemote(sid, true), { ok: true, on: true, steerable: false });
    s.visibilityFail = '';
    s.visibilityAnswer = { synced: true, status: 'everyone' };
    s.remoteAnswer = { url: 'https://github.com/o/r/tasks/2', remoteSteerable: true };
    assert.deepStrictEqual(await ad.setRemote(sid, true), { ok: true, on: true, steerable: true, url: 'https://github.com/o/r/tasks/2' }, 'an unknown visibility value is dropped');
    s.rpc.visibility = undefined;
    assert.deepStrictEqual(await ad.setRemote(sid, true), { ok: true, on: true, steerable: true, url: 'https://github.com/o/r/tasks/2' }, 'no visibility group: still on');
  }
  {
    // T020 real answer: `started: false` with no error is not "on"; remote is switched off again and no visibility is read
    const { ad, sid, s } = await setup();
    s.remoteAnswer = { remoteSteerable: false, started: false };
    assert.deepStrictEqual(await ad.setRemote(sid, true), { ok: false, error: REMOTE_NOT_STARTED });
    assert.ok(names(s).includes('remote.disable'), 'switched off again');
    assert.ok(!names(s).includes('visibility.get'));
    s.remoteAnswer = { remoteSteerable: true, started: true, url: 'https://github.com/o/r/tasks/3' };
    assert.deepStrictEqual((await ad.setRemote(sid, true)).ok, true, 'started: true is on');
  }
  {
    // errors
    const { ad, sid, s } = await setup();
    s.remoteFail = 'Remote sessions require a GitHub repository.\nDetails: x';
    const r = await ad.setRemote(sid, true);
    assert.deepStrictEqual(r, { ok: false, error: 'Remote sessions require a GitHub repository. Details: x' });
    assert.ok(!names(s).includes('visibility.get'), 'no visibility read after a failed enable');
    const d = await ad.setRemote(sid, false);
    assert.strictEqual(d.ok, false);
    assert.deepStrictEqual(await ad.setRemote('no-such', true), { ok: false, error: 'This session is not running.' });
  }
  {
    // feature detection: an SDK without rpc.remote (or without the method) is refused with nothing called
    const { ad, sid, s } = await setup();
    s.rpc.remote = undefined;
    const before = s.calls.length;
    assert.deepStrictEqual(await ad.setRemote(sid, true), { ok: false, error: 'This Copilot version cannot be controlled from GitHub.' });
    assert.strictEqual(s.calls.length, before);
    s.rpc.remote = { enable: async () => ({}) };
    assert.deepStrictEqual(await ad.setRemote(sid, false), { ok: false, error: 'This Copilot version cannot be controlled from GitHub.' }, 'no disable: refused');
  }
  {
    // resume never sets remote either
    const fake = new FakeClient();
    const ad = new FakeCopilot(fake);
    fake.onDisk.add('old-1');
    await ad.start({ workspace: dir, resumeSessionId: 'old-1', quiet: true });
    assert.strictEqual(fake.resumed.length, 1);
    assert.ok(!('remoteSession' in fake.resumed[0].config), 'resume never sets remoteSession');
    await ad.dispose();
  }

  // ---- T004 / FR-003..FR-005: the main-side logic
  {
    const opened: string[] = [];
    let answer: RemoteState = { ok: true, on: true, url: 'https://github.com/o/r/tasks/1', steerable: true, visibility: 'repo' };
    let live = true;
    const ad = { capabilities: { remote: true }, isLive: () => live, setRemote: async () => answer } as unknown as AgentAdapter;
    const noRemote = { capabilities: {}, isLive: () => true } as unknown as AgentAdapter;
    const ops = createRemoteOps({ known: (id) => id === 'a1' || id === 'a2', adapterOf: (id) => (id === 'a1' ? ad : noRemote), open: async (u) => void opened.push(u) });

    for (const [id, on] of [[undefined, true], [42, true], ['nope', true], ['a1', 'yes'], ['a1', 1], ['x'.repeat(300), true]] as [unknown, unknown][])
      assert.deepStrictEqual(await ops.setRemote(id, on), { ok: false, error: 'unknown agent' }, 'invalid input refused: ' + String(id).slice(0, 20));
    assert.deepStrictEqual(await ops.setRemote('a2', true), { ok: false, error: NO_REMOTE });
    live = false;
    assert.deepStrictEqual(await ops.setRemote('a1', true), { ok: false, error: NOT_RUNNING });
    live = true;

    assert.deepStrictEqual(await ops.openRemote('a1'), { ok: false }, 'nothing stored yet: nothing opens');
    assert.deepStrictEqual(await ops.setRemote('a1', true), answer);
    assert.ok(ops.has('a1'));
    assert.deepStrictEqual(await ops.openRemote('a1'), { ok: true });
    assert.deepStrictEqual(opened, ['https://github.com/o/r/tasks/1']);
    assert.deepStrictEqual(await ops.openRemote('a2'), { ok: false });
    assert.deepStrictEqual(await ops.openRemote({ toString: () => 'a1' }), { ok: false }, 'only a string id');

    // a misbehaving adapter cannot get a foreign URL or extra fields to the window or the browser
    answer = { ok: true, on: true, url: 'https://evil.example/x', steerable: true, visibility: 'public' as never, extra: 'x' } as RemoteState;
    assert.deepStrictEqual(await ops.setRemote('a1', true), { ok: true, on: true, steerable: true });
    assert.deepStrictEqual(await ops.openRemote('a1'), { ok: false }, 'no allowed URL stored: nothing opens');
    assert.strictEqual(opened.length, 1);

    // off and errors drop the stored state
    answer = { ok: true, on: true, url: 'https://github.com/o/r/tasks/3' };
    await ops.setRemote('a1', true);
    answer = { ok: true, on: false };
    assert.deepStrictEqual(await ops.setRemote('a1', false), { ok: true, on: false });
    assert.ok(!ops.has('a1'));
    answer = { ok: true, on: true, url: 'https://github.com/o/r/tasks/4' };
    await ops.setRemote('a1', true);
    ops.forget('a1'); // the session ended
    assert.deepStrictEqual(await ops.openRemote('a1'), { ok: false });
    answer = { ok: false, error: 'boom\nline' };
    assert.deepStrictEqual(await ops.setRemote('a1', true), { ok: false, error: 'boom line' });
    const throwing = { capabilities: { remote: true }, isLive: () => true, setRemote: async () => { throw new Error('kaboom'); } } as unknown as AgentAdapter;
    const ops2 = createRemoteOps({ known: () => true, adapterOf: () => throwing, open: async () => undefined });
    assert.deepStrictEqual(await ops2.setRemote('z', true), { ok: false, error: 'kaboom' });
  }

  // ---- FR-011 (security review): native confirmation, never in Allow all, off on GitHub before the session goes, logged
  {
    const calls: boolean[] = [], log: string[] = [];
    let mode = 'ask', yes = false;
    const ad = { capabilities: { remote: true }, isLive: () => true, setRemote: async (_id: string, on: boolean) => { calls.push(on); return on ? { ok: true, on: true, url: 'https://github.com/o/r/tasks/9' } : { ok: true, on: false }; } } as unknown as AgentAdapter;
    const ops = createRemoteOps({ known: () => true, adapterOf: () => ad, open: async () => undefined, modeOf: () => mode, confirm: async () => yes, record: (id, on) => void log.push(id + (on ? ' on' : ' off')) });
    mode = 'allow';
    assert.deepStrictEqual(await ops.setRemote('a', true), { ok: false, error: NOT_IN_ALLOW_ALL }, 'refused in Allow all');
    mode = 'ask';
    assert.deepStrictEqual(await ops.setRemote('a', true), { ok: false, cancelled: true, error: 'Cancelled.' }, 'the native No stops it');
    assert.deepStrictEqual(calls, [], 'nothing reached the adapter before consent');
    yes = true;
    assert.ok((await ops.setRemote('a', true)).ok);
    assert.deepStrictEqual(log, ['a on']);
    assert.deepStrictEqual(ops.ids(), ['a']);
    await ops.release('a');
    assert.deepStrictEqual(calls, [true, false], 'release turns it off on GitHub too');
    assert.deepStrictEqual(log, ['a on', 'a off']);
    assert.ok(!ops.has('a'));
    await ops.release('a');
    assert.deepStrictEqual(calls, [true, false], 'a second release does nothing');
    assert.ok((await ops.setRemote('a', false)).ok, 'turning off needs no confirmation');
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('test-remote: ok (allowlist, Copilot setRemote on a fake session, main-side checks)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
