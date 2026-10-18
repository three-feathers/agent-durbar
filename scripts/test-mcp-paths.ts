/** Spec 041 T010: mcpPaths for win32, darwin and linux from any OS, the 103-byte limit, and the fallback folder check. Pure, no I/O. */
import * as assert from 'assert';
import { checkFallbackDir, mcpPaths } from '../src/main/mcp/paths';
import type { FallbackStat } from '../src/main/mcp/paths';
import { MCP_LIMITS, MCP_STATUSES, MCP_SERVER_NAME, MCP_BRIDGE_FLAG, MCP_MARKER_ENV, UNIX_SOCKET_MAX_BYTES } from '../src/shared/mcpserver';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const base = { uid: 501, tmpdir: '/var/folders/ab/xyz/T' };

// Constants (FR-040, FR-024, FR-032, FR-034)
assert.strictEqual(MCP_SERVER_NAME, 'agent-durbar');
assert.strictEqual(MCP_BRIDGE_FLAG, '--durbar-mcp-bridge');
assert.strictEqual(MCP_MARKER_ENV, 'AGENT_DURBAR_RUNTIME');
assert.strictEqual(MCP_LIMITS.maxMessageBytes, 65536);
assert.strictEqual(MCP_LIMITS.maxCallsPerSecond, 10);
assert.strictEqual(MCP_LIMITS.maxConnections, 3);
assert.strictEqual(MCP_LIMITS.maxQueueWaiting, 5);
assert.deepStrictEqual([...MCP_STATUSES], ['pending', 'applied', 'denied', 'expired', 'stale', 'failed', 'busy', 'refused']);
assert.strictEqual(UNIX_SOCKET_MAX_BYTES, 103);

// macOS, short path: userData/mcp
{
  const ud = '/Users/ana/Library/Application Support/agent-durbar';
  const r = mcpPaths({ ...base, platform: 'darwin', userData: ud });
  assert.strictEqual(r.keyFile, ud + '/mcp/connection.json');
  assert.strictEqual(r.socket, ud + '/mcp/mcp.sock');
  assert.strictEqual(r.kind, 'unix');
  assert.strictEqual(r.checkDir, ud + '/mcp');
  assert.strictEqual(r.reason, null);
}

// macOS, exactly 103 bytes stays; 104 falls back to tmpdir/agent-durbar-<uid>
{
  const tail = '/mcp/mcp.sock';
  const mk = (n: number) => '/' + 'u'.repeat(n - tail.length - 1);
  const at = mk(103);
  assert.strictEqual(bytes(at + tail), 103);
  const r103 = mcpPaths({ ...base, platform: 'darwin', userData: at });
  assert.strictEqual(r103.socket, at + tail);
  assert.strictEqual(r103.checkDir, at + '/mcp');
  const over = mk(104);
  assert.strictEqual(bytes(over + tail), 104);
  const r104 = mcpPaths({ ...base, platform: 'darwin', userData: over });
  assert.strictEqual(r104.socket, '/var/folders/ab/xyz/T/agent-durbar-501/mcp.sock');
  assert.strictEqual(r104.checkDir, '/var/folders/ab/xyz/T/agent-durbar-501');
  assert.strictEqual(r104.keyFile, over + '/mcp/connection.json', 'the key file stays in userData');
}

// Multi-byte characters count as bytes, not characters
{
  const ud = '/Users/' + 'ñ'.repeat(45) + '/App'; // ~ 100 chars but > 103 bytes with the tail
  const r = mcpPaths({ ...base, platform: 'darwin', userData: ud });
  assert.ok(bytes(ud + '/mcp/mcp.sock') > 103 && (ud + '/mcp/mcp.sock').length <= 103);
  assert.ok(r.checkDir, 'falls back on byte length');
}

// Fallback itself too long, or no usable uid or tmpdir: no listen, with a reason
{
  const long = '/' + 'u'.repeat(120);
  const r1 = mcpPaths({ ...base, platform: 'darwin', userData: long, tmpdir: '/' + 't'.repeat(100) });
  assert.strictEqual(r1.socket, null);
  assert.ok(r1.reason && r1.reason.length > 0);
  const r2 = mcpPaths({ ...base, platform: 'darwin', userData: long, uid: null });
  assert.strictEqual(r2.socket, null);
  assert.ok(r2.reason);
  const r3 = mcpPaths({ ...base, platform: 'darwin', userData: long, tmpdir: 'relative/tmp' });
  assert.strictEqual(r3.socket, null);
  assert.ok(r3.reason);
}

// Linux with XDG_RUNTIME_DIR
{
  const r = mcpPaths({ ...base, platform: 'linux', userData: '/home/ana/.config/agent-durbar', xdgRuntimeDir: '/run/user/1000', uid: 1000 });
  assert.strictEqual(r.socket, '/run/user/1000/agent-durbar/mcp.sock');
  assert.strictEqual(r.keyFile, '/home/ana/.config/agent-durbar/mcp/connection.json');
  assert.strictEqual(r.checkDir, '/run/user/1000/agent-durbar');
}

// Linux without XDG (unset, empty, or not absolute): userData/mcp
for (const xdg of [undefined, '', 'run/user/1000']) {
  const ud = '/home/ana/.config/agent-durbar';
  const r = mcpPaths({ ...base, platform: 'linux', userData: ud, xdgRuntimeDir: xdg, uid: 1000 });
  assert.strictEqual(r.socket, ud + '/mcp/mcp.sock', 'xdg=' + String(xdg));
}

// Linux: long XDG path tries <userData>/mcp first, then tmpdir
{
  const env = { xdgRuntimeDir: '/run/user/' + 'x'.repeat(100) };
  const r = mcpPaths({ platform: 'linux', userData: '/home/ana/.config/agent-durbar', ...env, uid: 1000, tmpdir: '/tmp' });
  assert.strictEqual(r.socket, '/home/ana/.config/agent-durbar/mcp/mcp.sock');
  assert.strictEqual(r.checkDir, '/home/ana/.config/agent-durbar/mcp');
  const r2 = mcpPaths({ platform: 'linux', userData: '/' + 'u'.repeat(110), ...env, uid: 1000, tmpdir: '/tmp' });
  assert.strictEqual(r2.socket, '/tmp/agent-durbar-1000/mcp.sock');
  assert.strictEqual(r2.checkDir, '/tmp/agent-durbar-1000');
}

// Linux without XDG and userData over 103 bytes: tmp fallback
{
  const r = mcpPaths({ platform: 'linux', userData: '/' + 'u'.repeat(110), uid: 1000, tmpdir: '/tmp' });
  assert.strictEqual(r.socket, '/tmp/agent-durbar-1000/mcp.sock');
  assert.strictEqual(r.checkDir, '/tmp/agent-durbar-1000');
}

// XDG that is not normalized is refused like unset; an XDG outside userData is always lstat-checked (even a bare /tmp)
{
  const ud = '/home/ana/.config/agent-durbar';
  for (const xdg of ['/run/user/1000/../../../tmp', '/run/user/./1000', '/run//user/1000']) {
    const r = mcpPaths({ ...base, platform: 'linux', userData: ud, xdgRuntimeDir: xdg, uid: 1000 });
    assert.strictEqual(r.socket, ud + '/mcp/mcp.sock', xdg);
    assert.strictEqual(r.checkDir, ud + '/mcp');
  }
  const r = mcpPaths({ ...base, platform: 'linux', userData: ud, xdgRuntimeDir: '/tmp', uid: 1000 });
  assert.strictEqual(r.socket, '/tmp/agent-durbar/mcp.sock');
  assert.strictEqual(r.checkDir, '/tmp/agent-durbar');
  const ok = mcpPaths({ ...base, platform: 'linux', userData: ud, xdgRuntimeDir: '/run/user/1000', uid: 1000 });
  assert.strictEqual(ok.checkDir, '/run/user/1000/agent-durbar');
}

// Relative, non-normalized or NUL-containing userData: no socket, no key file, a reason
for (const [platform, bad, abs] of [['linux', 'rel/ud', '/abs/ud'], ['darwin', 'rel/ud', '/abs/ud'], ['win32', 'rel\\ud', 'C:\\abs\\ud']] as const) {
  const mk = (userData: string) => mcpPaths({ platform, userData, uid: 501, tmpdir: '/tmp', pipeId: 'abcdef0123456789' });
  const traversal = platform === 'win32' ? 'C:\\home\\a\\..\\..\\tmp\\shared' : '/home/a/../../tmp/shared';
  for (const r of [mk(bad), mk(traversal), mk(abs + '\0x'), mk('')]) {
    assert.strictEqual(r.socket, null, platform);
    assert.strictEqual(r.keyFile, null, platform);
    assert.strictEqual(r.mcpDir, null, platform);
    assert.ok(r.reason, platform);
  }
  assert.ok(mk(abs).socket, platform);
}

// mcpPaths never reads DURBAR_USER_DATA: the caller applies it to userData (devEnv, empty in packaged builds)
{
  const saved = process.env.DURBAR_USER_DATA;
  process.env.DURBAR_USER_DATA = '/tmp/should-be-ignored';
  try {
    const r = mcpPaths({ ...base, platform: 'darwin', userData: '/Users/ana/x' });
    assert.strictEqual(r.keyFile, '/Users/ana/x/mcp/connection.json');
    assert.strictEqual(r.socket, '/Users/ana/x/mcp/mcp.sock');
    const l = mcpPaths({ ...base, platform: 'linux', userData: '/home/ana/x', xdgRuntimeDir: '/run/user/1000', uid: 1000 });
    assert.strictEqual(l.keyFile, '/home/ana/x/mcp/connection.json');
    const w = mcpPaths({ platform: 'win32', userData: 'C:\\ud', uid: null, tmpdir: 'C:\\t', pipeId: 'abcdef0123456789' });
    assert.strictEqual(w.keyFile, 'C:\\ud\\mcp\\connection.json');
  } finally {
    if (saved === undefined) delete process.env.DURBAR_USER_DATA; else process.env.DURBAR_USER_DATA = saved;
  }
}

// Unix: <userData>/mcp is lstat-checked too; Windows never
assert.strictEqual(mcpPaths({ ...base, platform: 'darwin', userData: '/Users/ana/x' }).checkDir, '/Users/ana/x/mcp');
assert.strictEqual(mcpPaths({ ...base, platform: 'linux', userData: '/home/ana/x' }).checkDir, '/home/ana/x/mcp');
assert.strictEqual(mcpPaths({ platform: 'win32', userData: 'C:\\ud', uid: null, tmpdir: 'C:\\t', pipeId: 'abcdef0123456789' }).checkDir, null);

// Windows: named pipe from the per-install id, key file under userData, never a fallback folder
{
  const ud = 'C:\\Users\\ana\\AppData\\Roaming\\agent-durbar';
  const r = mcpPaths({ platform: 'win32', userData: ud, uid: null, tmpdir: 'C:\\Temp', pipeId: 'abcdef0123456789' });
  assert.strictEqual(r.socket, '\\\\.\\pipe\\agent-durbar-mcp-abcdef0123456789');
  assert.strictEqual(r.kind, 'pipe');
  assert.strictEqual(r.keyFile, ud + '\\mcp\\connection.json');
  assert.strictEqual(r.checkDir, null);
  // a very long userData does not matter for a pipe
  const long = mcpPaths({ platform: 'win32', userData: 'C:\\' + 'u'.repeat(200), uid: null, tmpdir: 'C:\\Temp', pipeId: 'abcdef0123456789' });
  assert.ok(long.socket);
  assert.ok(mcpPaths({ platform: 'win32', userData: ud, uid: null, tmpdir: 'C:\\Temp', pipeId: 'abcdefgh' }).socket, '8 chars ok');
  assert.ok(mcpPaths({ platform: 'win32', userData: ud, uid: null, tmpdir: 'C:\\Temp', pipeId: 'a'.repeat(128) }).socket, '128 chars ok');
  // missing or hostile pipe id: no pipe
  for (const bad of ['a'.repeat(129), undefined, '', 'short', 'abcdefg', '..\\evil\\pipe0000', 'abc def0123456789']) {
    const b = mcpPaths({ platform: 'win32', userData: ud, uid: null, tmpdir: 'C:\\Temp', pipeId: bad });
    assert.strictEqual(b.socket, null, String(bad));
    assert.ok(b.reason);
  }
}

// Same output on every host: the OS is the input, not process.platform
{
  const a = mcpPaths({ ...base, platform: 'win32', userData: 'C:\\x', pipeId: 'abcdef0123456789' });
  assert.ok(a.keyFile!.includes('\\') && !a.keyFile!.includes('/'));
  const b = mcpPaths({ ...base, platform: 'darwin', userData: '/x' });
  assert.ok(!b.keyFile!.includes('\\'));
}

// lstat check (FR-062)
const st = (o: Partial<{ uid: number; mode: number; link: boolean; dir: boolean }> = {}): FallbackStat => ({
  uid: o.uid ?? 501, mode: o.mode ?? 0o040700, isSymbolicLink: () => o.link ?? false, isDirectory: () => o.dir ?? true,
});
assert.deepStrictEqual(checkFallbackDir(st(), 501), { ok: true });
const wrongOwner = checkFallbackDir(st({ uid: 0 }), 501);
assert.strictEqual(wrongOwner.ok, false);
const open = checkFallbackDir(st({ mode: 0o040755 }), 501);
assert.strictEqual(open.ok, false);
assert.strictEqual(checkFallbackDir(st({ mode: 0o040770 }), 501).ok, false);
assert.strictEqual(checkFallbackDir(st({ mode: 0o040600 }), 501).ok, false);
const link = checkFallbackDir(st({ link: true, dir: false, mode: 0o120777 }), 501);
assert.strictEqual(link.ok, false);
assert.strictEqual(checkFallbackDir(st({ link: true, dir: true }), 501).ok, false, 'a symlink is refused even if it reports as a dir');
assert.strictEqual(checkFallbackDir(st({ dir: false }), 501).ok, false, 'a plain file is refused');
for (const r of [wrongOwner, open, link]) assert.ok(!r.ok && r.reason.length > 0);

console.log('test-mcp-paths: ok');
