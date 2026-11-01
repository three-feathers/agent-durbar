/**
 * The growth and adversarial runs of the shared mask, one part per suite (spec 012 T137, issue #1009; they were sections of test-redact.ts, which went over the 30 s rule). The same
 * checks: a try that passes stops the retries, like `assertLinearGrowth`, so a pass costs one pair of runs and a real failure still gets every try.
 * `node dist-scripts/scripts/test-redact-growth.js <part>`.
 */
import * as assert from 'assert';
import { REDACT_MAX_CHARS, _uncappedForTest, redact } from '../src/shared/redact';
import { spawnSync } from 'child_process';
import { assertLinearGrowth, cpuMs, worstGrowth, workerRun } from './redact-growth-lib';

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
}

if (part === 'adversarial') {
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
    `try{const {redact}=require(w.mod);const tc=typeof process.threadCpuUsage==='function';const w0=process.hrtime.bigint(),c0=tc?process.threadCpuUsage():null;redact(w.input,{});const wall=Number(process.hrtime.bigint()-w0)/1e6;let cpu=wall;if(tc){const d=process.threadCpuUsage(c0);cpu=(d.user+d.system)/1000}out[0]=cpu;out[1]=wall;Atomics.store(flag,0,1)}` +
    `catch(e){Atomics.store(flag,0,2)}Atomics.notify(flag,0)`;
  for (const [k, v] of Object.entries(adversarial)) assertLinearGrowth(`adversarial ${k}`, (input) => workerRun(`adversarial ${k}`, code, { mod, input }, 30000), v);
}

}

if (part === 'r11') {
    // cost: a long run of `Bearer ` words and many escaped R7 objects (same interleaved ratio as the block below)
    const rshapes: Array<[string, string]> = [['Bearer ', 'Bearer '], ['--auth Bearer ', '--auth Bearer '], ['obj', '{\\"name\\":\\"token\\",\\"value\\":\\"x y\\"} '], ['arr', '{\\"name\\":\\"token\\",\\"value\\":[\\"x\\"]} '], ['hdr', 'Authorization: Bearer '], ['qhdr', '-H "Authorization: Bearer" '], ['eq', '--auth=Bearer '], ['sq', "Authorization: 'a "], ['dq', 'Authorization: "a '], ['mixed', `Authorization: "a Authorization: 'a `], ['tok', 'TOKEN=Auth: '], ['unclosed', 'x Authorization: "a '], ['unclosed1', "Cookie: 'a "], ['schemeq', 'Authorization: Basic "a '], ['argsq', 'curl Authorization: "a ']];
    for (const [, unit] of rshapes) {
      const mk = (n: number): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
      const time = (x: string): number => cpuMs(() => { _uncappedForTest.maskSecretArgs([x]); _uncappedForTest.maskSecretArgs(['-c', x]); _uncappedForTest.maskSecretCommand(x); }, 8000);
      let tSmall = Infinity;
      let tBig = Infinity;
      for (let i = 0; i < 5; i++) { tSmall = Math.min(tSmall, time(mk(50_000))); tBig = Math.min(tBig, time(mk(400_000))); if (tBig < 8000 && tBig / Math.max(tSmall, 20) < 24) break; }
      const t200 = time(mk(200_000));
      const ratio = tBig / Math.max(tSmall, 20);
      console.log(`redact: 14c R11/R7 ${JSON.stringify(unit)} 50k=${Math.round(tSmall)} ms 400k=${Math.round(tBig)} ms ratio ${ratio.toFixed(1)} 200k=${Math.round(t200)} ms`);
      assert.ok(t200 < 5000 && tBig < 8000 && ratio < 24, `14c: R11/R7 ${JSON.stringify(unit)} grew too fast: ${tSmall} -> ${tBig} ms (ratio ${ratio.toFixed(1)}), 200k ${t200} ms`);
    }
}

if (part === 'args') {
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
    for (let i = 0; i < 5; i++) { tSmall = Math.min(tSmall, time(small)); tBig = Math.min(tBig, time(big)); if (tBig < 8000 && tBig / Math.max(tSmall, 20) < 24) break; }
    const ratio = tBig / Math.max(tSmall, 20);
    console.log(`redact: 14c linearity ${JSON.stringify(unit)} 50k=${Math.round(tSmall)} ms 400k=${Math.round(tBig)} ms ratio ${ratio.toFixed(1)}`);
    assert.ok(tBig < 8000 && ratio < 24, `14c: ${JSON.stringify(unit)} grew too fast: ${tSmall} -> ${tBig} ms (ratio ${ratio.toFixed(1)})`);
  }
}

if (part === 'runs') {
  const run = (x: string): void => { _uncappedForTest.maskSecretArgs([x]); _uncappedForTest.maskSecretArgs(['-c', x]); _uncappedForTest.maskSecretCommand(x); };
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
    for (let i = 0; i < 5; i++) { tSmall = Math.min(tSmall, time(small)); tBig = Math.min(tBig, time(big)); if (tBig < 8000 && tBig / Math.max(tSmall, 20) < 24) break; }
    const ratio = tBig / Math.max(tSmall, 20);
    const t200 = time(gen(200_000));
    console.log(`redact: 14c run ${name} 50k=${Math.round(tSmall)} ms 400k=${Math.round(tBig)} ms ratio ${ratio.toFixed(1)} 200k=${Math.round(t200)} ms`);
    assert.ok(t200 < 5000 && tBig < 8000 && ratio < 24, `14c: run ${name} grew too fast: ${tSmall} -> ${tBig} ms (ratio ${ratio.toFixed(1)}), 200k ${t200} ms`);
  }

}

if (part === 'wrappers') {
  // (i) cost: wrapper shapes stay linear (50k vs 400k, 3 interleaved pairs, min CPU time of each (cpuMs, T068); linear is about 8, quadratic about 64)
  const run = (x: string): void => { _uncappedForTest.maskSecretArgs(['sh', '-c', x]); _uncappedForTest.maskSecretArgs(['powershell', '-Command', x]); _uncappedForTest.maskSecretCommand(x); };
  for (const unit of ['sh -c "x \\"y\\"" ', `powershell -Command "a ${BT}" `, 'cmd /c a ^" ', 'bash -c "sh -c \\"a ', "pwsh -c 'a '' ", '"--token ']) {
    const mk = (n: number): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
    const time = (x: string): number => cpuMs(() => run(x), 8000);
    let tSmall = Infinity;
    let tBig = Infinity;
    for (let i = 0; i < 3; i++) { tSmall = Math.min(tSmall, time(mk(50_000))); tBig = Math.min(tBig, time(mk(400_000))); if (tBig < 8000 && tBig / Math.max(tSmall, 20) < 24) break; }
    const ratio = tBig / Math.max(tSmall, 20);
    console.log(`redact: 14d linearity ${JSON.stringify(unit)} 50k=${Math.round(tSmall)} ms 400k=${Math.round(tBig)} ms ratio ${ratio.toFixed(1)}`);
    assert.ok(tBig < 8000 && ratio < 24, `14d: ${JSON.stringify(unit)} grew too fast: ${tSmall} -> ${tBig} ms (ratio ${ratio.toFixed(1)})`);
  }
  // review of #455 item 1: one long backslash run after a cmd wrapper (no quote after it) is not retried from each position
  for (const head of ['cmd /c ^x ', 'cmd /c \\"x ']) {
    const time = (n: number): number => { const x = head + '\\'.repeat(n); return cpuMs(() => { _uncappedForTest.maskSecretCommand(x); }, 8000); };
    let tSmall = Infinity;
    let tBig = Infinity;
    for (let i = 0; i < 3; i++) { tSmall = Math.min(tSmall, time(50_000)); tBig = Math.min(tBig, time(400_000)); if (tBig < 8000 && tBig / Math.max(tSmall, 20) < 24) break; }
    const ratio = tBig / Math.max(tSmall, 20);
    console.log(`redact: 14d linearity ${JSON.stringify(head)} + run 50k=${Math.round(tSmall)} ms 400k=${Math.round(tBig)} ms ratio ${ratio.toFixed(1)}`);
    assert.ok(tBig < 8000 && ratio < 24, `14d: ${JSON.stringify(head)} + backslash run grew too fast: ${tSmall} -> ${tBig} ms (ratio ${ratio.toFixed(1)})`);
  }
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
    `try{const {_uncappedForTest:u}=require(w.mod);const go=(x)=>[()=>u.maskSecretArgs([x]),()=>u.maskSecretArgs(['pwsh','-c',x]),()=>u.maskSecretArgs(x.split(' ')),()=>u.maskSecretCommand(x),()=>u.maskSecretCommand('pwsh -c '+JSON.stringify(x))][w.path]();go(w.input.slice(0,5000));const tc=typeof process.threadCpuUsage==='function';const w0=process.hrtime.bigint(),c0=tc?process.threadCpuUsage():null;go(w.input);const wall=Number(process.hrtime.bigint()-w0)/1e6;let cpu=wall;if(tc){const d=process.threadCpuUsage(c0);cpu=(d.user+d.system)/1000}out[0]=cpu;out[1]=wall;Atomics.store(flag,0,1)}` +
    `catch(e){Atomics.store(flag,0,2)}Atomics.notify(flag,0)`;
  const cases = Object.entries(adv).flatMap(([k2, v2]) => (/\s/.test(v2) ? [] : [[k2, v2, 0]]).concat([0, 1, 2, 3, 4].map((i) => [k2 + '-50k', v2.slice(0, 50_000), i])) as Array<[string, string, number]>);
  for (const [k0, v, pi] of cases) {
    const k = `R12 adversarial ${k0} (path ${pi})`;
    assertLinearGrowth(k, (input) => workerRun(k, code, { mod, input, path: pi }, 60000), v);
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
    for (const [k, mk] of Object.entries(shapes)) {
      const time = (x: string): number => cpuMs(() => { _uncappedForTest.maskSecretCommand(x); _uncappedForTest.maskSecretArgs([x]); }, 5000);
      let a = Infinity;
      let b = Infinity;
      for (let i = 0; i < 3; i++) { a = Math.min(a, time(mk(100_000))); b = Math.min(b, time(mk(400_000))); if (b < Math.max(80, a * 10)) break; }
      console.log(`redact: R12 growth ${k} 100k=${Math.round(a)} ms 400k=${Math.round(b)} ms`);
      assert.ok(b < Math.max(80, a * 10), `R12 growth ${k}: ${a.toFixed(0)} -> ${b.toFixed(0)} ms CPU for 4x the input`);
    }
  }
  // an unclosed quote or a long bare value of a secret member hides the rest of the text, so the pattern rules do not run over 1 MB again
  // (they cost about 900 ms per MB on this path before; 46 ms on main without R12): a tighter limit than the 1 s above
  for (const [k, v] of [['unclosed double quote', '@{token="' + 'a'.repeat(MB)], ['unclosed single quote', "@{'api_key'='" + 'a'.repeat(MB)], ['long bare value', '@{ token = ' + 'a'.repeat(MB)]] as const) {
    const ms = Math.min(...[0, 1, 2].map(() => cpuMs(() => { _uncappedForTest.maskSecretCommand(v); _uncappedForTest.maskSecretArgs([v]); }, 2000))); // best of 3, like the growth checks
    assert.ok(ms < 300, `R12: ${k} on 1 MB took ${ms.toFixed(0)} ms CPU for the command and args paths, limit 300 ms`);
  }
}

if (part === 'shapes') {
// Linear, part 2: adversarial runs, in a child with a hard stop, so a stall fails instead of hanging. CPU time on 1/16 of the input and on all of it
// (the same method as `assertLinearGrowth` in test-redact.ts, limit 40 for 16x; never a wall-clock ratio), then one whole REDACT_MAX_CHARS run.
{
  const units: Record<string, string> = {
    sep: ':=', named: 'password=', namedSpace: 'password= ', namedQuote: '"token": "', namedNoDigit: 'secret:abc ', namedPath: 'token=a/', namedCallOpen: 'token=a(', namedDigits: 'token=1.', namedDollar: 'token=$a', namedLong: 'token=' + 'a'.repeat(127) + ' ',  namedCall: 'token=a.b', spaces: 'token        ',
    begin: '-----BEGIN ', beginLong: '-----BEGIN ' + 'A'.repeat(90) + ' ', beginName: '-----BEGIN RSA ', endNoBegin: '-----END PRIVATE KEY-----', endAfterBegin: '-----END ',
    cookie: 'cookie: ', cookieEq: 'cookie: a=', cookieJson: '"cookie":"a=', cookieNoEq: 'cookie: ' + 'a'.repeat(120) + ' ', netrc: 'machine a ', netrcFull: 'machine a login b password ', curl: 'curl ', curlU: 'curl -u a:',  entra: 'abc1Q', entraRun: '1Q~', prefix: 'np' + 'm_', under: '_', pct: '%25', digits: '1234567890123456', hexRun: 'abcdef0123456789', hexUs: 'abcdef0123456789abcdef0123456789-u', sg: 'SG' + '.', dots: 'aaaaaaaaaaaaaa.', atlas: 'aaaaaaaaaaaaaa.at' + 'lasv1.', a22: 'A', fbId: '1234567890123456|', authress: 'sc' + '_abcde.abcd.acc_', teams: '.webhook.office.com/webhookb2/', query: '?sig=', jwt25: '25AAeyJ', jwt25Body: '25AAeyJabcdefgh', r25: '25', jwtDash: '-eyJ', jwtPct: '%41eyJ', b64Eaaa: 'EAAA-', b64EaaaEnd: 'EAAA' + 'a'.repeat(70) + '/',  text: 'the quick brown fox: reads src/a.ts = done, foo_bar-baz. ',
  };
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
  for (const [k, v] of Object.entries(JSON.parse(r.stdout) as Record<string, { full: number; base: number; max: number }>)) {
    assert.ok(v.full < Math.max(100, Math.max(v.base, minBase) * 40), `${k}: ${v.full.toFixed(1)} ms CPU against ${v.base.toFixed(1)} ms for 1/16 (limit 40x, floor 100 ms)`);
    assert.ok(v.max < 10_000, `${k}: a run of REDACT_MAX_CHARS took ${v.max.toFixed(0)} ms CPU`);
  }
}
}

console.log(`redact growth ${part}: all checks passed; worst ratio ${worstGrowth.ratio.toFixed(1)} (${worstGrowth.label})`);
