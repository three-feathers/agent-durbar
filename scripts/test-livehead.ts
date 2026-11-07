/**
 * Spec 095 T065 (FR-063): the checking script behind `LIVE_HEAD` in `src/shared/redact.ts`. A mask rule with a bounded quantifier (`{0,N}`,
 * `{1,N}`) over a class that admits non-ASCII (`[^...]`, `\S`, `\D`, `\W`, `.`) counts an inert hidden character toward its limit, so the fast
 * path of `maskOutgoing`/`maskNoteText` would mask less than the reference. Every such rule must be covered by a `LIVE_HEAD` alternative:
 * listed below with a sample the alternative must make live. A new rule of this shape fails here until it is listed (and, if no alternative
 * fits, one is added). Code-level counts, like `cookieEnd`'s 128-character name loop, are not regexes and are covered by the `cookie`
 * alternative by hand; the differential fuzz in `test-maskoutgoing.ts` is their check. No credits.
 */
import * as assert from 'assert';
import { _maskSourcesForTest, hiddenCanHide } from '../src/shared/redact';

const WINDOW = /(\[\^(?:\\.|[^\]\\])*\]|\\S|\\D|\\W|(?<!\\)\.)\{(\d*),(\d+)\}/g;
/** A distinctive piece of the rule's source, and a text the rule reads, which `LIVE_HEAD` must make live. */
const COVERED: Array<[string, string, string]> = [
  ['[^\\s/:@"]{0,200}', 'url credential', 'https://user:pw@host/'],
  ['[^\\s=;,"\'\\\\]{1,128}', 'cookie', 'Cookie: a=b'],
  ['\\bmachine\\s{1,8}', 'netrc', 'machine h login u password p'],
  ['\\bcurl\\b[^\\r\\n]{0,200}', 'curl -u', 'curl -u u:p https://h'],
  ['[^()\\r\\n]{0,128}', 'named secret (value closer)', 'password=abc'],
  ['<>,;|&]{0,128}', 'named secret (value body)', 'token=abc'],
];
const used = new Set<string>();
let found = 0;
for (const src of _maskSourcesForTest()) {
  const hits = [...src.matchAll(WINDOW)];
  if (!hits.length) continue;
  found++;
  const cs = COVERED.filter(([key]) => src.includes(key));
  assert.ok(cs.length, `a mask rule has a bounded window over a class that admits non-ASCII (${hits[0][0]}) with no LIVE_HEAD alternative: ${src.slice(0, 90)}`);
  for (const c of cs) used.add(c[0]);
}
assert.ok(found >= 6, `the walker finds the rules (${found})`);
for (const [key, what, sample] of COVERED) {
  assert.ok(used.has(key), `the list entry for ${what} matches a rule (a stale entry is removed)`);
  assert.strictEqual(hiddenCanHide('é‍é ' + sample, [], {}), true, `LIVE_HEAD makes hidden characters live for ${what}`);
}
assert.strictEqual(hiddenCanHide('é‍é plain words', [], {}), false, 'no rule head: an inert hidden character stays inert');
// the walker itself
assert.strictEqual([...'[^x]{0,9} \\S{1,3} a{0,4} [ab]{1,5}'.matchAll(WINDOW)].length, 2, 'the walker sees a negated class and \\S, not an ASCII class');
console.log(`livehead: ${found} rules with a non-ASCII window, all covered`);
