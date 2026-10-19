/** Unit test for attachment caps, sanitizing and staging (no Electron, no AI credits): `npm run test:attachments`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MAX_ATTACH_BYTES, STAGE_PREFIX, kindOfFile, sanitizeName, sniffImage, stageAttachment, sweepStaleStageDirs } from '../src/shared/attachments';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-att-test-'));

assert.strictEqual(sniffImage(png)?.ext, 'png');
assert.strictEqual(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')), null);
assert.strictEqual(sanitizeName('../../etc/passwd', 'x'), 'passwd');
assert.strictEqual(sanitizeName('..\\..\\evil<>.png', 'x'), 'evil.png');
assert.strictEqual(sanitizeName('  \u0000 ', 'fallback'), 'fallback');
assert.strictEqual(sanitizeName('.hidden', 'x'), 'hidden');
assert.ok(sanitizeName('a'.repeat(300) + '.txt', 'x').length <= 80);

// ok image: extension follows the real format
let r = stageAttachment(dir, 'shot.jpeg', 'image/jpeg', png);
assert.ok(r.ok && r.name === 'shot.png' && r.kind === 'image' && fs.existsSync(r.path) && path.dirname(path.dirname(r.path)) === dir);
// image declared, but not an image (e.g. svg / html renamed)
r = stageAttachment(dir, 'x.png', 'image/png', Buffer.from('<html></html>'));
assert.ok(!r.ok);
// path traversal in name stays inside the stage dir
r = stageAttachment(dir, '../../../tmp/pwn.txt', 'text/plain', Buffer.from('hi'));
assert.ok(r.ok && r.name === 'pwn.txt' && r.path.startsWith(dir + path.sep));
// caps
r = stageAttachment(dir, 'big.png', 'image/png', Buffer.concat([png, Buffer.alloc(MAX_ATTACH_BYTES)]));
assert.ok(!r.ok && /per-file limit/.test(r.error), JSON.stringify(r));
r = stageAttachment(dir, 'edge.bin', 'application/octet-stream', Buffer.alloc(MAX_ATTACH_BYTES));
assert.ok(r.ok, 'exactly 10 MB is allowed');
assert.ok(!stageAttachment(dir, 'empty.txt', 'text/plain', Buffer.alloc(0)).ok);
fs.rmSync(dir, { recursive: true, force: true });
// spec 004 FR-009: a picked file's kind comes from its bytes
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-kind-'));
  const png = path.join(d, 'real.txt'), fake = path.join(d, 'fake.png'), empty = path.join(d, 'empty.png');
  fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  fs.writeFileSync(fake, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(empty, '');
  assert.strictEqual(kindOfFile(png), 'image', 'PNG bytes are an image whatever the name');
  assert.strictEqual(kindOfFile(fake), 'file', 'a .png that is not an image is a file');
  assert.strictEqual(kindOfFile(empty), 'file');
  assert.strictEqual(kindOfFile(path.join(d, 'missing')), 'file');
  fs.rmSync(d, { recursive: true, force: true });
}
// spec 004 FR-010: stale staging folders are swept, fresh ones and other folders are left
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-sweep-'));
  const old = path.join(tmp, STAGE_PREFIX + 'old'), fresh = path.join(tmp, STAGE_PREFIX + 'fresh'), other = path.join(tmp, 'other-folder');
  for (const p of [old, fresh, other]) fs.mkdirSync(p);
  fs.writeFileSync(path.join(old, 'x'), 'x');
  fs.writeFileSync(path.join(tmp, STAGE_PREFIX + 'a-file'), 'not a folder');
  const day = 24 * 3600_000, now = Date.now();
  fs.utimesSync(old, (now - 2 * day) / 1000, (now - 2 * day) / 1000);
  fs.utimesSync(other, (now - 9 * day) / 1000, (now - 9 * day) / 1000);
  try { fs.symlinkSync(other, path.join(tmp, STAGE_PREFIX + 'link')); } catch { /* no symlinks here */ }
  assert.strictEqual(sweepStaleStageDirs(tmp, now), 1, 'only the old staging folder');
  assert.ok(!fs.existsSync(old) && fs.existsSync(fresh) && fs.existsSync(other) && fs.existsSync(path.join(tmp, STAGE_PREFIX + 'a-file')));
  assert.strictEqual(sweepStaleStageDirs(path.join(tmp, 'missing')), 0);
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('attachments: all checks passed');
