/** Spec 058 FR-198 (T168): the command check is a file lookup over detection's folders; nothing is run. Part of `npm run test:mcphealth`. */
import * as assert from 'assert';
import { commandFound, withMissing } from '../src/main/mcpcmdcheck';
import type { DetectEnv } from '../src/adapters/detect';
import type { GlobalState } from '../src/shared/api';

const envOf = (platform: NodeJS.Platform, files: string[], env: Record<string, string> = {}, loginPath: string[] = []): DetectEnv & { asked: string[] } => {
  const asked: string[] = [];
  const set = new Set(files.map((f) => (platform === 'win32' ? f.toLowerCase() : f)));
  return {
    platform,
    env,
    homedir: platform === 'win32' ? 'C:\\Users\\u' : '/home/u',
    isFile: (p) => {
      asked.push(p);
      return set.has(platform === 'win32' ? p.toLowerCase() : p);
    },
    listDir: () => [],
    loginPath,
    asked,
  };
};

// POSIX: a bare name on PATH, on the login shell's PATH, in a usual folder; absolute paths; not found
{
  const e = envOf('linux', ['/opt/x/bin/npx', '/home/u/.nvm/bin/uvx', '/usr/local/bin/docker', '/srv/tools/notes-mcp'], { PATH: '/usr/bin:/opt/x/bin' }, ['/home/u/.nvm/bin']);
  assert.strictEqual(commandFound('npx', e), true, 'on PATH');
  assert.strictEqual(commandFound('uvx', e), true, 'on the login shell PATH');
  assert.strictEqual(commandFound('docker', e), true, 'in a usual install folder');
  assert.strictEqual(commandFound('/srv/tools/notes-mcp', e), true, 'an absolute file');
  assert.strictEqual(commandFound('/srv/tools/gone', e), false, 'an absolute path that is no file');
  assert.strictEqual(commandFound('playwright-mcp', e), false, 'a bare name in no folder');
  assert.strictEqual(commandFound(' npx ', e), true, 'spaces around the name');
}
// not judged: references, relative paths with a folder, odd values
{
  const e = envOf('linux', [], { PATH: '/usr/bin' });
  for (const c of ['${HOME}/bin/x', '$TOOL', '%APPDATA%\\x.exe', '`which x`', './bin/server', 'tools/server', '', '   ', 'a'.repeat(1025), 'x\ny'])
    assert.strictEqual(commandFound(c, e), undefined, 'not judged: ' + JSON.stringify(c.slice(0, 20)));
  for (const c of [undefined, null, 3, {}, ['npx']]) assert.strictEqual(commandFound(c, e), undefined, 'not a string');
  assert.deepStrictEqual(e.asked, [], 'nothing was looked up for a value that is not judged');
}
// Windows: PATHEXT, a name with its own extension, case, an absolute path without extension
{
  const e = envOf('win32', ['C:\\Program Files\\nodejs\\npx.cmd', 'C:\\py\\python.exe', 'C:\\tools\\srv.bat'], { PATH: 'C:\\Program Files\\nodejs;C:\\py;C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' });
  assert.strictEqual(commandFound('npx', e), true, 'npx.cmd through PATHEXT');
  assert.strictEqual(commandFound('NPX', e), true, 'any case');
  assert.strictEqual(commandFound('python.exe', e), true, 'a name with its extension');
  assert.strictEqual(commandFound('srv', e), true, '.bat from PATHEXT');
  assert.strictEqual(commandFound('C:\\py\\python', e), true, 'an absolute path, the extension added');
  assert.strictEqual(commandFound('uvx', e), false, 'not found');
  const py = envOf('win32', ['C:\\tools\\tool.py'], { PATH: 'C:\\tools', PATHEXT: '.EXE;.PY' });
  assert.strictEqual(commandFound('tool', py), true, 'an extension only PATHEXT names');
  const noExt = envOf('win32', ['C:\\tools\\srv.bat'], { PATH: 'C:\\tools' });
  assert.strictEqual(commandFound('srv', noExt), true, 'without PATHEXT the usual extensions');
  const odd = envOf('win32', ['C:\\tools\\srv.bat'], { PATH: 'C:\\tools', PATHEXT: 'garbage;;..;.toolongext' });
  assert.strictEqual(commandFound('srv', odd), true, 'a broken PATHEXT falls back to the usual extensions');
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
