/** Unit test for the shared PATH-directory helper (spec 060 FR-094): `npm run test:pathdirs`. */
import * as assert from 'assert';
import { pathDirs } from '../src/shared/pathdirs';

// Windows: PATH, quotes, empty and relative entries, case-insensitive dedupe (first wins)
assert.deepStrictEqual(pathDirs({ PATH: 'C:\\a;"C:\\Program Files\\b";;rel\\c;.;c:\\A;C:\\d' }, 'win32'), ['C:\\a', 'C:\\Program Files\\b', 'C:\\d']);
assert.deepStrictEqual(pathDirs({ PATH: 'c:\\x;C:\\X' }, 'win32'), ['c:\\x'], 'first spelling wins');
assert.deepStrictEqual(pathDirs({ Path: 'C:\\p' }, 'win32'), ['C:\\p'], 'Path used when PATH is not set');
assert.deepStrictEqual(pathDirs({ PATH: 'C:\\upper', Path: 'C:\\lower' }, 'win32'), ['C:\\upper'], 'PATH read before Path');
assert.deepStrictEqual(pathDirs({ PATH: '""; "" ;"C:\\q"x' }, 'win32'), [], 'empty quotes and half-quoted junk dropped');
assert.deepStrictEqual(pathDirs({}, 'win32'), []);
assert.deepStrictEqual(pathDirs({ PATH: 'bin;C:\\a;D:rel' }, 'win32'), ['C:\\a'], 'drive-relative and bare names are not absolute');
// POSIX: exact dedupe, empty and relative entries, quotes are not special, Path is ignored
assert.deepStrictEqual(pathDirs({ PATH: '/a::/b:rel:.:/a:/A' }, 'linux'), ['/a', '/b', '/A']);
assert.deepStrictEqual(pathDirs({ PATH: '"/a":/b' }, 'darwin'), ['/b'], 'quotes are not stripped on POSIX');
assert.deepStrictEqual(pathDirs({ Path: '/a' }, 'linux'), [], 'Path ignored on POSIX');
assert.deepStrictEqual(pathDirs({ PATH: 'C:\\a:/b' }, 'linux'), ['/b']);
assert.deepStrictEqual(pathDirs({ PATH: '/opt/a b /bin: /lead:/trail /:/ok' }, 'linux'), ['/opt/a b /bin', '/trail /', '/ok'], 'POSIX entries are not trimmed: inner and trailing spaces kept, a leading space is not absolute');
// large input stays fast
{
  const big = Array.from({ length: 200000 }, (_, i) => '/d' + (i % 5000)).join(':');
  const t = Date.now();
  assert.strictEqual(pathDirs({ PATH: big }, 'linux').length, 5000);
  assert.ok(Date.now() - t < 2000, 'large PATH handled quickly');
}
console.log('pathdirs: all checks passed');
