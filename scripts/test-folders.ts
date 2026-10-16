/** Unit tests for the saved folder list: `npm run test:folders`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FolderStore, parseSavedFolders } from '../src/main/folders';

const abs = (p: string): string => path.resolve('/', p);
assert.deepStrictEqual(parseSavedFolders('not json'), []);
assert.deepStrictEqual(parseSavedFolders('{"folders":5}'), []);
assert.deepStrictEqual(parseSavedFolders('null'), []);
const parsed = parseSavedFolders(
  JSON.stringify({
    folders: [
      { workspace: abs('a'), permMode: 'ask', hidden: true, model: 'auto', effort: 'high' },
      { workspace: abs('a') }, // duplicate
      { workspace: 'relative/path' }, // not absolute
      { workspace: 5 },
      null,
      'x',
      { workspace: abs('b'), permMode: 'root', effort: 'turbo', model: 7 },
    ],
  }),
);
assert.strictEqual(parsed.length, 2);
assert.deepStrictEqual(parsed[0], { workspace: abs('a'), permMode: 'ask', hidden: true, closed: undefined, model: 'auto', effort: 'high' });
assert.deepStrictEqual(parsed[1], { workspace: abs('b'), permMode: 'read-only', hidden: false, closed: undefined, model: undefined, effort: undefined }, 'unknown values fall back to safe defaults');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-folders-'));
try {
  const file = path.join(dir, 'sub', 'folders.json');
  const s = new FolderStore(file);
  assert.deepStrictEqual(s.load(), [], 'missing file = empty list');
  s.upsert({ workspace: abs('proj'), permMode: 'allow', model: 'auto' });
  s.upsert({ workspace: abs('other'), permMode: 'read-only' });
  assert.ok(s.setHidden(abs('proj'), true));
  s.upsert({ workspace: abs('proj'), permMode: 'ask' }); // refresh keeps hidden
  assert.ok(!s.setHidden(abs('nope'), true));
  // survives a restart
  const again = new FolderStore(file);
  const l = again.load();
  assert.deepStrictEqual(l.map((f) => [f.workspace, f.permMode, f.hidden]), [[abs('proj'), 'ask', true], [abs('other'), 'read-only', false]]);
  assert.ok(again.remove(abs('proj')));
  assert.ok(!again.remove(abs('proj')));
  assert.deepStrictEqual(new FolderStore(file).load().map((f) => f.workspace), [abs('other')]);
  assert.strictEqual(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp')).length, 0, 'no temp files left behind');
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o077, 0, 'file is private');
  // corrupt file
  fs.writeFileSync(file, '{{{');
  assert.deepStrictEqual(new FolderStore(file).load(), []);
  // unwritable location: no throw
  const bad = new FolderStore(path.join(dir, 'sub', 'folders.json', 'x', 'y.json'));
  bad.upsert({ workspace: abs('z'), permMode: 'read-only' });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-folders2-'));
  try {
    const f2 = path.join(d2, 'f.json');
    const st = new FolderStore(f2);
    st.upsert({ workspace: abs('r1'), permMode: 'read-only' });
    assert.ok(st.setClosed(abs('r1'), true));
    assert.ok(st.setPermMode(abs('r1'), 'allow'));
    assert.ok(!st.setClosed(abs('nope'), true));
    const again = new FolderStore(f2).load();
    assert.strictEqual(again[0].closed, true, 'closed door survives a restart');
    assert.strictEqual(again[0].permMode, 'allow', 'mode survives a restart');
    st.upsert({ workspace: abs('r1'), permMode: 'allow' });
    st.upsert({ workspace: abs('r2'), permMode: 'ask' });
    st.remove(abs('r2'));
    assert.strictEqual(new FolderStore(f2).load()[0].closed, true, 'closed survives new/removed folders');
    st.setClosed(abs('r1'), false);
    assert.strictEqual(new FolderStore(f2).load()[0].closed, undefined);
  } finally {
    fs.rmSync(d2, { recursive: true, force: true });
  }
}
console.log('folders tests passed');
