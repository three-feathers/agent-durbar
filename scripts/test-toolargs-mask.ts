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
import { maskMcpEvent, maskToolArgs } from '../src/main/mcpmask';
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
ok('CAP: a string past the masks cap is cut like the chip and masked', () => {
  const head = 'echo ' + 'word '.repeat(2000) + `--password ${PW} `;
  const long = head + 'more '.repeat(2000) + GH;
  const m = maskToolArgs({ command: long }) as { command: string };
  assert.ok(long.length > R.MASK_INPUT_MAX, 'CAP the input is over the cap');
  assert.ok(m.command.length <= R.MASK_INPUT_MAX, `CAP cut to the cap (${m.command.length})`);
  assert.deepStrictEqual(leaks(m), [], 'CAP nothing hidden shows, in the head or past the cut');
  const plain = 'a '.repeat(R.MASK_INPUT_MAX);
  const mp = maskToolArgs({ prompt: plain }) as { prompt: string };
  assert.strictEqual(mp.prompt, plain.slice(0, plain.slice(0, R.MASK_INPUT_MAX + 1).search(/\s\S*$/)), 'CAP a harmless long text is cut at its last blank before the cap, as the chip cuts');
});
ok('DEPTH: past the walk depth a value is the mask', () => {
  let deep: unknown = `token ${GH}`;
  for (let i = 0; i < 12; i++) deep = { x: deep };
  assert.deepStrictEqual(leaks(maskToolArgs(deep)), [], 'DEPTH nothing deep shows');
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
  const re = /args: maskToolArgs\(e\.args, values\)/;
  assert.ok(re.test(src), 'the masking call is in the compiled module (the mutation applies)');
  const mod = { exports: {} as { maskMcpEvent?: MaskFn } };
  new Function('module', 'exports', 'require', src.replace(re, 'args: e.args'))(mod, mod.exports, createRequire(file));
  assert.strictEqual(typeof mod.exports.maskMcpEvent, 'function', 'the mutant loads');
  assert.throws(() => wire(mod.exports.maskMcpEvent as MaskFn), /WIRE-START/, 'the mutant dies at WIRE-START');
});

console.log(`test-toolargs-mask: ${n} groups ok`);
