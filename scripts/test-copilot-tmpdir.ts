/**
 * Spec 087 FR-023 (K15, issue #755): the Copilot runtime gets a private temp folder as TMPDIR; FR-024 (issue #1173): under a short root
 * when the OS temp root leaves no room for Unix sockets. Fake client only: no runtime, no account,
 * no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CopilotAdapter, copilotRuntimeEnv } from '../src/adapters/copilot';
import { sweepMcpConfigs } from '../src/adapters/claude';
import { FakeClient } from './fakes/copilot-sdk';
import { SOCKET_ROOM_BYTES, socketSafeTmpRoot } from '../src/adapters/privatedirs';
import { UNIX_SOCKET_MAX_BYTES } from '../src/shared/mcpserver';

type Opts = { env?: Record<string, string | undefined> };

/** A Copilot adapter whose `newClient` records the options and hands back a fake client (or fails on request). */
class TmpdirCopilot extends CopilotAdapter {
  opts: Opts[] = [];
  fail = false;
  stopMs = 0;
  protected async newClient(o: Opts): Promise<never> {
    this.opts.push(o);
    if (this.fail) throw new Error('runtime did not start');
    const c = new FakeClient();
    const ms = this.stopMs;
    if (ms) (c as unknown as { stop: () => Promise<unknown[]> }).stop = () => new Promise((r) => setTimeout(() => r([]), ms));
    return c as never;
  }
  client$(): Promise<unknown> {
    return (this as unknown as { getClient(): Promise<unknown> }).getClient();
  }
}

const posix = process.platform !== 'win32';
const tmpOf = (o: Opts): string => {
  const d = o.env?.TMPDIR;
  assert.ok(typeof d === 'string' && d.length > 0, 'FR-023: the runtime env carries TMPDIR');
  return d as string;
};

async function main(): Promise<void> {
  process.exitCode = 1;
  // the runtime starts with a private folder: it exists, 0700, under the OS temp root
  process.env.DURBAR_TMPDIR_TEST_SENTINEL = 'kept';
  const ad = new TmpdirCopilot();
  await ad.client$();
  assert.strictEqual(ad.opts.length, 1);
  const first = tmpOf(ad.opts[0]);
  assert.ok(path.basename(first).startsWith('durbar-cprt-'), 'FR-023: the durbar-cprt- prefix');
  assert.ok(fs.statSync(first).isDirectory(), 'FR-023: the folder exists while the runtime runs');
  if (posix) assert.strictEqual(fs.statSync(first).mode & 0o777, 0o700, 'FR-023: the folder is 0700');
  assert.strictEqual(ad.opts[0].env?.DURBAR_TMPDIR_TEST_SENTINEL, 'kept', 'Durbar\'s own environment is passed on (a planted sentinel: Windows spells PATH as Path)');
  assert.strictEqual(process.env.TMPDIR === first, false, 'only the runtime\'s environment changes, not Durbar\'s');
  // a new sign-in replaces the runtime: a new folder, the old one removed
  await ad.refreshAuth();
  assert.strictEqual(ad.opts.length, 2, 'refreshAuth started a new runtime');
  const second = tmpOf(ad.opts[1]);
  assert.notStrictEqual(second, first, 'FR-023: a new runtime gets a new folder');
  assert.ok(!fs.existsSync(first), 'FR-023: the old runtime\'s folder is removed on refresh');
  assert.ok(fs.existsSync(second));
  // dispose removes it
  await ad.dispose();
  assert.ok(!fs.existsSync(second), 'FR-023: dispose removes the folder');
  // the quit sweep (will-quit and process exit) removes a folder of a runtime that was never stopped
  const b = new TmpdirCopilot();
  await b.client$();
  const third = tmpOf(b.opts[0]);
  assert.ok(fs.existsSync(third));
  sweepMcpConfigs();
  assert.ok(!fs.existsSync(third), 'FR-023: the quit sweep removes the folder');
  // review of #1126: a runtime started while the old one is still stopping keeps its own folder (refresh and dispose)
  for (const how of ['refresh', 'dispose'] as const) {
    const r = new TmpdirCopilot();
    r.stopMs = 50;
    await r.client$();
    const old = tmpOf(r.opts[0]);
    const done = how === 'refresh' ? r.refreshAuth() : r.dispose();
    await new Promise((res) => setTimeout(res, 10)); // the old client is detached and stopping
    await r.client$(); // a getClient() meanwhile (auth status, the plan, a new session) starts a new runtime
    await done;
    const fresh = tmpOf(r.opts[r.opts.length - 1]);
    assert.notStrictEqual(fresh, old);
    assert.ok(fs.existsSync(fresh), `FR-023 ${how}: the runtime started during the stop keeps its folder`);
    assert.ok(!fs.existsSync(old), `FR-023 ${how}: the stopped runtime's folder is removed`);
    await r.dispose();
  }
  // a runtime that fails to start leaves no folder
  const c = new TmpdirCopilot();
  c.fail = true;
  await assert.rejects(c.client$(), /did not start/);
  const failed = tmpOf(c.opts[0]);
  assert.ok(!fs.existsSync(failed), 'FR-023: a failed start removes its folder');
  // the env: Durbar's own values kept, TMPDIR set; TEMP and TMP too on Windows only
  {
    const e = copilotRuntimeEnv({ PATH: '/bin', HOME: '/h', NOPE: undefined }, '/t/durbar-cprt-x', 'linux');
    assert.deepStrictEqual(e, { PATH: '/bin', HOME: '/h', TMPDIR: '/t/durbar-cprt-x' });
    const w = copilotRuntimeEnv({ PATH: 'C:\\bin', Temp: 'C:\\old', tmp: 'C:\\old', TmpDir: 'C:\\old' }, 'C:\\t\\durbar-cprt-x', 'win32');
    assert.deepStrictEqual(w, { PATH: 'C:\\bin', TMPDIR: 'C:\\t\\durbar-cprt-x', TEMP: 'C:\\t\\durbar-cprt-x', TMP: 'C:\\t\\durbar-cprt-x' }, 'FR-023: on Windows any spelling of TEMP, TMP or TMPDIR is replaced by ours');
  }
  // FR-024 (issue #1173): the root leaves room for a Unix socket; a short OS temp root is kept; Windows unchanged
  {
    const mac = '/var/folders/ab/cdefghijklmnopqrstuvwxyz0123/T'; // 49 bytes, like the Mac in the issue
    assert.strictEqual(socketSafeTmpRoot('durbar-cprt-', mac, 'darwin', '/private/tmp'), '/private/tmp', 'FR-024: a long macOS temp root is replaced by the short one');
    assert.strictEqual(socketSafeTmpRoot('durbar-cprt-', '/tmp', 'linux', '/tmp'), '/tmp', 'FR-024: a short root is kept');
    assert.strictEqual(socketSafeTmpRoot('durbar-cprt-', '/var/tmp/x', 'darwin', '/private/tmp'), '/var/tmp/x', 'FR-024: a short OS temp root is kept, not replaced');
    assert.strictEqual(socketSafeTmpRoot('durbar-cprt-', `/home/u/${'x'.repeat(60)}`, 'linux', '/tmp'), '/tmp', 'FR-024: Linux with a long TMPDIR too');
    const winLong = `C:\\Users\\someone\\AppData\\Local\\Temp\\${'x'.repeat(60)}`;
    assert.strictEqual(socketSafeTmpRoot('durbar-cprt-', winLong, 'win32', '/tmp'), winLong, 'FR-024: Windows is unchanged (named pipes)');
    const tooLongShort = `/${'y'.repeat(80)}`;
    assert.strictEqual(socketSafeTmpRoot('durbar-cprt-', mac, 'darwin', tooLongShort), mac, 'FR-024: a short root that does not fit either is not used');
  }
  if (posix) {
    // a real long TMPDIR (os.tmpdir() reads it): the runtime's folder is under the short root, 0700, leaves socket room, and is swept
    const saved = process.env.TMPDIR;
    const long = path.join(fs.realpathSync(os.tmpdir()), `durbar-fr024-${'l'.repeat(60)}`);
    fs.mkdirSync(long, { recursive: true });
    process.env.TMPDIR = long;
    try {
      assert.strictEqual(os.tmpdir(), long);
      const d = new TmpdirCopilot();
      await d.client$();
      const dir = tmpOf(d.opts[0]);
      assert.ok(!dir.startsWith(long), 'FR-024: the long temp root is not used');
      assert.strictEqual(path.dirname(dir), fs.realpathSync('/tmp'), 'FR-024: the folder is under the short root');
      assert.ok(Buffer.byteLength(dir, 'utf8') + SOCKET_ROOM_BYTES <= UNIX_SOCKET_MAX_BYTES, `FR-024: room for a socket under ${dir}`);
      assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700, 'FR-024: the folder is 0700');
      sweepMcpConfigs();
      assert.ok(!fs.existsSync(dir), 'FR-024: the quit sweep removes the folder');
      // a short TMPDIR is kept
      const short = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'dfr24-'));
      process.env.TMPDIR = short;
      const k = new TmpdirCopilot();
      await k.client$();
      assert.strictEqual(path.dirname(tmpOf(k.opts[0])), short, 'FR-024: a short OS temp root is kept');
      await k.dispose();
      fs.rmSync(short, { recursive: true, force: true });
    } finally {
      if (saved === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = saved;
      fs.rmSync(long, { recursive: true, force: true });
    }
  }
  console.log('copilot tmpdir (spec 087 FR-023, FR-024): ok');
  process.exitCode = 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
