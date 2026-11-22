/**
 * Spec 118 T002 (FR-001, FR-003): the one strict repository parser and the case-insensitive compare. `npm run test:selfupdate-repo`.
 * Pure: no network, no files. Every refusal is its own assert, so a planted mutant names the case it breaks.
 */
import * as assert from 'assert';
import { feedUrl, parseRepoSlug, sameRepo } from '../src/shared/selfupdate';

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
console.log('selfupdate-repo: ok');
