/** The chat's edit-row words, paths and line counts (spec 005 FR-020..FR-025), in Node. `npm run test:edits`. No credits. */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const R = path.join(__dirname, '..', '..', 'src', 'renderer');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const V = require(path.join(R, 'editview.js'));

// FR-025: relative to the folder, POSIX and Windows, case on Windows only, own separator kept, outside paths stay absolute
assert.deepStrictEqual(V.displayPath('/home/u/app/src/main.ts', '/home/u/app'), { name: 'main.ts', dir: 'src', full: '/home/u/app/src/main.ts', rel: 'src/main.ts' });
assert.deepStrictEqual(V.displayPath('/home/u/app/README.md', '/home/u/app/').rel, 'README.md');
assert.strictEqual(V.displayPath('/home/u/App/x.ts', '/home/u/app').rel, '/home/u/App/x.ts', 'POSIX compares with case');
assert.strictEqual(V.displayPath('/home/u/app2/x.ts', '/home/u/app').rel, '/home/u/app2/x.ts', 'a sibling folder with the same prefix is outside');
assert.deepStrictEqual(V.displayPath('C:\\Users\\Ana\\proj\\src\\a.ts', 'c:\\users\\ana\\proj'), { name: 'a.ts', dir: 'src', full: 'C:\\Users\\Ana\\proj\\src\\a.ts', rel: 'src\\a.ts' });
assert.strictEqual(V.displayPath('C:/Users/Ana/proj/b.ts', 'C:\\Users\\Ana\\proj').rel, 'b.ts', 'mixed separators');
assert.strictEqual(V.displayPath('\\\\srv\\share\\p\\c.ts', '\\\\SRV\\share\\p').rel, 'c.ts', 'UNC');
assert.strictEqual(V.displayPath('D:\\other\\c.ts', 'C:\\proj').name, 'c.ts');
assert.strictEqual(V.displayPath('src/rel.ts', '/home/u/app').dir, 'src', 'a relative path stays as given');
assert.strictEqual(V.displayPath('file.txt', '').name, 'file.txt');
assert.strictEqual(V.displayPath('a\nb.ts', '').name, 'a b.ts', 'no line breaks');
assert.strictEqual(V.displayPath(null, null).name, '');

// FR-020 / FR-023: words of the row
const one = { files: [{ path: '/p/src/app.js', kind: 'edit', diff: '@@\n-a\n+b\n+c', added: 2, removed: 1 }] };
assert.deepStrictEqual(V.summary(one, { running: true, folder: '/p' }), { verb: 'Editing', name: 'app.js', dir: 'src', count: '+2 −1', text: 'Editing app.js', title: '/p/src/app.js', to: '' });
assert.strictEqual(V.summary(one, { folder: '/p' }).text, 'Edited app.js');
assert.strictEqual(V.summary(one, { running: true, simple: true }).text, 'Changing app.js');
assert.strictEqual(V.summary({ files: [{ path: 'n.md', kind: 'create' }] }, { running: true }).text, 'Creating n.md');
assert.strictEqual(V.summary({ files: [{ path: 'n.md', kind: 'create' }] }, {}).count, '', 'no diff, no counts');
assert.strictEqual(V.summary({ files: [{ path: 'w.md', kind: 'write', diff: '@@\n+x', added: 1, removed: 0 }] }, {}).text, 'Wrote w.md');
assert.strictEqual(V.summary({ files: [{ path: 'w.md', kind: 'write' }] }, { simple: true, running: true }).text, 'Changing w.md');
assert.strictEqual(V.summary({ files: [{ path: 'o.ts', kind: 'move', movedTo: 'p.ts' }] }, { running: true }).text, 'Moving o.ts → p.ts');
assert.strictEqual(V.summary({ files: [{ path: 'gone.ts', kind: 'delete' }] }, {}).text, 'Deleted gone.ts');
const two = { files: [{ path: 'a.ts', kind: 'edit', diff: '@@\n+a', added: 1, removed: 0 }, { path: 'b.ts', kind: 'create', diff: '@@\n+b\n+c', added: 2, removed: 0 }] };
assert.strictEqual(V.summary(two, { running: true }).text, 'Editing 2 files');
assert.strictEqual(V.summary(two, { running: true, simple: true }).text, 'Changing 2 files');
assert.strictEqual(V.summary(two, {}).count, '+3 −0');
assert.strictEqual(V.summary({ files: [{ path: 'a', kind: 'create' }, { path: 'b', kind: 'create' }], more: 3 }, { running: true }).text, 'Creating 5 files');
assert.strictEqual(V.summary({ files: [] }, {}).text, '');
assert.strictEqual(V.summary(null, {}).text, '');
assert.strictEqual(V.summary({ files: [{ path: 'x', kind: 'weird' }] }, { running: true }).verb, 'Editing');

// review on #463: a refused or failed edit never reads as done
assert.strictEqual(V.summary(one, { failed: true, folder: '/p' }).text, 'Could not edit app.js');
assert.strictEqual(V.summary(one, { failed: true, simple: true }).text, 'Not changed app.js');
assert.strictEqual(V.summary({ files: [{ path: 'c.ts', kind: 'delete' }] }, { failed: true }).text, 'Could not delete c.ts');
assert.strictEqual(V.summary({ files: [{ path: 'n.md', kind: 'create' }] }, { failed: true, simple: true }).text, 'Not created n.md');
assert.strictEqual(V.summary({ files: [{ path: 'o.ts', kind: 'move', movedTo: 'p.ts' }] }, { failed: true }).text, 'Could not move o.ts → p.ts');
assert.strictEqual(V.summary(two, { failed: true }).text, 'Could not edit 2 files');
assert.strictEqual(V.summary(one, { failed: true, running: true }).text, 'Editing app.js', 'running wins over a stale failed flag');
assert.ok(!/^(Edited|Wrote|Created|Deleted|Moved|Changed)\b/.test(V.summary({ files: [{ path: 'w.md', kind: 'write' }] }, { failed: true }).text));

// FR-021: 12 lines open, at most 400 drawn
assert.strictEqual(V.shown(5, false), 5);
assert.strictEqual(V.shown(50, false), V.OPEN_LINES);
assert.strictEqual(V.shown(50, true), 50);
assert.strictEqual(V.shown(5000, true), V.MAX_LINES);
assert.strictEqual(V.OPEN_LINES, 12);

// the page loads it before app.js, and the build copies it
const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
assert.ok(html.indexOf('editview.js') > 0 && html.indexOf('editview.js') < html.indexOf('src="app.js"'), 'index.html loads editview.js before app.js');
assert.ok(fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'copy-assets.js'), 'utf8').includes("'editview.js'"), 'copy-assets copies editview.js');

console.log('editview: ok');
