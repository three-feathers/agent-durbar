/** Broad folders (spec 006 FR-016, issue #170): `npm run test:broadfolder`. Windows paths are tested from any OS. */
import * as assert from 'assert';
import * as path from 'path';
import { broadFolderKind } from '../src/shared/broadfolder';

const P = (f: string, home = '/home/ana') => broadFolderKind(f, home, path.posix, 'linux');
assert.strictEqual(P('/home/ana'), 'home');
assert.strictEqual(P('/home/ana/'), 'home', 'a trailing slash is the same folder');
assert.strictEqual(P('/home'), 'home-parent');
assert.strictEqual(P('/'), 'root');
assert.strictEqual(P('/home/ana/projects/app'), undefined, 'a project inside home is fine');
assert.strictEqual(P('/home/anabel'), undefined, 'a sibling with a common prefix is not a parent');
assert.strictEqual(P('/home/Ana'), undefined, 'Linux compares with case');
assert.strictEqual(P('/srv/data'), undefined);
assert.strictEqual(P('/home/ana/../ana'), 'home', 'resolved first');
assert.strictEqual(P('', '/home/ana'), undefined);
assert.strictEqual(P('/home', ''), undefined, 'no home known: only roots are flagged');
assert.strictEqual(P('/', ''), 'root');

const M = (f: string) => broadFolderKind(f, '/Users/Ana', path.posix, 'darwin');
assert.strictEqual(M('/users/ana'), 'home', 'macOS compares without case');
assert.strictEqual(M('/Users'), 'home-parent');

const W = (f: string, home = 'C:\\Users\\Ana') => broadFolderKind(f, home, path.win32, 'win32');
assert.strictEqual(W('C:\\Users\\Ana'), 'home');
assert.strictEqual(W('c:\\users\\ana\\'), 'home', 'case and trailing separator ignored on Windows');
assert.strictEqual(W('C:\\Users'), 'home-parent');
assert.strictEqual(W('C:\\'), 'root');
assert.strictEqual(W('D:\\'), 'root', 'any drive root');
assert.strictEqual(W('D:\\work\\repo'), undefined);
assert.strictEqual(W('C:\\Users\\Ana\\source\\repo'), undefined);
assert.strictEqual(W('\\\\server\\share\\'), 'root', 'a UNC share root');
assert.strictEqual(W('\\\\server\\share\\team\\repo'), undefined);
assert.strictEqual(W('C:\\Users\\Anabel'), undefined, 'a sibling with a common prefix is not a parent');

console.log('broad folder tests passed');
