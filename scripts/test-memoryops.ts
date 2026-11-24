/**
 * Spec 116 T003 (FR-001, FR-002, FR-004): the office memory settings (`SettingsStore`), `MemoryOps` (pick, apply, status, setOn, stop) over a fake
 * store and a fake file system, the shape of the IPC wiring and the simulator's fakes. `npm run test:memoryops`. No Electron, no adapter, no credits.
 * Paths are invented; token-like data is built at run time; timing uses large inputs and wide limits.
 *
 * Mutants: each is the COMPILED `memoryops.js` copied next to the original under a unique name with one text replacement (read with LF first, so a CRLF
 * checkout matches; compiled with `vm.Script` before it runs), and this file runs again against it (`MEMORYOPS_MODULE`). Each must die in ITS section
 * (the failed section's name is printed on stderr). An anchor that does not match fails loudly.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { spawnSync } from 'child_process';
import { SettingsStore } from '../src/main/settings';
import type { MemoryFlavor, RemoteAnswer } from '../src/shared/memoryfolder';

const MODNAME = process.env.MEMORYOPS_MODULE ?? 'memoryops';
const IS_COPY = process.env.MEMORYOPS_MODULE !== undefined;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MemoryOps, nodeMemoryCtx, expandOfficeFolders, TOKEN_MS } = require('../src/main/' + MODNAME) as typeof import('../src/main/memoryops');

let n = 0;
const eq = <T>(a: T, b: T, m: string): void => { n++; assert.deepStrictEqual(a, b, m); };
const ok = (c: unknown, m: string): void => { n++; assert.ok(c, m); };

const POSIX: MemoryFlavor = { path: path.posix, platform: 'linux' };
const WIN: MemoryFlavor = { path: path.win32, platform: 'win32' };

/** a fake file system that records every call */
function fakeFs(opts: { notDir?: string[]; missing?: string[]; links?: Record<string, string> } = {}) {
  // `links` is read at each call, so a test can repoint a link
  const log: string[] = [];
  const target = (p: string): string => opts.links?.[p] ?? p;
  return {
    log,
    realpathSync: Object.assign(() => { log.push('realpathSync(JS)'); throw new Error('the JS realpathSync must not be used'); }, {
      native: (p: string) => { log.push('native ' + p); if (opts.missing?.includes(p)) throw new Error('ENOENT'); return target(p); },
    }),
    lstatSync: (p: string) => { log.push('lstat ' + p); if (opts.missing?.includes(p)) throw new Error('ENOENT'); return { isDirectory: () => !opts.notDir?.includes(p) }; },
  };
}
class FakeStore {
  folder: string | undefined;
  on = false;
  keep = false;
  writes: Array<string | undefined> = [];
  failSave = false;
  get memoryFolder() { return this.folder; }
  get memoryOn() { return this.on && this.folder !== undefined; }
  get memoryKeepInGit() { return this.keep; }
  setMemory(f: string | undefined) { if (this.failSave) return false; this.writes.push(f); this.folder = f; this.on = f !== undefined; return true; }
  setMemoryOn(v: unknown) { if (typeof v !== 'boolean' || this.failSave) return false; this.on = v; return true; }
}
interface Setup { ws: Record<string, string[] | 'unreadable'>; remoteCalls: string[]; remoteAnswer: RemoteAnswer; ops: InstanceType<typeof MemoryOps>; store: FakeStore; fsx: ReturnType<typeof fakeFs>; office: string[]; clock: { t: number }; picks: Array<string | null>; changed: number[] }
function setup(flavor: MemoryFlavor = POSIX, o: { fsOpts?: Parameters<typeof fakeFs>[0] } = {}): Setup {
  const fsx = fakeFs(o.fsOpts);
  const store = new FakeStore();
  const office: string[] = [];
  const clock = { t: 1_000_000 };
  const picks: Array<string | null> = [];
  const changed: number[] = [];
  const ws: Record<string, string[] | 'unreadable'> = {};
  const remoteCalls: string[] = [];
  const out = { remoteAnswer: { kind: 'none' } as RemoteAnswer };
  let k = 0;
  const base = { home: flavor === POSIX ? '/home/ana' : 'C:\\Users\\ana', userData: flavor === POSIX ? '/home/ana/.config/durbar-x' : 'C:\\Users\\ana\\AppData\\Roaming\\durbar-x' };
  const ops = new MemoryOps({
    store: () => store, flavor, now: () => clock.t,
    pick: async () => (picks.length ? picks.shift()! : null),
    ctx: () => nodeMemoryCtx(fsx, base),
    officeFolders: () => expandOfficeFolders(office, (f) => { const m = ws[f]; if (!Array.isArray(m)) throw new Error('unreadable'); return m; }),
    remote: (real) => { remoteCalls.push(real); return out.remoteAnswer; },
    changed: () => changed.push(1),
    newToken: () => 'ab' + (++k).toString(16).padStart(30, '0'),
  });
  return { ws, remoteCalls, get remoteAnswer() { return out.remoteAnswer; }, set remoteAnswer(v: RemoteAnswer) { out.remoteAnswer = v; }, ops, store, fsx, office, clock, picks, changed };
}
const NOTES = '/home/ana/notes';

const sections: Array<[string, () => Promise<void> | void]> = [];
const section = (name: string, fn: () => Promise<void> | void): void => { sections.push([name, fn]); };

// ---------------------------------------------------------------------------------------------------------------------------------- store
section('store', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-memops-'));
  try {
    const file = path.join(dir, 's.json');
    const read = (doc: unknown): SettingsStore => { fs.writeFileSync(file, typeof doc === 'string' ? doc : JSON.stringify(doc)); const s = new SettingsStore(file); s.load(); return s; };
    // FR-001: off by default; nothing stored reads as off
    for (const doc of ['', '{}', 'not json', '[]', 'null', { memoryOn: true }, { memoryFolder: '/home/ana/notes' }]) {
      eq(read(doc as never).memoryOn, false, 'off without a folder or a true: ' + JSON.stringify(doc));
    }
    eq(read({}).memoryFolder, undefined, 'no folder by default');
    eq(read({}).memoryKeepInGit, false, 'keep-in-git off by default');
    for (const bad of ['true', 1, 'yes', {}, [], null, 0]) eq(read({ memoryFolder: '/home/ana/notes', memoryOn: bad }).memoryOn, false, 'memoryOn ' + JSON.stringify(bad));
    for (const bad of ['true', 1, {}, null]) eq(read({ memoryKeepInGit: bad }).memoryKeepInGit, false, 'memoryKeepInGit ' + JSON.stringify(bad));
    for (const bad of [5, true, {}, [], '', 'relative/dir', './x', '~/notes', '/a\0b', '/a\nb', '/' + 'a'.repeat(5000)]) {
      const s = read({ memoryFolder: bad, memoryOn: true });
      eq(s.memoryFolder, undefined, 'memoryFolder ' + JSON.stringify(bad).slice(0, 30));
      eq(s.memoryOn, false, 'a bad folder reads as off');
    }
    eq(read({ memoryFolder: '/home/ana/notes', memoryOn: true }).memoryOn, true, 'a good pair reads as on');
    eq(read({ memoryFolder: 'C:\\Users\\ana\\notes', memoryOn: true }).memoryFolder, 'C:\\Users\\ana\\notes', 'a Windows path');
    const s = read({});
    eq(s.setMemoryOn(true), false, 'on needs a folder');
    eq(s.setMemory('relative'), false, 'a bad path is not stored');
    eq(s.setMemory(NOTES), true, 'link');
    eq([s.memoryFolder, s.memoryOn], [NOTES, true], 'linked and on');
    const again = new SettingsStore(file); again.load();
    eq([again.memoryFolder, again.memoryOn], [NOTES, true], 'it reached the disk');
    for (const v of ['false', 0, null, undefined, {}]) eq(s.setMemoryOn(v), false, 'setMemoryOn refuses ' + String(v));
    eq(s.memoryOn, true, 'still on');
    eq(s.setMemoryOn(false), true, 'off');
    eq([s.memoryFolder, s.memoryOn], [NOTES, false], 'off keeps the folder');
    eq(s.setMemoryKeepInGit('x'), false, 'keep-in-git takes a boolean');
    eq(s.setMemoryKeepInGit(true), true, 'keep');
    eq(s.setMemory(undefined), true, 'stop');
    eq([s.memoryFolder, s.memoryOn, s.memoryKeepInGit], [undefined, false, true], 'stop clears the folder and the switch only');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    ok(!('memoryFolder' in raw) && !('memoryOn' in raw), 'the file no longer names the folder');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------------------- status
section('status', () => {
  const s = setup();
  eq(s.ops.status(), { on: false, state: 'off', keepInGit: false }, 'nothing linked');
  s.store.folder = NOTES; s.store.on = false;
  eq(s.ops.status(), { on: false, path: '~/notes', state: 'off', keepInGit: false }, 'linked but off: shown with ~');
  eq(s.fsx.log, [], 'while off, the folder is not looked at (FR-001)');
  s.store.on = true; s.store.keep = true;
  eq(s.ops.status(), { on: true, path: '~/notes', state: 'on', keepInGit: true }, 'on');
  const miss = setup(POSIX, { fsOpts: { missing: [NOTES] } });
  miss.store.folder = NOTES; miss.store.on = true;
  const st = miss.ops.status();
  eq([st.on, st.state], [false, 'notFound'], 'a folder that is gone');
  ok(typeof st.reason === 'string' && !st.reason.includes('ENOENT'), 'fixed words, no system text');
  const home = setup(); home.store.folder = '/home/ana'; home.store.on = true;
  eq(home.ops.status().state, 'refused', 'the home folder is refused on read');
  const outside = setup(); outside.store.folder = '/srv/notes'; outside.store.on = true;
  eq(outside.ops.status().path, '/srv/notes', 'a path outside home is shown as it is');
  const w = setup(WIN); w.store.folder = 'c:\\users\\ANA\\notes'; w.store.on = false;
  eq(w.ops.status().path, '~\\notes', 'win32 ~');
});

// ---------------------------------------------------------------------------------------------------------------------------------- pick
section('pick', async () => {
  const s = setup();
  s.picks.push(NOTES);
  const p = await s.ops.pick();
  ok(p.ok === true, 'a good folder gives a token');
  if (p.ok) { ok(/^[0-9a-f]{32}$/.test(p.token), 'token shape'); eq(p.path, '~/notes', 'path with ~'); eq(p.expiresAt, 1_000_000 + TOKEN_MS, '10 minutes'); }
  eq(s.store.writes, [], 'a pick saves nothing');
  eq(s.ops.pick.length, 0, 'pick takes no argument: the window sends no path');
  eq(await s.ops.pick(), { ok: false, error: 'cancelled' }, 'cancelled');
  const bad = new MemoryOps({ store: () => s.store, flavor: POSIX, pick: async () => { throw new Error('/secret/path boom'); }, ctx: () => nodeMemoryCtx(s.fsx, { home: '/home/ana', userData: '/u' }), officeFolders: () => [] });
  eq(await bad.pick(), { ok: false, error: 'failed' }, 'a dialog that throws: fixed words');
  s.picks.push('/home/ana');
  const r = await s.ops.pick();
  eq(r.ok, false, 'home refused');
  ok(r.ok === false && r.error === 'refused' && typeof (r as { reason: string }).reason === 'string' && !('token' in r), 'a reason and no token');
  eq(s.ops.apply('0'.repeat(31) + '1').ok, false, 'the first token died with the refused pick');
  s.office.push('/work/proj'); s.picks.push('/work/proj/sub');
  eq((await s.ops.pick()).ok, false, 'inside an office folder is refused');
  const l = setup(POSIX, { fsOpts: { links: { '/home/ana/link': '/work/proj' } } }); l.office.push('/work/proj'); l.picks.push('/home/ana/link');
  eq((await l.ops.pick()).ok, false, 'a link to an office folder is refused (the check sees the real path)');
  // a newer pick wins over a slower older dialog
  const slow: Setup = setup();
  const waiting: Array<(v: string) => void> = [];
  const ops2 = new MemoryOps({ store: () => slow.store, flavor: POSIX, now: () => 1, ctx: () => nodeMemoryCtx(slow.fsx, { home: '/home/ana', userData: '/u' }), officeFolders: () => [],
    pick: () => new Promise<string | null>((res) => { waiting.push(res); }) });
  const first = ops2.pick();
  const second = ops2.pick();
  waiting[1]('/home/ana/b');
  waiting[0]('/home/ana/a');
  const [a1, a2] = await Promise.all([first, second]);
  eq([a1.ok, a2.ok], [false, true], 'the older dialog answers cancelled');
});

// ---------------------------------------------------------------------------------------------------------------------------------- apply
section('apply', async () => {
  const s = setup();
  s.picks.push(NOTES);
  const p = await s.ops.pick();
  assert.ok(p.ok);
  const token = p.ok ? p.token : '';
  for (const bad of [undefined, null, 5, {}, [], '', 'f'.repeat(32), '0'.repeat(32), NOTES, '/home/ana/other', 'C:\\x', '../x', { path: NOTES }, token.toUpperCase(), token + 'x']) {
    eq(s.ops.apply(bad as never).ok, false, 'refused: ' + JSON.stringify(bad));
  }
  eq(s.store.writes, [], 'a path from the window saves nothing');
  eq(s.ops.apply(NOTES), { ok: false, error: 'invalid' }, 'a path as the token (fixed words)');
  const started = Date.now();
  eq(s.ops.apply('a'.repeat(200_000)).ok, false, 'a huge string');
  ok(Date.now() - started < 2000, 'a huge string is quick');
  eq(s.ops.apply(token), { ok: true, path: '~/notes' }, 'apply with the token');
  eq(s.store.writes, [NOTES], 'saved the real path main checked');
  eq(s.changed.length, 1, 'the window is told');
  eq(s.ops.apply(token), { ok: false, error: 'invalid' }, 'a reused token');
  eq(s.store.writes, [NOTES], 'a reused token saves nothing');
  s.picks.push(NOTES);
  const q = await s.ops.pick();
  s.clock.t += TOKEN_MS;
  eq(s.ops.apply(q.ok ? q.token : '').ok, false, 'an expired token');
  s.picks.push(NOTES);
  const q3 = await s.ops.pick();
  s.clock.t += TOKEN_MS - 1;
  eq(s.ops.apply(q3.ok ? q3.token : '').ok, true, 'one millisecond before it expires');
  s.picks.push(NOTES, NOTES);
  const t1 = await s.ops.pick(); const t2 = await s.ops.pick();
  eq(s.ops.apply(t1.ok ? t1.token : '').ok, false, 'the older token is gone');
  eq(s.ops.apply(t2.ok ? t2.token : '').ok, true, 'the newer one works');
});

// ---------------------------------------------------------------------------------------------------------------------------------- recheck
section('recheck', async () => {
  const s = setup();
  s.picks.push(NOTES);
  const p = await s.ops.pick();
  s.office.push('/home/ana/notes/inner');
  const r = s.ops.apply(p.ok ? p.token : '');
  eq(r.ok, false, 'apply re-checks: an office folder appeared');
  ok(r.ok === false && r.error === 'refused' && typeof (r as { reason?: string }).reason === 'string', 'refused with the reason');
  eq(s.store.writes, [], 'nothing saved after a failed re-check');
  eq(s.ops.apply(p.ok ? p.token : ''), { ok: false, error: 'invalid' }, 'the token is spent');
  const g = setup(); g.picks.push(NOTES);
  const gp = await g.ops.pick();
  g.fsx.lstatSync = () => { throw new Error('ENOENT'); };
  eq(g.ops.apply(gp.ok ? gp.token : '').ok, false, 'apply re-checks: the folder is gone');
  eq(g.store.writes, [], 'nothing saved');
  const c = setup(); c.picks.push(NOTES);
  const cp = await c.ops.pick();
  const before = c.fsx.log.length;
  c.ops.apply(cp.ok ? cp.token : '');
  ok(c.fsx.log.length > before, 'apply touched the file system again (T002 ran again)');
  const o = setup(); o.store.folder = '/home/ana'; o.store.on = false;
  eq(o.ops.setOn(true).ok, false, 'setOn(true) on a refused folder');
  eq(o.store.on, false, 'stays off');
});

// ---------------------------------------------------------------------------------------------------------------------------------- workspace
section('workspace', async () => {
  // a member that is not the first is an office folder too (plan rule 4)
  const s = setup();
  s.office.push('/work/all.code-workspace');
  s.ws['/work/all.code-workspace'] = ['/work/first', '/work/second', '/work/third'];
  for (const member of ['/work/second', '/work/third/inner', '/work/first']) { s.picks.push(member); eq((await s.ops.pick()).ok, false, 'a workspace member is refused: ' + member); }
  s.picks.push('/work'); eq((await s.ops.pick()).ok, false, 'a folder that holds the workspace members is refused');
  s.picks.push(NOTES); eq((await s.ops.pick()).ok, true, 'an unrelated folder is allowed');
  // a workspace that cannot be read refuses, with fixed words
  s.ws['/work/all.code-workspace'] = 'unreadable';
  s.picks.push(NOTES);
  const r = await s.ops.pick();
  ok(r.ok === false && r.error === 'refused' && /could not be read/.test((r as { reason: string }).reason) && !/unreadable|Error/.test((r as { reason: string }).reason), 'an unreadable workspace refuses (fail closed)');
  // upper-case extension
  const u = setup(); u.office.push('/work/ALL.CODE-WORKSPACE'); u.ws['/work/ALL.CODE-WORKSPACE'] = ['/work/a', '/work/b'];
  u.picks.push('/work/b'); eq((await u.ops.pick()).ok, false, 'the extension is not case-sensitive');
  // the same on apply and on status
  const a = setup(); a.picks.push(NOTES); const pa = await a.ops.pick();
  a.office.push('/w.code-workspace'); a.ws['/w.code-workspace'] = 'unreadable';
  eq(a.ops.apply(pa.ok ? pa.token : '').ok, false, 'apply refuses when a workspace cannot be read');
  eq(a.store.writes, [], 'nothing saved');
  a.store.folder = NOTES; a.store.on = true;
  eq(a.ops.status().state, 'refused', 'status: refused');
  // the helper alone
  eq(expandOfficeFolders(['/a', '/w.code-workspace'], () => ['/x', '/y']), ['/a', '/w.code-workspace', '/x', '/y'], 'expand keeps the entry and adds every member');
  assert.throws(() => expandOfficeFolders(['/w.code-workspace'], () => { throw new Error('x'); }), /x/);
});

// ---------------------------------------------------------------------------------------------------------------------------------- remote
section('remote', async () => {
  const s = setup();
  s.remoteAnswer = { kind: 'remote', hosts: ['host.example.invalid'], rewritten: false };
  s.picks.push(NOTES);
  const p = await s.ops.pick();
  eq(p.ok && p.remote, { kind: 'remote', hosts: ['host.example.invalid'], rewritten: false }, 'the answer is given as it is');
  eq(s.remoteCalls, [NOTES], 'asked on the real path');
  s.remoteAnswer = { kind: 'unknown' }; s.picks.push(NOTES);
  eq((await s.ops.pick()).ok && ((await Promise.resolve(0)), true), true, 'unknown is fine');
  s.remoteAnswer = { kind: 'none' }; s.picks.push(NOTES);
  const q = await s.ops.pick();
  eq(q.ok && q.remote, { kind: 'none' }, 'none');
  // a refused pick never asks
  const n0 = s.remoteCalls.length; s.picks.push('/home/ana'); await s.ops.pick();
  eq(s.remoteCalls.length, n0, 'a refused folder is not read for a remote');
  // the reader throws: could not check, never none
  const t = new MemoryOps({ store: () => s.store, flavor: POSIX, pick: async () => NOTES, ctx: () => nodeMemoryCtx(s.fsx, { home: '/home/ana', userData: '/u' }), officeFolders: () => [], remote: () => { throw new Error('boom'); } });
  const tp = await t.pick();
  eq(tp.ok && tp.remote, { kind: 'unknown' }, 'a throwing reader answers unknown');
  const none = new MemoryOps({ store: () => s.store, flavor: POSIX, pick: async () => NOTES, ctx: () => nodeMemoryCtx(s.fsx, { home: '/home/ana', userData: '/u' }), officeFolders: () => [] });
  const np = await none.pick();
  eq(np.ok && np.remote, { kind: 'unknown' }, 'no reader: unknown, not none');
});

// ---------------------------------------------------------------------------------------------------------------------------------- relink
section('relink', async () => {
  // the picked path is a link; the person confirms its real path; it is repointed before apply
  const links: Record<string, string> = { '/home/ana/link': '/home/ana/target-a' };
  const s = setup(POSIX, { fsOpts: { links } });
  s.picks.push('/home/ana/link');
  const p = await s.ops.pick();
  eq(p.ok && p.path, '~/target-a', 'the real path is what is shown and confirmed');
  // unchanged: saved is the real path, not the link
  eq(s.ops.apply(p.ok ? p.token : '').ok, true, 'an unchanged link applies');
  eq(s.store.writes, ['/home/ana/target-a'], 'the real path is saved, never the link');
  // repointed: refused, nothing saved
  s.picks.push('/home/ana/link');
  const p2 = await s.ops.pick();
  links['/home/ana/link'] = '/home/ana/target-b';
  const r = s.ops.apply(p2.ok ? p2.token : '');
  eq(r.ok, false, 'a link repointed since the pick is refused');
  eq(s.store.writes, ['/home/ana/target-a'], 'nothing new saved');
  eq(s.ops.apply(p2.ok ? p2.token : ''), { ok: false, error: 'invalid' }, 'the token is spent');
  // repointed to a refused place: refused too (the check and the comparison both)
  links['/home/ana/link'] = '/home/ana/target-a'; s.picks.push('/home/ana/link');
  const p3 = await s.ops.pick();
  links['/home/ana/link'] = '/home/ana';
  eq(s.ops.apply(p3.ok ? p3.token : '').ok, false, 'repointed to the home folder');
  // Linux is case-sensitive: two folders that differ only in case are two folders
  const lk: Record<string, string> = { '/home/ana/link': '/home/ana/Notes' };
  const l = setup(POSIX, { fsOpts: { links: lk } });
  l.picks.push('/home/ana/link');
  const lp = await l.ops.pick();
  lk['/home/ana/link'] = '/home/ana/notes';
  eq(l.ops.apply(lp.ok ? lp.token : ''), { ok: false, error: 'refused', reason: 'The folder is not the one you chose (it changed since). Choose it again.' }, 'linux: a repoint that differs only in case is refused with the CHANGED sentence');
  eq(l.store.writes, [], 'linux: nothing saved');
  // what is saved is the real path the re-check resolved, not the one stored at the pick: on Windows only the case differs
  let disk = 'C:\\Users\\ana\\Notes';
  const winFs = { realpathSync: Object.assign(() => '', { native: (p: string) => (p.toLowerCase().endsWith('\\notes') ? disk : p) }), lstatSync: () => ({ isDirectory: () => true }) };
  const wstore = new FakeStore();
  const wops = new MemoryOps({ store: () => wstore, flavor: WIN, pick: async () => 'C:\\Users\\ana\\notes', ctx: () => nodeMemoryCtx(winFs, { home: 'C:\\Users\\ana', userData: 'C:\\Users\\ana\\AppData\\Roaming\\x' }), officeFolders: () => [] });
  const wp = await wops.pick();
  disk = 'C:\\Users\\ana\\notes';
  eq(wops.apply(wp.ok ? wp.token : '').ok, true, 'a case change on Windows is the same folder');
  eq(wstore.writes, ['C:\\Users\\ana\\notes'], 'the fresh real path from the re-check is saved');
});

// ---------------------------------------------------------------------------------------------------------------------------------- seton
section('seton', () => {
  const s = setup();
  eq(s.ops.setOn(true), { ok: false, error: 'noFolder' }, 'on without a folder');
  for (const v of ['true', 1, null, undefined, {}]) eq(s.ops.setOn(v), { ok: false, error: 'invalid' }, 'non-boolean ' + String(v));
  s.store.folder = NOTES;
  eq(s.ops.setOn(true), { ok: true }, 'on'); eq(s.store.on, true, 'store on');
  eq(s.ops.setOn(false), { ok: true }, 'off'); eq(s.store.on, false, 'store off');
  s.store.failSave = true;
  eq(s.ops.setOn(true), { ok: false, error: 'failed' }, 'a save that fails says failed');
});

// ---------------------------------------------------------------------------------------------------------------------------------- stop
section('stop', async () => {
  const s = setup();
  s.picks.push(NOTES);
  const p = await s.ops.pick();
  s.ops.apply(p.ok ? p.token : '');
  s.picks.push(NOTES);
  const p2 = await s.ops.pick();
  const log = s.fsx.log.length;
  eq(s.ops.stop(), { ok: true }, 'stop');
  eq(s.fsx.log.length, log, 'stop made no file system call at all (fake fs records none)');
  eq(s.store.writes, [NOTES, undefined], 'only the settings were cleared');
  eq(s.ops.status().state, 'off', 'off after stop');
  eq(s.ops.apply(p2.ok ? p2.token : '').ok, false, 'stop also drops a pending token');
  ok(s.changed.length >= 2, 'the window is told');
  s.store.failSave = true;
  eq(s.ops.stop(), { ok: false, error: 'failed' }, 'a save that fails says failed');
  const none = new MemoryOps({ store: () => undefined, flavor: POSIX, pick: async () => null, ctx: () => nodeMemoryCtx(s.fsx, { home: '/h', userData: '/u' }), officeFolders: () => [] });
  eq(none.stop().ok, false, 'no store'); eq(none.status().state, 'off', 'no store: off'); eq(none.setOn(true).ok, false, 'no store: setOn');
});

// ---------------------------------------------------------------------------------------------------------------------------------- ctx
section('ctx', async () => {
  const s = setup();
  s.picks.push(NOTES);
  await s.ops.pick();
  ok(s.fsx.log.some((l) => l.startsWith('native ')), 'the native realpath ran');
  ok(!s.fsx.log.includes('realpathSync(JS)'), 'the JS realpathSync never ran');
  const w = setup(WIN);
  w.picks.push('C:\\Users\\ana\\notes');
  const p = await w.ops.pick();
  eq(p.ok && p.path, '~\\notes', 'win32 pick');
  ok(w.ops.apply(p.ok ? p.token : '').ok === true, 'win32 apply');
  eq(w.store.writes, ['C:\\Users\\ana\\notes'], 'win32 real path kept');
  w.picks.push('\\\\server\\share\\x');
  eq((await w.ops.pick()).ok, false, 'UNC refused');
  w.picks.push('C:\\Users\\ana\\AppData\\Roaming');
  eq((await w.ops.pick()).ok, false, 'AppData refused');
});

// ---------------------------------------------------------------------------------------------------------------------------------- source
section('source', () => {
  const root = path.join(__dirname, '..', '..');
  const rd = (f: string): string => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
  const ops = rd('src/main/memoryops.ts');
  const code = ops.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/\.realpathSync\.native\(/.test(code) && !/realpathSync\(/.test(code.replace(/realpathSync\.native\(/g, '')), 'memoryops.ts uses fs.realpathSync.native only');
  ok(/officeFolders: \(\) => expandOfficeFolders\([^\n]*readCodeWorkspaceFolders\)/.test(rd('src/main/main.ts')), 'main.ts expands every workspace through readCodeWorkspaceFolders');
  ok(/nodeMemoryCtx\(\s*fs,/.test(rd('src/main/main.ts')), 'main.ts builds the ctx through nodeMemoryCtx(fs, ...), so realpathSync.native');
  ok(!/realpath\s*:\s*fs\.realpathSync[^.]/.test(rd('src/main/main.ts')), 'main.ts never hands the JS realpathSync over');
  eq([...ops.matchAll(/^import [^;]*from '([^']+)'/gm)].map((m) => m[1]).sort(), ['../shared/api', '../shared/memoryfolder', '../shared/memoryfolder', 'crypto'], 'memoryops.ts imports: no fs, no Electron, no shell');
  ok(!/child_process|\bspawn|\bexec\(|writeFile|unlink|rmSync|rmdir|mkdir|readFile|readdir/.test(code), 'memoryops.ts writes and removes nothing');
  const ipc = rd('src/main/ipc/memory.ts');
  for (const c of ['status', 'pick', 'apply', 'setOn', 'stop']) ok(new RegExp(`ipcHandle\\('memory:${c}', \\(e[,)][^\\n]*!fromApp\\(e\\)`).test(ipc), `memory:${c} is window only through ipcHandle`);
  ok(!/ipcMain|webContents\.ipc/.test(ipc), 'no raw ipcMain');
  const pre = rd('src/preload/preload.ts');
  for (const c of ['status', 'pick', 'apply', 'setOn', 'stop']) ok(pre.includes(`ipcRenderer.invoke('memory:${c}'`), `preload calls memory:${c}`);
  ok(pre.includes("sub('memory:changed'"), 'preload subscribes to memory:changed');
  ok(!/memoryPick:\s*\([^)]/.test(pre), 'memoryPick sends nothing');
  const sim = rd('src/renderer/sim.ts');
  const fn = sim.slice(sim.indexOf('function simMemoryApi'), sim.indexOf("type SimNote = "));
  ok(fn.length > 500 && !/require\(|from 'fs'|localStorage|fetch\(/.test(fn), 'the simulator fakes touch no disk');
  ok(/\/tmp\/durbar-sim-memory/.test(fn), 'the simulator names a temp folder only');
  ok(/memoryPick: async \(\) =>/.test(fn), 'the simulated pick takes no path');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of sections) {
    try { await fn(); } catch (e) { failed++; console.error(`SECTION ${name} FAILED`); console.error(e instanceof Error ? e.message.slice(0, 240) : 'failed'); }
  }
  if (failed > 0) { console.error(`memoryops: ${failed} section(s) failed`); process.exit(1); }
  if (IS_COPY) { console.log(`memoryops (copy): ${n} checks passed`); return; }
  const dir = path.join(__dirname, '..', 'src', 'main');
  const orig = fs.readFileSync(path.join(dir, 'memoryops.js'), 'utf8');
  const mutate = (text: string, m: { name: string; from: string; to: string }): string => {
    const lf = text.replace(/\r\n/g, '\n');
    assert.ok(lf.includes(m.from), 'mutant anchor not found: ' + m.name);
    return lf.split(m.from).join(m.to);
  };
  const mutants: { name: string; from: string; to: string; section: string }[] = [
    // the two the task names
    { name: 'a path is accepted from the window', from: '    apply(token) {\n', to: "    apply(token) {\n        if (typeof token === 'string' && token.startsWith('/')) this.live = { token, real: token, expiresAt: Infinity };\n", section: 'apply' },
    { name: 'apply without the re-check', from: 'r = this.check(e.chosen);', to: 'r = { ok: true, real: e.real };', section: 'recheck' },
    // review round 1
    { name: 'only the first workspace folder is used', from: 'out.push(...read(e));', to: 'out.push(read(e)[0]);', section: 'workspace' },
    { name: 'an unreadable workspace is ignored', from: "catch {\n            return { ok: false, reason: 'office-folder', text: WS_UNREADABLE };\n        }", to: 'catch {\n            office = [];\n        }', section: 'workspace' },
    { name: 'pick drops the remote', from: ', remote };', to: ' };', section: 'remote' },
    { name: 'the token is bound to the unresolved path', from: 'this.live = { token, chosen, real: r.real,', to: 'this.live = { token, chosen, real: chosen,', section: 'relink' },
    { name: 'apply saves the stored path, not the re-check one', from: 'st.setMemory(r.real)', to: 'st.setMemory(e.real)', section: 'relink' },
    { name: 'apply skips the repoint comparison', from: 'if (!this.same(r.real, e.real))', to: 'if (false)', section: 'relink' },
    { name: 'case folded on every platform', from: "this.deps.flavor.platform === 'linux' ? x : x.toLowerCase()", to: 'x.toLowerCase()', section: 'relink' },
    // the same rules from other sides
    { name: 'a token can be used twice', from: '        this.live = undefined;\n        if (this.now() >= e.expiresAt)', to: '        if (this.now() >= e.expiresAt)', section: 'apply' },
    { name: 'a token never expires', from: 'if (this.now() >= e.expiresAt)', to: 'if (false)', section: 'apply' },
    { name: 'any token is taken', from: ' || token !== e.token)', to: ')', section: 'apply' },
    { name: 'the JS realpathSync instead of native', from: 'fs.realpathSync.native(p)', to: 'fs.realpathSync(p)', section: 'ctx' },
    { name: 'a refused pick still gives a token', from: "if (!r.ok) {\n            this.live = undefined;\n            return { ok: false, error: 'refused'", to: "if (false) {\n            this.live = undefined;\n            return { ok: false, error: 'refused'", section: 'pick' },
    { name: 'status looks at the folder while off', from: "if (!st.memoryOn)\n            return { on: false, path, state: 'off', keepInGit };", to: '', section: 'status' },
    { name: 'setOn(true) does not re-check', from: 'if (v) {\n            const folder = st.memoryFolder;', to: 'if (false) {\n            const folder = st.memoryFolder;', section: 'recheck' },
    { name: 'stop checks the folder', from: '        this.live = undefined;\n        const saved = st.setMemory(undefined);', to: '        this.live = undefined;\n        this.deps.ctx().lstat("/x");\n        const saved = st.setMemory(undefined);', section: 'stop' },
    { name: 'stop leaves a pending token', from: '        this.live = undefined;\n        const saved = st.setMemory(undefined);', to: '        const saved = st.setMemory(undefined);', section: 'stop' },
  ];
  const lf = orig.replace(/\r\n/g, '\n');
  assert.deepStrictEqual(mutants.filter((m) => !lf.includes(m.from)).map((m) => m.name), [], 'mutant anchors not found');
  for (const m of mutants) assert.strictEqual(lf.split(m.from).length - 1, 1, 'the anchor of "' + m.name + '" matches exactly once');
  for (const m of mutants) ok(mutate(lf.replace(/\n/g, '\r\n'), m).length > 0, 'the anchor of "' + m.name + '" is found in a CRLF source');
  assert.throws(() => mutate('no such text', mutants[0]), /mutant anchor not found: /, 'a missing anchor says so');
  let killed = 0;
  let k = 0;
  for (const m of mutants) {
    k++;
    const uniq = `memoryops.mutant-${process.pid}-${k}`;
    const file = path.join(dir, uniq + '.js');
    try {
      const mutated = mutate(orig, m);
      try { new vm.Script(mutated, { filename: uniq }); } catch (e) { assert.fail('mutant is not valid JavaScript (' + m.name + '): ' + (e as Error).message); }
      fs.writeFileSync(file, mutated);
      const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { MEMORYOPS_MODULE: uniq }), encoding: 'utf8', timeout: 120000 });
      assert.notStrictEqual(r.status, 0, 'mutant NOT killed: ' + m.name);
      const died = [...r.stderr.matchAll(/SECTION (\w+) FAILED/g)].map((x) => x[1]);
      assert.ok(died.includes(m.section), `mutant "${m.name}" must die in section "${m.section}", it died in: ${died.join(',') || r.stderr.slice(0, 200)}`);
      killed++;
    } finally { fs.rmSync(file, { force: true }); }
  }
  assert.strictEqual(killed, mutants.length);
  console.log(`memoryops: ${n} checks passed, ${killed} mutants killed`);
})().catch((e) => { console.error(e); process.exit(1); });
