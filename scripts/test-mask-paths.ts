/**
 * Spec 012 (2026-11-23, T492): two more contexts in path-like text are masked by the shared masks (`redact`, `maskSecretCommand`, `maskOutgoing`,
 * `maskNoteText`, and `maskBareTokenShapes` for the token context). Labelled asserts per family and context, the path after a value kept as written,
 * Windows forms, and a differential with the step off (`_withoutPathContextsForTest`, which reads as `main` did): every sample hidden now (counted per
 * family), and no harmless path, URL, command or data text newly hidden (counted per class). Made-up values only, built from pieces at run time.
 * `npm run test:maskpaths`. No credits spent.
 */
import assert from 'assert';
import * as R from '../src/shared/redact';

let n = 0;
const ok = (c: unknown, m: string): void => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string): void => { assert.deepStrictEqual(a, b, m); n++; };
const run = (k: number, chars = 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7'): string => { let s = ''; while (s.length < k) s += chars; return s.slice(0, k); };
const an = (k: number): string => run(k);
const hex = (k: number): string => run(k, '0a1b2c3d4e5f6a7b8c9d');
const up = (k: number): string => run(k, 'AB3DE6GH2JK7MN5PQ4ST');
const lo = (k: number): string => run(k, 'a3b6c9d2e5f8g1h4j7k');
const off = <T>(f: () => T): T => R._withoutPathContextsForTest(f);

// the token families whose prefix is made of base64 characters (family name, sample); the names say what a sample is, never how to pass a mask
const TOKENS: [string, string][] = [
  ['bedrock', 'AB' + 'SK' + an(120) + '=='], ['google api', 'AI' + 'za' + an(35)], ['google hmac', 'GO' + 'OG1' + up(50)], ['alibaba', 'LT' + 'AI' + an(20)],
  ['google refresh', '1/' + '/0' + an(40)], ['volcengine', 'AK' + 'LT' + an(30)], ['nuget', 'oy' + '2' + lo(43)], ['crates', 'ci' + 'o' + an(32)], ['bitbucket', 'AT' + 'BB' + an(30)],
  ['clickhouse', '4b' + '1d' + an(38)], ['databricks', 'da' + 'pi' + hex(32)], ['jfrog', 'AK' + 'Cp' + an(69)], ['jfrog ref', 'cm' + 'Vmd' + an(59)], ['twilio', 'S' + 'K' + hex(32)],
  ['facebook', 'EA' + 'AC' + an(120)], ['x bearer', 'A'.repeat(22) + 'B' + an(30) + '%2B' + an(60)], ['square', 'EA' + 'AA' + an(60)], ['grafana', 'eyJ' + 'rIjoi' + an(80)],
];
// named values: (name, separator and value); the value is what must go
const NAMED: [string, string, string][] = [
  ['aws secret', 'aws_secret_' + 'access_key=', an(40)], ['aws session', 'AWS_SESSION_' + 'TOKEN=', an(40)], ['password', 'pass' + 'word=', an(12)], ['db password', 'DB_PASS' + 'WORD=', an(12)],
  ['api key', 'api_' + 'key: ', an(32)], ['api key header', 'x-api-' + 'key: ', an(32)], ['camel api key', 'myApi' + 'Key=', an(16)], ['account key', 'AccountKey=', an(88)],
  ['shared access key', 'SharedAccessKey=', an(44)], ['npm auth', '_auth' + 'Token=', hex(36)], ['gitlab session', '_gitlab_' + 'session=', hex(32)], ['pwd', 'pw' + 'd=', an(10)],
];
const MASKS: Record<string, (t: string) => string> = {
  redact: (t) => R.redact(t, {}), command: (t) => R.maskSecretCommand(t, {}), outgoing: (t) => R.maskOutgoing(t).text, note: (t) => R.maskNoteText(t).text,
};
const tail = (s: string): string => s.slice(-8);

// 1. a token after `/` or followed by `/`, in POSIX, URL and Windows forms
const TOKEN_CTX: Record<string, (s: string) => string> = {
  'after a slash': (s) => 'a/' + s, 'a path': (s) => 'open /srv/x/' + s + ' now', 'a quoted path': (s) => "open '/srv/x/" + s + "'", 'a URL path': (s) => 'https://h.test/p/' + s,
  'a URL path and query': (s) => 'https://h.test/p/' + s + '?x=1', 'a middle segment': (s) => '/srv/' + s + '/a.txt', 'followed by a slash': (s) => s + '/a.txt',
  'a file URL': (s) => 'file:///C:/srv/' + s, 'a drive path': (s) => 'C:\\srv\\' + s, 'a UNC path': (s) => '\\\\nas01\\share\\' + s, 'a forward-slash drive path': (s) => 'C:/srv/' + s + '/a.txt',
};
for (const [fam, s] of TOKENS) for (const [ctx, f] of Object.entries(TOKEN_CTX)) {
  const t = f(s);
  for (const [m, g] of Object.entries(MASKS)) ok(!g(t).includes(tail(s)), `T492 token, ${fam}, ${ctx}: hidden (${m})`);
  ok(!R.maskBareTokenShapes(t, '[s]').includes(tail(s)), `T492 token, ${fam}, ${ctx}: hidden (bare)`);
}
// the path around it stays
eq(R.redact('/srv/' + TOKENS[1][1] + '/a.txt', {}), '/srv/[redacted]/a.txt', 'T492 token: the folders around a hidden segment stay');

// base64 data keeps its slashes: a family's shape after a `/` deep in a long base64 run, or before a `/` and a long base64 run, is data, not a path
{
  const b64 = run(300, 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7+QrS');
  for (const [fam, s] of TOKENS) {
    for (const t of [b64 + '/' + s + ' end', 'x ' + s + '/' + b64 + ' end']) for (const [m, g] of Object.entries(MASKS)) eq(g(t), off(() => g(t)), `T492 stays: a ${fam} shape inside a long base64 run (${m})`);
  }
}

// wrapped base64 (MIME or PEM lines of 76): a family's shape between two slashes inside a line reads as before (the run is bounded by line breaks after a long line)
{
  const line = run(76, 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7+QrS');
  for (const [fam, s] of TOKENS) for (const nl of ['\n', '\r\n']) {
    const t = line + nl + 'ab/' + s + '/cd' + nl + line;
    // the command mask reads a command as words, not lines, so there such a line is a word with a short run: masked, the over-masking the spec lists
    for (const [m, g] of Object.entries(MASKS)) if (m !== 'command') eq(g(t), off(() => g(t)), `T492 stays: a ${fam} shape inside a wrapped base64 line reads as before (${m})`);
  }
}
// a block's first or last line: only one side of the shape has a long line next to it, and that side's guard alone keeps it as data
{
  const line = run(76, 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7+QrS');
  for (const [fam, s] of TOKENS) {
    const last = line + '\n' + 'ab/' + s + '/cd', first = 'ab/' + s + '/cd' + '\n' + line;
    for (const [m, g] of Object.entries(MASKS)) if (m !== 'command') {
      eq(g(last), off(() => g(last)), `T492 stays: a ${fam} shape on a wrapped block's last line reads as before (${m})`);
      eq(g(first), off(() => g(first)), `T492 stays: a ${fam} shape on a wrapped block's first line reads as before (${m})`);
    }
  }
}
// the path run bound (PATH_RUN, 128): a shape after a slash with 127 path characters before it is a path; with 129 or more, data
{
  const s = TOKENS[1][1];
  const near = (k: number): string => 'x ' + run(k - 1, 'abcdefgh') + '/' + s + ' end';
  ok(!R.redact(near(127), {}).includes(tail(s)), 'T492 bound: 127 path characters before the slash: hidden');
  eq(R.redact(near(129), {}), off(() => R.redact(near(129), {})), 'T492 bound: 129 path characters before the slash read as before');
  const after = (k: number): string => 'x ' + s + '/' + run(k - 1, 'abcdefgh') + ' end';
  ok(!R.redact(after(127), {}).includes(tail(s)), 'T492 bound: 127 path characters after the slash: hidden');
  eq(R.redact(after(130), {}), off(() => R.redact(after(130), {})), 'T492 bound: 130 path characters after the slash read as before');
}

// base64url keeps its `-` and `_`: a family's shape right after one reads as before (the two-letter rule of #2062: no start there), also in a short text
for (const [fam, s] of TOKENS) for (const lead of ['x-', 'x_', '/a-', '/a_']) for (const [m, g] of Object.entries(MASKS)) {
  const t = lead + s;
  eq(g(t), off(() => g(t)), `T492 stays: a ${fam} shape after ${lead.slice(-1)} reads as before (${m})`);
}

// 2. a named value with a path glued after it: the value goes, the path stays
const VALUE_CTX: Record<string, (nv: string) => string> = {
  'a Windows path glued': (nv) => nv + '\\a.txt', 'a POSIX path glued': (nv) => nv + '/a.txt', 'a quoted Windows path': (nv) => "open 'C:\\srv\\" + nv + "\\a.txt'",
  'a POSIX path': (nv) => 'open /srv/' + nv + '/sub/a.txt', 'a trailing slash': (nv) => nv + '/', // hidden with its slash, as before T492
};
// a lower-case hex value of 16 to 29 characters with a path after it is hidden (the hex branch's own length)
for (const [m, g] of Object.entries(MASKS)) ok(!g('_auth' + 'Token=' + hex(20) + '/x.json').includes(hex(20).slice(4)), `T492 value, 20 hex, path: hidden (${m})`);
for (const [fam, name, v] of NAMED) for (const [ctx, f] of Object.entries(VALUE_CTX)) {
  const t = f(name + v);
  for (const [m, g] of Object.entries(MASKS)) {
    const o = g(t);
    ok(!o.includes(tail(v)), `T492 value, ${fam}, ${ctx}: hidden (${m})`);
    // a value of 40 or more base64 characters can hold slashes of its own, so a folder written right after it goes with it (FR-198 (1)); the file name stays
    const rest = t.slice(t.indexOf(v) + v.length), keep = v.length >= 40 && rest.split('/').length > 2 ? rest.slice(rest.lastIndexOf('/')) : rest;
    if (m === 'redact' && ctx !== 'a trailing slash') ok(o.endsWith(keep), `T492 value, ${fam}, ${ctx}: the path after it stays (${m})`);
  }
}
// a base64 key that holds slashes of its own, with a path after it: hidden up to the path's last segment (made up: 40 characters in three parts)
{
  const key = an(13) + '/' + an(7).toUpperCase() + '/' + an(18);
  for (const [ctx, t] of [['POSIX', 'aws_secret_' + 'access_key=' + key + '/a.txt'], ['Windows', 'aws_secret_' + 'access_key=' + key + '\\a.txt']]) {
    for (const [m, g] of Object.entries(MASKS)) { const o = g(t); ok(!o.includes(key.slice(14, 21)) && !o.includes(key.slice(-8)), `T492 value, base64 key with slashes, ${ctx} path: hidden (${m})`); }
    ok(R.redact(t, {}).endsWith('a.txt'), `T492 value, base64 key with slashes, ${ctx} path: the file name stays`);
  }
}
// a short value (4 to 7 characters, a letter and a digit) after a short name, with a path after it: hidden, as without the path
for (const [m, g] of Object.entries(MASKS)) {
  ok(!g('pw' + 'd=Pa55w0/a.txt').includes('Pa55w0'), `T492 value, short, POSIX path: hidden (${m})`);
  ok(!g('pw' + 'd=Pa55w0\\a.txt').includes('Pa55w0'), `T492 value, short, Windows path: hidden (${m})`);
}
// a name a token's mask took (FR-187's case) with a path after the value: the value is hidden too
for (const [m, g] of Object.entries(MASKS)) {
  const t = 'sk' + '-proj-' + an(24) + '-dbpass' + 'word=Ab3dE6gH9jK2/a.txt';
  ok(!g(t).includes('Ab3dE6gH9jK2'), `T492 value after a mask, POSIX path: hidden (${m})`);
}
// a hidden character inside the value: hidden on the fast paths too
for (const [m, g] of Object.entries(MASKS)) for (const zw of ['\u200b', '\u200d']) {
  const t = 'pass' + 'word=aB3d' + zw + 'E6gH9jK2/x';
  ok(!g(t).includes('E6gH9jK2'), `T492 value with a hidden character, path: hidden (${m}, ${JSON.stringify(zw)})`);
}
// harmless values that are paths stay as they were (near misses, also as before T492)
for (const t of ['pass' + 'word=keys/server_2026.pem', 'tok' + 'en=server_2026/key.pem', 'tok' + 'en=config2025/aws.json', 'pass' + 'word=./secrets/db.txt', 'pass' + 'word=C:\\keys\\a.pem',
  'tok' + 'en=src/foo1', 'api_' + 'key=$HOME/.netrc', 'tok' + 'en=Config/a.json', 'tok' + 'en=abcdef0123/x', 'tok' + 'en=' + 'ABCDEFGH/x',
  // with a file name after them, so `main` read them as a path and showed them (the near miss is then a real one)
  'tok' + 'en=MyConfig/x.json', 'tok' + 'en=BUILD2026/x.json', 'tok' + 'en=Ab1/x.json', 'tok' + 'en=1234567890123456/x.json', 'tok' + 'en=deadbeefcafebabe/x.json', 'pw' + 'd=v1.2/x.json', 'api_' + 'key=sha256/x.json']) {
  for (const [m, g] of Object.entries(MASKS)) eq(g(t), off(() => g(t)), `T492 stays as before: ${t.split('=')[1]} (${m})`);
}

// 3. differential with the step off (as main): every sample above is hidden now and was shown before, counted per family; nothing harmless changes
{
  const before: Record<string, number> = {}, now: Record<string, number> = {};
  const WITH_BARE = { ...MASKS, bare: (t: string) => R.maskBareTokenShapes(t, '[s]') };
  for (const [fam, s] of TOKENS) for (const f of Object.values(TOKEN_CTX)) for (const g of Object.values(WITH_BARE)) {
    const t = f(s);
    if (off(() => g(t)).includes(tail(s))) before[fam] = (before[fam] || 0) + 1;
    if (g(t).includes(tail(s))) now[fam] = (now[fam] || 0) + 1;
  }
  for (const [fam, name, v] of NAMED) for (const f of Object.values(VALUE_CTX)) for (const g of Object.values(MASKS)) {
    const t = f(name + v);
    if (off(() => g(t)).includes(tail(v))) before['named ' + fam] = (before['named ' + fam] || 0) + 1;
    if (g(t).includes(tail(v))) now['named ' + fam] = (now['named ' + fam] || 0) + 1;
  }
  console.log(`test-mask-paths: shown before per family ${JSON.stringify(before)}; shown now ${JSON.stringify(now)}`);
  eq(Object.keys(now).length, 0, 'T492 differential: no sample is shown now (0)');
  ok(Object.keys(before).length === TOKENS.length + NAMED.length, 'T492 differential: every family was shown before in at least one context and mask (the gap is measured, not assumed)');
}
{
  let seed = 20261123; // mulberry32: every bit of the state mixes (a plain LCG's low bits cycle with a short period)
  const rnd = (k: number): number => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return Math.floor((((x ^ (x >>> 14)) >>> 0) / 4294967296) * k); };
  const from = (a: string, k: number): string => { let s = ''; for (let i = 0; i < k; i++) s += a[rnd(a.length)]; return s; };
  const pick = <T>(a: T[]): T => a[rnd(a.length)];
  const LOW = 'abcdefghijklmnopqrstuvwxyz', UP = LOW.toUpperCase(), DIG = '0123456789', HEX = '0123456789abcdef', B64 = LOW + UP + DIG + '+/', B64U = LOW + UP + DIG + '-_';
  const word = (): string => pick(['src', 'lib', 'home', 'project', 'agent-durbar', 'node_modules', '.cache', 'build', 'assets', 'v2', '2026', 'my_app', 'Program Files', 'AppData', 'objects', 'main']);
  const file = (): string => pick(['a.txt', 'index.js', 'README.md', 'config.json', 'server_2026.pem', 'id_ed25519.pub', 'logo@2x.png', 'data.tar.gz', 'notes']);
  const seg = (): string => [() => from(HEX, 2), () => from(HEX, 38), () => from(HEX, 64), () => from(LOW + DIG, 8 + rnd(10)), () => from(B64U, 22), () => from(UP + DIG, 10), word][rnd(7)]();
  const CLASSES: Record<string, () => string> = {
    posix: () => '/' + Array.from({ length: 1 + rnd(6) }, seg).join('/') + '/' + file(),
    command: () => pick(['cat', 'ls -la', 'open', 'rm -rf', 'cp x']) + ' /' + Array.from({ length: 1 + rnd(5) }, seg).join('/'),
    windows: () => 'C:\\' + Array.from({ length: 1 + rnd(5) }, seg).join('\\') + '\\' + file(),
    unc: () => '\\\\' + pick(['nas01', 'fs', 'build01']) + '\\' + Array.from({ length: 1 + rnd(4) }, seg).join('\\'),
    url: () => 'https://' + pick(['github.com', 'cdn.example.com', 'registry.npmjs.org', 'storage.example.com']) + '/' + Array.from({ length: 1 + rnd(5) }, seg).join('/') + (rnd(2) ? '?' + pick(['page=2', 'ref=main']) : ''),
    gitObject: () => '.git/objects/' + from(HEX, 2) + '/' + from(HEX, 38),
    namedPath: () => pick(['pass' + 'word', 'tok' + 'en', 'api_' + 'key', 'sec' + 'ret', 'credentials']) + pick(['=', ': ']) + pick(['keys/server_2026.pem', './secrets/db.txt', '/run/secrets/db', '~/.aws/credentials', 'C:\\keys\\a.pem', 'src/config/' + word(), 'config2025/aws.json', '$HOME/.netrc']),
    base64: () => from(B64, 20 + rnd(200)) + pick(['', '=', '==']),
    wrappedBase64: () => Array.from({ length: 2 + rnd(4) }, () => from(B64, 76)).join(pick(['\n', '\r\n'])),
    base64url: () => from(B64U, 20 + rnd(200)),
    dataUri: () => 'data:image/png;base64,' + from(B64, 40 + rnd(300)) + '==',
  };
  const newly: Record<string, number> = {}, total: Record<string, number> = {};
  for (const [c, g] of Object.entries(CLASSES)) for (let i = 0; i < 1500; i++) {
    const t = g(); total[c] = (total[c] || 0) + 1;
    for (const m of Object.values(MASKS)) if (m(t) !== off(() => m(t))) { newly[c] = (newly[c] || 0) + 1; break; }
  }
  // the one class FR-198 hides on purpose (listed in the spec): after a secret name, a first folder that reads as a key (mixed case and a digit, long hex,
  // or 4 to 7 characters with a letter and a digit after a short name); generated here so it is counted, never left to chance
  const LISTED: Record<string, () => string> = {
    namedKeyFolder: () => pick(['tok' + 'en', 'api_' + 'key', 'sec' + 'ret', 'pass' + 'word']) + '=' + pick([from(UP, 2) + from(LOW, 4) + from(DIG, 2), from(LOW, 3) + from(UP, 3) + from(DIG, 3), from(HEX, 16 + rnd(8)).replace(/^[0-9]/, 'a') + '1']) + '/' + file(),
  };
  for (const [c, g] of Object.entries(LISTED)) for (let i = 0; i < 500; i++) {
    const t = g(); total[c] = (total[c] || 0) + 1;
    for (const m of Object.values(MASKS)) if (m(t) !== off(() => m(t))) { newly[c] = (newly[c] || 0) + 1; break; }
  }
  console.log(`test-mask-paths: harmless texts newly changed per class ${JSON.stringify(newly)} of ${JSON.stringify(total)}`);
  for (const c of Object.keys(CLASSES)) eq(newly[c] || 0, 0, `T492 differential: no ${c} text is newly hidden (0)`);
  eq(Object.values(newly).reduce((x, y) => x + y, 0), Object.keys(LISTED).reduce((x, c) => x + (newly[c] || 0), 0), 'T492 differential: the total newly hidden equals the listed class');
}

// 4. work: the new boundaries are bounded look-arounds and the segment pass is anchored at a name; their adversarial runs are in
// `test-redact-growth.ts` (`path*` and `namedSegment*` units, CPU time on 1/16 of the input and on all of it, limit 40x).

console.log(`test-mask-paths: ${n} asserts passed`);
