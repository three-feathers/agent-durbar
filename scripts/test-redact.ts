/** Unit test for secret redaction and the debug sink (spec 012 T051): `npm run test:runtime`. */
import * as assert from 'assert';
import { Worker } from 'worker_threads';
import { REDACT_MAX_CHARS, createDebugSink, maskSecretArgs, maskSecretCommand, maskSecretUrl, redact, splitCommand } from '../src/shared/redact';

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
  // Each case runs in a worker thread that times redact() itself, so a busy runner cannot fail the test; the 1 s assertion is the
  // real ReDoS check. Workers, not child processes: a child fed 1 MB on stdin hung for 30 s twice on a busy macOS runner (#303).
  // The test stays synchronous: the worker writes the time into shared memory and wakes this thread (Atomics), with a 30 s hang
  // guard; a worker that does not answer in time is stopped and the case retried once.
  const mod = require.resolve('../src/shared/redact');
  const code = `const {workerData:w}=require('worker_threads');const flag=new Int32Array(w.sab,0,1),out=new Float64Array(w.sab,8,1);` +
    `try{const {redact}=require(w.mod);const t=process.hrtime.bigint();redact(w.input,{});out[0]=Number(process.hrtime.bigint()-t)/1e6;Atomics.store(flag,0,1)}` +
    `catch(e){Atomics.store(flag,0,2)}Atomics.notify(flag,0)`;
  for (const [k, v] of Object.entries(adversarial)) {
    let ms = NaN;
    let why = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const sab = new SharedArrayBuffer(16);
      const flag = new Int32Array(sab, 0, 1);
      const worker = new Worker(code, { eval: true, workerData: { mod, input: v, sab } });
      const waited = Atomics.wait(flag, 0, 0, 30000);
      void worker.terminate();
      if (waited === 'timed-out') { why = 'no answer in 30 s'; continue; }
      assert.strictEqual(Atomics.load(flag, 0), 1, `adversarial ${k}: redact() threw in the worker`);
      ms = new Float64Array(sab, 8, 1)[0];
      break;
    }
    assert.ok(!Number.isNaN(ms), `adversarial ${k}: worker hung twice (${why})`);
    assert.ok(ms < 1000, `adversarial ${k}: redact() took ${ms.toFixed(1)} ms, limit 1000 ms`);
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

// 14. maskSecretArgs / maskSecretUrl (spec 041 FR-053)
{
  const SEC = 'sEcReT-value-1234567';
  assert.deepStrictEqual(maskSecretArgs(['--token', SEC, '--key', SEC, '--secret', SEC, '--password', SEC, '--auth', SEC, '--api-key', SEC, '--verbose']),
    ['--token', '[redacted]', '--key', '[redacted]', '--secret', '[redacted]', '--password', '[redacted]', '--auth', '[redacted]', '--api-key', '[redacted]', '--verbose'], 'value after a secret flag');
  assert.deepStrictEqual(maskSecretArgs(['--token=' + SEC, '--api-key=' + SEC, '--access_token=' + SEC, '--name=' + SEC]), ['--token=[redacted]', '--api-key=[redacted]', '--access_token=[redacted]', '--name=' + SEC], '--flag=value, only for secret-looking flags');
  assert.deepStrictEqual(maskSecretArgs(['--TOKEN', SEC, '--Access-Token', SEC]), ['--TOKEN', '[redacted]', '--Access-Token', '[redacted]'], 'case does not matter');
  assert.deepStrictEqual(maskSecretArgs(['--token', '--verbose', 'plain']), ['--token', '--verbose', 'plain'], 'a flag after a flag is not a value');
  assert.deepStrictEqual(maskSecretArgs(['--token']), ['--token'], 'a trailing flag has nothing to mask');
  assert.deepStrictEqual(maskSecretArgs(['--keyboard', 'x', '--monkey', 'y', '--path', '/a']), ['--keyboard', 'x', '--monkey', 'y', '--path', '/a'], 'only whole key words count');
  assert.deepStrictEqual(maskSecretArgs(['-y', 'server', 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4']), ['-y', 'server', '[redacted]'], 'other args still go through redact()');
  assert.ok(!maskSecretArgs(['run', SEC], { MY_TOKEN: SEC }).join(' ').includes(SEC), 'env values are redacted in args too');
  assert.deepStrictEqual(maskSecretArgs(undefined as unknown as string[]), [], 'never throws');
  const args = ['--token', SEC];
  maskSecretArgs(args);
  assert.deepStrictEqual(args, ['--token', SEC], 'the input is not changed');

  assert.strictEqual(maskSecretUrl('https://u:' + SEC + '@h.test/p?api_key=' + SEC + '&x=1#frag'), 'https://[redacted]@h.test/p?api_key=[redacted]&x=1#frag');
  assert.strictEqual(maskSecretUrl('https://h.test/a?token=' + SEC), 'https://h.test/a?token=[redacted]');
  assert.strictEqual(maskSecretUrl('https://h.test/a?page=2'), 'https://h.test/a?page=2');
  assert.strictEqual(maskSecretUrl(undefined), '');

  // review fixes: NAME=value, Name: value, more words, empty URL user, deliberate over-masking
  assert.deepStrictEqual(maskSecretArgs(['-e', 'GITHUB_TOKEN=abcdefSECRET1234', 'PORT=8080']), ['-e', 'GITHUB_TOKEN=[redacted]', 'PORT=8080'], 'NAME=value without a dash');
  assert.deepStrictEqual(maskSecretArgs(['env', 'API_KEY=x']), ['env', 'API_KEY=[redacted]']);
  assert.deepStrictEqual(maskSecretArgs(['--header', 'X-Api-Key: abc', '--header', 'Content-Type: json']), ['--header', 'X-Api-Key: [redacted]', '--header', 'Content-Type: [redacted]'], 'Name: value; header values are never shown (T053)');
  assert.deepStrictEqual(maskSecretArgs(['--header=X-Api-Key: abc', '--header=Content-Type: json', '--env=GH_TOKEN=abc']), ['--header=X-Api-Key: [redacted]', '--header=Content-Type: [redacted]', '--env=GH_TOKEN=[redacted]'], '--flag=Name: value');
  assert.deepStrictEqual(maskSecretArgs(['--pat', 'a', '--bearer', 'b', '--pwd', 'c', '--path', 'd']), ['--pat', '[redacted]', '--bearer', '[redacted]', '--pwd', '[redacted]', '--path', 'd'], 'pat, bearer, pwd are whole words');
  assert.strictEqual(maskSecretUrl('https://:' + SEC + '@h.test/p'), 'https://[redacted]@h.test/p', 'empty user');
  assert.deepStrictEqual(maskSecretArgs(['--no-auth', 'value']), ['--no-auth', '[redacted]'], 'deliberate fail-safe: over-masking beats leaking');
}

// 14b. T053 masking leaks (spec 041 `## Changes` 2026-10-19). SEC is built at run time; every output must not contain it.
{
  const SEC = 'sEc' + 'ReT-' + 'q7w8e9r0t1y2u3i4';
  const R = '[redacted]';
  const noSec = (x: unknown, what: string): void => assert.ok(!JSON.stringify(x).includes(SEC), `${what}: no secret in ${JSON.stringify(x)}`);
  const masked = (args: string[], want: string[], what: string): void => { const got = maskSecretArgs(args); assert.deepStrictEqual(got, want, what); noSec(got, what); };
  // (a) names
  for (const f of ['--privateKey', '--passphrase', '--pw', '--cookie', '--session', '--jwt', '--signature', '--sig']) masked([f, SEC], [f, R], `name ${f}`);
  assert.deepStrictEqual(maskSecretArgs(['--keyboard', 'x', '--monkey', 'y']), ['--keyboard', 'x', '--monkey', 'y']);
  assert.deepStrictEqual(maskSecretArgs(['-p', '8080']), ['-p', '8080']);
  // (b) one-arg and separator forms
  masked(['--token ' + SEC], ['--token ' + R], 'one arg');
  masked(['--token ' + SEC, 'next'], ['--token ' + R, 'next'], 'the next arg is not masked');
  masked(['--api-key ' + SEC], ['--api-key ' + R], 'api-key one arg');
  masked(['--password:' + SEC], ['--password:' + R], 'colon');
  masked(['/token', SEC], ['/token', R], 'slash flag');
  masked(['/password:' + SEC], ['/password:' + R], 'slash colon');
  assert.deepStrictEqual(maskSecretArgs(['--url=https://h.test/a?x=1']), ['--url=https://h.test/a?x=1']);
  assert.deepStrictEqual(maskSecretArgs(['--port:8080']), ['--port:8080']);
  // (c) headers
  masked(['--header=Cookie: sid=' + SEC], ['--header=Cookie: ' + R], 'header=');
  masked(['-H', 'X-Custom: ' + SEC], ['-H', 'X-Custom: ' + R], '-H');
  assert.deepStrictEqual(maskSecretArgs(['--header', 'Content-Type: json']), ['--header', 'Content-Type: ' + R]);
  masked(['Cookie: ' + SEC], ['Cookie: ' + R], 'cookie without a flag');
  assert.deepStrictEqual(maskSecretArgs(['Accept: json']), ['Accept: json']);
  // (d) structured
  masked(['{"apiKey":"' + SEC + '","port":1}'], ['{"apiKey":"' + R + '","port":1}'], 'json');
  const nested = maskSecretArgs(['--config', '{"auth":{"token":"' + SEC + '"}}']);
  noSec(nested, 'nested json');
  assert.ok(nested[1].includes(R));
  const bad = maskSecretArgs(['--config={"token":"' + SEC + '"']);
  noSec(bad, 'bad json');
  assert.ok(bad[0].includes(R));
  masked(['CONN=Server=x;Password=' + SEC + ';Database=d'], ['CONN=Server=x;Password=' + R + ';Database=d'], 'connection string');
  masked(['--conn', 'Server=x;AccountKey=' + SEC], ['--conn', 'Server=x;AccountKey=' + R], 'AccountKey');
  // (e) URL-shaped args
  noSec(maskSecretArgs(['--url', 'https://' + SEC + '@h.test/']), 'url arg');
  assert.deepStrictEqual(maskSecretArgs(['--url', 'https://' + SEC + '@h.test/']), ['--url', 'https://' + R + '@h.test/']);
  noSec(maskSecretArgs(['--endpoint=https://h.test/?sig=' + SEC]), 'endpoint');
  assert.deepStrictEqual(maskSecretArgs(['--endpoint=https://h.test/?sig=' + SEC]), ['--endpoint=https://h.test/?sig=' + R]);
  // (f) command
  assert.strictEqual(maskSecretCommand('npx srv --token ' + SEC), 'npx srv --token ' + R);
  assert.strictEqual(maskSecretCommand('node s.js --api-key=' + SEC), 'node s.js --api-key=' + R);
  assert.strictEqual(maskSecretCommand('C:\\Program Files\\nodejs\\node.exe'), 'C:\\Program Files\\nodejs\\node.exe');
  assert.strictEqual(maskSecretCommand('C:\\Program Files\\nodejs\\node.exe --token ' + SEC + ' /x'), 'C:\\Program Files\\nodejs\\node.exe --token ' + R + ' /x');
  assert.strictEqual(maskSecretCommand('npx  -y   srv'), 'npx -y srv');
  assert.strictEqual(maskSecretCommand(undefined), '');
  // (g) URLs
  assert.strictEqual(maskSecretUrl('https://rawtok123@host.test/'), 'https://' + R + '@host.test/');
  assert.strictEqual(maskSecretUrl('https://u:p@h.test/'), 'https://' + R + '@h.test/');
  assert.strictEqual(maskSecretUrl('https://registry.npmjs.org/@scope/pkg'), 'https://registry.npmjs.org/@scope/pkg');
  assert.strictEqual(maskSecretUrl('https://api.telegram.org/bot123456:' + SEC + '/sendMessage'), 'https://api.telegram.org/bot123456:' + R + '/sendMessage');
  assert.strictEqual(maskSecretUrl('https://hooks.slack.com/services/T0/B0/' + SEC), 'https://hooks.slack.com/services/T0/B0/' + R);
  assert.strictEqual(maskSecretUrl('https://discord.com/api/webhooks/42/' + SEC), 'https://discord.com/api/webhooks/42/' + R);
  for (const q of ['X-Amz-Signature', 'X-Amz-Security-Token', 'X-Goog-Signature', 'sig', '%74oken']) {
    const u = maskSecretUrl('https://h.test/p?' + q + '=' + SEC + '&page=2');
    assert.strictEqual(u, 'https://h.test/p?' + q + '=' + R + '&page=2', q);
  }
  assert.strictEqual(maskSecretUrl('https://h.test/?code=abc&page=2'), 'https://h.test/?code=abc&page=2');
  // review round 2: spaces in connection strings, JSON headers, command split, dash values, minor shapes
  masked(['--conn', 'Server=x; Password=' + SEC], ['--conn', 'Server=x; Password=' + R], 'conn with a space after ;');
  masked(['--conn', 'Server=x; Password = ' + SEC + ' ;Database=d'], ['--conn', 'Server=x; Password=' + R + ';Database=d'], 'conn with spaces around =');
  masked(['--headers', '{"X-Custom":"' + SEC + '"}'], ['--headers', '{"X-Custom":"' + R + '"}'], '--headers json');
  masked(['--header={"X-Custom":"' + SEC + '","n":5}'], ['--header={"X-Custom":"' + R + '","n":"' + R + '"}'], '--header= json');
  masked(['-H', '{"X":"' + SEC + '"'], ['-H', '{"X":"' + R + '"'], 'bad json after a header flag');
  const cmd = (c: string): string => maskSecretCommand(c);
  assert.deepStrictEqual(splitCommand('C:\\srv\\srv.exe serve token=' + SEC), ['C:\\srv\\srv.exe', 'serve', 'token=' + SEC]);
  assert.ok(!cmd('C:\\srv\\srv.exe serve token=' + SEC).includes(SEC), 'token=SEC after a drive path');
  assert.strictEqual(cmd('C:\\Program Files\\nodejs\\node.exe'), 'C:\\Program Files\\nodejs\\node.exe');
  assert.strictEqual(cmd('C:\\Program Files\\nodejs\\node.exe s.js --token ' + SEC), 'C:\\Program Files\\nodejs\\node.exe s.js --token ' + R);
  assert.deepStrictEqual(splitCommand('\\\\srv\\share\\my tools\\a.exe -v'), ['\\\\srv\\share\\my tools\\a.exe', '-v']);
  assert.deepStrictEqual(splitCommand('C:\\a\\b.exe C:\\data\\f.txt'), ['C:\\a\\b.exe', 'C:\\data\\f.txt']);
  masked(['--token', '-' + SEC], ['--token', R], 'dash value');
  assert.deepStrictEqual(maskSecretArgs(['--api-key', '-' + SEC, 'next']), ['--api-key', R, 'next']);
  assert.deepStrictEqual(maskSecretArgs(['--token', '--verbose']), ['--token', '--verbose']);
  assert.deepStrictEqual(maskSecretArgs(['--private-key', SEC]), ['--private-key', R]);
  masked(['--token=', SEC], ['--token=' + R, R], 'empty --token= then the value');
  noSec(maskSecretArgs(['--repos=a,https://' + SEC + '@h.test/x']), 'url inside an arg');
  assert.strictEqual(maskSecretArgs(['--repos=a,https://' + SEC + '@h.test/x'])[0], '--repos=a,https://' + R + '@h.test/x');
  masked(['["--token","' + SEC + '"]'], ['["--token","' + R + '"]'], 'json array of args');
  masked(['bearer ' + SEC], ['bearer ' + R], 'bearer');
  masked(['Bearer ' + SEC], ['Bearer ' + R], 'Bearer');
  masked(['--auth', 'Bearer ' + SEC], ['--auth', R], 'Bearer after --auth');
  assert.deepStrictEqual(maskSecretArgs(['--desc', 'Basic setup of the server']), ['--desc', 'Basic setup of the server'], 'prose starting with Basic stays');
  // `bearer of news` has several tokens after the word, so it is NOT masked (rule: the word plus exactly one token)
  assert.deepStrictEqual(maskSecretArgs(['--msg', 'bearer of news']), ['--msg', 'bearer of news']);
  masked(['--header', 'X-Custom=' + SEC], ['--header', 'X-Custom=' + R], 'Name=value after a header flag');
  assert.strictEqual(maskSecretUrl('https://api.telegram.org/BOT123:' + SEC + '/x'), 'https://api.telegram.org/BOT123:' + R + '/x');
  assert.strictEqual(maskSecretUrl('https://u:p@ss@h.test/'), 'https://' + R + '@h.test/', 'user info runs to the last @ of the authority');
  // never throws, and linear on large adversarial input (limit far above the real cost)
  assert.doesNotThrow(() => { maskSecretArgs([null as any, undefined as any, 5 as any]); maskSecretCommand(null); maskSecretUrl(null); });
  const big = 200_000;
  const shapes = ['--token ' + 'a '.repeat(big / 2), '{"a":"'.repeat(big / 6), 'a=b;'.repeat(big / 4), 'x://' + '@'.repeat(big), 'http://' + 'a:'.repeat(big / 2), '/bot1:'.repeat(big / 6), ';token='.repeat(big / 7), '"k": "'.repeat(big / 6), '['.repeat(big)];
  const t0 = Date.now();
  for (const x of shapes) { maskSecretArgs([x]); maskSecretUrl(x); maskSecretCommand(x); }
  const ms = Date.now() - t0;
  console.log(`redact: masking 200k-char adversarial inputs in ${ms} ms`);
  assert.ok(ms < 20000, `masking 200k-char adversarial inputs took ${ms} ms`);
}

console.log('redact: all checks passed');
