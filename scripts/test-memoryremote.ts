/**
 * Office memory (spec 116 FR-051, FR-055): `remoteHosts` (the parser) and `memoryGitRemote` (main's read of `<memory>/.git/config`
 * through `readCapped`, on an injected fake file system). No process, no network. `npm run test:memoryremote`. No Electron, no credits.
 */
import assert from 'assert';
import path from 'path';
import { remoteHosts, hostOfRemote } from '../src/shared/memoryfolder';
import { memoryGitRemote, type GitProbeFs } from '../src/main/memorygit';

process.exitCode = 1;
const SECRET = 'sekrit' + 'value9'; // not token-shaped: only dropping the user info can remove it
const hosts = (t: string): string[] => { const r = remoteHosts(t); assert.strictEqual(r.kind, 'remote', t); return r.kind === 'remote' ? r.hosts : []; };
const cfg = (url: string): string => `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`;

// ---- the parser ----
assert.deepStrictEqual(hosts(cfg(`https://user:${SECRET}@host.example.invalid/x/y.git`)), ['host.example.invalid']);
assert.deepStrictEqual(hosts(cfg(`https://${SECRET}@host.example.invalid:8443/x`)), ['host.example.invalid']);
assert.deepStrictEqual(hosts(cfg('ssh://git@host.example.invalid')), ['host.example.invalid']);
assert.deepStrictEqual(hosts(cfg('ssh://git@host.example.invalid:2222/x.git')), ['host.example.invalid']);
assert.deepStrictEqual(hosts(cfg('git@host.example.invalid:team/x.git')), ['host.example.invalid']);
assert.deepStrictEqual(hosts(cfg(`user:${SECRET}@host.example.invalid:x`)), ['host.example.invalid']);
assert.deepStrictEqual(hosts(cfg('host.example.invalid:x')), ['host.example.invalid']);
assert.deepStrictEqual(hosts(cfg('https://[::1]:8080/x')), ['[::1]']);
assert.deepStrictEqual(hosts(cfg('/srv/git/x.git')), ['(a folder on this computer)']);
assert.deepStrictEqual(hosts(cfg('C:\\repos\\x')), ['(a folder on this computer)']);
assert.deepStrictEqual(hosts(cfg('../x')), ['(a folder on this computer)']);
assert.deepStrictEqual(hosts(cfg('file:///srv/x')), ['(a folder on this computer)']);
assert.deepStrictEqual(hosts(cfg('"https://host.example.invalid/x" # c')), ['host.example.invalid']);
// the authority is cut at / \\ ? # ; or white space; anything else in a host answers (unknown host)
for (const [u, want] of [
  [`https://host.example.invalid#${SECRET}`, 'host.example.invalid'],
  [`https://host.example.invalid;${SECRET}`, 'host.example.invalid'],
  [`https://host.example.invalid?${SECRET}`, 'host.example.invalid'],
  [`https://host.example.invalid?access_token=${SECRET}`, 'host.example.invalid'],
  [`https://host.example.invalid%2F${SECRET}`, '(unknown host)'],
  [`https://host.example.invalid%40${SECRET}/x`, '(unknown host)'],
  [`git@host.example.invalid?${SECRET}:x`, 'host.example.invalid'],
  [`https://user:S@host.example.invalid\tfoo/x`, 'host.example.invalid'],
  [`https://host.example.invalid\\${SECRET}`, 'host.example.invalid'],
  [`https://${SECRET}/x@host.example.invalid/y`, '(unknown host)'],
  [`https://${SECRET}/x@host.example.invalid`, '(unknown host)'],
  [`https://${SECRET} x@host.example.invalid/y`, '(unknown host)'],
  [`https://ho st.example.invalid/y`, 'ho'],
  [`https://host.example.invalid:80${SECRET}/y`, 'host.example.invalid'],
  [`https://[::1%25${SECRET}]/y`, '(unknown host)'],
  [`https://ho"st.example.invalid/y`, '(unknown host)'],
  [`https://ünï.example.invalid/y`, '(unknown host)'],
] as Array<[string, string]>) {
  const h = hostOfRemote(u);
  assert.strictEqual(h, want, u);
  assert.ok(!h.includes(SECRET), 'no secret in the host: ' + u);
}
// the @ rule counts only before the first ? or #
// any @ after the authority cut answers (unknown host), also after a ? or #
assert.strictEqual(hostOfRemote('https://host.example.invalid/x?mail=a@b'), '(unknown host)');
assert.strictEqual(hostOfRemote('https://host.example.invalid?mail=a@b'), '(unknown host)');
for (const u of [`https://${SECRET}#x@host.example.invalid/`, `https://${SECRET}?x@host.example.invalid/`, `${SECRET}#@host.example.invalid:x`, `${SECRET}?@host.example.invalid:x`]) {
  assert.strictEqual(hostOfRemote(u), '(unknown host)', u);
}
for (const line of [`"https://${SECRET}#x"@host.example.invalid/x`, `https://${SECRET}"#"@host.example.invalid/x`]) {
  const r = remoteHosts(`[remote "o"]\n\turl = ${line}\n`);
  assert.deepStrictEqual(r, { kind: 'remote', hosts: ['(unknown host)'], rewritten: false }, line);
}
// property: whatever sits between a secret and a later @, the secret is never a reported host
{
  const delims = ['', '#', '?', ';', '/', '\\', ' ', '\t', ':', '%2F', '%40', '"', '\u202e', '..', '@'];
  let n = 0;
  for (const d1 of delims) for (const d2 of delims) for (const make of [(m: string) => `https://${SECRET}${m}@host.example.invalid/y`, (m: string) => `${SECRET}${m}@host.example.invalid:y`, (m: string) => `ssh://u:${SECRET}${m}@host.example.invalid`]) {
    const u = make(`${d1}x${d2}`);
    n++;
    assert.ok(!hostOfRemote(u).includes(SECRET), 'host: ' + JSON.stringify(u));
    if (!/["\\\n\r]/.test(u)) assert.ok(!JSON.stringify(remoteHosts(`[remote "o"]\n\turl = "${u}"\n`)).includes(SECRET), 'config: ' + JSON.stringify(u));
  }
  assert.ok(n > 600);
}
// 33 continuations between the secret and the @: the line is not complete, so nothing is reported from it
{
  const long = `[remote "o"]\n\turl = https://${SECRET}\\\n` + '\\\n'.repeat(32) + '@host.example.invalid/x\n';
  assert.deepStrictEqual(remoteHosts(long), { kind: 'unknown' }, '33 continuations');
  const ok = `[remote "o"]\n\turl = https://${SECRET}\\\n` + '\\\n'.repeat(30) + '@host.example.invalid/x\n';
  assert.deepStrictEqual(remoteHosts(ok), { kind: 'remote', hosts: ['host.example.invalid'], rewritten: false }, '31 continuations still join');
  assert.ok(!JSON.stringify(remoteHosts(long)).includes(SECRET));
}
// a backslash continuation joins the next line; an even run does not
assert.deepStrictEqual(hosts(`[remote "o"]\n\turl = https://${SECRET}\\\n@host.example.invalid/x\n`), ['host.example.invalid']);
assert.deepStrictEqual(hosts(`[remote "o"]\r\n\turl = https://${SECRET}\\\r\n@host.example.invalid/x\r\n`), ['host.example.invalid'], 'CRLF continuation');
assert.deepStrictEqual(hosts(`[remote "o"]\n\turl = https://host.example.invalid/x\\\\\n\tfetch = x\n`), ['host.example.invalid'], 'two backslashes do not continue');
assert.strictEqual(remoteHosts(`[remote "o"]\n\turl = a\\\n`.repeat(2000)).kind, 'remote', 'many continuations stay bounded');
// escapes in a quoted value: \" is a quote, \\ a backslash
assert.deepStrictEqual(hosts(cfg(`"https://${SECRET}\\"@host.example.invalid/x"`)), ['host.example.invalid']);
assert.deepStrictEqual(hosts(cfg(`"https://host.example.invalid/a\\\\" # c`)), ['host.example.invalid']);
assert.deepStrictEqual(hosts(cfg(`https://host.example.invalid/x#${SECRET}`)), ['host.example.invalid'], 'git reads # as a comment');
// worktreeConfig: remotes may live in config.worktree
for (const t of ['[extensions]\n\tworktreeConfig = true\n', '[extensions]\n\tworktreeconfig\n', '[extensions] WORKTREECONFIG = yes\n', cfg('https://h.example.invalid/x') + '[extensions]\n\tworktreeConfig = 1\n']) assert.deepStrictEqual(remoteHosts(t), { kind: 'unknown' }, t);
assert.deepStrictEqual(remoteHosts('[extensions]\n\tworktreeConfig = false\n'), { kind: 'none' });
assert.deepStrictEqual(remoteHosts('[core]\n\tworktreeConfig = true\n'), { kind: 'none' }, 'only the extensions section');
assert.deepStrictEqual(hosts(cfg('https://host.example.invalid/x ; comment')), ['host.example.invalid']);
assert.deepStrictEqual(hosts(cfg('https://host.example.invalid/x').replace(/\n/g, '\r\n')), ['host.example.invalid'], 'CRLF');
assert.deepStrictEqual(hosts('[remote "a"] url = https://one.example.invalid/x\n[remote "b"]\nurl = https://two.example.invalid/y\n[remote "c"]\nurl = https://one.example.invalid/z\n'), ['one.example.invalid', 'two.example.invalid']);
assert.deepStrictEqual(hosts('[REMOTE "o"]\n  URL = https://host.example.invalid/x\n'), ['host.example.invalid']);
// only url lines of remote sections
assert.deepStrictEqual(hosts('[remote "o"]\n\tfetch = x\n[branch "m"]\n\turl = https://not.example.invalid/x\n'), []);
assert.deepStrictEqual(hosts('[core]\n\turl = https://not.example.invalid/x\n[remote "o"]\n\tpushurl = https://push.example.invalid/x\n'), [], 'pushurl is not a url line');
// no remote
for (const t of ['', '[core]\n\tbare = false\n', '[branch "m"]\n\turl = https://not.example.invalid/x\n', '\n\n#[remote "x"]\n']) assert.deepStrictEqual(remoteHosts(t), { kind: 'none' }, t);
// include / includeIf: could not check
for (const t of ['[include]\n\tpath = ../other\n', '[includeIf "gitdir:~/w/"]\n\tpath = x\n', cfg('https://h.example.invalid/x') + '[INCLUDE]\n\tpath = y\n', '[ include ]\n']) assert.deepStrictEqual(remoteHosts(t), { kind: 'unknown' }, t);
// insteadOf: said, not hidden
{
  const r = remoteHosts(cfg('https://host.example.invalid/x') + '[url "ssh://git@other.example.invalid/"]\n\tinsteadOf = https://host.example.invalid/\n');
  assert.deepStrictEqual(r, { kind: 'remote', hosts: ['host.example.invalid'], rewritten: true });
  assert.deepStrictEqual(remoteHosts(cfg('https://host.example.invalid/x')), { kind: 'remote', hosts: ['host.example.invalid'], rewritten: false });
}
// a remote with no url line is still a remote
assert.deepStrictEqual(remoteHosts('[remote "o"]\n\tfetch = x\n'), { kind: 'remote', hosts: [], rewritten: false });
// masking and the cut (a token-shaped host is masked; a long one is cut to 64 + the mark)
{
  const tok = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  const h = hostOfRemote(`https://${tok}.example.invalid/x`);
  assert.ok(!h.includes(tok), h);
  const long = hostOfRemote('https://' + 'a'.repeat(300) + '.example.invalid/x');
  assert.ok(long.length <= 80 && long.length < 300, String(long.length));
  assert.strictEqual(hostOfRemote('https://ho\u202est\u0007.example.invalid/x'), '(unknown host)', 'control and bidi characters: not a host');
  assert.strictEqual(hostOfRemote('https://@/x'), '(unknown host)');
}
// no user info or token anywhere in the answer
assert.ok(!JSON.stringify(remoteHosts(cfg(`https://user:${SECRET}@host.example.invalid/${SECRET}`))).includes(SECRET));
// hostile input: 200k characters, many lines, quickly
{
  const t0 = Date.now();
  remoteHosts('[remote "o"]\n' + 'url = ' + 'x'.repeat(200000));
  remoteHosts(('[remote "o"]\n\turl = a:b\n').repeat(3000));
  remoteHosts('['.repeat(60000) + '\n' + ' '.repeat(60000) + '=');
  assert.ok(Date.now() - t0 < 3000, 'hostile config text is handled quickly');
}

// ---- the main-side read on a fake file system ----
type Node = { t: 'file'; data: string } | { t: 'dir' } | { t: 'dirlink' } | { t: 'filelink'; data: string } | { t: 'link'; to: string } | { t: 'fifo' } | { t: 'denied' };
const NOFOLLOW = 0x100;
const K = { O_RDONLY: 0, O_NOFOLLOW: NOFOLLOW };
const J = path.posix.join;
function fakeFs(tree: Record<string, Node>, log: string[] = []): GitProbeFs {
  const look = (p: string, follow: boolean): Node | undefined => {
    let n = tree[p];
    if (follow) for (let i = 0; n && n.t === 'link' && i < 8; i++) n = tree[n.to];
    return n;
  };
  const err = (code: string): never => { throw Object.assign(new Error(code), { code }); };
  const fds = new Map<number, Node & { t: 'file' | 'fifo' }>();
  let next = 10;
  return {
    lstatSync: (p) => {
      log.push('lstat ' + p);
      const n = look(p, false);
      if (!n) return err('ENOENT');
      if (n.t === 'denied') return err('EACCES');
      return { isDirectory: () => n.t === 'dir' || n.t === 'dirlink', isFile: () => n.t === 'file' || n.t === 'fifo' || n.t === 'filelink', isSymbolicLink: () => n.t === 'link' || n.t === 'dirlink' || n.t === 'filelink' };
    },
    openSync: (p, flags) => {
      log.push('open ' + p);
      const raw = tree[p];
      if (raw && raw.t === 'link' && (flags & NOFOLLOW)) return err('ELOOP');
      const n = look(p, true);
      if (!n) return err('ENOENT');
      if (n.t === 'denied' || n.t === 'dir' || n.t === 'dirlink' || n.t === 'link') return err('EACCES');
      if (n.t === 'filelink') { fds.set(next, { t: 'file', data: n.data }); return next++; } // the open would work: only the lstat refuses
      fds.set(next, n);
      return next++;
    },
    fstatSync: (fd) => { const n = fds.get(fd)!; return { isFile: () => n.t === 'file', size: n.t === 'file' ? Buffer.byteLength(n.data) : 0, nlink: 1 }; },
    readSync: (fd, buf, off, len, pos) => { const n = fds.get(fd)!; const b = Buffer.from(n.t === 'file' ? n.data : ''); const c = Math.min(len, Math.max(0, b.length - pos)); b.copy(buf, off, pos, pos + c); return c; },
    closeSync: () => undefined,
  };
}
const MEM = '/home/ana/notes';
const GIT = J(MEM, '.git');
const CFG = J(GIT, 'config');
const good = cfg(`https://user:${SECRET}@host.example.invalid/x`);
const ask = (tree: Record<string, Node>, flags: { O_RDONLY: number; O_NOFOLLOW?: number } = K) => memoryGitRemote(fakeFs(tree), flags, J, MEM);
const UNKNOWN = { kind: 'unknown' };

assert.deepStrictEqual(ask({ [MEM]: { t: 'dir' }, [GIT]: { t: 'dir' }, [CFG]: { t: 'file', data: good } }), { kind: 'remote', hosts: ['host.example.invalid'], rewritten: false });
assert.deepStrictEqual(ask({ [MEM]: { t: 'dir' }, [GIT]: { t: 'dir' }, [CFG]: { t: 'file', data: '[core]\n' } }), { kind: 'none' });
assert.deepStrictEqual(ask({ [MEM]: { t: 'dir' } }), { kind: 'none' }, 'no .git at all');
// could not check, never none
assert.deepStrictEqual(ask({ [GIT]: { t: 'file', data: 'gitdir: ../x' } }), UNKNOWN, '.git as a file (worktree)');
assert.deepStrictEqual(ask({ [GIT]: { t: 'link', to: '/elsewhere/.git' }, '/elsewhere/.git': { t: 'dir' }, '/elsewhere/.git/config': { t: 'file', data: good } }), UNKNOWN, '.git a link');
assert.deepStrictEqual(ask({ [GIT]: { t: 'denied' } }), UNKNOWN, '.git unreadable');
assert.deepStrictEqual(ask({ [GIT]: { t: 'dir' }, [CFG]: { t: 'denied' } }), UNKNOWN, 'config unreadable');
assert.deepStrictEqual(ask({ [GIT]: { t: 'dir' } }), UNKNOWN, 'config missing in a .git folder');
assert.deepStrictEqual(ask({ [GIT]: { t: 'dir' }, [CFG]: { t: 'file', data: '[include]\n\tpath = x\n' } }), UNKNOWN, 'include');
assert.deepStrictEqual(ask({ [GIT]: { t: 'dir' }, [CFG]: { t: 'file', data: '[includeIf "gitdir:/"]\n\tpath = x\n' } }), UNKNOWN, 'includeIf');
// the cap: 64 KB passes, 64 KB + 1 does not
{
  const pad = (n: number): string => good + '#'.repeat(n - Buffer.byteLength(good));
  assert.strictEqual(ask({ [GIT]: { t: 'dir' }, [CFG]: { t: 'file', data: pad(64 * 1024) } }).kind, 'remote', 'exactly 64 KB is read');
  assert.deepStrictEqual(ask({ [GIT]: { t: 'dir' }, [CFG]: { t: 'file', data: pad(64 * 1024 + 1) } }), UNKNOWN, '64 KB + 1');
}
// a FIFO and a symlink as the config
assert.deepStrictEqual(ask({ [GIT]: { t: 'dir' }, [CFG]: { t: 'fifo' } }), UNKNOWN, 'FIFO');
assert.deepStrictEqual(ask({ [GIT]: { t: 'dir' }, [CFG]: { t: 'link', to: '/other/config' }, '/other/config': { t: 'file', data: good } }), UNKNOWN, 'symlink');
// Windows has no O_NOFOLLOW: the link is still refused, by the lstat before the open
assert.deepStrictEqual(ask({ [GIT]: { t: 'dir' }, [CFG]: { t: 'link', to: '/other/config' }, '/other/config': { t: 'file', data: good } }, { O_RDONLY: 0 }), UNKNOWN, 'symlink, no O_NOFOLLOW');
assert.deepStrictEqual(ask({ [GIT]: { t: 'dir' }, [CFG]: { t: 'fifo' } }, { O_RDONLY: 0 }), UNKNOWN, 'FIFO, no O_NOFOLLOW');
// a config that lstat reports as a link whatever else it says (a Windows junction or reparse point)
assert.deepStrictEqual(ask({ [GIT]: { t: 'dir' }, [CFG]: { t: 'filelink', data: good } }), UNKNOWN, 'config link');
// a .git that is both a folder and a link (a junction) is not trusted
assert.deepStrictEqual(ask({ [GIT]: { t: 'dirlink' }, [CFG]: { t: 'file', data: good } }), UNKNOWN, '.git folder link');
// remotes may also live in .git/remotes or .git/branches (names only; nothing is listed)
for (const old of ['remotes', 'branches']) for (const n of [{ t: 'dir' }, { t: 'file', data: '' }, { t: 'denied' }] as Node[]) {
  assert.deepStrictEqual(ask({ [GIT]: { t: 'dir' }, [CFG]: { t: 'file', data: '[core]\n' }, [J(GIT, old)]: n }), UNKNOWN, old + ' ' + n.t);
}
// only these paths are touched: .git and .git/config
{
  const log: string[] = [];
  memoryGitRemote(fakeFs({ [GIT]: { t: 'dir' }, [CFG]: { t: 'file', data: good } }, log), K, J, MEM);
  assert.deepStrictEqual(log, ['lstat ' + GIT, 'lstat ' + J(GIT, 'remotes'), 'lstat ' + J(GIT, 'branches'), 'lstat ' + CFG, 'open ' + CFG]);
}
// source: no process, no network (FR-012)
{
  const fs = require('fs') as typeof import('fs');
  for (const f of ['src/shared/memoryfolder.ts', 'src/main/memorygit.ts']) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8').replace(/\r\n/g, '\n');
    const imports = [...src.matchAll(/^import [^;]*from '([^']+)'/gm)].map((m) => m[1]).sort();
    const allowed = f.endsWith('memorygit.ts') ? ['../shared/cappedread', '../shared/memoryfolder'] : ['./redact'];
    assert.deepStrictEqual(imports, allowed, `${f} imports`);
  }
}

process.exitCode = 0;
console.log('memoryremote: ok');
