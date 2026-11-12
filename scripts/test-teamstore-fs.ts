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
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(`test-teamstore-fs: ${n} checks passed`);
