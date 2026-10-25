/**
 * Expanded helper cards on the office floor (spec 001 FR-089..FR-093, FR-097, issue 697): which lines a helper shows at level 1 and 2,
 * "not reported" and never another field, Simple's plain words, the fail-closed path, masking before the cut (tokens across every cut
 * point, with the real src/shared/redact.ts), the one character cap HX_CHARS, the tooltip cut HX_TIP, one mask per field change and a
 * CPU-time ratio for repaints, plus the source checks that keep the page wired to the module. `npm run test:helpercard`. No credits spent.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { redact } from '../src/shared/redact';

const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = path.join(__dirname, '..', '..');
const R = path.join(ROOT, 'src', 'renderer');
const { cutText } = require(path.join(R, 'cuttext.js')) as { cutText: (t: unknown, max: number) => string };
const ST = require(path.join(R, 'safetext.js')) as { create(o: { redact?: ((s: string) => string) | null; cut?: ((s: string, n: number) => string) | null }): { mask(t: unknown): string; excerpt(t: unknown, n: number, fb?: string): string } };
type Rec = { task?: string; prompt?: string; status?: string; result?: string; lastFinal?: string; error?: string; model?: string; durationMs?: number; tools?: number; tokens?: number; now?: { kind: string; tool?: string; label?: string; text?: string } | null };
type H = { holder?: object; name: string; parent: string; status: string; word: string; sub: Rec | null; task?: string };
type Line = { key: string; label: string; text: string; reported: boolean; tip: string };
type View = { name: string; lines: Line[]; aria: string; title: string };
type Card = { view: (h: H, level: number, o?: { simple?: boolean; live?: boolean }) => View; html: (v: View, esc: (t: unknown) => string) => string };
const HC = require(path.join(R, 'helpercard.js')) as {
  HX_MIN_F: number; HX_CHARS: number; HX_TIP: number; NOT_REPORTED: Record<string, string>; NR_TIP: string;
  create: (deps: Record<string, unknown>) => Card;
};
let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.strictEqual(a, b, m); n++; };

// token shapes built at run time (push protection)
const ghp = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const pat = 'github' + '_pat_' + '11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789abcdefghij';
const sk = 's' + 'k-' + 'proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const tokens = [ghp, pat, sk];
const hasSecret = (t: string) => tokens.some((x) => t.includes(x) || t.includes(x.replace(/[_*`]/g, '')) || t.includes(x.slice(0, 14)) || t.includes(x.slice(-14)));

const SAFE = ST.create({ redact: (s) => redact(s, {}), cut: cutText });
const tooLabel = (tool: string, label: string, max: number): string => { const m = redact(label, {}); return typeof m === 'string' ? cutText(m, max) : ''; };
/* the page's plainChip, reduced to what the card needs: a command never shows */
const plainWords = (k: string, _t: string, _l: string, running: boolean): string => (k === 'run' ? (running ? 'Running a command' : 'Ran a command') : k === 'read' ? 'Reading a file' : 'Using a tool');
const deps = (over?: Record<string, unknown>) => ({
  excerpt: (t: string, m: number, fb: string) => SAFE.excerpt(t, m, fb), mask: (t: string) => SAFE.mask(t), toolLabel: tooLabel, plain: plainWords, cut: cutText,
  fmtTok: (x: number) => (x >= 1000 ? (x / 1000).toFixed(1) + 'k' : String(x)), ...over,
});
const card = (over?: Record<string, unknown>): Card => HC.create(deps(over));
const C = card();
const helper = (sub: Rec | null, status = 'running', over?: Partial<H>): H => ({ name: 'Tests', parent: 'Ada', status, word: status === 'running' ? 'Working' : status === 'done' ? 'Done' : 'Failed', sub, task: 'a card line', ...over });
const keys = (v: View) => v.lines.map((l) => l.key).join(',');
const textOf = (v: View, k: string) => (v.lines.find((l) => l.key === k) || { text: '\u0000' }).text;

eq(HC.HX_CHARS, 240, 'one per-field cap');
eq(HC.HX_TIP, 200, 'the tooltip cut is the desk card\'s number');

// ---- level 1: the name line plus one line ----
{
  const run = { task: 'Run vitest on the changed modules', now: { kind: 'search', tool: 'grep', label: 'registerTool' } };
  let v = C.view(helper(run), 1);
  eq(keys(v), 'now', 'a running helper at level 1 shows Now');
  eq(textOf(v, 'now'), 'grep registerTool', 'Expert: the tool phrase with its label');
  v = C.view(helper({ task: 'Run vitest', now: null }), 1);
  eq(keys(v), 'task', 'until it reports an activity, Task');
  eq(textOf(v, 'task'), 'Run vitest', 'the task text');
  v = C.view(helper({ task: 'Run vitest', result: 'All 12 pass.' }, 'done'), 1);
  eq(keys(v), 'result', 'a done helper shows Result'); eq(textOf(v, 'result'), 'All 12 pass.', 'the result text');
  v = C.view(helper({ task: 'Run vitest', error: 'Failed: 4 errors remain', status: 'failed' }, 'failed'), 1);
  eq(keys(v), 'failed', 'a failed helper shows Failed'); eq(textOf(v, 'failed'), '4 errors remain', 'the error text, without a second "Failed:" (the label says it)');
  eq(textOf(C.view(helper({ task: 'x', error: 'Failed' }, 'failed'), 1), 'failed'), 'Failed', 'a bare Failed is kept');
  eq(textOf(C.view(helper({ task: 'x', error: 'Network failed: retry' }, 'failed'), 1), 'failed'), 'Network failed: retry', 'only a leading Failed: goes');
  ok(v.lines[0].label === 'Failed' && v.lines[0].reported, 'labelled');
}
// ---- level 2: Task, Now / Result / Failed, facts ----
{
  const rec: Rec = { task: 'Run vitest', now: { kind: 'search', tool: 'grep', label: 'x' }, model: 'gpt-5.6-luna', durationMs: 6200, tools: 2, tokens: 8100 };
  let v = C.view(helper(rec), 2);
  eq(keys(v), 'task,now,facts', 'level 2 running: task, activity, facts');
  eq(textOf(v, 'facts'), 'gpt-5.6-luna · 6.2s · 2 tool calls · 8.1k tokens', 'the facts line from what was reported');
  v = C.view(helper({ task: 'T', result: 'R', tools: 1 }, 'done'), 2);
  eq(keys(v), 'task,result,facts', 'level 2 done'); eq(textOf(v, 'facts'), '1 tool call', 'left out field by field, singular');
  v = C.view(helper({ task: 'T', error: 'E' }, 'failed'), 2);
  eq(keys(v), 'task,failed', 'level 2 failed, no facts when nothing was reported');
}

// ---- not reported: never another field, never invented words ----
{
  let v = C.view(helper({}, 'done'), 2);
  eq(textOf(v, 'task'), 'Task not reported', 'no task'); eq(textOf(v, 'result'), 'Result not reported', 'no result');
  ok(v.lines.every((l) => l.reported === false && l.tip === HC.NR_TIP), 'the fixed tooltip: The agent app did not send this.');
  eq(HC.NR_TIP, 'The agent app did not send this.', 'the tooltip words');
  v = C.view(helper({ task: 'Fix the tests' }, 'done'), 2);
  eq(textOf(v, 'result'), 'Result not reported', 'a done helper without a result never shows its task as the result');
  ok(!v.lines.some((l) => l.key === 'result' && l.text.includes('Fix the tests')), 'the task is not in the result line');
  v = C.view(helper({ task: 'Fix the tests' }, 'done'), 1);
  eq(textOf(v, 'result'), 'Result not reported', 'level 1 too');
  v = C.view(helper({ task: 'Fix' }, 'done', { task: 'the card line says Done' }), 1);
  ok(!v.aria.includes('the card line'), 'the card\'s task line is not used for the result');
  v = C.view(helper({ task: 'T', now: null }), 2);
  eq(textOf(v, 'now'), 'No activity reported yet', 'a running helper with no activity');
  v = C.view(helper({}, 'failed'), 2);
  eq(textOf(v, 'failed'), 'Error not reported', 'a failed helper without an error text');
  // the helper's own final message is a result too (spec: the parent's tool output or the helper's own final message)
  v = C.view(helper({ task: 'T', lastFinal: 'Its own final message' }, 'done'), 1);
  eq(textOf(v, 'result'), 'Its own final message', 'lastFinal when the parent sent no output');
  v = C.view(helper({ task: 'T', result: 'Tool output', lastFinal: 'Own' }, 'done'), 1);
  eq(textOf(v, 'result'), 'Tool output', 'the parent\'s tool output first');
  // a helper with no record (demo): its card line is the activity, the rest is not reported
  v = C.view(helper(null), 2);
  eq(textOf(v, 'now'), 'a card line', 'no record: the card line as Now'); eq(textOf(v, 'task'), 'Task not reported', 'no record: no task');
  v = C.view(helper(null, 'done'), 2);
  eq(textOf(v, 'result'), 'Result not reported', 'no record, done');
}

// ---- Simple: plain chat words, never a command; live activity off drops Now ----
{
  const now = { kind: 'run', tool: 'bash', label: 'curl --api-key ' + sk + ' https://example.test/a' };
  const ex = C.view(helper({ task: 'T', now }), 1);
  ok(textOf(ex, 'now').startsWith('bash curl'), 'Expert shows the tool and its (masked) command');
  ok(!hasSecret(ex.aria + ex.title + ex.lines.map((l) => l.text).join('|')), 'the secret flag is masked in Expert');
  const sim = C.view(helper({ task: 'T', now }), 1, { simple: true });
  eq(textOf(sim, 'now'), 'Running a command', 'Simple: plain words');
  ok(!/curl|bash|example\.test|api-key/.test(sim.aria + sim.title + sim.lines.map((l) => l.text).join('|')), 'Simple never shows the command');
  eq(textOf(C.view(helper({ task: 'T', now: { kind: 'thinking' } }), 1), 'now'), 'Thinking', 'thinking');
  eq(textOf(C.view(helper({ task: 'T', now: { kind: 'intent', text: 'Checking the **lint** rules' } }), 1), 'now'), 'Checking the lint rules', 'an intent, plain');
  // live off: no Now line; level 1 shows Task while it runs
  let v = C.view(helper({ task: 'Run vitest', now }), 1, { live: false });
  eq(keys(v), 'task', 'live off, level 1: Task'); eq(textOf(v, 'task'), 'Run vitest', 'the task');
  v = C.view(helper({ task: 'Run vitest', now, tools: 3 }), 2, { live: false });
  eq(keys(v), 'task,facts', 'live off, level 2: no Now'); ok(!v.aria.includes('curl'), 'and no activity text anywhere');
  v = C.view(helper({ task: 'Run vitest', result: 'R' }, 'done'), 2, { live: false });
  ok(keys(v).includes('result'), 'live off still shows the Result');
  v = C.view(helper({ now }), 1, { live: false });
  eq(textOf(v, 'task'), 'Task not reported', 'live off and no task: Task not reported');
}

// ---- fail closed: no working mask means Durbar's words only ----
{
  const bad = [card({ excerpt: undefined, mask: undefined, toolLabel: undefined }), card({ excerpt: () => { throw new Error('x'); }, mask: () => { throw new Error('y'); }, toolLabel: () => { throw new Error('z'); } }), card({ excerpt: () => '', mask: () => '', toolLabel: () => '' }), card({ excerpt: () => 5, mask: () => 7, toolLabel: () => 9, plain: () => 1 })];
  for (const [i, c] of bad.entries()) {
    const sec = ghp + ' and a long private sentence';
    const rec: Rec = { task: sec, result: sec, error: sec, model: sec, now: { kind: 'run', tool: 'bash', label: sec } };
    for (const [st, level] of [['running', 1], ['running', 2], ['done', 1], ['done', 2], ['failed', 1], ['failed', 2]] as const) {
      let v: View;
      try { v = c.view(helper(rec, st, { name: sec }), level); } catch (e) { assert.fail(`mask #${i} threw ${e}`); }
      const all = v.aria + '|' + v.title + '|' + v.lines.map((l) => l.text).join('|');
      ok(!all.includes('private') && !all.includes('ghp') && !all.includes('gh' + 'p'), `fail closed #${i} ${st} ${level}: ${all.slice(0, 120)}`);
    }
    const v = c.view(helper(rec, 'done'), 1);
    eq(textOf(v, 'result'), 'Finished.', `fail closed #${i}: Durbar's word for a result`);
    eq(textOf(c.view(helper(rec, 'failed'), 1), 'failed'), 'Failed.', 'and for a failure');
  }
}

// ---- tokens across every cut position never survive, nor a piece (task, activity, result, error, model, name) ----
{
  const fields: Array<[string, (t: string) => { rec: Rec; over?: Partial<H> }]> = [
    ['task', (t) => ({ rec: { task: t } })], ['intent', (t) => ({ rec: { task: 'x', now: { kind: 'intent', text: t } } })], ['label', (t) => ({ rec: { task: 'x', now: { kind: 'search', tool: 'grep', label: t } } })],
    ['result', (t) => ({ rec: { task: 'x', result: t } })], ['error', (t) => ({ rec: { task: 'x', error: t } })], ['model', (t) => ({ rec: { task: 'x', model: t } })], ['name', (t) => ({ rec: { task: 'x' }, over: { name: t } })],
  ];
  for (const tok of tokens) {
    for (const [f, mk] of fields) {
      for (let p = 0; p <= HC.HX_CHARS + 20; p += (p > HC.HX_CHARS - 40 && p < HC.HX_CHARS + 6) ? 1 : 7) {
        for (const md of ['', '**', '`']) {
          const t = 'a'.repeat(p) + ' ' + md + tok + md;
          const st = f === 'result' ? 'done' : f === 'error' ? 'failed' : 'running';
          for (const level of [1, 2]) for (const simple of [false, true]) {
            const x = mk(t), v = C.view(helper(x.rec, st, x.over), level, { simple, live: true });
            const all = v.aria + '\n' + v.title + '\n' + v.lines.map((l) => l.text).join('\n') + '\n' + v.name;
            if (hasSecret(all)) assert.fail(`${f} ${tok.slice(0, 6)} at ${p} (${md}) level ${level}: a token or a piece of one is shown: ${all.slice(-120)}`);
          }
        }
      }
    }
  }
  n++;
}

// ---- hostile markup stays text ----
{
  const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>"><b onclick="x()">bold</b>';
  const esc = (t: unknown) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const dom = new JSDOM('<div id=r></div>');
  for (const level of [1, 2]) {
    const v = C.view(helper({ task: hostile, now: { kind: 'intent', text: hostile }, model: hostile }, 'running', { name: hostile }), level);
    const root = dom.window.document.getElementById('r')!;
    root.innerHTML = C.html(v, esc);
    ok(root.querySelectorAll('img,script,[onerror],[onclick]').length === 0, 'no element or handler comes from agent text');
    ok([...root.querySelectorAll('*')].every((e: { tagName: string }) => ['SPAN', 'B'].includes(e.tagName)), 'only spans and bold from the module');
    ok(root.textContent!.includes('alert(2)'), 'the hostile text is shown as text');
  }
}

// ---- one cap, end to end (HX_CHARS) and the tooltip (HX_TIP) ----
{
  const long = 'word '.repeat(60000); // 300 KB
  const mb = ('x'.repeat(79) + ' ').repeat(13200); // over 1 MB
  ok(mb.length > 1_000_000, 'a 1 MB tool result');
  for (const big of ['y'.repeat(HC.HX_CHARS + 1), long, mb, 'é'.repeat(5000), '😀'.repeat(1000)]) {
    const rec: Rec = { task: big, result: big, error: big, model: big, now: { kind: 'intent', text: big } };
    for (const [st, level] of [['running', 2], ['done', 2], ['failed', 2], ['running', 1], ['done', 1], ['failed', 1]] as const) {
      const v = C.view(helper(rec, st), level), body = v.lines.map((l) => Array.from(l.text).length);
      ok(body.every((x) => x <= HC.HX_CHARS), `a field is at most HX_CHARS in the text (${body})`);
      // the aria-label holds the same cut values: at most 4 parts of HX_CHARS plus Durbar's words and the name
      ok(v.aria.length <= 4 * HC.HX_CHARS * 2 + 200 && Array.from(v.aria).length <= 4 * HC.HX_CHARS + 120, `the aria-label is bounded (${v.aria.length})`);
      for (const l of v.lines) ok(v.aria.includes(l.reported && l.label ? l.label + ': ' + l.text : l.text), 'the aria-label carries the very same cut value as the text');
      ok(Array.from(v.title).length <= HC.HX_TIP, `the title is at most HX_TIP (${Array.from(v.title).length})`);
    }
  }
  // exactly HX_CHARS + 1 characters is cut with the cutter's ellipsis, HX_CHARS is not
  eq(Array.from(textOf(C.view(helper({ task: 'y'.repeat(HC.HX_CHARS + 1) }, 'done'), 2), 'task')).length, HC.HX_CHARS, 'HX_CHARS + 1 is cut to HX_CHARS');
  ok(textOf(C.view(helper({ task: 'y'.repeat(HC.HX_CHARS + 1) }, 'done'), 2), 'task').endsWith('…'), 'with an ellipsis');
  eq(textOf(C.view(helper({ task: 'y'.repeat(HC.HX_CHARS) }, 'done'), 2), 'task'), 'y'.repeat(HC.HX_CHARS), 'HX_CHARS fits');
}
{
  // HX_TIP (review of PR 714, re-review): a tooltip built from parts that total over 200, a token across the 200th character, is cut from the
  // already masked parts: the token is [redacted] whole or absent, never a piece, and the cut ends with the cutter's ellipsis
  let across = 0;
  for (const tok of tokens) for (let p = 0; p < 230; p++) {
    const rec: Rec = { task: 'a'.repeat(p) + ' ' + tok + ' tail words', result: 'r'.repeat(60) + ' ' + tok, now: { kind: 'intent', text: 'b'.repeat(p % 50) + ' ' + tok } };
    for (const st of ['running', 'done']) for (const level of [1, 2]) {
      const v = C.view(helper(rec, st), level);
      ok(Array.from(v.title).length <= HC.HX_TIP, `title length ${Array.from(v.title).length} <= 200`);
      if (hasSecret(v.title)) assert.fail(`a piece of a token in the tooltip (task starts the token at ${p}): ${v.title.slice(-60)}`);
      if (p >= 190 && level === 2) { ok(v.title.endsWith('…'), 'a cut tooltip ends with the cutter\'s ellipsis'); across++; }
    }
  }
  ok(across > 50, `the case reached the cut (${across} cut tooltips)`);
  // the token whole in the tooltip is [redacted], not a half token
  const v = C.view(helper({ task: 'a'.repeat(120) + ' ' + ghp + ' tail', now: null }), 2);
  ok(/\[redacted\]/.test(v.title) || !/redact|ghp/.test(v.title), 'masked whole or not there');
}

// ---- masked once per field change, never on a repaint with unchanged fields ----
{
  const calls = { excerpt: 0, mask: 0, label: 0, plain: 0 };
  const C2 = card({
    excerpt: (t: string, m: number, fb: string) => { calls.excerpt++; return SAFE.excerpt(t, m, fb); }, mask: (t: string) => { calls.mask++; return SAFE.mask(t); },
    toolLabel: (a: string, b: string, c: number) => { calls.label++; return tooLabel(a, b, c); }, plain: (...a: unknown[]) => { calls.plain++; return (plainWords as (...x: unknown[]) => string)(...a); },
  });
  const rec: Rec = { task: 'Run the tests', result: 'All pass', error: 'oops', model: 'm1', now: { kind: 'run', tool: 'bash', label: 'npm test' } };
  const h = helper(rec, 'running');
  const total = () => calls.excerpt + calls.mask + calls.label + calls.plain;
  C2.view(h, 2); const first = total();
  ok(first > 0, 'the first view masks');
  for (let i = 0; i < 100; i++) { C2.view(h, 2); C2.view(h, 1); C2.view(h, 2, { simple: false, live: true }); }
  eq(total(), first, 'zero mask calls over 100 repaints with unchanged fields');
  const before = total();
  rec.task = 'Run all the tests'; C2.view(h, 2);
  eq(total(), before + 1, 'a changed field is masked once');
  rec.now = { kind: 'run', tool: 'bash', label: 'npm run lint' }; const b2 = total(); C2.view(h, 2); C2.view(h, 2);
  ok(total() - b2 <= 2, 'a changed activity is masked once (tool + label)');
  const b3 = total(); C2.view(h, 2, { simple: true }); ok(total() > b3, 'Simple is another value (its own words)'); const b4 = total(); C2.view(h, 2, { simple: true }); eq(total(), b4, 'and kept too');
  // two helpers do not share a memo
  const other = helper({ task: 'Run the tests', now: rec.now }, 'running'); const b5 = total(); C2.view(other, 2); ok(total() > b5, 'another helper has its own memo');
  // a helper with no record keeps its memo on its holder
  const demo = helper(null, 'running'); demo.holder = {}; const b6 = total(); C2.view(demo, 1); const b7 = total(); C2.view(demo, 1); ok(b7 > b6 && total() === b7, 'no record: memo on the holder');
}
{
  // a CPU-time ratio, not wall clock: 1000 repaints of a helper with a 1 MB result cost about what 1000 repaints of a small one cost (the memo)
  const cpu = (): number => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
  const run = (res: string): number => {
    const c = card(), h = helper({ task: 'T', result: res, model: 'm', tools: 2, tokens: 900 }, 'done'), t0 = cpu();
    c.view(h, 2); const t1 = cpu();
    for (let i = 0; i < 1000; i++) c.view(h, i % 2 ? 1 : 2);
    return cpu() - t1 + 0 * t0;
  };
  run('warm'); run('x');
  const base = Math.max(run('short result'), 1), big = run(('x'.repeat(79) + ' ').repeat(13200));
  ok(big <= base * 6 + 15, `1000 repaints of a 1 MB result: ${big.toFixed(1)} ms of CPU against ${base.toFixed(1)} ms for a short one`);
}

// ---- facts and names ----
{
  const v = C.view(helper({ task: 'T', model: ghp, durationMs: 0, tools: 0, tokens: 0 }, 'done'), 2);
  ok(!hasSecret(textOf(v, 'facts')) && v.lines.some((l) => l.key === 'facts'), 'the model name is masked too');
  eq(C.view(helper({ task: 'T' }, 'done', { name: '' }), 1).name, 'Helper', 'an empty name');
  ok(!hasSecret(C.view(helper({ task: 'T' }, 'done', { name: 'x ' + ghp }), 1).aria), 'the name is masked in the aria-label');
  const nm = C.view(helper({ task: 'T' }, 'done', { name: 'n'.repeat(500) }), 1).name; ok(Array.from(nm).length <= 60, 'a long name is cut');
}

// ---- the page is wired to the module (source checks) ----
{
  const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8'), html = fs.readFileSync(path.join(R, 'index.html'), 'utf8'), copy = fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8');
  ok(/<script src="helpercard\.js"><\/script>/.test(html) && html.indexOf('helpercard.js') < html.indexOf('src="app.js"'), 'index.html loads helpercard.js before app.js (the script order of safetext, liveact and app stays adjacent)');
  ok(/'helpercard\.js'/.test(copy), 'copy-assets.js copies helpercard.js');
  ok(/window\.DurbarHelperCard/.test(app), 'app.js uses DurbarHelperCard');
}
console.log(`test-helpercard: ok (${n} checks)`);
