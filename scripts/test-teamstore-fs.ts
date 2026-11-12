/** Spec 111 T006: `TeamTemplateStore` on the REAL file system in a temporary folder (rename over an existing file, no temp left, mode, set-aside). No credits. */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TeamTemplateStore } from '../src/main/teamstore';

const tpl = (name: string): Record<string, unknown> => ({ name, members: [{ name: 'Architect', role: 'Designs', app: 'copilot', permMode: 'ask', sendBrief: true, brief: 'Check it.' }] });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-111-teamstore-'));
let n = 0;
try {
  const file = path.join(root, 'userData', 'team-templates.json'); // the folder does not exist yet
  const s = new TeamTemplateStore(file);
  assert.deepStrictEqual(s.list(), [], 'empty folder'); n++;
  assert.ok(!s.takeToast(), 'no toast'); n++;
  const a = s.put(tpl('First')); assert.ok(a.ok); n++;
  const b = s.put(tpl('Second')); assert.ok(b.ok); n++; // the second save renames over an existing file
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['team-templates.json'], 'no temp left'); n++;
  const again = new TeamTemplateStore(file);
  assert.deepStrictEqual(again.list().map((t) => t.name), ['First', 'Second'], 'reopened'); n++;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  assert.strictEqual(parsed.format, 'agent-durbar-team-templates'); assert.strictEqual(parsed.schemaVersion, 1); n += 2;
  if (a.ok) {
    const d = again.duplicate(a.template.id); assert.ok(d.ok && d.template.name === 'First copy'); n++;
    assert.ok(again.delete(a.template.id).ok); n++;
  }
  assert.deepStrictEqual(new TeamTemplateStore(file).list().map((t) => t.name), ['Second', 'First copy'], 'duplicate and delete on disk'); n++;
  if (process.platform === 'win32') console.log('skipped: 0600 is POSIX only (FR-155)');
  else { assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'mode 0600'); assert.strictEqual(fs.statSync(path.dirname(file)).mode & 0o777, 0o700, 'folder mode 0700'); n += 2; }
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['team-templates.json'], 'no temp after all'); n++;
  // a broken file is moved aside, content identical
  const broken = '{"format": "agent-durbar-team-templates", "schemaV';
  fs.writeFileSync(file, broken);
  const s2 = new TeamTemplateStore(file);
  assert.deepStrictEqual(s2.list(), []); assert.ok(s2.takeToast()); n += 2;
  const files = fs.readdirSync(path.dirname(file)); const bad = files.filter((f) => /^team-templates\.bad-.+\.json$/.test(f));
  assert.strictEqual(bad.length, 1, 'one bad file: ' + files.join(',')); assert.strictEqual(files.length, 1, 'original gone'); n += 2;
  assert.strictEqual(fs.readFileSync(path.join(path.dirname(file), bad[0]), 'utf8'), broken, 'content identical'); n++;
  assert.ok(!new TeamTemplateStore(file).takeToast(), 'not set aside again'); n++;
  assert.ok(s2.put(tpl('After')).ok); assert.strictEqual(fs.readdirSync(path.dirname(file)).length, 2); n += 2;
  // a stale temp of a dead process is removed at load (a pid that cannot exist)
  const stale = `${file}.2147483646.tmp`; fs.writeFileSync(stale, 'brief');
  new TeamTemplateStore(file); assert.ok(!fs.existsSync(stale), 'stale temp removed'); n++;
  // two running instances: the second, with an old fingerprint, is refused and the first one's template is kept
  const f2 = path.join(root, 'two', 'team-templates.json');
  const A = new TeamTemplateStore(f2); const B = new TeamTemplateStore(f2);
  assert.ok(A.put(tpl('FromA')).ok); n++;
  const rb = B.put(tpl('FromB')); assert.ok(!rb.ok && rb.errors[0] === 'changed'); n++;
  assert.deepStrictEqual(new TeamTemplateStore(f2).list().map((t) => t.name), ['FromA'], 'A is not lost'); n++;
  assert.ok(B.put(tpl('FromB')).ok); n++;
  // bad UTF-8 is a bad file, kept as it was
  const f3 = path.join(root, 'utf8', 'team-templates.json'); fs.mkdirSync(path.dirname(f3), { recursive: true });
  const bytes = Buffer.concat([Buffer.from('{"format":"agent-durbar-team-templates","schemaVersion":1,"templates":[{"name":"'), Buffer.from([0xff, 0xfe, 0xc3]), Buffer.from('"}]}')]);
  fs.writeFileSync(f3, bytes); assert.deepStrictEqual(new TeamTemplateStore(f3).list(), []);
  const bad3 = fs.readdirSync(path.dirname(f3)).filter((f) => f.includes('.bad-')); assert.strictEqual(bad3.length, 1); assert.ok(fs.readFileSync(path.join(path.dirname(f3), bad3[0])).equals(bytes)); n += 3;
  // a REAL dangling symlink as the store file: set aside as a link (never followed), and the next save works, whichever call meets it first
  let linked = true;
  const link = (f: string): boolean => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); try { fs.rmSync(f, { force: true }); } catch { /* none */ } fs.symlinkSync(path.join(root, 'nowhere', 'target.json'), f); return true; } catch { return false; } };
  const f4 = path.join(root, 'link-load', 'team-templates.json');
  if (!link(f4)) { linked = false; console.log('skipped: no permission to make a symlink here (Windows without developer mode)'); }
  if (linked) {
    const L = new TeamTemplateStore(f4); assert.deepStrictEqual(L.list(), []); assert.ok(L.takeToast(), 'toast'); assert.ok(!L.isBlocked()); n += 3;
    const asideLinks = (d: string): string[] => fs.readdirSync(d).filter((x) => x.includes('.bad-') && fs.lstatSync(path.join(d, x)).isSymbolicLink());
    assert.strictEqual(asideLinks(path.dirname(f4)).length, 1, 'the link itself was moved, not followed'); n++;
    assert.ok(L.put(tpl('After the link')).ok); assert.ok(fs.lstatSync(f4).isFile()); n += 2;
    for (const op of ['put', 'duplicate', 'delete'] as const) {
      const f = path.join(root, 'link-' + op, 'team-templates.json');
      const St = new TeamTemplateStore(f); const t = St.put(tpl('Mine')); assert.ok(t.ok); if (!t.ok) continue;
      fs.rmSync(f); assert.ok(link(f)); // the file becomes a dangling link under the running store
      const r = op === 'put' ? St.put(tpl('Other')) : op === 'duplicate' ? St.duplicate(t.template.id) : St.delete(t.template.id);
      assert.ok(!r.ok && r.errors[0] === 'changed', op + ': changed'); assert.strictEqual(asideLinks(path.dirname(f)).length, 1, op + ': the link is set aside');
      assert.ok(St.put(tpl('Next')).ok, op + ': the next save works'); assert.ok(fs.lstatSync(f).isFile(), op + ': a regular file again'); n += 4;
    }
  }
  // the folder has no search permission at the start (real chmod): blocked; when it is back, the good file is reloaded, never set aside
  if (process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0)) console.log('skipped: folder chmod test needs POSIX and a user that is not root');
  else {
    const f5 = path.join(root, 'perm', 'team-templates.json'); const P = new TeamTemplateStore(f5); assert.ok(P.put(tpl('Good1')).ok);
    const dir5 = path.dirname(f5);
    try {
      fs.chmodSync(dir5, 0o600);
      const Q = new TeamTemplateStore(f5, { pause: () => undefined }); assert.ok(Q.isBlocked(), 'blocked'); assert.ok(!Q.takeToast()); assert.ok(!Q.put(tpl('After')).ok); n += 3;
      fs.chmodSync(dir5, 0o700);
      const r = Q.put(tpl('After')); assert.ok(!r.ok && r.errors[0] === 'changed', 'changed'); assert.deepStrictEqual(Q.list().map((t) => t.name), ['Good1']);
      assert.strictEqual(fs.readdirSync(dir5).filter((x) => x.includes('.bad-')).length, 0, 'no set-aside file'); assert.ok(!Q.takeToast()); assert.ok(Q.put(tpl('After')).ok); n += 5;
    } finally { try { fs.chmodSync(dir5, 0o700); } catch { /* gone */ } }
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(`test-teamstore-fs: ${n} checks passed`);
