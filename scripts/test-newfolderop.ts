/**
 * Spec 093 phase 1: the op that creates a folder (src/main/newfolderop.ts) on fakes: the parent token (one use, 10 minutes, never
 * a path from the window), one create at a time, the Windows 200-character rule, the non-recursive claim and its error messages,
 * the private hooks folder, init and empty, removal with retries then the "remove it by hand" message, git missing, `addMany` in
 * the window's mode through `validMode`, and the remembered parent (saved on success only, checked before the picker uses it).
 * No Electron, no git, no disk. `npm run test:newfolderop`.
 */
import * as assert from 'assert';
import * as path from 'path';
import { GIT_MISSING, INIT_LIMIT_MS, PARENT_TOKEN_MS, REMOVE_TRIES, createNewFolderOp, gitLineForWindow } from '../src/main/newfolderop';
import type { NewFolderDeps } from '../src/main/newfolderop';
import type { GitCreateDone, GitCreateRequest } from '../src/main/gitstatus';
import type { AddResult, PermMode } from '../src/shared/api';

const P = path.join(path.sep === '/' ? '/home/u' : 'C:\\Users\\u', 'code');
type Call = [string, ...unknown[]];

function rig(o: { mkdir?: (p: string) => void; rm?: (p: string, n: number) => void; git?: () => GitCreateDone | Promise<GitCreateDone>; add?: (paths: string[], mode: PermMode) => AddResult | Promise<AddResult>; parent?: string; isDir?: (p: string) => boolean; platform?: NodeJS.Platform; noSettings?: boolean; mkdtempFails?: boolean } = {}) {
  const calls: Call[] = [];
  let clock = 1000;
  let tok = 0;
  const timers: Array<{ ms: number; fn: () => void; cleared: boolean }> = [];
  let saved: string | undefined = o.parent;
  const rmTries = new Map<string, number>();
  const cancels: string[] = [];
  const d: NewFolderDeps = {
    fs: {
      mkdir: async (p) => { calls.push(['mkdir', p]); o.mkdir?.(p); },
      rm: async (p) => { const n = (rmTries.get(p) ?? 0) + 1; rmTries.set(p, n); calls.push(['rm', p]); o.rm?.(p, n); },
      mkdtemp: async (prefix) => { calls.push(['mkdtemp', prefix]); if (o.mkdtempFails) throw Object.assign(new Error('x'), { code: 'EACCES' }); return prefix + 'abc'; },
      isDir: async (p) => { calls.push(['isDir', p]); return o.isDir ? o.isDir(p) : true; },
    },
    tmpDir: () => '/tmp',
    runGitCreate: (req: GitCreateRequest, cwd, deps) => {
      calls.push(['git', req.kind, cwd, deps.hooksDir]);
      return { done: Promise.resolve(o.git ? o.git() : { code: 0, signal: null, stderrTail: '' }), cancel: () => { cancels.push(cwd); } };
    },
    addMany: async (paths, mode, opts) => { calls.push(['addMany', paths, mode, opts]); return o.add ? o.add(paths, mode) : { ok: true, agents: [{ id: 'a1', cwd: paths[0] } as never] }; },
    settings: () => (o.noSettings ? undefined : { get newFolderParent() { return saved; }, setNewFolderParent: (p: string) => { calls.push(['save', p]); saved = p; } }),
    now: () => clock,
    newToken: () => `tok-${++tok}`,
    platform: o.platform ?? process.platform,
    sleep: async (ms) => { calls.push(['sleep', ms]); },
    timer: (ms, fn) => { const t = { ms, fn, cleared: false }; timers.push(t); return () => { t.cleared = true; }; },
  };
  return { op: createNewFolderOp(d), calls, timers, cancels, tick: (ms: number) => { clock += ms; }, saved: () => saved, of: (k: string) => calls.filter((c) => c[0] === k) };
}
const pickAt = (dir: string) => async () => dir;
const OPTS = { floor: 'f1', persist: true };
const err = (code: string) => Object.assign(new Error(code), { code });

async function main(): Promise<void> {
  // ---- FR-004, D2: the picker starts at the remembered parent only when it is still a folder ----
  {
    const t = rig({ parent: P });
    let start: string | undefined = 'unset';
    const r = await t.op.pickParent(async (s) => { start = s; return P; });
    assert.deepStrictEqual(r, { ok: true, token: 'tok-1', parent: P });
    assert.strictEqual(start, P, 'starts at the remembered parent');
    const gone = rig({ parent: P, isDir: () => false });
    await gone.op.pickParent(async (s) => { start = s; return undefined; });
    assert.strictEqual(start, undefined, 'a parent that is no longer a folder: the system default, no error');
    const bad = rig({ parent: 'relative/x' });
    await bad.op.pickParent(async (s) => { start = s; return undefined; });
    assert.strictEqual(start, undefined, 'an invalid remembered value is not used');
    assert.deepStrictEqual(bad.of('isDir'), [], 'and not even looked at');
    const none = rig({ noSettings: true });
    await none.op.pickParent(async (s) => { start = s; return undefined; });
    assert.strictEqual(start, undefined);
    assert.deepStrictEqual(await t.op.pickParent(async () => undefined), { ok: false, cancelled: true }, 'cancelled picker');
    assert.deepStrictEqual(await t.op.pickParent(async () => 'rel/x'), { ok: false, error: 'Choose a folder on this computer.' });
  }

  // ---- empty folder: claim, add in the window's mode, remember the parent, spend the token ----
  {
    const t = rig();
    const pk = await t.op.pickParent(pickAt(P));
    assert.ok(pk.ok);
    const tok = pk.ok ? pk.token : '';
    const r = await t.op.create({ kind: 'empty', token: tok, name: 'notes', path: '/etc', parent: '/etc' }, 'ask', OPTS);
    assert.deepStrictEqual(r, { ok: true, agents: [{ id: 'a1', cwd: path.join(P, 'notes') }], name: 'notes' });
    assert.deepStrictEqual(t.calls.filter((c) => c[0] !== 'isDir'), [['mkdir', path.join(P, 'notes')], ['addMany', [path.join(P, 'notes')], 'ask', OPTS], ['save', P]], 'claim, add, remember; no git, nothing else; a path in the request is ignored');
    assert.deepStrictEqual(await t.op.create({ kind: 'empty', token: tok, name: 'again' }, 'ask', OPTS), { ok: false, agents: [], error: 'Choose the place again.', retry: 'place' }, 'the token is spent by a success');
  }
  // ---- FR-061: the mode through validMode (unknown is Read-only) ----
  for (const [m, want] of [['allow', 'allow'], ['ask', 'ask'], ['read-only', 'read-only'], ['ALLOW', 'read-only'], [undefined, 'read-only'], [{}, 'read-only'], ['allow ', 'read-only']] as const) {
    const t = rig();
    const pk = await t.op.pickParent(pickAt(P));
    await t.op.create({ kind: 'empty', token: pk.ok ? pk.token : '', name: 'm' }, m, OPTS);
    assert.strictEqual(t.of('addMany')[0][2], want, `mode ${JSON.stringify(m)} -> ${want}`);
  }

  // ---- FR-005: the token: unknown, missing, expired, replaced; a refusal keeps it valid ----
  {
    const t = rig();
    assert.deepStrictEqual(await t.op.create({ kind: 'empty', token: 'tok-1', name: 'x' }, 'ask', OPTS), { ok: false, agents: [], error: 'Choose the place again.', retry: 'place' }, 'no pick yet');
    const pk = await t.op.pickParent(pickAt(P));
    const tok = pk.ok ? pk.token : '';
    for (const bad of [undefined, '', 'tok-2', 42, { toString: () => tok }]) assert.strictEqual((await t.op.create({ kind: 'empty', token: bad, name: 'x' }, 'ask', OPTS)).error, 'Choose the place again.', `token ${String(bad)}`);
    assert.strictEqual((await t.op.create({ kind: 'empty', token: tok, name: 'a/b' }, 'ask', OPTS)).retry, 'name', 'a refused name');
    t.tick(PARENT_TOKEN_MS);
    assert.strictEqual((await t.op.create({ kind: 'empty', token: tok, name: 'ok1' }, 'ask', OPTS)).ok, true, 'still valid at exactly 10 minutes, and after a refusal');
    const pk2 = await t.op.pickParent(pickAt(P));
    t.tick(PARENT_TOKEN_MS + 1);
    assert.strictEqual((await t.op.create({ kind: 'empty', token: pk2.ok ? pk2.token : '', name: 'ok2' }, 'ask', OPTS)).error, 'Choose the place again.', 'expired after 10 minutes');
    const a = await t.op.pickParent(pickAt(P));
    const b = await t.op.pickParent(pickAt(path.join(P, 'b')));
    assert.strictEqual((await t.op.create({ kind: 'empty', token: a.ok ? a.token : '', name: 'x' }, 'ask', OPTS)).error, 'Choose the place again.', 'a new pick replaces the old one');
    const r = await t.op.create({ kind: 'empty', token: b.ok ? b.token : '', name: 'x' }, 'ask', OPTS);
    assert.ok(r.ok && t.of('mkdir').some((c) => c[1] === path.join(P, 'b', 'x')), 'the folder goes where main picked');
  }

  // ---- refused before anything is created: kind, name, Windows length ----
  {
    const t = rig({ platform: 'win32' });
    const DEEP = path.join(P, 'd'.repeat(120));
    const pk = await t.op.pickParent(pickAt(DEEP));
    const tok = pk.ok ? pk.token : '';
    for (const k of ['clone', 'status', undefined, '', 'EMPTY']) assert.deepStrictEqual(await t.op.create({ kind: k, token: tok, name: 'x' }, 'ask', OPTS), { ok: false, agents: [], error: 'Choose what to create.' }, `kind ${String(k)}`);
    for (const bad of ['', '..', 'a/b', 'a\\b', 'CON', '-x', '.git', 'x.', 'a:b']) assert.strictEqual((await t.op.create({ kind: 'init', token: tok, name: bad }, 'ask', OPTS)).retry, 'name', `name ${bad}`);
    assert.deepStrictEqual(await t.op.create(null, 'ask', OPTS), { ok: false, agents: [], error: 'Choose what to create.' });
    // FR-013: path.win32.join(parent, name) over 200 characters
    const room = 200 - (path.win32.join(DEEP, 'x').length - 1);
    assert.ok(room > 0 && room < 100, 'the deep parent leaves less than a whole name');
    assert.strictEqual((await t.op.create({ kind: 'empty', token: tok, name: 'n'.repeat(room + 1) }, 'ask', OPTS)).error, 'This path is too long for Windows. Choose a shorter place or name.');
    assert.deepStrictEqual(t.calls.filter((c) => c[0] !== 'isDir'), [], 'nothing was created, run or added for any refusal');
    assert.strictEqual((await t.op.create({ kind: 'empty', token: tok, name: 'n'.repeat(room) }, 'ask', OPTS)).ok, true, 'exactly 200 characters is fine');
    const linux = rig({ platform: 'linux' });
    const lp = await linux.op.pickParent(pickAt(P));
    assert.strictEqual((await linux.op.create({ kind: 'empty', token: lp.ok ? lp.token : '', name: 'n'.repeat(100) }, 'ask', OPTS)).ok, true, 'the 200-character rule is for Windows only');
  }
  // ---- check (early feedback): kind and name, nothing created ----
  {
    const t = rig();
    assert.deepStrictEqual(t.op.check({ kind: 'init', name: 'ok' }), { ok: true });
    assert.deepStrictEqual(t.op.check({ kind: 'init', name: 'CON' }), { ok: false, error: 'That name is reserved on Windows (CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM0-9, LPT0-9). Choose another.' });
    assert.deepStrictEqual(t.op.check({ kind: 'clone', name: 'ok' }), { ok: false, error: 'Choose what to create.' });
    assert.deepStrictEqual(t.op.check('init'), { ok: false, error: 'Choose what to create.' });
    assert.deepStrictEqual(t.op.check(Object.create({ kind: 'init', name: 'ok' })), { ok: false, error: 'Choose what to create.' }, 'own properties only');
    assert.deepStrictEqual(t.calls, []);
  }

  // ---- FR-012: the claim's errors; nothing else happens after a failed claim ----
  for (const [code, msg, retry] of [
    ['EEXIST', 'A folder or file named shop already exists there.', 'name'],
    ['EACCES', 'You cannot create a folder there: it is read-only or not yours. Choose another place.', 'place'],
    ['EPERM', 'You cannot create a folder there: it is read-only or not yours. Choose another place.', 'place'],
    ['EROFS', 'You cannot create a folder there: it is read-only or not yours. Choose another place.', 'place'],
    ['ENOENT', 'That place no longer exists. Choose another place.', 'place'],
    ['ENOSPC', 'The disk is full. Free some space or choose another place.', 'place'],
    ['EIO', 'You cannot create a folder there (EIO). Choose another place.', 'place'],
  ] as const) {
    const t = rig({ mkdir: () => { throw err(code); } });
    const pk = await t.op.pickParent(pickAt(P));
    const r = await t.op.create({ kind: 'init', token: pk.ok ? pk.token : '', name: 'shop' }, 'ask', OPTS);
    assert.deepStrictEqual(r, { ok: false, agents: [], error: msg, retry }, code);
    assert.deepStrictEqual(t.calls.filter((c) => c[0] !== 'isDir').map((c) => c[0]), ['mkdir'], `${code}: no git, no removal (the folder is not ours), no add`);
    assert.strictEqual(t.saved(), undefined, `${code}: nothing remembered`);
  }

  // ---- new repository: the private hooks folder, git in the new folder, the hooks folder removed after every run ----
  {
    const t = rig();
    const pk = await t.op.pickParent(pickAt(P));
    const r = await t.op.create({ kind: 'init', token: pk.ok ? pk.token : '', name: 'repo' }, 'allow', OPTS);
    assert.ok(r.ok);
    const target = path.join(P, 'repo');
    assert.deepStrictEqual(t.calls.filter((c) => c[0] !== 'isDir'), [['mkdir', target], ['mkdtemp', path.join('/tmp', 'durbar-hooks-')], ['git', 'init', target, path.join('/tmp', 'durbar-hooks-') + 'abc'], ['rm', path.join('/tmp', 'durbar-hooks-') + 'abc'], ['addMany', [target], 'allow', OPTS], ['save', P]]);
    assert.deepStrictEqual(t.timers.map((x) => [x.ms, x.cleared]), [[INIT_LIMIT_MS, true]], 'the time limit is cleared when git ends');
  }
  // ---- git fails, is missing, or runs too long: the claimed folder and the hooks folder are removed, nothing added or saved ----
  for (const [what, git, msg] of [
    ['fails', () => ({ code: 128, signal: null, stderrTail: 'hint: x\nfatal: cannot mkdir https://u:hunter2@h/x in /home/u/secret: Permission denied\n' }), 'git init failed: fatal: cannot mkdir https://[redacted]@h/x in ~/secret: Permission denied'],
    ['missing', () => ({ code: null, signal: null, stderrTail: '', spawnError: 'ENOENT' }), GIT_MISSING],
    ['other spawn error', () => ({ code: null, signal: null, stderrTail: '', spawnError: 'EACCES' }), 'git init failed.'],
  ] as const) {
    const t = rig({ git: git as () => GitCreateDone });
    const pk = await t.op.pickParent(pickAt(P));
    const r = await t.op.create({ kind: 'init', token: pk.ok ? pk.token : '', name: 'repo' }, 'ask', OPTS);
    assert.deepStrictEqual(r, { ok: false, agents: [], error: msg }, what);
    const seq = t.calls.filter((c) => c[0] !== 'isDir').map((c) => c[0] + (c[0] === 'rm' ? ':' + path.basename(String(c[1])) : ''));
    assert.deepStrictEqual(seq, ['mkdir', 'mkdtemp', 'git', 'rm:durbar-hooks-abc', 'rm:repo'], `${what}: the hooks folder and the claimed folder are removed, nothing added`);
    assert.strictEqual(t.saved(), undefined, `${what}: the parent is not remembered`);
    assert.ok(!/hunter2/.test(String(r.error)), 'no credential in the message');
  }
  {
    // the 30 s limit: the timer ends git (cancel), then the folder goes
    let release: (d: GitCreateDone) => void = () => undefined;
    const t = rig({ git: () => new Promise<GitCreateDone>((res) => { release = res; }) });
    const pk = await t.op.pickParent(pickAt(P));
    const p = t.op.create({ kind: 'init', token: pk.ok ? pk.token : '', name: 'slow' }, 'ask', OPTS);
    await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(await t.op.create({ kind: 'empty', token: pk.ok ? pk.token : '', name: 'second' }, 'ask', OPTS), { ok: false, agents: [], error: 'A folder is still being created.' }, 'FR-042: one create at a time');
    assert.strictEqual(t.timers.length, 1);
    t.timers[0].fn();
    assert.deepStrictEqual(t.cancels, [path.join(P, 'slow')], 'the limit ends git');
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.ok(!t.of('rm').some((c) => c[1] === path.join(P, 'slow')), 'the folder is not removed before git has ended (FR-041/FR-050 order)');
    release({ code: null, signal: 'SIGTERM', stderrTail: '' });
    const r = await p;
    assert.deepStrictEqual(r, { ok: false, agents: [], error: 'git init did not finish in time.' });
    const order = t.calls.map((c) => c[0]);
    assert.ok(order.indexOf('rm') > order.indexOf('git'), 'removal only after git ended');
    assert.ok(t.of('rm').some((c) => c[1] === path.join(P, 'slow')));
    assert.strictEqual((await t.op.create({ kind: 'empty', token: pk.ok ? pk.token : '', name: 'third' }, 'ask', OPTS)).ok, true, 'the lock is released after a failure');
  }
  {
    // no temporary folder for the hooks: nothing runs, the claimed folder goes
    const t = rig({ mkdtempFails: true });
    const pk = await t.op.pickParent(pickAt(P));
    const r = await t.op.create({ kind: 'init', token: pk.ok ? pk.token : '', name: 'repo' }, 'ask', OPTS);
    assert.strictEqual(r.error, 'Could not prepare git (no temporary folder).');
    assert.deepStrictEqual(t.of('git'), [], 'git never runs without the private hooks folder');
    assert.deepStrictEqual(t.of('rm').map((c) => c[1]), [path.join(P, 'repo')]);
  }

  // ---- FR-050: removal retries (Windows locks), then the by-hand message naming the folder ----
  {
    const t = rig({ git: () => ({ code: 1, signal: null, stderrTail: 'fatal: x' }), rm: (p, n) => { if (path.basename(p) === 'repo' && n < 3) throw err('EBUSY'); } });
    const pk = await t.op.pickParent(pickAt(P));
    const r = await t.op.create({ kind: 'init', token: pk.ok ? pk.token : '', name: 'repo' }, 'ask', OPTS);
    assert.deepStrictEqual(r.error, 'git init failed: fatal: x');
    assert.strictEqual(t.of('rm').filter((c) => c[1] === path.join(P, 'repo')).length, 3, 'removed on the third try');
    assert.deepStrictEqual(t.of('sleep'), [['sleep', 500], ['sleep', 500]]);
  }
  {
    const t = rig({ git: () => ({ code: 1, signal: null, stderrTail: '' }), rm: (p) => { if (path.basename(p) === 'repo') throw err('EPERM'); } });
    const pk = await t.op.pickParent(pickAt(P));
    const r = await t.op.create({ kind: 'init', token: pk.ok ? pk.token : '', name: 'repo' }, 'ask', OPTS);
    assert.strictEqual(r.error, `git init failed. The folder ${path.join(P, 'repo')} could not be removed: remove it by hand.`);
    assert.strictEqual(t.of('rm').filter((c) => c[1] === path.join(P, 'repo')).length, REMOVE_TRIES, `${REMOVE_TRIES} tries`);
  }
  {
    const t = rig({ git: () => ({ code: 1, signal: null, stderrTail: '' }), rm: (p) => { if (path.basename(p) === 'repo') throw err('ENOTDIR'); } });
    const pk = await t.op.pickParent(pickAt(P));
    const r = await t.op.create({ kind: 'init', token: pk.ok ? pk.token : '', name: 'repo' }, 'ask', OPTS);
    assert.match(String(r.error), /remove it by hand/);
    assert.strictEqual(t.of('rm').filter((c) => c[1] === path.join(P, 'repo')).length, 1, 'an error that a retry cannot fix is not retried');
  }

  // ---- the add fails (or throws, or adds nothing): the folder goes, nothing remembered, the token stays ----
  for (const [what, add] of [
    ['refused', () => ({ ok: false, agents: [], error: 'repo: Claude Code is not ready' })],
    ['empty', () => ({ ok: true, agents: [] })],
    ['throws', () => { throw new Error('boom'); }],
  ] as const) {
    const t = rig({ add: add as never });
    const pk = await t.op.pickParent(pickAt(P));
    const tok = pk.ok ? pk.token : '';
    const r = await t.op.create({ kind: 'empty', token: tok, name: 'repo' }, 'ask', OPTS);
    assert.strictEqual(r.ok, false, what);
    assert.match(String(r.error), /^Could not add the new folder: /);
    assert.deepStrictEqual(t.of('rm').map((c) => c[1]), [path.join(P, 'repo')], `${what}: removed`);
    assert.strictEqual(t.saved(), undefined, `${what}: not remembered`);
  }

  // ---- FR-070: git's line for the window: masked, then cut ----
  assert.strictEqual(gitLineForWindow(''), '');
  assert.strictEqual(gitLineForWindow('a\r\nb\rlast line \n\n'), 'last line');
  const tokenLine = 'fatal: ' + 'x'.repeat(280) + ' ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  const shown = gitLineForWindow(tokenLine);
  assert.ok(shown.length <= 300 && !/ghp_a1B2/.test(shown), 'masked before it is cut (no token head survives): ' + shown.slice(-40));
  console.log('newfolderop: token, lock, claim errors, init and empty, hooks folder, cleanup retries, git missing, mode, remembered parent OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
