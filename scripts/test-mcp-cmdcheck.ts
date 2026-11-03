/**
 * Spec 058 FR-198 (T168; review on PR 1073): the command check reads each searched folder once (async readdir, counted here) and never
 * touches a network or device path; nothing is run and no file is stat'd. Part of `npm run test:mcphealth`.
 */
import * as assert from 'assert';
import * as path from 'path';
import { buildIndex, commandFound, foldersFor, INDEX_TTL_MS, missingChecker, notJudged, remotePath, withMissing } from '../src/main/mcpcmdcheck';
import type { DetectEnv } from '../src/adapters/detect';
import type { GlobalState } from '../src/shared/api';

/** A fake computer: files by full path; readdir lists a folder's names and is counted; isFile must never be needed. */
function computer(platform: NodeJS.Platform, files: string[], env: Record<string, string> = {}, loginPath: string[] = [], locked: string[] = []) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const k = (s: string) => (platform === 'win32' ? s.toLowerCase() : s);
  const reads: string[] = [];
  let stats = 0;
  const de: DetectEnv = { platform, env, homedir: platform === 'win32' ? 'C:\\Users\\u' : '/home/u', isFile: () => { stats++; return false; }, listDir: () => [], loginPath };
  const readdir = async (dir: string): Promise<string[]> => {
    reads.push(dir);
    if (locked.some((l) => k(l) === k(dir))) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    const ns = files.filter((f) => k(p.dirname(f)) === k(dir)).map((f) => p.basename(f));
    if (!ns.length) throw new Error('ENOENT');
    return ns;
  };
  return { de, readdir, reads, stats: () => stats };
}
const look = async (c: ReturnType<typeof computer>, cmds: string[]) => {
  const idx = await buildIndex(foldersFor(cmds, c.de), c.de, c.readdir);
  return (cmd: unknown) => commandFound(cmd, idx);
};

async function main(): Promise<void> {
  // POSIX: a bare name on PATH, on the login shell's PATH, in a usual folder; absolute paths; not found
  {
    const c = computer('linux', ['/opt/x/bin/npx', '/home/u/.nvm/bin/uvx', '/usr/local/bin/docker', '/srv/tools/notes-mcp'], { PATH: '/usr/bin:/opt/x/bin' }, ['/home/u/.nvm/bin']);
    const f = await look(c, ['/srv/tools/notes-mcp', '/srv/tools/gone']);
    assert.strictEqual(f('npx'), true, 'on PATH');
    assert.strictEqual(f('uvx'), true, 'on the login shell PATH');
    assert.strictEqual(f('docker'), true, 'in a usual install folder');
    assert.strictEqual(f('/srv/tools/notes-mcp'), true, 'an absolute file');
    assert.strictEqual(f('/srv/tools/gone'), false, 'an absolute path whose folder has no such name');
    assert.strictEqual(f('/nowhere/x'), undefined, 'an absolute path whose folder was not read: not judged');
    assert.strictEqual(f('playwright-mcp'), false, 'a bare name in no folder');
    assert.strictEqual(f(' npx '), true, 'spaces around the name');
    assert.strictEqual(c.stats(), 0, 'no stat');
  }
  // review on PR 1073 (D): a folder that cannot be read (EACCES) is not judged, never "missing"; a readable empty-of-it folder is "missing"
  {
    const c = computer('linux', ['/srv/open/other'], { PATH: '/usr/bin' }, [], ['/srv/locked']);
    const f = await look(c, ['/srv/locked/x', '/srv/open/x']);
    assert.ok(c.reads.includes('/srv/locked'), 'the locked folder was tried');
    assert.strictEqual(f('/srv/locked/x'), undefined, 'an unreadable folder: not judged');
    assert.strictEqual(f('/srv/open/x'), false, 'a readable folder without it: missing');
  }
  // not judged: references, relative paths with a folder, odd values
  {
    const c = computer('linux', ['/usr/bin/x'], { PATH: '/usr/bin' });
    const f = await look(c, []);
    for (const v of ['${HOME}/bin/x', '$TOOL', '%APPDATA%\\x.exe', '`which x`', './bin/server', 'tools/server', '', '   ', 'a'.repeat(1025), 'x\ny'])
      assert.strictEqual(f(v), undefined, 'not judged: ' + JSON.stringify(v.slice(0, 20)));
    for (const v of [undefined, null, 3, {}, ['npx']]) assert.strictEqual(f(v), undefined, 'not a string');
  }
  // review on PR 1073 item 1: network and device paths are never read, never "missing"
  {
    const remote = ['\\/host/share/x.exe', '/\\host\\share\\x.exe', '\\\\host\\share\\x.exe', '//host/share/x', '\\\\?\\UNC\\host\\s\\x.exe', '\\\\.\\pipe\\x', '\\\\?\\C:\\tools\\x.exe', '//?/c:/x'];
    const c = computer('win32', ['C:\\tools\\x.exe'], { PATH: 'C:\\tools;\\\\fileserver\\bin;//nas/tools;\\/mixed/bin;/\\mixed\\bin' });
    const dirs = foldersFor(remote, c.de);
    assert.ok(dirs.every((d) => !remotePath(d, 'win32')), 'no network folder is read: ' + JSON.stringify(dirs));
    const f = await look(c, remote);
    for (const r of remote) assert.strictEqual(f(r), undefined, 'not judged: ' + r);
    for (const r of remote) assert.strictEqual(notJudged(r, 'win32'), 'remote', 'refused as remote before any lookup: ' + r);
    assert.ok(c.reads.every((d) => !/^[\\/]{2}/.test(d)), 'no network or device folder was read: ' + JSON.stringify(c.reads));
    assert.ok(c.reads.some((d) => d.toLowerCase() === 'c:\\tools'), 'the local PATH folder is read');
    // drive letters: absolute is looked up; drive-relative is not judged
    assert.strictEqual(f('C:\\tools\\x.exe'), true, 'an absolute path with a drive letter');
    assert.strictEqual(f('C:/tools/x.exe'), true, 'forward slashes');
    assert.strictEqual(f('C:x.exe'), undefined, 'drive-relative: not judged');
    const mac = computer('darwin', ['/usr/local/bin/x'], { PATH: '/usr/local/bin:/net/host/bin:/Network/Servers/s/bin:/NET/h/bin:/network/s/bin' });
    const fm = await look(mac, ['/net/host/tools/x', '/Network/Servers/s/x', '/NET/h/x', '/network/s/x']);
    assert.strictEqual(fm('/NET/h/x'), undefined, 'macOS /NET (any case): not judged');
    assert.strictEqual(fm('/network/s/x'), undefined, 'macOS /network (any case): not judged');
    assert.strictEqual(notJudged('/NeT/h/x', 'darwin'), 'remote');
    assert.strictEqual(fm('/net/host/tools/x'), undefined, 'macOS /net: not judged');
    assert.strictEqual(fm('/Network/Servers/s/x'), undefined, 'macOS /Network: not judged');
    assert.ok(mac.reads.every((d) => !/^\/(net|network)\//i.test(d)), 'no macOS network folder read, in any case: ' + JSON.stringify(mac.reads));
  }
  // Windows: PATHEXT limited to runnable extensions, a name with its own extension, case, dotted names, absolute without extension
  {
    const c = computer('win32', ['C:\\Program Files\\nodejs\\npx.cmd', 'C:\\py\\python.exe', 'C:\\tools\\srv.bat', 'C:\\py\\python3.11.exe', 'C:\\srv\\server.v2.cmd', 'C:\\tools\\tool.py', 'C:\\tools\\tool2.js'],
      { PATH: 'C:\\Program Files\\nodejs;C:\\py;C:\\tools;C:\\srv', PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS;.PY' });
    const f = await look(c, ['C:\\py\\python']);
    assert.strictEqual(f('npx'), true, 'npx.cmd through PATHEXT');
    assert.strictEqual(f('NPX'), true, 'any case');
    assert.strictEqual(f('python.exe'), true, 'a name with its extension');
    assert.strictEqual(f('srv'), true, '.bat from PATHEXT');
    assert.strictEqual(f('C:\\py\\python'), true, 'an absolute path, the extension added');
    assert.strictEqual(f('python3.11'), true, 'a dotted name whose suffix is no extension gets them');
    assert.strictEqual(f('server.v2'), true, 'server.v2 -> server.v2.cmd');
    assert.strictEqual(f('tool'), false, 'a .py in PATHEXT does not count as runnable');
    assert.strictEqual(f('tool2'), false, 'nor a .js');
    assert.strictEqual(f('uvx'), false, 'not found');
    // review on PR 1073 (C): Windows names and folders in any case
    const mixed = computer('win32', ['C:\\Program Files\\NodeJS\\NPX.CMD', 'C:\\Tools\\Docker.EXE', 'D:\\Apps\\Server.Bat'], { PATH: 'C:\\Program Files\\NodeJS;C:\\Tools', PATHEXT: '.EXE;.CMD;.BAT' });
    const fx = await look(mixed, ['d:\\apps\\server']);
    assert.strictEqual(fx('npx'), true, 'NPX.CMD from a lowercase command');
    assert.strictEqual(fx('DOCKER'), true, 'Docker.EXE from an uppercase command');
    assert.strictEqual(fx('Docker.exe'), true, 'its own extension in another case');
    assert.strictEqual(fx('d:\\apps\\server'), true, 'an absolute path in another case than the folder');
    const noExt = computer('win32', ['C:\\tools\\srv.bat'], { PATH: 'C:\\tools' });
    assert.strictEqual((await look(noExt, []))('srv'), true, 'without PATHEXT the usual extensions');
  }
  // review on PR 1073 item 2: each folder read once per index, whatever the number of servers; the index is kept 10 s; no stat
  {
    const dirs = Array.from({ length: 40 }, (_, i) => 'C:\\p' + i);
    const c = computer('win32', ['C:\\p3\\found.exe'], { PATH: dirs.join(';') });
    const servers = Array.from({ length: 20 }, (_, i) => ({ name: 's' + i, transport: 'stdio' as const, command: 'gone' + i, envKeys: [], headerKeys: [] }));
    const st: GlobalState = { ok: true, apps: [{ app: 'claude', label: 'Claude Code', file: '~/.claude.json', found: true, off: [], servers: [...servers, { name: 'ok', transport: 'stdio', command: 'found', envKeys: [], headerKeys: [] }] }] };
    let t = 0;
    const check = missingChecker(() => c.de, c.readdir, () => t);
    const [r1, r2] = await Promise.all([check(st), check(st)]);
    const n1 = c.reads.length;
    assert.ok(n1 <= dirs.length + 12, 'one read per folder for 21 servers (' + n1 + ' reads), shared by two calls at once');
    assert.strictEqual(new Set(c.reads.map((d) => d.toLowerCase())).size, n1, 'no folder read twice');
    assert.strictEqual(c.stats(), 0, 'no stat');
    assert.strictEqual(r1.apps[0].servers.filter((s) => s.missing).length, 20);
    assert.ok(!r1.apps[0].servers.find((s) => s.name === 'ok')!.missing, 'the found one is not flagged');
    assert.deepStrictEqual(r2, r1);
    t = INDEX_TTL_MS - 1;
    await check(st);
    assert.strictEqual(c.reads.length, n1, 'within 10 s: no new read');
    t = INDEX_TTL_MS;
    await check(st);
    assert.strictEqual(c.reads.length, 2 * n1, 'after 10 s: read again');
    t = 5;
    await check(st);
    assert.strictEqual(c.reads.length, 3 * n1, 'a clock that went back: read again, never a stale index forever');
    const none: GlobalState = { ok: true, apps: [{ app: 'codex', label: 'Codex', file: '~/.codex/config.toml', found: true, off: [], servers: [{ name: 'h', transport: 'http', url: 'https://x.example/mcp', envKeys: [], headerKeys: [] }] }] };
    const before = c.reads.length;
    assert.deepStrictEqual(await check(none), none, 'no stdio server: the state as it is');
    assert.strictEqual(c.reads.length, before, 'and nothing read');
  }
  // withMissing: only stdio servers with a command found missing; the state is copied; a broken state passes through
  {
    const st: GlobalState = {
      ok: true,
      apps: [
        { app: 'claude', label: 'Claude Code', file: '~/.claude.json', found: true, off: [], servers: [
          { name: 'a', transport: 'stdio', command: 'gone', envKeys: [], headerKeys: [] },
          { name: 'b', transport: 'stdio', command: 'npx', envKeys: [], headerKeys: [] },
          { name: 'c', transport: 'http', url: 'https://x.example/mcp', command: 'gone', envKeys: [], headerKeys: [] },
          { name: 'd', transport: 'stdio', command: '$X', envKeys: [], headerKeys: [] },
        ] },
        { app: 'codex', label: 'Codex', file: '~/.codex/config.toml', found: true, off: [], servers: [{ name: 'a', transport: 'stdio', command: 'gone', envKeys: [], headerKeys: [] }] },
      ],
    };
    const looked: string[] = [];
    const out = withMissing(st, (c) => { looked.push(c); return c === 'gone' ? false : c === 'npx' ? true : undefined; });
    assert.deepStrictEqual(out.apps[0].servers.map((s) => s.missing === true), [true, false, false, false]);
    assert.strictEqual(out.apps[1].servers[0].missing, true);
    assert.deepStrictEqual(looked.sort(), ['$X', 'gone', 'npx'], 'each command looked up once; an http server never');
    assert.ok(!('missing' in st.apps[0].servers[0]), 'the input state is not changed');
    const bad = { ok: false, apps: [] } as GlobalState;
    assert.strictEqual(withMissing(bad, () => false), bad);
  }
  console.log('[058] mcp cmdcheck: PASS');
}
main().catch((e) => { console.error(e); process.exit(1); });
