/**
 * Spec 012 FR-195 (issue #1419): toasts (`#toasts`, a polite live region) and the notice strips (`#restoreStrip`, `#crashStrip`,
 * `#awayStrip`, `#mcpStrip`) show and say an agent's, a folder's or an MCP server's name only through FR-178's announcement mask.
 * `liveMask(root, blocks)` in `src/renderer/app.js` masks every text node, `title` and `aria-label` with `annPart`, then reads each block
 * once more as one joined text (a value split across markup) and keeps the union. The page's own definitions are cut out of app.js and
 * run in jsdom with the compiled shared mask, so a change to the page's code is what is tested. A differential fuzz compares with a frozen
 * copy of `main`'s announcement mask: no word `main` hides in a line may be shown in the same text as a toast. Fake values only, built
 * from pieces of at most six characters at run time. `npm run test:livemask`. No credits spent.
 */
import './safetext-shared';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import * as shared from '../src/shared/redact';
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: Window & typeof globalThis } };

const R_DIR = path.join(__dirname, '..', '..', 'src', 'renderer');
const app = fs.readFileSync(path.join(R_DIR, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const LINES = app.split('\n');
let n = 0;
const ok = (c: unknown, m: string): void => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string): void => { assert.deepStrictEqual(a, b, m); n++; };

// one whole line of app.js that starts with `head`
const line = (head: string): string => {
  const l = LINES.filter((x) => x.startsWith(head));
  assert.strictEqual(l.length, 1, `app.js has exactly one line starting with ${head}`);
  return l[0];
};
// a definition that starts on a line with `head` and ends at the next line that is exactly `}` (or on the line after, for two-line ones)
const block = (head: string): string => {
  const i = LINES.findIndex((x) => x.startsWith(head));
  assert.ok(i >= 0, `app.js has a line starting with ${head}`);
  const j = LINES.findIndex((x, k) => k > i && x === '}');
  return LINES.slice(i, j + 1).join('\n');
};
const twoLines = (head: string): string => { const i = LINES.findIndex((x) => x.startsWith(head)); assert.ok(i >= 0, head); return LINES[i] + '\n' + LINES[i + 1]; };

const DEFS = ['const homeMask=', 'const helperMask=', 'const deskMask=', 'const SHORT=', 'const RED=', 'const STX=', 'const SAFE=',
  'const safeExcerpt=', 'const esc=', 'function annHome(', 'function annPart(', 'function liveText(', 'function liveMask(', 'function stripMask(', 'function toast('].map(line).join('\n')
  + '\n' + twoLines('function mountToast(') + '\n' + block('function toastActions(') + '\n' + block('function paintMcpStrip(') + '\n' + block('function renderRestoreStrip(') + '\n' + ['const crashSt=', 'const crashLeft='].map(line).join('\n')
  + '\n' + block('function paintCrashStrip(') + '\n' + twoLines('const awayWords=') + '\n' + block('async function renderAwayStrip(') + '\n' + block('function afRender(');

// main's announcement mask on 2026-11-23 (ee96eefb3), frozen: the reference of the differential fuzz below
const FROZEN_MAIN: string[] = [
  "const homeMask=t=>{const R=window.DurbarRedact;if(!R||typeof R.maskHomePaths!=='function')return t;const h=R.maskHomePaths(t);return typeof h==='string'?h:'';};",
  "const deskMask=t=>safeMask(t); /* the one mask (DurbarSafeText, FR-065): unescaped, Markdown-aware, '' when redact is missing */",
  "const SHORT=(v,n)=>DurbarCutText.cutText(v,n);",
  "const RED=!NO_REDACT&&window.DurbarRedact&&typeof window.DurbarRedact.redact==='function'?window.DurbarRedact:null;",
  "const STX=window.DurbarSafeText; /* if safetext.js did not load the page still draws, and shows no agent text */",
  "const SAFE=STX?STX.create({redact:RED?t=>RED.redact(t):null,cut:SHORT}):{ready:false,mask:()=>'',excerpt:(t,n,fb)=>t?(fb==null?'Finished.':fb):''}; /* spec 041 FR-065: agent text is masked on the raw text, then made plain, then cut; no redact module: neutral words, never the raw text */",
  "const safeExcerpt=(t,n,fb)=>SAFE.excerpt(t,n,fb),safeMask=t=>SAFE.mask(t);",
  "function annHome(s){const R=window.DurbarRedact,c=R&&typeof R.unhide==='function'?R.unhide(s):s;let w=s,h=homeMask(s);if(typeof c==='string'&&c!==s){const hc=homeMask(c);if(hc!==c){w=c;h=hc;}} /* the copy without hidden characters, when it holds a home folder */if(typeof h!=='string'||!STX||typeof STX.unesc!=='function')return h;const u=STX.unesc(w),hu=homeMask(u);return typeof hu!=='string'||hu===u||STX.unesc(h)===hu?h:'[redacted]';} /* review of PR 1484: a home folder whose name holds a Markdown escape (/home/a\\_b) is cut short by the home mask as written; when the escape-undone copy holds a home folder and masks to something else, the part is said as [redacted] (never with its escapes undone, as annPart) */",
  "function annPart(t){const s=String(t==null?'':t);if(!s)return '';const h=annHome(s);if(typeof h!=='string'||!h)return null;const m=deskMask(h);if(typeof m!=='string'||!m||m.includes('[redaction failed]')||!STX||typeof STX.unesc!=='function')return null;const u=STX.unesc(h);return m===u?h:u===h?m:'[redacted]';}",
];

type Mode = boolean | 'throws' | 'failed' | 'noredact' | 'nokeep' | 'emptykeep';
type Page = { doc: Document; toast(html: string): HTMLElement; toastActions(html: string, labels: string[]): HTMLElement;
  liveMask(root: Element, blocks: Element[]): Element; mcp(items: Record<string, string>[], open: boolean): HTMLElement; ref(t: string): string | null;
  restore(folder: string): HTMLElement; crash(folder: string): HTMLElement; away(folder: string, prompt: string): Promise<HTMLElement>; follow(name: string): HTMLElement; followReal(name: string, hidden: boolean): HTMLElement };
// what the strips' stubs hand out (the away strip's main reply, the followed agent's name)
const STRIP: { away: unknown; follow: string; hidden: boolean } = { away: null, follow: '', hidden: false };
const page = (mode: Mode): Page => {
  const dom = new JSDOM('<!doctype html><body><div id="toasts"></div>' + ['mcpStrip', 'restoreStrip', 'crashStrip', 'awayStrip', 'followStrip'].map((i) => `<div id="${i}" hidden></div>`).join('') + '</body>');
  const doc = dom.window.document;
  const R = mode === 'throws' ? { ...shared, maskHomePaths: () => { throw new Error('boom'); } }
    : mode === 'failed' ? { ...shared, maskHomePaths: () => '[redaction failed]' } : mode === 'nokeep' ? { ...shared, keepShownBy: undefined } : mode === 'emptykeep' ? { ...shared, keepShownBy: () => '' } : mode ? shared : undefined;
  const base = {
    window: { DurbarRedact: R, DurbarSafeText: require(path.join(R_DIR, 'safetext.js')), DurbarScreens: { openSettings() {} } },
    DurbarCutText: require(path.join(R_DIR, 'cuttext.js')),
    document: doc, NodeFilter: dom.window.NodeFilter,
    NO_REDACT: !mode || mode === 'noredact',
    $: (id: string) => doc.getElementById(id),
    setTimeout: () => 1, clearTimeout: () => {},
  };
  const ctx = vm.createContext({ ...base, placeToasts() {}, holdTimer() {}, scheduleRender() {}, focusIn() {}, ResizeObserver: undefined,
    mcpL: { closed: false, open: false, items: new Map() }, liveById: (id: string) => ({ id, info: { resumeLast: true } }),
    agents: [] as unknown[], roomOf: (a: { room: { id: string; name: string } }) => a.room, ui: {}, updatePanelHeader() {}, busy: () => () => {},
    bridge: { sinceAway: async () => STRIP.away, runScheduleNow: async () => ({ ok: true }) }, demoOn: false, SSUM: null,
    AF_ON: true, AF_PAUSED: false, AF_HOLD: '', afLive: () => [], afPanelId: () => null, byId: (id: string) => ({ id, name: STRIP.follow }), afCanOpen: () => !STRIP.hidden,
    afGo() {}, afSetPaused() {},
    AF: { position: () => ({ index: -1, count: 0 }), positionText: () => 'none', statusText: (o: { name?: string }) => 'Following ' + (o.name || '') + '.' },
    AFT: { ids: () => ['f1'], pendingList: () => [], size: 1 } });
  vm.runInContext(DEFS + '\nthis.toast=toast;this.toastActions=toastActions;this.liveMask=liveMask;this.paintMcpStrip=paintMcpStrip;this.renderRestoreStrip=renderRestoreStrip;this.paintCrashStrip=paintCrashStrip;this.renderAwayStrip=renderAwayStrip;this.afRender=afRender;this.crashSt=crashSt;', ctx);
  const refCtx = vm.createContext({ ...base, window: { ...base.window, DurbarRedact: mode ? shared : undefined }, NO_REDACT: !mode });
  vm.runInContext(FROZEN_MAIN.join('\n') + '\nthis.annPart=annPart;', refCtx);
  const C = ctx as unknown as { toast(h: string, ms?: number): HTMLElement; toastActions(h: string, a: { label: string; onClick(): void }[], ms?: number): HTMLElement;
    liveMask(r: Element, b: Element[]): Element; paintMcpStrip(): void; mcpL: { closed: boolean; open: boolean; items: Map<string, unknown> } };
  return {
    doc,
    toast: (h) => C.toast(h, 1000),
    toastActions: (h, labels) => C.toastActions(h, labels.map((label) => ({ label, onClick() {} })), 1000),
    liveMask: (r, b) => C.liveMask(r, b),
    mcp(items, open) { C.mcpL.items = new Map(items.map((f) => [f.key, f])); C.mcpL.open = open; C.mcpL.closed = false; C.paintMcpStrip(); return doc.getElementById('mcpStrip') as HTMLElement; },
    ref: (t) => (refCtx as unknown as { annPart(t: string): string | null }).annPart(t),
    restore(folder) { (ctx as unknown as { agents: unknown[] }).agents = [{ id: 'a1', live: true, info: { permMode: 'allow', permRestored: true }, room: { id: 'r1', name: folder } }];
      const el = doc.getElementById('restoreStrip') as HTMLElement; delete el.dataset.kept; (ctx as unknown as { renderRestoreStrip(): void }).renderRestoreStrip(); return el; },
    crash(folder) { const cs = (ctx as unknown as { crashSt: { items: unknown[]; pick: boolean; missing: number } }).crashSt; cs.items = [{ id: 'c1', folderName: folder, adapterId: 'claude' }]; cs.pick = true; cs.missing = 0;
      (ctx as unknown as { paintCrashStrip(): void }).paintCrashStrip(); return doc.getElementById('crashStrip') as HTMLElement; },
    async away(folder, prompt) { STRIP.away = { awayMs: 3600000, missed: [{ id: 's1', folderName: folder, prompt }] }; await (ctx as unknown as { renderAwayStrip(): Promise<void> }).renderAwayStrip(); return doc.getElementById('awayStrip') as HTMLElement; },
    follow(name) { STRIP.follow = name; (ctx as unknown as { afRender(): void }).afRender(); return doc.getElementById('followStrip') as HTMLElement; },
    followReal(name, hidden) { // the real DurbarAutoFollow.statusText (its hidden-folder branch when `hidden`), then back to the stub
      const C2 = ctx as unknown as { AF: unknown; afRender(): void }, stub = C2.AF, real = require(path.join(R_DIR, 'autofollow.js'));
      C2.AF = { ...(stub as object), statusText: real.statusText }; STRIP.follow = name; STRIP.hidden = hidden;
      try { C2.afRender(); } finally { C2.AF = stub; STRIP.hidden = false; }
      return doc.getElementById('followStrip') as HTMLElement; },
  };
};
const escH = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
// everything a toast or strip shows or says: its text and its labels
const shown = (el: Element): string => [el.textContent || '', ...[el, ...Array.from(el.querySelectorAll('*'))].flatMap((e) => ['title', 'aria-label'].map((k) => e.getAttribute(k) || ''))].join('\n');

// fake secrets, never real ones, from pieces of at most six characters
const P = (...p: string[]): string => p.join('');
const BODY = P('A1b2C3', 'd4E5f6', 'G7h8I9', 'j0K1l2', 'M3n4O5', 'p6Q7r8');
const GHP = P('gh', 'p_', BODY);
const SK = P('s', 'k-', 'proj-', 'AbCdEf', 'GhIjKl', 'MnOpQr', 'StUvWx', 'Yz0123', '456789');
const USER = P('zqxus', 'ername');
const PW = P('Vq7k', 'Zp9m', 'Lw3x');
const NAMES: [string, string][] = [
  ['a GitHub token', 'fix ' + GHP],
  ['an OpenAI key', 'agent ' + SK],
  ['a Linux home folder', '/home/' + USER + '/repo'],
  ['a macOS home folder', '/Users/' + USER + '/repo'],
  ['a Windows home folder', 'C:\\Users\\' + USER + '\\repo'],
  // spec 012 FR-435 (issue #2060 item 2): a network share path is shown whole on screen; one with a token for a folder stays hostile
  ['a UNC path with a token folder', '\\\\host\\share\\' + GHP + '\\repo'],
  ['a Markdown-escaped token', P('gh', 'p\\_') + BODY],
  ['a home folder with a zero-width space', '/ho\u200bme/' + USER + '/repo'],
  ['a home user name with an escape', '/home/zq\\_' + USER + '/repo'],
];
// spec 012 FR-435 (issue #2060 item 2): network share paths, made-up servers only; each is shown whole on screen
const B = '\\';
const SHARES: [string, string][] = [
  ['a UNC path', B + B + 'fs01' + B + 'projects' + B + 'teamA' + B + 'notes.txt'], ['a UNC home share', B + B + 'fs01' + B + 'homes' + B + USER + B + 'notes.txt'],
  ['a UNC admin share', B + B + 'fs01' + B + 'c$' + B + 'logs' + B + 'app.log'], ['a UNC path on a dotted host', B + B + 'fs01.corp.example' + B + 'data' + B + 'q3' + B + 'r.xlsx'],
  ['a forward-slash home share', '//fs01/homes/' + USER + '/notes.txt'], ['an smb link', 'smb://fs01/projects/teamA/notes.txt'],
  ['a file link with a host', 'file://fs01/projects/teamA/notes.txt'], ['a macOS mount', '/Volumes/projects/teamA/notes.txt'],
];
const NEEDLES = [GHP, BODY.slice(0, 12), SK.slice(8, 20), USER, P('gh', 'p_A1b2')];
const hides = (s: string, what: string): void => { for (const x of NEEDLES) ok(!s.includes(x), `${what}: no piece ${x.slice(0, 4)}… is shown`); };

const pg = page(true);

// 1. a plain toast, per hostile name, in the forms the call sites use
for (const [what, nm] of NAMES) {
  for (const [form, html] of [
    ['bold name', 'Theme <b>' + escH(nm) + '</b> removed. Clean Office is on.'],
    ['name first', escH(nm) + ' was deleted.'],
    ['error text', 'Could not run it: ' + escH('failed in ' + nm)],
  ] as const) {
    const t = pg.toast(html);
    hides(shown(t), `FR-195 toast, ${form}, ${what}`);
    ok(pg.doc.getElementById('toasts')!.contains(t), `FR-195 toast, ${form}, ${what}: the toast is shown`);
  }
}
// 2. a toast with action buttons: the message is masked, the buttons keep their labels and stay buttons
{
  const t = pg.toastActions(escH('fix ' + GHP) + ' moved to <b>Floor 2</b>.', ['Undo', 'Show']);
  hides(shown(t), 'FR-195 toast with actions');
  eq(Array.from(t.querySelectorAll('button.toast-act')).map((b) => b.textContent), ['Undo', 'Show'], 'FR-195 toast with actions: the buttons are kept');
  ok(/moved to Floor 2\./.test(t.textContent || ''), 'FR-195 toast with actions: the fixed words are kept');
}
// 3. benign text is kept byte for byte, markup included (nothing to hide: no change)
{
  const html = 'Theme <b>Night shift</b> removed. Run <code>git log \\*.md</code> again, echo \\\\$(id).';
  const t = pg.toast(html);
  eq(t.innerHTML, html, 'FR-195 a benign toast is kept as written, markup and backslashes included');
}
// 3b. spec 012 FR-435 (issue #2060 item 2): a network share path is shown whole on screen (server, share, folders and file name), in a toast, a strip
// and the chat's header name; a token in it stays hidden (the hostile names above hold a UNC path with a token folder). Made-up servers only.
{
  for (const [what, p] of SHARES) {
    ok((pg.toast('Saved in <b>' + escH(p) + '</b>.').textContent || '') === 'Saved in ' + p + '.', `FR-435 toast: ${what} is shown whole`);
    ok(shown(pg.restore(p)).includes(p), `FR-435 restore strip: ${what} is shown whole`);
  }
}
// 4. a value split across markup: the joined reading hides it (union with the per-node reading)
{
  const t = pg.toast('Not written: password=<b>' + PW + '</b> was refused.');
  ok(!(t.textContent || '').includes(PW), 'FR-195 a value split across markup is hidden by the joined reading');
  eq(pg.ref('Not written: password=' + PW + ' was refused.')!.includes(PW), false, 'FR-195 (control) main\'s announcement hides the joined value');
  const t2 = pg.toast('<b>' + GHP.slice(0, 20) + '</b>' + GHP.slice(20) + ' done');
  ok(!(t2.textContent || '').includes(BODY.slice(0, 12)), 'FR-195 a token split by markup is hidden by the joined reading');
}
// 4b. the union: a word the joined reading of the text as built hides (a line with a secret and an escape is hidden whole) is never shown
{
  const t = pg.toast(escH('--password ' + PW) + ' <b>' + escH(P('gh', 'p\\_') + BODY) + '</b>');
  eq(pg.ref('--password ' + PW + ' ' + P('gh', 'p\\_') + BODY), '[redacted]', 'FR-195 (control) main\'s announcement hides the whole line');
  ok(!(t.textContent || '').includes(PW), 'FR-195 union: a word the joined reading hides is not shown');
}
// 4b2. piece level: a value cut by markup where one side is masked alone keeps no piece of the other side that the joined reading hides
{
  const t = pg.toast('Saved in <b>/home/' + P('zqxus') + '</b>' + P('ername') + '/r.');
  ok(!(t.textContent || '').includes(P('erna')), 'FR-195 piece level: no piece of a value cut by markup is shown');
}
// 4c. without the shared piece-level union the block fails closed
{
  const e = page('emptykeep').toast('Not written: password=<b>' + PW + '</b> was refused.');
  eq(e.textContent, '[redacted]', 'FR-195 keepShownBy giving an empty text: the block is hidden whole, never left empty');
  const t = page('nokeep').toast('Not written: password=<b>' + PW + '</b> was refused.');
  eq(t.textContent, '[redacted]', 'FR-195 no keepShownBy: the block is hidden whole');
}
// 5. labels: title and aria-label are masked too
{
  const t = pg.toast('<span title="' + escH('fix ' + GHP) + '" aria-label="' + escH('/home/' + USER + '/repo') + '">Saved.</span>');
  hides(shown(t), 'FR-195 toast labels');
  ok((t.textContent || '').includes('Saved.'), 'FR-195 toast labels: the text is kept');
}
// 6. the MCP strip, built by its own function: names, where and the reason text
{
  const items = [{ key: 'k1', name: 'srv ' + GHP, where: '/home/' + USER + '/proj', reason: 'it said ' + SK, fix: 'Sign in again', kind: 'file' }];
  for (const open of [false, true]) {
    const el = pg.mcp(items, open);
    hides(shown(el), `FR-195 MCP strip (${open ? 'list open' : 'one line'})`);
    ok(!el.hidden && !!el.querySelector('[data-ml="close"]'), `FR-195 MCP strip (${open ? 'list open' : 'one line'}): it is shown with its buttons`);
    ok(/MCP problem needs attention/.test(el.textContent || ''), `FR-195 MCP strip (${open ? 'list open' : 'one line'}): its fixed words are kept`);
  }
  const sp = pg.mcp([{ key: 'k3', name: P('gh', 'p\\_') + BODY, where: '', reason: '--password ' + PW, fix: 'Sign in', kind: 'file' }], true);
  ok(!(sp.textContent || '').includes(PW), 'FR-195 MCP strip: a list item is read as one text too (the union)');
  const el = pg.mcp([{ key: 'k2', name: 'github', where: 'Copilot', reason: 'not signed in', fix: 'Sign in', kind: 'file' }], true);
  ok(/: github\./.test(el.textContent || '') && /not signed in\. Sign in/.test(el.textContent || ''), 'FR-195 MCP strip: a benign entry is kept');
}
// 6b. the restore, interrupted-sessions, away and Auto-follow strips, each built by its own function, with a hostile folder or agent name
async function stripsByBehaviour(): Promise<void> {
  for (const [what, nm] of NAMES) {
    const r = pg.restore(nm);
    hides(shown(r), `FR-195 restore strip, ${what}`);
    ok(!r.hidden && /lets agents change files without asking|^\[redacted\]$/.test(r.querySelector('.ns-t')!.textContent || ''), `FR-195 restore strip, ${what}: shown with its fixed words`);
    const c = pg.crash(nm);
    hides(shown(c), `FR-195 crash strip, ${what}`);
    ok(!c.hidden && !!c.querySelector('[data-crrow]'), `FR-195 crash strip, ${what}: shown with its Pick list`);
    const a = await pg.away(nm, 'check the build');
    hides(shown(a), `FR-195 away strip, ${what}`);
    ok(!a.hidden && /Since you were away/.test(a.textContent || ''), `FR-195 away strip, ${what}: shown with its fixed words`);
    const f = pg.follow(nm);
    hides(shown(f), `FR-195 Auto-follow strip, ${what}`);
    ok(!f.hidden && /^Following |^\[redacted\]$/.test(f.querySelector('#afText')!.textContent || ''), `FR-195 Auto-follow strip, ${what}: shown with its fixed words`);
  }
  eq(pg.restore('web-app').querySelector('.ns-t')!.textContent, 'One folder (web-app) lets agents change files without asking.', 'FR-195 restore strip: a benign name is kept');
  eq(pg.follow('Noor').querySelector('#afText')!.textContent, 'Following Noor.', 'FR-195 Auto-follow strip: a benign name is kept');
  for (const [what, nm] of NAMES) {
    const h = pg.followReal(nm, true);
    hides(shown(h), `FR-195 Auto-follow strip, the real hidden-folder words, ${what}`);
  }
  eq(pg.followReal('Noor', true).querySelector('#afText')!.textContent, 'Auto-follow on. Noor is working in a hidden folder.', 'FR-195 Auto-follow strip: the real hidden-folder words with a benign name');
}
// 7. fails closed: no mask module, ?noredact=1, a throw, the module's own failure text
for (const mode of [false, 'noredact', 'throws', 'failed'] as Mode[]) {
  const p = page(mode);
  const t = p.toast('Theme <b>' + escH('fix ' + GHP) + '</b> removed.');
  hides(shown(t), `FR-195 fails closed (${String(mode)})`);
  ok((t.textContent || '').includes('[not checked]'), `FR-195 fails closed (${String(mode)}): the fixed words [not checked] are shown`);
  const s = p.toast('<i title="' + escH('/home/' + USER) + '">x</i>');
  ok(!shown(s).includes(USER), `FR-195 fails closed (${String(mode)}): a label is not shown`);
}
// 8. source checks: every toast and each strip goes through liveMask before it is shown
{
  const mt = twoLines('function mountToast(');
  ok(/liveMask\(t,/.test(mt) && mt.indexOf('liveMask(') < mt.indexOf('appendChild('), 'FR-195 mountToast masks the toast before it is added');
  ok(/mountToast\(t\)/.test(line('function toast(')) && /mountToast\(t\)/.test(block('function toastActions(')), 'FR-195 toast and toastActions go through mountToast');
  eq(app.split('\n').filter((l) => /\$\('toasts'\)\.append|#toasts'\)\.append|toasts\.append/.test(l)).length, 0, 'FR-195 nothing else appends to #toasts');
  for (const [fn, head] of [['renderRestoreStrip', 'function renderRestoreStrip('], ['paintCrashStrip', 'function paintCrashStrip('],
    ['renderAwayStrip', 'async function renderAwayStrip('], ['paintMcpStrip', 'function paintMcpStrip(']]) {
    const b = block(head), i = b.indexOf('stripMask(el)'), lastSet = Math.max(b.lastIndexOf("el.innerHTML='<"), b.lastIndexOf(".textContent=rooms"));
    ok(i > 0 && i > lastSet, `FR-195 ${fn} masks the strip after it is built`);
    ok(i < b.indexOf('el.hidden=false'), `FR-195 ${fn} masks the strip before it is shown`);
    const after = b.slice(i, b.indexOf('onclick', i) < 0 ? b.length : b.indexOf('onclick', i));
    ok(!/innerHTML|textContent|insertAdjacent|setAttribute\('(title|aria-label)'/.test(after), `FR-195 ${fn} writes no text or label after stripMask`);
  }
}

// 9. differential fuzz against main's announcement mask (frozen above), PIECE level: no 4-character piece of a value that main's reading of the line
// hides is shown by the toast of that line, also when markup cuts the value at a random point. A fixed seed and a work counter, never wall time.
{
  let seed = 0x1419;
  const rnd = (k: number): number => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % k; };
  const pick = <T,>(a: T[]): T => a[rnd(a.length)];
  const WORDS = ['Theme', 'removed', 'Could', 'not', 'run', 'it:', 'saved', 'folder', 'agent', 'moved', 'to', 'Floor', 'git', 'log', '--oneline', '-n', '5',
    'echo', 'done.', 'path', '(backup', 'file)', 'error', 'ENOENT', 'Copilot', 'Claude', 'Codex', 'grep', '-r', 'TODO', 'src/', 'x=1'];
  const SECRETS = [GHP, SK, '/home/' + USER + '/r', '/Users/' + USER, 'C:\\Users\\' + USER + '\\a', '\\\\h\\s\\' + USER, P('gh', 'p\\_') + BODY,
    '--password ' + PW, 'token=' + PW, '/ho\u200bme/' + USER + '/x', 'Authorization: Bearer ' + P('eyJhbG', 'ciOiJI', 'UzI1Ni', 'J9xyzA')];
  const FIXED = WORDS.join(' ') + ' [redacted] [not checked] ~';
  const TAGS = ['b', 'code', 'small', 'i'];
  let texts = 0, mainHid = 0, mainHidShown = 0, newOnlyHidden = 0, cut = 0;
  for (let i = 0; i < 1500; i++) {
    const parts: string[] = [], secrets: string[] = [];
    const k = 2 + rnd(8);
    for (let j = 0; j < k; j++) { const sec = rnd(3) === 0; const p = sec ? pick(SECRETS) : pick(WORDS); parts.push(p); if (sec) secrets.push(p); }
    const plain = parts.join(' ');
    // the same text as a toast: some parts in markup, and some values cut by markup at a random point (as a name next to fixed words can be)
    const html = parts.map((p) => {
      const r = rnd(6), tg = pick(TAGS);
      if (r <= 1 && p.length > 2) { const at = 1 + rnd(p.length - 1); cut++; return r === 0 ? `<${tg}>` + escH(p.slice(0, at)) + `</${tg}>` + escH(p.slice(at)) : escH(p.slice(0, at)) + `<${tg}>` + escH(p.slice(at)) + `</${tg}>`; }
      return r === 2 ? `<${tg}>` + escH(p) + `</${tg}>` : escH(p);
    }).join(' ');
    const ref = pg.ref(plain);
    assert.ok(typeof ref === 'string', 'the frozen reference masks');
    const got = pg.toast(html).textContent || '';
    texts++;
    const seen = new Set<string>();
    for (const sec of secrets) for (let q = 0; q + 4 <= sec.length; q++) {
      const pc = sec.slice(q, q + 4);
      if (/\s/.test(pc) || seen.has(pc) || FIXED.includes(pc)) continue;
      seen.add(pc);
      if (!(ref as string).includes(pc)) { mainHid++; if (got.includes(pc)) { mainHidShown++; if (process.env.LIVEMASK_DEBUG && mainHidShown < 6) console.log(JSON.stringify({ pc, plain, ref, got })); } }
      else if (!got.includes(pc)) newOnlyHidden++;
    }
  }
  eq(mainHidShown, 0, `FR-195 differential fuzz: pieces main's announcement hides and the toast shows = 0 (${texts} texts, ${mainHid} pieces hidden by main)`);
  ok(mainHid > 1000 && cut > 500, 'FR-195 differential fuzz: the fuzz exercises hidden pieces and values cut by markup');
  console.log(`test-live-mask fuzz: ${texts} texts (${cut} values cut by markup), ${mainHid} pieces main hides, ${mainHidShown} of them shown, ${newOnlyHidden} pieces hidden only by the toast (over-masking vs main's announcement)`);
}

// spec 012 FR-197 (issue #1999): the chat's header name, its tooltip, the chat's `aria-label` and the composer's label and placeholder show a session's
// name only through `liveText`. The page's own definitions, in a context with the masks above; the source checks read a CRLF copy too.
const HEAD_DEFS = (src: string): string => {
  const L = src.replace(/\r\n/g, '\n').split('\n'), one = (h: string): string => { const l = L.filter((x) => x.startsWith(h)); assert.strictEqual(l.length, 1, h); return l[0]; };
  const i = L.findIndex((x) => x.startsWith('function paintPanelTitle(')), j = L.findIndex((x, k) => k > i && x === '}');
  return [one('const nameShown='), one('const panelTipOf='), one('const panelTitleHTML='), ...L.slice(i, j + 1)].join('\n');
};
eq(HEAD_DEFS(app.replace(/\n/g, '\r\n')), HEAD_DEFS(app), 'FR-197 the header definitions read the same from a CRLF copy');
const headPage = (mode: boolean) => {
  const dom = new JSDOM('<!doctype html><body><h2 id="panelTitle"><button class="ttl-btn"></button></h2><h2 id="plain"></h2></body>');
  const ctx = vm.createContext({ window: { DurbarRedact: mode ? shared : undefined, DurbarSafeText: require(path.join(R_DIR, 'safetext.js')) },
    DurbarCutText: require(path.join(R_DIR, 'cuttext.js')), document: dom.window.document, NO_REDACT: !mode,
    SN: () => ({ nameTip: (alias: string, title: string) => alias || title || '' }), titleRenameable: (a: { ren?: boolean }) => !!a.ren, ICON: () => '<svg></svg>' });
  vm.runInContext(['const homeMask=', 'const deskMask=', 'const SHORT=', 'const RED=', 'const STX=', 'const SAFE=', 'const safeExcerpt=', 'const esc=', 'function annHome(', 'function annPart(', 'function liveText('].map(line).join('\n')
    + '\n' + HEAD_DEFS(app) + '\nthis.nameShown=nameShown;this.panelTipOf=panelTipOf;this.panelTitleHTML=panelTitleHTML;this.paintPanelTitle=paintPanelTitle;', ctx);
  return { doc: dom.window.document, C: ctx as unknown as { nameShown(a: object): string; panelTipOf(a: object): string; panelTitleHTML(a: object): string; paintPanelTitle(a: object, h: Element): void } };
};
{
  const { doc, C } = headPage(true);
  for (const [what, nm] of NAMES) {
    const a = { name: nm, alias: '', title: nm, ren: true };
    hides(C.nameShown(a), `FR-197 nameShown, ${what}`);
    hides(C.panelTipOf(a), `FR-197 header tooltip, ${what}`);
    hides(C.panelTitleHTML(a), `FR-197 header title HTML, ${what}`);
    hides(C.panelTitleHTML({ ...a, ren: false }), `FR-197 header title HTML (not renameable), ${what}`);
    const h = doc.getElementById('panelTitle') as HTMLElement; C.paintPanelTitle(a, h); hides(shown(h), `FR-197 paintPanelTitle, ${what}`);
    const h2 = doc.getElementById('plain') as HTMLElement; C.paintPanelTitle({ ...a, ren: false }, h2); hides(shown(h2), `FR-197 paintPanelTitle (not renameable), ${what}`);
  }
  eq(C.nameShown({ name: 'Noor · fix the build' }), 'Noor · fix the build', 'FR-197 a benign name reads as written');
  for (const [what, p] of SHARES) eq(C.nameShown({ name: 'Noor ' + p }), 'Noor ' + p, `FR-435 nameShown: ${what} is shown whole`);
  eq(C.panelTipOf({ name: 'Noor', alias: 'Noor', ren: true }), 'Noor Click or press F2 to rename.', 'FR-197 a benign tooltip reads as before');
  eq(headPage(false).C.nameShown({ name: 'Noor ' + GHP }), '[not checked]', 'FR-197 fails closed with no mask module');
}
// every site that put a session's name into the header, the chat's label or the composer reads nameShown (source check, LF and CRLF copies)
// (each check is one line, so the CRLF copy is read as it is, without turning it back into LF: pre-review of PR 2098)
for (const [form, t] of [['LF', app], ['CRLF', app.replace(/\n/g, '\r\n')]] as const) {
  ok(t.includes('aria-label="Chat with ${esc(nameShown(a))}"') && t.includes("c.setAttribute('aria-label','Chat with '+nameShown(a))"), `FR-197 the chat's label reads nameShown (${form})`);
  ok(t.includes('placeholder="Message ${esc(nameShown(a))}…" aria-label="Message ${esc(nameShown(a))}"') && t.includes("mi.setAttribute('aria-label','Message '+nameShown(a))") && t.includes("APW.placeholder(app):'Message '+nameShown(a)"), `FR-197 the composer reads nameShown (${form})`);
  ok(t.includes('aria-label="${esc(nameShown(a))}"'), `FR-197 the header's label reads nameShown (${form})`);
  ok(!/(?:Chat with |Message |Rename session )(?:\$\{esc\(a\.name\)\}|'\+a\.name)/.test(t), `FR-197 no header, chat or composer label reads a.name as written (${form})`);
  // round-3 pre-review of PR 2098: every line that builds one of the sites holds no raw name at all, whatever form a revert takes
  for (const key of ['id="panelTitle"', 'id="chat" role="log"', 'id="msgInput"', "mi.setAttribute('aria-label','Message '", "coffeeWord()+(left", "it('open','Open chat'", 'm.appendChild(typingIndicator(a))', 'const typingIndicator=', 'const panelTitleHTML=',
    // round 2 of the review of PR 2098: every other place in the chat panel and its menus that labels a session by name
    "menuLabel(hasOps?'Actions for ':'Permission mode for '", "menuLabel('Profile for '", "menuLabel('Model and context for '", "menuLabel('Context window of '", "'. Ask '+nameShown(a)+' to try again", "const nm=bar.querySelector('.ab-n');nm.textContent=", 'const rename=()=>{const nm=bar.querySelector', 'id="scToHint"', 'rows=list.map(x=>({id:x.id,name:', ".sub-name').textContent=", "t.className='rp-ini'"]) {
    const lines = t.split(/\r?\n/).filter((l) => l.includes(key));
    ok(lines.length >= 1 && lines.every((l) => !/\ba\.name\b/.test(l)), `FR-197 the line that builds ${key.slice(0, 24)} holds no raw name (${form})`);
  }
}

// the two repaint paths run with their own code (pre-review of PR 2098): a rename repaints the header, the chat's label and the composer's label; the Autopilot
// switch repaints the composer's label; neither shows the name as written
{
  const block2 = (head: string): string => { const i = LINES.findIndex((x) => x.startsWith(head)); assert.ok(i >= 0, head); const j = LINES.findIndex((x, k) => k > i && x === '}'); return LINES.slice(i, j + 1).join('\n'); };
  const dom = new JSDOM('<!doctype html><body><h2 id="panelTitle"><button class="ttl-btn"></button></h2><div id="chat"></div><textarea id="msgInput"></textarea><button id="attFile"></button></body>');
  const doc = dom.window.document;
  const ctx = vm.createContext({ window: { DurbarRedact: shared, DurbarSafeText: require(path.join(R_DIR, 'safetext.js')) }, DurbarCutText: require(path.join(R_DIR, 'cuttext.js')), document: doc, NO_REDACT: false,
    SN: () => ({ nameTip: (alias: string, title: string) => alias || title || '', displayName: (alias: string, title: string) => alias || title }), titleRenameable: () => true, ICON: () => '',
    $: (id: string) => doc.getElementById(id), ui: { selected: 's1' }, fitPlaceholder() {}, answerObs: null, scheduleRender() {}, renderSchedDlg() {},
    APW: { placeholder: () => 'Autopilot', attachTip: () => '' }, kindWord: () => 'app', capsFor: () => ({ autopilot: { attachments: true } }) });
  vm.runInContext(['const homeMask=', 'const deskMask=', 'const SHORT=', 'const RED=', 'const STX=', 'const SAFE=', 'const safeExcerpt=', 'const esc=', 'function annHome(', 'function annPart(', 'function liveText('].map(line).join('\n')
    + '\n' + HEAD_DEFS(app) + '\n' + block2('function repaintName(') + '\n' + block2('function apComposer(') + '\nthis.repaintName=repaintName;this.apComposer=apComposer;', ctx);
  const C2 = ctx as unknown as { repaintName(a: object): void; apComposer(a: object): void };
  for (const [what, nm] of NAMES) {
    const a = { id: 's1', alias: nm, title: nm, info: { autopilot: false, adapterId: 'claude' } };
    C2.repaintName(a);
    hides(shown(doc.body), `FR-197 a rename repaints every label masked, ${what}`);
    (doc.getElementById('msgInput') as HTMLElement).setAttribute('aria-label', 'Autopilot');
    C2.apComposer(a);
    hides(doc.getElementById('msgInput')!.getAttribute('aria-label') || '', `FR-197 turning Autopilot off repaints the composer's label masked, ${what}`);
  }
  const b = { id: 's1', alias: 'Noor', title: 'Noor', info: { autopilot: false, adapterId: 'claude' } };
  C2.repaintName(b);
  eq([doc.getElementById('chat')!.getAttribute('aria-label'), doc.getElementById('msgInput')!.getAttribute('aria-label')], ['Chat with Noor', 'Message Noor'], 'FR-197 a benign rename repaints the labels with the name');
}

// review of PR 2098: the coffee-break menu (its label and its open item) and the typing indicator of a played turn name the session through the same mask
{
  const block3 = (head: string): string => { const i = LINES.findIndex((x) => x.startsWith(head)); assert.ok(i >= 0, head); const j = LINES.findIndex((x, k) => k > i && x === '}'); return LINES.slice(i, j + 1).join('\n'); };
  const one3 = (h: string): string => { const l = LINES.filter((x) => x.startsWith(h)); assert.strictEqual(l.length, 1, h); return l[0]; };
  const dom = new JSDOM('<!doctype html><body><button id="anchor"></button></body>');
  const doc = dom.window.document;
  const ctx = vm.createContext({ window: { DurbarRedact: shared, DurbarSafeText: require(path.join(R_DIR, 'safetext.js')) }, DurbarCutText: require(path.join(R_DIR, 'cuttext.js')), document: doc, NO_REDACT: false,
    closeModeMenu() { doc.getElementById('modeMenu')?.remove(); }, byId: (id: string) => AG[id], COFFEE: { retryable: () => true }, BREAKS: { get: () => null }, coffeeLeftWords: () => '', RETRY_TIP: 'Retry',
    coffeeWord: () => 'coffee break', coffeeNoRetry: () => '', CSS: { escape: (x: string) => x }, cardOf: () => null, focusIn() {}, announce() {}, innerWidth: 1440, innerHeight: 900 });
  const AG: Record<string, object> = {};
  vm.runInContext(['const homeMask=', 'const deskMask=', 'const SHORT=', 'const RED=', 'const STX=', 'const SAFE=', 'const safeExcerpt=', 'const esc=', 'function annHome(', 'function annPart(', 'function liveText(', 'const nameShown=', 'const typingIndicator='].map(one3).join('\n')
    + '\n' + block3('function openCoffeeMenu(') + '\nthis.openCoffeeMenu=openCoffeeMenu;this.typingIndicator=typingIndicator;', ctx);
  const C3 = ctx as unknown as { openCoffeeMenu(id: string, anchor: Element): void; typingIndicator(a: object): HTMLElement };
  for (const [what, nm] of NAMES) {
    AG.c1 = { id: 'c1', name: nm, coffee: true };
    C3.openCoffeeMenu('c1', doc.getElementById('anchor') as Element);
    const m = doc.getElementById('modeMenu') as HTMLElement;
    ok(!!m, `FR-197 the coffee-break menu opens, ${what}`);
    hides(shown(m), `FR-197 the coffee-break menu's label and items are masked, ${what}`);
    hides(shown(C3.typingIndicator({ name: nm })), `FR-197 the typing indicator's label is masked, ${what}`);
  }
  AG.c1 = { id: 'c1', name: 'Noor', coffee: true };
  C3.openCoffeeMenu('c1', doc.getElementById('anchor') as Element);
  eq(doc.getElementById('modeMenu')!.getAttribute('aria-label'), 'Noor: coffee break', 'FR-197 a benign coffee-break menu label reads as written');
  eq(C3.typingIndicator({ name: 'Noor' }).getAttribute('aria-label'), 'Noor is working', 'FR-197 a benign typing indicator label reads as written');
  ok(app.includes('m.appendChild(typingIndicator(a));') && !/aria-label',a\.name\+' is working'/.test(app), 'FR-197 a played turn builds its typing indicator through typingIndicator');
}

// round 2 of the review of PR 2098: the menus and dialogs about one session label it through menuLabel (the permission-mode or actions menu, the profile and
// model menus, the context-window dialog); run the page's own definition
{
  const one4 = (h: string): string => { const l = LINES.filter((x) => x.startsWith(h)); assert.strictEqual(l.length, 1, h); return l[0]; };
  const ctx = vm.createContext({ window: { DurbarRedact: shared, DurbarSafeText: require(path.join(R_DIR, 'safetext.js')) }, DurbarCutText: require(path.join(R_DIR, 'cuttext.js')), NO_REDACT: false });
  vm.runInContext(['const homeMask=', 'const deskMask=', 'const SHORT=', 'const RED=', 'const STX=', 'const SAFE=', 'const safeExcerpt=', 'function annHome(', 'function annPart(', 'function liveText(', 'const nameShown=', 'const menuLabel='].map(one4).join('\n') + '\nthis.menuLabel=menuLabel;', ctx);
  const ML = (ctx as unknown as { menuLabel(p: string, a: object): string }).menuLabel;
  for (const [what, nm] of NAMES) for (const pre of ['Actions for ', 'Permission mode for ', 'Profile for ', 'Model and context for ', 'Context window of ']) hides(ML(pre, { name: nm }), `FR-197 a session menu's label is masked (${pre.trim()}), ${what}`);
  eq(ML('Permission mode for ', { name: 'Noor' }), 'Permission mode for Noor', 'FR-197 a benign session menu label reads as written');
  ok((app.match(/menuLabel\(/g) || []).length >= 5, 'FR-197 the mode, profile and model menus and the context-window dialog use menuLabel');
}

// round 3 of the review of PR 2098: the schedule dialog's agent hint, repainted when its target is set again, reads nameShown (the page's own line, run)
{
  const one5 = (h: string): string => { const l = LINES.filter((x) => x.startsWith(h)); assert.strictEqual(l.length, 1, h); return l[0]; };
  const hint = LINES.filter((x) => x.includes("$('scToHint').textContent="));
  eq(hint.length, 1, 'FR-197 one line repaints the schedule hint');
  const dom = new JSDOM('<!doctype html><body><p id="scToHint"></p></body>');
  const doc = dom.window.document;
  const ctx = vm.createContext({ window: { DurbarRedact: shared, DurbarSafeText: require(path.join(R_DIR, 'safetext.js')) }, DurbarCutText: require(path.join(R_DIR, 'cuttext.js')), NO_REDACT: false,
    $: (id: string) => doc.getElementById(id) });
  vm.runInContext(['const homeMask=', 'const deskMask=', 'const SHORT=', 'const RED=', 'const STX=', 'const SAFE=', 'const safeExcerpt=', 'function annHome(', 'function annPart(', 'function liveText(', 'const nameShown='].map(one5).join('\n')
    + '\nthis.paintHint=tgt=>{' + hint[0] + '};', ctx);
  const paintHint = (ctx as unknown as { paintHint(t: object | null): void }).paintHint;
  for (const [what, nm] of NAMES) { paintHint({ id: 's1', name: nm }); hides(shown(doc.getElementById('scToHint') as Element), `FR-197 the schedule hint's repaint is masked, ${what}`); }
  paintHint({ id: 's1', name: 'Noor' });
  eq([doc.getElementById('scToHint')!.textContent, doc.getElementById('scToHint')!.getAttribute('title')], ['Noor', 'Noor'], 'FR-197 a benign schedule hint reads as written');
}

// round 3 and round 4 of the review of PR 2098: the sink table. SINK finds every read of a property called `name` in app.js (dot and optional-dot access,
// bracket access with a quoted name, destructuring in a declaration, a parameter or a loop) and every call of nameShown or menuLabel; each read is counted
// under its enclosing top-level definition ('after X' for a top-level statement after definition X). The table holds, per definition:
//   m = masked on the line (the line goes through a mask or a masking sink);
//   v = masked by a sink a later line passes it to (a toast, an announcement, the caller's mask, the helper card's own mask, a masked strip);
//   g = a session's name shown as written, by gap class (each class is named, with the same words, in spec 012's FR-197 gap list and in secret-coverage.md);
//   x = exempt: not a session's name, or a session's name that shows nothing, by a one-word reason (EXEMPT_REASONS).
// A definition that reads `name` and is not in the table, a count that changes, or a listed definition that is gone fails: a new site must be decided.
{
  type Row = { m?: number; v?: number; g?: Record<string, number>; x?: Record<string, number> };
  const GAP_CLASSES: Record<string, string> = {
    'chat-header': "the header's helper line", 'message-line': "a message's name line", 'chat-note': 'a chat note that names a session',
    dialog: 'the dialogs about one session', schedules: "the schedules dialog's list", palette: "the command palette's session entries and the session pickers",
    desk: "the desk's card and the lounge", places: "the office's places and their visitors", helpers: "a helper's parent session in the helper labels",
    rows: "the rail's, the list's, the inbox's and the held messages' rows", follow: 'the auto-follow status and notices', views: 'the data handed to other views',
  };
  const EXEMPT_REASONS: Record<string, string> = {
    folder: "a folder's name", floor: "a floor's name", file: "a file's or path's name", attribute: "an HTML attribute's name", theme: "a theme's name", world: "a world's name",
    crew: "a character set's or character's name", mcp: "an MCP server's name", profile: "a profile's name", model: "a model's name", app: "an agent app's name",
    service: "a remote-control service's name", template: "a schedule template's name", field: "a form field's name", slash: "a slash command's name",
    helper: "a sub-agent's name, masked by helperMask where it is shown", label: "Durbar's own words", selector: 'a CSS class in a selector string', cssclass: 'a CSS class name in markup', column: "a list column's key, read through the sort keys",
    data: 'a session name copied into data that a listed site reads again', rename: 'the rename field, which opens with the name as written (your own edit)',
    write: 'a write, not a read', compare: 'a comparison', sortkey: 'a sort key', width: 'a text width', cachekey: 'a cache key', comment: 'a comment',
  };
  const TABLE: Record<string, Row> = {
    ownRegister: { x: { crew: 1 } }, floorTag: { x: { floor: 1 } }, costData: { x: { folder: 1 } }, applyTheme: { x: { theme: 1 } },
    deskTip: { m: 1, g: { desk: 1 }, x: { profile: 1 } }, visitorWords: { g: { places: 2 }, x: { folder: 1, floor: 1 } }, placeTip: { g: { places: 1 } },
    lobbyInitW: { x: { width: 1 } }, lobbyHTML: { g: { places: 3 } }, postboxHTML: { x: { folder: 1 } }, openPlaceMenu: { g: { places: 1 }, x: { folder: 1, floor: 1 } },
    openCoffeeMenu: { m: 3 }, faceKey: { x: { cachekey: 1 } }, avatar: { g: { desk: 1 } }, renderFilter: { x: { folder: 1 } }, moreHTML: { g: { helpers: 1 } },
    helperHTML: { m: 1, g: { helpers: 1 } }, helperWords: { v: 2 }, helperTileHTML: { m: 1, g: { helpers: 1 } }, helperCardHTML: { v: 2, g: { helpers: 1 } },
    cardHTML: { g: { desk: 2 }, x: { profile: 1, cssclass: 1 } }, renBtn: { g: { desk: 2 } }, renFolderBtn: { x: { folder: 2 } }, unitHTML: { g: { desk: 2 }, x: { profile: 1, cssclass: 1 } },
    restHTML: { g: { desk: 3 }, x: { profile: 1 } }, shuttersHTML: { g: { desk: 1 }, x: { folder: 3 } }, heldGroups: { x: { data: 1 } }, heldNotice: { g: { rows: 1 } },
    heldSettingsHTML: { g: { rows: 1 } }, folderOfRoom: { x: { folder: 1 } }, roomSchedChip: { x: { folder: 1 } }, headTip: { x: { folder: 1, floor: 1 } },
    roomHTML: { x: { folder: 8 } }, syncAttrs: { x: { attribute: 6 } }, roPeople: { x: { crew: 1 } }, roWorlds: { x: { world: 1 } }, realSubs: { v: 1 }, roFloor: { x: { floor: 1 } },
    realModel: { g: { views: 5 }, x: { folder: 1, profile: 1 } }, realSlips: { g: { views: 6 }, x: { folder: 1, profile: 1 } }, renderOffice: { x: { floor: 2 } },
    LCOLS: { x: { column: 1 } }, CS_COLS: { x: { column: 1 } }, LVAL: { x: { sortkey: 2 } }, listRow0: { g: { rows: 3 }, x: { folder: 3 } }, renderConvResults: { x: { compare: 1 } }, newAgentMsg: { g: { 'message-line': 1 } },
    addUserMsg: { x: { file: 2 } }, sendMessage: { m: 1, x: { file: 1 } }, gate: { x: { file: 2 } }, addPicked: { x: { file: 1 } }, addFiles: { x: { file: 3 } },
    renderAttached: { x: { file: 3 } }, syncChatHeader: { m: 1 }, wireAnswerBar: { m: 4 }, noteCompleted: { m: 1 }, noteFailed: { m: 1 }, markRead: { m: 1 },
    nameShown: { m: 1 }, menuLabel: { m: 1 }, typingIndicator: { m: 1 }, panelTipOf: { m: 1 }, panelTitleHTML: { m: 1 }, paintPanelTitle: { m: 1 }, cvKey: { x: { attribute: 1 } },
    openPanel: { m: 7, g: { 'chat-header': 1 }, x: { folder: 3 } }, slashUpdate: { x: { slash: 2 } }, slashPick: { x: { slash: 2 } }, noteRowHTML: { g: { views: 1 } },
    notesPalItems: { x: { folder: 1 } }, openNotesScreen: { x: { folder: 3 } }, nsRender: { x: { folder: 1 } }, nsPaint: { g: { views: 1 } }, nsExport: { x: { file: 1 } },
    nsDeleteAll: { x: { folder: 1 } }, mcpSignLinesDrop: { x: { mcp: 1 } }, openCtxMenu: { m: 1 }, 'after openLinkMenu': { x: { folder: 1 } }, reoName: { v: 1, x: { folder: 1 } },
    reoStepModel: { v: 1, x: { folder: 2 } }, 'after resetOrder': { m: 4, x: { folder: 2 } }, renderRestoreStrip: { v: 1, x: { folder: 1 } }, attentionItems: { g: { views: 1 } },
    doorRepaint: { m: 1 }, paintInbox: { m: 3, v: 1, g: { rows: 2 }, x: { write: 1, folder: 2 } }, afBackToOffice: { x: { floor: 1 } }, afLeaveChat: { m: 1 },
    afOnAccepted: { g: { follow: 1 } }, afDeliver: { m: 2 }, afRender: { g: { follow: 2 } }, afGo: { m: 1 }, palAll: { g: { palette: 1 }, x: { folder: 3 } },
    navSnap: { g: { palette: 1 }, x: { floor: 1, folder: 2 } }, navOpen: { m: 1 }, sendToSeveral: { v: 2, g: { palette: 1, follow: 1 } }, endAllSessions: { v: 1 },
    mcpLaunchSeen: { v: 1 }, paintMcpStrip: { x: { mcp: 3 } }, 'after openBrowserMenu': { m: 1, g: { views: 1 } }, rideFloor: { x: { floor: 1 } }, renderLift: { x: { floor: 1 } },
    flFocusTip: { x: { floor: 2 } }, renderIntoFloor: { x: { floor: 1 } }, floorsBodyHTML: { x: { floor: 9, folder: 3 } }, 'after floorCall': { x: { floor: 1 } },
    floorAction: { x: { floor: 4 } }, addLiveAgent: { x: { data: 6 } }, mcpReLine: { x: { mcp: 10 } }, toolTask: { x: { file: 1 } }, edPaint: { x: { file: 1 } }, edDiff: { x: { file: 1 } },
    subBlock: { m: 1 }, onSubagent: { m: 1, x: { helper: 5 } }, onTaskTool: { x: { helper: 2 } }, buildSubTranscript: { m: 1 }, ensureTurn: { g: { 'message-line': 1 } },
    openCapDialog: { m: 1, g: { dialog: 1 } }, showLimit: { m: 2 }, showPlan: { m: 2 }, qMdHTML: { x: { attribute: 1 } }, showQuestion: { m: 1 }, showElicitation: { m: 1, x: { field: 7 } },
    startCoffee: { m: 1 }, paintCoffeeBar: { m: 1 }, showPerm: { m: 1 }, roAskAfterSwitch: { m: 1 }, ctxRingHTML: { x: { label: 1 } }, updateCtxChip: { x: { comment: 1 } },
    repaintName: { m: 2, x: { write: 1 } }, brainLoad: { g: { views: 1 } }, brainFeed: { g: { views: 2 } }, brainDoorPaint: { m: 1, v: 2 }, onLiveEvent: { x: { profile: 1, model: 1 } },
    sendLive: { x: { file: 1 } }, stopLive: { m: 1 }, endLive: { m: 1 }, railRow: { g: { rows: 4 } }, renderStrip: { x: { folder: 3 } }, apComposer: { m: 1 },
    autopilotFlow: { m: 1, g: { dialog: 1 }, x: { folder: 1 } }, openModeMenu: { m: 1 }, cardOp: { g: { dialog: 2 } }, submitSessionName: { x: { rename: 2 } },
    renameSessionUi: { x: { rename: 2 } }, changeModeInner: { m: 1, g: { dialog: 2 } }, openFolderMenu: { x: { folder: 3, floor: 2 } }, moveFolderByMenu: { x: { floor: 2, folder: 2 } },
    modelLabel: { x: { model: 1 } }, fillModelSelect: { x: { model: 1 } }, kindTitle: { x: { app: 1 } }, kindOptions: { x: { app: 1 } }, aboutKinds: { x: { app: 1 } }, pendLabel: { x: { model: 1 } },
    modelChipHTML: { x: { model: 2 } }, agentChipHTML: { x: { profile: 4 } }, openAgentMenu: { m: 1, x: { profile: 2 } }, applyProfile: { x: { profile: 2 } }, openModelMenu: { m: 1, x: { model: 2 } },
    chooseModelInner: { g: { dialog: 1 }, x: { model: 3 } }, chooseAutoTierInner: { g: { dialog: 1 } }, sendModelChange: { m: 3, v: 1, x: { model: 3 } }, cancelPendingInner: { m: 1, x: { model: 1 } },
    onModelEvent: { m: 1, x: { model: 1 } }, onAutoTierFailed: { m: 1 }, compactDialog: { g: { dialog: 1 }, x: { model: 1 } }, svc: { x: { service: 1 } }, remoteItemInner: { x: { service: 1 } },
    remoteChipHTML: { x: { service: 1 } }, remotePalItems: { g: { palette: 2 }, x: { service: 2 } }, remoteOn: { m: 2, x: { service: 5 } }, remoteOff: { m: 1 },
    remoteLinkDialog: { g: { dialog: 1 }, x: { service: 3 } }, handoverPalItems: { g: { palette: 1 } }, newSession: { g: { dialog: 2 }, x: { folder: 2, profile: 1 } },
    reviewHandoff: { g: { dialog: 1 }, x: { folder: 1 } }, schedLine: { g: { schedules: 2 } }, histName: { g: { schedules: 1 } }, renderSchedDlg: { g: { schedules: 1 } },
    openSchedules: { m: 4, x: { template: 1, folder: 1, data: 5 } }, renderSchedSettings: { x: { folder: 2 } }, 'after HELD_STOP_WHY': { m: 1, g: { 'chat-note': 1 } },
    renderFolders: { x: { folder: 4 } }, hideFolder: { x: { folder: 1 } }, removeFolder: { x: { folder: 5 } }, submitFolderName: { x: { folder: 2 } }, renameFolder: { x: { folder: 3 } },
    inlineNameEl: { x: { selector: 1 } }, startSessionEdit: { x: { rename: 2 } }, startFolderEdit: { x: { folder: 2 } }, nameAt: { x: { selector: 1 } }, placeRen: { x: { selector: 1 } },
    removeSessionUi: { m: 1, g: { dialog: 2 } }, prevRenameArgs: { x: { rename: 2 } }, replayHistory: { g: { 'message-line': 1 }, x: { file: 1 } }, announcePrevious: { x: { folder: 1 } },
    applyAddResult: { x: { folder: 1 } }, addFloorNote: { m: 1, v: 4, x: { data: 2, floor: 1 } }, NEWFOLDER: { x: { floor: 1 } },
    'after pendingOpen': { g: { palette: 1, views: 1 }, x: { folder: 3 } }, 'after settleNow': { g: { views: 1 }, x: { crew: 1, folder: 1 } },
  };
  const SINK = /\.\s*name\b|\[\s*(['"`])name\1\s*\]|(['"`])name\2(?!\s*:)|\{[^{}]*?(?<![\w$.'"])name\b(?=\s*[,}:=])[^{}]*\}(?=\s*(?:=(?![=>])|\)\s*(?:=>|\{)|\s+of\b))|(?<![\w$.])(?:nameShown|menuLabel)\(/g;
  const MASKED_LINE = /(?<![\w$.])(?:nameShown|menuLabel|liveText|deskMask|helperMask|maskLabel|announce|toast|toastAction)\(/;
  const DEF = /^(?:async\s+)?function\s*\*?\s*([\w$]+)|^(?:const|let|var)\s+([\w$]+)/;
  // the pattern flags each form of a read (fixtures), and not a longer word or a literal key
  const flags = (src: string): number => (src.match(SINK) || []).length;
  for (const fx of ['x.name', 'x?.name', "x['name']", 'x["name"]', '`${x.name}`', 'agent.name', 'byId(id).name', 'const {name}=a', 'const {id,name:n}=a', 'let { name } = a',
    '({name})=>name', 'function f({name}){', 'for(const {name} of list)', "Reflect.get(x,'name')", "const k='name';a[k]", 'nameShown(a)', "menuLabel('Profile for ',a)"])
    ok(flags(fx) >= 1, `FR-197 sink table: the pattern flags the form ${fx}`);
  for (const fx of ['a.names', 'a.nameTip(x)', 'getName()', "'names'", 'f({name:1});', "f({'name':1});", 'x.rename'])
    eq(flags(fx), 0, `FR-197 sink table: the pattern does not flag ${fx}`);
  for (const [form, t] of [['LF', app], ['CRLF', app.replace(/\n/g, '\r\n')]] as const) {
    const L = t.split(/\r?\n/);
    const defOf = (i: number): string => { let top = false; for (let j = i; j >= 0; j--) { const x = L[j]; if (!/^\S/.test(x) || /^(?:\/\*|\*|\/\/|[}\])])/.test(x)) continue; const d = DEF.exec(x); if (d) return (top ? 'after ' : '') + (d[1] || d[2]); top = true; } return '?'; };
    const found: Record<string, { all: number; onMasked: number }> = {};
    L.forEach((x, i) => { const c = (x.match(SINK) || []).length; if (!c) return; const k = defOf(i); const f = (found[k] = found[k] || { all: 0, onMasked: 0 }); f.all += c; if (MASKED_LINE.test(x)) f.onMasked += c; });
    for (const k of Object.keys(found)) ok(k in TABLE, `FR-197 sink table: the name reads in ${k} are listed as masked, a named gap or exempt (${form})`);
    for (const [k, r] of Object.entries(TABLE)) {
      const g = Object.entries(r.g || {}), x = Object.entries(r.x || {});
      for (const [c] of g) ok(c in GAP_CLASSES, `FR-197 sink table: ${k} names a known gap class ${c}`);
      for (const [c] of x) ok(c in EXEMPT_REASONS && /^[a-z]+$/.test(c), `FR-197 sink table: ${k} gives a known one-word reason ${c}`);
      const want = (r.m || 0) + (r.v || 0) + [...g, ...x].reduce((s, [, n]) => s + n, 0);
      eq(found[k] ? found[k].all : 0, want, `FR-197 sink table: ${k} holds ${want} name reads (${form})`);
      ok(!r.m || (found[k] && found[k].onMasked >= r.m), `FR-197 sink table: the ${r.m || 0} masked reads in ${k} are on lines that go through a mask (${form})`);
    }
  }
  // forms a static scan cannot reach ([KNOWN GAP]; none used in app.js today, held by this table: a new use would have to enter it). Each is named,
  // with these words, in spec 012's FR-197 delta (round 5 of the review of PR 2098):
  //   a key built from parts at run time (a computed key such as 'na'+'me');
  //   a session object's values or entries read as a whole (Object.values, Object.entries);
  //   a session object turned into text as a whole (JSON.stringify);
  //   a new caller of a listed raw renderer that passes it a session name from a new place.
  const STATIC_GAPS = ['a key built from parts at run time', "a session object's values or entries read as a whole", 'a session object turned into text as a whole',
    'a new caller of a listed raw renderer that passes it a session name from a new place'];
  {
    const specTxt = fs.readFileSync(path.join(__dirname, '..', '..', 'specs', '012-claude-codex-adapters', 'spec.md'), 'utf8');
    for (const g of STATIC_GAPS) ok(specTxt.includes(g), `FR-197 the spec names the form a static scan cannot reach: ${g}`);
    ok(specTxt.includes('none used today, held by this table: a new use would have to enter it'), 'FR-197 the spec says the unreachable forms are unused today');
  }
  // every gap class the table uses is named in both lists, and the two lists name the same classes (round 4: the rail rows had dropped out of the spec's)
  const listOf = (file: string): string[] => {
    const txt = fs.readFileSync(path.join(__dirname, '..', '..', 'specs', '012-claude-codex-adapters', file), 'utf8');
    const all = [...txt.matchAll(/FR-197 gap classes: ([^.|]*)\./g)];
    eq(all.length, 1, `FR-197 ${file} holds one gap class list`);
    return all[0][1].split(';').map((c) => c.trim()).filter(Boolean).sort();
  };
  const spec = listOf('spec.md'), cov = listOf('secret-coverage.md');
  eq(spec, cov, 'FR-197 the spec and secret-coverage.md name the same gap classes');
  eq(spec, Object.values(GAP_CLASSES).sort(), 'FR-197 the gap classes in the spec are the sink table classes');
  const used = new Set(Object.values(TABLE).flatMap((r) => Object.keys(r.g || {})));
  eq([...used].sort(), Object.keys(GAP_CLASSES).sort(), 'FR-197 every gap class is used by the sink table');
}

void stripsByBehaviour().then(() => console.log(`test-live-mask: ${n} asserts passed`), (e) => { console.error(e); process.exit(1); });
