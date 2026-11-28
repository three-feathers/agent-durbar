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
const FOLDERS_NAME = process.env.FOLDERS_MODULE ?? 'folders';
const IS_COPY = process.env.MEMORYOPS_MODULE !== undefined || process.env.FOLDERS_MODULE !== undefined;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MemoryOps, OfficeMap, nodeMemoryCtx, expandOfficeFolders, collectOfficeFolders, cappedWorkspaceReader, MAX_WORKSPACE_BYTES, TOKEN_MS } = require('../src/main/' + MODNAME) as typeof import('../src/main/memoryops');

// the real FolderStore (or a mutated copy of it, FOLDERS_MODULE)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FolderStore } = require('../src/main/' + FOLDERS_NAME) as typeof import('../src/main/folders');

let n = 0;
const eq = <T>(a: T, b: T, m: string): void => { n++; assert.deepStrictEqual(a, b, m); };
// a reader throw must fail at the named assert, not at the reader's own message
const named = <T>(name: string, fn: () => T): T => { try { return fn(); } catch (e) { throw new Error(`${name}: the reader threw: ${e instanceof Error ? e.message : 'error'}`); } };
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
  // D6: with no injected generator the token comes from crypto.randomBytes(16)
  {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('crypto') as { randomBytes: (n: number) => Buffer };
    const real = crypto.randomBytes; const asked: number[] = [];
    crypto.randomBytes = ((n: number) => { asked.push(n); return Buffer.alloc(n, 0xab); }) as typeof real;
    try {
      const fx = fakeFs();
      const o = new MemoryOps({ store: () => new FakeStore(), flavor: POSIX, pick: async () => NOTES, ctx: () => nodeMemoryCtx(fx, { home: '/home/ana', userData: '/u' }), officeFolders: () => [] });
      const t = await o.pick();
      eq(t.ok && t.token, 'ab'.repeat(16), 'the default token is the 16 bytes crypto.randomBytes gave');
      eq(asked, [16], 'asked for exactly 16 random bytes');
    } finally { crypto.randomBytes = real; }
  }
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
  ok((r as { reason: string }).reason.includes('/work/all.code-workspace'), 'the refusal names the workspace file (paths are shown, owner decision of 2026-11-23)');
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
  assert.throws(() => expandOfficeFolders(['/w.code-workspace'], () => { throw new Error('x'); }), /workspace unreadable/);
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

// ---------------------------------------------------------------------------------------------------------------------------------- liveoffice
section('liveoffice', async () => {
  // P2: an OPEN agent's folders are the ones it runs with, never re-read from its (possibly edited) file; a saved folder with no live agent is read
  const reads: string[] = [];
  const read = (f: string): string[] => { reads.push(f); return f === '/w/live.code-workspace' ? ['/w/a', '/w/evil'] : ['/w/s1', '/w/s2']; };
  const out = collectOfficeFolders([{ key: '/w/live.code-workspace', folders: ['/w/a'], workspaceFile: '/w/live.code-workspace' }, { key: '/p/plain', folders: ['/p/plain'] }],
    ['/w/live.code-workspace', '/p/plain', '/w/saved.code-workspace'], read);
  ok(out.includes('/w/a') && out.includes('/w/live.code-workspace') && out.includes('/p/plain'), 'the live folders and files are in');
  ok(!out.includes('/w/evil'), 'an edited file does not add a member to a live workspace');
  eq(reads, ['/w/saved.code-workspace'], 'only the saved folder with no live agent is read');
  ok(out.includes('/w/s1') && out.includes('/w/s2'), 'a saved workspace is expanded from its file');
  assert.throws(() => collectOfficeFolders([], ['/w/bad.code-workspace'], () => { throw new Error('x'); }), /workspace unreadable/);
  // end to end: the live second member is refused even though the file changed
  const s = setup();
  s.ops = new MemoryOps({ store: () => s.store, flavor: POSIX, now: () => 1, pick: async () => '/w/b', ctx: () => nodeMemoryCtx(s.fsx, { home: '/home/ana', userData: '/u' }),
    officeFolders: () => collectOfficeFolders([{ key: '/w/l.code-workspace', folders: ['/w/a', '/w/b'], workspaceFile: '/w/l.code-workspace' }], ['/w/l.code-workspace'], () => ['/w/a']) });
  eq((await s.ops.pick()).ok, false, 'a live write root is refused although the file now lists only the first folder');
});

// ---------------------------------------------------------------------------------------------------------------------------------- wsread
section('wsread', () => {
  const flags = { O_RDONLY: 0, O_NOFOLLOW: 4, O_NONBLOCK: 8 };
  const mk = (data: string | 'fifo', opened: number[] = []) => ({
    openSync: (_f: string, fl: number) => { opened.push(fl); return 5; },
    fstatSync: () => ({ isFile: () => data !== 'fifo', size: data === 'fifo' ? 0 : Buffer.byteLength(data), nlink: 1 }),
    readSync: (_fd: number, buf: Buffer, off: number, len: number, pos: number) => { const b = Buffer.from(data === 'fifo' ? '' : data); const c = Math.min(len, Math.max(0, b.length - pos)); b.copy(buf, off, pos, pos + c); return c; },
    closeSync: () => undefined,
  });
  const cw = (f: ReturnType<typeof mk>, real: (p: string) => string = (p) => p) => cappedWorkspaceReader(f, flags, parse, real);
  const parse = (t: string): string[] => (JSON.parse(t) as { folders: Array<{ path: string }> }).folders.map((f) => f.path);
  const good = JSON.stringify({ folders: [{ path: '/w/a' }, { path: '/w/b' }] });
  const opened: number[] = [];
  eq(cw(mk(good, opened))('/w/x.code-workspace'), ['/w/a', '/w/b'], 'a normal file');
  eq(opened, [12], 'opened O_RDONLY | O_NOFOLLOW | O_NONBLOCK');
  assert.throws(() => cw(mk('fifo'))('/w/x.code-workspace'), /workspace unreadable/, 'a FIFO is refused without a read');
  const pad = (n: number): string => good + ' '.repeat(n - Buffer.byteLength(good));
  eq(cw(mk(pad(MAX_WORKSPACE_BYTES)))('/w/x.code-workspace').length, 2, 'exactly 1 MB is read');
  assert.throws(() => cw(mk(pad(MAX_WORKSPACE_BYTES + 1)))('/w/x.code-workspace'), /workspace unreadable/, 'over 1 MB is refused');
  assert.throws(() => cw(mk('{not json'))('/w/x.code-workspace'), (e: Error) => !/not json/.test(e.message) || true, 'a bad file throws');
  // round 5: a symlinked workspace file is common; the resolved path is the one read (still capped, non-blocking, no-follow)
  const link = (p: string): string => (p === '/w/link.code-workspace' ? '/w/real.code-workspace' : p);
  const o2: number[] = [];
  const base = mk(good, o2);
  const seen: string[] = [];
  const f2 = { ...base, openSync: (f: string, fl: number) => { seen.push(f); return base.openSync(f, fl); } };
  eq(cw(f2, link)('/w/link.code-workspace'), ['/w/a', '/w/b'], 'a symlink to a good workspace file is read');
  eq(seen, ['/w/real.code-workspace'], 'the resolved path is the one opened');
  let reads = 0;
  const counting = (data: string | 'fifo', size?: number) => { const m = mk(data); return { ...m, fstatSync: () => ({ ...m.fstatSync(), ...(size === undefined ? {} : { size }) }), readSync: (...a: Parameters<typeof m.readSync>) => { reads++; return m.readSync(...a); } }; };
  assert.throws(() => cw(counting('fifo'), link)('/w/link.code-workspace'), /workspace unreadable/, 'a symlink to a FIFO fails');
  assert.throws(() => cw(counting('{}', 300 * 1024 * 1024), link)('/w/link.code-workspace'), /workspace unreadable/, 'a symlink to a 300 MB sparse file fails');
  eq(reads, 0, 'both failed before any byte was read');
  eq(named('a hard link (nlink 3) is read: following it only adds folders to the refusal list', () => cw({ ...mk(good), fstatSync: () => ({ isFile: () => true, size: Buffer.byteLength(good), nlink: 3 }) }, link)('/w/link.code-workspace')), ['/w/a', '/w/b'], 'a hard link (nlink 3) is read: following it only adds folders to the refusal list');
  eq(named('a dangling link or a missing file adds no folder and does not block every pick', () => cw(mk(good), () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); })('/w/gone.code-workspace')), [], 'a dangling link or a missing file adds no folder and does not block every pick');
  eq(named('a file that vanishes between the resolve and the open adds no folder', () => cw({ ...mk(good), openSync: () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } })('/w/raced.code-workspace')), [], 'a file that vanishes between the resolve and the open adds no folder');
  assert.throws(() => cw(mk(good), () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); })('/w/x.code-workspace'), /workspace unreadable/, 'any other realpath failure refuses');
  eq(named('a gone workspace does not stop the others', () => expandOfficeFolders(['/w/gone.code-workspace', '/w/a'], cw(mk(good), () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); }))), ['/w/gone.code-workspace', '/w/a'], 'a gone workspace does not stop the others');
  eq(MAX_WORKSPACE_BYTES, 1024 * 1024, 'the cap is 1 MB');
  // through the refusal: the file is named
  assert.throws(() => expandOfficeFolders(['/w/x.code-workspace'], cw(mk('fifo'))), (e: Error & { file?: string }) => e.file === '/w/x.code-workspace', 'the refusal names the file');
  const rd = fs.readFileSync(path.join(__dirname, '..', '..', 'src/main/main.ts'), 'utf8');
  ok(/cappedWorkspaceReader\(fs, memoryGitFlags\(fs\.constants\), codeWorkspaceFoldersFromText, \(p\) => fs\.realpathSync\.native\(p\)\)/.test(rd), 'main.ts reads workspace files through the capped reader, with memoryGitFlags');
  ok(!/readCodeWorkspaceFolders/.test(rd.slice(rd.indexOf('registerMemoryIpc({'), rd.indexOf('registerOrgPolicyIpc'))), 'the memory wiring never calls the plain readFileSync reader');
});

// ---------------------------------------------------------------------------------------------------------------------------------- realws
section('realws', () => {
  // the REAL file system (a real fs.Stats keeps `isFile` on its prototype: a spread of it loses it)
  const { memoryGitFlags } = require('../src/main/memorygit') as typeof import('../src/main/memorygit');
  const { codeWorkspaceFoldersFromText } = require('../src/adapters/workspace') as typeof import('../src/adapters/workspace');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-memws-'));
  try {
    const rd = cappedWorkspaceReader(fs, memoryGitFlags(fs.constants), codeWorkspaceFoldersFromText, (p) => fs.realpathSync.native(p));
    const file = path.join(dir, 'real.code-workspace');
    fs.writeFileSync(file, JSON.stringify({ folders: [{ path: 'a' }, { path: 'b' }] }));
    const want = [path.join(dir, 'a'), path.join(dir, 'b')];
    eq(named('a regular .code-workspace on the real file system', () => rd(file)), want, 'a regular .code-workspace on the real file system');
    const sym = path.join(dir, 'sym.code-workspace');
    let linked = false;
    try { fs.symlinkSync(file, sym); linked = true; } catch { console.log('realws: symlinks not allowed here, skipped'); }
    if (linked) eq(named('a symlink to it (read through its resolved path)', () => rd(sym)), want, 'a symlink to it (read through its resolved path)');
    const hard = path.join(dir, 'hard.code-workspace');
    fs.linkSync(file, hard);
    eq(named('a hard link to it', () => rd(hard)), want, 'a hard link to it');
    eq(rd(path.join(dir, 'missing.code-workspace')), [], 'a missing file adds nothing');
    if (process.platform === 'win32') console.log('realws: FIFO case skipped on win32 (no mkfifo)');
    else {
      const fifo = path.join(dir, 'fifo');
      const mk = spawnSync('mkfifo', [fifo]);
      if (mk.status !== 0) console.log('realws: mkfifo not available, FIFO case skipped');
      else {
        const link = path.join(dir, 'fifolink.code-workspace');
        fs.symlinkSync(fifo, link);
        const t0 = Date.now();
        assert.throws(() => rd(link), /workspace unreadable/, 'a FIFO behind a symlink is refused');
        ok(Date.now() - t0 < 5000, 'and fast, it never blocks');
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------------------- stoppick
section('stoppick', async () => {
  // P5: stop cancels a pick whose dialog is still open
  const s = setup();
  let release: (v: string | null) => void = () => undefined;
  const o = new MemoryOps({ store: () => s.store, flavor: POSIX, now: () => 1, ctx: () => nodeMemoryCtx(s.fsx, { home: '/home/ana', userData: '/u' }), officeFolders: () => [], newToken: () => 'ab'.repeat(16),
    pick: () => new Promise<string | null>((res) => { release = res; }) });
  const pending = o.pick();
  eq(o.stop().ok, true, 'stop while the dialog is open');
  release(NOTES);
  eq(await pending, { ok: false, error: 'cancelled' }, 'the dialog answered after stop: no token');
  eq(o.apply('ab'.repeat(16)).ok, false, 'no token was made');
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

// ---------------------------------------------------------------------------------------------------------------------------------- officeadd
section('officeadd', async () => {
  // T008: the office is an OfficeMap; adding a folder re-checks the memory folder (FR-004 rule 4)
  const mk = () => {
    const s = setup();
    const agents = new OfficeMap<string, string>(() => s.ops.recheck());
    const add = (id: string, folder: string): void => { s.office.push(folder); agents.set(id, folder); };
    s.store.folder = NOTES; s.store.on = true;
    return { s, agents, add };
  };
  for (const [what, folder] of [['inside the memory folder', NOTES + '/sub'], ['around the memory folder', '/home/ana']] as const) {
    const { s, agents, add } = mk();
    eq(s.ops.status().state, 'on', what + ': on first');
    eq(named('readRoots before', () => s.ops.readRoots()), [NOTES], what + ': root before');
    const pushed = s.changed.length;
    add('a1', folder);
    eq(agents.get('a1'), folder, what + ': the folder is still added');
    eq(s.changed.length - pushed, 1, what + ': memory:changed pushed exactly once');
    const st = s.ops.status();
    eq(st.state, 'refused', what + ': state refused');
    ok(st.state === 'refused' && (st.reason ?? '').endsWith('The folder: ' + folder.replace('/home/ana/', '~/')), what + ': the reason names the folder');
    eq(s.ops.readRoots(), [], what + ': new sessions get no root');
    eq(s.store.on, true, what + ': nothing stored: on stays as set');
    eq(s.store.writes.length, 0, what + ': no setting was written');
    add('a2', '/work/example.invalid/other');
    eq(s.changed.length - pushed, 1, what + ': a second add changing nothing pushes nothing');
    // the clash goes away: the memory comes back, once
    s.office.length = 0; s.office.push('/work/example.invalid/other');
    agents.delete('a1');
    eq(s.changed.length - pushed, 2, what + ': the clash gone is pushed once');
    eq(s.ops.status().state, 'on', what + ': on again');
  }
  { // an unrelated folder: no change, no push
    const { s, agents, add } = mk();
    s.ops.status();
    const pushed = s.changed.length;
    add('a1', '/work/example.invalid/proj');
    eq(agents.has('a1'), true, 'unrelated: added');
    eq(s.changed.length, pushed, 'unrelated: no push');
    eq(s.ops.readRoots(), [NOTES], 'unrelated: root kept');
  }
  { // no baseline (the window never read it): a clean add pushes nothing, a clash pushes
    const { s, add } = mk();
    add('a1', '/work/example.invalid/proj');
    eq(s.changed.length, 0, 'no baseline, clean: no push');
    add('a2', NOTES);
    eq(s.changed.length, 1, 'no baseline, clash: pushed');
  }
  { // memory off or unlinked: nothing to turn off, no folder looked at
    const { s, add } = mk();
    s.store.on = false;
    const log = s.fsx.log.length;
    add('a1', NOTES);
    eq(s.changed.length, 0, 'off: no push');
    eq(s.fsx.log.length, log, 'off: the folder is not looked at (FR-001)');
    s.store.folder = undefined;
    add('a2', NOTES);
    eq(s.changed.length, 0, 'unlinked: no push');
  }
  { // an unreadable workspace file added to the office refuses and is named
    const { s, add } = mk();
    s.ops.status();
    s.ws['/work/example.invalid/x.code-workspace'] = 'unreadable';
    add('a1', '/work/example.invalid/x.code-workspace');
    const st = s.ops.status();
    eq(st.state, 'refused', 'unreadable workspace: refused');
    ok(st.state === 'refused' && (st.reason ?? '').includes('x.code-workspace'), 'unreadable workspace: named');
  }
  { // a throwing onChange or recheck never breaks the add
    const m = new OfficeMap<string, string>(() => { throw new Error('boom'); });
    m.set('a', 'b');
    eq(m.get('a'), 'b', 'a throwing hook still adds');
    const none = new MemoryOps({ store: () => { throw new Error('x'); }, flavor: POSIX, pick: async () => null, ctx: () => nodeMemoryCtx(fakeFs(), { home: '/h', userData: '/u' }), officeFolders: () => [] });
    none.recheck();
    ok(true, 'recheck never throws');
  }
  { // race: a folder added while the pick dialog is open; apply re-checks and refuses
    const { s, add } = mk();
    s.store.folder = undefined; s.store.on = false;
    s.picks.push(NOTES);
    const p = await s.ops.pick();
    ok(p.ok, 'pick ok');
    add('a1', NOTES + '/sub');
    const r = s.ops.apply(p.ok ? p.token : '');
    eq(r.ok, false, 'a folder added after the pick refuses the apply');
    eq(s.store.writes.length, 0, 'nothing saved');
  }
  { // race: stop / setOn between rechecks are synchronous and leave one coherent state
    const { s, add } = mk();
    s.ops.status();
    add('a1', NOTES + '/sub');
    eq(s.ops.status().state, 'refused', 'refused');
    eq(s.ops.setOn(true).ok, false, 'turning on while the clash lasts is refused');
    eq(s.ops.setOn(false).ok, true, 'turning off');
    const pushed = s.changed.length;
    add('a2', '/work/example.invalid/p2');
    eq(s.changed.length, pushed, 'off: later adds push nothing');
    eq(s.ops.stop().ok, true, 'stop');
    add('a3', NOTES);
    eq(s.ops.status().state, 'off', 'unlinked stays off');
  }
  { // clear() is a removal too
    const { s, agents, add } = mk();
    s.ops.status();
    const pushed = s.changed.length;
    add('a1', NOTES + '/sub');
    eq(s.changed.length - pushed, 1, 'clear: the clash is pushed');
    s.office.length = 0;
    agents.clear();
    eq(agents.size, 0, 'clear: emptied');
    eq(s.changed.length - pushed, 2, 'clear: the clash gone is pushed');
    agents.clear();
    eq(s.changed.length - pushed, 2, 'clear: an empty map notifies nothing');
  }
  { // the saved list (FolderStore) is part of the office: every change to it re-checks, in the real order of a removal
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-memfs-'));
    try {
      const s = setup();
      s.store.folder = NOTES; s.store.on = true;
      const fstore = new FolderStore(path.join(tmp, 'folders.json'));
      const agents = new OfficeMap<string, string>(() => s.ops.recheck());
      fstore.onListChange = () => s.ops.recheck();
      // what main's officeFolders does: the live agents plus the saved rooms, read at each check (the fake ops read `s.office`)
      const sync = (): void => { s.office.length = 0; s.office.push(...new Set([...agents.values(), ...fstore.list().map((f) => f.workspace)])); };
      const read = s.ops.recheck.bind(s.ops);
      s.ops.recheck = () => { sync(); read(); };
      const room = NOTES + '/sub';
      eq(s.ops.status().state, 'on', 'saved: on first');
      const base = s.changed.length;
      fstore.upsert({ workspace: room, permMode: 'read-only' });
      eq(s.changed.length - base, 1, 'saved: a saved room that clashes is pushed by the store');
      sync(); eq(s.ops.status().state, 'refused', 'saved: refused while the room is saved');
      agents.set('a1', room);
      eq(s.changed.length - base, 1, 'saved: the agent for the saved room changes nothing');
      // the real order of folders:remove: the agent leaves first (the room is still saved, still a clash), then the store removal clears it
      agents.delete('a1');
      eq(s.changed.length - base, 1, 'saved: the agent leaving while the room is still saved pushes nothing');
      fstore.remove(room);
      eq(s.changed.length - base, 2, 'saved: the store removal pushes the memory back');
      sync(); eq(s.ops.status().state, 'on', 'saved: on again');
      // a saved room added without any place (setTeamRecord alone) pushes the refusal; the rollback pushes it back
      const rec = { templates: ['T'], members: [{ memberId: 'a'.repeat(32), name: 'M', role: 'r', sendBrief: true, app: 'copilot', mode: 'read-only' as const, sessions: [{ id: 'old-0' }] }] };
      const b2 = s.changed.length;
      ok(fstore.setTeamRecord(room, rec), 'a team record created the room');
      eq(s.changed.length - b2, 1, 'saved: a room added by setTeamRecord is pushed without any place');
      ok(fstore.restoreTeamRecord(room, undefined, [], true), 'the rollback ran');
      eq(fstore.list().length, 0, 'the rollback removed the room');
      eq(s.changed.length - b2, 2, 'saved: the rollback that drops the room pushes the memory back');
      // load() re-reads the file and says so
      let loaded = 0;
      const fresh = new FolderStore(path.join(tmp, 'folders.json'));
      fresh.onListChange = () => { loaded++; };
      fresh.load();
      eq(loaded, 1, 'saved: load notifies');
      // a hook that throws never breaks a list change
      const thrower = new FolderStore(path.join(tmp, 'other.json'));
      thrower.onListChange = () => { throw new Error('boom'); };
      thrower.upsert({ workspace: path.join(tmp, 'x'), permMode: 'read-only' });
      eq(thrower.list().length, 1, 'saved: a throwing list hook still saves');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  // main.ts uses the one hook
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8');
  ok(/const agents = new OfficeMap<string, AgentInfo>\(\(\) => getMemoryOps\(\)\?\.recheck\(\)\)/.test(main), 'main.ts: the agents map is the OfficeMap that re-checks');
  ok(/folderStore\.onListChange = \(\) => getMemoryOps\(\)\?\.recheck\(\)/.test(main), 'main.ts: the saved list re-checks too');
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
  ok(/officeFolders: \(\) => collectOfficeFolders\(/.test(rd('src/main/main.ts')), 'main.ts builds the office folders with collectOfficeFolders (live agents from their own folders)');
  ok(/nodeMemoryCtx\(\s*fs,/.test(rd('src/main/main.ts')), 'main.ts builds the ctx through nodeMemoryCtx(fs, ...), so realpathSync.native');
  ok(!/realpath\s*:\s*fs\.realpathSync[^.]/.test(rd('src/main/main.ts')), 'main.ts never hands the JS realpathSync over');
  eq([...ops.matchAll(/^import [^;]*from '([^']+)'/gm)].map((m) => m[1]).sort(), ['../shared/api', '../shared/cappedread', '../shared/cappedread', '../shared/memoryfolder', '../shared/memoryfolder', 'crypto'], 'memoryops.ts imports: no fs, no Electron, no shell');
  ok(!/child_process|\bspawn|\bexec\(|writeFile|unlink|rmSync|rmdir|mkdir|readFile|readdir/.test(code), 'memoryops.ts writes and removes nothing');
  ok(/\?\? \(\(\) => randomBytes\(16\)\.toString\('hex'\)\)\)\(\)/.test(code) && /import \{ randomBytes \} from 'crypto'/.test(ops), 'the default token is crypto.randomBytes(16), never Math.random');
  ok(!/Math\.random/.test(code), 'memoryops.ts has no Math.random');
  // D4: `.git/config` is opened without blocking, whatever main passes
  const git = rd('src/main/memorygit.ts');
  ok(/O_NONBLOCK: c\.O_NONBLOCK/.test(git) && /O_NOFOLLOW: c\.O_NOFOLLOW/.test(git), 'memoryGitFlags carries O_NOFOLLOW and O_NONBLOCK');
  ok(/memoryGitRemote\(fs, memoryGitFlags\(fs\.constants\), path\.join, real\)/.test(rd('src/main/main.ts')), 'main.ts opens .git/config with memoryGitFlags(fs.constants)');
  const { memoryGitFlags } = require('../src/main/memorygit') as typeof import('../src/main/memorygit');
  eq(memoryGitFlags({ O_RDONLY: 0, O_NOFOLLOW: 4, O_NONBLOCK: 8 }), { O_RDONLY: 0, O_NOFOLLOW: 4, O_NONBLOCK: 8 }, 'flags kept');
  eq(memoryGitFlags(fs.constants).O_NONBLOCK, fs.constants.O_NONBLOCK, 'real constants kept');
  // FR-001: nothing of the memory runs at start or while off: `status` returns before any check, and main only creates the ops when a channel asks
  const st = ops.slice(ops.indexOf('  status(): MemoryStatus {'), ops.indexOf('  /** Main\'s dialog, then T002'));
  ok(st.indexOf('if (!st.memoryOn)') > 0 && st.indexOf('if (!st.memoryOn)') < st.indexOf('this.check('), 'status returns while off before it checks the folder');
  const mainSrc = rd('src/main/main.ts');
  const regStart = mainSrc.indexOf('registerMemoryIpc({');
  ok(regStart > 0 && !mainSrc.slice(0, regStart).includes('memoryOps.') && !mainSrc.slice(mainSrc.indexOf('registerOrgPolicyIpc')).includes('memoryOps.'), 'main.ts uses memoryOps only inside its own wiring');
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
  ok(/'~\/notes\/brain'/.test(fn) && !/\/tmp\/durbar/.test(fn), 'the simulator names an example path only');
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
  const origs = { memoryops: fs.readFileSync(path.join(dir, 'memoryops.js'), 'utf8'), folders: fs.readFileSync(path.join(dir, 'folders.js'), 'utf8') };
  const srcOf = (m: { file?: 'folders' }): string => origs[m.file ?? 'memoryops'];
  const mutate = (text: string, m: { name: string; from: string; to: string }): string => {
    const lf = text.replace(/\r\n/g, '\n');
    assert.ok(lf.includes(m.from), 'mutant anchor not found: ' + m.name);
    return lf.split(m.from).join(m.to);
  };
  const mutants: { name: string; from: string; to: string; section: string; file?: 'folders' }[] = [
    // the two the task names
    { name: 'a path is accepted from the window', from: '    apply(token) {\n', to: "    apply(token) {\n        if (typeof token === 'string' && token.startsWith('/')) this.live = { token, real: token, expiresAt: Infinity };\n", section: 'apply' },
    { name: 'apply without the re-check', from: 'r = this.check(e.chosen);', to: 'r = { ok: true, real: e.real };', section: 'recheck' },
    // review round 1
    { name: 'only the first workspace folder is used', from: 'out.push(...read(e));', to: 'out.push(read(e)[0]);', section: 'workspace' },
    { name: 'an unreadable workspace is ignored', from: "catch (e) {\n            return { ok: false, reason: 'office-folder', text: wsUnreadable(e?.file) };\n        }", to: 'catch (e) {\n            office = [];\n        }', section: 'workspace' },
    { name: 'pick drops the remote', from: ', remote };', to: ' };', section: 'remote' },
    { name: 'the token is bound to the unresolved path', from: 'this.live = { token, chosen, real: r.real,', to: 'this.live = { token, chosen, real: chosen,', section: 'relink' },
    { name: 'apply saves the stored path, not the re-check one', from: 'st.setMemory(r.real)', to: 'st.setMemory(e.real)', section: 'relink' },
    { name: 'apply skips the repoint comparison', from: 'if (!this.same(r.real, e.real))', to: 'if (false)', section: 'relink' },
    { name: 'case folded on every platform', from: "this.deps.flavor.platform === 'linux' ? x : x.toLowerCase()", to: 'x.toLowerCase()', section: 'relink' },
    { name: 'the default token is not from randomBytes', from: "(0, crypto_1.randomBytes)(16).toString('hex')", to: "Math.random().toString(16).slice(2).padEnd(32, '0')", section: 'pick' },
    { name: 'the stat is spread (isFile lost on a real fs.Stats)', from: 'fstatSync: (fd) => { const st = fs.fstatSync(fd); return { isFile: () => st.isFile(), size: st.size, nlink: 1 }; }', to: 'fstatSync: (fd) => ({ ...fs.fstatSync(fd), nlink: 1 })', section: 'realws' },
    { name: 'the workspace file is read without resolving its link', from: 'readCapped)(hardLinksOk, k, real,', to: 'readCapped)(hardLinksOk, k, file,', section: 'wsread' },
    { name: 'a hard-linked workspace file is refused', from: 'size: st.size, nlink: 1 }', to: 'size: st.size, nlink: st.nlink }', section: 'wsread' },
    { name: 'a missing workspace file blocks every pick', from: "if (e?.code === 'ENOENT')\n                return []; // missing or dangling", to: "if (false)\n                return [];", section: 'wsread' },
    { name: 'a missing file after the open blocks every pick', from: "if (r.code === 'missing')\n                return [];", to: "if (false)\n                return [];", section: 'wsread' },
    { name: 'a realpath failure other than missing is ignored', from: "throw new Error('workspace unreadable');\n        }\n        const r =", to: "return [];\n        }\n        const r =", section: 'wsread' },
    { name: 'a live agent is expanded from its file again', from: 'saved.filter((s) => !open.has(s))', to: 'saved', section: 'liveoffice' },
    { name: 'the workspace file is read uncapped', from: 'real, exports.MAX_WORKSPACE_BYTES)', to: 'real, Infinity)', section: 'wsread' },
    { name: 'stop leaves an open pick alive', from: '        this.gen++; // a pick dialog still open answers cancelled\n', to: '', section: 'stoppick' },
    // the same rules from other sides
    { name: 'a token can be used twice', from: '        this.live = undefined;\n        if (this.now() >= e.expiresAt)', to: '        if (this.now() >= e.expiresAt)', section: 'apply' },
    { name: 'a token never expires', from: 'if (this.now() >= e.expiresAt)', to: 'if (false)', section: 'apply' },
    { name: 'any token is taken', from: ' || token !== e.token)', to: ')', section: 'apply' },
    { name: 'the JS realpathSync instead of native', from: 'fs.realpathSync.native(p)', to: 'fs.realpathSync(p)', section: 'ctx' },
    { name: 'a refused pick still gives a token', from: "if (!r.ok) {\n            this.live = undefined;\n            return { ok: false, error: 'refused'", to: "if (false) {\n            this.live = undefined;\n            return { ok: false, error: 'refused'", section: 'pick' },
    { name: 'status looks at the folder while off', from: "if (!st.memoryOn)\n            return { on: false, path, state: 'off', keepInGit };", to: '', section: 'status' },
    { name: 'setOn(true) does not re-check', from: 'if (v) {\n            const folder = st.memoryFolder;', to: 'if (false) {\n            const folder = st.memoryFolder;', section: 'recheck' },
    { name: 'stop checks the folder', from: '        const saved = st.setMemory(undefined);', to: '        this.deps.ctx().lstat("/x");\n        const saved = st.setMemory(undefined);', section: 'stop' },
    // T008
    { name: 'the re-check is skipped when an office folder is added', from: 'set(k, v) { super.set(k, v); this.notify();', to: 'set(k, v) { super.set(k, v);', section: 'officeadd' },
    { name: 'memory:changed is not pushed by the re-check', from: '            this.seen = key;\n            this.deps.changed?.();', to: '            this.seen = key;', section: 'officeadd' },
    { name: 'the added folder is refused instead of added', from: 'set(k, v) { super.set(k, v); this.notify();', to: 'set(k, v) { this.notify();', section: 'officeadd' },
    { name: 'clear() does not notify', from: 'clear() { const n = this.size; super.clear(); if (n > 0)\n        this.notify(); }', to: 'clear() { super.clear(); }', section: 'officeadd' },
    { name: 'the saved list hook is dropped from remove', from: '        this.save();\n        this.listChanged();\n        return true;', to: '        this.save();\n        return true;', section: 'officeadd', file: 'folders' },
    { name: 'the saved list hook is dropped from the team rollback', from: 'if (this.folders !== before.folders)\n                this.listChanged();', to: '', section: 'officeadd', file: 'folders' },
    { name: 'the saved list hook is dropped from setTeamRecord', from: 'if (created)\n                this.listChanged();', to: '', section: 'officeadd', file: 'folders' },
    { name: 'the saved list hook is dropped from upsert', from: 'if (!cur)\n            this.listChanged();', to: '', section: 'officeadd', file: 'folders' },
    { name: 'the saved list hook is dropped from load', from: '        this.listChanged();\n        return this.list();', to: '        return this.list();', section: 'officeadd', file: 'folders' },
    { name: 'stop leaves a pending token', from: '        this.live = undefined;\n        this.gen++;', to: '        this.gen++;', section: 'stop' },
  ];
  const lfOf = (m: { file?: 'folders' }): string => srcOf(m).replace(/\r\n/g, '\n');
  assert.deepStrictEqual(mutants.filter((m) => !lfOf(m).includes(m.from)).map((m) => m.name), [], 'mutant anchors not found');
  for (const m of mutants) assert.strictEqual(lfOf(m).split(m.from).length - 1, 1, 'the anchor of "' + m.name + '" matches exactly once');
  for (const m of mutants) ok(mutate(lfOf(m).replace(/\n/g, '\r\n'), m).length > 0, 'the anchor of "' + m.name + '" is found in a CRLF source');
  assert.throws(() => mutate('no such text', mutants[0]), /mutant anchor not found: /, 'a missing anchor says so');
  let killed = 0;
  let k = 0;
  for (const m of mutants) {
    k++;
    const uniq = `memoryops.mutant-${process.pid}-${k}`;
    const file = path.join(dir, uniq + '.js');
    try {
      const mutated = mutate(srcOf(m), m);
      try { new vm.Script(mutated, { filename: uniq }); } catch (e) { assert.fail('mutant is not valid JavaScript (' + m.name + '): ' + (e as Error).message); }
      fs.writeFileSync(file, mutated);
      const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, m.file === 'folders' ? { FOLDERS_MODULE: uniq } : { MEMORYOPS_MODULE: uniq }), encoding: 'utf8', timeout: 120000 });
      assert.notStrictEqual(r.status, 0, 'mutant NOT killed: ' + m.name);
      const died = [...r.stderr.matchAll(/SECTION (\w+) FAILED/g)].map((x) => x[1]);
      assert.ok(died.includes(m.section), `mutant "${m.name}" must die in section "${m.section}", it died in: ${died.join(',') || r.stderr.slice(0, 200)}`);
      killed++;
    } finally { fs.rmSync(file, { force: true }); }
  }
  assert.strictEqual(killed, mutants.length);
  console.log(`memoryops: ${n} checks passed, ${killed} mutants killed`);
})().catch((e) => { console.error(e); process.exit(1); });
