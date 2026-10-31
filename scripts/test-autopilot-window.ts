/**
 * Spec 099 T033-T035: the window's words and form (`src/renderer/autopilot.js`) and the page's wiring, on jsdom. The form grants nothing: the value goes to main, which reads it again.
 * Every surface's text goes through `esc` or `textContent`: a hostile name or question stays text. `npm run test:autopilot-window`.
 */
process.exitCode = 1;
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { AUTOPILOT_ENDS } from '../src/adapters/autopilot';
import { LINE_CLOSED } from '../src/adapters/autopilotHost';
import { NOT_VERIFIED, REMOTE_ON, WARN_HOURS, WARN_LIMIT } from '../src/main/autopilotops';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, o?: unknown) => { window: any } };
const root = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AP = require(path.join(root, 'src', 'renderer', 'autopilot.js')) as Record<string, any>; // plain script

assert.strictEqual(AP.CLOSED_LINE, LINE_CLOSED, 'FR-005: one line');
assert.strictEqual(AP.NOT_VERIFIED, NOT_VERIFIED);
assert.strictEqual(AP.WARN_LIMIT, WARN_LIMIT);
assert.strictEqual(AP.WARN_HOURS, WARN_HOURS);
assert.strictEqual(AP.REMOTE, REMOTE_ON);

// FR-040: every reason has its words and icon, and an unknown or `__proto__` one reads as an error
for (const r of AUTOPILOT_ENDS) {
  assert.ok(AP.ENDS[r], r);
  assert.ok(AP.endIcon(r));
  assert.match(AP.endLine({ reason: r, n: 2 }, 'Claude Code'), /^Autopilot ended: .+, after 2 more turns$/);
}
assert.match(AP.endLine({ reason: 'done', n: 1, spend: { unit: 'usd', value: 0.04 } }, 'Claude Code'), /^Autopilot ended: Claude Code judged the task done, after 1 more turn, \$0\.04$/);
assert.match(AP.endLine({ reason: '__proto__', n: 0 }, 'X'), /an error/);
assert.match(AP.endLine({ reason: 'constructor', n: 0 }, 'X'), /an error/);
assert.strictEqual(AP.endLine({ reason: 'cap', n: 3, spend: { unit: 'tokens', value: Infinity } }, 'X'), 'Autopilot ended: the spend cap was reached, after 3 more turns', 'FR-040: a number helper checks finite');

// FR-056: the chip, its tooltip, in the person's unit; D13's spend and cap
assert.strictEqual(AP.chipLabel({ limit: 5 }), 'Autopilot');
assert.strictEqual(AP.chipLabel({ limit: 5, run: { continuation: 2 } }), 'Autopilot · 2/5');
assert.match(AP.tooltip({ limit: 5 }, 'usd', 0.04, false), /up to 5 more turns per message, no spend cap\. Spent so far: \$0\.04\. Not verified on a real session yet\./);
assert.match(AP.tooltip({ limit: 5, cap: 30 }, 'aiu', 2, true), /30 AI credits/);
assert.ok(!/Not verified/.test(AP.tooltip({ limit: 5 }, 'aiu', 0, true)));
assert.strictEqual(AP.startLine({ limit: 5 }, 'usd'), 'Autopilot: working on your message (up to 5 more turns, no spend cap)');
assert.strictEqual(AP.contLine(2, 5), 'Autopilot: continuing (2 of up to 5)');
assert.strictEqual(AP.placeholder('Codex'), 'Describe the finished result. Codex keeps going until it is done.');
assert.strictEqual(AP.attachTip('Codex'), 'On Autopilot Codex takes text only: its goal is set from your message.');
assert.strictEqual(AP.startLimit(7), 7, 'S1: the value last used');
for (const bad of [0, 1001, 1.5, '5', null, undefined, NaN]) assert.strictEqual(AP.startLimit(bad), 5);

// the form
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
const doc = dom.window.document as any;
const open = (o: Record<string, unknown> = {}) => { const f = AP.form(doc, { app: 'Claude Code', unit: 'usd', verified: false, mode: 'allow', ...o }); doc.body.appendChild(f.node); return f; };
const set = (f: { node: any }, sel: string, v: string) => { const i = f.node.querySelector(sel); i.value = v; i.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
{
  const f = open();
  assert.deepStrictEqual(f.value(), { limit: 5, hours: 2 });
  assert.strictEqual(f.valid(), true);
  assert.match(f.node.querySelector('#apNoCap').textContent, /^No spend cap: Autopilot stops when the task is done, at the turn limit, after 2 hours, when it makes no progress, or when you press Stop\.$/);
  assert.match(f.node.textContent, /Not verified on a real session yet/);
  assert.strictEqual(f.node.querySelector('#apLimitW').hidden, true);
  assert.strictEqual(f.node.querySelector('#apHoursW').hidden, true);
  set(f, '#apLimit', '20');
  assert.strictEqual(f.node.querySelector('#apLimitW').hidden, true, 'exactly 20: no warning');
  set(f, '#apLimit', '21');
  assert.strictEqual(f.node.querySelector('#apLimitW').textContent, WARN_LIMIT);
  set(f, '#apHours', '3');
  assert.strictEqual(f.node.querySelector('#apHoursW').textContent, WARN_HOURS);
  assert.match(f.node.querySelector('#apNoCap').textContent, /after 3 hours/);
  let changes = 0;
  f.onChange = () => { changes++; };
  for (const v of ['0', '1001', '1.5', '']) { set(f, '#apLimit', v); assert.strictEqual(f.valid(), false, v); }
  assert.ok(changes >= 4, 'Continue follows it');
  set(f, '#apLimit', '1000');
  assert.strictEqual(f.valid(), true, 'a person can raise it to the technical bound');
  f.node.querySelector('#apCapOn').click();
  assert.strictEqual(f.node.querySelector('#apNoCap').hidden, true);
  assert.strictEqual(f.valid(), false, 'ticked with no value');
  set(f, '#apCap', '2.5');
  assert.deepStrictEqual(f.value(), { limit: 1000, hours: 3, cap: 2.5 });
  assert.strictEqual(f.node.querySelector('#apCounts').hidden, false);
  assert.match(f.node.querySelector('#apCounts').textContent, /for this session in total/);
  for (const v of ['0', '-1']) { set(f, '#apCap', v); assert.strictEqual(f.valid(), false, v); }
  f.node.remove();
  const tok = open({ unit: 'tokens', app: 'Codex' });
  tok.node.querySelector('#apCapOn').click();
  assert.match(tok.node.querySelector('#apCounts').textContent, /for this run\. Codex finishes the turn it is in/);
  set(tok, '#apCap', '1.5');
  assert.strictEqual(tok.valid(), false);
  tok.node.remove();
  const co = open({ unit: 'aiu', app: 'Copilot', spent: 1.5, ownCap: 50, limit: 9 });
  assert.deepStrictEqual(co.value(), { limit: 9, hours: 2 }, 'S1');
  assert.match(co.node.textContent, /This session's limit of 50 AI credits still applies/);
  co.node.querySelector('#apCapOn').click();
  set(co, '#apCap', '10');
  assert.strictEqual(co.node.querySelector('#apRaised').hidden, false, 'D9');
  assert.match(co.node.querySelector('#apCounts').textContent, /1\.5 AI credits so far/);
  set(co, '#apCap', '30');
  assert.strictEqual(co.node.querySelector('#apRaised').hidden, true);
  co.node.remove();
  const none = open({ unit: null });
  assert.strictEqual(none.node.querySelector('#apCapOn'), null, 'no cap possible');
  assert.deepStrictEqual(none.value(), { limit: 5, hours: 2 });
  none.node.remove();
  // from Read-only: said, and a hostile folder name is text
  const ro = open({ mode: 'read-only', folder: '<img src=x onerror=alert(1)>', app: '<b>x</b>' });
  assert.match(ro.node.querySelector('#apFolder').textContent, /<img src=x onerror=alert\(1\)> becomes Allow all, and stays so/);
  assert.strictEqual(ro.node.querySelectorAll('img,b').length, 0);
  ro.node.remove();
}

// askDialog carries the form: Continue follows it, and only a button's press gives its value
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DurbarDialog = require(path.join(root, 'src', 'renderer', 'dialog.js'));
  const ask = DurbarDialog(doc);
  const f = open();
  f.node.remove();
  const p = ask({ title: 't', body: 'b', custom: f, buttons: [{ label: 'Cancel', value: null }, { label: 'Continue…', value: 'ok', cls: 'primary' }] });
  const primary = doc.querySelector('#modeDlg .primary');
  assert.ok(doc.querySelector('#modeDlg .ap-form'));
  assert.strictEqual(primary.disabled, false);
  set(f, '#apLimit', '0');
  assert.strictEqual(primary.disabled, true, 'an invalid value');
  primary.click();
  assert.ok(doc.querySelector('#modeDlg'), 'a disabled button does nothing');
  set(f, '#apLimit', '6');
  primary.click();
  void p.then((r: { custom: unknown }) => {
    assert.deepStrictEqual(r.custom, { limit: 6, hours: 2 });
    pageChecks();
    process.exitCode = 0;
    console.log('test-autopilot-window: OK');
  });
}

/** The page's wiring: what cannot run here is pinned by its text. The driver `check-autopilot` runs it for real. */
function pageChecks(): void {
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const part = (a: string, b: string): string => app.slice(app.indexOf(a), app.indexOf(b));
  assert.ok(app.includes("const isOn=a.info.permMode===k&&!a.info.autopilot;"), 'FR-056: the check mark follows the real mode');
  assert.ok(app.includes("if(!c||!bridge.setAutopilot)") || app.includes('!c||a.parent||!bridge.setAutopilot'), 'no capability: no item');
  assert.ok(app.includes("(only?'':apMenuItem(a))"), 'in the mode menu, whatever the mode');
  // nothing in the menu or the flow writes the state before main answered
  const flow = part('async function autopilotFlow', '/* FR-040, FR-057: the chat lines');
  assert.ok(flow.indexOf('await bridge.setAutopilot') < flow.indexOf('a.info.autopilot=res.autopilot'), 'main first');
  assert.ok(!flow.slice(0, flow.indexOf('await bridge.setAutopilot')).includes('a.info.autopilot='), 'main first: the page writes nothing before it');
  assert.ok(flow.indexOf('if(!res.ok)') < flow.indexOf('a.info.autopilot=res.autopilot'), 'only on its yes');
  // every text the Autopilot code puts in innerHTML goes through esc
  const code = part('/* ---------------- spec 099: Autopilot in the window', 'function closeModeMenu(){');
  const q = /\bq\.question\b/g;
  assert.ok(q.test(code) && /p\.textContent=String\(q&&q\.question/.test(code), 'the question is textContent');
  assert.ok(!/innerHTML\s*=\s*[^I]/.test(code), 'one innerHTML, for an icon: ' + (code.match(/innerHTML\s*=\s*.{0,40}/g) ?? []).join());
  assert.ok(/n\.textContent=t;tChips/.test(code), 'the chat lines are text');
  assert.ok(/w\.textContent=APW\.endLine/.test(code), 'the end card is text');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="autopilot.js"></script>'));
  assert.ok(fs.readFileSync(path.join(root, 'scripts', 'copy-assets.js'), 'utf8').includes("'autopilot.js'"));
}
