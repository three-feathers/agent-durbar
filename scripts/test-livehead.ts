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
/** Whether a regex body can match a non-ASCII character: a negated class, `\S`, `\D`, `\W` or a bare `.` (a class that is not negated, `\w` and `\s` without the `u` flag are ASCII, or listed). */
function admitsNonAscii(body: string): boolean {
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') { if (/[SDW]/.test(body[i + 1] ?? '')) return true; i++; continue; }
    if (c === '[') {
      const neg = body[i + 1] === '^';
      i += neg ? 2 : 1;
      if (body[i] === ']') i++;
      while (i < body.length && body[i] !== ']') { if (body[i] === '\\') i++; i++; }
      if (neg) return true;
      continue;
    }
    if (c === '.') return true;
  }
  return false;
}
/** The grouped windows of a source, `(...){a,b}` or `(...){a}`: the group's body when it admits non-ASCII. Walks each closing bracket back to its opener. */
function groupedWindows(src: string): string[] {
  const out: string[] = [];
  const open: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '[') { i++; if (src[i] === '^') i++; if (src[i] === ']') i++; while (i < src.length && src[i] !== ']') { if (src[i] === '\\') i++; i++; } continue; }
    if (c === '(') open.push(i);
    else if (c === ')') {
      const from = open.pop();
      const q = /^\{\d+(?:,\d+)?\}/.exec(src.slice(i + 1));
      if (from !== undefined && q && admitsNonAscii(src.slice(from, i))) out.push(src.slice(from, i + 1 + q[0].length));
    }
  }
  return out;
}
/** Every bounded window of `src` over something that admits non-ASCII: a class or `\S`, or a group. */
export function windowsOf(src: string): string[] {
  return [...[...src.matchAll(WINDOW)].map((h) => h[0]), ...groupedWindows(src)];
}
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
/** Each source with a window must be covered by a list entry; returns how many have one. */
function assertCovered(sources: readonly string[]): number {
  let n = 0;
  for (const src of sources) {
    const hits = windowsOf(src);
    if (!hits.length) continue;
    n++;
    const cs = COVERED.filter(([key]) => src.includes(key));
    assert.ok(cs.length, `a mask rule has a bounded window over a class or group that admits non-ASCII (${hits[0]}) with no LIVE_HEAD alternative: ${src.slice(0, 90)}`);
    for (const c of cs) used.add(c[0]);
  }
  return n;
}
const found = assertCovered(_maskSourcesForTest());
assert.ok(found >= 6, `the walker finds the rules (${found})`);
for (const [key, what, sample] of COVERED) {
  assert.ok(used.has(key), `the list entry for ${what} matches a rule (a stale entry is removed)`);
  assert.strictEqual(hiddenCanHide('é‍é ' + sample, [], {}), true, `LIVE_HEAD makes hidden characters live for ${what}`);
}
assert.strictEqual(hiddenCanHide('é‍é plain words', [], {}), false, 'no rule head: an inert hidden character stays inert');
// the walker itself
assert.strictEqual(windowsOf('[^x]{0,9} \\S{1,3} a{0,4} [ab]{1,5}').length, 2, 'the walker sees a negated class and \\S, not an ASCII class');
assert.strictEqual(windowsOf('(?:[^x]|y){0,9}z').length, 1, 'a grouped window over a negated class is a window');
assert.strictEqual(windowsOf('a(?:b|\\S+c){2}').length, 1, 'a fixed-count group over \\S is a window');
assert.strictEqual(windowsOf('(?:x(?:y|.)z){1,4}').length, 1, 'a nested group with a dot is a window (the outer group; the inner has no count)');
assert.strictEqual(windowsOf('(?:[a.]|\\w|\\s|\\.){0,9}(?:[^x]|y)').length, 0, 'an ASCII-only group (a dot in a class or escaped, \\w, \\s) and a group with no count are not windows');
assert.strictEqual(windowsOf('\\(?:[^x]\\){0,9}[^y]').length, 0, 'an escaped bracket opens no group');
assert.strictEqual(windowsOf(String.raw`[\w.-]{1,128}(?:[\\/][\w.-]{1,128}){1,16}\.[A-Za-z0-9]{1,8}`).length, 0, 'the NOT_A_VALUE path groups are ASCII-only (a dot in a class, \\w without the u flag): not flagged');
assert.throws(() => assertCovered(['(?:[^x]|y){0,9}z']), /no LIVE_HEAD alternative/, 'a rule with a non-ASCII grouped window and no alternative fails the check');
console.log(`livehead: ${found} rules with a non-ASCII window, all covered`);
