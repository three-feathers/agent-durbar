/**
 * Spec 012 FR-196 (issue #1981; owner decisions of 2026-11-23, #2060 items 8 and 9): closed lists keep a harmless word readable where a secret name's rule hid it, on every shared mask
 * (`redact`, `maskSecretCommand`, `maskSecretArgs`, `maskSecretUrl`, `maskOutgoing`, `maskNoteText`) and on the task line's label mask
 * (`DurbarSafeText.maskLabel`, the chip and Copy). Labelled asserts per class, near misses that stay hidden, and a differential against the
 * reading with FR-196 off (`_withoutOvermaskNarrowForTest`, which reads as `main` did): only the listed classes change, counted per class.
 * Fake values only, built from short pieces and a seeded generator at run time. `npm run test:overmask`. No credits spent.
 */
import './safetext-shared';
import assert from 'assert';
import path from 'path';
import * as R from '../src/shared/redact';

let n = 0;
const ok = (c: unknown, m: string): void => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string): void => { assert.deepStrictEqual(a, b, m); n++; };
const S = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as {
  maskLabel(raw: unknown, kind: string, mask: unknown): string }; // the shared module is handed in by ./safetext-shared
const TOOLMASK = { redact: (t: string) => R.redact(t), cmd: (t: string) => R.maskSecretCommand(t), url: (t: string) => R.maskSecretUrl(t) };
const off = <T>(f: () => T): T => R._withoutOvermaskNarrowForTest(f);
const H = '[redacted]';

/** Every surface a command line reaches, as one record. */
const all = (t: string): Record<string, string> => ({
  cmd: R.maskSecretCommand(t), args: R.maskSecretArgs(t.split(' ')).join(' '), redact: R.redact(t), url: R.maskSecretUrl(t),
  outgoing: R.maskOutgoing(t).text, note: R.maskNoteText(t).text, taskRun: S.maskLabel(t, 'run', TOOLMASK), taskFetch: S.maskLabel(t, 'fetch', TOOLMASK),
});
const shown = (t: string, m: string): void => { const r = all(t); for (const [k, v] of Object.entries(r)) eq(v, t, `${m} (${k})`); };
const hidden = (t: string, part: string, m: string): void => {
  const r = all(t);
  ok(!r.cmd.includes(part) && !r.taskRun.includes(part), `${m} (command and task line)`);
  eq(r, off(() => all(t)), `${m} (every surface reads as before FR-196)`);
};
/** Hidden on every surface (not only as before FR-196): the sign-in cases. */
const hiddenEvery = (t: string, part: string, m: string): void => { for (const [k, v] of Object.entries(all(t))) ok(!v.includes(part), `${m} (${k})`); hidden(t, part, m); };

// pieces (no secret-shaped literal in the source)
const pw = ['PASS', 'WORD'].join('');
const tok = ['to', 'ken'].join('');
const gh = ['gh', 'p_'].join('') + 'A1b2C3d4'.repeat(4) + 'E5f6';

// class (a): a long flag whose first word is `show` or `no` takes no next word as its value (`no`: owner decision 2026-11-23, #2060 item 9)
shown('git log --show-signature -3', 'FR-196 a: --show-signature then a count');
shown('git log --show-signature HEAD~3', 'FR-196 a: --show-signature then a revision');
shown(`gh auth status --show-${tok} -h example.test`, 'FR-196 a: --show-<name> then a host flag');
shown('tool --no-auth build4x7q', 'FR-196 a (owner decision 2026-11-23, #2060 item 9): a negated flag takes no value');
shown('git log --no-show-signature -n 5', 'FR-196 a: --no-show-signature then a short flag');
shown('claude --no-session-persistence -p hi', 'FR-196 a: a negated flag then the next flag');
hidden(`tool --no-${tok}=build4x7q`, 'build4x7q', 'FR-196 a stays: the = form of a negated flag hides its value');
// near misses: hidden as before
hidden(`tool --${tok} build4x7q`, 'build4x7q', 'FR-196 a stays: a plain secret flag hides the next word');
hidden(`tool --show-${tok}=build4x7q`, 'build4x7q', 'FR-196 a stays: the = form of a switch flag hides its value');
hidden(`tool --shown-${tok} build4x7q`, 'build4x7q', 'FR-196 a stays: a lead that only starts with show');
hidden(`tool --snow-${tok} build4x7q`, 'build4x7q', 'FR-196 a stays: a lead near show');
hidden(`tool --no${tok} build4x7q`, 'build4x7q', 'FR-196 a stays: no hyphen after no');
hidden(`tool -no-${tok} build4x7q`, 'build4x7q', 'FR-196 a stays: one dash is not a long flag');
hidden(`tool --known-${tok} build4x7q`, 'build4x7q', 'FR-196 a stays: a lead that holds no');
hidden(`tool --no-auth ${gh}`, gh.slice(4, 14), 'FR-196 a stays: a token after a switch flag is hidden by its own shape');

// class (b): an OAuth state value that is a whole lower-case word of 1 to 7 letters, in a link with no code parameter (owner decision 2026-11-23, #2060 item 8)
shown('gh api repos/o/r/pulls?state=open&per_page=50', 'FR-196 b: ?state=open in an API path');
shown('curl https://api.example.test/repos/o/r/issues?state=closed', 'FR-196 b: ?state=closed in a URL');
shown('open https://example.test/q?a=1&State=all#top', 'FR-196 b: the name in any case, before a fragment');
shown('see https://example.test/?state=open and https://example.test/cb?x=1', 'FR-196 b: a code-free link next to another link');
for (const [v, why] of [['Open', 'a capital'], ['open1', 'a digit'], ['abcdefgh', '8 letters'], ['in_prog', 'an underscore'], ['a-b', 'a hyphen'], ['op%65n', 'a percent escape'], ['ab.cd', 'a dot']]) {
  hidden(`open https://example.test/cb?state=${v}&x=1`, `state=${v}`, `FR-196 b stays: a state value with ${why}`);
}
hiddenEvery('open https://example.test/cb?code=python', 'python', 'FR-196 b stays: an authorization code is hidden whatever its value (review on PR #630)');
hiddenEvery('open https://example.test/cb?code=zq9x&state=open', 'state=open', 'FR-196 b stays: a state word in a sign-in callback (code before it)');
hiddenEvery('open https://example.test/cb?state=open&code=zq9x', 'state=open', 'FR-196 b stays: a state word in a sign-in callback (code after it)');
hiddenEvery('open https://example.test/cb?state=open#code=zq9x', 'state=open', 'FR-196 b stays: a code in the fragment');
hidden('open https://example.test/cb?redirect=x%26state%3Dopen%26code%3Dzq9x', '%3Dopen', 'FR-196 b stays: an encoded callback');
hiddenEvery('?CODE=abc&State=def', 'State=def', 'FR-196 b stays: the name in any case next to a code (test-redact any case)');
// pre-review of PR 2098: a code name written with percent escapes is a code name (the URL rule decodes it, so the state check must too)
hiddenEvery('open https://example.test/cb?%63ode=zq9x&state=open', 'state=open', 'FR-196 b stays: a state word next to a percent-escaped code name');
hiddenEvery('open https://example.test/cb?state=open&%2563ode=zq9x', 'state=open', 'FR-196 b stays: a state word next to a twice-escaped code name');
hiddenEvery('open https://example.test/cb?%63ode=python', 'python', 'FR-196 b stays: a percent-escaped code name hides its value');
// the link is the run around the state word: a code in a different link next to it changes nothing, and that link's own state stays hidden
{
  const t = 'see https://example.test/r?state=open and https://example.test/cb?code=zq9x&state=done';
  for (const [k, v] of Object.entries(all(t))) {
    if (k === 'taskFetch') continue; // the fetch kind reads one URL, not a sentence
    ok(v.includes('r?state=open') && !v.includes('state=done'), `FR-196 b: the state check reads its own link only (${k})`);
  }
}

// class (c): a switch word as the whole value of a secret name
shown('ssh -o PasswordAuthentication=no host', 'FR-196 c: an ssh option set to no');
shown(`${pw}=false npm test`, 'FR-196 c: NAME=false');
shown(`tool --pass${'word'}=no`, 'FR-196 c: --password=no');
shown(`${pw}=YES make`, 'FR-196 c: any case');
// the separators the switch values are read after: an equals sign glued to the name, or a flag's own equals sign; a spaced equals sign or a colon reads as before
for (const t of [`${pw} =no make`, `tool --pass${'word'}:no`]) for (const [k, v] of Object.entries(all(t))) eq(v, off(() => all(t))[k], `FR-196 c: another separator reads as before: ${t.replace(pw, 'NAME')} (${k})`);
for (const v of ['nope', 'no1', 'yesterday', 'offline', 'truex', '"no"', 'no-way', 'on2', 'Off9x']) hidden(`${pw}=${v} make`, `=${v}`, `FR-196 c stays: ${v} is not a whole switch word`);
hidden(`tool --pass${'word'}=nope`, 'nope', 'FR-196 c stays: --password=nope');

// the reading with the step off is main's (also checked locally against main's compiled file)
eq(off(() => R.redact('see https://example.test/?state=open')), 'see https://example.test/?state=[redacted]', 'FR-196 step off: a state word is hidden, as on main');
eq(off(() => R.maskSecretArgs(['--no-auth', 'value', 'PASSWORD=no'])), ['--no-auth', '[redacted]', 'PASSWORD=[redacted]'], 'FR-196 step off: the flag and value rules read as on main');

// growth: the link scan reads each character of a run at most twice, however many state values the run holds (a work counter, not a clock)
for (const k of [100, 2000]) {
  const t = 'https://example.test/r?' + 'state=open&'.repeat(k) + 'x=1 ' + 'y'.repeat(k);
  R._stateScanForTest(); R.redact(t); const work = R._stateScanForTest();
  ok(work > 0 && work <= 2 * t.length, `FR-196 b growth: the link scan is linear (${k} values, ${work} reads for ${t.length} characters)`);
}

// differential: FR-196 on vs off (as main), counted per class; nothing outside the listed classes may change
/** Whether `on` is `off` with some of its masks shown: every piece `off` shows stands in `on`, in order, and only a mask of `off` may stand for other text. */
const onlyShows = (off: string, on: string): boolean => {
  const parts = off.split(H).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp('^' + parts.join('[\\s\\S]*?') + '$').test(on);
};
let seed = 20261124;
const rnd = (k: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % k; };
const from = (a: string, len: number): string => { let s = ''; for (let i = 0; i < len; i++) s += a[rnd(a.length)]; return s; };
const LOW = 'abcdefghijklmnopqrstuvwxyz', UP = LOW.toUpperCase(), DIG = '0123456789', HEX = DIG + 'abcdef', B64U = LOW + UP + DIG + '-_';
const codeShaped = (): string => {
  switch (rnd(6)) {
    case 0: return from(HEX, 16 + rnd(25)); // hex
    case 1: return from(B64U, 16 + rnd(40)); // base64url
    case 2: return from(LOW, 3 + rnd(8)) + from(DIG, 1 + rnd(3)) + from(LOW, rnd(6)); // digit-bearing
    case 3: return from(LOW, 1 + rnd(6)) + from(UP, 1) + from(LOW, rnd(8)); // mixed case
    case 4: return from(LOW, 8 + rnd(30)); // letters only
    default: return from(LOW, 2 + rnd(5)) + '-_.'[rnd(3)] + from(LOW, 2 + rnd(5)); // letters with a symbol
  }
};
const SECRET_FLAGS = ['--token', '--password', '--api-key', '--client-secret', '--auth', '--show-token=', '--no-auth=', '--shown-token', '--known-password'];
const SECRET_NAMES = [pw, 'API_KEY', 'CLIENT_SECRET', 'PasswordAuthentication', 'DB_PASS'];
const CLASSES = ['a', 'b', 'c'] as const;
const changed: Record<string, number> = { a: 0, b: 0, c: 0, secret: 0 };
const total: Record<string, number> = { a: 0, b: 0, c: 0, secret: 0 };
const corpus: { cls: string; t: string }[] = [];
for (let i = 0; i < 400; i++) {
  const v = codeShaped();
  corpus.push({ cls: 'secret', t: `open https://example.test/cb?${['state', 'code', 'State', 'CODE'][rnd(4)]}=${v}&x=1` });
  const f = SECRET_FLAGS[rnd(SECRET_FLAGS.length)];
  corpus.push({ cls: 'secret', t: f.endsWith('=') ? `tool ${f}${v}` : `tool ${f} ${v}` });
  corpus.push({ cls: 'secret', t: `${SECRET_NAMES[rnd(SECRET_NAMES.length)]}=${v} make` });
  corpus.push({ cls: 'a', t: `git log --${['show', 'Show', 'SHOW', 'no', 'No'][rnd(5)]}-${['signature', 'token', 'auth', 'password'][rnd(4)]} ${['-3', '-n', 'HEAD~2', 'main', 'src'][rnd(5)]}` });
  corpus.push({ cls: 'b', t: `curl https://api.example.test/r?${['state', 'State', 'STATE'][rnd(3)]}=${from(LOW, 1 + rnd(7))}&page=2` });
  const w = from(LOW, 1 + rnd(7)), c = codeShaped();
  corpus.push({ cls: 'secret', t: rnd(2) ? `curl https://api.example.test/cb?code=${c}&state=${w}` : `curl https://api.example.test/cb?state=${w}&code=${c}` });
  corpus.push({ cls: 'secret', t: `curl https://api.example.test/r?code=${w}` });
  corpus.push({ cls: 'c', t: `${SECRET_NAMES[rnd(SECRET_NAMES.length)]}=${['yes', 'no', 'true', 'false', 'on', 'off', 'No', 'TRUE'][rnd(8)]} make` });
}
for (const { cls, t } of corpus) {
  total[cls]++;
  const a = all(t), b = off(() => all(t));
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    changed[cls]++;
    // a change only ever shows: what FR-196 on shows is the text as written on the command surfaces
    // a change only shows: every piece the step-off reading shows is shown with the step on too, on every surface
    for (const k of Object.keys(a)) ok(onlyShows(b[k], a[k]), `FR-196 differential: a change only shows text (${cls}, ${k})`);
  }
}
console.log(`test-overmask differential: changed per class ${JSON.stringify(changed)} of ${JSON.stringify(total)}`);
eq(changed.secret, 0, 'FR-196 differential: no code-shaped or secret-flag value main hides is shown (0)');
for (const c of CLASSES) ok(changed[c] > 0 && changed[c] === total[c], `FR-196 differential: every text of class ${c} changes`);
eq(Object.values(changed).reduce((x, y) => x + y, 0), CLASSES.reduce((x, c) => x + changed[c], 0), 'FR-196 differential: the total equals the sum of the listed classes');

// issue #2062: a Resend-shaped key (`re_<8>_<24>`) after `-` or `_` is base64url, not a key; anywhere else it is masked as before. Counted against the shape as
// written before the fix (the reference below), on the bare mask and on `redact`, per context class: only the `-` and `_` class may change. A key glued
// after a letter or digit is not a key on `main` either (#1329, unchanged; checked locally against `main`'s compiled file: only the `-` and `_` contexts differ)
{
  const REF = /re_[A-Za-z0-9]{8}_[A-Za-z0-9]{24}/;
  const AN = LOW + UP + DIG;
  const ctx: Record<string, (k: string) => string> = { start: (k) => k, space: (k) => 'use ' + k, quote: (k) => `"${k}"`, eq: (k) => 'RESEND_KEY=' + k, colon: (k) => 'resend: ' + k,
    line: (k) => 'a\n' + k, paren: (k) => '(' + k + ')', comma: (k) => 'a,' + k, slash: (k) => 'x/' + k, plus: (k) => 'x+' + k, dot: (k) => 'x.' + k, dash: (k) => 'x-' + k, underscore: (k) => 'x_' + k };
  const shownRe: Record<string, number> = {}, totalRe: Record<string, number> = {};
  for (let i = 0; i < 300; i++) {
    const key = 're_' + from(AN, 8) + '_' + from(AN, 24);
    for (const [c, f] of Object.entries(ctx)) {
      const t = f(key); totalRe[c] = (totalRe[c] || 0) + 1;
      const refHid = REF.test(t); // the shape before the fix matched the key in every context
      const shown = R.maskBareTokenShapes(t, '[R]').includes(key.slice(3)) || R.redact(t).includes(key.slice(3));
      if (refHid && shown) shownRe[c] = (shownRe[c] || 0) + 1;
    }
  }
  console.log(`test-overmask #2062: shown per context ${JSON.stringify(shownRe)} of ${JSON.stringify(totalRe)}`);
  const LISTED = ['dash', 'underscore'];
  for (const c of LISTED) eq(shownRe[c], totalRe[c], `#2062 differential: every key after ${c === 'dash' ? '-' : '_'} reads as base64url (shown)`);
  eq(Object.values(shownRe).reduce((x, y) => x + y, 0), LISTED.reduce((x, c) => x + (shownRe[c] || 0), 0), '#2062 differential: no key is shown outside the - and _ class (the total equals their sum)');
}

console.log(`test-overmask: ${n} asserts passed`);
