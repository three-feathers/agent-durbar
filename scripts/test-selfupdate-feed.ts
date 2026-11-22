/**
 * Spec 118 T003 (FR-007, FR-008, FR-009): the release-list schema, the target and the breaking decision. `npm run test:selfupdate-feed`.
 * Pure: the fixture is a hand-written list in GitHub's documented shape; every hostile variant is made from it here.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { feedResponseOk, isBreaking, pickTarget, validateFeed, MAX_BODY_BYTES, MAX_FEED_BYTES } from '../src/shared/selfupdate';
import type { Feed, ReleaseMarks } from '../src/shared/selfupdate';

const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'selfupdate', 'releases.fixture'), 'utf8').split('\n');
assert.ok(raw[0].startsWith('# source: '), 'the fixture names its source');
const base = (): Record<string, any>[] => JSON.parse(raw.slice(1).join('\n'));
const S = 'three-feathers/agent-durbar';
const feed = (list: unknown, slug = S): Feed | undefined => validateFeed(list, slug);
const tags = (f: Feed | undefined): string[] | undefined => f?.releases.map((r) => r.tag);
/** The fixture with entry `i` (v0.1.29 = 2) changed by `fn`. */
const edit = (fn: (e: Record<string, any>) => void, i = 2): Record<string, any>[] => { const l = base(); fn(l[i]); return l; };

// ---- the response (FR-007) ----
assert.strictEqual(feedResponseOk({ status: 200, contentType: 'application/json; charset=utf-8', bytes: 10 }), true, 'a 200 JSON answer is read');
assert.strictEqual(feedResponseOk({ status: 301, contentType: 'application/json', bytes: 10 }), false, 'a renamed repository (301) is refused');
assert.strictEqual(feedResponseOk({ status: 302, contentType: 'application/json', bytes: 10 }), false, 'a 302 is refused');
assert.strictEqual(feedResponseOk({ status: 200, contentType: 'text/html', bytes: 10 }), false, 'HTML is refused');
assert.strictEqual(feedResponseOk({ status: 200, contentType: 'application/json', bytes: MAX_FEED_BYTES + 1 }), false, 'a body over 2 MiB is refused');
assert.strictEqual(feedResponseOk({ status: '200', contentType: 'application/json', bytes: 10 }), false, 'a string status is refused');
assert.strictEqual(feedResponseOk({ status: 200, contentType: 'application/json', bytes: -1 }), false, 'a negative byte count is refused');

// ---- the schema (FR-008) ----
const good = feed(base());
assert.deepStrictEqual(tags(good), ['v0.1.29', 'v0.1.28', 'v0.1.27'], 'drafts and pre-releases are dropped, newest first');
assert.strictEqual(good?.releases[0].body, '## Highlights\r\n- **Floors** can be renamed.\r\n', 'the body is kept as data');
assert.strictEqual(good?.releases[2].body, '', 'a null body is empty');
assert.strictEqual(good?.releases[0].assets.length, 7, 'every asset is read');
assert.strictEqual(tags(feed(base(), 'Three-Feathers/Agent-Durbar'))?.length, 3, 'the slug compares case-insensitively');
assert.strictEqual(tags(feed(base(), 'ravi/durbar'))?.length, 0, 'a fork reads nothing of upstream (SC-003)');

// Whole feed refused
assert.strictEqual(feed('[]'), undefined, 'a string body is refused');
assert.strictEqual(feed({ releases: base() }), undefined, 'a non-array body is refused');
assert.strictEqual(feed(base(), 'not a slug'), undefined, 'a bad slug is refused');
const tagged = (tag: string): Record<string, any> => ({ ...base()[3], tag_name: tag, html_url: `https://github.com/${S}/releases/tag/${tag}`, assets: [] });
assert.strictEqual(feed(Array.from({ length: 30 }, (_, i) => tagged('v1.0.' + i)))?.releases.length, 30, '30 entries are read');
assert.strictEqual(feed(Array.from({ length: 31 }, (_, i) => tagged('v1.0.' + i))), undefined, 'more than 30 entries are refused');
assert.strictEqual(feed(Array.from({ length: 500 }, (_, i) => tagged('v1.0.' + i))), undefined, '500 entries are refused');
assert.strictEqual(feed([...base(), base()[3]]), undefined, 'a duplicate tag refuses the whole feed');
assert.strictEqual(feed(edit((e) => { e.tag_name = 'v00.1.28'; e.html_url = e.html_url.replace('v0.1.29', 'v00.1.28'); })), undefined, 'the same version twice refuses the feed');

// One entry dropped, the rest kept
const drops: [string, (e: Record<string, any>) => void][] = [
  ['a number body', (e) => { e.body = 42; }],
  ['a body over 1 MiB', (e) => { e.body = 'x'.repeat(10 * 1024 * 1024); }],
  ['a bad published_at', (e) => { e.published_at = 'yesterday'; }],
  ['a year-only published_at', (e) => { e.published_at = '2026'; }],
  ['an ISO-shaped but impossible published_at', (e) => { e.published_at = '2026-13-45T99:99:99Z'; }],
  ['a number-like published_at', (e) => { e.published_at = '1'; }],
  ['an RFC 1123 published_at', (e) => { e.published_at = 'Fri, 20 Nov 2026 10:05:00 GMT'; }],
  ['a body over 1 MiB of UTF-8 but under 1 Mi characters', (e) => { e.body = String.fromCodePoint(0x20ac).repeat(MAX_BODY_BYTES / 2); }],
  ['a string draft flag', (e) => { e.draft = 'false'; }],
  ['a published draft', (e) => { e.draft = true; }],
  ['a pre-release with a plain tag', (e) => { e.prerelease = true; }],
  ['a tag without v', (e) => { e.tag_name = '0.1.29'; }],
  ['a loose tag', (e) => { e.tag_name = 'v0.1.29 '; }],
  ['html_url of another repository', (e) => { e.html_url = 'https://github.com/ravi/durbar/releases/tag/v0.1.29'; }],
  ['html_url of another tag', (e) => { e.html_url = e.html_url.replace('v0.1.29', 'v0.1.28'); }],
  ['html_url on a look-alike host', (e) => { e.html_url = e.html_url.replace('github.com', 'github.com.evil'); }],
  ['html_url over http', (e) => { e.html_url = e.html_url.replace('https:', 'http:'); }],
  ['html_url with a port', (e) => { e.html_url = e.html_url.replace('github.com', 'github.com:443'); }],
  ['html_url with userinfo', (e) => { e.html_url = e.html_url.replace('github.com', 'u@github.com'); }],
  ['html_url with an IDN host', (e) => { e.html_url = e.html_url.replace('github.com', 'g\u0456thub.com'); }],
  ['html_url with a dot segment', (e) => { e.html_url = e.html_url.replace('/releases/', '/x/../releases/'); }],
  ['html_url with an encoded slug', (e) => { e.html_url = e.html_url.replace('three-feathers', 'three%2Dfeathers'); }],
  ['html_url of a same-length repository', (e) => { e.html_url = e.html_url.replace('agent-durbar', 'agent-durbaX'); }],
  ['html_url with an empty query', (e) => { e.html_url += '?'; }],
  ['html_url with an empty fragment', (e) => { e.html_url += '#'; }],
  ['html_url with the tag in another case', (e) => { e.html_url = e.html_url.replace('/tag/v', '/tag/V'); }],
  ['html_url with the path in another case', (e) => { e.html_url = e.html_url.replace('/releases/', '/Releases/'); }],
  ['an asset URL with an empty query', (e) => { e.assets[0].browser_download_url += '?'; }],
  ['an asset URL with the name in another case', (e) => { e.assets[0].browser_download_url = e.assets[0].browser_download_url.replace('Setup', 'setup'); }],
  ['assets not an array', (e) => { e.assets = {}; }],
  ['over 40 assets', (e) => { e.assets = Array.from({ length: 41 }, () => e.assets[0]); }],
  ['a string asset size', (e) => { e.assets[0].size = '1000'; }],
  ['a zero asset size', (e) => { e.assets[0].size = 0; }],
  ['an asset over 600 MiB', (e) => { e.assets[0].size = 600 * 1024 * 1024 + 1; }],
  ['an asset name with ..', (e) => { e.assets[0].name = 'a..exe'; e.assets[0].browser_download_url = e.assets[0].browser_download_url.replace(/[^/]+$/, 'a..exe'); }],
  ['an asset name with a slash', (e) => { e.assets[0].name = 'x/y.exe'; }],
  ['an asset URL of another tag', (e) => { e.assets[0].browser_download_url = e.assets[0].browser_download_url.replace('download/v0.1.29', 'download/v0.1.28'); }],
  ['an asset URL with a query', (e) => { e.assets[0].browser_download_url += '?x=1'; }],
  ['an asset URL with a fragment', (e) => { e.assets[0].browser_download_url += '#x'; }],
  ['an asset URL with a port', (e) => { e.assets[0].browser_download_url = e.assets[0].browser_download_url.replace('github.com', 'github.com:8443'); }],
  ['an asset URL with user@', (e) => { e.assets[0].browser_download_url = e.assets[0].browser_download_url.replace('https://', 'https://user@'); }],
  ['an asset URL naming another file', (e) => { e.assets[0].browser_download_url = e.assets[0].browser_download_url.replace('Setup', 'Other'); }],
  ['an asset URL on the asset host', (e) => { e.assets[0].browser_download_url = 'https://objects.githubusercontent.com/x'; }],
];
for (const [name, fn] of drops) assert.deepStrictEqual(tags(feed(edit(fn))), ['v0.1.28', 'v0.1.27'], 'drops ' + name);
assert.deepStrictEqual(tags(feed(edit((e) => { e.prerelease = false; }, 1))), ['v0.1.29', 'v0.1.28', 'v0.1.27'], 'a -alpha tag stays out even when not marked pre-release');
assert.deepStrictEqual(tags(feed(edit((e) => { e.draft = false; e.published_at = '2026-11-21T00:00:00Z'; }, 0))), ['v0.1.31', 'v0.1.29', 'v0.1.28', 'v0.1.27'], 'a published draft counts');
const junk = feed([null, 1, 'x', [], ...base()]);
assert.deepStrictEqual(tags(junk), ['v0.1.29', 'v0.1.28', 'v0.1.27'], 'non-object entries are not releases');
assert.strictEqual(junk?.unplaced, true, 'a non-object entry is reported as unplaced');
assert.strictEqual(good?.full, false, 'a short page is not full');
assert.strictEqual(good?.unplaced, false, 'the clean fixture has nothing unplaced (a draft and a pre-release are not malformed)');
assert.deepStrictEqual(good?.dropped, [], 'the clean fixture drops nothing');
assert.deepStrictEqual(feed(edit((e) => { e.body = 42; }))?.dropped, ['0.1.29'], 'a malformed stable entry is reported by version');
assert.strictEqual(feed(edit((e) => { e.tag_name = 'release-29'; }))?.unplaced, true, 'an unreadable tag is unplaced');
assert.strictEqual(feed(Array.from({ length: 30 }, (_, i) => tagged('v1.0.' + i)))?.full, true, 'a page of 30 is full');

// ---- target (FR-009, User Story 1) ----
const f = good as Feed;
const p27 = pickTarget('0.1.27', f);
assert.strictEqual(p27.target?.tag, 'v0.1.29', 'the newest stable release is the target');
assert.deepStrictEqual(p27.between.map((r) => r.tag), ['v0.1.29', 'v0.1.28'], 'two releases come with it');
assert.strictEqual(p27.gap, false, 'the running version is on the page: no gap');
assert.strictEqual(pickTarget('0.1.29', f).target, undefined, 'up to date');
assert.strictEqual(pickTarget('0.2.0', f).installedNewer, true, 'a newer build is up to date and says so');
assert.strictEqual(pickTarget('0.1.29-dev.1', f).target?.tag, 'v0.1.29', 'a pre-release of the target line updates to it');
assert.strictEqual(pickTarget('not a version', f).target, undefined, 'an unparseable running version offers nothing');
assert.strictEqual(pickTarget('0.1.20', f).gap, true, 'running older than the page is a gap');
assert.strictEqual(pickTarget('0.1.27', { ...f, full: true }).gap, false, 'a full page that lists the running version has no gap');
assert.strictEqual(pickTarget('0.1.27', { ...f, releases: f.releases.slice(0, 2), full: true }).gap, true, 'a full page without the running version is a gap');
const holed = [f.releases[0], f.releases[1], { ...f.releases[2], tag: 'v0.1.20', version: '0.1.20' }];
const hf = (full: boolean): Feed => ({ ...f, releases: holed, full });
assert.strictEqual(pickTarget('0.1.27', hf(true)).gap, true, 'a full page without the running version is a gap, even above its oldest');
assert.strictEqual(pickTarget('0.1.27', hf(false)).gap, false, 'a short page above its oldest entry has no gap');

// ---- breaking (FR-009, User Story 2) ----
const marks = (o: Record<string, boolean>): ReleaseMarks => new Map(Object.entries(o).map(([k, v]) => [k, { breaking: v }]));
assert.strictEqual(isBreaking('0.1.27', p27, marks({ '0.1.28': false, '0.1.29': false })), 'no', 'every version marked safe: not breaking');
assert.strictEqual(isBreaking('0.1.27', p27, marks({ '0.1.28': true, '0.1.29': false })), 'breaking', 'a breaking: true entry is never ignored');
assert.strictEqual(isBreaking('0.1.27', p27, undefined), 'unknown', 'a missing or invalid releases.json is unknown, never safe');
assert.strictEqual(isBreaking('0.1.27', p27, marks({ '0.1.29': false })), 'unknown', 'a listed version without an entry is unknown');
const minor = { ...p27, target: { ...p27.target!, version: '0.2.0' } };
assert.strictEqual(isBreaking('0.1.27', minor, marks({ '0.1.28': false, '0.1.29': false })), 'breaking', 'a 0.1 to 0.2 jump is breaking');
const major = { ...p27, target: { ...p27.target!, version: '1.0.0' } };
assert.strictEqual(isBreaking('0.9.0', major, marks({})), 'breaking', 'a major jump is breaking');
const p20 = pickTarget('0.1.20', f);
assert.strictEqual(isBreaking('0.1.20', p20, undefined), 'breaking', 'a gap without releases.json counts as breaking');
assert.strictEqual(isBreaking('0.1.20', p20, marks({ '0.1.27': false, '0.1.28': false, '0.1.29': false })), 'no', 'a gap fully covered and safe is not breaking');
assert.strictEqual(isBreaking('0.1.20', p20, marks({ '0.1.21': true, '0.1.27': false, '0.1.28': false, '0.1.29': false })), 'breaking', 'a breaking version hidden in the gap counts');
assert.strictEqual(isBreaking('0.1.29', pickTarget('0.1.29', f), undefined), 'no', 'no target, nothing to decide');
assert.strictEqual(isBreaking('0.1.27', p27, marks({ '0.1.28': false, '0.1.29': true })), 'breaking', 'a target marked breaking on its own is breaking');
assert.strictEqual(isBreaking('garbage', p27, marks({ '0.1.28': false, '0.1.29': false })), 'unknown', 'an unparseable running version is unknown');

// A malformed release inside the range is never read as safe (review on PR 2037, item 2). Built from pieces.
const O = ['o', 'r'].join('/');
const mk = (tag: string, body: unknown): Record<string, unknown> => ({ tag_name: tag, draft: false, prerelease: false, published_at: '2026-11-20T10:05:00Z', html_url: `https://github.com/${O}/releases/tag/${tag}`, body, assets: [] });
const holey = feed([mk('v0.1.29', 'ok'), mk('v0.1.28', 42), mk('v0.1.27', 'ok')], O) as Feed;
const ph = pickTarget('0.1.27', holey);
assert.deepStrictEqual(ph.missing, ['0.1.28'], 'the dropped version in the range is named');
assert.strictEqual(ph.gap, true, 'a dropped version in the range is a gap');
assert.strictEqual(isBreaking('0.1.27', ph, marks({ '0.1.29': false })), 'breaking', 'a dropped version without a mark is not safe');
assert.strictEqual(isBreaking('0.1.27', ph, marks({ '0.1.28': false, '0.1.29': false })), 'no', 'a dropped version the marks cover is decided by them');
const pu = pickTarget('0.1.27', { ...f, unplaced: true });
assert.strictEqual(isBreaking('0.1.27', pu, marks({ '0.1.28': false, '0.1.29': false })), 'breaking', 'an unplaced entry is never covered');
assert.deepStrictEqual(pickTarget('0.1.28', holey).missing, [], 'a dropped version below the running one does not matter');
console.log('selfupdate-feed: ok');
