/** Spec 116 T007: Settings > Office memory, `src/renderer/memory.js`: the pure words, `~` shortening (POSIX and Windows), the status line for every state,
 *  the confirmation (Cancel first, the remote line only with a remote) and the mounted section driven by a small fake DOM and bridge. No Electron.
 *  `npm run test:memory-ui`. `MEMORY_UI_MUTANT=<name>` rewrites the source in memory so a mutant must fail (see MUTANTS). */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const FILE = path.join(__dirname, '..', '..', 'src', 'renderer', 'memory.js');
const MUTANTS: Record<string, [string, string]> = {
  confirmOrder: ["buttons:[{label:'Cancel',value:null},{label:'Use this folder',value:'ok',cls:'primary warn'}]", "buttons:[{label:'Use this folder',value:'ok',cls:'primary warn'},{label:'Cancel',value:null}]"],
  notWarn: ["cls:'primary warn'", "cls:'primary'"],
  remoteAlways: ["if(remote.kind==='remote'){", "if(remote.kind==='remote'||remote.kind==='none'){"],
  winCase: ["s.replace(/\\\\/g,'/').toLowerCase():s", "s.replace(/\\\\/g,'/'):s"],
  noAllowAll: ["<p class=\"scr-note\">${esc(WORDS.allowAll)}</p>", ''],
  refusedNoReason: ["'Refused: '+(st.reason||'this folder cannot be used')+' ('+where+') The memory is off.'", "'Refused. The memory is off.'"],
  noAsk: ["if(want&&!(await ask(shortPath(st.path,home()),null))){busy=false;paint('memSw');return;}", ''],
  shownTrue: ['function shown(){return !!(X&&X.sim);}', 'function shown(){return true;}'],
  refusedPickDialog: ["if(pk.ok===false){say(failText(pk));busy=false;paint('memChoose');return;}", ''],
};
const mutant = process.env.MEMORY_UI_MUTANT || '';
let src = fs.readFileSync(FILE, 'utf8');
if (mutant) {
  assert.ok(MUTANTS[mutant], `unknown mutant ${mutant}`);
  const hits = src.split(MUTANTS[mutant][0]).length - 1;
  if (hits !== 1) { console.error(`MUTATION DID NOT APPLY: ${mutant} anchor found ${hits} times, needs exactly 1`); process.exit(99); }
  src = src.split(MUTANTS[mutant][0]).join(MUTANTS[mutant][1]);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M: any = (() => { const m = { exports: {} as unknown }; vm.runInNewContext(src, { module: m, self: {}, console }); return m.exports; })();

let checks = 0;
const ok = (c: unknown, m: string): void => { assert.ok(c, m); checks++; };
const eq = (a: unknown, b: unknown, m: string): void => { assert.deepStrictEqual(JSON.parse(JSON.stringify(a === undefined ? null : a)), JSON.parse(JSON.stringify(b === undefined ? null : b)), m); checks++; };

// ~ shortening
eq(M.shortPath('/home/ana/notes/brain', '/home/ana'), '~/notes/brain', 'posix: under home');
eq(M.shortPath('/home/ana', '/home/ana/'), '~', 'posix: home itself, trailing slash in home');
eq(M.shortPath('/home/anabel/notes', '/home/ana'), '/home/anabel/notes', 'posix: a sibling with the same prefix is not under home');
eq(M.shortPath('/home/Ana/notes', '/home/ana'), '/home/Ana/notes', 'posix: case matters');
eq(M.shortPath('C:\\Users\\Ana\\notes\\brain', 'C:\\Users\\Ana'), '~\\notes\\brain', 'win32: backslashes kept');
eq(M.shortPath('c:\\users\\ana\\Notes', 'C:\\Users\\Ana\\'), '~\\Notes', 'win32: case folded, trailing slash');
eq(M.shortPath('C:/Users/Ana/notes', 'C:\\Users\\Ana'), '~/notes', 'win32: either slash');
eq(M.shortPath('C:\\Users\\Anabel\\x', 'C:\\Users\\Ana'), 'C:\\Users\\Anabel\\x', 'win32: sibling prefix');
eq(M.shortPath('~/notes/brain', '/home/ana'), '~/notes/brain', 'already shortened');
eq(M.shortPath('~\\notes', 'C:\\Users\\Ana'), '~\\notes', 'already shortened (win32)');
eq(M.shortPath('/work/example.invalid/notes', undefined), '/work/example.invalid/notes', 'no home: as is');
eq(M.shortPath(undefined, '/h'), '', 'junk in, empty out');
// big input stays fast
{ const big = '/home/ana/' + 'a/'.repeat(100000); const t = Date.now(); M.shortPath(big, '/home/ana'); ok(Date.now() - t < 1000, 'a 200k path is shortened in under a second'); }

// status line: every state in words
const sl = (s: unknown) => M.statusLine(s);
ok(/^Not set up/.test(sl(undefined).text) && /^Not set up/.test(sl({ on: false, state: 'off' }).text), 'no folder: not set up');
ok(/^On\./.test(sl({ on: true, path: '~/notes/brain', state: 'on' }).text) && sl({ on: true, path: '~/n', state: 'on' }).cls === 'ok', 'on');
ok(/^Off\./.test(sl({ on: false, path: '~/notes/brain', state: 'off' }).text), 'off');
ok(/^Not found: ~\/notes\/brain/.test(sl({ on: false, path: '~/notes/brain', state: 'notFound' }).text) && sl({ on: false, path: '~/n', state: 'notFound' }).cls === 'warn', 'not found names the folder');
{ const r = sl({ on: false, path: '~/notes/brain', state: 'refused', reason: 'It is your home folder.' });
  ok(r.text.startsWith('Refused: It is your home folder.') && r.text.includes('~/notes/brain') && r.cls === 'warn', 'refused names the reason and the folder'); }

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
async function run(status: unknown, remote: unknown, answer: string | null, pick?: unknown) {
  const asked: Array<{ title: string; buttons: Array<{ label: string }>; lines: string[]; body: string }> = [];
  const calls: string[] = [];
  const f = fakeBox();
  M.init({
    sim: true, esc: (t: string) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string), announce: () => undefined, home: () => '/home/ana',
    askDialog: async (o: { title: string; buttons: Array<{ label: string }>; lines: string[]; body: string }) => { asked.push(o); return { value: answer }; },
    bridge: {
      memoryStatus: async () => status, onMemoryChanged: () => () => undefined,
      memoryPick: async () => pick || ({ ok: true, token: 't', expiresAt: 1, path: '/home/ana/notes/brain', remote }),
      memoryApply: async () => { calls.push('apply'); return { ok: true, path: '~/notes/brain' }; },
      memorySetOn: async (v: boolean) => { calls.push('setOn:' + v); return { ok: true }; },
      memoryStop: async () => { calls.push('stop'); return { ok: true }; },
    },
  });
  M.mount(f.box); await flush(); await flush();
  return { ...f, asked, calls };
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
  r = await run({ on: false, path: '~/notes/brain', state: 'refused', reason: 'It is your home folder.', keepInGit: false }, null, null);
  ok(r.els.memSw.disabled, 'refused: the switch is disabled'); ok(r.els.memStatus.textContent.startsWith('Refused: It is your home folder.'), 'refused status line');
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
  r = await run({ on: false, state: 'off', keepInGit: false }, null, 'ok', { ok: false, error: 'refused', reason: 'It is your home folder.', path: '~' });
  r.els.memChoose.onclick!(); await flush(); await flush(); await flush();
  eq(r.asked.length, 0, 'a refused pick opens no dialog'); ok(/Refused: It is your home folder\./.test(r.els.memNotice.textContent), 'a refused pick shows the reason'); ok(!r.calls.includes('apply'), 'nothing applied');
  // the simulator gate
  M.init({ bridge: {}, sim: false, esc: String }); ok(!M.shown(), 'not shown without the simulator');
  M.init(null); ok(!M.shown(), 'not shown before init');
  // a path with markup is text, never HTML
  r = await run({ on: false, path: '~/<img src=x onerror=y>', state: 'off', keepInGit: false }, null, null);
  ok(!r.html().includes('<img'), 'the path is set as text');
  console.log(`test-memory-ui${mutant ? ' [mutant ' + mutant + ']' : ''}: ${checks} checks passed`);
})().catch((e) => { console.error(e instanceof Error ? e.message.slice(0, 400) : 'failed'); process.exit(1); });
