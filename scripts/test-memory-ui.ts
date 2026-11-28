/** Spec 116 T007: Settings > Office memory, `src/renderer/memory.js`: the pure words, `~` shortening (POSIX and Windows), the status line for every state,
 *  the confirmation (Cancel first, the remote line only with a remote) and the mounted section driven by a small fake DOM and bridge. No Electron.
 *  `npm run test:memory-ui`. `MEMORY_UI_MUTANT=<name>` rewrites the source in memory so a mutant must fail (see MUTANTS). */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const ROOT = path.join(__dirname, '..', '..');
const FILES = { memory: 'src/renderer/memory.js', screens: 'src/renderer/screens.js', app: 'src/renderer/app.js', css: 'src/renderer/screens.css' } as const;
type Which = keyof typeof FILES;
// [file, anchor (must be found exactly once), replacement]
const MUTANTS: Record<string, [Which, string, string]> = {
  confirmOrder: ['memory', "buttons:[{label:'Cancel',value:null},{label:'Use this folder',value:'ok',cls:'primary warn'}]", "buttons:[{label:'Use this folder',value:'ok',cls:'primary warn'},{label:'Cancel',value:null}]"],
  notWarn: ['memory', "cls:'primary warn'", "cls:'primary'"],
  remoteAlways: ['memory', "if(remote.kind==='remote'){", "if(remote.kind==='remote'||remote.kind==='none'){"],
  noAllowAll: ['memory', "<p class=\"scr-note\">${esc(WORDS.allowAll)}</p>", ''],
  refusedNoReason: ['memory', "'Refused: '+(why||'this folder cannot be used')+' ('+where+') The memory is off.'", "'Refused. The memory is off.'"],
  noAsk: ['memory', "if(want&&!(await ask(st.path,null))){busy=false;paint('memSw');return;}", ''],
  shownTrue: ['memory', 'function shown(){return !!(X&&X.sim);}', 'function shown(){return true;}'],
  refusedPickDialog: ['memory', "if(pk.ok===false){say(failText(pk));busy=false;paint('memChoose');return;}", ''],
  applyPath: ['memory', 'memoryApply(pk.token)', 'memoryApply(pk.path)'],
  noRoleStatus: ['memory', 'id="memStatus" role="status"', 'id="memStatus"'],
  noRoleNotice: ['memory', 'id="memNotice" role="status"', 'id="memNotice"'],
  chooseNoGuard: ['memory', 'async function choose(){\n      if(busy)return;', 'async function choose(){\n      '],
  stopNoGuard: ['memory', 'async function stop(){\n      if(busy)return;', 'async function stop(){\n      '],
  toggleNoGuard: ['memory', 'if(busy||!st||!st.path)return;', 'if(!st||!st.path)return;'],
  noUnhide: ['memory', "u=X&&typeof X.unhide==='function'?X.unhide(String(t==null?'':t)):null;", "u=String(t==null?'':t);"],
  noClearNotice: ['memory', "notice='';if(X.announce)X.announce(statusLine(v).text);", "if(X.announce)X.announce(statusLine(v).text);"],
  noReasonCompare: ['memory', '||was.reason!==v.reason', ''],
  noAnnouncePush: ['memory', 'X.announce(statusLine(v).text);}', '0;}'],
  listenerLeak: ['memory', 'if(stopListening){stopListening();stopListening=null;}', ''],
  gateRemoved: ['screens', 'window.DurbarMemory&&window.DurbarMemory.shown()&&X.bridge.memoryStatus?', 'window.DurbarMemory&&X.bridge.memoryStatus?'],
  simFlag: ['app', 'DurbarMemory.init({bridge,sim:!!SIM,', 'DurbarMemory.init({bridge,sim:true,'],
  noUnhideWired: ['app', 'unhide:t=>window.DurbarRedact.unhide(t),', ''],
  retroSwitch: ['css', 'html[data-world="retro"] .swt:not(.on){border-color:var(--line-ctl)}', ''],
};
const mutant = process.env.MEMORY_UI_MUTANT || '';
const SRC = {} as Record<Which, string>;
for (const k of Object.keys(FILES) as Which[]) SRC[k] = fs.readFileSync(path.join(ROOT, FILES[k]), 'utf8');
if (mutant) {
  assert.ok(MUTANTS[mutant], `unknown mutant ${mutant}`);
  const [f, from, to] = MUTANTS[mutant];
  const hits = SRC[f].split(from).length - 1;
  if (hits !== 1) { console.error(`MUTATION DID NOT APPLY: ${mutant} anchor found ${hits} times, needs exactly 1`); process.exit(99); }
  SRC[f] = SRC[f].split(from).join(to);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M: any = (() => { const m = { exports: {} as unknown }; vm.runInNewContext(SRC.memory, { module: m, self: {}, console }); return m.exports; })();
// the shared hidden-character definition, compiled (npm run build first), as app.js passes it
// eslint-disable-next-line @typescript-eslint/no-var-requires
const shared = require(path.join(ROOT, 'dist', 'shared', 'redact.js')) as { unhide: (t: unknown) => string };
const escHtml = (t: string): string => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const BASE = { sim: true, esc: escHtml, unhide: shared.unhide, announce: () => undefined };
M.init({ ...BASE });

let checks = 0;
const ok = (c: unknown, m: string): void => { assert.ok(c, m); checks++; };
const eq = (a: unknown, b: unknown, m: string): void => { assert.deepStrictEqual(JSON.parse(JSON.stringify(a === undefined ? null : a)), JSON.parse(JSON.stringify(b === undefined ? null : b)), m); checks++; };

// paths arrive from main as `~` paths (win32: `~\\...`); the window shows them as they are, with hidden characters out
eq(M.confirmParts('~/notes/brain', null).body, '~/notes/brain', 'posix ~ path as is');
eq(M.confirmParts('~\\notes\\brain', null).body, '~\\notes\\brain', 'win32 ~ path as is');
eq(M.confirmParts('C:\\Users\\Ana\\notes', null).body, 'C:\\Users\\Ana\\notes', 'a whole win32 path as is');
// hidden and direction characters (C1, bidi marks and overrides, isolates, zero-width, line separator, line breaks) are out of every text from main
const HOSTILE = 'a\u202eb\u200bc\u0085d\u2028e\nf\u2066g\u200fh\ufeffi\u061cj\u00adk';
const CLEAN = 'abcde fghijk';
eq(M.confirmParts(HOSTILE, null).body, CLEAN, 'the dialog body');
ok(M.statusLine({ on: false, path: HOSTILE, state: 'notFound' }).text.includes(CLEAN) && !/[\u202e\u200b\u0085\u2028\n]/.test(M.statusLine({ on: false, path: HOSTILE, state: 'notFound' }).text), 'the status path');
{ const t = M.statusLine({ on: false, path: '~/x', state: 'refused', reason: HOSTILE }).text; ok(t.includes(CLEAN) && !/[\u202e\u200b\u0085\u2028\n]/.test(t), 'the refusal reason'); }
{ const t = M.failText({ error: 'refused', reason: HOSTILE, path: HOSTILE }); ok(t.includes('Refused: ' + CLEAN + ' (' + CLEAN + ')') && !/[\u202e\u200b\u0085\u2028\n]/.test(t), 'a refused pick: reason and path'); }
{ const t = M.remoteLine({ kind: 'remote', hosts: [HOSTILE] }); ok(t.includes('(' + CLEAN + ')') && !/[\u202e\u200b\u0085\u2028\n]/.test(t), 'the remote host'); }
// fails closed: no unhide, nothing from main is shown
M.init({ ...BASE, unhide: undefined });
eq(M.confirmParts('~/secret-ish', null).body, '', 'no unhide: the body is empty');
ok(!M.statusLine({ on: false, path: '~/x', state: 'refused', reason: 'R' }).text.includes('R)') && M.statusLine({ on: false, path: '~/x', state: 'refused', reason: 'R' }).text.includes('this folder cannot be used'), 'no unhide: no reason shown');
M.init({ ...BASE, unhide: () => { throw new Error('x'); } });
eq(M.confirmParts('~/x', null).body, '', 'a throwing unhide: empty');
M.init({ ...BASE });
// big input stays fast
{ const big = '~/' + 'a\u200b'.repeat(100000); const t = Date.now(); M.confirmParts(big, null); ok(Date.now() - t < 1000, 'a 200k path is cleaned in under a second'); }

// status line: every state in words
const sl = (s: unknown) => M.statusLine(s);
ok(/^Not set up/.test(sl(undefined).text) && /^Not set up/.test(sl({ on: false, state: 'off' }).text), 'no folder: not set up');
ok(/^On\./.test(sl({ on: true, path: '~/notes/brain', state: 'on' }).text) && sl({ on: true, path: '~/n', state: 'on' }).cls === 'ok', 'on');
ok(/^Off\./.test(sl({ on: false, path: '~/notes/brain', state: 'off' }).text), 'off');
ok(/^Not found: ~\/notes\/brain/.test(sl({ on: false, path: '~/notes/brain', state: 'notFound' }).text) && sl({ on: false, path: '~/n', state: 'notFound' }).cls === 'warn', 'not found names the folder');
{ const r = sl({ on: false, path: '~/notes/brain', state: 'refused', reason: 'This is your home folder.' });
  ok(r.text.startsWith('Refused: This is your home folder.') && r.text.includes('~/notes/brain') && r.cls === 'warn', 'refused names the reason and the folder'); }

// the confirmation
{ const none = M.confirmParts('~/notes/brain', { kind: 'none' });
  eq(none.buttons.map((b: { label: string }) => b.label), ['Cancel', 'Use this folder'], 'Cancel first');
  ok(none.buttons[0].value === null && /\bwarn\b/.test(none.buttons[1].cls), 'Cancel is the cancel value; the primary is warn, so the dialog focuses Cancel');
  eq(none.lines.length, 4, 'no remote: four lines');
  ok(none.lines.some((l: string) => /every agent can read every file in it, in every mode/i.test(l)) && none.lines.some((l: string) => /never runs git/.test(l)) && none.lines.some((l: string) => /never chat text/.test(l)), 'US1.2');
  ok(!none.lines.some((l: string) => /remote/i.test(l)), 'no remote line without a remote');
  eq(M.confirmParts('~/x', null).lines.length, 4, 'no pick answer: no remote line');
  const rem = M.confirmParts('~/notes/brain', { kind: 'remote', hosts: ['host.example.invalid'], rewritten: false });
  eq(rem.lines.length, 5, 'a remote adds one line');
  ok(rem.lines[4] === 'This folder has a git remote (host.example.invalid). Durbar cannot tell whether it is public.', 'US1.3 text');
  ok(M.remoteLine({ kind: 'remote', hosts: ['a'.repeat(500) + '\u202e\n'] }).length < 200, 'a host is cut and control characters are removed');
  ok(!/[\u202e\n]/.test(M.remoteLine({ kind: 'remote', hosts: ['a\u202eb\nc'] })), 'no bidi or newline in a host');
  ok(/unknown host/.test(M.remoteLine({ kind: 'remote', hosts: [] })), 'a remote without a host');
  ok(/could not check/.test(M.remoteLine({ kind: 'unknown' })), 'unknown is not none'); }

// words
ok(M.WORDS.allowAll === 'An agent in Allow all can also change files in your memory folder.', 'FR-054 sentence');
ok(/Read-only stays read-only/.test(M.WORDS.injection) && /Running sessions keep it until they restart/.test(M.WORDS.restart), 'FR-053 and the restart line');
ok(/expired/.test(M.failText({ error: 'invalid' })) && /Refused: It is X/.test(M.failText({ error: 'refused', reason: 'It is X.' })) && /did not work/.test(M.failText(null)), 'failure words');

// the mounted section on a fake DOM
type El = { id: string; innerHTML: string; textContent: string; disabled: boolean; onclick?: () => void; focused?: boolean; focus: () => void };
function fakeBox(): { box: unknown; els: Record<string, El>; html: () => string } {
  const els: Record<string, El> = {};
  const doc = { activeElement: null as unknown };
  let html = '';
  const box = {
    ownerDocument: doc, isConnected: true,
    contains: () => false,
    get innerHTML() { return html; },
    set innerHTML(v: string) {
      html = v; for (const k of Object.keys(els)) delete els[k];
      for (const m of v.matchAll(/id="(mem[A-Za-z]+)"([^>]*)>/g)) { const id = m[1]; els[id] = { id, innerHTML: '', textContent: '', disabled: / disabled/.test(m[2]), focus() { this.focused = true; } }; }
    },
    querySelector(sel: string) { return els[sel.replace('#', '')] || null; },
  };
  return { box, els, html: () => html };
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
type Rec = { pick: number; apply: unknown[][]; setOn: boolean[]; stop: number; announced: string[]; listeners: Set<(v: unknown) => void>; subscribed: number };
async function run(status: unknown, remote: unknown, answer: string | null, pick?: unknown, o?: { slow?: boolean }) {
  const asked: Array<{ title: string; buttons: Array<{ label: string }>; lines: string[]; body: string }> = [];
  const calls: string[] = [];
  const rec: Rec = { pick: 0, apply: [], setOn: [], stop: 0, announced: [], listeners: new Set(), subscribed: 0 };
  const f = fakeBox();
  const wait = (): Promise<void> => (o && o.slow ? new Promise((r) => setTimeout(r, 15)) : Promise.resolve());
  M.init({
    ...BASE, announce: (t: string) => { rec.announced.push(t); },
    askDialog: async (x: { title: string; buttons: Array<{ label: string }>; lines: string[]; body: string }) => { asked.push(x); return { value: answer }; },
    bridge: {
      memoryStatus: async () => status,
      onMemoryChanged: (cb: (v: unknown) => void) => { rec.listeners.add(cb); rec.subscribed++; return () => { rec.listeners.delete(cb); }; },
      memoryPick: async () => { rec.pick++; await wait(); return pick || ({ ok: true, token: 'tok' + 'en1', expiresAt: 1, path: '~/notes/brain', remote }); },
      memoryApply: async (...a: unknown[]) => { rec.apply.push(a); calls.push('apply'); return { ok: true, path: '~/notes/brain' }; },
      memorySetOn: async (v: boolean) => { rec.setOn.push(v); calls.push('setOn:' + v); await wait(); return { ok: true }; },
      memoryStop: async () => { rec.stop++; calls.push('stop'); await wait(); return { ok: true }; },
    },
  });
  M.mount(f.box); await flush(); await flush();
  return { ...f, asked, calls, rec };
}
(async () => {
  // renders every element
  let r = await run({ on: true, path: '~/notes/brain', state: 'on', keepInGit: false }, { kind: 'none' }, 'ok');
  ok(M.shown(), 'shown with sim');
  for (const id of ['memChoose', 'memStop', 'memSw', 'memStatus']) ok(r.els[id], id + ' is rendered');
  ok(/aria-checked="true"/.test(r.html()), 'the switch is on'); ok(!r.els.memStop.disabled, 'Stop using enabled with a folder');
  ok(r.html().includes('An agent in Allow all can also change files') && r.html().includes('Running sessions keep it until they restart') && r.html().includes('Read-only stays read-only'), 'the fixed sentences are in the section');
  ok(/aria-label="Use office memory"/.test(r.html()) && /role="switch"/.test(r.html()), 'the switch is a named switch');
  // no folder: stop and switch are disabled
  r = await run({ on: false, state: 'off', keepInGit: false }, { kind: 'none' }, 'ok');
  ok(r.els.memStop.disabled && r.els.memSw.disabled && !r.els.memChoose.disabled, 'no folder: Stop and the switch disabled');
  // refused: the switch is disabled; the reason is in the status line
  r = await run({ on: false, path: '~/notes/brain', state: 'refused', reason: 'This is your home folder.', keepInGit: false }, null, null);
  ok(r.els.memSw.disabled, 'refused: the switch is disabled'); ok(r.els.memStatus.textContent.startsWith('Refused: This is your home folder.'), 'refused status line');
  r = await run({ on: false, path: '~/notes/brain', state: 'notFound', keepInGit: false }, null, null);
  ok(r.els.memStatus.textContent.startsWith('Not found'), 'not-found status line');
  // Choose folder: the dialog has Cancel first; a remote shows its line; Cancel applies nothing
  r = await run({ on: false, state: 'off', keepInGit: false }, { kind: 'remote', hosts: ['host.example.invalid'], rewritten: false }, null);
  r.els.memChoose.onclick!(); await flush(); await flush(); await flush();
  eq(r.asked.length, 1, 'one confirmation'); eq(r.asked[0].buttons[0].label, 'Cancel', 'Cancel is first');
  ok(r.asked[0].lines.some((l) => /git remote \(host\.example\.invalid\)/.test(l)), 'the remote line is shown with a remote');
  ok(r.asked[0].body === '~/notes/brain', 'the dialog shows the ~ path'); ok(!r.calls.includes('apply'), 'Cancel applies nothing');
  r = await run({ on: false, state: 'off', keepInGit: false }, { kind: 'none' }, 'ok');
  r.els.memChoose.onclick!(); await flush(); await flush(); await flush();
  ok(!r.asked[0].lines.some((l) => /remote/i.test(l)), 'no remote line without a remote'); ok(r.calls.includes('apply'), 'confirming applies');
  // switch on asks first; off does not; Stop does not ask
  r = await run({ on: false, path: '~/notes/brain', state: 'off', keepInGit: false }, null, null);
  r.els.memSw.onclick!(); await flush(); await flush(); await flush();
  eq(r.asked.length, 1, 'turning on asks'); ok(!r.calls.includes('setOn:true'), 'Cancel on the question keeps it off');
  r = await run({ on: false, path: '~/notes/brain', state: 'off', keepInGit: false }, null, 'ok');
  r.els.memSw.onclick!(); await flush(); await flush(); await flush(); ok(r.calls.includes('setOn:true'), 'confirmed: setOn(true)');
  r = await run({ on: true, path: '~/notes/brain', state: 'on', keepInGit: false }, null, null);
  r.els.memSw.onclick!(); await flush(); await flush(); await flush(); eq(r.asked.length, 0, 'turning off does not ask'); ok(r.calls.includes('setOn:false'), 'setOn(false)');
  r = await run({ on: true, path: '~/notes/brain', state: 'on', keepInGit: false }, null, null);
  r.els.memStop.onclick!(); await flush(); await flush(); ok(r.calls.includes('stop'), 'Stop using calls memoryStop');
  // a refused pick shows the reason and never opens the dialog
  r = await run({ on: false, state: 'off', keepInGit: false }, null, 'ok', { ok: false, error: 'refused', reason: 'This is your home folder.', path: '~' });
  r.els.memChoose.onclick!(); await flush(); await flush(); await flush();
  eq(r.asked.length, 0, 'a refused pick opens no dialog'); ok(/Refused: This is your home folder\./.test(r.els.memNotice.textContent), 'a refused pick shows the reason'); ok(!r.calls.includes('apply'), 'nothing applied');
  // the label has its separator; the live regions keep their role
  r = await run({ on: false, state: 'off', keepInGit: false }, null, null);
  ok(/Folder:<\/b> <span>none chosen/.test(r.html()), 'label: "Folder: none chosen"');
  ok(/id="memStatus" role="status"/.test(r.html()) && /id="memNotice" role="status"/.test(r.html()), 'the status and notice regions are role=status');
  r = await run({ on: false, path: '~/notes/brain', state: 'off', keepInGit: false }, null, null);
  ok(/Folder:<\/b> <code id="memPathText"/.test(r.html()), 'label with a path: "Folder: <path>"');
  // apply gets exactly the token, never a path
  r = await run({ on: false, state: 'off', keepInGit: false }, { kind: 'none' }, 'ok');
  r.els.memChoose.onclick!(); await flush(); await flush(); await flush();
  eq(r.rec.apply, [['token1']], 'memoryApply gets exactly the token');
  // a second press while busy makes no second call
  r = await run({ on: false, state: 'off', keepInGit: false }, null, null, undefined, { slow: true });
  { const b = r.els.memChoose; b.onclick!(); b.onclick!(); await new Promise((x) => setTimeout(x, 60)); eq(r.rec.pick, 1, 'Choose while busy: one pick'); }
  r = await run({ on: true, path: '~/notes/brain', state: 'on', keepInGit: false }, null, null, undefined, { slow: true });
  { const b = r.els.memStop; b.onclick!(); b.onclick!(); await new Promise((x) => setTimeout(x, 60)); eq(r.rec.stop, 1, 'Stop while busy: one call'); }
  r = await run({ on: false, path: '~/notes/brain', state: 'off', keepInGit: false }, null, 'ok', undefined, { slow: true });
  { const b = r.els.memSw; b.onclick!(); b.onclick!(); await new Promise((x) => setTimeout(x, 60)); eq(r.rec.setOn, [true], 'the switch while busy: one call'); }
  // a pushed state change clears the old notice and is announced; the same state again is not
  r = await run({ on: true, path: '~/notes/brain', state: 'on', keepInGit: false }, null, null);
  r.els.memStop.onclick!(); await flush(); await flush(); await flush();
  ok(/Stopped/.test(r.els.memNotice.textContent), 'the notice shows after Stop');
  { const n0 = r.rec.announced.length, push = [...r.rec.listeners][0];
    push({ on: false, path: '~/notes/brain', state: 'refused', reason: 'This is your home folder.', keepInGit: false });
    eq(r.els.memNotice.textContent, '', 'a pushed refusal clears the stale notice');
    ok(r.rec.announced.length === n0 + 1 && /^Refused: This is your home folder\./.test(r.rec.announced[n0]), 'the pushed state is announced');
    ok(/^Refused:/.test(r.els.memStatus.textContent), 'the status line shows the push');
    push({ on: false, path: '~/notes/brain', state: 'refused', reason: 'This is your home folder.', keepInGit: false });
    eq(r.rec.announced.length, n0 + 1, 'the same state again is not announced'); }
  // refused for reason A, then refused for reason B: both pushes are announced and the notice stays empty
  r = await run({ on: false, path: '~/notes/brain', state: 'refused', reason: 'Reason A.', keepInGit: false }, null, null);
  { const n0 = r.rec.announced.length, push = [...r.rec.listeners][0];
    push({ on: false, path: '~/notes/brain', state: 'refused', reason: 'Reason B.', keepInGit: false });
    push({ on: false, path: '~/notes/brain', state: 'refused', reason: 'Reason C.', keepInGit: false });
    eq(r.rec.announced.length, n0 + 2, 'a changed reason is announced each time');
    ok(/Reason B\./.test(r.rec.announced[n0]) && /Reason C\./.test(r.rec.announced[n0 + 1]), 'each announcement carries its own reason');
    eq(r.els.memNotice.textContent, '', 'the notice stays empty after a reason change'); }
  // one listener, however many times Settings is opened
  r = await run({ on: false, state: 'off', keepInGit: false }, null, null);
  for (let i = 0; i < 11; i++) { M.mount(r.box); await flush(); }
  eq([r.rec.subscribed, r.rec.listeners.size], [12, 1], '12 opens: 12 subscriptions, 1 live listener');
  // the source of the gate and the wiring (a mutant of screens.js or app.js must die here)
  ok(/const memSec=window\.DurbarMemory&&window\.DurbarMemory\.shown\(\)&&X\.bridge\.memoryStatus\?/.test(SRC.screens), 'screens.js: the section needs DurbarMemory.shown()');
  ok(/DurbarMemory\.init\(\{bridge,sim:!!SIM,/.test(SRC.app), 'app.js: sim is !!SIM');
  ok(/unhide:t=>window\.DurbarRedact\.unhide\(t\)/.test(SRC.app), 'app.js: the shared unhide is passed in');
  ok(/html\[data-world="retro"\] \.swt:not\(\.on\)\{border-color:var\(--line-ctl\)\}/.test(SRC.css), 'screens.css: the Retro off switch has the 3:1 edge');
  // the simulator gate
  M.init({ bridge: {}, sim: false, esc: String }); ok(!M.shown(), 'not shown without the simulator');
  M.init(null); ok(!M.shown(), 'not shown before init');
  // a path with markup is text, never HTML
  r = await run({ on: false, path: '~/<img src=x onerror=y>', state: 'off', keepInGit: false }, null, null);
  ok(!r.html().includes('<img'), 'the path is set as text');
  console.log(`test-memory-ui${mutant ? ' [mutant ' + mutant + ']' : ''}: ${checks} checks passed`);
})().catch((e) => { console.error(e instanceof Error ? e.message.slice(0, 400) : 'failed'); process.exit(1); });
