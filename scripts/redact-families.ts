/**
 * The shared mask's token families, one or more made-up samples each (spec 012 FR-080 delta 2026-11-01, T137), shared by `test-redact-shapes.ts`
 * and `test-ipcthrow.ts` (spec 045 FR-066's differential). Every sample is built at run time, so no secret-looking literal sits in a file.
 */
/** A made-up run of n characters from a class: not random (a test that fails must fail the same way) and never a real key. */
export const run = (n: number, chars = 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7'): string => { let s = ''; while (s.length < n) s += chars; return s.slice(0, n); };
export const an = (n: number): string => run(n); // letters and digits
export const hex = (n: number): string => run(n, '0a1b2c3d4e5f6a7b8c9d');
export const up = (n: number): string => run(n, 'AB3DE6GH2JK7MN5PQ4ST');
export const lo = (n: number): string => run(n, 'a3b6c9d2e5f8g1h4j7k');

/** family -> samples: each array member of `PREFIXED`, `TOKEN_SHAPES` or `PATTERNS` has its family, and removing it fails here. */
export const FAMILIES: Record<string, string[]> = {
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
