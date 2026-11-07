/**
 * Spec 095 T065 (FR-063): the checking script behind `LIVE_HEAD` in `src/shared/redact.ts`. A mask rule with a counted quantifier over an
 * atom that admits non-ASCII (`scripts/livehead-walk.ts`: `[^...]`, `\S`, `\D`, `\W`, `.`, `[\s\S]`, `\p{..}`, a non-ASCII literal or range,
 * a backreference, a group holding any of them, fixed counts `{8}` and open counts `{8,}` too) counts an inert hidden character toward its
 * limit, so the fast path of `maskOutgoing`/`maskNoteText` would mask less than the reference. Every such rule must be listed below with
 * the `LIVE_HEAD` alternative that covers it and a sample only that alternative matches, so removing an alternative fails its own entry
 * (review of PR 1244, items 2 and 7). A new rule of this shape fails here until it is listed (and, if no alternative fits, one is added).
 * What this does not see: code-level counts, like `cookieEnd`'s 128-character name loop, which are not regexes (the `cookie` alternative
 * covers them by hand; the differential fuzz in `test-maskoutgoing-fuzz.ts` is their check), and a rule built from a string at run time
 * that `_maskSourcesForTest` does not list. No credits.
 */
import * as assert from 'assert';
import { _liveHeadsForTest, _maskSourcesForTest, hiddenCanHide } from '../src/shared/redact';
import { windowsOf } from './livehead-walk';

/** A distinctive piece of the rule's source, the `LIVE_HEAD` alternative's own keyword, and a text only that alternative matches. */
const COVERED: Array<{ key: string; alt: string; what: string; sample: string }> = [
  { key: '[^\\s/:@"]{0,200}', alt: ':\\/\\/', what: 'url credential', sample: 'https://user:pw@host/' },
  { key: '[^\\s=;,"\'\\\\]{1,128}', alt: 'cookie', what: 'cookie', sample: 'Cookie: a=b' },
  { key: '\\bmachine\\s{1,8}', alt: 'machine', what: 'netrc', sample: 'machine h login u password p' },
  { key: '\\bcurl\\b[^\\r\\n]{0,200}', alt: 'curl', what: 'curl -u', sample: 'curl -u u:p h' },
  { key: '[^()\\r\\n]{0,128}', alt: '%3[DdAa]', what: 'named secret', sample: 'password=abc' },
];
const used = new Set<string>();
/** Each source with a window must hold a list entry's key; returns how many sources have a window. */
function assertCovered(sources: readonly string[]): number {
  let n = 0;
  for (const src of sources) {
    const hits = windowsOf(src);
    if (!hits.length) continue;
    n++;
    const cs = COVERED.filter((c) => src.includes(c.key));
    assert.ok(cs.length, `a mask rule has a counted quantifier over an atom that admits non-ASCII (${hits[0]}) with no LIVE_HEAD alternative: ${src.slice(0, 90)}`);
    for (const c of cs) used.add(c.key);
  }
  return n;
}
const found = assertCovered(_maskSourcesForTest());
assert.ok(found >= 6, `the walker finds the rules (${found})`);
const alts = _liveHeadsForTest();
for (const c of COVERED) {
  assert.ok(used.has(c.key), `the list entry for ${c.what} matches a rule (a stale entry is removed)`);
  const own = alts.filter((a) => a.source.includes(c.alt));
  assert.strictEqual(own.length, 1, `LIVE_HEAD has an alternative for ${c.what} (${c.alt})`);
  assert.ok(own[0].test(c.sample), `the ${c.what} alternative matches its own sample`);
  for (const other of alts) if (other !== own[0]) assert.ok(!other.test(c.sample), `the ${c.what} sample is independent: no other alternative matches it (${other.source.slice(0, 30)})`);
  assert.strictEqual(hiddenCanHide('é‍é ' + c.sample, [], {}), true, `LIVE_HEAD makes hidden characters live for ${c.what}`);
}
assert.strictEqual(hiddenCanHide('é‍é plain words', [], {}), false, 'no rule head: an inert hidden character stays inert');

// the walker: every shape the review of PR 1244 named is flagged, the ASCII ones are not
const flagged = (src: string): boolean => windowsOf(src).length > 0;
for (const src of [
  '[^x]{0,9}', '\\S{1,3}', '\\D{2,5}', '\\W{0,4}', '.{0,5}', 'a.{3}',
  '[\\s\\S]{0,40}', '[\\S]{0,9}', '\\p{L}{0,9}', '\\P{ASCII}{0,9}', '[\\p{L}\\p{N}]{0,9}', '[\\^@-￿]{0,9}', '[a-zé]{0,9}', '[a-\\u00e9]{1,9}', '[\\x20-\\uffff]{0,9}', '\\u00e9{0,9}',
  '[^\\s]{8}(?![^\\s])', '\\S{8}(?!\\S)', '\\S{6}', '[^\\s]{8,}',
  '(?:[^x]|y){0,9}z', '(?:b|\\S+c){2}', '(?:x(?:y|.)z){1,4}', '(?:[a-z]|é){0,9}', '(a)\\1{3}', '(?<n>a)\\k<n>{3}',
  '(\\bpin [\\s\\S]{0,40} )[0-9]{4,}', // M17
  // review of PR 1244, round 2: any quantifier over an atom that takes non-ASCII but not every hidden character, `?` and `{0,1}`, `[^]`, a literal
  '(\\bpin [\u00e0-\u00ff]+)[0-9]{4,}', '[\u00e0-\u00ff]*', '\\p{L}+', '[^\\s\u200d]+', '(?:[\u00e0-\u00ff]|y)*', '[^\\s]?\u00e9', '(\\bpin:[^\\s]?\u00e9)[0-9]{4,}', '.?', '[^x]{0,1}', '[^x]?',
  '[^]{0,5}', '[^]{0,5}x', 'a[^]{2}b', '[a-z]+\u00e9', '\u00e9',
]) assert.ok(flagged(src), `flagged: ${src}`);
for (const src of [
  '[ab]{1,5}', '[a.]{0,9}', '\\w{0,9}', '\\s{1,8}', '\\d{4}', '\\.{1,2}', '[A-Za-z0-9]{8}', '[\\w.-]{1,128}', '\\x41{3}', '[\\x20-\\x7e]{0,9}',
  '[^x]+', '[^x]*', '\\S+', '\\S*', '.+', '.*', '[^]+', '[^]*', '[^x]{1}', '[a-z]+', '[a-z]?', '(?:[^x]|y)+', '(?:[^x]|y)*', '(?:[a.]|\\w|\\s|\\.){0,9}(?:[^x]|y)', '\\(?:[^x]\\){0,9}[^y]',
  String.raw`[\w.-]{1,128}(?:[\\/][\w.-]{1,128}){1,16}\.[A-Za-z0-9]{1,8}`, // NOT_A_VALUE path groups: ASCII only
]) assert.ok(!flagged(src), `not flagged: ${src}`);
assert.throws(() => assertCovered(['(?:[^x]|y){0,9}z']), /no LIVE_HEAD alternative/, 'a rule with a non-ASCII grouped window and no alternative fails the check');
assert.throws(() => assertCovered(['(\\bpin [\\s\\S]{0,40} )[0-9]{4,}']), /no LIVE_HEAD alternative/, 'M17: a new rule with [\\s\\S]{0,40} fails the check');
assert.throws(() => assertCovered(['(\\bpin [\u00e0-\u00ff]+)[0-9]{4,}']), /no LIVE_HEAD alternative/, 'N23: a new rule with [\u00e0-\u00ff]+ fails the check');
assert.throws(() => assertCovered(['(\\bpin:[^\\s]?\u00e9)[0-9]{4,}']), /no LIVE_HEAD alternative/, 'N24: a new rule with [^\\s]?\u00e9 fails the check');
assert.throws(() => assertCovered(['\\bkey \\S{6}']), /no LIVE_HEAD alternative/, 'M18: a new rule with \\S{6} fails the check');
console.log(`livehead: ${found} rules with a non-ASCII count, all covered, each alternative checked alone`);
