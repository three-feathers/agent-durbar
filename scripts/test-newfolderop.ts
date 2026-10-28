/**
 * Spec 093: the op that creates a folder (src/main/newfolderop.ts) on fakes. Phase 2 (clone): the URL checked before anything is
 * created, the clone's call (hooks folder, the user's core.sshCommand), progress throttled to 250 ms and masked, FR-044's waiting
 * line on an injected clock, Cancel (git ended first, the folder removed only after it exited), quit, failure texts, the submodule
 * note. Phase 1: the parent token (one use, 10 minutes, never
 * a path from the window), one create at a time, the Windows 200-character rule, the non-recursive claim and its error messages,
 * the private hooks folder, init and empty, removal with retries then the "remove it by hand" message, git missing, `addMany` in
 * the window's mode through `validMode`, and the remembered parent (saved on success only, checked before the picker uses it).
 * No Electron, no git, no disk. `npm run test:newfolderop`.
 */
// an async test whose promise never settles lets Node exit 0 without the OK line: fail unless the success path is reached
process.exitCode = 1;
import * as assert from 'assert';
import * as path from 'path';
import { CANCELLED, GIT_MISSING, INIT_LIMIT_MS, PARENT_TOKEN_MS, PROGRESS_MS, QUIT_WAIT_MS, REMOVE_TRIES, WAITING_MS, createNewFolderOp, gitLineForWindow } from '../src/main/newfolderop';
import type { CreateProgress, NewFolderDeps } from '../src/main/newfolderop';
import type { GitCreateDeps, GitCreateDone, GitCreateRequest } from '../src/main/gitstatus';
import type { AddResult, PermMode } from '../src/shared/api';

const P = path.join(path.sep === '/' ? '/home/u' : 'C:\\Users\\u', 'code');
type Call = [string, ...unknown[]];

function rig(o: { mkdir?: (p: string) => void; rm?: (p: string, n: number) => void; git?: (deps: GitCreateDeps) => GitCreateDone | Promise<GitCreateDone>; add?: (paths: string[], mode: PermMode) => AddResult | Promise<AddResult>; parent?: string; isDir?: (p: string) => boolean; platform?: NodeJS.Platform; noSettings?: boolean; mkdtempFails?: boolean; exists?: (p: string) => boolean; ssh?: () => Promise<string | undefined> } = {}) {
  const calls: Call[] = [];
  let clock = 1000;
  let tok = 0;
  const timers: Array<{ ms: number; fn: () => void; cleared: boolean }> = [];
  let saved: string | undefined = o.parent;
  const rmTries = new Map<string, number>();
  const cancels: string[] = [];
  const events: CreateProgress[] = [];
  const gitDeps: GitCreateDeps[] = [];
  const d: NewFolderDeps = {
    fs: {
      mkdir: async (p) => { calls.push(['mkdir', p]); o.mkdir?.(p); },
      rm: async (p) => { const n = (rmTries.get(p) ?? 0) + 1; rmTries.set(p, n); calls.push(['rm', p]); o.rm?.(p, n); },
      mkdtemp: async (prefix) => { calls.push(['mkdtemp', prefix]); if (o.mkdtempFails) throw Object.assign(new Error('x'), { code: 'EACCES' }); return prefix + 'abc'; },
      isDir: async (p) => { calls.push(['isDir', p]); return o.isDir ? o.isDir(p) : true; },
      exists: async (p) => { calls.push(['exists', p]); return o.exists ? o.exists(p) : false; },
    },
    tmpDir: () => '/tmp',
    runGitCreate: (req: GitCreateRequest, cwd, deps) => {
      calls.push(req.kind === 'clone' ? ['git', req.kind, cwd, deps.hooksDir, req.url, deps.userSshCommand] : ['git', req.kind, cwd, deps.hooksDir]);
      gitDeps.push(deps);
      return { done: Promise.resolve(o.git ? o.git(deps) : { code: 0, signal: null, stderrTail: '' }), cancel: () => { calls.push(['cancel', cwd]); cancels.push(cwd); } };
    },
    readSshCommand: async (h, url) => { calls.push(['readSsh', h, url]); return o.ssh ? o.ssh() : undefined; },
    progress: (p) => { events.push(p); },
    addMany: async (paths, mode, opts) => { calls.push(['addMany', paths, mode, opts]); return o.add ? o.add(paths, mode) : { ok: true, agents: [{ id: 'a1', cwd: paths[0] } as never] }; },
    settings: () => (o.noSettings ? undefined : { get newFolderParent() { return saved; }, setNewFolderParent: (p: string) => { calls.push(['save', p]); saved = p; } }),
    now: () => clock,
    newToken: () => `tok-${++tok}`,
    platform: o.platform ?? process.platform,
    sleep: async (ms) => { calls.push(['sleep', ms]); },
    timer: (ms, fn) => { const t = { ms, fn, cleared: false }; timers.push(t); return () => { t.cleared = true; }; },
  };
  return { op: createNewFolderOp(d), calls, timers, cancels, events, gitDeps, tick: (ms: number) => { clock += ms; }, saved: () => saved, of: (k: string) => calls.filter((c) => c[0] === k), live: () => timers.filter((x) => !x.cleared) };
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
    for (const k of ['status', undefined, '', 'EMPTY', 'Clone']) assert.deepStrictEqual(await t.op.create({ kind: k, token: tok, name: 'x' }, 'ask', OPTS), { ok: false, agents: [], error: 'Choose what to create.' }, `kind ${String(k)}`);
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
    assert.deepStrictEqual(t.op.check({ kind: 'init', name: 'CON' }), { ok: false, error: 'That name is reserved on Windows (CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM0-9, LPT0-9). Choose another.', retry: 'name' });
    assert.deepStrictEqual(t.op.check({ kind: 'status', name: 'ok' }), { ok: false, error: 'Choose what to create.' });
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
  // the shared invisible lists (src/shared/names.ts) plus ZWNJ/ZWJ/LRM/RLM and the Arabic letter mark are removed from git's text
  assert.strictEqual(gitLineForWindow('remote: a\u2028b\u061cc\u00add\u034fe\u3164f\ufff9g\u200ch\u200fi\u202ej'), 'remote: a b c d e f g h i j');
  assert.strictEqual(gitLineForWindow('Host key verification failed.\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n'), 'fatal: Could not read from remote repository.', "git's fatal line, not its closing paragraph");
  const tokenLine = 'fatal: ' + 'x'.repeat(280) + ' ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  const shown = gitLineForWindow(tokenLine);
  assert.ok(shown.length <= 300 && !/ghp_a1B2/.test(shown), 'masked before it is cut (no token head survives): ' + shown.slice(-40));
  await cloneCases();
  process.exitCode = 0;
  console.log('newfolderop: token, lock, claim errors, init, empty and clone, URL refusals, progress throttle and masking, waiting line, Cancel order, quit, hooks folder, cleanup retries, git missing, mode, remembered parent OK');
}

const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const URL1 = 'https://github.com/lena/shop.git';
/** A git run the test ends by hand (`end`), and that records what the op handed it. */
function held(): { git: (deps: GitCreateDeps) => Promise<GitCreateDone>; end: (d: GitCreateDone) => void; out: (t: string) => void } {
  let resolve: (d: GitCreateDone) => void = () => undefined;
  let deps: GitCreateDeps | undefined;
  return {
    git: (dp) => { deps = dp; return new Promise<GitCreateDone>((r) => { resolve = r; }); },
    end: (d) => resolve(d),
    out: (t) => deps?.onOutput?.(t),
  };
}

async function cloneCases(): Promise<void> {
  // ---- check (FR-022): the URL first (the host, the suggested name, the URL masked for display); then the name; nothing runs ----
  {
    const t = rig();
    assert.deepStrictEqual(t.op.check({ kind: 'clone', url: 'https://lena@github.com/o/shop.git' }), { ok: true, host: 'github.com', suggested: 'shop', shown: 'https://[redacted]@github.com/o/shop.git' }, 'the user part is masked in the shown URL, never in the host');
    assert.deepStrictEqual(t.op.check({ kind: 'clone', url: 'file:///etc' }), { ok: false, error: 'Use an https:// or ssh address (for example git@github.com:owner/repo.git).', retry: 'url' });
    assert.deepStrictEqual(t.op.check({ kind: 'clone', url: 'https://lena:hunter2@h/x.git' }), { ok: false, error: 'Remove the password from the address. Durbar uses your own git credentials.', retry: 'url' });
    assert.deepStrictEqual(t.op.check({ kind: 'clone', url: URL1, name: '..' }), { ok: false, error: 'Use a name other than . or ..', retry: 'name' });
    assert.strictEqual(t.op.check({ kind: 'clone', url: URL1, name: 'shop' }).ok, true);
    assert.strictEqual(t.op.check(Object.assign(Object.create({ url: URL1 }), { kind: 'clone' })).ok, false, 'own properties only: an inherited url is not read');
    assert.deepStrictEqual(t.calls, [], 'check creates and runs nothing');
  }
  // ---- a refused URL never reaches mkdir or git (FR-022: create checks again) ----
  {
    const t = rig();
    const pk = await t.op.pickParent(pickAt(P));
    const tok = pk.ok ? pk.token : '';
    for (const bad of ['file:///etc', 'ext::sh -c touch x', '-uhelp', 'C:\\repos\\x', 'https://lena:hunter2@host/x.git', 'https://u%3Ap@h/x', undefined, 42, '']) {
      const r = await t.op.create({ kind: 'clone', token: tok, name: 'shop', url: bad }, 'allow', OPTS);
      assert.deepStrictEqual([r.ok, r.retry], [false, 'url'], `refused: ${String(bad)}`);
    }
    assert.deepStrictEqual(t.calls.filter((c) => c[0] !== 'isDir'), [], 'nothing created, run or added');
  }
  // ---- the happy clone: claim, hooks folder, the user's ssh command read there, git in the new folder, add, remember ----
  {
    const t = rig({ ssh: async () => 'ssh -i ~/.ssh/work', exists: (p) => p.endsWith('.gitmodules') });
    const pk = await t.op.pickParent(pickAt(P));
    const r = await t.op.create({ kind: 'clone', token: pk.ok ? pk.token : '', name: 'shop', url: URL1, path: '/etc' }, 'ask', OPTS);
    const target = path.join(P, 'shop');
    const hooks = path.join('/tmp', 'durbar-hooks-') + 'abc';
    assert.deepStrictEqual(r, { ok: true, agents: [{ id: 'a1', cwd: target }], name: 'shop', submodules: true }, 'the submodule note when .gitmodules exists');
    assert.deepStrictEqual(t.calls.filter((c) => c[0] !== 'isDir'), [['mkdir', target], ['mkdtemp', path.join('/tmp', 'durbar-hooks-')], ['readSsh', hooks, URL1], ['git', 'clone', target, hooks, URL1, 'ssh -i ~/.ssh/work'], ['rm', hooks], ['exists', path.join(target, '.gitmodules')], ['addMany', [target], 'ask', OPTS], ['save', P]]);
    assert.ok(!('protocols' in t.gitDeps[0]), 'the op never passes the protocols seam');
    assert.deepStrictEqual(t.live(), [], 'no timer left running after the clone');
    const n = rig();
    const pn = await n.op.pickParent(pickAt(P));
    assert.strictEqual((await n.op.create({ kind: 'clone', token: pn.ok ? pn.token : '', name: 'shop', url: URL1 }, 'ask', OPTS)).submodules, undefined, 'no .gitmodules: no note');
  }
  // ---- FR-071: failures in plain words, git's line masked under it; the folder and hooks folder go; nothing added or saved ----
  for (const [tail, want] of [
    ['Cloning into \'.\'...\nfatal: Authentication failed for \'https://lena:hunter2@github.com/lena/shop.git/\'\n', /^Sign-in failed: Durbar uses your own git credentials and cannot ask for a password\. Set up a credential helper or an ssh agent, then try again\. git said: fatal: Authentication failed for 'https:\/\/\[redacted\]@github\.com\/lena\/shop\.git\/'$/],
    ['Host key verification failed.\r\nfatal: Could not read from remote repository.\n', /^The ssh host key of github\.com is not known yet\. Connect once with ssh in a terminal, then try again\. git said: fatal: Could not read from remote repository\.$/],
    ['fatal: something odd in /home/u/secret ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8\n', /^The clone failed\. git said: fatal: something odd in ~\/secret \[redacted\]/],
  ] as Array<[string, RegExp]>) {
    const t = rig({ git: () => ({ code: 128, signal: null, stderrTail: tail }) });
    const pk = await t.op.pickParent(pickAt(P));
    const r = await t.op.create({ kind: 'clone', token: pk.ok ? pk.token : '', name: 'shop', url: URL1 }, 'ask', OPTS);
    assert.strictEqual(r.ok, false);
    assert.match(String(r.error), want);
    assert.ok(!/hunter2|ghp_a1B2|\/home\/u/.test(String(r.error)), 'masked');
    assert.deepStrictEqual(t.of('rm').map((c) => path.basename(String(c[1]))), ['durbar-hooks-abc', 'shop'], 'hooks folder, then the claimed folder');
    assert.deepStrictEqual([t.of('addMany').length, t.saved()], [0, undefined]);
  }
  {
    const t = rig({ git: () => ({ code: null, signal: null, stderrTail: '', spawnError: 'ENOENT' }) });
    const pk = await t.op.pickParent(pickAt(P));
    assert.strictEqual((await t.op.create({ kind: 'clone', token: pk.ok ? pk.token : '', name: 'shop', url: URL1 }, 'ask', OPTS)).error, GIT_MISSING, 'FR-062 for a clone too');
    assert.ok(t.of('rm').some((c) => c[1] === path.join(P, 'shop')));
  }
  // ---- FR-040, FR-070: progress at most every 250 ms, whole lines only, the last 6, each masked then cut; FR-044 waiting line ----
  {
    const g = held();
    const t = rig({ git: g.git });
    const pk = await t.op.pickParent(pickAt(P));
    const run = t.op.create({ kind: 'clone', token: pk.ok ? pk.token : '', name: 'shop', url: URL1 }, 'ask', OPTS);
    await flush();
    const wait = t.live().find((x) => x.ms === WAITING_MS);
    assert.ok(wait, 'the 30 s waiting timer is armed when git starts');
    // FR-044: 30 s without output and no progress line: one event with waiting; the next output removes it
    wait!.fn();
    assert.deepStrictEqual(t.events, [{ lines: [], elapsedMs: 0, waiting: true }]);
    t.tick(10);
    g.out("Cloning into '.'...\n");
    assert.deepStrictEqual(t.events[1], { lines: ["Cloning into '.'..."], elapsedMs: 10 }, 'output: the waiting line goes at once');
    // throttle: a second piece 100 ms later waits for the 250 ms gap; a third joins it; one event when the timer fires
    t.tick(100);
    g.out('remote: Counting objects:  50% (1/2)\r');
    t.tick(20);
    g.out('remote: Counting objects: 100% (2/2), done.\nReceiving objects:  45% (9/20), https://u:secret@h/x in /home/u/code\rReceiving obj');
    assert.strictEqual(t.events.length, 2, 'no event before 250 ms have passed');
    const sendT = t.live().filter((x) => x.ms !== WAITING_MS);
    assert.deepStrictEqual(sendT.map((x) => x.ms), [PROGRESS_MS - 100], 'one timer for the rest of the gap');
    t.tick(130);
    sendT[0].fn();
    const e = t.events[2];
    assert.deepStrictEqual([e.phase, e.percent, e.elapsedMs], ['Receiving objects', 45, 260]);
    assert.deepStrictEqual(e.lines, ["Cloning into '.'...", 'remote: Counting objects:  50% (1/2)', 'remote: Counting objects: 100% (2/2), done.', 'Receiving objects:  45% (9/20), https://[redacted]@h/x in ~/code'], 'whole lines only (the cut-off "Receiving obj" waits), masked');
    // after a progress line, a quiet 30 s adds no waiting line
    t.live().find((x) => x.ms === WAITING_MS)!.fn();
    assert.strictEqual(t.events.length, 3, 'no waiting line once git has shown progress');
    // the last 6 lines, each cut to 300 characters after masking; control and bidi characters removed
    t.tick(PROGRESS_MS);
    g.out(['a', 'b', 'c', 'd', 'e', 'remote: \u001b[31mred\u202e' + 'z'.repeat(400) + ' ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('\n') + '\n');
    const last: string[] = [...t.events[t.events.length - 1].lines];
    const l5 = String(last[5]);
    assert.strictEqual(last.length, 6);
    assert.deepStrictEqual(last.slice(0, 5), ['Receiving obja', 'b', 'c', 'd', 'e'], 'the last six lines (the cut-off line was completed by the next piece)');
    assert.ok(l5.length === 300 && !/[\u001b\u202e]/.test(l5) && /^remote: +\[31mred +z/.test(l5) && !/ghp_/.test(l5), 'cut to 300 after masking, no control or bidi character: ' + l5.slice(0, 30));
    assert.ok(t.events.every((x) => !JSON.stringify(x).includes('secret') && !JSON.stringify(x).includes('/home/u')), 'no credential or home path in any event');
    assert.ok(t.events.every((x) => x.lines.length <= 6 && x.lines.every((l) => l.length <= 300)));
    g.end({ code: 0, signal: null, stderrTail: '' });
    assert.strictEqual((await run).ok, true);
    const n = t.events.length;
    for (const x of t.timers) if (!x.cleared) x.fn();
    assert.strictEqual(t.events.length, n, 'nothing is sent after the clone ended');
  }
  // ---- FR-041: Cancel ends git first; the folder is removed only after git has exited; nothing added; the lock is released ----
  {
    const g = held();
    const t = rig({ git: g.git });
    const pk = await t.op.pickParent(pickAt(P));
    const tok = pk.ok ? pk.token : '';
    assert.deepStrictEqual(t.op.cancel(), { ok: false }, 'nothing to cancel yet');
    const run = t.op.create({ kind: 'clone', token: tok, name: 'shop', url: URL1 }, 'ask', OPTS);
    await flush();
    assert.strictEqual(t.op.busy(), true);
    assert.deepStrictEqual(await t.op.create({ kind: 'empty', token: tok, name: 'other' }, 'ask', OPTS), { ok: false, agents: [], error: 'A folder is still being created.' }, 'FR-042');
    assert.deepStrictEqual(t.op.cancel(), { ok: true });
    assert.deepStrictEqual(t.cancels, [path.join(P, 'shop')], "git's tree is ended (the runner's killChildTree)");
    await flush();
    assert.ok(!t.of('rm').some((c) => c[1] === path.join(P, 'shop')), 'not removed while git still runs');
    g.end({ code: null, signal: 'SIGTERM', stderrTail: 'fatal: early EOF' });
    const r = await run;
    assert.deepStrictEqual(r, { ok: false, agents: [], cancelled: true, error: CANCELLED });
    const order = t.calls.map((c) => c[0] + (c[0] === 'rm' ? ':' + path.basename(String(c[1])) : ''));
    assert.ok(order.indexOf('rm:shop') > order.indexOf('cancel'), 'removed after the cancel and git\'s end');
    assert.deepStrictEqual([t.of('addMany').length, t.saved(), t.op.busy()], [0, undefined, false]);
    assert.deepStrictEqual(t.op.cancel(), { ok: false }, 'after the end: nothing is killed again (its pid may be another process now)');
    assert.deepStrictEqual(t.cancels.length, 1);
    assert.strictEqual((await t.op.create({ kind: 'empty', token: tok, name: 'next' }, 'ask', OPTS)).ok, true, 'the token and the lock are free again');
  }
  {
    // Cancel before git starts (while the ssh command is read): git never runs, the folder goes
    let release: (v: string | undefined) => void = () => undefined;
    const t = rig({ ssh: () => new Promise((r) => { release = r; }) });
    const pk = await t.op.pickParent(pickAt(P));
    const run = t.op.create({ kind: 'clone', token: pk.ok ? pk.token : '', name: 'shop', url: URL1 }, 'ask', OPTS);
    await flush();
    t.op.cancel();
    release('ssh');
    const r = await run;
    assert.strictEqual(r.cancelled, true);
    assert.deepStrictEqual(t.of('git'), [], 'git never started');
    assert.ok(t.of('rm').some((c) => c[1] === path.join(P, 'shop')));
  }
  {
    // a cancel that arrives after git ended well but before the add: honoured, the folder goes
    const g = held();
    const t2 = rig({ git: g.git });
    const pk2 = await t2.op.pickParent(pickAt(P));
    const run = t2.op.create({ kind: 'clone', token: pk2.ok ? pk2.token : '', name: 'shop', url: URL1 }, 'ask', OPTS);
    await flush();
    g.end({ code: 0, signal: null, stderrTail: '' });
    t2.op.cancel();
    const r = await run;
    assert.strictEqual(r.cancelled, true, 'cancelled between the end of git and the add');
    assert.deepStrictEqual(t2.of('addMany'), [], 'not added');
  }
  {
    // a Cancel that arrives after the clone, while the op still looks for .gitmodules: honoured, the folder goes, nothing added
    let opRef: ReturnType<typeof rig>['op'] | undefined;
    const t = rig({ exists: () => { opRef?.cancel(); return false; } });
    opRef = t.op;
    const pk = await t.op.pickParent(pickAt(P));
    const r = await t.op.create({ kind: 'clone', token: pk.ok ? pk.token : '', name: 'shop', url: URL1 }, 'ask', OPTS);
    assert.deepStrictEqual([r.ok, r.cancelled, r.error], [false, true, CANCELLED], 'cancelled after git, before the add');
    assert.deepStrictEqual([t.of('addMany').length, t.saved()], [0, undefined]);
    assert.ok(t.of('rm').some((c) => c[1] === path.join(P, 'shop')), 'the folder is removed');
  }
  // the runner refuses the call (it throws): nothing ran, the folder and the hooks folder go, the lock is free
  for (const kind of ['clone', 'init'] as const) {
    const t = rig({ git: () => { throw new Error('git: clone URL not allowed'); } });
    const pk = await t.op.pickParent(pickAt(P));
    const r = await t.op.create({ kind, token: pk.ok ? pk.token : '', name: 'shop', url: URL1 }, 'ask', OPTS);
    assert.deepStrictEqual([r.ok, r.error], [false, 'Could not start git.'], kind);
    assert.deepStrictEqual(t.of('rm').map((c) => path.basename(String(c[1]))), ['durbar-hooks-abc', 'shop'], `${kind}: hooks folder and folder removed`);
    assert.strictEqual(t.op.busy(), false);
  }
  // ---- FR-043: quit ends a running clone and waits for its cleanup, at most 5 s ----
  {
    const g = held();
    const t = rig({ git: g.git });
    assert.strictEqual(await t.op.quit(), true, 'nothing running: quit at once');
    const pk = await t.op.pickParent(pickAt(P));
    const run = t.op.create({ kind: 'clone', token: pk.ok ? pk.token : '', name: 'shop', url: URL1 }, 'ask', OPTS);
    await flush();
    const q = t.op.quit();
    await flush();
    assert.deepStrictEqual(t.cancels, [path.join(P, 'shop')], 'quit ends git');
    assert.ok(t.live().some((x) => x.ms === QUIT_WAIT_MS), 'a bounded wait');
    g.end({ code: null, signal: 'SIGTERM', stderrTail: '' });
    assert.strictEqual(await q, true);
    assert.strictEqual((await run).cancelled, true);
    assert.ok(t.of('rm').some((c) => c[1] === path.join(P, 'shop')), 'the folder is removed before quit answers');
    const g2 = held();
    const t2 = rig({ git: g2.git });
    const p2 = await t2.op.pickParent(pickAt(P));
    void t2.op.create({ kind: 'clone', token: p2.ok ? p2.token : '', name: 'stuck', url: URL1 }, 'ask', OPTS);
    await flush();
    const q2 = t2.op.quit();
    await flush();
    t2.live().find((x) => x.ms === QUIT_WAIT_MS)!.fn();
    assert.strictEqual(await q2, false, 'a git that does not end: quit gives up after 5 s (the folder is left, a known gap)');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
