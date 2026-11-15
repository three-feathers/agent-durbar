/**
 * Spec 052 FR-243 (issue #1754): the text of a question card with several parts keeps the parts apart: "Heading: question / Heading: question".
 * The page's own `joinQuestionParts` and `requestRaw` are cut out of app.js and run (the second on a DOM built like showQuestion's cards).
 * QPARTS_MUTANT=glue makes the function join with a space and no heading colon (what main did): the checks must fail. `npm run test:questionparts`. No credits spent.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: { document: Document } } };

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const line = (head: string): string => {
  const lines = app.split('\n').filter((l) => l.startsWith(head));
  assert.strictEqual(lines.length, 1, `app.js has exactly one line starting with ${head}`);
  return lines[0];
};
let src = line('function joinQuestionParts(') + '\n' + line('function requestRaw(');
if (process.env.QPARTS_MUTANT === 'glue') src = src.replace("join(' / ')", "join(' ')").replace("h+(/[:?.!]$/.test(h)?' ':': ')+t", "h+' '+t");
const sb: Record<string, unknown> = {};
vm.createContext(sb);
vm.runInContext(src + '\nthis.join=joinQuestionParts;this.raw=requestRaw;', sb);
const join = sb.join as (p: unknown) => string;
const raw = sb.raw as (n: unknown) => string;
let n = 0;
const eq = (a: unknown, b: unknown, m: string): void => { assert.strictEqual(a, b, m); n++; };

// the pure function
eq(join([{ head: 'Focus ring', text: 'Which colour should the focus ring use?' }, { head: 'Screens', text: 'Which screens should get it first?' }]),
  'Focus ring: Which colour should the focus ring use? / Screens: Which screens should get it first?', '2 parts: heading and question, parts apart');
eq(join([{ head: 'Focus ring', text: 'Which colour?' }]), 'Focus ring: Which colour?', '1 part');
eq(join([{ head: 'A', text: 'one?' }, { head: 'B', text: 'two?' }, { head: 'C', text: 'three?' }]), 'A: one? / B: two? / C: three?', '3 parts');
eq(join([{ head: '', text: 'Which?' }, { head: 'Screens', text: 'Where?' }]), 'Which? / Screens: Where?', 'a part with no heading is its question alone');
eq(join([{ head: '', text: 'First?' }, { head: '', text: 'Second?' }]), 'First? / Second?', 'no headings at all');
eq(join([{ head: 'A', text: 'one?' }, { head: ' ', text: '  ' }, { head: '', text: '' }, { text: 'two?' }]), 'A: one? / two?', 'blank parts are left out');
eq(join([]), '', 'no parts');
eq(join(null), '', 'null');
eq(join([{ head: 'Ready?', text: 'Which?' }, { head: 'Note:', text: 'Which?' }]), 'Ready? Which? / Note: Which?', 'a heading with its own punctuation gets no second colon');
eq(join([{ head: 'A\n b', text: 'x \n y' }]), 'A b: x y', 'whitespace collapsed');
const long = 'word '.repeat(2000).trim();
eq(join([{ head: 'H', text: long }, { head: 'I', text: long }]), 'H: ' + long + ' / I: ' + long, 'very long text is kept whole (the bar decides what to do with it)');

// requestRaw on cards built like showQuestion's
const D = new JSDOM('<!doctype html><body></body>').window.document;
const card = (qs: { header?: string; question: string }[]): Element => {
  const c = D.createElement('div'); c.className = 'note perm question';
  const b = D.createElement('b'); b.textContent = qs.length > 1 ? 'Questions from the agent' : 'Question from the agent'; c.appendChild(b);
  for (const q of qs) {
    const box = D.createElement('div'); box.className = 'q-item';
    const p = D.createElement('p'); p.className = 'q-text';
    if (q.header) { const h = D.createElement('span'); h.className = 'tag'; h.textContent = q.header; p.appendChild(h); p.appendChild(D.createTextNode(' ')); }
    p.appendChild(D.createTextNode(q.question)); box.appendChild(p);
    const o = D.createElement('div'); o.className = 'q-opts'; o.textContent = 'Red Blue'; box.appendChild(o); c.appendChild(box);
  }
  return c;
};
eq(raw(card([{ header: 'Focus ring', question: 'Which colour should the focus ring use?' }, { header: 'Screens', question: 'Which screens should get it first?' }])),
  'Focus ring: Which colour should the focus ring use? / Screens: Which screens should get it first?', 'the card text, two parts');
eq(raw(card([{ header: 'Focus ring', question: 'Which colour?' }])), 'Focus ring: Which colour?', 'the card text, one part');
eq(raw(card([{ question: 'First?' }, { question: 'Second?' }])), 'First? / Second?', 'the card text, no headings');
console.log(`test-question-parts: ${n} checks passed`);
