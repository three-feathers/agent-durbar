/**
 * Issue #917 (spec 083 T062): the shared capped, non-blocking, no-follow read (`src/shared/cappedread.ts`), on the real file system,
 * and its three callers (notes file, MCP key file, slash commands) are covered by their own suites. Guards under test: no-follow,
 * non-block (a FIFO in a child with a time limit), regular file, one link, cap, and `size + 1` growth. `npm run test:cappedread`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { readCapped } from '../src/shared/cappedread';
import { realFs, discoverSlash, SLASH_HEAD_BYTES } from '../src/adapters/slashcommands';

const posix = process.platform !== 'win32';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-capped-'));
const f = (n: string): string => path.join(root, n);
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n' + (e as Error).stack); }
}
const code = (r: ReturnType<typeof readCapped>): string => (r.ok ? 'ok' : r.code);

(async () => {
  await test('a regular file is read whole, undecoded', () => {
    fs.writeFileSync(f('a'), 'héllo');
    const r = readCapped(fs, fs.constants, f('a'), 100);
    assert.ok(r.ok && r.buf.toString('utf8') === 'héllo');
    fs.writeFileSync(f('empty'), '');
    const e = readCapped(fs, fs.constants, f('empty'), 100);
    assert.ok(e.ok && e.buf.length === 0);
  });
  await test('missing; a folder is not a file', () => {
    assert.strictEqual(code(readCapped(fs, fs.constants, f('nope'), 10)), 'missing');
    fs.mkdirSync(f('dir'));
    assert.strictEqual(code(readCapped(fs, fs.constants, f('dir'), 10)), 'not-file');
  });
  await test('cap: exactly the cap is read, one byte more is too-big (before any read)', () => {
    fs.writeFileSync(f('cap'), 'x'.repeat(10));
    assert.strictEqual(code(readCapped(fs, fs.constants, f('cap'), 10)), 'ok');
    let reads = 0;
    const counting = { ...fs, readSync: (...a: unknown[]) => { reads++; return (fs.readSync as (...x: unknown[]) => number)(...a); } } as never;
    assert.strictEqual(code(readCapped(counting, fs.constants, f('cap'), 9)), 'too-big');
    assert.strictEqual(reads, 0, 'an oversize file is never read');
  });
  await test('growth: fstat says small, the file has more: at most size + 1 bytes, "changing" (or too-big past the cap)', () => {
    fs.writeFileSync(f('grow'), 'z'.repeat(5000));
    const lying = { ...fs, fstatSync: (fd: number) => Object.assign(fs.fstatSync(fd), { size: 10 }) };
    assert.strictEqual(code(readCapped(lying, fs.constants, f('grow'), 100000)), 'changing');
    assert.strictEqual(code(readCapped(lying, fs.constants, f('grow'), 10)), 'too-big');
  });
  await test('a final symbolic link is refused by O_NOFOLLOW (no fd left open)', () => {
    if (!posix) return console.log('  (skipped on Windows: no O_NOFOLLOW)');
    fs.writeFileSync(f('target'), 'secret');
    fs.symlinkSync(f('target'), f('link'));
    assert.strictEqual(code(readCapped(fs, fs.constants, f('link'), 100)), 'link');
    // without O_NOFOLLOW (like Windows) the link would be followed: the flag is what refuses it
    const noFollow = { O_RDONLY: fs.constants.O_RDONLY, O_NONBLOCK: fs.constants.O_NONBLOCK };
    assert.strictEqual(code(readCapped(fs, noFollow, f('link'), 100)), 'ok', 'proves the test sees the flag');
  });
  await test('a file with a second (hard) link is refused', () => {
    fs.writeFileSync(f('orig'), 'x');
    try { fs.linkSync(f('orig'), f('hard')); } catch (e) { return console.log(`  (skipped: no hard links here, ${(e as { code?: string }).code})`); }
    assert.strictEqual(code(readCapped(fs, fs.constants, f('hard'), 100)), 'links');
    assert.strictEqual(code(readCapped(fs, fs.constants, f('orig'), 100)), 'links');
  });
  await test('a FIFO is refused at once; the open does not block (child process with a time limit)', () => {
    if (!posix) return console.log('  (skipped on Windows: no mkfifo; the regular-file check still applies)');
    execFileSync('mkfifo', [f('fifo')]);
    const mod = path.join(__dirname, '..', 'src', 'shared', 'cappedread.js');
    const child = `const fs = require('fs'); const C = require(${JSON.stringify(mod)});
      const r = C.readCapped(fs, fs.constants, ${JSON.stringify(f('fifo'))}, 1000);
      process.stdout.write(JSON.stringify([r.ok, r.code]));`;
    const out = execFileSync(process.execPath, ['-e', child], { timeout: 8000, encoding: 'utf8' });
    assert.deepStrictEqual(JSON.parse(out), [false, 'not-file'], out);
  });
  await test('slash commands: a file swapped to a symlink after realpath is refused by O_NOFOLLOW; the 8 KiB head slice cuts a bigger file', () => {
    // the real slash-command reader (`realFs.readHead`), not the helper alone: a caller that drops O_NOFOLLOW or the slice fails here
    fs.writeFileSync(f('cmd-target'), 'secret');
    const big = 'a'.repeat(SLASH_HEAD_BYTES * 2 + 5);
    fs.writeFileSync(f('big.md'), big);
    assert.strictEqual(realFs.readHead(f('big.md'), SLASH_HEAD_BYTES, 64 * 1024).length, SLASH_HEAD_BYTES, 'cut to the head, not the whole file');
    assert.throws(() => realFs.readHead(f('big.md'), SLASH_HEAD_BYTES, 10), /too large/);
    if (!posix) return console.log('  (symlink part skipped on Windows: no O_NOFOLLOW)');
    fs.symlinkSync(f('cmd-target'), f('cmd-link.md'));
    assert.throws(() => realFs.readHead(f('cmd-link.md'), 100, 1000), /cannot read \(link\)/);
    // end to end: realpath and lstat answered "a regular file" before the swap, the open then meets the link
    const dir = f('cmds');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'ok.md'), 'Do it.');
    fs.symlinkSync(f('cmd-target'), path.join(dir, 'swapped.md'));
    const swapped = { ...realFs, realpath: (p: string) => p, lstat: (p: string) => (p.endsWith('swapped.md') ? fs.lstatSync(path.join(dir, 'ok.md')) : fs.lstatSync(p)) };
    const names = discoverSlash([{ dir, root: dir, scope: 'folder', kind: 'command', layout: 'md-files', whereBase: '' }], { fs: swapped, caseInsensitive: false }).map((e) => e.name);
    assert.deepStrictEqual(names, ['ok'], 'the swapped file is skipped, the plain one stays');
  });
  await test('vet: runs after the file and link checks, before the size check; its text is returned; Windows-like flags still read', () => {
    fs.writeFileSync(f('v'), 'x'.repeat(50));
    const seen: number[] = [];
    const r = readCapped(fs, fs.constants, f('v'), 10, (st) => { seen.push(st.size); return 'nope'; });
    assert.deepStrictEqual(r, { ok: false, code: 'vetoed', why: 'nope' });
    assert.deepStrictEqual(seen, [50], 'vet ran although the size is over the cap: it comes first');
    assert.strictEqual(code(readCapped(fs, fs.constants, f('v'), 10, () => undefined)), 'too-big');
    assert.strictEqual(code(readCapped(fs, { O_RDONLY: fs.constants.O_RDONLY }, f('v'), 100)), 'ok');
  });
  await test('an unexpected error gives code "error" with the errno, never a throw; the descriptor is closed', () => {
    let closed = 0;
    const boom = { ...fs, readSync: () => { throw Object.assign(new Error('x'), { code: 'EIO' }); }, closeSync: (fd: number) => { closed++; fs.closeSync(fd); } };
    const r = readCapped(boom as never, fs.constants, f('cap'), 100);
    assert.deepStrictEqual(r, { ok: false, code: 'error', errno: 'EIO' });
    assert.strictEqual(closed, 1);
  });
  fs.rmSync(root, { recursive: true, force: true });
  if (failed) { console.log(`${failed} failed`); process.exit(1); }
  console.log('cappedread: all passed');
})();
