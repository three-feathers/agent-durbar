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
import './safetext-shared';
import * as vm from 'vm';
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
  { command: 'npm test \\\n  --verbose \\\n  --watch=false' },
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
ok('WRITE-CONTENT: file content next to its path is sent empty without being read; the path is kept', () => {
  const content = 'const x = 1;\n'.repeat(Math.floor(R.MASK_INPUT_MAX / 13));
  assert.deepStrictEqual(maskToolArgs({ file_path: 'src/a.ts', content }), { file_path: 'src/a.ts', content: '' }, 'WRITE-CONTENT the content is empty, the path kept');
  const w = _toolArgsWorkForTest();
  assert.ok(w.readings === 1 && w.chars === 'src/a.ts'.length, `WRITE-CONTENT only the path was read ${JSON.stringify(w)}`);
  assert.deepStrictEqual(maskToolArgs({ path: 'b.ts', old_string: 'a', new_string: 'b' }), { path: 'b.ts', old_string: '', new_string: '' }, 'WRITE-CONTENT an edit\'s texts are empty');
  assert.deepStrictEqual(maskToolArgs({ content: 'no path here' }), { content: 'no path here' }, 'WRITE-CONTENT without a path the content is read as any string');
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
    assert.ok(w.nodes <= ARGS_NODES_MAX && w.strings <= ARGS_STRINGS_MAX && w.chars <= ARGS_CHARS_MAX, `BUDGET ${name}: counted within the caps ${JSON.stringify(w)}`);
    assert.strictEqual(w.readings, 0, `BUDGET-NOREAD ${name}: nothing was masked before the budget said no`);
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
ok('QUOTE: a masked header value is one mask in place, the rest of the command as written', () => {
  const input = 'curl --header "Accept: text/html" https://example.com';
  const out = (maskToolArgs({ command: input }) as { command: string }).command;
  assert.strictEqual(out, 'curl --header "Accept: [redacted] https://example.com', `QUOTE the piece the command reading hides is masked in place: ${out}`);
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

// ---- round 4 of the review: union by content on the text as written, no flattening, the window's surfaces
// the page's own masking path, cut out of app.js and run with the compiled shared mask (the window as on main: it masks the raw arguments itself)
const R_DIR = path.join(__dirname, '..', '..', 'src', 'renderer');
const APP = fs.readFileSync(path.join(R_DIR, 'app.js'), 'utf8').replace(/\r\n/g, '\n').split('\n');
const one = (head: string): string => { const ls = APP.filter((l) => l.startsWith(head)); assert.strictEqual(ls.length, 1, `app.js has one line ${head}`); return ls[0]; };
const upto = (head: string, end: (l: string) => boolean): string => { const i = APP.findIndex((l) => l.startsWith(head)); assert.ok(i >= 0, head); let j = i; while (!end(APP[j])) j++; return APP.slice(i, j + 1).join('\n'); };
const PAGE = [one('const SHORT='), one('const RED='), one('const STX='), one('const SAFE='), one('const safeExcerpt='), one('const deskMask='), one('const homeMask='), one('const helperMask='),
  one('const TOOLMASK='), one('const safeToolLabel='), one('const toolArg='), one('function toolLabel('), upto('const toolKind=', (l) => l.endsWith("return 'tool';};")), one('const OUT_SHOWN='),
  one('let CHIP_MASKS='), upto('function chipArg(', (l) => l === '}'), one('const editLabel='), one('const chipArgs='), upto('const LIVE_MASK=', (l) => l.endsWith('})();'))].join('\n');
const LIVE = require(path.join(R_DIR, 'liveact.js'));
const win = vm.createContext({ window: { DurbarRedact: R, DurbarSafeText: require(path.join(R_DIR, 'safetext.js')), DurbarLiveAct: LIVE }, DurbarCutText: require(path.join(R_DIR, 'cuttext.js')), NO_REDACT: false });
vm.runInContext(PAGE + '\nthis.P={chipArgs,safeToolLabel,toolLabel,toolKind,helperMask,safeExcerpt,homeMask,LIVE_MASK};', win);
type Page = { chipArgs(e: unknown): { label: string; full: string }; safeToolLabel(t: string, l: string, n: number): string; toolLabel(a: unknown): string; toolKind(t: string): string;
  helperMask(t: string): string; safeExcerpt(t: string, n: number, fb?: string): string; homeMask(t: string): string; LIVE_MASK: unknown };
const P = (win as unknown as { P: Page }).P;
const BMASK: BrainMask = { ...R } as unknown as BrainMask;
const SURFACES: Record<string, (tool: string, a: unknown) => string> = {
  chip: (tool, a) => { const c = P.chipArgs({ tool, args: a }); return c.label + '\n' + c.full; }, // the line, its title (the same text) and Copy (the full text)
  task: (tool, a) => P.safeToolLabel(tool, P.toolLabel(a), 400),
  helper: (_tool, a) => { const g = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>; return [g.description, g.prompt].map((x) => (x ? P.helperMask(String(x)) + '\n' + P.safeExcerpt(P.homeMask(String(x)), 90, '') : '')).join('\n'); },
  desk: (tool, a) => LIVE.phrase({ kind: P.toolKind(tool), tool, label: P.toolLabel(a) }, P.LIVE_MASK),
  brain: (tool, a) => { const st = currentStep(brainState(initBrain('Ada', BMASK), { type: 'toolCall', sessionId: 's', callId: 'c', tool, phase: 'start', args: a }, 1_000, BMASK)); return st ? st.target : ''; },
};
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v as object).flatMap(strings) : []);
/** Words of the raw arguments a surface hides on main (the window masking the raw arguments) that it shows on the masked copy. */
function shownAgain(tool: string, a: unknown, values: string[] = []): string[] {
  const m = maskToolArgs(a, values);
  const words = [...new Set(strings(a).flatMap((x) => x.match(/[A-Za-z0-9_]{4,}/g) ?? []))].filter((x) => x !== 'redacted');
  const out: string[] = [];
  for (const [name, f] of Object.entries(SURFACES)) {
    const raw = f(tool, a), masked = f(tool, m);
    for (const x of words) if (!raw.includes(x) && masked.includes(x)) out.push(`${name}:${x.slice(0, 3)}…`);
  }
  return out;
}
const A1 = ['Hq4W', 'n7Ks2', 'Pd9Lm', '3Xc5Ty'].join('');
const B1 = ['Bz8N', 'v6Mc4', 'Lk2Jh', '0Gf'].join('');
const V1 = ['Ws5', 'Kd8Rn', '3Tq'].join('');
const PRES = [['--pass', 'word=', A1].join(''), ['tok', 'en ', A1].join('')];
const GAPS = ['^\r\n', ' `\n', '\n', ' \\\n'];
ok('F1-HELPER: a description the helper card masks on the raw text stays masked after main', () => {
  for (const pre of PRES) for (const g of GAPS) {
    const d = pre + g + '-p' + B1;
    const m = maskToolArgs({ prompt: 'p', description: d }) as { description: string };
    if (!P.helperMask(d).includes(B1)) assert.ok(!P.helperMask(m.description).includes(B1), `F1-HELPER ${JSON.stringify(g)}: the helper card hides the value as on main`);
    assert.ok(m.description.split(/\r\n|\n|\r/).length === d.split(/\r\n|\n|\r/).length, `F1-LINES ${JSON.stringify(g)}: main keeps the line structure`);
  }
});
ok('F1-BRAIN: a word list the Brain dock masks on the raw text stays masked after main', () => {
  const a = { query: ['-p', ['x --sec', 'ret \\\n  '].join('') + V1] };
  assert.ok(!SURFACES.brain('web_fetch', a).includes(V1), 'the Brain dock hides the value on the raw arguments (main)');
  assert.ok(!SURFACES.brain('web_fetch', maskToolArgs(a)).includes(V1), 'F1-BRAIN the Brain dock hides the value after main too');
});
ok('F2-LIST: word lists are read whole on the original words, merged by content', () => {
  const cases: Array<[string, unknown]> = [
    ['grep', { query: [['--tok', 'en'].join(''), ['a --sec', 'ret \\\n  '].join('') + V1] }],
    ['bash', { command: [['--tok', 'en'].join(''), 'a \\\n b ' + V1] }],
    ['bash', { command: ['mysql', ['--pass', 'word'].join(''), '[redacted] ' + V1] }],
  ];
  for (const [tool, a] of cases) assert.ok(!JSON.stringify(maskToolArgs(a)).includes(V1), `F2-LIST ${tool}: the value does not reach the window`);
});
ok('UNION: a value one reading hides and another value a second reading hides are both hidden', () => {
  const W = ['plain', 'wordy', 'x'].join('');
  const m = JSON.stringify(maskToolArgs({ prompt: `[https://h.example/x?session=${W}] mysql --password ${PW}` }));
  assert.ok(!m.includes(W), 'UNION-URL the URL reading\'s value hidden next to a command');
  assert.ok(!m.includes(PW), 'UNION-COMMAND the command reading\'s value hidden next to a URL');
  const md = ['**', GH.slice(0, 4), '**', GH.slice(4)].join('');
  const m2 = JSON.stringify(maskToolArgs({ prompt: `${md} [https://h.example/x?session=${W}]` }));
  assert.ok(!m2.includes(GH.slice(4, 14)) && !m2.includes(W), 'UNION-NOTE what only the note mask hides stays hidden next to a URL');
});
ok('CONT-MARK: a mask never takes a line-continuation mark; the helper card hides the next line\'s value as on main', () => {
  const S1 = ['Qm4', 'Tz8Lp', '2Wx9'].join(''), S2 = ['Rk7', 'Vn3Hs', '5Yd1Pa'].join('');
  for (const form of ['^\r\n', '`\n', '\\\n', '\n']) for (const tool of ['bash', 'view']) {
    const d = ['--api', '-key '].join('') + S1 + form + '-p' + S2;
    const m = maskToolArgs({ prompt: 'p', description: d }) as { description: string };
    assert.ok(!m.description.includes(S1), `CONT-MARK ${JSON.stringify(form)} ${tool}: the value is masked`);
    if (form !== '\n') assert.ok(m.description.includes(form), `CONT-MARK-KEPT ${JSON.stringify(form)} ${tool}: the mark and its line break are kept`);
    if (!P.helperMask(d).includes(S2)) assert.ok(!P.helperMask(m.description).includes(S2), `CONT-MARK-HELPER ${JSON.stringify(form)} ${tool}: the helper card hides the next line's value as on main`);
  }
});
ok('LIST-JOINED: a word list keeps every word the window\'s comma-joined reading hides', () => {
  const X = ['Ka7Lm2', 'Np4Qr6', 'St8Uv1'].join('.'), Y = ['Wx3Yz5', 'Ab7Cd9', 'Ef2Gh4'].join('.');
  const cases: Array<[string, unknown]> = [
    ['bash', { command: ['curl', '-ubob:' + X, '-p' + Y] }],
    ['bash', { command: ['tool', ['pass', 'word='].join('') + X, Y] }],
    ['web_fetch', { command: ['curl', ['Coo', 'kie:\r\n-ubob:'].join('') + X, '-p' + Y] }],
  ];
  const pieces = Y.split('.');
  for (const [tool, a] of cases) {
    const m = maskToolArgs(a);
    for (const [name, f] of Object.entries(SURFACES)) {
      const raw = f(tool, a), masked = f(tool, m);
      const again = pieces.filter((p) => !raw.includes(p) && masked.includes(p));
      assert.deepStrictEqual(again, [], `LIST-JOINED ${tool} ${name}: no piece of the next word shows that main hid`);
    }
  }
});
ok('LIST-READINGS: each reading of a list hides what only it hides', () => {
  const V = ['Pl4n', 'Vq8', 'wordy7'].join('');
  assert.ok(!JSON.stringify(maskToolArgs({ command: ['cmd', ['--pass', 'word:Ab3 '].join('') + V] })).includes(V), 'LIST-ORIGINAL the whole-list reading reads the original words');
  assert.ok(!JSON.stringify(maskToolArgs({ command: ['cmd', ['Coo', 'kie:`\n'].join(''), V] })).includes(V), 'LIST-NOTE the joined text is read by the note mask too');
});
ok('CACHE-VALUES: the read cache is keyed by the session values too', () => {
  const mk = createToolArgsMasker();
  const V = ['qv', '7Lk', 'sess', 'ion-9'].join('');
  const long = 'echo ' + 'plain words '.repeat(40) + V;
  mk({ ...(ev('start', 'bash', { command: long }) as object), sessionId: 'sA', callId: 'k1' } as AgentEvent, []);
  const m = mk({ ...(ev('start', 'bash', { command: long }) as object), sessionId: 'sB', callId: 'k2' } as AgentEvent, [V]);
  assert.ok(!JSON.stringify(m).includes(V), 'CACHE-VALUES a string read for one session does not come back unmasked where it holds another session\'s value');
});
ok('R1B: a value attached to its option, then a continuation mark, then the next piece: nothing main hid shows', () => {
  const A2 = ['Hq4W', 'n7Ks2', 'Pd9Lm', '3Xc5Ty'].join(''), B2 = ['Bz8Nv6', 'Mc4Lk2', 'Jh0Gf'];
  const B = B2.join('');
  const pres = [['--pass', 'word='].join('') + A2, '-p' + A2];
  const marks = ['\\\n', '\\\r\n', '`\n', '`\r\n'];
  const posts = ['-p' + B, B, B + ' && next', '  ' + B, '--x ' + B];
  const shapes: Array<[string, (raw: string) => unknown]> = [['task', (raw) => ({ prompt: 'p', description: raw })], ['bash', (raw) => ({ command: raw })], ['web_fetch', (raw) => ({ url: raw })]];
  const bad: string[] = [];
  for (const pre of pres) for (const mk of marks) for (const post of posts) for (const [tool, mkArgs] of shapes) {
    const a = mkArgs(pre + mk + post), m = maskToolArgs(a);
    for (const [name, f] of Object.entries(SURFACES)) {
      const raw = f(tool, a), masked = f(tool, m);
      for (const p of B2) if (!raw.includes(p) && masked.includes(p)) bad.push(`${tool} ${name} ${JSON.stringify(mk)}`);
    }
  }
  assert.deepStrictEqual([...new Set(bad)], [], 'R1B no piece of the next value shows that main hid');
});
ok('LIST-CONT-MARK: a list word keeps its continuation mark when a joined reading masks the value before it', () => {
  const A2 = ['Hq4W', 'n7Ks2', 'Pd9Lm', '3Xc5Ty'].join(''), B = ['Bz8Nv6', 'Mc4Lk2', 'Jh0Gf'].join('');
  const m = maskToolArgs({ command: ['curl', ['Coo', 'kie:'].join(''), A2 + '\\\n' + B] }) as { command: string[] };
  assert.ok(!m.command[2].includes(A2) && !m.command[2].includes(B), 'LIST-CONT-MARK the values are masked');
  assert.ok(m.command[2].includes('\\\n'), `LIST-CONT-MARK the mark and its line break are kept: ${JSON.stringify(m.command[2]).replace(A2, 'A').replace(B, 'B')}`);
});
ok('R7: a list whose joined text is over the limit shows its first words like main, and no value in part', () => {
  const word = (i: number): string => ['src/renderer/some/longer/folder/name/here', 'file' + String(i).padStart(4, '0') + '.js'].join(' '); // two pieces each
  const base = Array.from({ length: 250 }, (_, i) => word(i)); // about 13,000 characters joined
  // a first word of a length that puts the limit inside the SECOND piece of the word it splits (a word shown in part would show its first piece)
  const lead = (d: number): string[] => ['p'.repeat(d), ...base];
  const split = (ws: string[]): [number, number] => { let n = 0; for (let k = 0; k < ws.length; k++) { const s0 = n + (k ? 1 : 0); if (s0 + ws[k].length > R.MASK_INPUT_MAX) return [k, R.MASK_INPUT_MAX - s0]; n = s0 + ws[k].length; } return [-1, 0]; };
  let d = 1; while (d < 60 && !(split(lead(d))[1] > base[0].indexOf(' ') + 1)) d++;
  const harmless = lead(d);
  assert.ok(harmless.join(',').length > R.MASK_INPUT_MAX, 'the joined text is over the limit');
  const m = maskToolArgs({ command: harmless }) as { command: string[] };
  assert.deepStrictEqual(m.command.slice(0, 200), harmless.slice(0, 200), 'R7-HEAD the first words before the limit are shown as written');
  assert.ok(split(harmless)[1] > base[0].indexOf(' ') + 1, 'the limit falls inside the second piece of a word');
  const allMasked = (x: string): boolean => x.split(/\s+/).every((p) => p === '[redacted]');
  assert.ok(m.command.slice(-10).every(allMasked), 'R7-TAIL words past the limit are masked whole');
  let k0 = 0; for (let n = 0; k0 < harmless.length; k0++) { n += harmless[k0].length + (k0 ? 1 : 0); if (n > R.MASK_INPUT_MAX) break; }
  assert.ok(allMasked(m.command[k0]), `R7-SPLIT-WORD the word the limit splits is masked whole, never in part: ${m.command[k0]}`);
  assert.strictEqual(m.command[k0 - 1], harmless[k0 - 1], 'R7-SPLIT-WORD the word before it is shown');
  const V = ['Zq8Lm', '4Rt7Wx', '2Pk9Vn'].join(''); // an invented value
  const pieces = (v: string): string[] => Array.from({ length: v.length - 3 }, (_, i) => v.slice(i, i + 4));
  const at = (k: number): string[] => { const w = harmless.slice(); w.splice(k, 0, ['--pass', 'word'].join(''), V); return w; };
  let straddle = 0; for (let k = 0, n = 0; k < harmless.length; k++) { n += harmless[k].length + 1; if (n + 11 > R.MASK_INPUT_MAX - 5) { straddle = k; break; } }
  const cases: Array<[string, string[]]> = [['first part', at(5)], ['cut-off part', at(240)], ['straddling the limit', at(straddle)]];
  for (const [name, words] of cases) {
    const mm = maskToolArgs({ command: words });
    assert.deepStrictEqual(pieces(V).filter((p) => JSON.stringify(mm).includes(p)), [], `R7-PART ${name}: no piece of the value in main's copy`);
    for (const [sname, f] of Object.entries(SURFACES)) {
      const raw = f('bash', { command: words }), masked = f('bash', mm);
      const again = harmless.slice(0, 5).concat([V]).filter((x) => !raw.includes(x) && masked.includes(x));
      assert.deepStrictEqual(again, [], `R7-DIFF ${name} ${sname}: nothing main hid shows`);
      assert.deepStrictEqual(pieces(V).filter((p) => masked.includes(p)), [], `R7-PART ${name} ${sname}: no piece of the value shows`);
    }
  }
});
ok('NPM-WRAPPER: a shell wrapper\'s script split into words stays as written', () => {
  const words = ['npm', 'run', 'build', '&&', 'sh', '-c', '"L=\\$(mktemp);', 'DURBAR_SIM=15', 'electron', '.', '2>&1', '|', 'tee', '\\$L"'];
  assert.deepStrictEqual(maskToolArgs({ command: words }), { command: words }, 'NPM-WRAPPER harmless words unchanged');
});
ok('LIST-10K: a harmless list of about 10,000 characters passes unchanged, each word counted once', () => {
  const words = Array.from({ length: 200 }, (_, i) => 'src/renderer/some/long/folder/name/file' + String(i).padStart(4, '0') + '.js');
  assert.deepStrictEqual(maskToolArgs({ command: words }), { command: words }, 'LIST-10K unchanged');
  const w = _toolArgsWorkForTest();
  assert.strictEqual(w.chars, words.reduce((k, x) => k + x.length, 0), `LIST-10K each word counted once ${JSON.stringify(w)}`);
});
ok('LINEAR: a long list is merged in work linear in its length', () => {
  const V = ['Pl4n', 'Vq8', 'wordy7'].join('');
  const words = [...Array.from({ length: 150 }, (_, i) => 'w' + i), ['--pass', 'word'].join(''), V, ...Array.from({ length: 100 }, (_, i) => 'x' + i)];
  const m = maskToolArgs({ command: words }) as { command: string[] };
  const w = _toolArgsWorkForTest();
  const chars = words.reduce((k, x) => k + x.length + 1, 0);
  assert.ok(!m.command.includes(V) && m.command[0] === 'w0' && m.command[words.length - 1] === 'x99', 'LINEAR the value masked, the others kept');
  assert.ok(w.pieces <= 4 * chars, `LINEAR-PIECES pieces within four per character ${JSON.stringify(w)}`);
  assert.ok(w.searches <= 64 * 4, `LINEAR-SEARCHES searches bounded, not one per word ${JSON.stringify(w)}`);
});
ok('FAIL-CLOSED-LINES: when a mask takes line breaks in a text with a continuation, the text is the mask', () => {
  const key = ['-----BEGIN ', 'PRIVATE KEY-----\nMIIabc', 'def\nghi\n-----END ', 'PRIVATE KEY----- \\\nnext'].join('');
  assert.strictEqual((maskToolArgs({ description: key }) as { description: string }).description, '[redacted]', 'FAIL-CLOSED-LINES the mask');
});
ok('DIFF: no word a window surface hides on the raw arguments shows on the masked copy', () => {
  const corpus: Array<[string, unknown, string[]]> = [];
  for (const pre of PRES) for (const g of GAPS) corpus.push(['task', { prompt: 'p', description: pre + g + '-p' + B1 }, []]);
  for (const tool of ['bash', 'web_fetch', 'grep', 'view']) {
    corpus.push([tool, { query: ['-p', ['x --sec', 'ret \\\n  '].join('') + V1] }, []]);
    corpus.push([tool, { command: [['--tok', 'en'].join(''), 'a \\\n b ' + V1] }, []]);
    corpus.push([tool, { command: ['mysql', ['--pass', 'word'].join(''), '[redacted] ' + V1] }, []]);
    for (const [, a] of SECRET_ARGS) corpus.push([tool, a, [SESSION]]);
    const S1 = ['Qm4', 'Tz8Lp', '2Wx9'].join(''), S2 = ['Rk7', 'Vn3Hs', '5Yd1Pa'].join('');
    for (const form of ['^\r\n', '`\n', '\\\n', '\n']) corpus.push([tool, { prompt: 'p', description: ['--api', '-key '].join('') + S1 + form + '-p' + S2 }, []]);
    const X = ['Ka7Lm2', 'Np4Qr6', 'St8Uv1'].join('.'), Y = ['Wx3Yz5', 'Ab7Cd9', 'Ef2Gh4'].join('.');
    corpus.push([tool, { command: ['curl', '-ubob:' + X, '-p' + Y] }, []]);
    corpus.push([tool, { command: ['tool', ['pass', 'word='].join('') + X, Y] }, []]);
    corpus.push([tool, { command: ['curl', ['Coo', 'kie:\r\n-ubob:'].join('') + X, '-p' + Y] }, []]);
  }
  const bad: string[] = [];
  for (const [tool, a, vals] of corpus) for (const x of shownAgain(tool, a, vals)) { bad.push(`${tool} ${x}`); if (process.env.DBG) console.log(JSON.stringify(a).slice(0, 90), x, JSON.stringify(SURFACES.chip(tool, a)).slice(0, 120), JSON.stringify(SURFACES.chip(tool, maskToolArgs(a, vals))).slice(0, 120)); }
  assert.deepStrictEqual(bad, [], 'DIFF words hidden on main shown again');
});
ok('OVER-LIMIT-PLUS1: a string one character over the limit arrives empty', () => {
  assert.deepStrictEqual(maskToolArgs({ query: 'c'.repeat(R.MASK_INPUT_MAX + 1) }), { query: '' }, 'OVER-LIMIT-PLUS1 empty');
});
ok('OVER-CALLID: an over-budget call does not over-mask the session\'s later calls', () => {
  const mk = createToolArgsMasker();
  const big = ev('start', 'bash', { a: Array.from({ length: 10_000 }, (_, i) => 'w' + i) });
  assert.strictEqual(mk(big, []), '[redacted]', 'OVER-CALLID the big call is the mask');
  const next = { ...(ev('start', 'bash', { command: 'npm test' }) as object), callId: 'c9' } as AgentEvent;
  assert.deepStrictEqual(mk(next, []), { command: 'npm test' }, 'OVER-CALLID a later call of the session is masked as usual');
});
ok('REPEAT-STRINGS: an update repeating a long string of the start does not read it again', () => {
  const mk = createToolArgsMasker();
  const long = 'echo ' + 'plain words '.repeat(100);
  mk(ev('start', 'bash', { command: long }), []);
  mk(ev('update', 'bash', { command: long, description: 'x' }), []);
  assert.strictEqual(_toolArgsWorkForTest().readings, 1, 'REPEAT-STRINGS only the new short string was read');
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
