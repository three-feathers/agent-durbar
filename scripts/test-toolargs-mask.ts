/**
 * Unit test (spec 005 FR-342, main half, T429, issue #1975): main masks a tool call's arguments before the window or the debug log gets them
 * (defence in depth). `npm run test:toolargs-mask`. No credits, no Electron. Every secret-like value below is invented and built from pieces.
 * The last block runs the same wire checks on a patched copy of the compiled module that passes the raw arguments: it must fail at WIRE-START.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import * as R from '../src/shared/redact';
import { ARGS_CHARS_MAX, ARGS_NODES_MAX, ARGS_STRINGS_MAX, _toolArgsWorkForTest, createToolArgsMasker, maskMcpEvent, maskToolArgs } from '../src/main/mcpmask';
import { BrainMask, brainState, currentStep, initBrain } from '../src/shared/brainstate';
import type { AgentEvent } from '../src/adapters/types';

let n = 0;
const ok = (name: string, fn: () => void): void => { fn(); n++; console.log(`  ok ${name}`); };

// invented values, each from pieces so no file holds one whole
const GH = ['gh', 'p_', 'A1b2C3d4E5', 'f6G7h8I9j0', 'K1l2M3n4O5', 'p6Q7r8'].join('');
const PW = ['zq', 'Xk9', 'plain', 'pw42'].join('');
const PW2 = ['Lm', '7rt', 'other', 'pw88'].join('');
const PW3 = ['Ur', '1ab', 'userinfo', 'pw'].join('');
const BEARER = ['abcdef', '1234567890', 'XYZ'].join('');
const SESSION = ['zq-hunter2', '-session', '-value'].join('');
const NEEDLES = [GH, PW, PW2, PW3, BEARER, SESSION];
const leaks = (x: unknown): string[] => { const j = JSON.stringify(x); return NEEDLES.filter((s) => j.includes(s)); };

type Ev = Extract<AgentEvent, { type: 'toolCall' }>;
const ev = (phase: Ev['phase'], tool: string, args: unknown): AgentEvent => ({ type: 'toolCall', sessionId: 's1', callId: 'c1', tool, phase, args } as unknown as AgentEvent);

// ---- harmless arguments pass exactly as the adapter sent them (every consumer then shows what it showed before)
const HARMLESS: unknown[] = [
  { command: 'npm test' },
  { command: 'git log --oneline -5 && git status' },
  { command: 'for f in src/*.ts; do\n  wc -l "$f"\ndone', description: 'Count lines' },
  { command: "grep -rn 'TODO' src | head -20" },
  { command: 'echo "hello world" > out.txt' },
  { command: 'python3 -c "print(1 + 2)"' },
  { command: ['git', 'diff', '--stat', 'HEAD~1'] },
  { path: '/Users/ada/project/src/main/main.ts' },
  { file_path: 'C:\\Users\\ada\\project\\README.md', offset: 10, limit: 200 },
  { pattern: '**/*.test.ts', path: 'src' },
  { query: 'how to sort a map by value', max_results: 5 },
  { url: 'https://example.com/docs/page?lang=en&page=2#intro' },
  { sessionId: 'main', delay: 5 },
  { description: 'Find the auth bug', prompt: '# Task\n\nRead `src/session.ts` and list the functions that handle the login.\n\n- keep it short\n- name the files', agent_type: 'explore' },
  { todos: [{ content: 'Write the test', status: 'pending' }, { content: 'Run it', status: 'done' }] },
  { old_string: 'const a = 1;\n', new_string: 'const a = 2;\n', replace_all: false },
  { flag: true, n: 0, nothing: null, list: [] },
  'just a string argument',
  ['ls', '-la'],
  { nested: { deeper: { list: ['a', 'b', { c: 'd' }] } } },
];

ok('HARMLESS arguments pass unchanged', () => {
  for (const a of HARMLESS) assert.deepStrictEqual(maskToolArgs(a, [SESSION]), a, `HARMLESS changed: ${JSON.stringify(a).slice(0, 120)}`);
});

// a generated corpus of harmless commands, paths, searches and URLs (fixed pieces, every combination)
ok('HARMLESS-CORPUS passes unchanged', () => {
  const progs = ['git status', 'npm run build', 'ls -la', 'cat package.json', 'node scripts/x.js', 'rg -n foo src', 'make all', 'cargo test', 'go vet ./...', 'pytest -q'];
  const tails = ['', ' | head -5', ' && echo done', ' > /tmp/out.log 2>&1', ' --verbose'];
  const paths = ['src/a.ts', '/home/ada/p/b.js', 'C:\\work\\c.py', 'docs/Read Me.md', './x/y/z.json'];
  const urls = ['https://example.org/', 'http://localhost:3000/api/items?id=42', 'https://docs.example.com/a/b#c'];
  let bad = 0, total = 0;
  for (const p of progs) for (const t of tails) { total++; const a = { command: p + t }; if (JSON.stringify(maskToolArgs(a)) !== JSON.stringify(a)) bad++; }
  for (const p of paths) { total++; const a = { path: p }; if (JSON.stringify(maskToolArgs(a)) !== JSON.stringify(a)) bad++; }
  for (const u of urls) { total++; const a = { url: u }; if (JSON.stringify(maskToolArgs(a)) !== JSON.stringify(a)) bad++; }
  assert.strictEqual(bad, 0, `HARMLESS-CORPUS ${bad} of ${total} changed`);
});

// ---- values the mask hides are gone from everything the window receives
const SECRET_ARGS: Array<[string, unknown]> = [
  ['token in a command', { command: `git clone https://github.com/o/r && echo ${GH}` }],
  ['secret flag in a command', { command: `mysql -u bob --password ${PW} -e "select 1"` }],
  ['word list', { command: ['mysql', '-u', 'bob', '--password', PW2] }],
  ['userinfo in a URL', { url: `https://bob:${PW3}@host.example.com/x` }],
  ['header in prose', { prompt: `Call the API with Authorization: Bearer ${BEARER} and report.` }],
  ['session value anywhere', { description: `use ${SESSION} here`, path: `/tmp/${SESSION}/a.txt` }],
  ['nested', { a: { b: [{ c: `token ${GH}` }] } }],
  ['a top-level string', `curl -H "Authorization: Bearer ${BEARER}" https://example.com`],
];
ok('SECRET arguments are masked', () => {
  for (const [name, a] of SECRET_ARGS) {
    const m = maskToolArgs(a, [SESSION]);
    assert.deepStrictEqual(leaks(m), [], `SECRET ${name}: ${JSON.stringify(m).slice(0, 200)}`);
    assert.ok(JSON.stringify(m).includes('[redacted'), `SECRET ${name}: a mask stands in its place`);
  }
});
ok('SHAPE kept: keys, arrays and non-strings', () => {
  const m = maskToolArgs({ command: ['mysql', '--password', PW2], n: 3, b: false, z: null }) as Record<string, unknown>;
  assert.deepStrictEqual(Object.keys(m), ['command', 'n', 'b', 'z'], 'SHAPE keys kept');
  assert.ok(Array.isArray(m.command) && (m.command as unknown[]).length === 3, 'SHAPE the word list keeps its length');
  assert.strictEqual(m.n, 3); assert.strictEqual(m.b, false); assert.strictEqual(m.z, null);
  assert.strictEqual((m.command as string[])[0], 'mysql', 'SHAPE a harmless word stays');
});
ok('STRADDLE: a value across the old cut point shows no piece of itself', () => {
  // no piece of 6 or more characters of the invented value may appear (a cut before masking leaves its head)
  const pieces = (v: string): string[] => Array.from({ length: v.length - 5 }, (_, i) => v.slice(i, i + 6));
  const shows = (m: unknown): string[] => pieces(GH).filter((p) => JSON.stringify(m).includes(p));
  const noBlank = 'Q'.repeat(R.MASK_INPUT_MAX - 10) + GH; // one word: the value starts 10 characters before the limit
  assert.deepStrictEqual(shows(maskToolArgs({ content: noBlank })), [], 'STRADDLE-NOBLANK no piece of the value shows');
  // a quoted value with blanks inside, its name 12 characters before the limit: a cut at a blank before masking leaves its first words
  const V = ['Zr4', 'quiet', 'fern', 'Pw77', 'lake', 'Mo9n'].join(' ');
  const name = ['PASS', 'WORD="'].join('');
  const lead = 'word '.repeat(Math.ceil((R.MASK_INPUT_MAX - 12) / 5)).slice(0, R.MASK_INPUT_MAX - 12 - name.length);
  const withBlank = `${lead} ${name}${V}" tail words`;
  assert.ok(withBlank.indexOf(V) < R.MASK_INPUT_MAX && withBlank.indexOf(V) + V.length > R.MASK_INPUT_MAX, 'the value straddles the limit');
  const out = JSON.stringify(maskToolArgs({ command: withBlank }));
  assert.deepStrictEqual(V.split(' ').filter((w) => out.includes(w)), [], 'STRADDLE-BLANK no word of the value shows');
});
ok('OVER-LIMIT: a string over the masks input limit is sent empty, never cut', () => {
  const plain = 'a '.repeat(R.MASK_INPUT_MAX);
  assert.deepStrictEqual(maskToolArgs({ prompt: plain, path: 'src/a.ts' }), { prompt: '', path: 'src/a.ts' }, 'OVER-LIMIT a harmless long text is empty, the rest kept');
  const exact = 'b'.repeat(R.MASK_INPUT_MAX);
  assert.deepStrictEqual(maskToolArgs({ content: exact }), { content: exact }, 'OVER-LIMIT a string at the limit is kept whole');
});
ok('DEPTH: past the walk depth a value is the mask', () => {
  let deep: unknown = `token ${GH}`;
  for (let i = 0; i < 12; i++) deep = { x: deep };
  assert.deepStrictEqual(leaks(maskToolArgs(deep)), [], 'DEPTH nothing deep shows');
  // a harmless value 9 objects down: depth 8 is an object, so it is the mask; 8 down it is kept
  const nest = (k: number, leaf: unknown): unknown => (k ? { x: nest(k - 1, leaf) } : leaf);
  const dig = (v: unknown, k: number): unknown => (k ? dig((v as { x: unknown }).x, k - 1) : v);
  assert.strictEqual(dig(maskToolArgs(nest(9, { y: 'plain words' })), 8), '[redacted]', 'DEPTH-EXACT the object at depth 8 is the mask');
  assert.deepStrictEqual(maskToolArgs(nest(7, { y: 'plain words' })), nest(7, { y: 'plain words' }), 'DEPTH-EXACT 7 levels down is kept');
});

// ---- review of #2002
ok('CATCH: a failure inside the walk fails closed', () => {
  const evil = { command: 'echo hi', get boom(): string { throw new Error('boom'); } };
  assert.strictEqual(maskToolArgs(evil), '[redacted]', 'CATCH a throwing argument gives the mask, not the arguments');
});
ok('WRITE-12K: a normal file write passes unchanged within the budget', () => {
  const content = 'const x = 1;\n'.repeat(Math.floor(R.MASK_INPUT_MAX / 13));
  const a = { file_path: 'src/a.ts', content };
  assert.deepStrictEqual(maskToolArgs(a), a, 'WRITE-12K unchanged');
  const w = _toolArgsWorkForTest();
  assert.ok(w.strings === 2 && w.chars === content.length + 'src/a.ts'.length, `WRITE-12K work ${JSON.stringify(w)}`);
});
ok('BUDGET: large arguments stop at a fixed work cap and become the mask', () => {
  const nest = (d: number): unknown => (d ? Object.fromEntries(Array.from({ length: 6 }, (_, i) => ['k' + i, nest(d - 1)])) : 'leaf');
  const big: Array<[string, unknown]> = [
    ['10k elements', { a: Array.from({ length: 10_000 }, (_, i) => 'w' + i) }],
    ['10k keys', Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => ['k' + i, 'v ' + i]))],
    ['100k elements', { a: Array.from({ length: 100_000 }, (_, i) => 'w' + i) }],
    ['1000 x 12k strings', { a: Array.from({ length: 1000 }, () => 'echo hello world '.repeat(700)) }],
    ['6 keys x 7 levels', nest(7)],
    ['10k numbers', { a: Array.from({ length: 10_000 }, (_, i) => i) }],
    ['10 x 12k strings', { a: Array.from({ length: 10 }, () => 'echo hello world '.repeat(700)) }],
    ['600 short strings', { a: Array.from({ length: 30 }, () => Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['k' + i, 'v' + i]))) }],
  ];
  for (const [name, a] of big) {
    const m = maskToolArgs(a);
    const w = _toolArgsWorkForTest();
    assert.strictEqual(m, '[redacted]', `BUDGET ${name}: replaced by the mask`);
    assert.ok(w.nodes <= ARGS_NODES_MAX && w.strings <= ARGS_STRINGS_MAX && w.chars <= ARGS_CHARS_MAX, `BUDGET ${name}: work within the caps ${JSON.stringify(w)}`);
  }
});
ok('REPEAT: main masks an arguments object once and an over-budget call once', () => {
  const masker = createToolArgsMasker();
  const wide = { a: Array.from({ length: 10_000 }, (_, i) => 'w' + i) };
  const e1 = ev('start', 'bash', wide);
  assert.strictEqual(masker(e1, []), '[redacted]', 'REPEAT the over-budget start is the mask');
  maskToolArgs('marker words');
  const before = _toolArgsWorkForTest();
  assert.strictEqual(masker(ev('update', 'bash', { a: Array.from({ length: 10_000 }, (_, i) => 'u' + i) }), []), '[redacted]', 'REPEAT a later update of that call is the mask');
  assert.deepStrictEqual(_toolArgsWorkForTest(), before, 'REPEAT-NOWORK the update did no masking work');
  const ok1 = ev('start', 'bash', { command: `mysql --password ${PW}` });
  (ok1 as unknown as { callId: string }).callId = 'c2';
  const m1 = masker(ok1, []);
  maskToolArgs('marker words');
  const b2 = _toolArgsWorkForTest();
  assert.strictEqual(masker(ok1, []), m1, 'REPEAT-SAME the same arguments object (window and debug log) gives the same copy');
  assert.deepStrictEqual(_toolArgsWorkForTest(), b2, 'REPEAT-SAME no work the second time');
  assert.deepStrictEqual(leaks(m1), [], 'REPEAT the masker masks');
});
ok('URL-READING: a URL only the URL reading hides', () => {
  const W = ['plain', 'wordy', 'x'].join('');
  const m = maskToolArgs({ prompt: `[https://h.example/x?session=${W}]` });
  assert.ok(!JSON.stringify(m).includes(W), `URL-READING hidden: ${JSON.stringify(m)}`);
});
ok('NO-NEW-TEXT: a reading that rewrites the text shows no text the argument did not hold', () => {
  const input = 'powershell -Command "$h = @{Authorization=\\"' + PW + '\\"}; echo \\"a b\\""';
  const m = maskToolArgs({ command: input }) as { command: string };
  assert.ok(!m.command.includes(PW), 'NO-NEW-TEXT hidden');
  const extra = m.command.split(/(\s+|\[redacted(?::[^\]\r\n]{1,128})?\])/).filter((p, k) => k % 2 === 0 && p && !input.includes(p));
  assert.deepStrictEqual(extra, [], 'NO-NEW-TEXT every shown piece is from the argument');
});
ok('AS-WRITTEN: the command reading reads the text as written, not the note mask output', () => {
  const input = `https://u:${PW}@h.example/ $h = @{Authorization=\\"${PW}\\"}`;
  assert.deepStrictEqual(leaks(maskToolArgs({ prompt: input })), [], 'AS-WRITTEN hidden');
});
ok('VALUES-READINGS: the command reading gets the session values replaced too', () => {
  const V = ['alpha', 'beta', 'gamma7'].join(' '); // a session value with blanks, whose words also stand alone in the text
  const m = maskToolArgs({ command: `echo alpha, beta and gamma7: ${V} --token x` }, [V]) as { command: string };
  assert.ok(!m.command.includes(V), `VALUES-READINGS the value does not show: ${m.command}`);
});
ok('QUOTE: a masked header keeps its quotes, one mask', () => {
  const input = 'curl --header "Accept: text/html" https://example.com';
  assert.strictEqual((maskToolArgs({ command: input }) as { command: string }).command, R.maskSecretCommand(input), 'QUOTE the command reading as it is');
});
ok('VALUES-SHORT: session values under 4 characters mask nothing', () => {
  const a = { command: 'ls -la src', description: 'list it' };
  assert.deepStrictEqual(maskToolArgs(a, ['', 'l', 'ab', 'src']), a, 'VALUES-SHORT harmless text kept');
  assert.deepStrictEqual(leaks(maskToolArgs({ command: `mysql --password ${PW}` }, [''])), [], 'VALUES-EMPTY an empty value does not break the command reading');
});
ok('JSON SHAPES: own __proto__ key, mixed lists, non-JSON objects', () => {
  const p = JSON.parse('{"__proto__": {"command": "echo hi"}, "a": 1}');
  const m = maskToolArgs(p) as Record<string, unknown>;
  assert.deepStrictEqual(Object.keys(m), ['__proto__', 'a'], 'PROTO the own key stays a key');
  assert.strictEqual(Object.getPrototypeOf(m), Object.prototype, 'PROTO the copy is a plain object');
  assert.deepStrictEqual(leaks(maskToolArgs({ command: ['mysql', '--password', PW, 1] })), [], 'MIXED-LIST the words of a mixed list are read whole');
  assert.strictEqual((maskToolArgs({ x: new Map([['k', `token ${GH}`]]) }) as { x: unknown }).x, '[redacted]', 'NONJSON a Map is the mask');
});

// ---- the wire: maskMcpEvent (main's `outward`) masks the arguments of a start and an update, MCP or not
type MaskFn = (e: AgentEvent, values?: readonly string[]) => AgentEvent;
function wire(mask: MaskFn): void {
  const s = mask(ev('start', 'bash', { command: `mysql --password ${PW}` }), [SESSION]);
  assert.deepStrictEqual(leaks(s), [], 'WIRE-START a start event leaves main with its arguments masked');
  const u = mask(ev('update', 'bash', { command: `echo ${SESSION} ${GH}` }), [SESSION]);
  assert.deepStrictEqual(leaks(u), [], 'WIRE-UPDATE an update that brings the arguments is masked too');
  const mcpStart = mask({ ...(ev('start', 'fetch', { url: `https://bob:${PW3}@h.example.com/` }) as object), mcpServer: 'srv', mcpTool: 'fetch' } as AgentEvent, []);
  assert.deepStrictEqual(leaks(mcpStart), [], 'WIRE-MCP an MCP call\'s start is masked too');
  const h = ev('start', 'bash', { command: 'npm test' });
  assert.deepStrictEqual(mask(h, []), h, 'WIRE-HARMLESS a harmless call leaves main as it came');
  const done = ev('complete', 'bash', undefined);
  assert.strictEqual(mask(done, []), done, 'WIRE-NOARGS an event with no arguments is the same object');
}
ok('WIRE: maskMcpEvent masks start and update arguments', () => wire(maskMcpEvent as MaskFn));
ok('WIRE-MASKER: with main\'s cached masker too', () => { const mk = createToolArgsMasker(); wire(((e: AgentEvent, v?: readonly string[]) => maskMcpEvent(e, v, mk)) as MaskFn); });

// ---- the Brain dock reads the masked event: a harmless target is the same, a hidden value stays hidden
ok('BRAIN: a step built from the masked event', () => {
  const mask: BrainMask = { ...R } as unknown as BrainMask;
  const step = (e: AgentEvent) => currentStep(brainState(initBrain('Ada', mask), e, 1_000, mask));
  for (const a of [{ command: 'git status && npm test' }, { path: 'src/main/main.ts' }, { url: 'https://example.com/a?b=c' }]) {
    const tool = 'command' in a ? 'bash' : 'url' in a ? 'web_fetch' : 'view';
    const raw = step(ev('start', tool, a)), masked = step(maskMcpEvent(ev('start', tool, a)));
    assert.ok(raw && masked, 'BRAIN a step exists');
    assert.strictEqual(masked!.target, raw!.target, `BRAIN-SAME ${tool}: the target reads as before`);
  }
  const sec = step(maskMcpEvent(ev('start', 'bash', { command: `mysql --password ${PW}` })));
  assert.deepStrictEqual(leaks(sec), [], 'BRAIN-HIDDEN no hidden value in the step');
});

// ---- mutant: the compiled module with the arguments passed raw must fail at WIRE-START
ok('MUTANT: raw arguments fail at WIRE-START', () => {
  const file = path.join(__dirname, '..', 'src', 'main', 'mcpmask.js');
  const src = fs.readFileSync(file, 'utf8');
  const re = /args: maskArgs\(e, values\)/;
  assert.ok(re.test(src), 'the masking call is in the compiled module (the mutation applies)');
  const mod = { exports: {} as { maskMcpEvent?: MaskFn } };
  new Function('module', 'exports', 'require', src.replace(re, 'args: e.args'))(mod, mod.exports, createRequire(file));
  assert.strictEqual(typeof mod.exports.maskMcpEvent, 'function', 'the mutant loads');
  assert.throws(() => wire(mod.exports.maskMcpEvent as MaskFn), /WIRE-START/, 'the mutant dies at WIRE-START');
});

console.log(`test-toolargs-mask: ${n} groups ok`);
