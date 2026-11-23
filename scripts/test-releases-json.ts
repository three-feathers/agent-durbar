/**
 * Spec 118 T008 (FR-026, FR-009): the strict `releases.json` parser, the raw-file URL of the target tag, and `npm run releases:check`
 * (on the tree and on a tagged commit of a temp git repository). `npm run test:releases-json`. No network; files only in a temp folder.
 * Every refusal is its own assert, so a planted mutant names the case it breaks.
 */
import * as assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { decodeUtf8Strict, isBreaking, parseStrictJson, parseReleasesJson, pickTarget, releasesJsonUrl, MAX_RELEASES_JSON_BYTES } from '../src/shared/selfupdate';
import type { Feed, FeedRelease } from '../src/shared/selfupdate';
import { checkReleases, main as checkMain, NOT_REGULAR, REF_REFUSED } from './releases-check';
import type { CheckDeps } from './releases-check';

const ROOT = path.join(__dirname, '..', '..');
type Doc = { schema: unknown; versions: Record<string, unknown>; [k: string]: unknown };
const base = (): Doc => ({
  schema: 1,
  versions: {
    '0.1.28': { breaking: false, notes: 'Self-update groundwork, nothing changes for you.', action: '' },
    '0.2.0': { breaking: true, notes: 'Floors are renamed to rooms.', action: 'Open Settings, Rooms once after the update.' },
  },
});
const parse = (d: unknown): ReturnType<typeof parseReleasesJson> => parseReleasesJson(typeof d === 'string' ? d : JSON.stringify(d));
const entry = (fn: (e: Record<string, unknown>) => void, v = '0.1.28'): Doc => { const d = base(); fn(d.versions[v] as Record<string, unknown>); return d; };
const refuses = (d: unknown, why: string): void => assert.strictEqual(parse(d), undefined, 'refuses ' + why);

// ---- accepted ----
const good = parse(base());
assert.ok(good, 'a valid file is read');
assert.strictEqual(good?.size, 2, 'every version is read');
assert.deepStrictEqual(good?.get('0.2.0'), { breaking: true, notes: 'Floors are renamed to rooms.', action: 'Open Settings, Rooms once after the update.' }, 'an entry keeps its fields');
assert.strictEqual(good?.get('0.1.28')?.breaking, false, 'a non-breaking entry');
assert.strictEqual(parse({ schema: 1, versions: {} })?.size, 0, 'an empty version list is valid (every version is then unknown)');
assert.ok(parse(JSON.stringify(base(), null, 2).replace(/\n/g, '\r\n')), 'pretty-printed with CRLF line ends is still valid JSON');
assert.ok(parse(entry((e) => { e.notes = '\u00E9'.repeat(500); })), '500 code points of notes are allowed');
assert.ok(parse(entry((e) => { e.notes = '\u{1F600}'.repeat(500); })), 'notes count code points, not UTF-16 units');
assert.strictEqual(parse(entry((e) => { e.notes = 'a > b & c'; }))?.get('0.1.28')?.notes, 'a > b & c', 'only < is refused in plain text');
assert.strictEqual(parse({ versions: base().versions, schema: 1 })?.size, 2, 'key order does not matter');

// ---- whole file refused: shape ----
for (const v of [undefined, null, 42, true, {}, [], Buffer.from('{}')]) assert.strictEqual(parseReleasesJson(v), undefined, 'refuses type ' + Object.prototype.toString.call(v));
refuses('', 'an empty file');
refuses('not json', 'text that is not JSON');
refuses(JSON.stringify(base()) + 'x', 'trailing garbage');
refuses('\uFEFF' + JSON.stringify(base()), 'a byte-order mark');
refuses('[]', 'a top-level array');
refuses('null', 'a top-level null');
refuses('"x"', 'a top-level string');
refuses({ versions: base().versions }, 'a missing schema');
refuses({ schema: 1 }, 'missing versions');
refuses({ ...base(), schema: 2 }, 'schema 2');
refuses({ ...base(), schema: '1' }, 'a string schema');
refuses({ ...base(), extra: true }, 'an unknown top-level key');
refuses({ ...base(), __proto__x: 1 }, 'an unknown look-alike top-level key');
refuses('{"schema":1,"versions":{},"__proto__":{}}', 'a __proto__ top-level key');
refuses({ schema: 1, versions: [] }, 'versions as an array');
refuses({ schema: 1, versions: null }, 'versions as null');

// ---- entries ----
refuses(entry((e) => { e.extra = 1; }), 'an unknown entry key');
refuses(entry((e) => { e.breaking = 'false'; e.action = 'Nothing to do.'; }), 'breaking as a string');
refuses(entry((e) => { e.breaking = 'true'; }, '0.2.0'), 'breaking as the string true');
refuses(entry((e) => { e.breaking = 0; }), 'breaking as a number');
refuses(entry((e) => { delete e.breaking; }), 'a missing breaking');
refuses(entry((e) => { delete e.notes; }), 'missing notes');
refuses(entry((e) => { e.notes = ''; }), 'empty notes');
refuses(entry((e) => { e.notes = 'a'.repeat(501); }), 'notes over 500 characters');
refuses(entry((e) => { e.notes = '<img src=x onerror=alert(1)>'; }), 'notes with <');
refuses(entry((e) => { e.notes = 'line\nbreak'; }), 'notes with a control character');
refuses(entry((e) => { e.notes = 'abc\u007F'; }), 'notes with DEL');
refuses(entry((e) => { e.notes = 'abc\u0085'; }), 'notes with a C1 control');
refuses(entry((e) => { e.notes = 'abc\u202Edef'; }), 'notes with a bidi override');
refuses(entry((e) => { e.notes = 'abc\u200Bdef'; }), 'notes with a zero-width space');
refuses(entry((e) => { e.notes = 'abc\u2028def'; }), 'notes with a line separator');
refuses(entry((e) => { e.notes = 5; }), 'notes as a number');
refuses('{"schema":1,"versions":{"0.1.28":{"breaking":false,"notes":"a\\ud800b","action":""}}}', 'notes with a lone high surrogate');
refuses('{"schema":1,"versions":{"0.1.28":{"breaking":false,"notes":"a\\udc00b","action":""}}}', 'notes with a lone low surrogate');
assert.ok(parse('{"schema":1,"versions":{"0.1.28":{"breaking":false,"notes":"a\\ud83d\\ude00b","action":""}}}'), 'fixture: an escaped surrogate pair is fine');
refuses(entry((e) => { delete e.action; }), 'a missing action');
refuses(entry((e) => { e.action = null; }), 'action as null');
refuses(entry((e) => { e.action = '<b>'; }), 'action with <');
refuses(entry((e) => { e.action = 'a'.repeat(501); }), 'action over 500 characters');
refuses(entry((e) => { e.action = ''; }, '0.2.0'), 'breaking: true with an empty action');
refuses({ schema: 1, versions: { '0.1.28': null } }, 'an entry that is null');
refuses({ schema: 1, versions: { '0.1.28': [] } }, 'an entry that is an array');
refuses({ schema: 1, versions: { '0.1.28': 'breaking' } }, 'an entry that is a string');

// ---- version keys ----
const withKey = (k: string): Doc => ({ schema: 1, versions: { [k]: { breaking: false, notes: 'x', action: '' } } });
assert.ok(parse(withKey('999999999.0.0')), 'nine digits per part');
for (const k of ['v0.1.28', '0.1.28-alpha.1', '0.1.28+b', '01.1.28', '0.01.28', '0.1.028', '0.1', '0.1.28.1', ' 0.1.28', '0.1.28 ', '1234567890.0.0', '__proto__', 'constructor', '', '0..1', '0.1.x', '\uFF10.1.28', '0.1.2\u0668']) refuses(withKey(k), 'version key ' + JSON.stringify(k));

// ---- duplicates (a key-counting parse, not JSON.parse alone) ----
const e1 = '{"breaking":false,"notes":"x","action":""}';
refuses(`{"schema":1,"versions":{"0.1.28":${e1},"0.1.28":${e1}}}`, 'a duplicate version key');
refuses(`{"schema":1,"versions":{"0.1.28":${e1},"0.1.2\\u0038":${e1}}}`, 'a duplicate version key spelled with an escape');
refuses(`{"schema":1,"schema":1,"versions":{}}`, 'a duplicate top-level key');
refuses(`{"schema":1,"versions":{"0.1.28":{"breaking":true,"breaking":false,"notes":"x","action":"y"}}}`, 'a duplicate entry key');
assert.ok(parse(`{"schema":1,"versions":{"0.1.28":{"breaking":false,"notes":"a \\"schema\\": b","action":""}}}`), 'a key-like text inside a string is not a key');
refuses(`{"schema":1,"versions":{"0.1.28":{"breaking":false,"bre\\u0061king":true,"notes":"x","action":"y"}}}`, 'a duplicate entry key spelled with a \\u escape');
assert.ok(parse(`{"schema":1,"versions":{"0.1.28":{"breaking":false,"notes":"q\\",\\"breaking","action":""}}}`), 'an escaped quote in a value does not end the string (the scan stays in step)');
assert.ok(parse(`{"schema":1,"versions":{"0.1.28":{"breaking":false,"notes":"C:\\\\","action":""}}}`), 'a backslash right before the closing quote');
assert.ok(parse(`{"schema":1,"versions":{"0.1.28":{"breaking":false,"notes":"x","action":""},"0.1.29":{"breaking":false,"notes":"x","action":""}}}`), 'the same entry keys in two objects are not duplicates');
// the scan itself (parseStrictJson), on keys the schema would refuse anyway: escapes inside keys
assert.strictEqual(parseStrictJson('{"a\\"b":1,"a\\"b":2}'), undefined, 'a duplicate key with an escaped quote inside');
assert.deepStrictEqual(parseStrictJson('{"a\\"b":1,"a":2}'), { 'a"b': 1, a: 2 }, 'a key with an escaped quote differs from its prefix');
assert.strictEqual(parseStrictJson('{"a\\\\":1,"a\\\\":2}'), undefined, 'a duplicate key ending in an escaped backslash');
assert.deepStrictEqual(parseStrictJson('{"a\\\\":1,"a":2}'), { 'a\\': 1, a: 2 }, 'a key ending in a backslash differs from its prefix');
assert.strictEqual(parseStrictJson('{"\\u0061":1,"a":2}'), undefined, 'a key spelled with a \\u escape equals the plain key');
assert.strictEqual((parseStrictJson('[{"k":1},{"k":2}]') as unknown[]).length, 2, 'the same key in two objects of an array is fine');

// ---- caps ----
const many = (n: number): Doc => { const v: Record<string, unknown> = {}; for (let i = 0; i < n; i++) v[`0.0.${i}`] = { breaking: false, notes: 'x', action: '' }; return { schema: 1, versions: v }; };
assert.strictEqual(parse(many(500))?.size, 500, '500 versions are allowed');
refuses(many(501), '501 versions');
const at = (bytes: number, pad = ' '): string => { const t = JSON.stringify(base()); return t.slice(0, -1) + pad.repeat(Math.floor((bytes - Buffer.byteLength(t)) / Buffer.byteLength(pad))) + '}'; };
assert.strictEqual(Buffer.byteLength(at(MAX_RELEASES_JSON_BYTES)), MAX_RELEASES_JSON_BYTES, 'fixture: exactly the cap');
assert.ok(parse(at(MAX_RELEASES_JSON_BYTES)), 'a file of exactly 256 KiB is allowed');
refuses(at(MAX_RELEASES_JSON_BYTES + 1), 'a file over 256 KiB');
const multiByte = (): string => { const v: Record<string, unknown> = {}; for (let i = 0; i < 400; i++) v[`0.0.${i}`] = { breaking: false, notes: '\u0800'.repeat(250), action: '' }; return JSON.stringify({ schema: 1, versions: v }); };
const mb = multiByte();
assert.ok(mb.length < MAX_RELEASES_JSON_BYTES && Buffer.byteLength(mb) > MAX_RELEASES_JSON_BYTES, 'fixture: under the cap in UTF-16 units, over it in UTF-8 bytes');
refuses(mb, 'a file over 256 KiB counted in UTF-8 bytes');
refuses('['.repeat(100000) + ']'.repeat(100000), 'deep nesting');
refuses('x'.repeat(10 * 1024 * 1024), 'a 10 MB text');

// ---- the raw-file URL of the target tag (FR-007, FR-009) ----
assert.strictEqual(releasesJsonUrl('three-feathers/agent-durbar', 'v0.1.29'), 'https://raw.githubusercontent.com/three-feathers/agent-durbar/v0.1.29/releases.json', 'the raw URL of the tag');
assert.strictEqual(releasesJsonUrl('https://github.com/ravi/durbar.git', 'v1.2.3'), 'https://raw.githubusercontent.com/ravi/durbar/v1.2.3/releases.json', 'a fork reads its own tag');
for (const s of ['a/b/../c', 'evil.com/a', 'https://github.com.evil/a/b', '', undefined, { slug: 'a/b' }]) assert.strictEqual(releasesJsonUrl(s, 'v0.1.29'), undefined, 'no URL for slug ' + JSON.stringify(s));
for (const t of ['main', '0.1.29', 'v0.1.29-alpha.1', 'v0.1.29/../main', 'v0.1.29?x=1', 'v0.1.29#x', 'v01.1.29', 'v0.1.29\n', '%2e%2e', 'v0.1.29/releases.json', 'V0.1.29', '', undefined, 29]) assert.strictEqual(releasesJsonUrl('a/b', t), undefined, 'no URL for tag ' + JSON.stringify(t));

// ---- with the breaking decision (FR-009): unknown is never safe ----
const rel = (v: string): FeedRelease => ({ tag: 'v' + v, version: v, publishedAt: '2026-11-20T10:00:00Z', htmlUrl: '', body: '', assets: [] });
const feed: Feed = { releases: [rel('0.1.30'), rel('0.1.29'), rel('0.1.28')], full: false, dropped: [], unplaced: false };
const pick = pickTarget('0.1.28', feed);
const marks = (versions: Record<string, unknown>): ReturnType<typeof parseReleasesJson> => parse({ schema: 1, versions });
const ok = { breaking: false, notes: 'x', action: '' };
assert.strictEqual(isBreaking('0.1.28', pick, marks({ '0.1.29': ok, '0.1.30': ok })), 'no', 'every version in the range marked safe: no');
assert.strictEqual(isBreaking('0.1.28', pick, marks({ '0.1.29': { breaking: true, notes: 'x', action: 'y' }, '0.1.30': ok })), 'breaking', 'a breaking: true entry in the range counts');
assert.strictEqual(isBreaking('0.1.28', pick, parse('{"schema":1,"versions":{"0.1.29":' + e1 + ',"0.1.29":' + e1 + ',"0.1.30":' + e1 + '}}')), 'unknown', 'an invalid file is unknown, not safe');
assert.strictEqual(isBreaking('0.1.28', pick, marks({ '0.1.30': ok })), 'unknown', 'a version without an entry is unknown');

// ---- releases:check ----
const tree = fs.readFileSync(path.join(ROOT, 'releases.json'), 'utf8');
assert.strictEqual(checkReleases(tree), undefined, 'the repository root releases.json is valid');
const pkgVersion = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
// spec 008 FR-119 delta 2026-11-23: the version PR adds the new version's entry, so the tree always has one for package.json's version
// (a pre-release test build, `-test.M`, is exempt: it is no release)
assert.ok(parseReleasesJson(tree)?.has(pkgVersion) || /-/.test(pkgVersion), 'releases.json has an entry for the version in package.json (the version PR adds it)');

// ---- decoding: strict UTF-8, a byte-order mark kept so the parsers refuse it ----
const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(base()))]);
assert.strictEqual(decodeUtf8Strict(bom)?.charCodeAt(0), 0xfeff, 'a byte-order mark stays in the text');
assert.strictEqual(parseReleasesJson(decodeUtf8Strict(bom)), undefined, 'so a file with a byte-order mark is refused');
assert.strictEqual(decodeUtf8Strict(Buffer.from([0x61, 0xff, 0x62])), undefined, 'invalid UTF-8 is refused, not replaced');
assert.strictEqual(decodeUtf8Strict(Buffer.from([0x61, 0xed, 0xa0, 0x80])), undefined, 'an encoded surrogate is refused');
assert.strictEqual(decodeUtf8Strict(Buffer.from('a\u00e9b')), 'a\u00e9b', 'valid UTF-8 decodes');

// ---- releases:check in process, with an injected git and file system ----
const fakeDeps = (files: Record<string, Buffer | 'dir' | 'link'>, blobs: Record<string, Buffer> = {}): CheckDeps & { gitCalls: string[][] } => {
  const gitCalls: string[][] = [];
  const st = (k: 'file' | 'dir' | 'link', size: number): fs.Stats => ({ isFile: () => k === 'file', isDirectory: () => k === 'dir', isSymbolicLink: () => k === 'link', size } as unknown as fs.Stats);
  return {
    gitCalls,
    cwd: path.join('w'),
    git: (args) => { gitCalls.push(args); const b = blobs[args[2]]; if (!b) throw new Error('no blob'); return b; },
    lstat: (f) => { const v = files[f]; if (v === undefined) throw new Error('ENOENT'); return typeof v === 'string' ? st(v, 0) : st('file', v.length); },
    read: (f) => { const v = files[f]; if (!Buffer.isBuffer(v)) throw new Error('not a file'); return v; },
  };
};
const F = path.join('w', 'releases.json');
const valid = Buffer.from(JSON.stringify(base()));
for (const ref of ['--output=x', '-p', 'v0.1.30:package.json', 'v0.1.30..HEAD', 'a..b', 'HEAD@{1}', 'HEAD^', 'HEAD~1', 'a b', '', '.hidden', 'v\u00e9', 'x'.repeat(201)]) {
  const d = fakeDeps({}, { 'v0.1.30:releases.json': valid });
  assert.strictEqual(checkMain(['--version', '0.2.0', '--ref', ref], d), REF_REFUSED, 'the validator refuses ref ' + JSON.stringify(ref.slice(0, 30)));
  assert.strictEqual(d.gitCalls.length, 0, 'a refused ref never reaches git: ' + JSON.stringify(ref.slice(0, 30)));
}
{
  const d = fakeDeps({}, { 'v0.1.30:releases.json': valid });
  assert.strictEqual(checkMain(['--version', '0.2.0', '--ref', 'v0.1.30'], d), undefined, 'a good ref is read');
  assert.deepStrictEqual(d.gitCalls, [['cat-file', 'blob', 'v0.1.30:releases.json']], 'git gets exactly one argument list');
  const b = fakeDeps({}, { 'v0.1.30:releases.json': bom });
  assert.match(checkMain(['--version', '0.2.0', '--ref', 'v0.1.30'], b) ?? '', /not valid/, 'a byte-order mark at the tag is refused');
}
assert.strictEqual(checkMain([], fakeDeps({ [F]: valid })), undefined, 'the tree file is read');
assert.match(checkMain([], fakeDeps({ [F]: bom })) ?? '', /not valid/, 'a byte-order mark in the tree file is refused');
assert.strictEqual(checkMain([], fakeDeps({ [F]: 'link' })), NOT_REGULAR, 'a symlink at releases.json is refused, not followed');
assert.strictEqual(checkMain([], fakeDeps({ [F]: 'dir' })), NOT_REGULAR, 'a folder at releases.json is refused');
assert.strictEqual(checkMain([], fakeDeps({ [F]: Buffer.alloc(MAX_RELEASES_JSON_BYTES + 1, 0x20) })), NOT_REGULAR, 'a file over the cap is refused before reading');
assert.match(checkMain(['--version', '0.2.0', '--version', '0.1.28'], fakeDeps({ [F]: valid })) ?? '', /--version is given twice/, 'a repeated --version is refused');
assert.match(checkMain(['--ref', 'v1', '--ref', 'v2', '--version', '0.2.0'], fakeDeps({})) ?? '', /--ref is given twice/, 'a repeated --ref is refused');
assert.match(checkMain(['--version'], fakeDeps({})) ?? '', /wants a value/, 'an option without a value is refused');
assert.match(checkMain([], fakeDeps({ [F]: Buffer.from([0x7b, 0xff, 0x7d]) })) ?? '', /not UTF-8/, 'invalid UTF-8 is refused at the decode');
assert.strictEqual(checkReleases(JSON.stringify(base()), '0.2.0'), undefined, 'the released version has an entry');
assert.match(checkReleases(JSON.stringify(base()), '0.1.29') ?? '', /no entry for 0\.1\.29/, 'the released version has no entry: refused');
assert.match(checkReleases('{', '0.1.28') ?? '', /not valid/, 'an invalid file: refused');
assert.match(checkReleases(JSON.stringify(base()), 'v0.1.28') ?? '', /version/, 'a version with v: refused');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-releases-'));
try {
  const genv = { ...process.env, GIT_CONFIG_GLOBAL: path.join(tmp, 'none'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const git = (...args: string[]): string => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=', '-c', 'core.autocrlf=false', ...args], { cwd: repo, env: genv, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'releases.json'), JSON.stringify({ schema: 1, versions: { '0.1.28': ok } }));
  git('add', 'releases.json');
  git('commit', '-q', '-m', 'one');
  git('tag', 'v0.1.29');
  fs.writeFileSync(path.join(repo, 'releases.json'), JSON.stringify({ schema: 1, versions: { '0.1.28': ok, '0.1.29': ok } })); // the tree has it, the tag not
  const cli = path.join(__dirname, 'releases-check.js');
  const run = (...args: string[]): { status: number | null; err: string } => { const r = spawnSync(process.execPath, [cli, ...args], { cwd: repo, env: genv, encoding: 'utf8', windowsHide: true }); return { status: r.status, err: r.stderr }; };
  assert.strictEqual(run().status, 0, 'no arguments: the tree file is valid');
  assert.strictEqual(run('--version', '0.1.29').status, 0, 'the tree file has the entry');
  const atTag = run('--version', '0.1.29', '--ref', 'v0.1.29');
  assert.strictEqual(atTag.status, 1, 'the tag lacks the entry: the check fails (read from the tag, not the tree)');
  assert.match(atTag.err, /no entry for 0\.1\.29/, 'it says which version has no entry');
  git('commit', '-q', '-am', 'two');
  git('tag', 'v0.1.30');
  assert.strictEqual(run('--version', '0.1.29', '--ref', 'v0.1.30').status, 0, 'a tagged commit with the entry passes');
  assert.strictEqual(run('--ref', 'v0.1.30').status, 1, '--ref without --version is refused');
  for (const ref of ['--output=x', '-p', 'v0.1.30:package.json', 'v0.1.30..HEAD', 'HEAD@{1}', 'a b', '']) {
    const r = run('--version', '0.1.29', '--ref', ref);
    assert.ok(r.status === 1 && r.err.includes(REF_REFUSED), 'the CLI refuses ref ' + JSON.stringify(ref) + ' with the validator\'s message');
  }
  assert.strictEqual(fs.existsSync(path.join(repo, 'x')), false, 'no option reached git');
  assert.strictEqual(run('--version', '0.1.29', '--ref', 'v9.9.9').status, 1, 'a missing ref fails');
  assert.strictEqual(run('--bogus').status, 1, 'an unknown argument fails');
  fs.writeFileSync(path.join(repo, 'releases.json'), '{"schema":1,"versions":{}} x');
  assert.strictEqual(run().status, 1, 'an invalid tree file fails');
  fs.writeFileSync(path.join(repo, 'releases.json'), Buffer.concat([Buffer.from('{"schema":1,"versions":{"0.1.28":{"breaking":false,"notes":"a'), Buffer.from([0xff]), Buffer.from('","action":""}}}')]));
  assert.strictEqual(run().status, 1, 'a file that is not UTF-8 fails');
  fs.writeFileSync(path.join(repo, 'releases.json'), bom);
  assert.strictEqual(run().status, 1, 'a tree file with a byte-order mark fails');
  fs.rmSync(path.join(repo, 'releases.json'));
  assert.strictEqual(run().status, 1, 'a missing file fails');
  fs.writeFileSync(path.join(tmp, 'elsewhere.json'), valid);
  let linked = false;
  try { fs.symlinkSync(path.join(tmp, 'elsewhere.json'), path.join(repo, 'releases.json')); linked = true; } catch { /* Windows without the symlink right: the in-process case above covers it */ }
  if (linked) { const r = run(); assert.ok(r.status === 1 && r.err.includes(NOT_REGULAR), 'a real symlink at releases.json is refused'); }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('releases-json: ok');
