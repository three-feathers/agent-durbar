/**
 * Spec 080 T011: the session browser's address parsing (FR-005), link kinds (FR-024 "Other apps") and the view navigation
 * predicate (FR-024). `npm run test:browserurl`. No network, no credits.
 */
import * as assert from 'assert';
import { BROWSER_URL_MAX, classifyLink, hostOf, isLoopbackHost, loopbackOfAddress, parseAddress } from '../src/shared/browserurl';
import { navigationAllowed, SIM_VIEW_SCHEME, viewNavigationAllowed } from '../src/main/hardening';

const url = (s: string): string => {
  const r = parseAddress(s);
  assert.ok(r.ok, `${JSON.stringify(s)} should parse`);
  return (r as { url: string }).url;
};
const refused = (s: unknown): string => {
  const r = parseAddress(s);
  assert.ok(!r.ok, `${JSON.stringify(s)} should be refused`);
  return (r as { reason: string }).reason;
};

// AC1: bare hosts
assert.strictEqual(url('localhost:3000'), 'http://localhost:3000/');
assert.strictEqual(url('127.0.0.1:8080'), 'http://127.0.0.1:8080/');
assert.strictEqual(url('[::1]:5173/app'), 'http://[::1]:5173/app');
assert.strictEqual(url('0.0.0.0:80'), 'http://0.0.0.0/');
assert.strictEqual(url('app.localhost:3000'), 'http://app.localhost:3000/');
assert.strictEqual(url('example.com'), 'https://example.com/');
assert.strictEqual(url('  example.com/a?b=1#c  '), 'https://example.com/a?b=1#c');
assert.strictEqual(url('127.evil.com'), 'https://127.evil.com/', '127.* as a name is not loopback');
assert.strictEqual(url('https://example.com'), 'https://example.com/');
assert.strictEqual(url('HTTP://Example.com:81/x'), 'http://example.com:81/x');
refused('localhost:99999');

// AC2: schemes in the address field
for (const bad of ['file:///etc/passwd', 'chrome://settings', 'devtools://devtools/bundled/x.html', 'view-source:https://a.com', 'javascript:alert(1)', 'data:text/html,hi', 'blob:https://a.com/x', 'filesystem:https://a.com/x', 'about:blank', 'ftp://example.com', 'vscode://file/x', 'mailto:a@b.c', 'JAVASCRIPT:alert(1)']) refused(bad);

// AC3: the hostile list gets no offer; only mailto: does
const HOSTILE = ['ms-msdt:/id PCWDiagnostic', 'search-ms:query=x', 'search:query=x', 'ms-officecmd:{}', 'ms-settings:network', 'smb://host/share', 'file:///C:/Windows/System32/calc.exe', 'vscode://file/etc/passwd', 'slack://open', 'tel:+123456'];
for (const h of HOSTILE) {
  for (const v of [h, h.toUpperCase(), h[0].toUpperCase() + h.slice(1), '   ' + h, '\t' + h, h.replace(':', '\n:')]) {
    assert.strictEqual(classifyLink(v), 'refused', `link ${JSON.stringify(v)} gets no offer`);
    refused(v);
  }
}
assert.strictEqual(classifyLink('mailto:a@b.co'), 'mailto');
assert.strictEqual(classifyLink('MailTo:a@b.co'), 'mailto');
assert.strictEqual(classifyLink('https://a.com'), 'web');
assert.strictEqual(classifyLink('nonsense'), 'refused');
assert.strictEqual(classifyLink(42), 'refused');
assert.strictEqual(classifyLink('java\tscript:alert(1)'), 'refused');

// AC4: long text and text with spaces: refused, never searched
assert.match(refused('x'.repeat(BROWSER_URL_MAX + 1)), /too long/);
assert.ok(parseAddress('a.com/' + 'x'.repeat(BROWSER_URL_MAX - 6)).ok, 'exactly the limit is fine');
refused('how do I cook rice');
refused('example.com foo');
refused('https://example.com/a b');
refused('   ');
refused('');
refused(null);
refused({});
refused('exa\u0000mple.com');

// AC5: the host is the URL's hostname, userinfo dropped
assert.strictEqual(hostOf('https://user:pw@example.com:8443/x'), 'example.com');
assert.strictEqual(hostOf('http://localhost@evil.com/'), 'evil.com', 'userinfo is not the host');
assert.strictEqual(hostOf('http://EXAMPLE.com./'), 'example.com.');
assert.strictEqual(hostOf('http://[::1]:80/'), '[::1]');
assert.strictEqual(hostOf('not a url'), '');
// a raw "host" split on / or : would give "localhost" here
// userinfo is refused (Paco, review of PR 682): the text before the @ looks like the host and the password would reach history
for (const bad of ['http://localhost:80@evil.com:81/', 'https://user:pw@example.com', 'https://google.com@evil.com', 'user:pw@example.com', 'google.com@evil.com', 'https://@a.com']) assert.match(refused(bad), /user name or password|not a web address|Only http/, bad);
for (const bad of ['http://localhost:80@evil.com:81/', 'https://user:pw@example.com', 'https://google.com@evil.com', 'https://@a.com']) assert.strictEqual(refused(bad), 'Addresses with a user name or password are not supported.', `reason for ${bad}`);
assert.strictEqual(hostOf(url('https://a.com\\@evil.com')), 'a.com', 'a backslash ends the host, so this loads a.com');
assert.ok(parseAddress('https://a.com/path@x').ok, '@ in the path is fine');
assert.ok(parseAddress('https://a.com/?u=a@b.c').ok, '@ in the query is fine');
// control characters in an otherwise good address (the whitespace check does not see them)
for (const c of ['\x01', '\x7f', '\x1f']) { refused('https://a.com/' + c); refused('a.com' + c); refused('https://a.com/x' + c + 'y'); }
// mistyped web schemes are "not an address", not "other scheme"
for (const bad of ['http:example.com', 'https:/example.com', 'HTTP:example.com', 'https:example.com/x']) assert.match(refused(bad), /not a web address/, bad);

// FR-024 predicate: main frame
const main = (u: string): boolean => viewNavigationAllowed(u, true);
const sub = (u: string): boolean => viewNavigationAllowed(u, false);
for (const ok of ['http://a.com/', 'https://a.com/x?y#z', 'about:blank', 'HTTPS://A.COM']) assert.ok(main(ok), `main allows ${ok}`);
for (const no of ['data:text/html,hi', 'blob:https://a.com/uuid', 'about:srcdoc', 'about:blank?x', 'about:foo', 'file:///etc/passwd', 'chrome://settings', 'devtools://devtools/x', 'view-source:https://a.com', 'filesystem:https://a.com/x', 'javascript:alert(1)', 'vscode://x', 'mailto:a@b.c', 'ms-msdt:x', 'not a url', '', 'javascript:alert(1)//http://a.com']) assert.ok(!main(no), `main refuses ${no}`);
// subframes
for (const ok of ['http://a.com/', 'https://a.com/', 'about:blank', 'about:srcdoc', 'blob:https://a.com/uuid', 'data:text/html,hi']) assert.ok(sub(ok), `subframe allows ${ok}`);
for (const no of ['file:///etc/passwd', 'chrome://settings', 'devtools://x', 'view-source:https://a.com', 'filesystem:https://a.com/x', 'javascript:alert(1)', 'vscode://x', 'ms-msdt:x', 'about:foo', '']) assert.ok(!sub(no), `subframe refuses ${no}`);
// the simulator's test scheme (FR-091): only with `sim`, only the one exported scheme, only in the main frame
assert.strictEqual(SIM_VIEW_SCHEME, 'durbar-sim:');
assert.ok(!viewNavigationAllowed('durbar-sim://page/', true));
assert.ok(viewNavigationAllowed('durbar-sim://page/', true, true));
assert.ok(!viewNavigationAllowed('durbar-sim://page/', false, true));
assert.ok(!viewNavigationAllowed('other-sim://page/', true, true), 'sim does not widen the main frame to any other scheme');
assert.ok(!viewNavigationAllowed('file:///etc/passwd', true, true));
assert.ok(!viewNavigationAllowed('data:text/html,x', true, true));
// about: is compared as given: fail closed on anything but the exact strings
for (const no of ['about:blank#x', 'about:blank?x', 'ABOUT:BLANK', 'About:Blank', ' about:blank', 'about:blank ']) assert.ok(!main(no), `main refuses ${JSON.stringify(no)}`);
for (const no of ['about:srcdoc#x', 'ABOUT:SRCDOC', 'about:blank#x']) assert.ok(!sub(no), `subframe refuses ${JSON.stringify(no)}`);

// loopback: the input is a URL.hostname; raw text goes through loopbackOfAddress
for (const h of ['localhost', 'localhost.', 'a.localhost', 'a.localhost.', '127.0.0.1', '127.255.255.254', '[::1]', '::1', '[::]', '::', '0.0.0.0', '[::ffff:7f00:1]', '[::ffff:7fff:ffff]']) assert.ok(isLoopbackHost(h), `${h} is loopback`);
for (const h of ['example.com', 'localhost.evil.com', 'notlocalhost', '128.0.0.1', '126.255.255.255', '[::ffff:8000:1]', '[::ffff:7e00:1]', '[::2]', '10.0.0.1', '']) assert.ok(!isLoopbackHost(h), `${h} is not loopback`);
for (const raw of ['127.1', '2130706433', '0x7f000001', '[0:0:0:0:0:0:0:1]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]:80', 'localhost.:3000', '0', '[::]:80', '127.0.0.1:8/x']) assert.ok(loopbackOfAddress(raw), `raw ${raw} is loopback`);
for (const raw of ['example.com', '128.0.0.1', '', '1.2.3.4:80']) assert.ok(!loopbackOfAddress(raw), `raw ${raw} is not loopback`);
assert.strictEqual(url('localhost.:3000'), 'http://localhost.:3000/');
assert.strictEqual(url('a.localhost.:3000'), 'http://a.localhost.:3000/');
assert.strictEqual(url('127.1'), 'http://127.0.0.1/');
assert.strictEqual(url('2130706433'), 'http://127.0.0.1/');
assert.strictEqual(url('0x7f000001:81'), 'http://127.0.0.1:81/');
assert.strictEqual(url('[0:0:0:0:0:0:0:1]:80'), 'http://[::1]/');
assert.strictEqual(url('[::ffff:127.0.0.1]:8080'), 'http://[::ffff:7f00:1]:8080/');
assert.strictEqual(url('[::]:80'), 'http://[::]/');
assert.strictEqual(url('0:80'), 'http://0.0.0.0/');

// host shape and reasons
for (const bad of ['.', '..', 'a..b', '-a.com', 'a-.com', 'a.com..', '.a.com', 'http://.', 'http://a..b/', 'http://-a.com/']) refused(bad);
assert.strictEqual(url('a.com.'), 'https://a.com./', 'one trailing dot is fine');
assert.strictEqual(url('пример.рф'), 'https://xn--e1afmkfd.xn--p1ai/');
assert.strictEqual(url('пример.рф:8443/путь'), 'https://xn--e1afmkfd.xn--p1ai:8443/%D0%BF%D1%83%D1%82%D1%8C');
assert.strictEqual(url('bücher.de'), 'https://xn--bcher-kva.de/');
assert.match(refused('a@b.com'), /not a web address/);
assert.match(refused('user:pw@example.com'), /Only http/);
assert.match(refused('a b'), /not a web address/);
assert.match(refused('javascript:alert(1)'), /Only http/);
assert.match(refused('ftp://example.com'), /Only http/);
assert.match(refused('localhost:99999'), /not a web address/);
assert.match(refused('?x'), /not a web address/);
assert.match(refused('..'), /not a web address/);

// classifyLink: control characters and tricks
assert.strictEqual(classifyLink('mail\tto:a@b.c'), 'refused', 'a tab inside the scheme');
assert.strictEqual(classifyLink('mailto:a@b.c\x00'), 'refused', 'a NUL at the end');
assert.strictEqual(classifyLink('mailto:a@b.c\n'), 'mailto', 'trailing newline is trimmed, not a control char inside');
assert.strictEqual(classifyLink('mai\nlto:a@b.c'), 'refused');
assert.strictEqual(classifyLink('\x01mailto:a@b.c'), 'refused');
assert.strictEqual(classifyLink('http://a.com/\x7f'), 'refused');
assert.strictEqual(classifyLink('x'.repeat(4097)), 'refused');
assert.strictEqual(classifyLink(''), 'refused');
// the app window's own rule is unchanged: a web page is never the app's page
assert.ok(!navigationAllowed('https://a.com/', '/x/index.html', 'linux'));

// AC6: linear time (CPU time, docs/agent-notes.md "Timing checks"): 8x the input, far less than 64x the time
const cpuMs = (f: () => void): number => {
  const c = process.cpuUsage();
  f();
  const d = process.cpuUsage(c);
  return (d.user + d.system) / 1000;
};
const everything = (s: string): void => {
  parseAddress(s);
  classifyLink(s);
  hostOf(s);
  viewNavigationAllowed(s, true);
  viewNavigationAllowed(s, false);
};
const MB = 1024 * 1024;
const shapes: Array<[string, (n: number) => string]> = [
  ['letters', (n) => 'a'.repeat(n)],
  ['dots', (n) => 'a.'.repeat(n / 2)],
  ['spaces then text', (n) => ' '.repeat(n - 1) + 'x'],
  ['text then spaces', (n) => 'x' + ' '.repeat(n - 1)],
  ['scheme-like', (n) => 'a:'.repeat(n / 2)],
  ['colons', (n) => ':'.repeat(n)],
  ['url', (n) => 'https://a.com/' + 'x'.repeat(n)],
  ['userinfo', (n) => 'http://' + '@'.repeat(n)],
];
for (const [name, make] of shapes) {
  const small = make(MB / 8);
  const big = make(MB);
  assert.strictEqual(big.length >= MB - 2, true);
  const best = (s: string): number => Math.min(...[0, 1, 2].map(() => cpuMs(() => everything(s))));
  const t1 = Math.max(best(small), 20);
  const t8 = best(big);
  assert.ok(t8 < 1000, `${name}: 1 MB took ${t8.toFixed(1)} ms CPU`);
  assert.ok(t8 < t1 * 24, `${name}: 8x the input took ${(t8 / t1).toFixed(1)}x the time (${t1.toFixed(1)} -> ${t8.toFixed(1)} ms): not linear`);
}
// backtracking: an exponential pattern needs a short input to show, so test it at a small length with a CPU limit (a bad pattern fails
// here in about a second instead of hanging the suite). Shapes that fail at the very end force a regex to retry every split.
for (const make of [(n: number) => 'a'.repeat(n - 1) + '!', (n: number) => 'a.'.repeat(n / 2 - 1) + 'a!', (n: number) => 'a-'.repeat(n / 2 - 1) + 'a!', (n: number) => 'a'.repeat(n - 1) + '\u0301!']) {
  const x = make(26);
  const ms = cpuMs(() => { for (let i = 0; i < 5; i++) everything(x); });
  assert.ok(ms < 150, `${JSON.stringify(x)}: ${ms.toFixed(1)} ms CPU at 26 characters (exponential backtracking?)`);
}

// the work that runs below the cap (the 1 MB inputs above are cut off by the length check): the same number of calls at a small and a big
// size, so linear gives a CPU ratio near the size step and quadratic near its square. CPU timers tick in about 15.6 ms on Windows: repeat
// the small input until it costs about 40 ms (several ticks), then run the same count on the big one; no floor that skips the check.
// The four shapes that catch distinct mutants run with an 8x step and limit 16; the others with a 4x step and limit 10 (cheaper).
{
  const run = (s: string, n: number): number => cpuMs(() => { for (let i = 0; i < n; i++) everything(s); });
  const best = (s: string, n: number): number => Math.min(run(s, n), run(s, n), run(s, n));
  const check = (name: string, make: (n: number) => string, small: number, big: number, limit: number): void => {
    const a = make(small);
    const b = make(big);
    assert.ok(b.length <= BROWSER_URL_MAX, `${name}: under the cap`);
    let n = 50;
    while (run(a, n) < 40 && n < 5_000_000) n *= 2;
    const tSmall = best(a, n);
    const tBig = best(b, n);
    assert.ok(tSmall > 0, `${name}: the small run must register CPU time (n=${n})`);
    assert.ok(tBig < tSmall * limit, `${name}: ${big / small}x the input took ${(tBig / tSmall).toFixed(1)}x the time (${tSmall.toFixed(1)} -> ${tBig.toFixed(1)} ms): not linear`);
  };
  const eight: Array<[string, (n: number) => string]> = [
    ['blanks inside', (n) => 'x' + ' '.repeat(n - 2) + 'x'],
    ['at signs', (n) => 'http://' + '@'.repeat(n - 7)],
    ['percent', (n) => 'a.com/' + '%41'.repeat((n - 6) / 3)],
    ['non-ASCII', (n) => 'ü'.repeat(n)],
  ];
  const four: Array<[string, (n: number) => string]> = [
    ['blanks then y', (n) => 'x' + ' '.repeat(n - 2) + 'y'],
    ['blanks edges', (n) => ' '.repeat(n / 2) + 'x' + ' '.repeat(n / 2 - 1)],
    ['dots', (n) => 'a.'.repeat(n / 2)],
    ['colons', (n) => 'a' + ':'.repeat(n - 1)],
    ['slashes', (n) => 'a.com/' + '/'.repeat(n - 6)],
    ['letters', (n) => 'a'.repeat(n)],
    ['letters then bang', (n) => 'a'.repeat(n - 1) + '!'],
    ['dotted letters then bang', (n) => 'a.'.repeat(n / 2 - 1) + 'a!'],
  ];
  for (const [name, make] of eight) check(name, make, 256, BROWSER_URL_MAX - 2, 16);
  for (const [name, make] of four) check(name, make, 512, BROWSER_URL_MAX - 2, 10);
}

console.log('browserurl: ok');
