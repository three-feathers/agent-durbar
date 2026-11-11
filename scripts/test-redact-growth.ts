/**
 * The growth and adversarial runs of the shared mask, one part per suite (spec 012 T137, issue #1009; they were sections of test-redact.ts, which went over the 30 s rule). The same
 * checks: a try that passes stops the retries, like `assertLinearGrowth`, so a pass costs one pair of runs and a real failure still gets every try.
 * `node dist-scripts/scripts/test-redact-growth.js <part>`.
 */
import * as assert from 'assert';
import { REDACT_MAX_CHARS, _uncappedForTest, bareStepsForTest, redact } from '../src/shared/redact';
import { spawnSync } from 'child_process';
import { assertLinearGrowth, assertLinearShape, assertWithinYardstick, cpuMs, worstGrowth, workerRun } from './redact-growth-lib';

const part = process.argv[2];
const BT = '`';

if (part === 'tokens') {
// same-run growth for the new shapes (review of PR #679): the same call on an input 16 times longer must cost about 16 times more, not 256.
// It goes through `assertLinearGrowth` (CPU time, best of 3, floor, per-OS timer step; retro #854 A2: the old ad hoc wall-like ratio of two
// tiny timings failed twice on Windows CI). A prefix of the repeated unit has the same shape; a `Dot` case adds its tail inside `run`.
{
  const units: Record<string, string> = {
    slackSession: 'xo' + 'xd-%2B-',
    slackHook: 'hooks.slack.com/workflows/a/b/',
    slackHookPort: 'hooks.slack.com.:443//triggers//a//',
    discordHook: 'discord.com.:443//api//webhooks//1234567//',
    tgBotLookbehind: '/bot1234567:',
    tgFile: 'api.telegram.org/file/bot123456:',
    tgIds: '123456789012:',
    discordBot: 'M' + 'T' + 'a'.repeat(24) + '.abcdef.',
    discordBotRun: 'M' + 'T' + 'a'.repeat(30) + ' ',
    discordBotM: 'M',
    discordBotMDash: 'M-',
    discordBotMDot: 'M', // plus a `.abcdef.` tail so the cheap marker lets it through
  };
  for (const [k, unit] of Object.entries(units)) {
    const tail = k.endsWith('Dot') ? '.abcdef.' : '';
    const input = unit.repeat(Math.ceil(256_000 / unit.length));
    const run = (text: string, reps = 1): { cpu: number; wall: number } => {
      let wall = 0;
      const cpu = cpuMs(() => { const w = process.hrtime.bigint(); for (let i = 0; i < reps; i++) redact(text + tail, {}); wall = Number(process.hrtime.bigint() - w) / 1e6; }, 1000 * reps);
      return { cpu: cpu / reps, wall };
    };
    run(input.slice(0, 16_000)); // warm up
    assertLinearGrowth(`growth ${k}`, run, input, 100, 16); // 256k vs 16k x 16 runs
  }
}
// spec 012 T138 delta 2026-11-11: the retry baseline of `assertLinearGrowth` without timers. A Windows-like reading (PR 1510): one run of the 1/16 input reads one timer step,
// 16 runs in one timing read the true mean. The old method (no `retryReps`) fails linear code there; the new one passes it and still fails a quadratic cost.
{
  const tick = 15.625;
  const fake = (cost: (n: number) => number) => (x: string, reps = 1): { cpu: number; wall: number } =>
    ({ cpu: reps === 1 && x.length < 100_000 ? tick : (Math.floor((cost(x.length) * reps) / tick) * tick) / reps, wall: 0 });
  const big = 'x'.repeat(1_000_000);
  const linear = fake((n) => 0.7e-3 * n);
  const quadratic = fake((n) => 2000 * (n / 1e6) ** 2);
  const worst = { ...worstGrowth };
  assert.throws(() => assertLinearGrowth('fake linear, one-run baseline', linear, big, 100, 1), /fake linear, one-run baseline: 687\.5 ms CPU .*limit 40/);
  assertLinearGrowth('fake linear, retry baseline', linear, big, 100, 1, undefined, 16);
  assert.throws(() => assertLinearGrowth('fake quadratic, retry baseline', quadratic, big, 100, 1, undefined, 16), /fake quadratic, retry baseline: .*\(ratio \d/);
  Object.assign(worstGrowth, worst);
}
}

if (part === 'adversarial' || part === 'adversarial2' || part === 'masks') {
// 9. adversarial 1 MB inputs: every pattern stays linear (growth against a same-shape quarter-size input, no fixed time limit)
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
    // starts after `_` (spec 012 FR-080 delta 2026-10-22): runs of underscore-led and snake_case-glued shapes
    ghUnder: '_ghp_'.repeat(MB / 5),
    ghGlued: 'a_ghp_'.repeat(MB / 6),
    patUnder: '_github_pat_'.repeat(MB / 12),
    skUnder: '_sk-'.repeat(MB / 4),
    skShort: ('_sk-' + 'a'.repeat(19) + ' ').repeat(MB / 24),
    bearerUnder: '_Bearer _'.repeat(MB / 9),
    authUnder: '_authorization '.repeat(MB / 15),
    urlUnder: '_a://x:'.repeat(MB / 7),
    jwtUnder: '___eyJ'.repeat(MB / 6),
    jwtUnderDot: '_eyJaaaaa.'.repeat(MB / 10),
    jwtUnderLong: '_eyJ' + 'a_'.repeat(MB / 2),
    // T128: the JWT's bounded prefix (underscores and up to 4 snake_case words)
    jwtGlued: ('a_eyJ'.repeat(4) + 'a'.repeat(4000)).repeat(MB / 4020),
    jwtWords40: (' ' + 'a'.repeat(40) + '_').repeat(MB / 42),
    jwtWords5: (' ' + ('a'.repeat(40) + '_').repeat(5) + 'eyJ' + 'b'.repeat(4096)).repeat(MB / 4400),
    jwtWordsDot: (' a_b_c_d_eyJaaaaa.aaaaa').repeat(MB / 23),
    jwtUnderRun: '_'.repeat(MB),
    awsUnder: '_AKIA'.repeat(MB / 5),
    // T129: starts right after a percent-encoded byte (`%XX`, `%25XX`)
    pct: '%3D'.repeat(MB / 3),
    pctDouble: '%25'.repeat(MB / 3),
    pctGh: '%3Dghp_'.repeat(MB / 7),
    pctGhLong: '%3Dghp_' + 'a'.repeat(MB),
    pctPat: '%3Dgithub_pat_'.repeat(MB / 14),
    pctSk: '%253Dsk-'.repeat(MB / 8),
    pctSkShort: ('%3Dsk-' + 'a'.repeat(19) + ' ').repeat(MB / 26),
    pctBearer: '%22Bearer '.repeat(MB / 10),
    pctAuth: '%22authorization '.repeat(MB / 17),
    pctUrl: '%3Da://x:'.repeat(MB / 9),
    pctUrlLong: '%3Da://x:' + 'y'.repeat(MB),
    pctAws: '%3DAKIA'.repeat(MB / 7),
    pctJwt: '%3DeyJ'.repeat(MB / 6),
    pctJwtLong: ('%3DeyJ' + 'a'.repeat(4090)).repeat(MB / 4096),
    pctJwtWords: ('%3D' + ('a'.repeat(40) + '_').repeat(4) + 'eyJ' + 'b'.repeat(4096) + '.').repeat(MB / 4268),
    pctJwtDot: '%3DeyJaaaaa.'.repeat(MB / 12),
    // T130: any depth of `%25`, and starts after a backslash escape (the debug log's JSON escapes)
    pct25Run: '25'.repeat(MB / 2),
    pctDeepGh: '%25%25%253Dghp_'.repeat(MB / 15),
    pctDeepLong: '%' + '25'.repeat(MB / 2) + '3Dghp_' + 'a'.repeat(1000),
    escN: '\\n'.repeat(MB / 2),
    escNN: '\\\\n'.repeat(MB / 3),
    escNGh: '\\nghp_'.repeat(MB / 6),
    escNGhLong: '\\nghp_' + 'a'.repeat(MB),
    escU: '\\u003d'.repeat(MB / 6),
    escXSk: '\\x3dsk-'.repeat(MB / 7),
    escTJwt: '\\teyJaaaaa.'.repeat(MB / 11),
    escNUrl: '\\na://x:'.repeat(MB / 8),
    // T132: Slack, Discord and Telegram shapes, and the `=XX` / `%uXXXX` starts
    slackTok: 'xoxb-'.repeat(MB / 5),
    slackShort: ('xoxb-' + 'a'.repeat(9) + ' ').repeat(MB / 15),
    slackLong: 'xapp-' + 'a-'.repeat(MB / 2),
    slackPct: '%3Dxoxp-'.repeat(MB / 8),
    slackHook: 'hooks.slack.com/services/'.repeat(MB / 25),
    slackHookSeg: 'hooks.slack.com/services/' + 'a/'.repeat(MB / 2),
    slackHookLong: 'hooks.slack.com/services/' + 'a'.repeat(MB),
    slackHookEsc: 'hooks.slack.com\\/services\\/' + 'a\\/'.repeat(MB / 3),
    discordHook: 'discord.com/api/webhooks/'.repeat(MB / 25),
    discordHookLong: 'discordapp.com/api/webhooks/' + '1'.repeat(MB),
    discordHookTok: 'discord.com/api/webhooks/1234567/' + 'a'.repeat(MB),
    discordHookRun: 'discord.com/api/webhooks/1234567/aaaaaaaaaaaaaaaaaaa '.repeat(MB / 52),
    tgDigits: '1'.repeat(MB),
    tgColon: '123456:'.repeat(MB / 7),
    tgShort: ('123456789:' + 'a'.repeat(29) + ' ').repeat(MB / 40),
    tgLong: '123456789:' + 'a'.repeat(MB),
    tgApi: 'api.telegram.org/bot'.repeat(MB / 20),
    tgApiLong: 'api.telegram.org/bot123456:' + 'a'.repeat(MB),
    tgPct: '%3D123456789%3A'.repeat(MB / 15),
    tgPct25: '25'.repeat(MB / 4) + ':' + '25'.repeat(MB / 4),
    qpRun: '=3D'.repeat(MB / 3),
    qpGh: '=3Dghp_'.repeat(MB / 6),
    qpGhLong: '=3Dghp_' + 'a'.repeat(MB),
    uRun: '%u003D'.repeat(MB / 6),
    uSk: '%u003Dsk-'.repeat(MB / 9),
    uSlack: '%u003Dxoxb-'.repeat(MB / 11),
  };
  // Each case runs in a worker thread that times redact() itself with the thread's own CPU time (`process.threadCpuUsage()`, Node 22
  // and later; wall time from `hrtime` only on Node 20.19, which has no per-thread CPU time), so a busy runner cannot fail the test;
  // the growth ratio against a quarter-size input of the same shape is the real ReDoS check (`assertLinearGrowth`, #684), and wall time has a loose backstop (spec 041 `## Changes` 2026-10-22,
  // review of PR #527). Workers, not child processes: a child fed 1 MB on stdin hung for 30 s twice on a busy macOS runner (#303).
  // The test stays synchronous: the worker writes the time into shared memory and wakes this thread (Atomics), with a 30 s hang
  // guard; a worker that does not answer in time is stopped and the case retried once.
  const mod = require.resolve('../src/shared/redact');
  const code = `const {workerData:w}=require('worker_threads');const flag=new Int32Array(w.sab,0,1),out=new Float64Array(w.sab,8,2);` +
    `try{const {redact}=require(w.mod);const reps=w.reps||1;redact(w.input.slice(0,4096),{});const tc=typeof process.threadCpuUsage==='function';const w0=process.hrtime.bigint(),c0=tc?process.threadCpuUsage():null;for(let i=0;i<reps;i++)redact(w.input,{});const wall=Number(process.hrtime.bigint()-w0)/1e6/reps;let cpu=wall;if(tc){const d=process.threadCpuUsage(c0);cpu=(d.user+d.system)/1000/reps}out[0]=cpu;out[1]=wall;Atomics.store(flag,0,1)}` +
    `catch(e){Atomics.store(flag,0,2)}Atomics.notify(flag,0)`;
  // two suites, each case in one (over 30 s on Windows as one)
  // the cases of the masking batch of 2026-11-08 (spec 012 FR-173/FR-174, PR 1317) are their own suite, so the two above stay under 30 s
  const maskCases: Record<string, string> = {
    // spec 012 FR-173/FR-174 (pre-review of PR 1317): the glued-rest scan (a literal mask in the text is enough to start it) and the quote runs inside a secret name
    glueMasks: '[redacted]a-'.repeat(MB / 12),
    glueRun: '[redacted]' + 'a'.repeat(MB),
    glueDots: '[redacted]' + '.'.repeat(MB),
    glueSlash: '[redacted]/'.repeat(MB / 11),
    quotesRun: 'pa' + '"'.repeat(MB) + 'ssword=Hunter2Secret99',
    quotesPairs: 'pa"'.repeat(MB / 3),
    quotesNames: 'p"a"s"s"w"o"r"'.repeat(MB / 14),
    quotesMixed: 'to' + "'\\".repeat(MB / 6) + 'ken=Hunter2Secret99',
    // review of PR 1317 (Ruben): quote runs, empty backtick pairs and `$()` between a name and its separator or its value, and a glued rest before a secret name
    quotesEnd: 'password' + '"'.repeat(MB) + '=Hunter2Secret99',
    quotesEndPairs: 'password"'.repeat(MB / 9),
    quotesValue: 'password=' + "'".repeat(MB),
    quotesValuePairs: "password=''".repeat(MB / 11),
    emptySubst: 'pa$()'.repeat(MB / 5),
    emptyBackticks: 'pa``'.repeat(MB / 4),
    glueNames: '[redacted]-dbpassword: "'.repeat(MB / 24),
    // review of PR 1317, round 2: a bare run with no name (a lookbehind over it was retried at every position), with a separator in it, and line continuations
    bareQuotes: "'".repeat(MB),
    bareBackslashes: '\\'.repeat(MB),
    bareBackticks: '`'.repeat(MB),
    bareMixedSep: '"\'`\\='.repeat(MB / 5),
    bareQuotesColon: "':".repeat(MB / 2),
    lineContinuations: 'pa\\\n'.repeat(MB / 4),
    spacedSubst: 'pa$(  )'.repeat(MB / 7),
    // round 3: line continuations before a value
    valueContinuations: 'password=\\\n'.repeat(MB / 11),
    valueContinuationRun: 'password=' + '\\\n'.repeat(MB / 2),
  };
  for (const [k, v] of part === 'masks' ? Object.entries(maskCases) : Object.entries(adversarial).filter((_e, i) => i % 2 === (part === 'adversarial' ? 0 : 1))) assertLinearGrowth(`adversarial ${k}`, (input, reps) => workerRun(`adversarial ${k}`, code, { mod, input, reps }, 30000), v, 100, 1, undefined, 16);
  // spec 012 T138 delta 2026-11-11 (PR 1510's Windows run): (1) each worker first masks 4 KB of the same input untimed, so the compile costs of a fresh worker (about 20-30 ms on
  // Linux) no longer sit in the 1/16 baseline, where they hid a quadratic rule (ratio 29 instead of 65); (2) a try that fails times the baseline again as 16 runs in one worker and
  // takes the mean (`retryReps`): one run of 62,500 characters read 15.0 ms of thread CPU on Windows (one timer step, clamped to 16), so the check was a fixed 640 ms limit there,
  // and Node 22 takes 730-920 ms on 1 MB of digits on Linux, linearly. A pass on the first try costs what it did. Mutant: a quadratic scan before the mask fails the same check.
  if (part === 'masks') {
    const wrap = 'const {redact}=require(w.mod);';
    assert.ok(code.includes(wrap), 'mutant applies to the worker source');
    const quadratic = code.replace(wrap, "const {redact:r0}=require(w.mod);const redact=(s,o)=>{let a=0;for(let i=0;i<s.length;i+=8)for(let j=i;j<s.length;j+=8)a+=s.charCodeAt(j);return a<0?'':r0(s,o)};");
    const input = '1'.repeat(192_000);
    const worst = { ...worstGrowth }; // the mutant's ratio is not the code's
    assert.throws(() => assertLinearGrowth('mutant quadratic', (x, reps) => workerRun('mutant quadratic', quadratic, { mod, input: x, reps }, 30000), input, 100, 1, undefined, 16), /mutant quadratic: .* \(ratio \d/);
    Object.assign(worstGrowth, worst);
  }
}

}

if (part === 'r11') {
    // cost: a long run of `Bearer ` words and many escaped R7 objects (same interleaved ratio as the block below)
    const rshapes: Array<[string, string]> = [['Bearer ', 'Bearer '], ['--auth Bearer ', '--auth Bearer '], ['obj', '{\\"name\\":\\"token\\",\\"value\\":\\"x y\\"} '], ['arr', '{\\"name\\":\\"token\\",\\"value\\":[\\"x\\"]} '], ['hdr', 'Authorization: Bearer '], ['qhdr', '-H "Authorization: Bearer" '], ['eq', '--auth=Bearer '], ['sq', "Authorization: 'a "], ['dq', 'Authorization: "a '], ['mixed', `Authorization: "a Authorization: 'a `], ['tok', 'TOKEN=Auth: '], ['unclosed', 'x Authorization: "a '], ['unclosed1', "Cookie: 'a "], ['schemeq', 'Authorization: Basic "a '], ['argsq', 'curl Authorization: "a ']];
    const work = (x: string): void => { _uncappedForTest.maskSecretArgs([x]); _uncappedForTest.maskSecretArgs(['-c', x]); _uncappedForTest.maskSecretCommand(x); };
    for (const [, unit] of rshapes) assertLinearShape(`14c R11/R7 ${JSON.stringify(unit)}`, work, (n) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n));
}

if (part === 'args') {
  // (n) timing: each shape linear in practice; doubling check on the shape the analyst suspected.
  const shapes: Array<[string, string]> = [['-c ', '-c '], ['"', '"'], ['"a ', '"a '], ["a 'b", "a 'b"], [', a=', ', a='], ['Cookie: ', 'Cookie: '], ['{"a":"x y ', '{"a":"x y '], ["'\"", "'\""], ['x ', 'x ']];
  const run = (x: string): void => { _uncappedForTest.maskSecretArgs([x]); _uncappedForTest.maskSecretArgs(['-c', x]); _uncappedForTest.maskSecretCommand(x); };
  for (const [name, unit] of shapes.filter(([n]) => !['{"a":"x y ', 'x ', '"a '].includes(n))) assertLinearShape(`14c 200k ${name}`, run, (n) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n), 200_000);
  for (const unit of ['{"a":"x y ', 'x ', '"a ']) assertLinearShape(`14c linearity ${JSON.stringify(unit)}`, run, (n) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n));
}

if (part === 'runs') {
  const run = (x: string): void => { _uncappedForTest.maskSecretArgs([x]); _uncappedForTest.maskSecretArgs(['-c', x]); _uncappedForTest.maskSecretCommand(x); };
  // single-character runs (a regex with an unanchored `+$`, or overlapping classes, is quadratic here): the same growth check
  const runs: Array<[string, (n: number) => string]> = [
    [';;; x', (n) => ';'.repeat(n) + ' x'], ['&&& x', (n) => '&'.repeat(n) + ' x'], ['||| x', (n) => '|'.repeat(n) + ' x'], ['a``` x', (n) => 'a' + '`'.repeat(n) + ' x'],
    [';;;x y', (n) => ';'.repeat(n) + 'x y'], ['&&&x y', (n) => '&'.repeat(n) + 'x y'], ['|||x y', (n) => '|'.repeat(n) + 'x y'], ['a```b y', (n) => 'a' + '`'.repeat(n) + 'b y'],
  ];
  for (const [name, gen] of runs) assertLinearShape(`14c run ${name}`, run, gen);
}

if (part === 'wrappers') {
  // (i) cost: wrapper shapes stay linear
  const run = (x: string): void => { _uncappedForTest.maskSecretArgs(['sh', '-c', x]); _uncappedForTest.maskSecretArgs(['powershell', '-Command', x]); _uncappedForTest.maskSecretCommand(x); };
  for (const unit of ['sh -c "x \\"y\\"" ', `powershell -Command "a ${BT}" `, 'cmd /c a ^" ', 'bash -c "sh -c \\"a ', "pwsh -c 'a '' ", '"--token ']) assertLinearShape(`14d linearity ${JSON.stringify(unit)}`, run, (n) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n));
  // review of #455 item 1: one long backslash run after a cmd wrapper (no quote after it) is not retried from each position
  for (const head of ['cmd /c ^x ', 'cmd /c \\"x ']) assertLinearShape(`14d linearity ${JSON.stringify(head)} + backslash run`, (x) => { _uncappedForTest.maskSecretCommand(x); }, (n) => head + '\\'.repeat(n));
}

if (part === 'hashtable') {
  // Adversarial runs: 1 MB in one arg when it has no space (the scanner and the arg path), and 50k through every path (split into words, command, -c payload).
  // A worker warms the code up on the first 5000 characters (so the baseline does not carry the cold start) and times each with the thread's CPU time, like section 9, and the growth check is the same. The words-and-spaces paths cost seconds per MB even without R12
  // (the control rows of 14c and 14d run at 200k), so a text with spaces uses 50k.
  const MB = 1_000_000;
  const adv: Record<string, string> = {
    repeatOpen: '@{'.repeat(MB / 2),
    repeatOpenSp: '@{ '.repeat(MB / 3),
    unclosed: '@{ token = "' + 'a'.repeat(MB),
    unclosedBare: '@{ token = ' + 'a'.repeat(MB),
    noEquals: '@{' + 'x ;'.repeat(MB / 3),
    noEqualsLong: '@{' + 'x'.repeat(MB),
    manyLiterals: '@{a=b;'.repeat(MB / 12), // 500 KB, same reason
    manyLiteralsLong: ('@{a=b;' + 'x'.repeat(3000)).repeat(MB / 3006),
    secretMembers: '@{' + 'token=a;'.repeat(MB / 16), // 500 KB: 1 MB of KEY=value words costs ~800 ms even on main
    quotesDoubled: '@{token=' + "'''".repeat(MB / 3),
    namesOnly: '@{' + '"n" '.repeat(MB / 4),
    tickRun: '@{token="' + '`'.repeat(MB),
    nested: '@{a=@{'.repeat(MB / 6),
    nestedSecret: '@{token=@{'.repeat(MB / 10),
    exprs: '@{token=(' + 'a + '.repeat(MB / 4),
    herestr: "@{token=@'" + 'x'.repeat(MB),
    hereOpeners: "@{a=@'".repeat(MB / 6),
    strayQuotes: ('@{' + '"'.repeat(3000) + '}').repeat(MB / 3003),
    strayQuotesSq: ("@{" + "'".repeat(3000) + '}').repeat(MB / 3003),
    quotedJunk: ('@{' + "'a b' ".repeat(500) + '}').repeat(MB / 3503),
    commentOpeners: '@{<#'.repeat(MB / 4),
    unclosedComment: '@{<#' + 'a'.repeat(MB),
    pastBound: '@{' + 'p=1;'.repeat(MB / 4),
    unclosedMany: '@{token="a;'.repeat(MB / 11),
  };
  const mod = require.resolve('../src/shared/redact');
  const code = `const {workerData:w}=require('worker_threads');const flag=new Int32Array(w.sab,0,1),out=new Float64Array(w.sab,8,2);` +
    `try{const {_uncappedForTest:u}=require(w.mod);const go=(x)=>[()=>u.maskSecretArgs([x]),()=>u.maskSecretArgs(['pwsh','-c',x]),()=>u.maskSecretArgs(x.split(' ')),()=>u.maskSecretCommand(x),()=>u.maskSecretCommand('pwsh -c '+JSON.stringify(x))][w.path]();go(w.input.slice(0,5000));const tc=typeof process.threadCpuUsage==='function';const reps=w.reps||1;const w0=process.hrtime.bigint(),c0=tc?process.threadCpuUsage():null;for(let i=0;i<reps;i++)go(w.input);const wall=Number(process.hrtime.bigint()-w0)/1e6/reps;let cpu=wall;if(tc){const d=process.threadCpuUsage(c0);cpu=(d.user+d.system)/1000/reps}out[0]=cpu;out[1]=wall;Atomics.store(flag,0,1)}` +
    `catch(e){Atomics.store(flag,0,2)}Atomics.notify(flag,0)`;
  const cases = Object.entries(adv).flatMap(([k2, v2]) => (/\s/.test(v2) ? [] : [[k2, v2, 0]]).concat([0, 1, 2, 3, 4].map((i) => [k2 + '-50k', v2.slice(0, 50_000), i])) as Array<[string, string, number]>);
  // a try that fails times the 1/16 baseline as 16 runs (T138 delta 2026-11-11)
  const r12Grow = (k: string, src: string, v: string, pi: number): void => assertLinearGrowth(k, (input, reps) => workerRun(k, src, { mod, input, path: pi, reps }, 60000), v, 100, 1, undefined, 16);
  for (const [k0, v, pi] of cases) {
    const k = `R12 adversarial ${k0} (path ${pi})`;
    r12Grow(k, code, v, pi);
  }
  // spec 012 T160: the R12 worker's own checks, with a worker whose masking is a timed busy loop (no timers faked: the worker reads its own clock).
  // (1) `reps` runs one timing and gives the mean per run: 16 runs of 20 ms read about 20 ms, not 1.3 (no loop) and not 320 (no division);
  // (2) the retry baseline is used: a worker that does no work for a one-run baseline of the short input (as a Windows tick can read) fails the first try,
  // and passes only when the retry baseline runs 16 times; a quadratic cost still fails.
  {
    const wrap = 'const {_uncappedForTest:u}=require(w.mod);';
    assert.ok(code.includes(wrap), 'R12 mutants apply to the worker source');
    const busy = (body: string): string => code.replace(wrap, `const {_uncappedForTest:u0}=require(w.mod);const busy=(ms)=>{const t=process.hrtime.bigint();while(Number(process.hrtime.bigint()-t)/1e6<ms);};const u={maskSecretArgs:(a)=>{${body};return u0.maskSecretArgs(a)}};`);
    const fixed = busy('busy(20)');
    const cpuOf = (reps: number): number => Math.min(...[0, 1, 2].map(() => workerRun('R12 reps', fixed, { mod, input: 'x'.repeat(5000), path: 0, reps }, 60000).cpu));
    const one = cpuOf(1);
    const sixteen = cpuOf(16);
    assert.ok(one > 15 && one < 60 && sixteen > 15 && sixteen < 60, `R12 worker: reps=1 reads ${one.toFixed(1)} ms and reps=16 reads ${sixteen.toFixed(1)} ms for a 20 ms run each (mean per run expected)`);
    const input = 'x'.repeat(192_000);
    const worst = { ...worstGrowth };
    // linear, 0.7 ms per 1000 characters, but nothing for one run of the short input
    r12Grow('R12 mutant linear, one-run baseline reads 0', busy('if(w.reps===1&&a[0].length<100000)return u0.maskSecretArgs(a);busy(a[0].length*0.0007)'), input, 0);
    assert.throws(() => r12Grow('R12 mutant quadratic', busy('busy(a[0].length*a[0].length*8e-9)'), input, 0), /R12 mutant quadratic: .* \(ratio \d/);
    Object.assign(worstGrowth, worst);
  }
}

if (part === 'hashtablegrowth') {
  const MB = 1_000_000;
  // growth: 4x the input costs about 4x (the same run, min CPU of 3 interleaved pairs, like the OAuth rule test), for the shapes that could go quadratic
  {
    const shapes: Record<string, (n: number) => string> = {
      repeatOpen: (n) => '@{'.repeat(n / 2), manyLiterals: (n) => '@{a=b;'.repeat(n / 6), nested: (n) => '@{a=@{'.repeat(n / 6), nestedSecret: (n) => '@{token=@{'.repeat(n / 10),
      unclosedQuote: (n) => '@{token="' + 'a'.repeat(n), longBare: (n) => '@{token=' + 'a'.repeat(n), hereOpeners: (n) => "@{a=@'".repeat(n / 6),
      strayQuotes: (n) => ('@{' + '"'.repeat(3000) + '}').repeat(n / 3003), quotedJunk: (n) => ('@{' + "'a b' ".repeat(500) + '}').repeat(n / 3503),
      commentOpeners: (n) => '@{<#'.repeat(n / 4), unclosedComment: (n) => '@{<#' + 'a'.repeat(n), pastBound: (n) => '@{' + 'p=1;'.repeat(n / 4), noEquals: (n) => '@{' + 'x;'.repeat(n / 2),
    };
    for (const [k, mk] of Object.entries(shapes)) assertLinearShape(`R12 growth ${k}`, (x) => { _uncappedForTest.maskSecretCommand(x); _uncappedForTest.maskSecretArgs([x]); }, mk);
  }
  // an unclosed quote or a long bare value of a secret member hides the rest of the text, so the pattern rules do not run over 1 MB again
  // (they cost 25 times `redact` on this path before; about 1 time now), against `redact` on the same text in the same run (spec 012 T138)
  for (const [k, v] of [['unclosed double quote', '@{token="' + 'a'.repeat(MB)], ['unclosed single quote', "@{'api_key'='" + 'a'.repeat(MB)], ['long bare value', '@{ token = ' + 'a'.repeat(MB)]] as const) {
    assertWithinYardstick(`R12: ${k} on 1 MB, command and args paths`, () => { _uncappedForTest.maskSecretCommand(v); _uncappedForTest.maskSecretArgs([v]); }, () => void redact(v, {}), 6);
  }
}

if (part === 'shapes' || part === 'shapes2') {
// Linear, part 2: adversarial runs, in a child with a hard stop, so a stall fails instead of hanging. CPU time on 1/16 of the input and on all of it
// (the same method as `assertLinearGrowth` in test-redact.ts, limit 40 for 16x; never a wall-clock ratio), then one whole REDACT_MAX_CHARS run.
{
  // issue #1227 (spec 012 FR-170): the rules of the gap fix, each with the shape that makes it try the most; also `password=` repeated (a required tail after the value was quadratic: 22 s at 256 KB)
  const gapUnits: Record<string, string> = {
    mysqlContinued: 'mysql \\\n', mysqlContinuedCrlf: 'mysql a \\\r\n', mysqlBackslashes: 'mysql ' + '\\'.repeat(150) + ' ', bearerColon: 'Bearer: ', bearerColonLong: 'Bearer: ' + 'a1'.repeat(40) + ' ', spacedName: 'secret access key: ', spacedNameLong: 'aws secret access key = ' + 'aB3/'.repeat(10) + ' ', spacedNameRun: 'secret   access   ',
    maskedPhrase: 'pwd=[redacted] a1 ', maskedPhraseRun: 'password: [redacted]' + ' ab12'.repeat(20) + ' ', maskedPhraseNo: 'pwd=[redacted] x ', mysqlSeps: 'mysql a;b&c|d ', mysqlTick: 'mysql `\n', mysqlCaret: 'mysql ^\r\n', mysqlUpper: 'MySQL8 ' + 'a '.repeat(90), bearerStops: 'Bearer a) ', bearerQuote: 'Bearer ab! "', bearerNoSpace: 'BEARER ab12:', shortVersion: 'token: v1.2.3.4.5.6.7 ', shortHex: 'token: 0x1f ', shortAlgo: 'token: PKCS#1 ', shortHash: 'token: #ff00 ',
    passwordRun: 'password=', pwdRun: 'pwd:', mysql: 'mysql ', mysqlFlag: 'mysql -p ', mysqlLong: 'mysql ' + 'a'.repeat(195) + ' ', mysqlGlued: 'mysql -pa mysql -pb ', awsName: 'aws_secret_access_key ', awsLong: 'aws_secret_access_key ' + 'aB3/'.repeat(10) + ' ', awsRun: 'secret_access_key ' + 'aB3'.repeat(2000) + '#',
    schemeToken: 'token ', schemeTokenWord: 'token ab12cd34. ', schemeTokenLong: 'token ' + 'a1'.repeat(40) + ' ', apiKeySpace: 'api_key   ', bearerShort: 'Bearer x. ', bearerShortRun: 'Bearer a, ', bearerWordRun: 'Bearer ab. ' + 'a'.repeat(11) + ' ',
    shortName: 'token:ab12 ', shortNames: 'secret=a1,pwd=b2;', phrase: 'password: ab12 ', phraseLong: 'password: ab12' + ' cd34'.repeat(9) + ' ', phraseWords: 'pwd=a1 b2 c3 d4 e5 f6 g7 h8 i9 ', keyStart: 'api_key=sk-a ', keyStartLong: 'api_key=ghp_' + 'a'.repeat(30) + ' ',
    cookieShort: 'cookie: a=ab12 x ', cookieShortRun: 'cookie:a=a1 ',
  };
  if (part === 'shapes') for (const [k, u] of Object.entries(gapUnits)) assertLinearShape(`issue 1227 gap rule ${k}`, (x) => { redact(x, {}); }, (n) => u.repeat(Math.ceil(n / u.length)).slice(0, n));
  const allUnits: Record<string, string> = {
    sep: ':=', named: 'password=', namedSpace: 'password= ', namedQuote: '"token": "', namedNoDigit: 'secret:abc ', namedPath: 'token=a/', namedCallOpen: 'token=a(', namedDigits: 'token=1.', namedDollar: 'token=$a', namedLong: 'token=' + 'a'.repeat(127) + ' ',  namedCall: 'token=a.b', spaces: 'token        ',
    begin: '-----BEGIN ', beginLong: '-----BEGIN ' + 'A'.repeat(90) + ' ', beginName: '-----BEGIN RSA ', endNoBegin: '-----END PRIVATE KEY-----', endAfterBegin: '-----END ',
    cookie: 'cookie: ', cookieEq: 'cookie: a=', cookieJson: '"cookie":"a=', cookieNoEq: 'cookie: ' + 'a'.repeat(120) + ' ', netrc: 'machine a ', netrcFull: 'machine a login b password ', curl: 'curl ', curlU: 'curl -u a:',  jwtOne: 'eyJabcde.', jwtTwo: 'eyJabcde.abcde.', jwtRun: 'a_' + 'eyJ', jwtRuns: ('25AA' + 'eyJ').repeat(570) + ' ', jwtRunsOne: ('25AA' + 'eyJ').repeat(570) + '.abcde ', jwtRunsTwo: ('25AA' + 'eyJ').repeat(570) + '.abcde.a ', entra: 'abc1Q', entraRun: '1Q~', prefix: 'np' + 'm_', under: '_', pct: '%25', digits: '1234567890123456', hexRun: 'abcdef0123456789', hexUs: 'abcdef0123456789abcdef0123456789-u', sg: 'SG' + '.', dots: 'aaaaaaaaaaaaaa.', atlas: 'aaaaaaaaaaaaaa.at' + 'lasv1.', a22: 'A', fbId: '1234567890123456|', authress: 'sc' + '_abcde.abcd.acc_', teams: '.webhook.office.com/webhookb2/', query: '?sig=', jwt25: '25AAeyJ', jwt25Body: '25AAeyJabcdefgh', r25: '25', jwtDash: '-eyJ', jwtPct: '%41eyJ', b64Eaaa: 'EAAA-', b64Pct: '%41AAAAAAAAAAAAAAAAAAAAAAAB' + 'a'.repeat(90) + '+', b64Line: 'EAAA' + 'a'.repeat(70) + '\n', b64Wrap: 'a'.repeat(76) + '\n', cookieQuote: 'cookie: a="x" ', cookieQuoteLine: 'cookie: a="x\n', cookiePairs: 'cookie: a=1;', machineRun: 'machine h password x;', curlParen: 'curl -u a:b(', cookieWord: 'cookie: a=1 x ', closers: 'token=abc12345) ', cookieHead: 'cookie:', namedDotted: 'token=a.b.', namedWords: 'token=ab-c-',  b64EaaaEnd: 'EAAA' + 'a'.repeat(70) + '/',  text: 'the quick brown fox: reads src/a.ts = done, foo_bar-baz. ',
    ...gapUnits,
  };
  // A bare cookie token run that is not one (spec 012 FR-168, issue #1159): `cookie:` heads with nothing between them that stops a token, ending in a word. Each head once scanned the whole rest of the text (18 s at 100 KB). Counted, not timed: `bareStepsForTest` is how many characters the bare-token scans looked at, at most 4 per input character at 16 KB and at 1 MB, whatever the machine. Then 1 MB in a child with a hard stop as the coarse backstop.
  if (part === 'shapes2') {
    // [unit repeated for the size (or its first half), what repeats for the other half, a last word]
    const cases: Record<string, [string, string, string]> = { head: ['cookie:', '', ' x'], slash: ['cookie:/', '', ' x'], dot: ['cookie:.', '', ' x'], dash: ['cookie:-', '', ' x'], comma: ['cookie:,', '', ' x'], pct: ['cookie:%', '', ' x'], hash: ['cookie:#', '', ' x'], colon: ['cookie:a:', '', ' x'], spaces: ['cookie:', ' ', 'x'], tabs: ['cookie:abcdefgh', '\t', 'x'], quote: ['cookie:"', '', ' x'], pairs: ['cookie: a=1; ', '', 'x'] };
    const mk = (unit: string, pad: string, last: string, n: number): string => (pad ? unit.repeat(Math.floor(n / 2 / unit.length)) + pad.repeat(Math.floor(n / 2)) + last : unit.repeat(Math.floor(n / unit.length)) + last);
    for (const n of [16_000, 1_000_000]) {
      for (const [k, [unit, pad, last]] of Object.entries(cases)) {
        const text = mk(unit, pad, last, n);
        bareStepsForTest();
        redact(text, {});
        const steps = bareStepsForTest();
        assert.ok(steps <= 4 * text.length, `bare cookie run ${k} at ${n}: ${steps} steps for ${text.length} characters (limit 4 per character)`);
      }
    }
    const code = `
      const { redact } = require(${JSON.stringify(require.resolve('../src/shared/redact'))});
      const once = (f) => { const c = process.cpuUsage(); f(); const d = process.cpuUsage(c); return (d.user + d.system) / 1000; };
      const out = {};
      const cases = ${JSON.stringify(cases)};
      for (const [k, [unit, pad, last]] of Object.entries(cases)) {
        const n = 1000000;
        const text = pad ? unit.repeat(Math.floor(n / 2 / unit.length)) + pad.repeat(Math.floor(n / 2)) + last : unit.repeat(Math.floor(n / unit.length)) + last;
        out[k] = once(() => redact(text, {}));
      }
      process.stdout.write(JSON.stringify(out));`;
    const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 120_000, maxBuffer: 1 << 20 });
    assert.strictEqual(r.status, 0, `the bare-cookie child ended: ${r.signal ?? r.stderr}`);
    for (const [k, v] of Object.entries(JSON.parse(r.stdout) as Record<string, number>)) assert.ok(v < 10_000, `bare cookie run ${k}: ${v.toFixed(0)} ms CPU for 1 MB`);
    // Glued chains (spec 012 FR-169, issue #1233): tokens written back to back, each family once as a long chain, at 32 KB (a start-anchored look back is 3 s there, so the ratio assert fails well before the 10 s backstops; at 400 KB it stalled for minutes). The look back from the end of a match is bounded (`PREFIX_REACH`), so the cost stays linear; from the start of the match it was quadratic.
    {
      const unitOf = (pre: string, body: string): string => pre + body;
      const an36 = 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7aB3dE6gH9jK2mN'.slice(0, 36);
      const chains: Array<[string, string]> = [['hf', unitOf('hf' + '_', an36.slice(0, 30))], ['npm', unitOf('np' + 'm_', an36)], ['shpat', unitOf('shp' + 'at_', '0a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f')], ['ghp', unitOf('gh' + 'p_', an36)], ['mixed', unitOf('gh' + 'p_', an36) + unitOf('np' + 'm_', an36) + unitOf('github' + '_pat_', an36 + an36.slice(0, 20))]];
      for (const [name, unit] of chains) assertLinearShape(`glued chain ${name}`, (x) => { redact(x, {}); }, (n) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n), 32_000);
    }
  }
  // two suites, each trap in one (over 30 s on Windows as one); `pct` in both, as the neighbour the JWT traps are read against
  const units = Object.fromEntries(Object.entries(allUnits).filter(([k], i) => k === 'pct' || (part === 'shapes2') === (k.startsWith('jwt') || i % 2 === 1)));
  const mod = require.resolve('../src/shared/redact');
  const code = `
    const { redact, REDACT_MAX_CHARS } = require(${JSON.stringify(mod)});
    const units = JSON.parse(process.argv[1]);
    const MIN = process.platform === 'win32' ? 16 : 2;
    const once = (f) => { const c = process.cpuUsage(); f(); const d = process.cpuUsage(c); return (d.user + d.system) / 1000; };
    const out = {};
    for (const [k, u] of Object.entries(units)) {
      const fill = (n) => u.repeat(Math.ceil(n / u.length)).slice(0, n);
      const big = fill(256000), small = big.slice(0, 16000);
      let full = Infinity, base = Infinity;
      for (let i = 0; i < 3; i++) { full = Math.min(full, once(() => redact(big, {}))); base = Math.min(base, once(() => { for (let j = 0; j < 16; j++) redact(small, {}); }) / 16); if (full < Math.max(100, Math.max(base, MIN) * 40)) break; }
      out[k] = { full, base, max: once(() => redact(fill(REDACT_MAX_CHARS), {})) };
    }
    process.stdout.write(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['-e', code, JSON.stringify(units)], { encoding: 'utf8', timeout: 240_000, maxBuffer: 1 << 20 });
  assert.strictEqual(r.status, 0, `the adversarial child ended: ${r.signal ?? r.stderr}`);
  const minBase = process.platform === 'win32' ? 16 : 2;
  const measured = JSON.parse(r.stdout) as Record<string, { full: number; base: number; max: number }>;
  for (const [k, v] of Object.entries(measured)) {
    assert.ok(v.full < Math.max(100, Math.max(v.base, minBase) * 40), `${k}: ${v.full.toFixed(1)} ms CPU against ${v.base.toFixed(1)} ms for 1/16 (limit 40x, floor 100 ms)`);
    assert.ok(v.max < 10_000, `${k}: a run of REDACT_MAX_CHARS took ${v.max.toFixed(0)} ms CPU`);
  }
  // A JWT's length bound hides a stall from the growth ratio (each `eyJ` costs up to a fixed 4096 steps), so against a neighbour of the same size: the regex alone took 3.5 s on `25AA` + `eyJ`, 25 times `pct`
  for (const k of ['jwt25', 'jwt25Body', 'jwtOne', 'jwtTwo', 'jwtRun', 'jwtRuns', 'jwtRunsOne', 'jwtRunsTwo'].filter((j) => j in measured)) assert.ok(measured[k].max < Math.max(1000, measured.pct.max * 8), `${k}: ${measured[k].max.toFixed(0)} ms CPU on REDACT_MAX_CHARS, against ${measured.pct.max.toFixed(0)} ms for a run of %25`);
}
}

console.log(`redact growth ${part}: all checks passed; worst ratio ${worstGrowth.ratio.toFixed(1)} (${worstGrowth.label})`);
