/** Unit test (spec 065): CheckpointStore keeps, previews and restores an agent's file changes per turn, safely. Temp folders only. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CheckpointStore } from '../src/main/checkpoints';
import { PermissionBroker } from '../src/adapters/permissions';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-ckpt-test-'));
const store = path.join(base, 'store');
const ws = path.join(base, 'ws');
const outside = path.join(base, 'outside');
fs.mkdirSync(ws);
fs.mkdirSync(outside);
const w = (p: string, s: string | Buffer): void => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const r = (p: string): string => fs.readFileSync(p, 'utf8');
const A = 'agent-1';
const roots = [ws];

const cs = new CheckpointStore(store, { fileBytes: 1024, turnBytes: 4096, turnsPerSession: 3, totalBytes: 1 << 20 });
if (process.platform !== 'win32') assert.strictEqual(fs.statSync(store).mode & 0o777, 0o700, 'private store folder');

// ---- a turn: change one file, create one, delete one
const fa = path.join(ws, 'a.txt'), fb = path.join(ws, 'sub', 'b.txt'), fc = path.join(ws, 'c.txt');
w(fa, 'one\ntwo\n');
w(fc, 'to be deleted\n');
const t1 = cs.beginTurn(A, roots);
cs.capture(A, roots, fa);
cs.capture(A, roots, 'sub/b.txt'); // relative to the session's folder
cs.capture(A, roots, fc);
w(fa, 'one\nTWO\nthree\n');
cs.capture(A, roots, fa); // a second write in the same turn: the first copy wins
w(fa, 'one\nTWO!\n');
w(fb, 'new file\n');
fs.unlinkSync(fc);
const s1 = cs.endTurn(A)!;
assert.strictEqual(s1.turn, t1);
assert.deepStrictEqual(s1.files.map((f) => `${f.change}:${f.path}`).sort(), ['changed:a.txt', `created:${path.join('sub', 'b.txt')}`, 'deleted:c.txt'].sort());
if (process.platform !== 'win32') for (const f of fs.readdirSync(path.join(store, String(t1)))) assert.strictEqual(fs.statSync(path.join(store, String(t1), f)).mode & 0o777, 0o600, 'private copies');

// preview: actions, a diff from now to before, no conflicts
let p = cs.preview(A, t1);
assert.ok(p.ok);
if (p.ok) {
  const byPath = Object.fromEntries(p.files.map((f) => [f.path, f]));
  assert.strictEqual(byPath['a.txt'].action, 'restore');
  assert.match(String(byPath['a.txt'].diff), /-TWO!\n\+two/);
  assert.strictEqual(byPath[path.join('sub', 'b.txt')].action, 'remove');
  assert.strictEqual(byPath['c.txt'].action, 'create');
  assert.deepStrictEqual(p.conflicts, []);
}

// ---- someone changed a file after the turn: the whole undo refuses, nothing is written
w(fa, 'user edit\n');
const refused = cs.undo(A, t1);
assert.ok(!refused.ok && refused.conflicts?.includes('a.txt'), 'conflict refuses the whole turn');
assert.strictEqual(r(fa), 'user edit\n');
assert.ok(fs.existsSync(fb), 'nothing removed on a refusal');
w(fa, 'one\nTWO!\n'); // back to what the turn left

// ---- undo: restore, remove the created file, create the deleted one back; mode kept
if (process.platform !== 'win32') fs.chmodSync(fa, 0o640);
const u1 = cs.undo(A, t1);
assert.ok(u1.ok, JSON.stringify(u1));
if (!u1.ok) throw new Error('undo failed');
assert.deepStrictEqual([u1.restored, u1.removed, u1.created], [1, 1, 1]);
assert.strictEqual(r(fa), 'one\ntwo\n');
assert.ok(!fs.existsSync(fb), 'the file the agent created is removed');
assert.strictEqual(r(fc), 'to be deleted\n', 'the file the agent deleted is back');
assert.ok(!fs.readdirSync(ws).some((n) => n.includes('.durbar-')), 'no temp file left');
assert.strictEqual(u1.undo.kind, 'undo');

// ---- undo the undo: the agent's changes come back
const u2 = cs.undo(A, u1.undo.turn);
assert.ok(u2.ok, JSON.stringify(u2));
assert.strictEqual(r(fa), 'one\nTWO!\n');
assert.strictEqual(r(fb), 'new file\n');
assert.ok(!fs.existsSync(fc));

// ---- outside paths, symbolic links, non-files, binary and large files
const t2 = cs.beginTurn(A, roots);
cs.capture(A, roots, path.join(outside, 'x.txt'));
cs.capture(A, roots, '../outside/y.txt');
let linked = false;
try {
  fs.symlinkSync(path.join(outside), path.join(ws, 'link-dir'));
  fs.symlinkSync(path.join(outside, 'target.txt'), path.join(ws, 'link.txt'));
  linked = true;
} catch { /* no symlink rights (Windows): skipped */ }
w(path.join(outside, 'target.txt'), 'secret\n');
if (linked) {
  cs.capture(A, roots, path.join(ws, 'link.txt'));
  cs.capture(A, roots, path.join(ws, 'link-dir', 'inner.txt'));
}
cs.capture(A, roots, path.join(ws, 'sub')); // a folder
const big = path.join(ws, 'big.bin');
w(big, Buffer.alloc(2048, 1));
cs.capture(A, roots, big);
const bin = path.join(ws, 'img.bin');
w(bin, Buffer.from([0, 1, 2, 3, 0, 255]));
cs.capture(A, roots, bin);
w(bin, Buffer.from([9, 9, 0, 9]));
cs.capture(A, roots, ''); cs.capture(A, roots, 'a\0b'); cs.capture(A, roots, 'x'.repeat(5000)); // ignored inputs
const s2 = cs.endTurn(A)!;
const why = Object.fromEntries(s2.notCovered.map((n) => [path.basename(n.path), n.why]));
assert.match(why['x.txt'], /outside/);
assert.match(why['y.txt'], /outside/);
if (linked) {
  assert.match(why['link.txt'], /symbolic link/);
  assert.match(why['inner.txt'], /through a link/);
}
assert.match(why['sub'], /not a regular file/);
assert.match(why['big.bin'], /too large/);
assert.deepStrictEqual(s2.files.map((f) => f.path), ['img.bin']);
p = cs.preview(A, t2);
assert.ok(p.ok && p.files[0].binary === true && !p.files[0].diff, 'binary files get no text diff');
assert.ok(cs.undo(A, t2).ok);
assert.deepStrictEqual([...fs.readFileSync(bin)], [0, 1, 2, 3, 0, 255]);
assert.strictEqual(r(path.join(outside, 'target.txt')), 'secret\n', 'never touched a file outside');

// ---- per-turn byte cap; unchanged writes are not listed; a turn without changes gives no summary
const t3 = cs.beginTurn(A, roots);
for (let i = 0; i < 6; i++) { const f = path.join(ws, `m${i}.txt`); w(f, 'x'.repeat(900)); cs.capture(A, roots, f); w(f, 'y'); }
const s3 = cs.endTurn(A)!;
assert.ok(s3.files.length === 4 && s3.notCovered.filter((n) => /this turn changed too much/.test(n.why)).length === 2, JSON.stringify(s3));
cs.beginTurn(A, roots);
cs.capture(A, roots, fa); // written back unchanged
assert.strictEqual(cs.endTurn(A), undefined);
void t3;

// ---- only the last N turns are kept; forget drops everything
for (let i = 0; i < 4; i++) { cs.beginTurn(A, roots); cs.capture(A, roots, fa); w(fa, `v${i}\n`); cs.endTurn(A); }
const old = cs.preview(A, t1);
assert.ok(!old.ok, 'an old turn is no longer kept');
cs.forget(A);
assert.ok(!cs.preview(A, s3.turn).ok);
assert.deepStrictEqual(fs.readdirSync(store).filter((d) => fs.readdirSync(path.join(store, d)).length), [], 'copies deleted');
assert.ok(!cs.undo('nobody', 1).ok && !cs.undo(A, 'x' as unknown as number).ok, 'unknown agent or bad turn');

// a new store empties the folder (copies only live while the app runs)
w(path.join(store, 'stale', 'x.bin'), 'x');
new CheckpointStore(store);
assert.deepStrictEqual(fs.readdirSync(store), []);

// ---- FR-001: the broker awaits the write guard before an approved write (Allow all, a session grant, the user's approval),
// with every path of a Codex file change, never for a denied write or a read, and never longer than its bound
async function brokerChecks(): Promise<void> {
  const seen: string[][] = [];
  let release: (() => void) | undefined;
  const slow = new Promise<void>((r) => { release = r; });
  const mk = (mode: 'allow' | 'ask' | 'read-only', guard: (p: string[]) => Promise<void> = async (p) => { seen.push(p); }) => new PermissionBroker({ mode, emit: () => undefined, beforeWrite: guard });
  assert.deepStrictEqual(await mk('allow').request({ kind: 'write', fileName: '/w/a.ts' }), { kind: 'approve-once' });
  assert.deepStrictEqual(seen.pop(), ['/w/a.ts']);
  await mk('allow').request({ kind: 'write', fileName: '/w/a.ts', paths: ['/w/a.ts', '/w/b.ts'] });
  assert.deepStrictEqual(seen.pop(), ['/w/a.ts', '/w/b.ts'], 'every path of a Codex file change');
  await mk('allow').request({ kind: 'read', path: '/w/a.ts' });
  await mk('allow').request({ kind: 'shell', fullCommandText: 'ls' });
  assert.strictEqual(seen.length, 0, 'no guard for reads or shell');
  assert.strictEqual((await mk('read-only').request({ kind: 'write', fileName: '/w/a.ts' })).kind, 'reject');
  assert.strictEqual(seen.length, 0, 'no guard for a denied write');
  const ask = mk('ask');
  const pend = ask.request({ kind: 'write', fileName: '/w/c.ts', toolCallId: 't1' });
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(seen.length, 0, 'not before the user answers');
  ask.resolve('t1', true, true);
  assert.strictEqual((await pend).kind, 'approve-once');
  assert.deepStrictEqual(seen.pop(), ['/w/c.ts'], 'after the user approves');
  await ask.request({ kind: 'write', fileName: '/w/c.ts', toolCallId: 't2' });
  assert.deepStrictEqual(seen.pop(), ['/w/c.ts'], 'a session grant too');
  const denyB = mk('ask');
  const pd = denyB.request({ kind: 'write', fileName: '/w/d.ts', toolCallId: 't3' });
  await new Promise((r) => setTimeout(r, 0));
  denyB.resolve('t3', false);
  assert.strictEqual((await pd).kind, 'reject');
  assert.strictEqual(seen.length, 0, 'the user denied: no guard');
  // a failing guard never fails the write; a hanging one is cut off after 2 s
  assert.strictEqual((await mk('allow', async () => { throw new Error('boom'); }).request({ kind: 'write', fileName: '/w/e.ts' })).kind, 'approve-once');
  const t0 = Date.now();
  assert.strictEqual((await mk('allow', () => slow).request({ kind: 'write', fileName: '/w/f.ts' })).kind, 'approve-once');
  assert.ok(Date.now() - t0 < 3000, 'bounded');
  release?.();
}

// ---- the words (src/renderer/checkpoints.js)
const C = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'checkpoints.js')) as { diffCounts: (d: string) => { add: number; del: number }; noteText: (n: unknown) => string; button: (n: unknown) => string; previewLines: (p: unknown) => string[]; confirmLabel: (p: unknown) => string };
assert.deepStrictEqual(C.diffCounts('--- a/x\n+++ b/x\n@@\n-a\n+b\n+c\n'), { add: 2, del: 1 });
assert.strictEqual(C.noteText({ kind: 'turn', files: [], notCovered: [] }), '', 'no line for a turn without changes');
assert.strictEqual(C.noteText({ kind: 'turn', files: [1, 2, 3, 4, 5].map((i) => ({ path: `f${i}`, change: 'changed' })), notCovered: [] }), 'Changed 5 files in this turn: f1, f2, f3, and 2 more files.');
assert.strictEqual(C.noteText({ kind: 'undo', files: [{ path: 'a', change: 'changed' }], notCovered: [] }), 'Restored 1 file: a.');
assert.strictEqual(C.button({ kind: 'undo' }), 'Undo the undo…');
assert.deepStrictEqual(C.previewLines({ files: [{ path: 'img.png', action: 'restore', binary: true }], notCovered: [] }), ['Restore img.png (binary file)']);
assert.strictEqual(C.confirmLabel({ files: [{}] }), 'Restore 1 file');

brokerChecks().then(() => {
fs.rmSync(base, { recursive: true, force: true });
console.log('checkpoints: capture, preview, conflicts, undo, undo of undo, links, outside paths, binary, limits, forget OK');
}).catch((e) => { console.error(e); process.exit(1); });
