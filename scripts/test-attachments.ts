/** Unit test for attachment caps, sanitizing and staging (no Electron, no AI credits): `npm run test:attachments`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MAX_ATTACH_BYTES, sanitizeName, sniffImage, stageAttachment } from '../src/shared/attachments';

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
console.log('attachments: all checks passed');
