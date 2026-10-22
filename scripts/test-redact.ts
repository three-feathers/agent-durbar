/** Unit test for secret redaction and the debug sink (spec 012 T051): `npm run test:runtime`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { MASK_INPUT_MAX, REDACT_MAX_CHARS, createDebugSink, _uncappedForTest, cut, maskSchemeSecrets, maskSecretArgs, maskSecretCommand, maskSecretUrl, redact, shQuote, splitCommand } from '../src/shared/redact';

// CPU time of f in ms (user + system of this process), not wall time: it does not grow when other processes take the CPU, so the
// timing checks below hold on a loaded machine or runner (spec 041 `## Changes` 2026-10-22, T068). It still counts every step the
// masking takes, so super-linear (ReDoS-style) growth fails as before. CPU time does not see a blocking wait (Atomics.wait, a sync
// sleep, execSync, sync I/O), so wall time gets a loose backstop of 10x the check's CPU limit `capMs`: load cannot reach it, a long
// wait does. A wait shorter than that still passes (the accepted limit; spec 041 `## Changes` 2026-10-22, review of PR #527).
const cpuMs = (f: () => void, capMs: number): number => {
  const w = process.hrtime.bigint();
  const c = process.cpuUsage();
  f();
  const d = process.cpuUsage(c);
  const cpu = (d.user + d.system) / 1000;
  const wall = Number(process.hrtime.bigint() - w) / 1e6;
  assert.ok(wall < 10 * capMs, `wall-time backstop: ${wall.toFixed(1)} ms wall for ${cpu.toFixed(1)} ms CPU, limit ${10 * capMs} ms (a blocking wait in the timed code?)`);
  return cpu;
};

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
  let out = '';
  const ms = cpuMs(() => { out = redact(big, env); }, 1500);
  assert.ok(ms < 1500, `1 MB redaction took ${ms} ms`);
  assert.ok(out.length <= REDACT_MAX_CHARS + 20, 'input capped at 1 MB');
  const pathological = 'a'.repeat(REDACT_MAX_CHARS);
  const ms2 = cpuMs(() => { redact(pathological + ':' + pathological, env); }, 1500);
  assert.ok(ms2 < 1500, `pathological single token is fast (${ms2} ms)`);
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
  // Each case runs in a worker thread that times redact() itself with the thread's own CPU time (`process.threadCpuUsage()`, Node 22
  // and later; wall time from `hrtime` only on Node 20.19, which has no per-thread CPU time), so a busy runner cannot fail the test;
  // the 1 s assertion is the real ReDoS check, and wall time has the 10 s backstop of `cpuMs` (spec 041 `## Changes` 2026-10-22,
  // review of PR #527). Workers, not child processes: a child fed 1 MB on stdin hung for 30 s twice on a busy macOS runner (#303).
  // The test stays synchronous: the worker writes the time into shared memory and wakes this thread (Atomics), with a 30 s hang
  // guard; a worker that does not answer in time is stopped and the case retried once.
  const mod = require.resolve('../src/shared/redact');
  const code = `const {workerData:w}=require('worker_threads');const flag=new Int32Array(w.sab,0,1),out=new Float64Array(w.sab,8,2);` +
    `try{const {redact}=require(w.mod);const tc=typeof process.threadCpuUsage==='function';const w0=process.hrtime.bigint(),c0=tc?process.threadCpuUsage():null;redact(w.input,{});const wall=Number(process.hrtime.bigint()-w0)/1e6;let cpu=wall;if(tc){const d=process.threadCpuUsage(c0);cpu=(d.user+d.system)/1000}out[0]=cpu;out[1]=wall;Atomics.store(flag,0,1)}` +
    `catch(e){Atomics.store(flag,0,2)}Atomics.notify(flag,0)`;
  for (const [k, v] of Object.entries(adversarial)) {
    let ms = NaN;
    let wall = NaN;
    let why = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const sab = new SharedArrayBuffer(24);
      const flag = new Int32Array(sab, 0, 1);
      const worker = new Worker(code, { eval: true, workerData: { mod, input: v, sab } });
      const waited = Atomics.wait(flag, 0, 0, 30000);
      void worker.terminate();
      if (waited === 'timed-out') { why = 'no answer in 30 s'; continue; }
      assert.strictEqual(Atomics.load(flag, 0), 1, `adversarial ${k}: redact() threw in the worker`);
      [ms, wall] = new Float64Array(sab, 8, 2);
      break;
    }
    assert.ok(!Number.isNaN(ms), `adversarial ${k}: worker hung twice (${why})`);
    assert.ok(ms < 1000, `adversarial ${k}: redact() took ${ms.toFixed(1)} ms, limit 1000 ms`);
    assert.ok(wall < 10000, `adversarial ${k}: wall-time backstop: ${wall.toFixed(1)} ms wall for ${ms.toFixed(1)} ms CPU, limit 10000 ms (a blocking wait?)`);
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
  const ms = cpuMs(() => { for (const x of shapes) { _uncappedForTest.maskSecretArgs([x]); maskSecretUrl(x); _uncappedForTest.maskSecretCommand(x); } }, 20000);
  console.log(`redact: masking 200k-char adversarial inputs in ${ms} ms`);
  assert.ok(ms < 20000, `masking 200k-char adversarial inputs took ${ms} ms`);
}

// 14c. T064 masking follow-ups (spec 041 `## Changes` 2026-10-20, R1-R8). SEC is built at run time; no output may contain it.
{
  const SEC = 'sEc' + 'ReT-' + 'q7w8e9r0t1y2u3i4';
  const R = '[redacted]';
  const noSec = (x: unknown, what: string): void => assert.ok(!JSON.stringify(x).includes(SEC), `${what}: no secret in ${JSON.stringify(x)}`);
  const masked = (args: string[], want: string[], what: string): void => { const got = maskSecretArgs(args); assert.deepStrictEqual(got, want, what); noSec(got, what); };
  const cmd = (c: string, want: string, what: string): void => { const got = maskSecretCommand(c); assert.strictEqual(got, want, what); noSec(got, what); };
  // (a) shell strings (R3)
  masked(['-c', 'npx srv --token ' + SEC], ['-c', 'npx srv --token ' + R], 'a: sh -c');
  masked(['/c', 'npx srv --api-key=' + SEC], ['/c', 'npx srv --api-key=' + R], 'a: cmd /c');
  masked(['-Command', 'srv -Token ' + SEC], ['-Command', 'srv -Token ' + R], 'a: powershell');
  masked(['npx srv --token ' + SEC], ['npx srv --token ' + R], 'a: no flag before it');
  masked(['-c', 'a  --token\t' + SEC], ['-c', 'a  --token\t' + R], 'a: separators kept');
  // (b) assignments in shell strings
  masked(['export TOKEN=' + SEC + '; npx srv'], ['export TOKEN=' + R + '; npx srv'], 'b: export');
  noSec(maskSecretArgs(['set API_KEY=' + SEC + '&& npx srv']), 'b: set');
  assert.strictEqual(maskSecretArgs(['set API_KEY=' + SEC + '&& npx srv'])[0], 'set API_KEY=' + R + '&& npx srv', 'b: set keeps &&');
  noSec(maskSecretArgs(['set "API_KEY=' + SEC + '" && srv']), 'b: set quoted');
  noSec(maskSecretArgs(['export TOKEN="' + SEC + ' x"; npx srv']), 'b: export quoted with a space');
  masked(["$env:API_KEY='" + SEC + "'; srv"], ['$env:API_KEY=' + R + '; srv'], 'b: $env:');
  // (c) nesting and depth
  masked(['-c', 'curl -H "X-Api-Key: ' + SEC + '" https://h.test'], ['-c', 'curl -H "X-Api-Key: ' + R + '" https://h.test'], 'c: quoted header in a shell string');
  noSec(maskSecretArgs(['-c', "srv --cfg '{\"token\":\"" + SEC + "\"}'"]), 'c: json in a shell string');
  noSec(maskSecretArgs(['npx srv https://' + SEC + '@h.test/x']), 'c: url in a shell string');
  {
    let nest = 'srv --token ' + SEC;
    for (let i = 0; i < 6; i++) nest = i % 2 ? 'sh -c ' + JSON.stringify(nest) : JSON.stringify({ cmd: nest });
    assert.doesNotThrow(() => maskSecretArgs(['-c', nest]), 'c: 6 levels never throw');
  }
  // (d) no new over-masking of prose
  assert.deepStrictEqual(maskSecretArgs(['--desc', 'Basic setup of the server']), ['--desc', 'Basic setup of the server'], 'd: Basic');
  assert.deepStrictEqual(maskSecretArgs(['--msg', 'bearer of news']), ['--msg', 'bearer of news'], 'd: bearer');
  assert.deepStrictEqual(maskSecretArgs(['token of thanks']), ['token of thanks'], 'd: token');
  assert.deepStrictEqual(maskSecretArgs(['Accept: a; q=0.9']), ['Accept: a; q=0.9'], 'd: Accept');
  masked(['--conn', 'Server=x; Password = ' + SEC + ' ;Database=d'], ['--conn', 'Server=x; Password=' + R + ';Database=d'], 'd: conn string as in 14b');
  // (e) `Name: value` before `;` (R4)
  masked(['Cookie: a=1; sid=' + SEC], ['Cookie: ' + R], 'e: Cookie');
  masked(['Set-Cookie: sid=' + SEC + '; Path=/'], ['Set-Cookie: ' + R], 'e: Set-Cookie');
  masked(['X-Info: a; password=' + SEC], ['X-Info: a; password=' + R], 'e: harmless name keeps the split');
  // (f) `Name:` then its value (R5)
  masked(['Cookie:', SEC], ['Cookie:', R], 'f: Cookie:');
  masked(['-H', 'X-Api-Key:', SEC], ['-H', 'X-Api-Key:', R], 'f: -H Name:');
  assert.deepStrictEqual(maskSecretArgs(['Accept:', 'json']), ['Accept:', 'json'], 'f: Accept:');
  {
    const once = maskSecretArgs(['-c', 'x Cookie: a=1'])[1];
    assert.strictEqual(once.split(R).length - 1, 1, `f: R once in ${once}`);
  }
  // (g) space before the colon (R4)
  masked(['Password : ' + SEC], ['Password: ' + R], 'g: Password :');
  noSec(maskSecretArgs(['-H', 'X-Api-Key : ' + SEC]), 'g: -H X-Api-Key :');
  assert.deepStrictEqual(maskSecretArgs(['Note : hello']), ['Note : hello'], 'g: Note :');
  // (h) quoted command (R1, R8)
  cmd('srv -H "Authorization: Bearer ' + SEC + '"', 'srv -H "Authorization: ' + R + '"', 'h: Authorization double quotes');
  cmd('srv -H "X-Api-Key: ' + SEC + '"', 'srv -H "X-Api-Key: ' + R + '"', 'h: X-Api-Key');
  noSec(maskSecretCommand("srv -H 'Authorization: Bearer " + SEC + "'"), 'h: single quotes');
  noSec(maskSecretCommand('srv --auth Bearer ' + SEC), 'h: --auth Bearer');
  cmd('srv --token "' + SEC + ' more"', 'srv --token ' + R, 'h: quoted value with a space');
  assert.deepStrictEqual(splitCommand('srv -H "A: b c"'), ['srv', '-H', '"A: b c"'], 'h: quoted header is one word');
  assert.deepStrictEqual(splitCommand('"C:\\Program Files\\srv\\srv.exe" --api-key x'), ['"C:\\Program Files\\srv\\srv.exe"', '--api-key', 'x'], 'h: quoted path is one word');
  cmd("npx srv --token '" + SEC, 'npx srv --token ' + R, 'h: unmatched quote is a literal');
  assert.deepStrictEqual(splitCommand('\\\\srv\\share\\my tools\\a.exe -v'), ['\\\\srv\\share\\my tools\\a.exe', '-v'], 'h: UNC as in 14b');
  assert.deepStrictEqual(splitCommand('C:\\a\\b.exe C:\\data\\f.txt'), ['C:\\a\\b.exe', 'C:\\data\\f.txt'], 'h: drive as in 14b');
  // (i) whole-quoted args (R2)
  masked(['"Server=x;Password=' + SEC + '"'], ['"Server=x;Password=' + R + '"'], 'i: whole-quoted connection string');
  masked(['--token="' + SEC + ' more"'], ['--token=' + R], 'i: flag value');
  // (j) comma pairs (R6)
  masked(['user=me,password=' + SEC], ['user=me,password=' + R], 'j: comma pair');
  masked(['--opts', 'user=me,password=' + SEC], ['--opts', 'user=me,password=' + R], 'j: --opts');
  masked(['--opts=user=me,password=' + SEC], ['--opts=user=me,password=' + R], 'j: --opts=');
  assert.deepStrictEqual(maskSecretArgs(['password=abc,def']), ['password=' + R], 'j: comma in the value');
  masked(['Server=h,1433;Password=' + SEC], ['Server=h,1433;Password=' + R], 'j: Server=h,1433');
  assert.deepStrictEqual(maskSecretArgs(['--tags=a,b,c']), ['--tags=a,b,c'], 'j: tags');
  // (k) JSON name/value (R7)
  masked(['[{"name":"token","value":"' + SEC + '"}]'], ['[{"name":"token","value":"' + R + '"}]'], 'k: name/value');
  noSec(maskSecretArgs(['[{"name":"API_KEY","value":"' + SEC + '"}]']), 'k: API_KEY');
  noSec(maskSecretArgs(['{"key":"Authorization","value":"' + SEC + '"}']), 'k: key/value');
  assert.deepStrictEqual(maskSecretArgs(['[{"name":"port","value":"8080"}]']), ['[{"name":"port","value":"8080"}]'], 'k: port');
  // review fixes: `$env:` names that only match once the prefix is stripped, `Name:` with trailing space, JSON member case
  noSec(maskSecretArgs(["$env:PAT='" + SEC + "'"]), 'b: $env:PAT');
  assert.deepStrictEqual(maskSecretArgs(["$env:PAT='" + SEC + "'"]), ['$env:PAT=' + R], 'b: $env:PAT exact');
  assert.deepStrictEqual(maskSecretArgs(["$env:SIG='" + SEC + "'"]), ['$env:SIG=' + R], 'b: $env:SIG exact');
  masked(['Cookie:  ', SEC], ['Cookie:  ', R], 'f: Cookie: with trailing spaces');
  masked(['[{"Name":"token","Value":"' + SEC + '"}]'], ['[{"Name":"token","Value":"' + R + '"}]'], 'k: member names in any case');
  masked(['{"KEY":"Authorization","value":"' + SEC + '"}'], ['{"KEY":"' + R + '","value":"' + R + '"}'], 'k: KEY in capitals');
  // MAX_DEPTH (8) bounds shell, KV and quoted-word levels; past it a value that needs another pass is masked whole (fail-safe), never shown
  {
    const pre = (core: string, k: number): string => { let x = core; for (let i = 1; i <= k; i++) x = 'A' + i + '=' + x; return x; };
    const head = (k: number): string => { let x = ''; for (let i = 1; i <= k; i++) x = 'A' + i + '=' + x; return x; }; // `Ak=...A1=`
    const kv = (core: string, k: number): string => pre(core, k);
    // a KV chain: masked normally to 7 levels, the whole value past that
    assert.strictEqual(maskSecretArgs([kv('--token ' + SEC, 7)])[0], head(7) + '--token ' + R, 'depth: KV chain of 7 is masked normally');
    assert.strictEqual(maskSecretArgs([kv('--token ' + SEC, 8)])[0], head(8) + R, 'depth: KV chain of 8 is masked whole (fail-safe)');
    // a quoted shell string behind k KV levels
    const one = '"srv --token ' + SEC + '"';
    const two = `"sh -c 'srv --token ${SEC}'"`;
    assert.strictEqual(maskSecretArgs([pre(one, 5)])[0], head(5) + '"srv --token ' + R + '"', 'depth: quoted shell string behind 5 KV levels');
    assert.strictEqual(maskSecretArgs([pre(one, 7)])[0], head(7) + R, 'depth: quoted shell string behind 7 KV levels is masked whole');
    assert.strictEqual(maskSecretArgs([pre(two, 2)])[0], head(2) + `"sh -c 'srv --token ${R}'"`, 'depth: two shell levels behind 2 KV levels');
    assert.strictEqual(maskSecretArgs([pre(two, 6)])[0], head(6) + '"sh -c ' + R + '"', 'depth: two shell levels behind 6 KV levels: the inner string is masked whole');
    assert.strictEqual(maskSecretArgs([pre(two, 7)])[0], head(7) + R, 'depth: two shell levels behind 7 KV levels is masked whole');
    // JSON values carry the budget: past it the whole value is masked, never shown
    for (const js of ['{"c":"srv --token ' + SEC + '"}', '["srv --token ' + SEC + '"]']) {
      for (let k = 0; k <= 11; k++) noSec(maskSecretArgs([pre(js, k)]), `depth: JSON ${js.slice(0, 3)} behind ${k} KV levels`);
      assert.strictEqual(maskSecretArgs([pre(js, 9)])[0], head(9) + R, `depth: JSON ${js.slice(0, 3)} behind 9 KV levels is masked whole`);
    }
    // budget-0 fail-safe, quote branch: a quoted word with no space at exactly the bound
    assert.strictEqual(maskSecretArgs([pre('"abc"', 7)])[0], head(7) + '"abc"', 'depth: a quoted word one level inside the bound is shown');
    assert.strictEqual(maskSecretArgs([pre('"abc"', 8)])[0], head(8) + R, 'depth: a quoted word at the bound is masked whole');
    assert.strictEqual(maskSecretArgs([pre("'abc'", 8)])[0], head(8) + R, "depth: a single-quoted word at the bound is masked whole");
    // budget-0 fail-safe, flag branch: a flag-shaped value with no space at the bound
    assert.strictEqual(maskSecretArgs([pre('--token=' + SEC, 7)])[0], head(7) + '--token=' + R, 'depth: a flag-shaped value inside the bound is masked on its own');
    assert.strictEqual(maskSecretArgs([pre('--token=' + SEC, 8)])[0], head(8) + R, 'depth: a flag-shaped value at the bound is masked whole');
    // B1: shell, KV, quoted word, shell, quoted word
    assert.deepStrictEqual(maskSecretArgs(['-c', 'export X="bash -lc \'npx srv --api-key ' + SEC + '\'"; srv']), ['-c', 'export X="bash -lc \'npx srv --api-key ' + R + '\'"; srv'], 'B1: five levels, readable output');
    // nested far past the bound: no SEC, and the innermost is [redacted]
    for (let k = 9; k <= 14; k++) {
      const o = maskSecretArgs([pre(two, k)])[0];
      noSec(o, `depth: ${k} levels`);
      assert.ok(o.endsWith('=' + R), `depth: ${k} levels ends masked: ${o}`);
    }
    let sh = 'srv --token ' + SEC;
    for (let i = 0; i < 12; i++) sh = (i % 2 ? 'sh -c "' : "sh -c '") + sh + (i % 2 ? '"' : "'");
    noSec(maskSecretArgs(['-c', sh]), 'depth: 12 shell levels');
    noSec(maskSecretCommand(sh), 'depth: 12 shell levels in a command');
    masked(['--cmd="srv --token ' + SEC + '"'], ['--cmd="srv --token ' + R + '"'], 'R2/R3: a whole-quoted shell string as a flag value');
  }
  // L1: text with spaces that R1 cannot split (escaped quotes, a quote glued to a word) is never shown unmasked
  noSec(maskSecretArgs(['-c', 'srv --cfg "{\\"token\\":\\"' + SEC + '\\"}"']), 'L1: escaped JSON in a shell string');
  assert.strictEqual(maskSecretArgs(['-c', 'srv --cfg "{\\"token\\":\\"' + SEC + '\\"}"'])[1], 'srv --cfg "{\\"token\\":\\"' + R + '\\"}"', 'L1: exact');
  noSec(maskSecretCommand('sh -c "npx srv --token \\"' + SEC + ' x\\""'), 'L1: escaped quotes in a command');
  assert.strictEqual(maskSecretArgs(['-c', 'srv \\"--token ' + SEC + '\\"'])[1], 'srv \\"--token ' + R, 'L1: backslash-quote before a flag');
  noSec(maskSecretArgs(['srv \\"--api-key=' + SEC + '\\"']), 'L1: backslash-quote before a --flag=value');
  assert.strictEqual(maskSecretArgs(['-c', 'srv x"--token ' + SEC + '"'])[1], 'srv x"--token ' + R, 'L1: a quote glued to a word');
  {
    let y = 'srv --token ' + SEC;
    for (let i = 0; i < 2; i++) y = JSON.stringify({ cmd: 'sh -c ' + JSON.stringify({ c: y }) });
    noSec(maskSecretArgs([y]), 'L1: JSON, sh -c, JSON, sh -c');
  }
  // L2: a flag-shaped value (starts with - or /) is masked at any depth; ordinary ones stay
  masked(['A=--token=' + SEC], ['A=--token=' + R], 'L2: NAME=--token=x');
  masked(['{"a":"--api-key=' + SEC + '"}'], ['{"a":"--api-key=' + R + '"}'], 'L2: JSON value that is a flag');
  masked(['--opts', '--password=' + SEC], ['--opts', '--password=' + R], 'L2: --opts --password=x');
  assert.deepStrictEqual(maskSecretArgs(['A=--verbose', '{"a":"/usr/bin/x"}']), ['A=--verbose', '{"a":"/usr/bin/x"}'], 'L2: ordinary flag-shaped values unchanged');
  // C2: an escaped value with spaces is masked before the shell split cuts it apart
  assert.strictEqual(maskSecretArgs(['-c', 'srv --cfg "{\\"token\\":\\"' + SEC + ' x\\"}"'])[1], 'srv --cfg "{\\"token\\":\\"' + R + '\\"}"', 'C2: escaped JSON value with a space');
  noSec(maskSecretArgs(['{\\"a\\":\\"b c\\",\\"password\\":\\"a ' + SEC + '\\"}']), 'C2: escaped password with a space');
  // backtick set aside like a quote
  assert.strictEqual(maskSecretArgs(['-c', 'srv `--token ' + SEC + '`'])[1], 'srv `--token ' + R, 'backtick before a flag');
  // the plain-whitespace fallback on its own: one glued word with spaces, no whole-quoted word, no leading quote
  assert.strictEqual(maskSecretArgs(['-c', 'srv a"b --token ' + SEC + '"c'])[1], 'srv a"b --token ' + R, 'fallback: plain split of a glued word');
  // Paco's review: a flag opened inside a KV value behind a stray quote marks the next word (three forms)
  assert.strictEqual(maskSecretArgs(['-c', 'bash -c "OPTS=\\"--token ' + SEC + '\\" srv"'])[1], 'bash -c "OPTS=\\"--token ' + R + '"', 'Paco 2a: args (T067: the payload is unescaped one level, masked, and written back in its quotes)');
  noSec(maskSecretCommand('bash -c "OPTS=\\"--token ' + SEC + '\\" srv"'), 'Paco 2b: command');
  noSec(maskSecretArgs(['X="X=\\"--token ' + SEC + '\\""']), 'Paco 2c: X="X=\\"--token SEC\\""');
  noSec(maskSecretArgs(['OPTS=\\"--token=' + SEC + '\\"']), 'Paco 2d: --token=SEC behind a stray quote');
  // a flag WITH a value behind a stray quote does not mark the next word (pins the `f2.rest === undefined` guard)
  assert.deepStrictEqual(maskSecretArgs(['OPTS=\\"--token=' + SEC + '\\"', 'next']), ['OPTS=\\"--token=' + R, 'next'], 'guard: the next arg stays visible');
  assert.strictEqual(maskSecretCommand('OPTS=\\"--token=' + SEC + '\\" next'), 'OPTS=\\"--token=' + R + ' next', 'guard: the next word of a command stays visible');
  // display limit, on purpose: after a secret flag the whole next word is masked, so `SEC\\" srv"` (which may itself hold a `\\"`) loses its tail
  assert.strictEqual(maskSecretCommand('bash -c "OPTS=\\"--token ' + SEC + '\\" srv"'), 'bash -c "OPTS=\\"--token ' + R + '"', 'display: the tail of the secret word is dropped, never shown (T067: the payload keeps its closing quote)');
  // (m of 14b still) env prefix keeps other names
  assert.deepStrictEqual(maskSecretArgs(["$env:PORT='8080'; srv"]), ["$env:PORT='8080'; srv"], 'b: $env:PORT unchanged');

  // T066 / R11: a scheme word, then the secret as the next arg; R7 on escaped objects
  {
    const AUTH = 'Authorization: Bearer';
    masked(['--auth', 'Bearer', SEC], ['--auth', 'Bearer', R], 'R11 a: --auth Bearer SEC');
    masked(['--token', 'token', SEC], ['--token', 'token', R], 'R11 a: --token token SEC');
    masked(['-H', 'Bearer', SEC], ['-H', 'Bearer', R], 'R11 a: -H Bearer SEC');
    masked(['--auth', 'basic', SEC], ['--auth', 'basic', R], 'R11 a: case-insensitive');
    masked(['--auth', 'ApiKey', SEC], ['--auth', 'ApiKey', R], 'R11 a: ApiKey');
    masked(['-H', AUTH, SEC], ['-H', AUTH, R], 'R11 b: -H Authorization: Bearer SEC');
    masked(['Authorization: Basic', SEC], ['Authorization: Basic', R], 'R11 b: Authorization: Basic SEC');
    masked(['Proxy-Authorization: Digest', SEC], ['Proxy-Authorization: Digest', R], 'R11 b: Proxy-Authorization');
    masked(['Bearer', SEC], ['Bearer', R], 'R11 c: bare Bearer');
    masked(['Basic', SEC], ['Basic', R], 'R11 c: bare Basic');
    masked(['-c', 'curl --auth Bearer ' + SEC], ['-c', 'curl --auth Bearer ' + R], 'R11 d: shell string');
    noSec(maskSecretArgs(['-c', 'curl -H "Authorization: Bearer" ' + SEC]), 'R11 d: quoted header word in a shell string (redact() hides the scheme too, fine)');
    noSec(maskSecretCommand('curl --auth Bearer ' + SEC), 'R11 d: command (R8: redact() masks `Bearer SEC` first)');
    assert.ok(maskSecretArgs(['--auth', 'Bearer', SEC])[1] === 'Bearer', 'R11 g: the scheme word stays visible');
    masked(['-c', 'curl Bearer ' + SEC], ['-c', 'curl Bearer ' + R], 'R11 c: bare Bearer word in a shell string');
    assert.deepStrictEqual(maskSecretArgs(['-c', 'curl Bearer']), ['-c', 'curl Bearer'], 'R11 c: Bearer as the last word of a shell string shows nothing extra');
    assert.deepStrictEqual(maskSecretArgs(['-c', 'curl Basic setup']), ['-c', 'curl Basic setup'], 'R11 c: Basic stays top-level only');
    // review fixes: command with a quoted header, --flag=Scheme, any header name after -H, trailing space, array values, case variants
    for (const w of ['Bearer', 'Basic', 'Token', 'Digest', 'Negotiate', 'ApiKey']) {
      noSec(maskSecretCommand('curl -H "Authorization: ' + w + '" ' + SEC), 'rev1: command, quoted header, ' + w);
      noSec(maskSecretCommand("curl -H 'Proxy-Authorization: " + w + "' " + SEC), 'rev1: command, single-quoted header, ' + w);
    }
    noSec(maskSecretCommand('curl Authorization: Bearer ' + SEC + ' https://h.test'), 'rev1: command, unquoted header');
    assert.strictEqual(maskSecretCommand('curl "Accept: Token" list'), 'curl "Accept: Token" list', 'rev1: a harmless name without a header flag keeps the next word');
    assert.strictEqual(maskSecretCommand('curl -H "Authorization: Bearer" --verbose'), 'curl -H "Authorization: [redacted]" --verbose', 'rev1: a flag after the scheme word stays');
    masked(['--auth=Bearer', SEC], ['--auth=Bearer', R], 'rev2: --auth=Bearer SEC');
    masked(['--header=Authorization: Bearer', SEC], ['--header=Authorization: [redacted]', R], 'rev2: --header=Authorization: Bearer SEC');
    masked(['-c', 'curl --auth=Bearer ' + SEC], ['-c', 'curl --auth=Bearer ' + R], 'rev2: shell string --auth=Bearer');
    masked(['-H', 'X-Custom: Token', SEC], ['-H', 'X-Custom: [redacted]', R], 'rev3: any name after -H');
    masked(['--header', 'X-Custom: Basic', SEC], ['--header', 'X-Custom: [redacted]', R], 'rev3: any name after --header');
    masked(['--header=X-Custom: Token', SEC], ['--header=X-Custom: [redacted]', R], 'rev2: a harmless name in the --header= form');
    masked(['--auth', 'Bearer ', SEC], ['--auth', 'Bearer ', R], 'rev4: trailing space');
    masked(['Bearer ', SEC], ['Bearer ', R], 'rev4: bare, trailing space');
    for (const same of [['X-Custom: Token', 'list'], ['Accept: Token', 'list']]) assert.deepStrictEqual(maskSecretArgs(same), same, 'rev6: a harmless name without a header flag stays (pins schemeHeader secretFlag): ' + JSON.stringify(same));
    const escA = (k: string, n: string, vk: string): string => '{\\"' + k + '\\":\\"' + n + '\\",\\"' + vk + '\\":[\\"' + SEC + '\\"]}';
    noSec(maskSecretArgs(['-c', 'srv ' + escA('name', 'token', 'value')]), 'rev5: array value');
    noSec(maskSecretArgs(['-c', 'srv ' + escA('key', 'Authorization', 'value')]), 'rev5: array value, key');
    assert.strictEqual(maskSecretArgs(['-c', 'srv {\\"name\\":\\"port\\",\\"value\\":[\\"8080\\"]}'])[1], 'srv {\\"name\\":\\"port\\",\\"value\\":[\\"8080\\"]}', 'rev5: array value of a harmless name stays');
    for (const [k, vk] of [['NAME', 'VALUE'], ['Key', 'Value'], ['KEY', 'value']]) noSec(maskSecretArgs(['-c', 'srv {\\"' + k + '\\":\\"token\\",\\"' + vk + '\\":\\"' + SEC + '\\"}']), 'rev6: case variant ' + k);
    // round 3: `--header=Name: <scheme>` in a command, three forms, every scheme word
    for (const w of ['Bearer', 'Basic', 'Token', 'Digest', 'Negotiate', 'ApiKey', 'apikey', 'DIGEST']) {
      noSec(maskSecretCommand('curl --header=Authorization:' + w + ' ' + SEC), 'rev7: command, no space, ' + w);
      noSec(maskSecretCommand('curl --header=Authorization: ' + w + ' ' + SEC), 'rev7: command, space, ' + w);
      noSec(maskSecretCommand('curl "--header=Authorization: ' + w + '" ' + SEC), 'rev7: command, quoted flag, ' + w);
      noSec(maskSecretCommand("curl '--header=Proxy-Authorization: " + w + "' " + SEC), 'rev7: command, single-quoted flag, ' + w);
      assert.strictEqual(maskSchemeSecrets('curl --header=X-Info: ' + w + ' list'), 'curl --header=X-Info: ' + w + ' list', 'rev7: a harmless name is left to the args rules');
    }
    // round 5: `NAME=Name:` (a secret-looking name) shows one `[redacted]`, not one per depth level
    const once = (x: string, what: string): void => { assert.strictEqual(x.split(R).length - 1, 1, `${what}: exactly one [redacted] in ${x}`); assert.ok(!x.includes(' y') && !x.includes('Y '), what); };
    assert.strictEqual(maskSecretCommand('x=Auth: y'), 'x=Auth: ' + R, 'rev8: command x=Auth: y');
    assert.strictEqual(maskSecretCommand('echo A=Token: x'), 'echo A=Token: ' + R, 'rev8: command echo A=Token: x');
    assert.deepStrictEqual(maskSecretArgs(['x=Auth: y']), ['x=Auth: ' + R], 'rev8: args x=Auth: y');
    assert.deepStrictEqual(maskSecretArgs(['x=Auth:', 'y']), ['x=Auth:', R], 'rev8: args x=Auth: then y as its own arg');
    assert.deepStrictEqual(maskSecretArgs(['-c', 'echo A=Token: x']), ['-c', 'echo A=Token: ' + R], 'rev8: shell string');
    for (const x of [maskSecretCommand('x=Auth: y'), maskSecretCommand('echo A=Token: x'), maskSecretArgs(['x=Auth: y'])[0]]) once(x, 'rev8');
    assert.deepStrictEqual(maskSecretArgs(['x=Info:', 'y']), ['x=Info:', 'y'], 'rev8: a harmless name keeps the next arg');
    // round 6: TOKEN=Auth: SEC (a secret-looking NAME), and a quoted header value with spaces in a command
    assert.strictEqual(maskSecretCommand('TOKEN=Auth: ' + SEC), 'TOKEN=' + R + ' ' + R, 'rev9a: command TOKEN=Auth: SEC');
    masked(['TOKEN=Auth:', SEC], ['TOKEN=' + R, R], 'rev9a: args TOKEN=Auth: then SEC');
    masked(['-c', 'echo TOKEN=Auth: ' + SEC], ['-c', 'echo TOKEN=' + R + ' ' + R], 'rev9a: shell string');
    for (const q of ["'", '"']) {
      cmd('srv Authorization: ' + q + 'a b' + SEC + q, 'srv Authorization: ' + R, 'rev9b: command, ' + q);
      cmd('srv Authorization: ' + q + 'a b' + SEC + q + ' next', 'srv Authorization: ' + R + ' next', 'rev9b: command, ' + q + ', word after it kept');
      cmd('srv X-Api-Key: ' + q + 'a ' + SEC + q + ' next', 'srv X-Api-Key: ' + R + ' next', 'rev9b: another secret name, ' + q);
      cmd('srv Accept: ' + q + 'a b' + q + ' next', 'srv Accept: ' + q + 'a b' + q + ' next', 'rev9b: a harmless name keeps its quoted value, ' + q);
      noSec(maskSecretCommand('curl --header=Authorization: ' + q + 'a ' + SEC + q), 'rev9b: --header= form, ' + q);
    }
    // round 7: an unclosed quote hides the rest; a scheme word then a quoted run; quoted scheme words (B6)
    for (const n of ['Authorization', 'Proxy-Authorization', 'X-Api-Key', 'Cookie', 'Auth', 'token']) for (const q of ['"', "'"]) {
      noSec(maskSecretCommand('srv ' + n + ': ' + q + 'a ' + SEC), 'rev10: unclosed ' + q + ' after ' + n);
      noSec(maskSecretCommand('srv ' + n + ': ' + q + 'a ' + SEC + ' and more'), 'rev10: unclosed ' + q + ' with a tail after ' + n);
    }
    for (const n of ['Authorization', 'Proxy-Authorization']) for (const w of ['Basic', 'Bearer', 'Digest']) for (const q of ['"', "'"]) {
      noSec(maskSecretCommand('srv ' + n + ': ' + w + ' ' + q + SEC + ' x' + q), 'rev11: scheme then quoted run, ' + n + ' ' + w + ' ' + q);
      noSec(maskSecretCommand('srv ' + n + ': ' + w + ' ' + q + SEC + ' x'), 'rev11: scheme then unclosed run, ' + n + ' ' + w + ' ' + q);
    }
    assert.strictEqual(maskSchemeSecrets('srv Authorization: Basic "a b" --y'), 'srv Authorization: Basic ' + R + ' --y', 'rev11: the scheme word stays visible, the quoted run is masked, the next flag stays');
    assert.strictEqual(maskSchemeSecrets('srv Authorization: "a ' + SEC), 'srv Authorization: ' + R, 'rev10: an unclosed quote masks to the end');
    noSec(maskSecretCommand('srv Authorization: "Bearer" ' + SEC), 'rev12: B6 double-quoted scheme word');
    noSec(maskSecretCommand('curl -H Authorization:"Digest" ' + SEC), 'rev12: B6 glued, quoted Digest');
    noSec(maskSecretCommand("curl --header=Authorization: 'Token' " + SEC), 'rev12: B6 --header=, single-quoted Token');
    assert.strictEqual(maskSchemeSecrets('srv Authorization: "Bearer" ' + SEC), 'srv Authorization: "Bearer" ' + R, 'rev12: B6 the quoted scheme word stays, the secret after it is masked (pre-pass only)');
    assert.strictEqual(maskSchemeSecrets('srv Accept: "a ' + SEC), 'srv Accept: "a ' + SEC, 'rev10: a harmless name with an unclosed quote is left alone');
    // round 8: the same shapes in a shell-string ARG (the pre-pass runs on the raw text of the R3 path)
    for (const n of ['Authorization', 'Proxy-Authorization', 'X-Api-Key', 'Cookie', 'Auth', 'token']) for (const q of ['"', "'"]) {
      noSec(maskSecretArgs(['-c', 'curl ' + n + ': ' + q + 'a ' + SEC]), 'rev13: args, unclosed ' + q + ' after ' + n);
      noSec(maskSecretArgs(['-c', 'curl ' + n + ': ' + q + 'a ' + SEC + q + ' next']), 'rev13: args, closed ' + q + ' after ' + n);
      noSec(maskSecretArgs(['curl ' + n + ': ' + q + 'a ' + SEC]), 'rev13: args, no flag, unclosed ' + q + ' after ' + n);
    }
    for (const n of ['Authorization', 'Proxy-Authorization']) for (const w of ['Basic', 'Bearer', 'Digest']) for (const q of ['"', "'"]) {
      noSec(maskSecretArgs(['-c', 'curl ' + n + ': ' + w + ' ' + q + SEC + ' x' + q + ' --y']), 'rev13: args, scheme then quoted run, ' + n + ' ' + w + ' ' + q);
      noSec(maskSecretArgs(['-c', 'curl ' + n + ': ' + w + ' ' + q + SEC + ' x']), 'rev13: args, scheme then unclosed run, ' + n + ' ' + w + ' ' + q);
    }
    assert.deepStrictEqual(maskSecretArgs(['-c', 'curl Authorization: "a ' + SEC]), ['-c', 'curl Authorization: ' + R], 'rev13: exact output, unclosed');
    assert.deepStrictEqual(maskSecretArgs(['-c', 'curl Authorization: "a b" n']), ['-c', 'curl Authorization: ' + R + ' n'], 'rev13: exact output, closed, single [redacted]');
    assert.deepStrictEqual(maskSecretArgs(['-c', 'curl Accept: "a b" n']), ['-c', 'curl Accept: "a b" n'], 'rev13: a harmless name stays');
    noSec(maskSecretArgs(['-c', 'sh -c \'curl Authorization: "a ' + SEC + '\'']), 'rev13: nested shell string');
    // round 9: a whole-quoted value after `=` on a non-secret flag is masked on its inside (Vikram's re-review)
    masked(['docker', 'run', '--env="API_TOKEN=' + SEC + '"'], ['docker', 'run', '--env="API_TOKEN=' + R + '"'], 'rev14: --env="API_TOKEN=SEC"');
    masked(['--opt=\'token=' + SEC + '\''], ['--opt=\'token=' + R + '\''], 'rev14: --opt=\'token=SEC\'');
    masked(['--opt="token=' + SEC + '"'], ['--opt="token=' + R + '"'], 'rev14: --opt="token=SEC"');
    cmd('docker run --env="API_TOKEN=' + SEC + '" img', 'docker run --env="API_TOKEN=' + R + '" img', 'rev14: command --env="API_TOKEN=SEC"');
    cmd('srv --opt="token=' + SEC + '"', 'srv --opt="token=' + R + '"', 'rev14: command --opt="token=SEC"');
    cmd("srv --opt='token=" + SEC + "'", "srv --opt='token=" + R + "'", "rev14: command --opt='token=SEC'");
    assert.deepStrictEqual(maskSecretArgs(['--opt="plain value"']), ['--opt="plain value"'], 'rev14: a plain quoted value is unchanged');
    assert.strictEqual(maskSecretCommand('srv --opt="plain value" x'), 'srv --opt="plain value" x', 'rev14: command, a plain quoted value is unchanged');
    masked(['--cfg="a b"', '--token', SEC], ['--cfg="a b"', '--token', R], 'rev14: args, cfg kept, SEC masked');
    cmd('srv --cfg="a b" --token ' + SEC, 'srv --cfg="a b" --token ' + R, 'rev14: command, cfg kept, SEC masked');
    masked(['-c', 'docker run --env="API_TOKEN=' + SEC + '" img'], ['-c', 'docker run --env="API_TOKEN=' + R + '" img'], 'rev14: inside a shell string');
    // R7 on escaped objects
    const esc = (k: string, n: string, val: string, rest = ''): string => '{\\"' + k + '\\":\\"' + n + '\\",\\"value\\":\\"' + val + '\\"' + rest + '}';
    masked(['-c', 'srv --cfg "' + esc('name', 'Authorization', SEC) + '"'], ['-c', 'srv --cfg "' + esc('name', 'Authorization', R) + '"'], 'R7 esc: name');
    masked(['-c', 'srv --cfg "' + esc('key', 'Authorization', SEC) + '"'], ['-c', 'srv --cfg "' + esc('key', R, R) + '"'], 'R7 esc: key (the name itself is masked too, as for the pair rule)');
    masked(['-c', 'srv ' + esc('name', 'token', SEC)], ['-c', 'srv ' + esc('name', 'token', R)], 'R7 esc: token name, unquoted');
    masked(['-c', 'srv ' + esc('name', 'API_KEY', SEC, ',\\"other\\":\\"1\\"')], ['-c', 'srv ' + esc('name', 'API_KEY', R, ',\\"other\\":\\"1\\"')], 'R7 esc: other members kept');
    masked(['-c', 'srv ' + '{\\"name\\":\\"password\\",\\"value\\":' + SEC + '}'], ['-c', 'srv ' + '{\\"name\\":\\"password\\",\\"value\\":' + R + '}'], 'R7 esc: bare value');
    // false positives stay as they are
    for (const same of [['npx', 'srv', 'token', 'list'], ['--desc', 'Basic setup of the server'], ['{\\"name\\":\\"port\\",\\"value\\":\\"8080\\"}'], ['-c', 'srv {\\"name\\":\\"port\\",\\"value\\":\\"8080\\"}'], ['Accept: a; q=0.9'], ['Bearer', '--verbose'], ['Authorization: Bearer', '--verbose']]) {
      assert.deepStrictEqual(maskSecretArgs(same), same, 'R11 no false positive: ' + JSON.stringify(same));
    }
    assert.deepStrictEqual(maskSecretArgs(['--desc', 'Basic setup']), ['--desc', 'Basic [redacted]'], 'R11: `Basic setup` (scheme word plus one word) was already masked by the BEARER rule before T066, unchanged');
    // cost: a long run of `Bearer ` words and many escaped R7 objects (same interleaved ratio as the block below)
    const rshapes: Array<[string, string]> = [['Bearer ', 'Bearer '], ['--auth Bearer ', '--auth Bearer '], ['obj', '{\\"name\\":\\"token\\",\\"value\\":\\"x y\\"} '], ['arr', '{\\"name\\":\\"token\\",\\"value\\":[\\"x\\"]} '], ['hdr', 'Authorization: Bearer '], ['qhdr', '-H "Authorization: Bearer" '], ['eq', '--auth=Bearer '], ['sq', "Authorization: 'a "], ['dq', 'Authorization: "a '], ['mixed', `Authorization: "a Authorization: 'a `], ['tok', 'TOKEN=Auth: '], ['unclosed', 'x Authorization: "a '], ['unclosed1', "Cookie: 'a "], ['schemeq', 'Authorization: Basic "a '], ['argsq', 'curl Authorization: "a ']];
    for (const [, unit] of rshapes) {
      const mk = (n: number): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
      const time = (x: string): number => cpuMs(() => { _uncappedForTest.maskSecretArgs([x]); _uncappedForTest.maskSecretArgs(['-c', x]); _uncappedForTest.maskSecretCommand(x); }, 8000);
      let tSmall = Infinity;
      let tBig = Infinity;
      for (let i = 0; i < 5; i++) { tSmall = Math.min(tSmall, time(mk(50_000))); tBig = Math.min(tBig, time(mk(400_000))); }
      const t200 = time(mk(200_000));
      const ratio = tBig / Math.max(tSmall, 20);
      console.log(`redact: 14c R11/R7 ${JSON.stringify(unit)} 50k=${Math.round(tSmall)} ms 400k=${Math.round(tBig)} ms ratio ${ratio.toFixed(1)} 200k=${Math.round(t200)} ms`);
      assert.ok(t200 < 5000 && tBig < 8000 && ratio < 24, `14c: R11/R7 ${JSON.stringify(unit)} grew too fast: ${tSmall} -> ${tBig} ms (ratio ${ratio.toFixed(1)}), 200k ${t200} ms`);
    }
  }

  // (n) timing: each shape linear in practice; doubling check on the shape the analyst suspected.
  const shapes: Array<[string, string]> = [['-c ', '-c '], ['"', '"'], ['"a ', '"a '], ["a 'b", "a 'b"], [', a=', ', a='], ['Cookie: ', 'Cookie: '], ['{"a":"x y ', '{"a":"x y '], ["'\"", "'\""], ['x ', 'x ']];
  const run = (x: string): void => { _uncappedForTest.maskSecretArgs([x]); _uncappedForTest.maskSecretArgs(['-c', x]); _uncappedForTest.maskSecretCommand(x); };
  const total = cpuMs(() => { for (const [, unit] of shapes) run(unit.repeat(Math.ceil(200_000 / unit.length)).slice(0, 200_000)); }, 20000);
  console.log(`redact: 14c masking 200k-char adversarial inputs in ${total} ms`);
  assert.ok(total < 20000, `14c: masking 200k-char adversarial inputs took ${total} ms`);
  // linearity: 50k vs 400k (8x apart), 5 interleaved pairs, min CPU time of each size (cpuMs), so neither a load burst nor other
  // processes on the CPU move the ratio.
  // Linear is a ratio of about 8; three doublings at up to 3x each allow 24; quadratic would be about 64.
  for (const unit of ['{"a":"x y ', 'x ', '"a ']) {
    const small = unit.repeat(Math.ceil(50_000 / unit.length));
    const big = unit.repeat(Math.ceil(400_000 / unit.length));
    const time = (x: string): number => cpuMs(() => run(x), 8000);
    let tSmall = Infinity;
    let tBig = Infinity;
    for (let i = 0; i < 5; i++) { tSmall = Math.min(tSmall, time(small)); tBig = Math.min(tBig, time(big)); }
    const ratio = tBig / Math.max(tSmall, 20);
    console.log(`redact: 14c linearity ${JSON.stringify(unit)} 50k=${Math.round(tSmall)} ms 400k=${Math.round(tBig)} ms ratio ${ratio.toFixed(1)}`);
    assert.ok(tBig < 8000 && ratio < 24, `14c: ${JSON.stringify(unit)} grew too fast: ${tSmall} -> ${tBig} ms (ratio ${ratio.toFixed(1)})`);
  }
  // single-character runs (a regex with an unanchored `+$`, or overlapping classes, is quadratic here): same interleaved ratio check
  const runs: Array<[string, (n: number) => string]> = [
    [';;; x', (n) => ';'.repeat(n) + ' x'], ['&&& x', (n) => '&'.repeat(n) + ' x'], ['||| x', (n) => '|'.repeat(n) + ' x'], ['a``` x', (n) => 'a' + '`'.repeat(n) + ' x'],
    [';;;x y', (n) => ';'.repeat(n) + 'x y'], ['&&&x y', (n) => '&'.repeat(n) + 'x y'], ['|||x y', (n) => '|'.repeat(n) + 'x y'], ['a```b y', (n) => 'a' + '`'.repeat(n) + 'b y'],
  ];
  for (const [name, gen] of runs) {
    const time = (x: string): number => cpuMs(() => run(x), 8000);
    const small = gen(50_000);
    const big = gen(400_000);
    let tSmall = time(small);
    assert.ok(tSmall < 3000, `14c: run ${name} at 50k took ${tSmall} ms (quadratic?)`); // a quadratic one would take minutes at 400k
    let tBig = Infinity;
    for (let i = 0; i < 5; i++) { tSmall = Math.min(tSmall, time(small)); tBig = Math.min(tBig, time(big)); }
    const ratio = tBig / Math.max(tSmall, 20);
    const t200 = time(gen(200_000));
    console.log(`redact: 14c run ${name} 50k=${Math.round(tSmall)} ms 400k=${Math.round(tBig)} ms ratio ${ratio.toFixed(1)} 200k=${Math.round(t200)} ms`);
    assert.ok(t200 < 5000 && tBig < 8000 && ratio < 24, `14c: run ${name} grew too fast: ${tSmall} -> ${tBig} ms (ratio ${ratio.toFixed(1)}), 200k ${t200} ms`);
  }

  // T065 (#374): a string over MASK_INPUT_MAX is hidden whole through the public helpers too, before any rule, in well under 100 ms
  {
    const MB = 1_000_000;
    const timeIt = <T>(f: () => T): { v: T; ms: number } => { let v!: T; const ms = cpuMs(() => { v = f(); }, 100); return { v, ms }; };
    const shapes: Array<[string, string]> = [['a=b;', 'token=' + SEC], ['x ', '--token ' + SEC]];
    for (const [unit, tail] of shapes) {
      const big = unit.repeat(Math.ceil(MB / unit.length)) + tail;
      const a = timeIt(() => maskSecretArgs([big]));
      const c = timeIt(() => maskSecretCommand(big));
      console.log(`redact: 14c 1 MB ${JSON.stringify(unit)} arg ${a.ms.toFixed(1)} ms, command ${c.ms.toFixed(1)} ms`);
      assert.deepStrictEqual(a.v, [R], `14c: 1 MB arg ${JSON.stringify(unit)} comes back [redacted]`);
      assert.strictEqual(c.v, R, `14c: 1 MB command ${JSON.stringify(unit)} comes back [redacted]`);
      assert.ok(a.ms < 100 && c.ms < 100, `14c: 1 MB ${JSON.stringify(unit)} took ${a.ms.toFixed(1)} / ${c.ms.toFixed(1)} ms`);
      noSec([a.v, c.v], '14c: 1 MB');
    }
    const atArg = ('--password=' + SEC).padEnd(MASK_INPUT_MAX, 'y');
    const atCmd = 'node --api-key=' + SEC + ' ' + 'y'.repeat(MASK_INPUT_MAX - 'node --api-key='.length - SEC.length - 1);
    assert.strictEqual(atArg.length, MASK_INPUT_MAX);
    assert.strictEqual(atCmd.length, MASK_INPUT_MAX);
    const gotArg = maskSecretArgs([atArg]);
    assert.ok(gotArg[0].startsWith('--password=' + R) && gotArg[0] !== R, '14c: an arg of exactly MASK_INPUT_MAX is masked by the rules, not hidden whole');
    const gotCmd = maskSecretCommand(atCmd);
    assert.ok(gotCmd.startsWith('node --api-key=' + R) && gotCmd !== R, '14c: a command of exactly MASK_INPUT_MAX is masked by the rules, not hidden whole');
    noSec([gotArg, gotCmd], '14c: at the limit');
    assert.deepStrictEqual(maskSecretArgs([atArg + 'y']), [R], '14c: MASK_INPUT_MAX + 1 arg is hidden whole');
    assert.strictEqual(maskSecretCommand(atCmd + 'y'), R, '14c: MASK_INPUT_MAX + 1 command is hidden whole');
    assert.deepStrictEqual(maskSecretArgs(['a', 'b'.repeat(MASK_INPUT_MAX + 1), '--token', SEC]), ['a', R, '--token', R], '14c: only the long arg is hidden; the others keep their rules');
  }

  // [KNOWN GAP] (spec 041 T064 follow-ups): a bare `token` word is not a flag, so the value after it is NOT masked. This row pins the gap;
  // when it is closed, flip it on purpose (and update the spec).
  assert.deepStrictEqual(maskSecretArgs(['token', SEC]), ['token', SEC], '14c [KNOWN GAP]: a bare `token` before a secret shows the secret');
}

// 14c2. spec 061 T057: `shQuote` is the one display-quoting helper (folder setup list and the sh payload written back by T067).
{
  assert.deepStrictEqual(['-y', 'a b', '', "it's", '$(id)', 'x;y', '@scope/pkg@1.2', '--port=9', 'C:/x'].map((w) => shQuote(w)), ['-y', "'a b'", "''", `'it'\\''s'`, "'$(id)'", "'x;y'", '@scope/pkg@1.2', '--port=9', 'C:/x']);
  assert.strictEqual(shQuote('x', true), "'x'", 'T057: always quotes a safe word');
  assert.strictEqual(shQuote("a'b", true), `'a'\\''b'`, 'T057: a quote inside');
  // the single-quoted sh payload is written back through shQuote: the `'\''` survives and the secret is masked
  assert.strictEqual(maskSecretCommand("sh -c 'echo it'\\''s; srv --api-key SEC'"), "sh -c 'echo it'\\''s; srv --api-key [redacted]'");
}

// 14d. T067 (#447): secrets inside escaped quotes. The payload of `sh|bash -c`, `cmd /c` and `powershell|pwsh -Command` is unescaped one
// level with that shell's own rules, then masked; a leading quote that closes nowhere is set aside (fail closed). T is the issue's placeholder.
{
  const T = 'TOKEN' + '123';
  const R = '[redacted]';
  const noT = (x: unknown, what: string): void => assert.ok(!JSON.stringify(x).includes(T), `${what}: no secret in ${JSON.stringify(x)}`);
  const masked = (args: string[], want: string[], what: string): void => { const got = maskSecretArgs(args); assert.deepStrictEqual(got, want, what); noT(got, what); };
  const cmd = (c: string, want: string, what: string): void => { const got = maskSecretCommand(c); assert.strictEqual(got, want, what); noT(got, what); };
  const BT = '`';
  // (a) the ten leaking rows of the issue (fuzz on PR #369 at 0e0737e), each now masked
  masked(['srv', '-H', '"X-Api-Key:', T + '"'], ['srv', '-H', '"X-Api-Key:', R], 'issue row 1: naive split, leading unmatched quote');
  cmd(`sh -c "srv -H \\"X-Api-Key: ${T}\\""`, `sh -c "srv -H \\"X-Api-Key: ${R}\\""`, 'issue row 2: sh -c, \\"');
  cmd(`powershell -Command "srv -H ${BT}"X-Api-Key: ${T}${BT}""`, `powershell -Command "srv -H ${BT}"X-Api-Key: ${R}${BT}""`, 'issue row 3: PowerShell backtick quotes');
  cmd(`powershell -Command "srv {${BT}"api_key${BT}":${BT}"${T}${BT}"}"`, `powershell -Command "srv {${BT}"api_key${BT}":${BT}"${R}${BT}"}"`, 'issue row 4: JSON pair, backtick quotes (was masked only partly)');
  cmd(`powershell -Command "srv {${BT}"name${BT}":${BT}"api_key${BT}",${BT}"value${BT}":${BT}"${T}${BT}"}"`, `powershell -Command "srv {${BT}"name${BT}":${BT}"api_key${BT}",${BT}"value${BT}":${BT}"${R}${BT}"}"`, 'issue row 5: R7 name/value, backtick quotes');
  cmd(`powershell -Command "srv {\\${BT}"token\\${BT}":\\${BT}"${T}\\${BT}"}"`, `powershell -Command "srv {\\${BT}"token\\${BT}":\\${BT}"${R}\\${BT}"}"`, 'issue row 6: \\ and backtick quote mixed');
  cmd(`sh -c "srv --env=\\"API_TOKEN=${T}\\""`, `sh -c "srv --env=\\"API_TOKEN=${R}\\""`, 'issue row 7: sh -c, --env=\\"NAME=x\\"');
  cmd(`powershell -Command "srv --env=${BT}"API_TOKEN=${T}${BT}""`, `powershell -Command "srv --env=${BT}"API_TOKEN=${R}${BT}""`, 'issue row 8: PowerShell --env');
  cmd(`sh -c "srv --opt=\\"token=${T}\\""`, `sh -c "srv --opt=\\"token=${R}\\""`, 'issue row 9: sh -c, --opt=\\"token=x\\"');
  cmd(`powershell -Command "srv --opt=${BT}"token=${T}${BT}""`, `powershell -Command "srv --opt=${BT}"token=${R}${BT}""`, 'issue row 10: PowerShell --opt');
  // (a2) review of #455 (Paco's agent, d40f1ab): cmd wrapping PowerShell, `bash -c --`, `bash -O`, PowerShell's short -Command forms
  const leakFree = (c: string, what: string): void => { const got = maskSecretCommand(c); noT(got, what); assert.ok(got.includes(R), `${what}: masked in ${got}`); };
  leakFree(`cmd /c powershell -Command "srv -H ${BT}"X-Api-Key: ${T}${BT}""`, 'cmd /c powershell -Command, header');
  leakFree(`cmd /c powershell -Command "srv --env=${BT}"API_TOKEN=${T}${BT}""`, 'cmd /c powershell -Command, --env=');
  leakFree(`cmd /c powershell -Command "srv --opt=${BT}"token=${T}${BT}""`, 'cmd /c powershell -Command, --opt=');
  leakFree(`cmd /c powershell -Command "srv --header=${BT}"X-Api-Key: ${T}${BT}""`, 'cmd /c powershell -Command, --header=');
  leakFree(`cmd /c powershell -Command "srv --config '{${BT}"name${BT}":${BT}"api_key${BT}",${BT}"value${BT}":${BT}"${T}${BT}"}'"`, 'cmd /c powershell -Command, R7 name/value');
  leakFree(`cmd /c powershell -Command "echo '{${BT}"api_key${BT}":${BT}"${T}${BT}"}' | srv"`, 'cmd /c powershell -Command, JSON pair in echo');
  masked(['cmd', '/c', 'powershell', '-Command', `srv -H ${BT}"X-Api-Key: ${T}${BT}"`], ['cmd', '/c', 'powershell', '-Command', `srv -H "X-Api-Key: ${R}"`], 'args: cmd /c powershell -Command, one script arg');
  masked(['cmd', '/c', 'powershell', '-Command', 'srv', `--env=${BT}"API_TOKEN=${T}${BT}"`], ['cmd', '/c', 'powershell', '-Command', 'srv', `--env="API_TOKEN=${R}"`], 'args: cmd /c powershell -Command, --env= arg');
  cmd(`bash -c -- "srv -H \\"X-Api-Key: ${T}\\""`, `bash -c -- "srv -H \\"X-Api-Key: ${R}\\""`, 'bash -c -- "..."');
  cmd(`bash -O extglob -c "srv -H \\"X-Api-Key: ${T}\\""`, `bash -O extglob -c "srv -H \\"X-Api-Key: ${R}\\""`, 'bash -O extglob -c "..."');
  masked(['bash', '-c', '--', `srv --opt=\\"token=${T}\\"`], ['bash', '-c', '--', `srv --opt=\\"token=${R}\\"`], 'args: bash -c -- <script>');
  cmd(`pwsh -c "srv -H ${BT}"X-Api-Key: ${T}${BT}""`, `pwsh -c "srv -H ${BT}"X-Api-Key: ${R}${BT}""`, 'pwsh -c');
  cmd(`powershell -NoP -Comm "srv -H ${BT}"X-Api-Key: ${T}${BT}""`, `powershell -NoP -Comm "srv -H ${BT}"X-Api-Key: ${R}${BT}""`, 'powershell -NoP -Comm (a prefix of -Command)');
  // cmd: a backslash run without a quote reads back unchanged through encode + decode (whole runs, review item 1)
  for (const v of ['a\\\\\\b', 'a\\\\\\"b', 'x"y\\\\', '\\\\\\\\']) assert.strictEqual(_uncappedForTest.payloadRoundTrip('cmd', '"', v, '\\"'), v, 'cmd round trip ' + JSON.stringify(v));
  // (b) the issue's controls (no escapes) stay masked as before
  cmd(`sh -c 'srv -H "X-Api-Key: ${T}"'`, `sh -c 'srv -H "X-Api-Key: ${R}"'`, 'control: single-quoted payload');
  cmd(`sh -c 'srv --env="API_TOKEN=${T}"'`, `sh -c 'srv --env="API_TOKEN=${R}"'`, 'control: --env in single quotes');
  cmd(`powershell -Command 'srv {"name":"api_key","value":"${T}"}'`, `powershell -Command 'srv {"name":"api_key","value":"${R}"}'`, 'control: PowerShell single quotes');
  masked(['srv', '-H', 'X-Api-Key:', T], ['srv', '-H', 'X-Api-Key:', R], 'control: args without the stray quote');
  // (c) the other escape forms of each shell
  cmd(`cmd /c "srv -H \\"X-Api-Key: ${T}\\""`, `cmd /c "srv -H \\"X-Api-Key: ${R}\\""`, 'cmd /c with \\"');
  cmd(`cmd /c srv -H ^"X-Api-Key: ${T}^"`, `cmd /c srv -H ^"X-Api-Key: ${R}^"`, 'cmd /c with ^"');
  cmd(`cmd.exe /C "srv --opt=\\"token=${T}\\""`, `cmd.exe /C "srv --opt=\\"token=${R}\\""`, 'cmd.exe /C');
  cmd(`powershell -c "srv --token ""${T}"""`, `powershell -c "srv --token ${R}"`, 'PowerShell doubled quotes ""');
  cmd(`powershell -Command 'srv --opt=''token=${T}'''`, `powershell -Command 'srv --opt=''token=${R}'''`, "PowerShell '' inside '...'");
  cmd(`pwsh -NoProfile -ExecutionPolicy Bypass -Command "srv --api-key ${BT}"${T}${BT}""`, `pwsh -NoProfile -ExecutionPolicy Bypass -Command "srv --api-key ${R}"`, 'pwsh with flags and a flag value before -Command');
  cmd(`/bin/bash -o pipefail -c "srv -H \\"Authorization: Bearer ${T}\\""`, `/bin/bash -o pipefail -c "srv -H \\"Authorization: ${R}\\""`, 'bash path, -o value, then -c');
  cmd(`bash -lc "srv --token \\"${T} x\\""`, `bash -lc "srv --token ${R}"`, 'bash -lc, an escaped value with a space');
  cmd(`sh -c 'it'\\''s --token ${T}'`, `sh -c 'it'\\''s --token ${R}'`, "sh '\\'' in single quotes");
  cmd(`TOKEN=${T} sh -c "srv \\"x\\""`, `TOKEN=${R} sh -c "srv \\"x\\""`, 'text before the wrapper is masked by the usual rules');
  cmd(`sh -c "srv \\"x\\"" --token ${T}`, `sh -c "srv \\"x\\"" --token ${R}`, 'text after a sh payload word is masked by the usual rules');
  cmd(`sh -c "a \\"b\\"" && bash -c "srv --opt=\\"token=${T}\\""`, `sh -c "a \\"b\\"" && bash -c "srv --opt=\\"token=${R}\\""`, 'two wrappers in one command');
  cmd(`cmd /c "C:\\Program Files\\srv\\srv.exe" --token ${T}`, `cmd /c "C:\\Program Files\\srv\\srv.exe" --token ${R}`, 'cmd /c with a quoted path and no escape: the usual rules');
  noT(maskSecretCommand(`cmd /c "C:\\Program Files\\x.exe" --opt=\\"token=${T}\\"`), 'cmd /c: quoted path, then an escaped value');
  // backslashes in the payload are written back escaped too (CodeQL js/incomplete-sanitization #54/#55), so the shown text reads back the same
  cmd(`sh -c "cd C:\\\\x\\\\y; srv --token \\"${T}\\""`, `sh -c "cd C:\\\\x\\\\y; srv --token \\"${R}\\""`, 'sh "...": \\\\ and \\" written back as they came');
  cmd(`sh -c "a\\b --opt=\\"token=${T}\\""`, `sh -c "a\\\\b --opt=token=${R}"`, 'sh "...": a lone \\ is shown as \\\\ (same meaning in sh)');
  cmd(`sh -c a\\\\b\\ --token\\ ${T}`, `sh -c a\\\\b\\ --token\\ ${R}`, 'sh unquoted: \\\\ stays \\\\ (it was shown as \\, which sh drops)');
  for (const v of ['a\\b', 'a\\"b', 'a\\\\"b', 'end\\', 'x "y" z', 'C:\\dir\\', '\\\\\\"', '"\\\\', 'p\\\\\\q']) {
    const rt = _uncappedForTest.payloadRoundTrip;
    assert.strictEqual(rt('sh', '"', v), v, `round trip sh "...": ${v}`);
    assert.strictEqual(rt('sh', '', v), v, `round trip sh unquoted: ${v}`);
    assert.strictEqual(rt('sh', "'", v), v, `round trip sh '...': ${v}`);
    assert.strictEqual(rt('cmd', '"', v, '\\"'), v, `round trip cmd "..." with \\": ${v}`);
    assert.strictEqual(rt('cmd', '', v, '\\"'), v, `round trip cmd unquoted with \\": ${v}`);
    assert.strictEqual(rt('ps', '"', v), v, `round trip PowerShell "...": ${v}`);
  }
  // (d) nesting: two decodes are shown readable, a third level is masked whole
  cmd(`bash -c "sh -c \\"srv \\\\\\"--token ${T}\\\\\\"\\""`, `bash -c "sh -c \\"srv --token ${R}\\""`, 'two levels of escapes');
  cmd(`bash -c "sh -c \\"bash -c \\\\\\"srv \\\\\\\\\\\\\\"--token ${T}\\\\\\\\\\\\\\"\\\\\\"\\""`, `bash -c "sh -c \\"${R}\\""`, 'three levels: the script past two decodes is masked whole');
  masked(['bash', '-c', `sh -c "srv \\"--token ${T}\\""`], ['bash', '-c', `sh -c "srv --token ${R}"`], 'args: a wrapper inside the script arg');
  // (e) a quote that does not close: masked to the end of the payload
  cmd(`sh -c "srv \\"--token ${T}`, `sh -c ${R}`, 'sh payload with no closing quote');
  cmd(`powershell -Command "srv ${BT}"--token ${T}`, `powershell -Command ${R}`, 'PowerShell payload with no closing quote');
  // (f) args form: the script arg after the shell and its flag keeps that shell's escapes (cmd and PowerShell join every later arg)
  masked(['sh', '-c', `srv --opt=\\"token=${T}\\"`], ['sh', '-c', `srv --opt=\\"token=${R}\\"`], 'args: sh script with \\"');
  masked(['sh', '-c', `srv {\\\\"token\\\\":\\\\"${T}\\\\"}`], ['sh', '-c', `srv {\\\\"token\\\\":\\\\"${R}\\\\"}`], 'args: sh script with escaped JSON');
  masked(['powershell', '-Command', `srv --opt=${BT}"token=${T}${BT}"`], ['powershell', '-Command', `srv --opt="token=${R}"`], 'args: PowerShell script with backtick quotes (shown unescaped once masked)');
  masked(['powershell', '-Command', `'srv --opt=''token=${T}'''`], ['powershell', '-Command', `srv --opt='token=${R}'`], "args: PowerShell '' in a single-quoted script");
  masked(['powershell', '-Command', 'srv', `--header=${BT}"X-Api-Key:`, `${T}${BT}"`], ['powershell', '-Command', 'srv', '--header="X-Api-Key: ' + R, R], 'args: PowerShell, the script split over args');
  masked(['cmd.exe', '/d', '/c', 'srv', '--header=^"X-Api-Key:', `${T}^"`], ['cmd.exe', '/d', '/c', 'srv', '--header="X-Api-Key: ' + R, R], 'args: cmd, the script split over args');
  masked(['cmd', '/c', `srv -H ^"X-Api-Key: ${T}^"`], ['cmd', '/c', `srv -H "X-Api-Key: ${R}"`], 'args: cmd script with ^"');
  // (g) the leading unmatched quote (#369 review): the flag, header name or NAME= behind it is seen; the rest of the argument is masked
  masked(['srv', `"--token=${T}`], ['srv', `"--token=${R}`], 'unmatched quote: "--token=x');
  masked(['srv', "'--api-key", T], ['srv', "'--api-key", R], "unmatched quote: '--api-key then the value");
  masked(['srv', `"X-Api-Key: ${T}`], ['srv', `"X-Api-Key: ${R}`], 'unmatched quote: "Name: value');
  cmd(`srv "--token ${T}`, `srv "--token ${R}`, 'command: an unclosed quote runs to the end (was a [KNOWN GAP])');
  cmd(`srv "--token ${T} more`, `srv "--token ${R}`, 'command: an unclosed quote is one argument to the end, masked whole after the flag');
  cmd(`srv --opt="token=${T}`, `srv --opt="token=${R}`, 'command: a flag value with an unclosed quote');
  // (h) no over-masking: harmless commands and args come back unchanged, byte for byte
  for (const same of [`sh -c "echo hello"`, `sh -c "echo \\"hello world\\""`, `bash -lc 'npm run build && npm test'`, `powershell -Command "Write-Host ${BT}"hi there${BT}""`,
    `pwsh -c "Get-ChildItem ""C:\\Program Files"""`, `powershell -Command 'Write-Host ''hi'''`, `cmd /c "echo \\"hi\\""`, `cmd /c echo ^"hi^"`, `cmd /c "echo ^"hi^" & dir"`, `cmd /c dir C:\\Users\\me`,
    `sh -c "cd \\"$HOME\\" && ls"`, `sh -c "printf \\"%s\\\\n\\" a"`, `node -e "console.log(\\"hi\\")"`, `bash -c "sh -c \\"echo \\\\\\"x y\\\\\\"\\""`]) {
    assert.strictEqual(maskSecretCommand(same), same, 'no over-masking: ' + same);
  }
  for (const same of [['sh', '-c', 'echo "a \\"b\\""'], ['powershell', '-Command', `Write-Host ${BT}"hi${BT}"`], ['cmd', '/c', 'echo', '^"hi^"'], ['srv', '"hello', 'world"'], ['srv', "it's"]]) {
    assert.deepStrictEqual(maskSecretArgs(same), same, 'no over-masking: ' + JSON.stringify(same));
  }
  // (i) cost: wrapper shapes stay linear (50k vs 400k, 3 interleaved pairs, min CPU time of each (cpuMs, T068); linear is about 8, quadratic about 64)
  const run = (x: string): void => { _uncappedForTest.maskSecretArgs(['sh', '-c', x]); _uncappedForTest.maskSecretArgs(['powershell', '-Command', x]); _uncappedForTest.maskSecretCommand(x); };
  for (const unit of ['sh -c "x \\"y\\"" ', `powershell -Command "a ${BT}" `, 'cmd /c a ^" ', 'bash -c "sh -c \\"a ', "pwsh -c 'a '' ", '"--token ']) {
    const mk = (n: number): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
    const time = (x: string): number => cpuMs(() => run(x), 8000);
    let tSmall = Infinity;
    let tBig = Infinity;
    for (let i = 0; i < 3; i++) { tSmall = Math.min(tSmall, time(mk(50_000))); tBig = Math.min(tBig, time(mk(400_000))); }
    const ratio = tBig / Math.max(tSmall, 20);
    console.log(`redact: 14d linearity ${JSON.stringify(unit)} 50k=${Math.round(tSmall)} ms 400k=${Math.round(tBig)} ms ratio ${ratio.toFixed(1)}`);
    assert.ok(tBig < 8000 && ratio < 24, `14d: ${JSON.stringify(unit)} grew too fast: ${tSmall} -> ${tBig} ms (ratio ${ratio.toFixed(1)})`);
  }
  // review of #455 item 1: one long backslash run after a cmd wrapper (no quote after it) is not retried from each position
  for (const head of ['cmd /c ^x ', 'cmd /c \\"x ']) {
    const time = (n: number): number => { const x = head + '\\'.repeat(n); return cpuMs(() => { _uncappedForTest.maskSecretCommand(x); }, 8000); };
    let tSmall = Infinity;
    let tBig = Infinity;
    for (let i = 0; i < 3; i++) { tSmall = Math.min(tSmall, time(50_000)); tBig = Math.min(tBig, time(400_000)); }
    const ratio = tBig / Math.max(tSmall, 20);
    console.log(`redact: 14d linearity ${JSON.stringify(head)} + run 50k=${Math.round(tSmall)} ms 400k=${Math.round(tBig)} ms ratio ${ratio.toFixed(1)}`);
    assert.ok(tBig < 8000 && ratio < 24, `14d: ${JSON.stringify(head)} + backslash run grew too fast: ${tSmall} -> ${tBig} ms (ratio ${ratio.toFixed(1)})`);
  }
  // the public helpers still hide a string over MASK_INPUT_MAX whole, before the wrapper decode
  assert.strictEqual(maskSecretCommand('sh -c "' + 'a \\"'.repeat(MASK_INPUT_MAX) + '"'), R, '14d: over MASK_INPUT_MAX, hidden whole');
}

// 15. T054: `cut` stops at a token boundary and never leaves half a surrogate pair
{
  const words = Array.from({ length: 900 }, () => 'abcdef').join(' '); // 6-letter words, period 7: 4096 % 7 != 0, so a character cut lands mid-word
  const c = cut(words, 4096);
  assert.ok(c.endsWith(' [truncated]'), 'marker');
  const body = c.slice(0, -' [truncated]'.length);
  assert.ok(body.length <= 4096 && /abcdef$/.test(body) && body.split(' ').every((w) => w === 'abcdef'), 'ends on a whole word');
  assert.strictEqual(cut('abc', 4096), 'abc');
  const emoji = cut('a '.repeat(2047) + 'a' + '\u{1F600}', 4096);
  assert.ok(!/[\ud800-\udbff] \[truncated\]$/.test(emoji) && !/[\ud800-\udbff]$/.test(emoji.slice(0, -12)), 'no lone surrogate');
  const emoji2 = cut('a'.repeat(4095) + '\u{1F600}', 4096);
  assert.ok(!/[\ud800-\udbff]/.test(emoji2), 'no lone surrogate (4095 a + emoji)');
}

// 16. guard: the test-only uncapped entry is used by tests only (nothing under src/ except its own file)
{
  const root = path.join(__dirname, '..', '..'); // compiled: dist/scripts -> repo root
  const srcRoot = fs.existsSync(path.join(root, 'src')) ? root : path.join(__dirname, '..'); // run with tsx: scripts -> repo root
  assert.ok(fs.existsSync(path.join(srcRoot, 'src', 'shared', 'redact.ts')), 'guard found src/');
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(?:ts|js|mjs|cjs|html)$/.test(e.name)) continue;
      const rel = path.relative(srcRoot, p).split(path.sep).join('/');
      if (rel === 'src/shared/redact.ts') continue;
      if (fs.readFileSync(p, 'utf8').includes('_uncappedForTest')) offenders.push(rel);
    }
  };
  walk(path.join(srcRoot, 'src'));
  assert.deepStrictEqual(offenders, [], 'used in: ' + offenders.join(', '));
}

console.log('redact: all checks passed');
