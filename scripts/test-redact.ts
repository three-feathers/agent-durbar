/** Unit test for secret redaction and the debug sink (spec 012 T051): `npm run test:runtime`. */
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { REDACT_MAX_CHARS, createDebugSink, redact } from '../src/shared/redact';

const GH = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const env = {
  GH_TOKEN: GH, // by name
  MY_API_KEY: 'abcd1234efgh', // by name, short value
  SOME_RANDOM_THING: 'zzzz-0123456789-qqqq-long', // by length only
  SHORT_TOKEN: 'abc', // too short to be a secret
  PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin', // long but excluded
  HOME: '/Users/somebody/very/long/home/directory',
  SPACED: 'this value is long but has spaces in it',
};

// 1. env values by name and by length are gone; excluded names stay
{
  const out = redact(`a ${GH} b ${env.MY_API_KEY} c ${env.SOME_RANDOM_THING} d ${env.SHORT_TOKEN} e ${env.PATH} f ${env.HOME} g ${env.SPACED}`, env);
  assert.ok(!out.includes(GH), 'env: GH_TOKEN value removed');
  assert.ok(out.includes('[redacted:GH_TOKEN]'), 'env: placeholder names the variable');
  assert.ok(!out.includes('abcd1234efgh'), 'env: *_KEY value removed');
  assert.ok(!out.includes(env.SOME_RANDOM_THING), 'env: 20+ char value removed whatever its name');
  assert.ok(out.includes('abc'), 'env: value of 3 chars is kept');
  assert.ok(out.includes(env.PATH) && out.includes(env.HOME), 'env: PATH and HOME are not redacted by length');
  assert.ok(out.includes(env.SPACED), 'env: long value with spaces is kept');
}

// 2. longest first
{
  const e = { A_TOKEN: 'secretvalue', B_TOKEN: 'secretvalue-extended-tail' };
  const out = redact('x secretvalue-extended-tail y', e);
  assert.ok(!out.includes('extended') && !out.includes('tail'), 'overlap: longer value replaced whole, no tail leaks');
  assert.strictEqual(out, 'x [redacted:B_TOKEN] y', 'overlap: exact output');
}

// 3. patterns
const planted: Record<string, string> = {
  ghp: 'ghp_' + 'x'.repeat(36),
  gho: 'gho_' + 'Y'.repeat(30),
  github_pat: 'github_pat_' + '11ABCDEFG0abcdefghij_' + 'z'.repeat(30),
  sk: 'sk-' + 'a1B2'.repeat(10),
  skant: 'sk-ant-api03-' + 'Q9w8'.repeat(10),
  bearer: 'Bearer abcdef1234567890.token-value',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpMeJf36',
  aws: 'AKIA' + 'ABCDEFGH12345678',
  authHeader: 'Authorization: Basic dXNlcjpwYXNzd29yZA==',
  urlCreds: 'https://alice:hunter2pass@example.com/repo.git',
};
for (const [k, v] of Object.entries(planted)) {
  const out = redact(`before ${v} after`, {});
  assert.ok(out.includes('[redacted'), `pattern ${k}: redacted`);
  const secretPart = k === 'urlCreds' ? 'hunter2pass' : k === 'authHeader' ? 'dXNlcjpwYXNzd29yZA' : k === 'bearer' ? 'abcdef1234567890' : v.slice(-12);
  assert.ok(!out.includes(secretPart), `pattern ${k}: secret part gone (${out})`);
  assert.ok(out.startsWith('before ') && out.endsWith(' after') || k === 'authHeader', `pattern ${k}: surroundings kept`);
}
assert.strictEqual(redact('git clone https://alice:hunter2pass@example.com/r.git', {}), 'git clone https://[redacted]@example.com/r.git', 'url creds: host kept');

// 4. near misses stay intact
for (const ok of ['risk-management and task-list', 'sk-short', 'the sk- prefix', 'ghp', 'ghp_short', 'AKIA123', 'v1.2.3', 'file.name.ext', 'https://example.com/a:b', 'user@example.com', 'Bearer', 'a Bearer of news', 'eyJ.a.b']) {
  assert.strictEqual(redact(ok, {}), ok, `near miss kept: ${ok}`);
}

// 5. line structure
assert.strictEqual(redact(`l1\n${planted.ghp}\r\nl3\n`, {}), 'l1\n[redacted]\r\nl3\n', 'line structure kept');

// 6. 1 MB input is fast, and capped
{
  const big = ('word '.repeat(19) + 'sk-' + 'a'.repeat(10) + '\n').repeat(12000); // > 1 MB
  assert.ok(big.length > REDACT_MAX_CHARS);
  const t = Date.now();
  const out = redact(big, env);
  const ms = Date.now() - t;
  assert.ok(ms < 1500, `1 MB redaction took ${ms} ms`);
  assert.ok(out.length <= REDACT_MAX_CHARS + 20, 'input capped at 1 MB');
  const pathological = 'a'.repeat(REDACT_MAX_CHARS);
  const t2 = Date.now();
  redact(pathological + ':' + pathological, env);
  assert.ok(Date.now() - t2 < 1500, 'pathological single token is fast');
}

// 7. never throws
for (const bad of [null, undefined, 42, {}, [], Symbol('x'), { toString() { throw new Error('boom'); } }]) {
  assert.doesNotThrow(() => redact(bad as unknown as string, env), `no throw on ${String(typeof bad)}`);
}
assert.strictEqual(redact(null as unknown as string, env), '');
assert.doesNotThrow(() => redact('x', null as unknown as Record<string, string>));

// 8. end to end through the real debug sink (JSON-encoded records, escaped values too)
{
  const lines: string[] = [];
  const trickyEnv = { GH_TOKEN: GH, COPILOT_X_SECRET: 'with"quote\\and-more' };
  const write = createDebugSink('/dev/null/events.jsonl', trickyEnv, (_f, data) => lines.push(data));
  write({ t: 1, debug: `runtime failed, env GH_TOKEN=${GH}` });
  write({ t: 2, event: { type: 'error', message: `bad ${trickyEnv.COPILOT_X_SECRET} and ${planted.sk}` } });
  write({ t: 3, debug: 'plain line' });
  const all = lines.join('');
  assert.ok(!all.includes(GH), 'sink: planted GH_TOKEN never written');
  assert.ok(!all.includes('with\\"quote'), 'sink: JSON-escaped env value never written');
  assert.ok(!all.includes(planted.sk), 'sink: key pattern never written');
  assert.strictEqual(lines.length, 3);
  assert.ok(lines.every((l) => l.endsWith('\n') && JSON.parse(l)), 'sink: one valid JSON line per record');
  assert.strictEqual(JSON.parse(lines[2]).debug, 'plain line', 'sink: clean records unchanged');
  assert.doesNotThrow(() => write(undefined), 'sink: undefined record');
  const circ: Record<string, unknown> = {}; circ.self = circ;
  assert.doesNotThrow(() => write(circ), 'sink: circular record');
}

// 9. adversarial 1 MB inputs: every pattern stays linear (each under a time limit)
{
  const MB = 1_000_000;
  const adversarial: Record<string, string> = {
    jwtDash: 'eyJ-'.repeat(MB / 4),
    jwtDot: 'eyJa.'.repeat(MB / 5),
    jwtLong: 'eyJ' + 'a'.repeat(MB),
    sk: 'sk-'.repeat(MB / 3),
    url: 'a://x:'.repeat(MB / 6),
    urlLong: 'a://x:' + 'y'.repeat(MB),
    gh: 'ghp_'.repeat(MB / 4),
    ghLong: 'github_pat_' + 'a'.repeat(MB),
    bearer: 'Bearer '.repeat(MB / 7),
    bearerSpaces: 'Bearer' + ' '.repeat(MB),
    auth: 'authorization '.repeat(MB / 14),
    authSpaces: 'authorization' + ' '.repeat(MB),
    tid: 'tid=0123abcd;'.repeat(MB / 12),
    tidLong: 'tid=0123abcd;' + 'a;'.repeat(MB / 2),
    aws: 'AKIA'.repeat(MB / 4),
    awsLong: 'ASIA' + 'A'.repeat(MB),
  };
  // Each case runs in a child process with a hard timeout, so a catastrophic regex fails the test instead of hanging it.
  const mod = require.resolve('../src/shared/redact');
  for (const [k, v] of Object.entries(adversarial)) {
    const t = Date.now();
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(mod)}).redact(require('fs').readFileSync(0, 'utf8'), {})`], { input: v, timeout: 5000, maxBuffer: 1 << 20 });
    assert.ok(!r.error && r.status === 0, `adversarial ${k}: did not finish in 5 s (${r.error ? r.error.message : 'status ' + r.status})`);
    assert.ok(Date.now() - t < 5000, `adversarial ${k}: too slow`);
  }
}

// 10. the cap never leaks part of a secret, and the sink always writes one valid JSON line
{
  const secret = 'ghp_' + 'S3cr3t'.repeat(8);
  const half = secret.length / 2;
  for (const shift of [0, 1, half, secret.length - 1]) {
    // key-like secret straddling the cut
    const pre = 'x '.repeat((REDACT_MAX_CHARS - shift) / 2);
    const out = redact(pre + secret + ' tail', {});
    assert.ok(!out.includes('S3cr3t') && !/ghp_/.test(out), `cut straddling pattern secret (shift ${shift})`);
    assert.ok(!out.includes('\n'), 'truncation marker has no newline');
    // env secret straddling the cut: replaced before the cut
    const envOut = redact(pre + 'ZZ' + 'q9w8e7r6t5y4'.repeat(2) + ' tail', { MY_TOKEN: 'q9w8e7r6t5y4'.repeat(2) });
    assert.ok(!envOut.includes('q9w8') && !envOut.includes('t5y4'), `cut straddling env secret (shift ${shift})`);
  }
  // env secret with characters outside the token class, across the cut: no prefix of it may remain
  const odd = 'ab!cd*ef-gh!ij*kl-mn!op*qr-st!uv*wx';
  for (let shift = 1; shift < odd.length; shift += 4) {
    const pre = 'x '.repeat((REDACT_MAX_CHARS - shift) / 2) + (shift % 2 ? 'x' : '');
    const out = redact(pre.slice(0, REDACT_MAX_CHARS - shift) + odd + ' tail', { MY_TOKEN: odd });
    for (let k = 3; k <= odd.length; k++) assert.ok(!out.includes(odd.slice(0, k)), `cut straddling non-token-char env secret: prefix of ${k} chars remains (shift ${shift})`);
  }
  assert.ok(redact('a'.repeat(REDACT_MAX_CHARS + 10), {}).endsWith(' [truncated]'));
  const lines: string[] = [];
  const write = createDebugSink('f', { GH_TOKEN: GH }, (_f, d) => lines.push(d));
  write({ t: 1, debug: ('line\n' + GH + ' ').repeat(200000) });
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].split('\n').length, 2, 'oversized record is one line');
  const parsed = JSON.parse(lines[0]);
  assert.strictEqual(parsed.truncated, true);
  assert.ok(!lines[0].includes(GH), 'oversized record has no token');
}

// 10b. Copilot API session token, and more length-rule exclusions
{
  const tok = 'tid=0a1b2c3d4e5f;exp=1760000000;sku=free_limited;proxy-ep=proxy.individual.example.com;st=dotcom:9f8e7d6c5b4a39281706f5e4d3c2b1a0';
  assert.strictEqual(redact(tok, {}), '[redacted]', 'copilot token: bare');
  const msg = redact(`request failed: invalid token ${tok} (status 401)`, {});
  assert.ok(!msg.includes('9f8e7d6c') && !msg.includes('proxy-ep') && msg.startsWith('request failed: invalid token [redacted]'), 'copilot token: inside an error message');
  for (const ok of ['tid=abc', 'set tid=abc; then go', 'the tid=12345678 field']) assert.strictEqual(redact(ok, {}), ok, `copilot token near miss kept: ${ok}`);
  const p = '/Users/somebody/projects/some/long/workspace/path';
  const e = { VSCODE_CWD: p, TERM_SESSION_ID: 'w0t0p0:0123456789-ABCDEF-0123', XPC_SERVICE_NAME: 'application.com.example.long.name.1', TERM_PROGRAM_VERSION: '1.2.3.4.5.6.7.8.9.10.11.12', ITERM_PROFILE: 'a-long-profile-name-here', COLORTERM: 'truecolor-24bit-very-long' };
  const text = Object.values(e).join(' | ');
  assert.strictEqual(redact(text, e), text, 'terminal/editor variables stay readable');
}

// 11. URL credentials do not run across JSON fields
assert.strictEqual(redact('{"a":"https://x","b":"y@z"}', {}), '{"a":"https://x","b":"y@z"}', 'url creds: no match across JSON fields');
assert.strictEqual(redact('{"a":"https://u:p@h/x","b":"y"}', {}), '{"a":"https://[redacted]@h/x","b":"y"}');

// 12. encoded forms of env secrets
{
  const e = { MY_SECRET: 'p@ss w/ord"x\\y&z=1' };
  const raw = e.MY_SECRET;
  const forms: Record<string, string> = {
    raw,
    json: JSON.stringify(raw).slice(1, -1),
    jsonTwice: JSON.stringify(JSON.stringify(raw).slice(1, -1)).slice(1, -1),
    urlEncoded: encodeURIComponent(raw),
  };
  for (const [k, f] of Object.entries(forms)) {
    const out = redact(`before ${f} after`, e);
    assert.strictEqual(out, 'before [redacted:MY_SECRET] after', `encoded form ${k}`);
  }
}

// 13. more length-rule exclusions, and no process global
{
  const long = '/some/long/path/that/is/not/a/secret/at/all';
  const out = redact(long, { INIT_CWD: long, _: long, SSL_CERT_FILE: long, JAVA_HOME: long, ONEDRIVE: long, ALLUSERSPROFILE: long, __CFBundleIdentifier: long });
  assert.strictEqual(out, long, 'excluded names stay');
  assert.ok(!redact(long, { OneDriveCommercial_TOKEN: long }).includes('/some'), 'name rule still applies');
  const g = globalThis as { process?: unknown };
  const saved = g.process;
  g.process = undefined;
  try { assert.doesNotThrow(() => redact('x')); } finally { g.process = saved; }
}

console.log('redact: all checks passed');
