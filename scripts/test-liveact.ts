/** Live activity on the desks (spec 001 FR-028..FR-032): readout rules, masking through the shared redact module, the paint throttle,
 * and the page wiring. `npm run test:liveact`. No credits spent. */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { redact, maskSecretCommand, maskSecretUrl, maskHomePaths } from '../src/shared/redact';

const ROOT = path.join(__dirname, '..', '..');
const R = path.join(ROOT, 'src', 'renderer');
type Readout = { kind: string; text: string; lines: string; long: string; tool: string } | null;
type Feed = {
  onEvent(id: string, e: Record<string, unknown>, x?: Record<string, unknown>): boolean;
  of(id: string): Readout; clear(id: string): void; due(id: string, now: number): boolean; wait(id: string, now: number): number; mark(id: string, now: number): void;
};
const L = require(path.join(R, 'liveact.js')) as {
  create(o: { mask: { redact(s: string): string; cmd(s: string): string; url(s: string): string } }): Feed;
  lastSentences(t: string, max: number, one?: boolean): string;
  phrase(o: Record<string, unknown>, mask?: Record<string, (s: string) => string>): string;
  PAINT_MS: number; LINE_MAX: number; PANEL_MAX: number; STREAM_MAX: number;
};
const mask = { redact: (s: string) => redact(s, {}), cmd: (s: string) => maskSecretCommand(s, {}), url: (s: string) => maskSecretUrl(s, {}) };
const mk = () => L.create({ mask });
const T = 1;
const ev = (o: Record<string, unknown>) => ({ sessionId: 's', timestamp: T, ...o });
let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepStrictEqual(a, b, m); n++; };

// sentences: a dot inside a word ("registry.ts", "v0.3") does not end one; the newest whole sentence wins; Markdown goes
eq(L.lastSentences('Moved the handlers into `registry.ts` so the API is unchanged. Next I am running', 200, true), 'Moved the handlers into registry.ts so the API is unchanged.', 'whole sentence, not the half one being written');
eq(L.lastSentences('**Planning**\n\nFirst one. Second one!', 200, true), 'Second one!', 'newest whole sentence');
eq(L.lastSentences('First one. Second one.', 200), 'First one. Second one.', 'a few sentences when they fit');
eq(L.lastSentences('First one. Second one.', 14), 'Second one.', 'older ones only when they fit');
eq(L.lastSentences('Still writing the first', 200, true), 'Still writing the first', 'nothing whole yet: the partial text');
eq(L.lastSentences('Release v0.3 is out. Done.', 200), 'Release v0.3 is out. Done.', 'v0.3 is not a sentence end');
ok(Array.from(L.lastSentences('x'.repeat(500) + '.', 50, true)).length <= 50, 'cut to max');
eq(L.lastSentences('', 50), '', 'empty');

// thinking: deltas build the block; a new block starts over; helpers' events (agentId) never change the main desk
{
  const f = mk();
  ok(f.onEvent('a', ev({ type: 'thinking', reasoningId: 'r1', delta: '**Plan**\n\nThe request touches a few files. ' })), 'thinking changes the readout');
  eq(f.of('a')!.kind, 'think', 'kind think');
  eq(f.of('a')!.text, 'Thinking: The request touches a few files.', 'thinking line');
  f.onEvent('a', ev({ type: 'thinking', reasoningId: 'r1', delta: 'So I will read them first. And then' }));
  eq(f.of('a')!.text, 'Thinking: So I will read them first.', 'newest whole sentence of the block');
  eq(f.of('a')!.lines, 'The request touches a few files. So I will read them first.', 'panel: a few sentences');
  f.onEvent('a', ev({ type: 'thinking', reasoningId: 'r2', delta: 'A new block.' }));
  eq(f.of('a')!.text, 'Thinking: A new block.', 'a new reasoning id starts over');
  eq(f.onEvent('a', ev({ type: 'thinking', agentId: 'h1', delta: 'Helper thought.' })), false, 'helper event ignored');
  eq(f.of('a')!.text, 'Thinking: A new block.', 'unchanged by the helper');
  eq(f.onEvent('a', ev({ type: 'thinking', reasoningId: 'r2', delta: '' })), false, 'no change, no paint');
}
// the reply as it streams; final text replaces the buffer
{
  const f = mk();
  f.onEvent('a', ev({ type: 'output', delta: 'Moved the company handlers first. Next I am ' }));
  eq(f.of('a')!.text, 'Replying: Moved the company handlers first.', 'reply line');
  f.onEvent('a', ev({ type: 'output', delta: '', final: true, text: 'All **done**. Tests pass.' }));
  eq(f.of('a')!.text, 'Replying: Tests pass.', 'final text');
  eq(f.onEvent('b', ev({ type: 'output', delta: '' })), false, 'an empty reply shows nothing');
  eq(f.of('b'), null, 'nothing to show');
}
// tools: verb phrases, Simple words, task tools skipped, phases other than start ignored
{
  const f = mk();
  f.onEvent('a', ev({ type: 'toolCall', callId: 'c', tool: 'view', phase: 'start' }), { kind: 'read', label: 'src/tools/registry.ts' });
  eq(f.of('a'), { kind: 'tool', text: 'Reading src/tools/registry.ts', lines: 'Reading src/tools/registry.ts', long: 'Reading src/tools/registry.ts', tool: 'Reading src/tools/registry.ts' }, 'read');
  f.onEvent('a', ev({ type: 'toolCall', callId: 'c', tool: 'bash', phase: 'start' }), { kind: 'run', label: 'npm test' });
  eq(f.of('a')!.text, 'Running npm test', 'run');
  eq(L.phrase({ kind: 'edit', tool: 'edit_file', label: 'a.ts' }, mask), 'Editing a.ts', 'edit');
  eq(L.phrase({ kind: 'search', tool: 'grep', label: 'registerTool' }, mask), 'Searching registerTool', 'search');
  eq(L.phrase({ kind: 'read', tool: 'web_fetch', label: 'https://example.com/a' }, mask), 'Opening https://example.com/a', 'url');
  eq(L.phrase({ kind: 'tool', tool: 'github-create_issue', label: '' }, mask), 'Using github-create_issue', 'other tool');
  eq(L.phrase({ kind: 'run', tool: 'bash', label: 'npm test', simple: 'Running a command' }, mask), 'Running a command', 'Simple words, never the command');
  eq(f.onEvent('a', ev({ type: 'toolCall', callId: 'c', tool: 'bash', phase: 'complete' }), { kind: 'run', label: 'x' }), false, 'complete: no change');
  eq(f.onEvent('a', ev({ type: 'toolCall', callId: 't', tool: 'task', phase: 'start' }), { kind: 'tool', label: 'x', skip: true }), false, 'task tool skipped');
  ok(Array.from(L.phrase({ kind: 'read', tool: 'view', label: 'a/'.repeat(400) }, mask)).length <= L.LINE_MAX, 'phrase cut');
}
// spec 001 FR-047: the last tool phrase of the turn stays (masked) while the agent thinks or replies; the turn's end and a new message clear it
{
  const f = mk();
  const key = 'sk-' + 'LiveTool0Secret0Value0123456789';
  f.onEvent('a', ev({ type: 'toolCall', callId: 'c', tool: 'bash', phase: 'start' }), { kind: 'run', label: `curl -H "Authorization: Bearer ${key}" https://x.test` });
  const t0 = f.of('a')!.tool;
  ok(t0.startsWith('Running') && !t0.includes(key), `tool phrase masked: ${t0}`);
  f.onEvent('a', ev({ type: 'thinking', reasoningId: 'r9', delta: 'The call worked. ' }));
  eq([f.of('a')!.kind, f.of('a')!.tool], ['think', t0], 'thinking keeps the last tool');
  f.onEvent('a', ev({ type: 'output', delta: 'All done here. ' }));
  eq(f.of('a')!.tool, t0, 'replying keeps the last tool');
  f.onEvent('a', ev({ type: 'status', status: 'idle' }));
  eq(f.of('a'), null, 'the turn ends: nothing');
  f.onEvent('a', ev({ type: 'thinking', reasoningId: 'r10', delta: 'Next turn. ' }));
  eq(f.of('a')!.tool, '', 'a new turn starts with no tool');
  f.onEvent('a', ev({ type: 'toolCall', callId: 'd', tool: 'view', phase: 'start' }), { kind: 'read', label: 'a.ts' });
  f.onEvent('a', ev({ type: 'user', text: 'stop' }));
  f.onEvent('a', ev({ type: 'thinking', reasoningId: 'r11', delta: 'Again. ' }));
  eq(f.of('a')!.tool, '', 'a new message clears the tool');
  f.onEvent('a', ev({ type: 'toolCall', callId: 'e', tool: 'view', phase: 'start' }), { kind: 'read', label: 'b.ts' });
  f.clear('a');
  f.onEvent('a', ev({ type: 'thinking', reasoningId: 'r12', delta: 'Once more. ' }));
  eq(f.of('a')!.tool, '', 'clear drops the tool');
}
// a turn that ends, waits for you or is stopped clears it; working keeps it; a new message clears it
for (const st of ['idle', 'needs-permission', 'error', 'stopped']) {
  const f = mk();
  f.onEvent('a', ev({ type: 'thinking', delta: 'Hmm.' }));
  ok(f.onEvent('a', ev({ type: 'status', status: st })), st + ' clears');
  eq(f.of('a'), null, st + ': nothing shown');
}
{
  const f = mk();
  f.onEvent('a', ev({ type: 'thinking', delta: 'Hmm.' }));
  eq(f.onEvent('a', ev({ type: 'status', status: 'working', intent: 'x' })), false, 'working keeps it');
  f.onEvent('a', ev({ type: 'user', text: 'next' }));
  eq(f.of('a'), null, 'a new message clears it');
  f.onEvent('a', ev({ type: 'thinking', delta: 'Hmm.' }));
  f.clear('a');
  eq(f.of('a'), null, 'clear');
}

// FR-031: no secrets. A secret in a command, URL, path, thinking or reply never reaches the readout.
{
  const SECRET = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';
  const RAW = 'S3cr3tV4lue9xQ';
  const cmds = [
    `curl -H "Authorization: Bearer ${RAW}" https://api.example.com`,
    `export GITHUB_TOKEN=${SECRET} && npm test`,
    `git clone https://user:${RAW}@github.com/o/r.git`,
    `node deploy.js --token ${RAW}`,
    `node deploy.js --api-key=${RAW}`,
    `sh -c "API_KEY=${RAW} npm run x"`,
    `echo ${SECRET}`,
    `psql postgres://admin:${RAW}@db:5432/x`,
  ];
  for (const c of cmds) {
    const f = mk();
    f.onEvent('a', ev({ type: 'toolCall', callId: 'c', tool: 'bash', phase: 'start' }), { kind: 'run', label: c });
    const r = f.of('a')!;
    ok(!r.text.includes(RAW) && !r.text.includes(SECRET), 'command masked: ' + c + ' -> ' + r.text);
  }
  for (const u of [`https://x.example/cb?access_token=${RAW}&a=1`, `https://u:${RAW}@x.example/`, `https://api.telegram.org/bot123:${RAW}/send`]) {
    const f = mk();
    f.onEvent('a', ev({ type: 'toolCall', callId: 'c', tool: 'web_fetch', phase: 'start' }), { kind: 'read', label: u });
    ok(!f.of('a')!.text.includes(RAW), 'url masked: ' + f.of('a')!.text);
  }
  {
    const f = mk();
    f.onEvent('a', ev({ type: 'toolCall', callId: 'c', tool: 'view', phase: 'start' }), { kind: 'read', label: `/tmp/${SECRET}.txt` });
    ok(!f.of('a')!.text.includes(SECRET), 'path masked');
  }
  for (const type of ['thinking', 'output']) {
    const f = mk();
    f.onEvent('a', ev({ type, delta: `The token is ${SECRET}. I should not print it.` }));
    f.onEvent('a', ev({ type, delta: ` Using Bearer ${RAW}abcdef now.` }));
    const r = f.of('a')!;
    ok(!(r.text + r.lines).includes(SECRET) && !(r.text + r.lines).includes(RAW), type + ' masked: ' + r.lines);
  }
  // a secret split across two deltas is masked once the block holds it whole
  const f = mk();
  f.onEvent('a', ev({ type: 'thinking', delta: 'Key ' + SECRET.slice(0, 12) }));
  f.onEvent('a', ev({ type: 'thinking', delta: SECRET.slice(12) + ' is set.' }));
  ok(!f.of('a')!.lines.includes(SECRET), 'split secret masked');
}

// FR-030: at most one paint per 250 ms per desk; desks are independent
{
  const f = mk();
  eq(L.PAINT_MS, 250, '4 a second');
  eq(f.due('a', 1000), true, 'first paint');
  eq(f.due('a', 1100), false, 'too soon');
  eq(f.wait('a', 1100), 150, 'wait the rest');
  eq(f.due('b', 1100), true, 'another desk');
  eq(f.due('a', 1250), true, 'after 250 ms');
  f.mark('a', 1400);
  eq(f.due('a', 1500), false, 'a trailing paint counts too');
  eq(f.due('a', 1650), true, '250 ms after it');
}
// long, fast thinking stays cheap (the block keeps its newest 1200 characters)
{
  const f = mk();
  // CPU time, not wall time, so a loaded machine cannot fail it; wall time only has a loose 10x backstop for a blocking wait
  // (spec 041 T068, review of PR #527)
  const w0 = process.hrtime.bigint();
  const c0 = process.cpuUsage();
  for (let i = 0; i < 4000; i++) f.onEvent('a', ev({ type: 'thinking', reasoningId: 'r', delta: 'Word '.repeat(10) + 'end. ' }));
  const cpu = process.cpuUsage(c0);
  const ms = (cpu.user + cpu.system) / 1000;
  const wall = Number(process.hrtime.bigint() - w0) / 1e6;
  ok(ms < 3000, '4000 deltas in under 3 s of CPU (' + ms + ' ms)');
  ok(wall < 30000, '4000 deltas: wall-time backstop (' + wall.toFixed(1) + ' ms wall, limit 30000 ms)');
  ok(Array.from(f.of('a')!.lines).length <= L.PANEL_MAX, 'panel text bounded');
  ok(Array.from(f.of('a')!.long).length <= L.STREAM_MAX, 'grown desk text bounded');
}
// spec 001 FR-043: a grown desk gets the newest sentences, more of them than the panel, the newest last, masked
{
  const f = mk();
  const SECRET = 'sk-ant-' + 'A1b2C3d4E5f6G7h8I9j0K1L2';
  for (let i = 0; i < 30; i++) f.onEvent('a', ev({ type: 'thinking', reasoningId: 'r', delta: `Step ${i} is checked against the tests. ` }));
  f.onEvent('a', ev({ type: 'thinking', reasoningId: 'r', delta: `The key ${SECRET} is not needed. ` }));
  const r = f.of('a')!;
  ok(/The key \[redacted\] is not needed\.$/.test(r.long), 'long: newest sentence last, masked: ' + r.long.slice(-60));
  ok(!r.long.includes(SECRET), 'long: no secret');
  ok(r.long.length > r.lines.length && r.long.endsWith(r.lines), 'long holds more of the same newest sentences than the panel');
  ok(Array.from(r.long).length <= L.STREAM_MAX && Array.from(r.long).length > L.PANEL_MAX * 2, 'long is up to STREAM_MAX characters');
  ok(/^Step \d+ is checked/.test(r.long), 'long starts at a whole sentence');
  f.onEvent('a', ev({ type: 'output', delta: 'Moved the handlers. Tests pass.' }));
  eq(f.of('a')!.long, 'Moved the handlers. Tests pass.', 'long follows the reply');
}

// spec 001 FR-043 (review of #532): a done desk's reply excerpt is masked on the RAW text, then made plain. `plain` strips `_`, `*` and
// backticks, so masking after it let `ghp_…` through as `ghp…`. Every token shape, in every Markdown wrapping, must be gone.
{
  const X = L as unknown as { excerpt(raw: string, redact: ((s: string) => string) | null): string };
  const toks: Record<string, string> = {
    ghp: 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2',
    github_pat: 'github_pat_' + '11ABCDEFG0123456789_abcdefghijklmnopqrstuv',
    sk: 'sk-' + 'proj-Abc123_def456-GHI789jkl',
    bearer: 'Bearer ' + 'abcDEF123_ghiJKL456.mno',
  };
  /* the part of each token that must never show, in any form plain() can leave (with or without its underscores) */
  const tails: Record<string, string[]> = {
    ghp: ['A1b2C3d4E5f6G7h8I9j0K1l2'], github_pat: ['0123456789_abcdefghij', '0123456789abcdefghij'],
    sk: ['Abc123_def456', 'Abc123def456'], bearer: ['abcDEF123_ghi', 'abcDEF123ghi', 'ghiJKL456'],
  };
  const wraps: Array<[string, (t: string) => string]> = [
    ['plain', (t) => t], ['backticks', (t) => '`' + t + '`'], ['bold', (t) => '**' + t + '**'], ['italic _', (t) => '_' + t + '_'],
    ['bold __', (t) => '__' + t + '__'], ['bold italic', (t) => '***' + t + '***'], ['snake_case', (t) => 'my_' + t],
    ['code block', (t) => '```\n' + t + '\n```'], ['list', (t) => '- ' + t], ['heading', (t) => '## ' + t], ['quote', (t) => '> ' + t],
    ['link text', (t) => '[' + t + '](https://example.com)'],
  ];
  for (const [k, t] of Object.entries(toks)) for (const [w, f] of wraps) {
    const out = X.excerpt('**Done.** The key ' + f(t) + ' was in the old config.', mask.redact);
    ok(out.startsWith('Done. The key '), `${k} ${w}: Markdown removed: ${out}`);
    for (const tail of tails[k]) ok(!out.includes(tail), `${k} ${w}: no part of the token shows: ${out}`);
  }
  eq(X.excerpt('**Done.** All `tests` pass.', mask.redact), 'Done. All tests pass.', 'excerpt: plain text');
  eq(X.excerpt('ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2', null), '', 'excerpt: no mask, nothing (fail closed)');
  eq(X.excerpt('text', () => { throw new Error('x'); }), '', 'excerpt: a mask that throws, nothing');
  const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
  ok(/function replyExcerpt\(a\)\{return safeExcerpt\(a\.lastOutput,600,''\);\}/.test(app) && !/redact\([^)]*plain\(a\.lastOutput/.test(app), 'grownLine masks through the one helper (spec 041 FR-065)');
  ok(/if\(grownShowsReply\(a\)\)return replyExcerpt\(a\)\|\|\(vis\(a\)==='done'\?'Finished\.':'Ready\.'\);/.test(app), 'grownLine: nothing from the reply without a mask');
  ok(/const rep=grownShowsReply\(a\)\?'':replyExcerpt\(a\)/.test(app) && !/gx-t">\$\{esc\((a\.lastOutput|taskOf)/.test(app), 'the reply column (FR-047) uses the same masked excerpt');
}
// review of #532: `long` is made only when a grown desk reads it; a desk that never does costs what it did before
{
  const f = mk();
  eq(f.onEvent('a', ev({ type: 'thinking', reasoningId: 'r', delta: 'First one done. Sec' })), true, 'first sentence: a change');
  eq(f.onEvent('a', ev({ type: 'thinking', reasoningId: 'r', delta: 'ond is still' })), false, 'mid-sentence, nobody reads long: no change');
  eq(f.of('a')!.long, 'First one done.', 'long on demand');
  f.onEvent('a', ev({ type: 'thinking', reasoningId: 'r', delta: ' going. Third.' }));
  eq(f.of('a')!.long, 'First one done. Second is still going. Third.', 'long follows the newest text');
}
// page wiring: the shim, the compiled redact module and liveact.js load in order before app.js; redact.ts stays import-free
{
  const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
  ok(/<script src="exports-shim\.js"><\/script>\s*<script src="\.\.\/shared\/redact\.js"><\/script>\s*(?:<script src="\.\.\/shared\/answerlimits\.js"><\/script>(?:<!--[^>]*-->)?\s*)?<script src="safetext\.js"><\/script>\s*<script src="liveact\.js"><\/script>\s*<script src="app\.js">/.test(html), 'script order');
  const red = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'redact.ts'), 'utf8');
  ok(!/^\s*import\s/m.test(red) && !/\brequire\(/.test(red), 'redact.ts has no imports (it loads as a page script)');
  const copy = fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8');
  ok(copy.includes("'exports-shim.js'") && copy.includes("'liveact.js'"), 'copied to dist');
  const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
  ok(/feedStats\(a,e\);\s*liveFeed\(a,e\);/.test(app), 'onLiveEvent feeds the readout');
  ok(/function removeLiveAgent\(id\)\{[^}]*LIVEACT\.drop\(id\)/.test(app), 'a removed agent leaves no readout or timer');
  ok(/if\(!L\|\|!R\|\|typeof R\.redact!=='function'\)return null;/.test(app), 'no masking module: the feature stays off (fail closed)');
  ok(/\[\['full',3,'side'\],\['full',2,'side'\],\['full',3\],\['full',2\]/.test(app), 'side panel candidates first');
  ok(/if\(side&&!liveOn\(\)\)continue;/.test(app), 'setting off: never the side panel');
  ok(/if\(e\.phase==='start'&&LIVE_MASK&&window\.DurbarPlaces\.classify\(/.test(app), 'place activity words only with the masking loaded (spec 001 FR-036, fail closed; review on #511, M7)');
  ok(/return \(liveOn\(\)&&PLACE_DOING\.get\(a\.id\)\)\|\|v\.label/.test(app), 'place entries show the command only with Live activity on desks (FR-028)');
  ok(/const key=JSON\.stringify\(\[aw,ah,FORCE_DENSITY,liveOn\(\),/.test(app), 'layout key follows the setting');
  const scr = fs.readFileSync(path.join(R, 'screens.js'), 'utf8');
  ok(scr.includes('id="liveActSw"') && scr.includes('Live activity on desks'), 'Settings switch');
}
// spec 097 FR-030, FR-031, SC-005: a Real office monitor's lines: the same events and masks, control codes stripped first, inert, capped
{
  type Line = { n: number; k: string; t: string };
  const hm = { ...mask, home: (s: string) => maskHomePaths(s, []) };
  const F = () => L.create({ mask: hm }) as unknown as Feed & { screen(id: string): Line[]; block(raw: string, k?: string): { k: string; t: string }[] };
  const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';
  const all = (ls: Line[]) => ls.map((l) => l.t).join('\n');
  let f = F();
  // lines build up and scroll: oldest first, kinds, numbers that stay with a line
  f.onEvent('s', ev({ type: 'toolCall', phase: 'start', tool: 'bash', callId: 'c1', args: {} }), { kind: 'run', label: 'npm test' });
  f.onEvent('s', ev({ type: 'toolCall', phase: 'complete', tool: 'bash', callId: 'c1' }));
  f.onEvent('s', ev({ type: 'toolCall', phase: 'start', tool: 'bash', callId: 'c2', args: {} }), { kind: 'run', label: 'npm run lint' });
  f.onEvent('s', ev({ type: 'toolCall', phase: 'failed', tool: 'bash', callId: 'c2' }));
  f.onEvent('s', ev({ type: 'thinking', reasoningId: 'r', delta: 'First I look. Then I act. ' }));
  let ls = f.screen('s');
  eq(ls.map((l) => l.k), ['ok', 'err', 'think', 'think'], 'tool lines take their result; a thinking block adds its sentences');
  eq(ls[0].t, 'Running npm test', 'the readout phrase');
  const first = ls[0].n;
  f.onEvent('s', ev({ type: 'output', delta: 'Done now. ' }));
  ls = f.screen('s');
  eq(ls[0].n, first, 'a line keeps its number');
  eq(ls[ls.length - 1].t, 'Done now.', 'the newest line is last');
  // a finished turn keeps its lines: unlike the desk readout, a done screen still shows them (FR-035)
  f.onEvent('s', ev({ type: 'status', status: 'idle' }));
  eq(f.of('s'), null, 'the readout is empty');
  ok(all(f.screen('s')).includes('Done now.'), 'the screen keeps the lines after the turn');
  // the cap: 24 lines, 200 characters, also from 1 MB of text; linear enough to take at most a moment
  f = F();
  for (let i = 0; i < 60; i++) f.onEvent('s', ev({ type: 'toolCall', phase: 'start', tool: 'bash', callId: 'x' + i, args: {} }), { kind: 'run', label: 'step' + i });
  ls = f.screen('s');
  eq(ls.length, 24, 'at most 24 lines');
  eq(ls[23].t, 'Running step59', 'the newest kept');
  f = F();
  f.onEvent('s', ev({ type: 'output', delta: 'word '.repeat(200000), final: true, text: 'word '.repeat(200000) }));
  ls = f.screen('s');
  ok(ls.length > 0 && ls.length <= 24 && ls.every((l) => Array.from(l.t).length <= 200), '1 MB of text: capped');
  f = F();
  f.onEvent('s', ev({ type: 'output', delta: 'x'.repeat(1048576) }));
  eq(f.screen('s'), [], '1 MB with no space: all of it is a cut word, nothing shows');
  // hostile output (SC-005): token, home path, markup, a link, ANSI, in reply and thinking and a tool label
  const HOSTILE = 'See ' + TOKEN + ' in /Users/alice/.ssh/id and C:\\Users\\alice\\x and <img src=x onerror=alert(1)> and [click](https://evil.example/a) \x1b[31mred\x1b[0m \x1b]0;title\x07end\x07\u202e. ';
  for (const type of ['output', 'thinking']) {
    f = F();
    f.onEvent('s', ev({ type, reasoningId: 'r', delta: HOSTILE }));
    const t = all(f.screen('s'));
    ok(!t.includes('ghp_') && !t.includes('A1b2C3d4'), type + ': token masked: ' + t);
    ok(!t.includes('alice'), type + ': home path shortened: ' + t);
    ok(!/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e]/.test(t), type + ': no control code left');
    ok(!t.includes('https://evil') && t.includes('click'), type + ': a Markdown link is its word');
    ok(t.includes('<img src=x onerror=alert(1)>'), type + ': HTML stays text for textContent to show: ' + t);
    ok(t.includes('red') && t.includes('end'), type + ': the words around the codes stay');
  }
  // a token split by an escape is whole again BEFORE the mask (the strip must come first)
  f = F();
  const split = 'ghp_A1b2\x1b[0mC3d4E5f6G7h8I9j0K1l2M3n4 next. ';
  f.onEvent('s', ev({ type: 'output', delta: split }));
  ok(!all(f.screen('s')).includes('A1b2') && !all(f.screen('s')).includes('M3n4'), 'a token split by ANSI is masked: ' + all(f.screen('s')));
  f = F();
  f.onEvent('s', ev({ type: 'toolCall', phase: 'start', tool: 'bash', callId: 'c', args: {} }), { kind: 'run', label: 'curl -H "x: gh\x1b[0mp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4" /home/alice/y' });
  ok(!all(f.screen('s')).includes('A1b2') && !all(f.screen('s')).includes('alice'), 'a tool label too: ' + all(f.screen('s')));
  // a token still arriving is not shown half: the word being written is held back until it ends
  f = F();
  f.onEvent('s', ev({ type: 'output', delta: 'Reading ghp_A1b2C3' }));
  eq(all(f.screen('s')), 'Reading', 'half a token: held back');
  f.onEvent('s', ev({ type: 'output', delta: 'd4E5f6G7h8I9j0K1l2M3n4 done ' }));
  ok(!all(f.screen('s')).includes('A1b2'), 'the whole token: masked');
  // a text cut at KEEP loses its first word: half a token at the cut is never shown
  f = F();
  const pad = ' filler'.repeat(200);
  f.onEvent('s', ev({ type: 'output', delta: 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4' + pad.slice(0, 1200 - 10) + ' ' }));
  ok(!/[A-Za-z0-9]{6,}/.test(all(f.screen('s')).replace(/filler|redacted/g, '')), 'a cut token head or tail does not show: ' + all(f.screen('s')).slice(0, 80));
  // fail closed: no working mask, no lines
  const none = L.create({ mask: {} as never }) as unknown as ReturnType<typeof F>;
  none.onEvent('s', ev({ type: 'output', delta: 'secret words ' }));
  eq(none.screen('s'), [], 'no mask: no lines');
  eq(none.block('secret words'), [], 'no mask: no block');
  const bad = L.create({ mask: { ...mask, redact: () => { throw new Error('x'); } } }) as unknown as ReturnType<typeof F>;
  bad.onEvent('s', ev({ type: 'output', delta: 'secret words ' }));
  eq(bad.screen('s'), [], 'a throwing mask: no lines');
  // review of P2: hidden characters inside a token, on a screen and on flat's own path; a joiner stays when nothing is masked
  const ST = require(path.join(R, 'safetext.js')) as { excerpt(t: string, r: (s: string) => string, n?: number): string; maskRaw(t: string, r: (s: string) => string): string; maskLabel(t: string, k: string, m: Record<string, (s: string) => string>): string };
  const tail = 'E5f6G7h8I9j0K1l2M3n4', head = 'ghp_A1b2C3d4';
  for (const [nm, ch] of [['ZWSP', '\u200b'], ['SHY', '\u00ad'], ['ALM', '\u061c'], ['LS', '\u2028'], ['ZWJ', '\u200d'], ['tag', '\u{e0041}'], ['VS', '\ufe0f']] as const) {
    const tok = head + ch + tail;
    f = F();
    f.onEvent('s', ev({ type: 'output', delta: 'See ' + tok + ' here. ' }));
    ok(!/A1b2|M3n4/.test(all(f.screen('s'))), nm + ': masked on a screen: ' + all(f.screen('s')));
    f = F();
    f.onEvent('s', ev({ type: 'toolCall', phase: 'start', tool: 'bash', callId: 'c', args: {} }), { kind: 'run', label: 'echo ' + tok });
    ok(!/A1b2|M3n4/.test(all(f.screen('s'))), nm + ': masked in a tool line');
    const red = (x: string) => redact(x, {});
    ok(!/A1b2|M3n4/.test(ST.maskRaw(tok, red)), nm + ': flat maskRaw');
    ok(!/A1b2|M3n4/.test(ST.excerpt(tok, red, 200)), nm + ': flat excerpt');
    ok(!/A1b2|M3n4/.test(ST.maskLabel(tok, 'read', mask)), nm + ': flat maskLabel');
    const lo = L.create({ mask }) as unknown as Feed;
    lo.onEvent('s', ev({ type: 'output', delta: 'See ' + tok + ' now. Done. ' }));
    ok(!/A1b2|M3n4/.test(String(lo.of('s')?.lines)), nm + ': flat readout');
  }
  const persian = 'می\u200cخواهم', red2 = (x: string) => redact(x, {});
  eq(ST.maskRaw(persian, red2), persian, 'a joiner stays when nothing is masked (flat)');
  f = F();
  f.onEvent('s', ev({ type: 'output', delta: persian + ' done. ' }));
  ok(all(f.screen('s')).includes('\u200c'), 'a joiner stays when nothing is masked (screen)');
  // escape introducers: the letter after one may belong to the token
  for (const intro of ['\x9b', '\x1b[', '\x1b', '\x9d', '\x90']) {
    f = F();
    f.onEvent('s', ev({ type: 'output', delta: 'See gh' + intro + 'p_A1b2C3d4E5f6G7h8I9j0K1l2M3n4 here. ' }));
    ok(!/A1b2|M3n4/.test(all(f.screen('s'))), JSON.stringify(intro) + ': masked: ' + all(f.screen('s')));
  }
  // FR-035 strict: a question or approval: the command and URL masks too, one line, 200 characters; a missing mask: nothing
  f = F();
  const lines = (f as unknown as { strict(raw: string, k?: string): { k: string; t: string }[] }).strict('Allow: curl --api-key abc123secretvalue9 https://user:pw@example.test/x?token=zzz999 and more. ' + 'word '.repeat(5000));
  eq(lines.length, 1, 'one line');
  ok(Array.from(lines[0].t).length <= 200, 'at most 200 characters');
  ok(!lines[0].t.includes('abc123secretvalue9'), 'the command mask ran: ' + lines[0].t);
  ok(!lines[0].t.includes('pw@') && !lines[0].t.includes('zzz999'), 'the URL mask ran: ' + lines[0].t);
  const u1 = (f as unknown as { strict(raw: string): { t: string }[] }).strict('Open https://example.test/cb?code=zzz999&x=1 please')[0].t;
  ok(!u1.includes('zzz999'), 'a URL secret the command mask leaves: ' + u1);
  f = F();
  f.onEvent('s', ev({ type: 'output', delta: 'plain\u200b wo\u00adrd\u061c here. ' }));
  eq(all(f.screen('s')), 'plain word here.', 'invisible characters do not reach a screen');
  eq((L.create({ mask: { redact: mask.redact } as never }) as unknown as { strict(r: string): unknown[] }).strict('words'), [], 'no command mask: nothing');
  // helpers' events never reach their parent's screen; a dropped agent keeps nothing
  f = F();
  f.onEvent('s', ev({ type: 'output', agentId: 'h', delta: 'helper words ' }));
  eq(f.screen('s'), [], 'a helper stays off the screen');
  // the page wiring: main's masked events come through liveFeed; flat's readout does not change by it
  const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
  ok(/if\(LIVEACT\.onEvent\(a\.id,e,x\)\)livePaintSoon\(a\);\s*if\(OFFICE_VIEW==='real'&&window\.DurbarRealOffice\)window\.DurbarRealOffice\.feed\(a\.id\);/.test(app), 'liveFeed tells the monitor');
  ok(/home:t=>R\.maskHomePaths\(t\)/.test(app), 'the page masks home paths on screens');
  const rs = app.slice(app.indexOf('function realScreen'), app.indexOf('const roFrozen='));
  ok(/quiet=!live&&\(state==='working'\|\|state==='thinking'\)/.test(rs) && /\|\|quiet\?\[\]/.test(rs), 'Live activity off: a busy screen shows no task');
  ok(/\(state==='done'\|\|state==='idle'\)&&a\.lastOutput/.test(rs), 'the last reply only when done or idle, as flat');
  ok(/ask\?LIVEACT\.strict\(/.test(rs), 'a question or error through the strict mask');
  const ro = fs.readFileSync(path.join(R, 'realoffice.js'), 'utf8');
  ok(!/\.ro-sl|ro-rows[^]*innerHTML/.test(ro.slice(ro.indexOf('function fillRows'), ro.indexOf('function paintScreen'))), 'rows take no markup');
}
console.log(`liveact: ${n} checks passed`);
