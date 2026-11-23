/**
 * Spec 118 T002 (FR-001, FR-003): the one strict repository parser and the case-insensitive compare; T007: the build-time resolver
 * (scripts/updatesource.js), the baked file and its run-time reader. `npm run test:selfupdate-repo`.
 * No network; files only in a temp folder. Every refusal is its own assert, so a planted mutant names the case it breaks.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadUpdateSource } from '../src/main/updatesource';
import { feedUrl, parseRepoSlug, parseUpdateSourceFile, sameRepo } from '../src/shared/selfupdate';

const ok: [string, string][] = [
  ['three-feathers/agent-durbar', 'three-feathers/agent-durbar'],
  ['github:ravi/durbar', 'ravi/durbar'],
  ['https://github.com/ravi/durbar', 'ravi/durbar'],
  ['https://github.com/ravi/durbar.git', 'ravi/durbar'],
  ['https://github.com/ravi/durbar/', 'ravi/durbar'],
  ['https://github.com/ravi/durbar.git/', 'ravi/durbar'],
  ['Ravi/Dur.bar_1', 'Ravi/Dur.bar_1'],
  ['a/' + 'n'.repeat(100), 'a/' + 'n'.repeat(100)],
  ['o'.repeat(39) + '/x', 'o'.repeat(39) + '/x'],
];
for (const [input, want] of ok) assert.strictEqual(parseRepoSlug(input), want, 'accepts ' + JSON.stringify(input));

// Each one fails closed: look-alike hosts, other hosts and schemes, userinfo, ports, extra path, query, fragment, encodings, unicode.
const bad: string[] = [
  'https://github.com.evil/a/b', 'https://github.com.evil.com/a/b', 'https://evilgithub.com/a/b', 'https://www.github.com/a/b',
  'https://api.github.com/repos/a/b', 'https://GITHUB.com/a/b', 'HTTPS://github.com/a/b', 'http://github.com/a/b',
  'https://github.com@evil.com/a/b', 'https://u:p@github.com/a/b', 'https://u@github.com/a/b', 'https://github.com:443/a/b',
  'https://github.com/a/b/c', 'https://github.com/a/b/releases', 'https://github.com/a/b?x=1', 'https://github.com/a/b#x',
  'https://github.com//a/b', 'https://github.com/a//b', 'https://github.com/a/b//', 'https://github.com/a/.git',
  'git@github.com:a/b', 'ssh://git@github.com/a/b', 'git://github.com/a/b', 'file:///a/b', 'github.com/a/b', 'gitlab:a/b',
  'a/b/c', 'a', '/a/b', 'a/b/', 'a/', '/b', '', ' ', 'a/.', 'a/..', '-a/b', 'a_b/c', 'a.b/c', 'o'.repeat(40) + '/x', 'a/' + 'n'.repeat(101),
  'a/b c', 'a/b\n', ' a/b', 'a/b ', 'a\\b', 'a/b%2fc', '%61/b', 'a/b;c', 'a/b@c', '\u0430/b', 'a/b\u0435', '\uFF41/b', 'a/b\u200B', 'a/b\u202E',
  'https://github.com/a/b\u0000', 'https://g\u0456thub.com/a/b', 'github:a/b/c', 'github:/a/b', 'a/b'.padEnd(201, ' '),
];
for (const input of bad) assert.strictEqual(parseRepoSlug(input), undefined, 'refuses ' + JSON.stringify(input));
for (const v of [undefined, null, 42, true, ['a/b'], { slug: 'a/b' }, () => 'a/b']) assert.strictEqual(parseRepoSlug(v), undefined, 'refuses type ' + typeof v);
assert.strictEqual(parseRepoSlug('a/' + 'b'.repeat(5000)), undefined, 'refuses huge input');

// FR-003: case-insensitive, both sides parsed, never "same" when one side is not a slug.
assert.strictEqual(sameRepo('Three-Feathers/Agent-Durbar', 'https://github.com/three-feathers/agent-durbar.git'), true, 'case-insensitive compare');
assert.strictEqual(sameRepo('ravi/durbar', 'three-feathers/agent-durbar'), false, 'other repository differs');
assert.strictEqual(sameRepo('ravi/durbar', 'ravi/durbar2'), false, 'prefix is not the same');
assert.strictEqual(sameRepo('bad slug', 'bad slug'), false, 'two invalid sides are not the same');
assert.strictEqual(sameRepo(undefined, undefined), false, 'two missing sides are not the same');

assert.strictEqual(feedUrl('Ravi/durbar'), 'https://api.github.com/repos/Ravi/durbar/releases?per_page=30', 'feed URL from a slug');
assert.strictEqual(feedUrl('ravi/durbar/../x'), undefined, 'no feed URL from a bad slug');

// ---- T007: the build-time resolver (scripts/updatesource.js) with this very parser ----
type Src = { slug: string; origin: string };
const us = require(path.join(__dirname, '..', '..', 'scripts', 'updatesource.js')) as {
  resolveUpdateSource(env: Record<string, string | undefined>, pkg: unknown, parse: typeof parseRepoSlug): Src;
  writeUpdateSource(file: string, env: Record<string, string | undefined>, pkg: unknown, parse: typeof parseRepoSlug): Src;
  summaryText(baked: Src | undefined, pkg: unknown, parse: typeof parseRepoSlug, same: typeof sameRepo): string;
};
const PKG = { repository: { type: 'git', url: 'git+https://github.com/three-feathers/agent-durbar.git' } };
const resolve = (env: Record<string, string | undefined>, pkg: unknown = PKG): Src => us.resolveUpdateSource(env, pkg, parseRepoSlug);
const fails = (env: Record<string, string | undefined>, pkg: unknown, why: string): void => assert.throws(() => resolve(env, pkg), /not a GitHub owner\/name/, 'the build stops: ' + why);
assert.deepStrictEqual(resolve({ DURBAR_UPDATE_REPO: 'ravi/durbar', GITHUB_REPOSITORY: 'other/repo' }), { slug: 'ravi/durbar', origin: 'env' }, 'DURBAR_UPDATE_REPO comes first');
assert.deepStrictEqual(resolve({ GITHUB_REPOSITORY: 'ravi/durbar' }), { slug: 'ravi/durbar', origin: 'ci' }, 'a fork build names the fork (SC-003)');
assert.deepStrictEqual(resolve({}), { slug: 'three-feathers/agent-durbar', origin: 'local' }, 'package.json last, git+ dropped');
assert.deepStrictEqual(resolve({ DURBAR_UPDATE_REPO: '', GITHUB_REPOSITORY: 'ravi/durbar' }), { slug: 'ravi/durbar', origin: 'ci' }, 'an empty value counts as unset');
assert.deepStrictEqual(resolve({ GITHUB_REPOSITORY: '' }), { slug: 'three-feathers/agent-durbar', origin: 'local' }, 'an empty GITHUB_REPOSITORY counts as unset');
assert.deepStrictEqual(resolve({}, { repository: 'ravi/durbar' }), { slug: 'ravi/durbar', origin: 'local' }, 'a string repository');
assert.deepStrictEqual(resolve({}, { repository: { url: 'https://github.com/ravi/durbar' } }), { slug: 'ravi/durbar', origin: 'local' }, 'a plain https url');
const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
assert.deepStrictEqual(resolve({}, real), { slug: 'three-feathers/agent-durbar', origin: 'local' }, 'this repository\'s package.json resolves');
for (const v of ['evil.com/x', 'a/b/c', 'https://github.com.evil/a/b', '\u0430/b', 'a/b?x', 'https://u:p@github.com/a/b', 'https://github.com:8443/a/b', ' a/b', 'a/..', 'git+https://github.com/a/b']) {
  fails({ DURBAR_UPDATE_REPO: v, GITHUB_REPOSITORY: 'ravi/durbar' }, PKG, 'DURBAR_UPDATE_REPO ' + JSON.stringify(v) + ' (no fallback)');
  fails({ GITHUB_REPOSITORY: v }, PKG, 'GITHUB_REPOSITORY ' + JSON.stringify(v) + ' (no fallback)');
}
for (const pkg of [{}, { repository: null }, { repository: ['a/b'] }, { repository: { url: 42 } }, { repository: { url: 'git+ssh://git@github.com/a/b.git' } }, { repository: { url: 'git+git+https://github.com/a/b' } }, { repository: { url: 'git+https://github.com.evil/a/b' } }, { repository: { url: 'git+https://github.com/a/b/c' } }, null, 'a/b']) fails({}, pkg, 'package.json ' + JSON.stringify(pkg));

// ---- the baked file and the run-time reader: env is ignored at run time ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-updsrc-'));
const saved = { a: process.env.DURBAR_UPDATE_REPO, b: process.env.GITHUB_REPOSITORY };
try {
  const dir = path.join(tmp, 'dist', 'main');
  const wrote = us.writeUpdateSource(path.join(dir, 'updatesource.json'), { GITHUB_REPOSITORY: 'Ravi/Durbar' }, PKG, parseRepoSlug);
  assert.deepStrictEqual(wrote, { slug: 'Ravi/Durbar', origin: 'ci' }, 'what copy-assets writes');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'updatesource.json'), 'utf8'), '{"slug":"Ravi/Durbar","origin":"ci"}\n', 'the file is exactly slug and origin');
  const reads: string[] = [];
  const spy = (f: string): Buffer => { reads.push(f); return fs.readFileSync(f); };
  assert.deepStrictEqual(loadUpdateSource(dir, spy), { slug: 'Ravi/Durbar', origin: 'ci' }, 'the run time reads the baked file');
  process.env.DURBAR_UPDATE_REPO = 'evil/one';
  process.env.GITHUB_REPOSITORY = 'evil/two';
  assert.deepStrictEqual(loadUpdateSource(dir, spy), { slug: 'Ravi/Durbar', origin: 'ci' }, 'run-time DURBAR_UPDATE_REPO and GITHUB_REPOSITORY change nothing');
  assert.deepStrictEqual(reads, [path.join(dir, 'updatesource.json'), path.join(dir, 'updatesource.json')], 'only the baked file is read, never package.json');
  assert.strictEqual(loadUpdateSource(path.join(tmp, 'nowhere')), undefined, 'no file: no source');
  fs.writeFileSync(path.join(dir, 'updatesource.json'), Buffer.from([0x7b, 0xff, 0x7d]));
  assert.strictEqual(loadUpdateSource(dir), undefined, 'not UTF-8: no source');
  fs.writeFileSync(path.join(dir, 'updatesource.json'), '{"slug":"a/b","origin":"ci"}' + ' '.repeat(2000));
  assert.strictEqual(loadUpdateSource(dir), undefined, 'over 1 KiB: no source');
} finally {
  if (saved.a === undefined) delete process.env.DURBAR_UPDATE_REPO; else process.env.DURBAR_UPDATE_REPO = saved.a;
  if (saved.b === undefined) delete process.env.GITHUB_REPOSITORY; else process.env.GITHUB_REPOSITORY = saved.b;
  fs.rmSync(tmp, { recursive: true, force: true });
}
const runtime = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'updatesource.ts'), 'utf8').replace(/\r\n/g, '\n');
assert.ok(!/process\.env|package\.json|GITHUB_REPOSITORY|DURBAR_UPDATE_REPO|three-feathers/.test(runtime.replace(/^\s*(\/\*\*|\*).*$/gm, '')), 'the run-time reader names no env, package.json or repository in code');
assert.match(fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'copy-assets.js'), 'utf8'), /require\('\.\/updatesource'\)\.writeUpdateSource\(path\.join\(root, 'dist', 'main', 'updatesource\.json'\), process\.env, /, 'copy-assets.js bakes dist/main/updatesource.json');

const okFile = '{"slug":"ravi/durbar","origin":"local"}';
assert.deepStrictEqual(parseUpdateSourceFile(okFile), { slug: 'ravi/durbar', origin: 'local' }, 'a valid baked file');
for (const [t, why] of [
  ['{"slug":"ravi/durbar","origin":"ci","keys":[]}', 'an extra key'], ['{"slug":"ravi/durbar"}', 'no origin'], ['{"origin":"ci"}', 'no slug'],
  ['{"slug":"ravi/durbar","origin":"official"}', 'an unknown origin'], ['{"slug":"ravi/durbar","origin":"CI"}', 'an origin in other case'],
  ['{"slug":"https://github.com/ravi/durbar","origin":"ci"}', 'a slug not in parsed form'], ['{"slug":"ravi/durbar/x","origin":"ci"}', 'a bad slug'],
  ['{"slug":"evil/x","slug":"ravi/durbar","origin":"ci"}', 'a duplicate key'], ['\uFEFF' + okFile, 'a byte-order mark'], ['[' + okFile + ']', 'an array'],
  ['{"slug":42,"origin":"ci"}', 'a number slug'], ['', 'empty'], ['{"slug":"ravi/durbar","origin":"ci"}' + ' '.repeat(1100), 'over 1 KiB'],
] as [string, string][]) assert.strictEqual(parseUpdateSourceFile(t), undefined, 'baked file refused: ' + why);
for (const v of [undefined, null, 1, {}, Buffer.from(okFile)]) assert.strictEqual(parseUpdateSourceFile(v), undefined, 'baked file of type ' + typeof v + ' refused');

// ---- the release job summary (T028 runs it) ----
assert.strictEqual(us.summaryText({ slug: 'three-feathers/agent-durbar', origin: 'ci' }, PKG, parseRepoSlug, sameRepo), '- **Update source**: `three-feathers/agent-durbar` (origin `ci`)\n', 'the official build: no warning');
assert.match(us.summaryText({ slug: 'ravi/durbar', origin: 'ci' }, PKG, parseRepoSlug, sameRepo), /\*\*Warning\*\*: the update source differs from package\.json `repository` \(`three-feathers\/agent-durbar`\)/, 'a source other than package.json: a warning');
assert.match(us.summaryText(undefined, PKG, parseRepoSlug, sameRepo), /none .*never checks/, 'no baked file: said so');
console.log('selfupdate-repo: ok');
